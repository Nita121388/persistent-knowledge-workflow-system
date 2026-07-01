# PKWS Agent 集成方案设计

> 版本：v0.1
> 状态：设计草案
> 阶段：Phase 2 方案设计
> 更新日期：2026-07-01

## 1. 背景与目标

### 1.1 当前局限

PKWS 当前 AI 调用模式是 **单次 LLM 请求 → 纯文本 JSON 输出**：

```
用户评论/新文件 → createJob → handleGenerateProposal → LLM API → 返回 JSON 纯文本
                                                                        ↓
用户点"生成 Patch" → createJob → handleGeneratePatch → LLM API → 返回 JSON patch
                                                                        ↓
用户审批 → createJob → handleApplyPatch → executePatch（系统代码执行文件操作）
```

模型只能做内容理解与结构化输出，**不能执行文件操作、搜索 Vault、多步推理**。每次调整都需要用户评论 → AI 重新生成 → 审批的长周期循环。

### 1.2 目标

让 PKWS 的 AI 具备在本地执行文本编辑和调用工具的能力，同时保持 PKWS 对 Agent 上下文的完全控制。

### 1.3 参考项目

| 项目 | 角色 | 核心设计 |
|------|------|---------|
| [Pi](https://github.com/earendil-works/pi) | Agent Toolkit | Agent Loop、工具执行管线、Extension 系统 |
| [Holon](https://github.com/holon-run/holon) | Agent Workbench | 后台进程持久化、WorkItem 模型、上下文压缩、WaitFor 恢复 |

---

## 2. 设计结论

**PKWS 不内建 Agent Runtime，而是通过调用本地 Codex CLI / Claude Code CLI 并动态控制其上下文来实现 Agent 能力。**

### 2.1 关键决策

| 决策 | 选型 | 理由 |
|------|------|------|
| Agent 执行方式 | 调用本地 CLI（Codex / Claude Code） | PKWS 不需要自己实现 Agent Loop、工具执行、function calling |
| 上下文控制 | PKWS 动态生成 CLAUDE.md / AGENTS.md | CLI 自动读取项目根目录的上下文文件 |
| 进程模型 | PKWS Worker spawn CLI 子进程，等待输出 | 比常驻 Agent Runtime 更简单，不需要处理进程保活 |
| 输出捕获 | CLI 直接修改工作目录文件 / 输出结构化 JSON | PKWS 读取输出文件，更新 Case 状态 |

### 2.2 与参考项目的对比

| 维度 | PKWS 方案 | Pi | Holon |
|------|-----------|-----|-------|
| Agent Runtime | **不内建**，依赖外部 CLI | 自建完整 Agent Loop | 自建完整 Agent Runtime |
| 上下文管理 | PKWS 通过 CLI 上下文文件注入 | 自有 Context 管理 | SQLite 事件存储 + 压缩 |
| 工具执行 | CLI 自带（文件编辑、Shell、搜索） | 自定义工具注册 | 自定义工具注册 |
| 权限控制 | PKWS 通过 CLI 工作目录范围限制 | Extension hook | Trust Boundary |
| 开发成本 | **低（1-2天）** | 高（2-4周集成） | 高（Rust→TS 翻译） |

---

## 3. 架构设计

### 3.1 整体流程

```
PKWS Server (Fastify)
│
├─ Web UI ── 用户操作
│
└─ Agent Scheduler (新增模块)
    │
    ├─ 从 SQLite 读取 Case 上下文
    ├─ 动态生成 CLAUDE.md / AGENTS.md
    ├─ 创建工作目录
    ├─ spawn CLI 子进程
    │   │
    │   └─ Codex / Claude Code CLI
    │       ├─ 读取 CLAUDE.md 作为指令
    │       ├─ 使用自带工具（文件编辑、搜索、Shell）
    │       ├─ 输出到指定目录 / 修改文件
    │       └─ 退出
    │
    ├─ 读取输出
    └─ 更新 Case 状态
```

### 3.2 Agent Scheduler 模块

新增 `packages/agent-scheduler/` 包：

```
packages/agent-scheduler/
├── index.ts              # 导出
├── scheduler.ts          # 调度器主循环
├── context-builder.ts    # 从 SQLite 构建 CLI 上下文
├── cli-runner.ts         # spawn CLI 并管理生命周期
├── output-parser.ts      # 读取 CLI 输出并结构化
└── types.ts              # 类型定义
```

### 3.3 上下文控制机制

PKWS 生成的上下文文件示例：

```markdown
# CLAUDE.md — 由 PKWS 自动生成

## PKWS Case Context

### Case 目标
整理这篇关于 AI Agent 的文章，确定其价值和处理方式。

### Workspace Rules（用户长期偏好）
- 工具类文章默认放到 `资源库/工具/`
- 网页收藏必须保留 `source_url` 和 `captured_at`
- 技术文章整理格式：摘要 / 核心观点 / 可执行清单
- 不自动删除原始剪藏

### Case Instructions（本次 Case 特定，优先级高于 Workspace Rules）
- 先补充调研，不要直接合并到正式笔记
- 保留原文中所有的工具链接
- 输出格式：摘要 / 关键观点 / 待确认问题

### 输出要求
1. 将分析结果写入 `output/proposal.json`
2. 格式遵循：`{ title, summary, valueJudgement, suggestedActions[], reasoningSummary }`
3. 如需生成文件操作，输出到 `output/patch-operations.json`
```

### 3.4 CLI 调用

```typescript
// cli-runner.ts 核心逻辑
interface CliRunnerOptions {
  cliPath: string;         // 'codex' | 'claude'
  workDir: string;         // PKWS 创建的隔离工作目录
  taskPrompt: string;      // 任务描述
  timeoutMs: number;       // 超时
  envVars?: Record<string, string>;
}

async function runCliAgent(options: CliRunnerOptions): Promise<CliResult> {
  const { cliPath, workDir, taskPrompt, timeoutMs, envVars } = options;

  const child = spawn(cliPath, ['--print', taskPrompt], {
    cwd: workDir,
    env: {
      ...process.env,
      ...envVars,
      // 限制 CLI 的工具范围
      CLAUDE_CODE_ALLOWED_PATHS: workDir,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: timeoutMs,
    shell: true,
  });

  return new Promise((resolve, reject) => {
    let output = '';
    child.stdout.on('data', (data) => { output += data; });
    child.on('close', (code) => {
      if (code === 0) {
        resolve({
          output,
          generatedFiles: readOutputFiles(workDir),
        });
      } else {
        reject(new Error(`CLI exited with code ${code}`));
      }
    });
  });
}
```

---

## 4. 工作目录结构

每个 Case 的 Agent 调用创建一个隔离工作目录：

```
/pkws/workspace/agents/case_xxx_yyyymmdd/
│
├── CLAUDE.md              ← PKWS 动态生成（上述上下文）
├── AGENTS.md              ← 同上（Codex 用）
├── context/               ← 只读上下文数据
│   ├── original-note.md   ← 原始剪藏文件
│   └── vault-structure.json  ← Vault 目录结构快照
│
├── vault/                 ← Vault 的只读镜像（可选，用于搜索）
│   └── ...
│
├── output/                ← CLI 的输出目录
│   ├── proposal.json      ← AI 的分析建议
│   └── patch-operations.json  ← 文件操作（如需）
│
└── .gitignore             ← 防止意外提交
```

---

## 5. 与现有 PKWS 模块的集成

### 5.1 替换现有的 AI 调用

现在的 `packages/ai/src/index.ts`：

```typescript
// 现有：直接调 LLM API
export async function generateProposal(input, caseId) {
  const result = await generateObject({ schema, model, prompt });
  return result.object;
}
```

改为：

```typescript
// 改为：通过 Agent Scheduler 调用本地 CLI
export async function generateProposal(input, caseId) {
  if (config.useLocalAgent) {
    return await agentScheduler.runAgent({
      caseId,
      taskType: 'generate_proposal',
      context: input,
      cli: config.localCliPath, // 'codex' | 'claude'
    });
  }
  // 回退：直接调 LLM API（原来的逻辑）
  return await legacyGenerateProposal(input, caseId);
}
```

### 5.2 新增 Agent Job 类型

```typescript
// job-queue.ts 增加类型
type JobType =
  | 'scan_inbox'
  | 'generate_proposal'
  | 'generate_patch'
  | 'apply_patch'
  | 'rollback_apply'
  | 'run_agent';  // ← 新增：运行 Agent 任务
```

### 5.3 Web UI 改动

Agent 运行状态展示：

```text
Case Detail:
  ...
  Agent Status: [Running / Completed / Failed]
  Agent Output: [查看 AI 的工作成果]
  [停止 Agent] [重新运行]
```

---

## 6. 安全边界

| 风险 | 控制措施 |
|------|---------|
| CLI 访问不该访问的文件 | 限制工作目录范围；CLI 只拿到 output/ 和 context/ |
| CLI 执行危险命令 | 工作目录隔离；PKWS 不传递用户 Shell 命令 |
| CLI 超时无响应 | spawn 时设 timeout，超时 kill |
| 上下文泄露 | CLAUDE.md 只包含必要的 Case 信息，不包含 API Key 等敏感信息 |
| 输出格式异常 | output-parser.ts 用 Zod schema 校验输出 JSON，无效则重试或报错 |

---

## 7. 落地计划

### Phase 1：快速验证（1-2天）

1. 创建 `packages/agent-scheduler/` 包
2. 实现 `context-builder.ts`：从 SQLite 生成 CLAUDE.md
3. 实现 `cli-runner.ts`：spawn CLI 并等待输出
4. 实现 `output-parser.ts`：读取 proposal.json 并更新 Case
5. 在 `handlers.ts` 中增加 `handleRunAgent` handler
6. 端到端测试：用户评论 → Agent 运行 → 输出 Proposal → UI 展示

### Phase 2：完善与稳定（3-5天）

1. 支持 Patch 生成模式（CLI 输出 patch-operations.json）
2. 超时重试机制
3. 多 CLI 后端支持（Codex / Claude Code 可切换）
4. Agent 运行日志
5. 错误恢复

### Phase 3：优化（更长期）

1. Agent 运行状态实时推送到 Web UI（WebSocket）
2. 支持流式输出展示
3. 缓存 CLAUDE.md 模板
4. 性能优化

---

## 8. 非目标

- PKWS 不内建 Agent Loop（依赖 CLI 自带）
- PKWS 不做 function calling（依赖 CLI 自带）
- PKWS 不管理 CLI 的安装和升级（用户自行安装）
- PKWS 不提供沙箱环境（CLI 在隔离工作目录中运行）
