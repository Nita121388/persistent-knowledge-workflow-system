# PKWS Agent Runtime 交接文档

> 版本：v0.1
> 目的：将 Agent Runtime Phase 1 开发任务交接给下一个 Agent
> 当前状态：文档收口完成 + 短期优化（Worker 常驻 + 内存上下文）已完成

---

## 1. 项目概览

PKWS（Persistent Knowledge Workflow System）是一个本地运行的 AI 知识整理工作流系统，对接 Obsidian Vault 和 Web Clipper。

当前代码库已完成：
- MVP 核心闭环（Inbox Scan → Case → AI Proposal → Patch → Apply → Rollback）
- 短期优化：Worker 常驻 + 内存 `Map<caseId, messages>` 上下文缓存
- 所有 Agent 相关设计文档集中在 `docs/agent/`

---

## 2. 已完成的工作

### 2.1 文档收口

所有 Agent 设计文档已整理到 `docs/agent/` 目录：

| 文件 | 内容 |
|------|------|
| `docs/agent/agent-runtime.md` | **最新方案**：常驻 Agent Runtime + 多 Case 调度 + 上下文管理 + 配置项 + Snorkeling 参考的 Agent 自动发现 |
| `docs/agent/agent-integration.md` | 早期方案（CLI 包装器思路），保留作为设计迭代记录 |

引用一致性已验证：
- `docs/architecture.md` → 指向 `agent/agent-runtime.md`
- `docs/development-plan.md` → 指向 `agent/agent-runtime.md`，新增 §10 Agent Runtime 路线图
- `docs/modules.md` → 指向 `agent/agent-runtime.md`，Worker 表 + 领域模块 + MVP 列表更新
- `docs/data-model.md` → 增加 `Agent Session` ID 前缀 `as_`

### 2.2 短期优化（已实现，0.5 天）

在当前 Worker 中增加了内存上下文缓存，不改架构。

```typescript
// apps/server/src/worker/handlers.ts
// 新增：
interface ConversationContext {
  caseId: string;
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string; timestamp: string }>;
  turnCount: number;
  compressedSummary: string | null;
  lastActiveAt: number;
}

// Map<caseId, ConversationContext> 内存缓存
// MAX_CONTEXTS = 20, EVICT_AFTER_MS = 6h, COMPRESS_THRESHOLD = 20
// getOrCreateContext() / appendToContext() / buildContextPrompt() / evictStaleContexts()

// handlers.ts: handleGenerateProposal 中通过 buildContextPrompt() 拼接历史到 prompt
// index.ts: Worker 现在常驻（isRunning 标志 + setInterval 持续轮询）
// cases.ts: comment 接口传递 comment 文本到 job payload
```

改动文件：
- `apps/server/src/worker/handlers.ts` — 核心改动
- `apps/server/src/worker/index.ts` — Worker 常驻
- `apps/server/src/routes/cases.ts` — 传递 comment 到 payload
- `packages/ai/src/index.ts` — `ProposalInput` 增加 `conversationHistory` 字段

---

## 3. 待开发：Agent Runtime Phase 1（3-5 天）

### 3.1 目标

创建独立的 `packages/agent-runtime/` 包，实现：

- 常驻 Agent Runtime 进程（与 Worker 共享常驻进程）
- `CaseSession` 类型 + 内存管理（Map + eviction）
- `context-builder`：从 messages 构建 CLAUDE.md
- `cli-runner`：spawn CLI（Codex / Claude Code）+ 读取输出
- `scheduler`：优先级队列 + decideAction（continue / new_turn / compress）
- Settings 增加 Agent Runtime 配置项
- 集成到 Server：`startAgentRuntime` + `onUserInput`

### 3.2 参考文档

- **完整设计**：`docs/agent/agent-runtime.md`
- **开发计划**：`docs/development-plan.md` §10（M10.1）
- **Snorkeling 参考**：`E:/code/snorkeling/pkg/aisessions/paths.go`（Agent 自动发现路径）
- **Snorkeling 参考**：`E:/code/snorkeling/pkg/aisessions/provider_codex.go` / `provider_claude.go`（会话格式解析）

### 3.3 具体任务

#### 3.3.1 创建包结构

```
packages/agent-runtime/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts                  # 导出 + startAgentRuntime()
│   ├── runtime.ts                # AgentRuntime 主类 + runLoop
│   ├── session.ts                # CaseSession 类型 + 管理
│   ├── context-builder.ts        # 从 CaseSession 构建 CLAUDE.md
│   ├── cli-runner.ts             # spawn CLI 子进程
│   ├── scheduler.ts              # 调度器：优先级 / decideAction / eviction
│   ├── agent-detect.ts           # 自动检测本地 Agent（参考 Snorkeling paths.go）
│   └── types.ts                  # 类型定义
```

在 `pnpm-workspace.yaml` 中注册，在 `apps/server/package.json` 中添加依赖。

#### 3.3.2 Agent 自动检测

参考 Snorkeling 的 `DefaultProviders()` + `DefaultCodexSessionsDir()` + `DefaultClaudeProjectDirs()`

```typescript
// agent-detect.ts
function detectAvailableAgents(): AgentInfo[] {
  // 检测 Codex: $CODEX_HOME/sessions/ → ~/.codex/sessions/
  // 检测 Claude: $CLAUDE_CONFIG_DIR/projects/ → ~/.claude/projects/ → ~/.cache/claude/projects/
  // 检测 PATH 中的 codex/claude 可执行文件
}
```

#### 3.3.3 CaseSession 管理

```typescript
// session.ts
interface CaseSession {
  caseId: string;
  messages: Message[];
  turnCount: number;
  totalTokens: number;
  awaitingUserInput: boolean;
  hasNewUserInput: boolean;
  lastActiveAt: Date;
  compressedSummary?: string;
  compressionEpoch: number;
}

class SessionManager {
  private activeCases: Map<string, CaseSession>;
  
  getOrCreate(caseId: string): CaseSession;
  remove(caseId: string): void;
  evictStale(): void;  // 6 小时不活跃
  snapshot(): SessionSnapshot[];  // 用于持久化/调试
}
```

#### 3.3.4 Context Builder

```typescript
// context-builder.ts
function buildContext(session: CaseSession, action: Action): string;
// Action.Continue → 追加用户最新输入到已有 messages
// Action.NewTurn → 从 SQLite 加载历史
// Action.CompressThenContinue → 折叠旧消息 + 保留最近 N 条

function buildClaudeMd(session: CaseSession, context: string): string;
// 输出 CLAUDE.md 内容
```

#### 3.3.5 CLI Runner

```typescript
// cli-runner.ts
interface CliRunnerOptions {
  cliPath: string;         // 'codex' | 'claude' | 具体路径
  workDir: string;         // 隔离工作目录
  taskPrompt: string;      // 任务描述
  timeoutMs: number;       // 超时
  envVars?: Record<string, string>;
}

async function runCliAgent(options: CliRunnerOptions): Promise<CliResult>;
// 1. 写入 CLAUDE.md 到工作目录
// 2. spawn CLI 子进程（--print 模式）
// 3. 读取输出文件（proposal.json / patch-operations.json）
// 4. 超时 kill
```

#### 3.3.6 Scheduler

```typescript
// scheduler.ts
enum Action { Continue, NewTurn, CompressThenContinue }

class Scheduler {
  private pendingQueue: string[];     // 有用户新输入的 Case
  private waitQueue: string[];        // 等待用户回复的 Case
  
  decideAction(session: CaseSession): Action;
  // turnCount === 0 → NewTurn
  // totalTokens > 阈值 → CompressThenContinue
  // 默认 → Continue
  
  onUserInput(caseId: string, input: string): void;
  // 追加到 session.messages → pendingQueue
  
  async runLoop(): void;
  // 优先级调度：pendingQueue > waitQueue(跳过) > 空转
}
```

#### 3.3.7 Settings 集成

在 Settings 页面增加 Agent Runtime 配置区域（参见 `docs/agent/agent-runtime.md` §8）：

```
Settings → Agent Runtime
  ├─ [启用] Agent Runtime
  ├─ 可用 Agent 列表（自动检测结果）
  ├─ 默认 CLI：[Codex ▼]
  ├─ CLI 路径（可选覆盖）：[________________]
  ├─ 最大活跃会话数：[10]
  └─ 会话闲置超时：[6] 小时
```

#### 3.3.8 Server 集成

```typescript
// apps/server/src/index.ts
import { startAgentRuntime } from '@pkws/agent-runtime';

// 与 Worker 并行启动
startWorker();
startAgentRuntime({
  db: getDb(),
  workspacePath: settings.workspacePath,
  cliPath: detectedCli,
  maxActiveCases: 10,
});
```

---

## 4. 关键文件索引

### 4.1 设计文档

| 路径 | 说明 |
|------|------|
| `docs/agent/agent-runtime.md` | **主设计文档**：完整架构、CaseSession、Scheduler、配置项、安全边界、落地计划 |
| `docs/agent/agent-integration.md` | 早期 CLI 包装方案（已弃用，保留作为记录） |
| `docs/development-plan.md` | §10 Agent Runtime 路线图（M10.1 / M10.2 / M10.3） |
| `docs/data-model.md` | §4 ID 规则增加 `Agent Session`（`as_` 前缀） |
| `docs/modules.md` | §6 Worker 表 + §11 领域模块 + §12 MVP 列表 |
| `docs/architecture.md` | 组件表增加 Agent Runtime |

### 4.2 已实现代码

| 路径 | 说明 |
|------|------|
| `apps/server/src/worker/handlers.ts` | `ConversationContext` + `caseContexts` Map + 上下文拼接逻辑 |
| `apps/server/src/worker/index.ts` | Worker 常驻（`isRunning` 标志） |
| `apps/server/src/routes/cases.ts` | comment 传递 `comment` 到 job payload |
| `packages/ai/src/index.ts` | `ProposalInput` 增加 `conversationHistory` 字段 |

### 4.3 参考项目

| 项目 | 参考内容 |
|------|---------|
| Snorkeling (`E:/code/snorkeling/`) | `pkg/aisessions/paths.go` — Agent 检测路径 |
| Snorkeling | `pkg/aisessions/provider_codex.go` — Codex 会话格式 |
| Snorkeling | `pkg/aisessions/provider_claude.go` — Claude 会话格式 |

---

## 5. 注意事项

1. **不破坏现有回退路径**——Agent Runtime 启用时走新路径，关闭时回退到直接调 LLM API
2. **Settings 增加配置项**——需要在服务端 `settings` 表和前端 Settings 页面同时增加字段
3. **与短期优化代码的关系**——短期优化在 `handlers.ts` 中的 `caseContexts` 是简陋实现，Agent Runtime Phase 1 需要创建独立包，移除 `handlers.ts` 中的内存逻辑（或让它调用 Agent Runtime）
4. **CLI 权限控制**——CLI 子进程必须在 PKWS 分配的隔离工作目录中运行，不能直接访问整个 Vault
5. **类型检查**——当前代码库有一些预先存在的类型错误（Vercel AI SDK 版本不兼容、template literal types 等），改动时不要引入新错误
