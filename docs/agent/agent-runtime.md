# PKWS Agent Runtime 设计

> 版本：v0.1
> 状态：设计草案
> 阶段：Phase 2 方案设计
> 更新日期：2026-07-01

## 1. 背景与问题

### 1.1 当前局限

PKWS 当前 AI 调用模式是 **单次 LLM 请求 → 纯文本 JSON 输出**：

```
用户评论/新文件 → createJob → handleGenerateProposal → LLM API → 返回 JSON
                                                                        ↓
用户再次评论 → createJob → handleGenerateProposal → LLM API → 返回 JSON（不记得上次）
                                                                        ↓
用户点"生成 Patch" → createJob → handleGeneratePatch → LLM API → 返回 JSON patch
                                                                        ↓
用户审批 → createJob → handleApplyPatch → executePatch（系统代码执行文件操作）
```

三个问题：

1. **每次 LLM 调用都是全新的上下文**——第二次调用不记得第一次的分析结果和推理过程，靠用户手动维护的 `instructionSummary` 太弱
2. **AI 不能执行操作**——只会吐 JSON，不能搜索 Vault、不能读其他笔记、不能做多步推理
3. **多轮交互成本高**——每次用户评论都要触发一次完整的"从零拼上下文 → LLM 调用 → 输出"，浪费 token

### 1.2 目标

让 PKWS 的 AI 具备：
- **在内存中保持 Case 上下文**，而不是每次从零重建
- **调用本地工具**（文件编辑、搜索 Vault、执行命令）
- **多 Case 共存调度**，自动决定继续上下文还是重新开始
- **PKWS 完全控制 Agent 的上下文内容**，不让 Agent 拥有独立于系统的记忆

### 1.3 参考项目

| 项目 | 定位 | 核心设计 | 对 PKWS 的启发 |
|------|------|---------|----------------|
| [Pi](https://github.com/earendil-works/pi) | Agent Toolkit | Agent Loop、工具执行管线、Extension 系统 | 工具执行管道模式 |
| [Holon](https://github.com/holon-run/holon) | Agent Workbench | 后台进程持久化、WorkItem 模型、上下文压缩 | 调度器 + 多 WorkItem 共存 |
| [OpenClaw](https://github.com/openclaw/openclaw) | 自托管 AI 助手 | 多通道网关、AGENTS.md 上下文注入、sandbox 隔离 | 通过 AGENTS.md 注入上下文的验证 |
| [Hermes Agent](https://github.com/NousResearch/hermes-agent) | 自主学习 Agent | 自主记忆管理、FTS5 检索、Skill autogenesis | 上下文累积 + 自动压缩 + 跨会话检索 |

---

## 2. 设计结论

### 2.1 核心架构

**PKWS 的 Agent Runtime 是一个常驻 Node.js 进程，在内存中维护多个 Case 的上下文，自动调度哪个 Case 需要推进。**

```
Agent Runtime（常驻进程，不是每次新建）
│
├─ activeCases: Map<caseId, CaseSession>
│   ├─ case_001 → { messages: [...], turnCount: 5, awaitingUserInput: false }
│   ├─ case_003 → { messages: [...], turnCount: 12, awaitingUserInput: true  }
│   └─ case_007 → { messages: [...], turnCount: 2,  awaitingUserInput: false }
│
├─ scheduler 循环
│   ├─ 有用户新评论的 Case → 优先调度
│   ├─ 等待用户回复的 Case → 跳过，不给 LLM 调用
│   ├─ 消息数 < 阈值 → 继续原始上下文
│   └─ 消息数 > 阈值 → 先压缩再继续
│
│  调度优先级：
│   1. hasNewUserInput === true     ← 用户刚评论了
│   2. awaitingUserInput === false  ← 不需要等用户
│   3. pendingQueue 中等待最久的   ← FIFO
│   4. 如果全部 awaitUserInput → 空转，5s 轮询
│
└─ eviction
    └─ 超过 N 小时不活跃 → 持久化到 SQLite，释放内存
       （N 由用户配置，默认 6 小时）
```

### 2.2 关键决策

| 决策 | 选型 | 理由 |
|------|------|------|
| **Agent 执行方式** | 调用本地 CLI（Codex / Claude Code） | PKWS 不需要自己实现 Agent Loop、function calling、工具执行 |
| **上下文传递** | PKWS 动态生成 CLAUDE.md / AGENTS.md | CLI 自动读取，PKWS 完全控制内容 |
| **进程模型** | **常驻 Agent Runtime**（不退出） | 保持 Case 上下文在内存中，避免每次从零重建 |
| **多 Case 共存** | 内存中 `Map<caseId, CaseSession>` | 一个进程服务所有活跃 Case |
| **调度逻辑** | 自动 decideAction('continue' \| 'new_turn' \| 'compress_then_continue') | 不浪费 token，不重建不需要重建的上下文 |
| **用户等待** | 显式 `awaitingUserInput` 状态 | Agent 知道等用户，调度器跳过，不浪费 LLM 调用 |

---

## 3. 架构设计

### 3.1 组件图

```
┌──────────────────────────────────────────────────────────────────┐
│                      PKWS Agent Runtime                          │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                    Scheduler Loop                         │   │
│  │                                                           │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────────────────┐    │   │
│  │  │ 优先队列   │  │ 等待队列  │  │ decideAction()       │    │   │
│  │  │(有新输入)  │  │(等用户回复)│  │ continue / new_turn  │    │   │
│  │  └──────────┘  └──────────┘  │ compress_then_continue │    │   │
│  │                              └──────────────────────┘    │   │
│  └──────────────────────────────────────────────────────────┘   │
│                           │                                      │
│                           ▼                                      │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │              activeCases: Map<caseId, CaseSession>        │   │
│  │                                                           │   │
│  │  case_001                     case_003                    │   │
│  │  ┌──────────────────────┐    ┌──────────────────────┐    │   │
│  │  │ messages: Message[]  │    │ messages: Message[]  │    │   │
│  │  │ turnCount: 5         │    │ turnCount: 12        │    │   │
│  │  │ totalTokens: ~8k     │    │ totalTokens: ~24k    │    │   │
│  │  │ awaitingUser: false  │    │ awaitingUser: true   │    │   │
│  │  │ lastActive: 12:30    │    │ lastActive: 10:15    │    │   │
│  │  │ hasNewInput: true    │    │ hasNewInput: false   │    │   │
│  │  └──────────────────────┘    └──────────────────────┘    │   │
│  └──────────────────────────────────────────────────────────┘   │
│                           │                                      │
│                           ▼                                      │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                    CLI Runner                             │   │
│  │                                                           │   │
│  │  1. 从 CaseSession 构建上下文 → CLAUDE.md                 │   │
│  │  2. spawn CLI 子进程（--print 模式）                      │   │
│  │  3. 读取输出 → 追加到 CaseSession.messages                │   │
│  │  4. 如果是 ask_user 工具 → awaitingUserInput = true       │   │
│  └──────────────────────────────────────────────────────────┘   │
│                           │                                      │
│                           ▼                                      │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                    SQLite（持久化）                        │   │
│  │                                                           │   │
│  │  cases / timeline_events / proposals / patch_manifests    │   │
│  │  agent_sessions（CaseSession 的快照，用于 eviction 恢复）  │   │
│  └──────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
```

### 3.2 CaseSession

```typescript
interface CaseSession {
  caseId: string;

  // 上下文
  messages: Message[];
  turnCount: number;
  totalTokens: number;

  // 系统指令（每次构建 CLAUDE.md 时使用）
  systemPrompt: string;
  workspaceRules: WorkspaceRule[];
  caseInstructions: CaseInstruction[];

  // 状态
  awaitingUserInput: boolean;  // 是否在等用户回复
  hasNewUserInput: boolean;    // 用户是否有新输入未处理
  lastActiveAt: Date;

  // 压缩
  compressedSummary?: string;       // 折叠后的旧消息摘要
  compressionEpoch: number;         // 压缩轮次
}
```

### 3.3 调度器核心逻辑

```typescript
enum Action {
  Continue,              // 追加消息，直接调 LLM
  NewTurn,               // 从 SQLite 重建上下文
  CompressThenContinue,  // 折叠旧消息 + 保留最近 N 条，然后继续
}

function decideAction(session: CaseSession): Action {
  if (session.turnCount === 0) return Action.NewTurn;
  if (session.totalTokens > COMPRESS_TOKEN_THRESHOLD) return Action.CompressThenContinue;
  return Action.Continue;
}

class Scheduler {
  private activeCases = new Map<string, CaseSession>();
  private pendingQueue: string[] = [];  // 有用户新输入的 Case
  private waitQueue: string[] = [];     // 等待用户回复的 Case

  async runLoop() {
    while (true) {
      // 1. 优先处理有用户新输入的 Case
      const caseId = this.pendingQueue.shift() ?? null;
      if (!caseId) { await sleep(5000); continue; }

      const session = this.activeCases.get(caseId)!;
      const action = decideAction(session);

      // 2. 构建上下文并调 LLM
      const context = this.buildContext(session, action);
      const result = await this.callCli(session, context);

      // 3. 追加 AI 输出到 messages
      session.messages.push({ role: 'assistant', content: result });
      session.turnCount++;

      // 4. 检查是否有工具请求用户确认
      if (result.includes('ask_user')) {
        session.awaitingUserInput = true;
        this.waitQueue.push(caseId);
        // 通知 Web UI 弹窗
        this.notifyUser(caseId, result);
      }
    }
  }

  // 用户通过 Web UI 回复时调用
  onUserInput(caseId: string, input: string) {
    const session = this.activeCases.get(caseId);
    if (!session) return;

    session.messages.push({ role: 'user', content: input });
    session.hasNewUserInput = true;
    session.awaitingUserInput = false;
    this.pendingQueue.push(caseId);
    this.waitQueue = this.waitQueue.filter(id => id !== caseId);
  }
}
```

### 3.4 上下文构建

```typescript
function buildContext(session: CaseSession, action: Action): string {
  switch (action) {
    case Action.NewTurn:
      // 从 SQLite 加载历史，构建完整 CLAUDE.md
      return buildFreshClaudeMd(session);

    case Action.Continue:
      // 在已有 messages 末尾追加用户最新输入
      // messages 包含完整的对话历史
      return buildClaudeMdWithHistory(session);

    case Action.CompressThenContinue:
      // 1. 把旧消息折叠成摘要
      // 2. 只保留最近 N 条原始消息
      // 3. 在 CLAUDE.md 中包含压缩摘要 + 最近消息
      return buildClaudeMdCompressed(session);
  }
}
```

### 3.5 三种调度模式详解

| 模式 | 触发条件 | 行为 | 效果 |
|------|---------|------|------|
| **Continue** | `turnCount > 0` 且 `totalTokens < 阈值` | messages 已在内从中，追加用户新输入，直接调 LLM | 零成本恢复，token 不浪费 |
| **NewTurn** | `turnCount === 0` | 从 SQLite 加载该 Case 的 timeline，重建 messages | 首次调用或从持久化恢复 |
| **CompressThenContinue** | `totalTokens > 阈值` | 旧消息 → 摘要 + 保留最近 12 条原始消息 | 避免上下文窗口溢出 |

---

## 4. 与 CLI Agent 的集成

Agent Runtime 通过 spawn 本地 CLI（Codex / Claude Code）来实际执行任务。

### 4.1 调用流程

```
Agent Runtime
  │
  ├─ 1. 从 CaseSession.messages 构建 CLAUDE.md
  │
  ├─ 2. 写入临时工作目录
  │     workspace/agents/case_001/
  │     ├── CLAUDE.md    ← 包含：Case 目标 + Rules + 对话历史 + 输出要求
  │     ├── context/     ← 只读：原始文件、Vault 结构
  │     └── output/      ← CLI 输出
  │
  ├─ 3. spawn CLI (--print 模式)
  │
  ├─ 4. 读取 output/proposal.json
  │
  └─ 5. 追加到 CaseSession.messages → 更新 Case 状态
```

### 4.2 CLAUDE.md 中的历史传递

```markdown
# CLAUDE.md — 由 PKWS 自动生成

## PKWS Case Context

### Case 目标
整理这篇关于 AI Agent 的文章，确定其价值和处理方式。

### Workspace Rules
- 工具类文章默认放到 `资源库/工具/`
- 网页收藏必须保留 `source_url` 和 `captured_at`

### Case Instructions
- 先补充调研，不要直接合并到正式笔记

### Conversation History
以下是你之前已经完成的分析和用户的反馈：

（最近对话，从旧到新）

Human: 帮我分析这篇关于 AI Agent 的文章
Assistant: 我建议...（摘要、价值判断、建议操作）
Human: 重新生成，我想先不合并，先做调研
Assistant: 好的，调整方案如下...（新的建议）

### 当前任务
现在用户的最新评论是：请先搜索 Vault 中已有的 AI Agent 相关内容
```

### 4.3 为什么是 CLI 子进程而不是直接调 LLM API

| | CLI 子进程 | 直接调 LLM API |
|---|---|---|
| **工具执行** | CLI 自带（文件编辑、搜索、Shell） | 需自己实现 function calling |
| **上下文窗口** | CLI 自己管理（开箱即用） | 需自己跟踪 |
| **多轮推理** | CLI 自己支持（agent loop） | 需自己实现 |
| **输出解析** | CLI 按 CLAUDE.md 指令输出文件 | 需 structured output |
| **权限** | PKWS 通过工作目录限制 | PKWS 自己控制 |
| **外部依赖** | 用户需安装 Codex/Claude CLI | 只要 API Key |

---

## 5. 多 Case 调度与内存管理

### 5.1 调度优先级

```
调度优先级（高 → 低）：
1. hasNewUserInput === true     ← 用户刚评论了
2. awaitingUserInput === false  ← 不需要等用户
3. pendingQueue 中等待最久的   ← FIFO
4. 如果全部 awaitUserInput → 空转，5s 轮询
```

### 5.2 内存淘汰（Eviction）

```typescript
const EVICT_AFTER_MS = 6 * 60 * 60 * 1000; // 6 小时
const MAX_ACTIVE_CASES = 20;

function shouldEvict(session: CaseSession): boolean {
  return Date.now() - session.lastActiveAt.getTime() > EVICT_AFTER_MS;
}

async function evictCase(caseId: string) {
  const session = activeCases.get(caseId)!;

  // 1. 序列化到 SQLite
  await db.insert(schema.agentSessions).values({
    caseId,
    messagesJson: JSON.stringify(session.messages),
    compressedSummary: session.compressedSummary,
    turnCount: session.turnCount,
    compressionEpoch: session.compressionEpoch,
    updatedAt: new Date().toISOString(),
  }).run();

  // 2. 从内存移除
  activeCases.delete(caseId);
}
```

### 5.3 恢复逻辑

```typescript
async function restoreCase(caseId: string): Promise<CaseSession> {
  const saved = await db.select()
    .from(schema.agentSessions)
    .where(eq(schema.agentSessions.caseId, caseId))
    .get();

  if (saved) {
    return {
      caseId,
      messages: JSON.parse(saved.messagesJson),
      turnCount: saved.turnCount,
      // ... 其他字段
    };
  }

  // 第一次调此 Case
  return createNewSession(caseId);
}
```

---

## 6. 与现有 PKWS 的集成

### 6.1 现有模块不变

| 模块 | 保持不变 | 说明 |
|------|---------|------|
| `packages/ai` | ✅ | 保留直接调 LLM API 的旧逻辑作为回退 |
| Job Queue | ✅ | 继续用于 `scan_inbox`, `apply_patch`, `rollback_apply` |
| Vault Safety | ✅ | Apply/Rollback 逻辑不变 |
| Web UI | ✅ | 只增加 Agent 状态展示区域 |

### 6.2 新增模块

新增 `packages/agent-runtime/`：

```
packages/agent-runtime/
├── index.ts                  # 导出 + 生命周期
├── runtime.ts                # Agent Runtime 主类 + runLoop
├── session.ts                # CaseSession 类型 + 管理
├── context-builder.ts        # 从 CaseSession 构建 CLAUDE.md
├── cli-runner.ts             # spawn CLI 子进程
├── scheduler.ts              # 调度器：优先级 / decideAction / eviction
├── output-parser.ts          # 解析 CLI 输出并结构化
└── types.ts                  # 类型定义
```

### 6.3 替换的调用路径

```
现状：                   改为：
用户评论                 用户评论
  → createJob               → onUserInput(caseId, comment)
  → handleGenerateProposal    → scheduler.onUserInput()
  → LLM API (generateObject)  → scheduler 自动调度
  → 返回 JSON                → CLI 子进程执行
  → Job 结束                 → 读取输出，更新 Case
                               → messages 累积在内存中
```

### 6.4 启动方式

```typescript
// server/src/index.ts
import { startAgentRuntime } from '@pkws/agent-runtime';

// 应用启动时启动 Agent Runtime（同时启动 Worker）
startAgentRuntime({
  db: getDb(),
  workspacePath: settings.workspacePath,
  cliPath: detectCli(), // 'codex' | 'claude'
  maxActiveCases: 20,
});
```

---

## 7. 安全边界

| 风险 | 控制措施 |
|------|---------|
| CLI 访问不该访问的文件 | runtime 为每次调用创建隔离的工作目录，CLI 只能看到 context/ 和 output/ |
| CLI 执行危险命令 | 工作目录隔离 + timeout 超时 kill |
| 上下文泄露 | CLAUDE.md 只包含必要的 Case 信息，不包含 API Key |
| 内存泄漏 | LRU eviction，超过 `MAX_ACTIVE_CASES` 淘汰最不活跃的 |
| 输出格式异常 | output-parser 用 Zod schema 校验 |
| Agent 无限循环 | `maxTurnsPerCall` 限制（默认 10 轮），超限则中止 |

---

## 8. 用户配置项

### 8.1 配置列表

Agent Runtime 的设置项通过 PKWS Settings 页面配置，与现有的 AI Provider 配置放在一起。

```typescript
interface AgentRuntimeSettings {
  // 主开关
  agentRuntimeEnabled: boolean;         // 是否启用 Agent Runtime，默认 false

  // CLI 配置
  agentCliPath: string;                 // CLI 路径，默认自动检测 'codex' | 'claude'

  // Agent 自动发现（参考 Snorkeling aisessions/paths.go）
  // PKWS 启动时自动扫描本地已知路径，检测已安装的 Agent CLI：
  //   - Codex:  $CODEX_HOME/sessions/ 或 ~/.codex/sessions/
  //   - Claude: $CLAUDE_CONFIG_DIR/projects/ 或 ~/.claude/projects/ 或 ~/.cache/claude/projects/
  //   - 更多 Agent 可按相同模式扩展
  autoDetectAgents: boolean;            // 是否自动扫描本地 Agent，默认 true

  // 并发与资源控制
  maxActiveSessions: number;            // 最大活跃会话数，默认 10
  sessionTimeoutMinutes: number;        // 会话闲置超时（分钟后 evict），默认 360（6 小时）

  // 上下文管理
  contextCompressThreshold: number;     // 消息数超过多少触发压缩，默认 20
  contextKeepRecentCount: number;       // 压缩后保留最近多少条原始消息，默认 12
  maxTokensPerSession: number;          // 单会话最大 token 估算值，默认 32000

  // 沙箱权限（参考 OpenClaw sandbox.mode）
  sandboxMode: 'workspace-only' | 'vault-readonly' | 'full';
  // workspace-only:  CLI 只能操作 PKWS 分配的工作目录
  // vault-readonly:  CLI 可以读 Vault 但不能写
  // full:            CLI 拥有完整的文件系统访问（不推荐）
}

// 默认值
const DEFAULT_AGENT_SETTINGS: AgentRuntimeSettings = {
  agentRuntimeEnabled: false,
  agentCliPath: '',                    // 空 = 自动检测
  autoDetectAgents: true,
  maxActiveSessions: 10,
  sessionTimeoutMinutes: 360,
  contextCompressThreshold: 20,
  contextKeepRecentCount: 12,
  maxTokensPerSession: 32000,
  sandboxMode: 'workspace-only',
};
```

### 8.2 各项说明

#### 主开关

`agentRuntimeEnabled` 默认关闭。用户需要主动开启才会启用 Agent Runtime。关闭时回退到现有的直接调 LLM API 模式。

#### CLI 路径

默认自动检测系统 PATH 中的 `codex` 或 `claude`。用户可指定路径，例如：

- `/usr/local/bin/codex`
- `npx codex`
- `C:\Users\name\AppData\Local\Programs\claude\claude.exe`

空字符串表示自动检测。

#### Agent 自动发现

参考 Snorkeling 的 `aisessions/paths.go` 实现。

PKWS 启动时自动扫描本地已知路径，检测已安装的 Agent CLI 并加入可用列表：

| Agent | 检测路径（按优先级） | 环境变量覆盖 |
|-------|--------------------|-------------|
| **Codex** | `$CODEX_HOME/sessions/` → `~/.codex/sessions/` | `CODEX_HOME` |
| **Claude Code** | `$CLAUDE_CONFIG_DIR/projects/` → `~/.claude/projects/` → `~/.cache/claude/projects/` | `CLAUDE_CONFIG_DIR` |
| **更多 Agent** | 可按相同模式扩展 | 对应环境变量 |

自动发现的结果在 Settings 页面展示给用户：

```
Settings → Agent Runtime
  Agent 可用列表：
  ✅ Codex CLI   路径：/usr/local/bin/codex
  ✅ Claude Code 路径：/usr/local/bin/claude
  ⚠️ 未检测到 Aider（未安装）

  默认使用：[Codex CLI ▼]
```

用户可以：
- 查看系统检测到了哪些 Agent
- 选择默认使用的 Agent
- 手动指定路径（`agentCliPath` 非空时覆盖自动检测）

实现参考 Snorkeling 的 `DefaultProviders()` 模式：

```typescript
// 对应 Snorkeling 的 DefaultProviders() + DefaultCodexSessionsDir() + DefaultClaudeProjectDirs()
function detectAvailableAgents(): AgentInfo[] {
  const agents: AgentInfo[] = [];

  // 检测 Codex
  const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
  const codexPath = findCliOnPath('codex');
  if (codexPath || fs.existsSync(path.join(codexHome, 'sessions'))) {
    agents.push({
      id: 'codex',
      name: 'Codex CLI',
      path: codexPath,
      sessionsDir: path.join(codexHome, 'sessions'),
    });
  }

  // 检测 Claude Code
  const claudeDirs = [
    process.env.CLAUDE_CONFIG_DIR && path.join(process.env.CLAUDE_CONFIG_DIR, 'projects'),
    path.join(os.homedir(), '.claude', 'projects'),
    process.platform !== 'win32' && path.join(os.homedir(), '.cache', 'claude', 'projects'),
  ].filter(Boolean) as string[];

  const claudePath = findCliOnPath('claude');
  const claudeFound = claudePath || claudeDirs.some(d => fs.existsSync(d));
  if (claudeFound) {
    agents.push({
      id: 'claude',
      name: 'Claude Code',
      path: claudePath,
      projectDirs: claudeDirs.filter(d => fs.existsSync(d)),
    });
  }

  return agents;
}

#### 资源控制

| 配置 | 默认值 | 参考依据 | 说明 |
|------|--------|---------|------|
| `agentCliPath` | ''（自动检测） | 参考 Snorkeling `DefaultProviders()` | 空字符串时自动检测 PATH |
| `autoDetectAgents` | true | Snorkeling aisessions/paths.go | 启动时自动扫描 `~/.codex/`、`~/.claude/` 等路径 |
| `maxActiveSessions` | 10 | PKWS 自身需求 | OpenClaw/Hermes 均为单会话模式，无此配置。PKWS 是多 Case 并发场景，需限制内存占用 |
| `sessionTimeoutMinutes` | 360（6h） | PKWS 自身需求 | 半天不活跃的 Case 大概率用户暂时不处理。OpenClaw/Hermes 无超时——Agent 一直在聊天 |

#### 上下文管理

| 配置 | 默认值 | 参考依据 | 说明 |
|------|--------|---------|------|
| `contextCompressThreshold` | 20 | 参考 Holon（20 条消息触发压缩） | OpenClaw 用户手动 `/compact`，Hermes 用户手动 `/compress`，PKWS 自动压缩 |
| `contextKeepRecentCount` | 12 | 参考 Holon（保留最近的轮次） | 保留最近一轮完整交互 |
| `maxTokensPerSession` | 32000 | 适配主流模型上下文窗口 | 达到此阈值时触发压缩 |

#### 沙箱权限

参考 OpenClaw 的 `agents.defaults.sandbox.mode` 设计：

| 模式 | CLI 可读 | CLI 可写 | 适用场景 |
|------|---------|---------|---------|
| `workspace-only` | 仅 context/ 目录 | 仅 output/ 目录 | 推荐默认，最安全 |
| `vault-readonly` | Vault 全部文件 | 仅 output/ 目录 | 需要 AI 搜索 Vault 时 |
| `full` | 全部 | 全部 | 不推荐，仅高级用户 |

OpenClaw 通过 `sandbox.mode: "non-main"` 控制非主会话的沙箱行为。PKWS 的 sandbox 控制的是 CLI 子进程的文件系统访问范围，而不是 OpenClaw 的 Docker/SSH 沙箱——但概念一致。

### 8.3 与 OpenClaw / Hermes 的对比

| 配置项 | OpenClaw | Hermes | PKWS | 理由 |
|--------|----------|--------|------|------|
| Agent 行为控制 | AGENTS.md 文件注入 | ❌ 无 | CLAUDE.md 动态生成 | PKWS 核心控制手段 |
| 沙箱/权限 | `sandbox.mode` | ❌ 无 | `sandboxMode` | 参考 OpenClaw 设计 |
| 模型切换 | 配置文件 | `/model` 热切换 | 依赖 CLI 自身 | Phase 2 不做 |
| 工具开关 | TOOLS.md | `hermes tools` | 后置 | Phase 2 先不做 |
| 会话数限制 | ❌ 无 | ❌ 无 | `maxActiveSessions` | PKWS 独有（多 Case 并发） |
| 超时 eviction | ❌ 无 | ❌ 无 | `sessionTimeoutMinutes` | PKWS 独有 |
| 压缩阈值 | 用户手动 `/compact` | 用户手动 `/compress` | `contextCompressThreshold` | PKWS 自动压缩 |
| 记忆管理 | ❌ 无 | Agent 自主 | CaseInstruction + Rules | PKWS 手动控制 |

**核心差异**：OpenClaw 和 Hermes 都是"一个 Agent 一直跟你对话"的模式，不需要并发控制。PKWS 是"多个 Case 共享一个 Runtime"的任务模式，资源管理类配置是 PKWS 独有的需求。

---

## 9. 落地计划

### Phase 1：基础 Agent Runtime（3-5 天）

1. 创建 `packages/agent-runtime/` 包
2. 实现 `CaseSession` + 内存管理（Map + eviction）
3. 实现 `context-builder`：从 messages 构建 CLAUDE.md
4. 实现 `cli-runner`：spawn CLI + 读取输出
5. 实现 `scheduler`：优先级队列 + decideAction
6. Settings 增加 Agent Runtime 配置项（主开关 + CLI 路径 + 资源限制）
7. 集成到 server：startAgentRuntime + onUserInput

### Phase 2：完整上下文管理（3-5 天）

1. 上下文压缩：消息 > 阈值时折叠旧消息
2. 暂停/恢复：`awaitingUserInput` + waitQueue
3. SQLite 持久化：eviction 时序列化，恢复时反序列化
4. 多 Case 调度：并发活跃 Case 的优先级管理
5. 输出解析：proposal.json / patch-operations.json 的 Zod 校验
6. Settings 增加上下文管理配置项（压缩阈值、保留数、token 上限）

### Phase 3：完善（更长期）

1. Web UI Agent 状态展示 + 控制
2. WebSocket 实时推送 Agent 运行状态
3. 多 CLI 后端支持（Codex / Claude Code 可切换）
4. 沙箱权限控制（sandboxMode 配置）
5. 错误恢复 + 重试机制

---

## 10. 非目标

- PKWS 不实现自己的 Agent Loop（依赖 CLI）
- PKWS 不做 function calling（依赖 CLI）
- PKWS 不管理 CLI 的安装和升级（用户自行安装）
- PKWS 不提供 Docker/VM 沙箱环境（CLI 在隔离工作目录中运行）
- PKWS 不实现跨 Case 的记忆学习（那是 Phase 3 的 Learned Memory）
