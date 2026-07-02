# PKWS Agent Runtime 交接文档

> 版本：v0.2
> 目的：将 Agent Runtime Phase 1 + Phase 2 开发成果交接给下一个 Agent
> 当前状态：Phase 1（基础 Runtime）+ Phase 2（完整上下文管理）已完成

---

## 1. 项目概览

PKWS（Persistent Knowledge Workflow System）是一个本地运行的 AI 知识整理工作流系统，对接 Obsidian Vault 和 Web Clipper。

当前代码库已完成：
- MVP 核心闭环（Inbox Scan → Case → AI Proposal → Patch → Apply → Rollback）
- 短期优化：Worker 常驻 + 内存 `Map<caseId, messages>` 上下文缓存
- **Agent Runtime Phase 1**：独立 `packages/agent-runtime/` 包、CaseSession 管理、context-builder、cli-runner、scheduler、Settings 集成、Server 集成
- **Agent Runtime Phase 2**：上下文压缩、暂停/恢复、SQLite 持久化、多 Case 调度、输出解析、Settings 上下文管理配置项
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

### 2.2 短期优化（已实现）

在当前 Worker 中增加了内存上下文缓存，不改架构：

- `apps/server/src/worker/handlers.ts` — `ConversationContext` + `caseContexts` Map + 上下文拼接
- `apps/server/src/worker/index.ts` — Worker 常驻（`isRunning` 标志）
- `apps/server/src/routes/cases.ts` — comment 传递 `comment` 到 job payload
- `packages/ai/src/index.ts` — `ProposalInput` 增加 `conversationHistory` 字段

### 2.3 Agent Runtime Phase 1（已完成：包结构 + 基础功能）

`packages/agent-runtime/` 完整结构：

```
packages/agent-runtime/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts              # 导出 + startAgentRuntime()
    ├── runtime.ts            # AgentRuntime 主类 + Lifecycle
    ├── session.ts            # CaseSession 类型 + SessionManager
    ├── context-builder.ts    # 从 CaseSession 构建 CLAUDE.md（含 Artifact 内容注入）
    ├── cli-runner.ts         # spawn CLI 子进程（--print 模式）
    ├── scheduler.ts          # 调度器：优先级队列 / decideAction / eviction
    ├── agent-detect.ts       # 自动检测本地 Agent（参考 Snorkeling paths.go）
    ├── output-parser.ts      # CLI 输出 Zod 校验（proposal.json / patch-operations.json）
    ├── output-writer.ts      # 解析结果写入 PKWS 数据库
    ├── persistence.ts        # SQLite agent_sessions 表封装
    └── types.ts              # 类型定义
```

关键设计决策：
- **不破坏现有回退路径**：`agentRuntimeEnabled` 默认 `false`，启用时走 Agent Runtime，关闭时回退到 Job Queue
- **CLI 自动检测**：检测 PATH 中的 Codex / Claude CLI，参考 Snorkeling 的 session 路径
- **隔离工作目录**：CLI 子进程在 `workspace/agents/{caseId}/` 中运行，只能读写 context/ 和 output/

### 2.4 Agent Runtime Phase 2（已完成：持久化 + 输出解析 + SQLite 恢复）

| 任务 | 状态 | 关键文件 |
|------|------|---------|
| 上下文压缩 | ✅ | `context-builder.ts` — `compressSession()` |
| 暂停/恢复 | ✅ | `scheduler.ts` — waitQueue + `awaitingUserInput` |
| SQLite 持久化 | ✅ | `persistence.ts` + `session.ts:persistSession()/restoreSession()` |
| 多 Case 调度 | ✅ | `scheduler.ts` — 优先级队列 + FIFO |
| 输出解析 | ✅ | `output-parser.ts` — Zod schema + `parseCliOutput()` |
| Settings 上下文管理 | ✅ | DB schema + Settings UI + API |

已完成的功能：
- 自动检测 Codex/Claude CLI（`agent-detect.ts`）
- Session 内存管理：`Map<caseId, CaseSession>` + LRU eviction（`session.ts`）
- CLAUDE.md 上下文构建：Action.NewTurn / Continue / CompressThenContinue（`context-builder.ts`）
- CLI 子进程管理：spawn + 超时 kill + 输出文件读取（`cli-runner.ts`）
- 调度器：优先级调度 + decideAction + eviction（`scheduler.ts`）
- Settings 集成：settings 表 + API + 前端 Agent Runtime tab
- Server 集成：`index.ts` 并行启动 + `cases.ts` comment 路由重定向
- 持久化：`SessionPersistence` 接口 + `agent_sessions` 表 + eviction 自动保存 + 恢复逻辑
- 输出解析：`parseCliOutput()` — Zod 校验 proposal.json / patch-operations.json
- 输出写入：`writeProposal()` / `writePatch()` — 写入 PKWS proposals/patch_manifests 表
- Case 数据注入：`loadCaseData()` — 从 SQLite 加载 artifact 内容到 CLAUDE.md

### 2.5 验证结果

```
Available agents: 2
 - Codex CLI path: C:\Users\chemclin\AppData\Roaming\npm\codex
 - Claude Code path: C:\Users\chemclin\AppData\Roaming\npm\claude

SessionManager: 创建/追加/eviction 全部正常
Persistence: eviction 自动持久化 + restore 恢复 正常
Context Builder: 正确注入 title/contentBody/sourceUrl/frontmatter
Output Parser: Zod 校验 proposal.json 正常
buildContext with caseData: 长度 613 chars，包含全部上下文
Runtime lifecycle: start → CLI 校验 → scheduler loop → stop → 全量持久化
```

---

## 3. 待开发：Agent Runtime Phase 3（更长期）

### 3.1 目标

让 Agent Runtime 具备完善的用户交互、状态可见性和健壮性。

### 3.2 具体任务

#### 3.3.1 Web UI Agent 状态展示（2-3 天）

在现有 Settings 的 Agent tab 基础上，增加一个专门的 **Agent Runtime Dashboard**：

```
├─ 状态卡片
│   ├─ 运行状态（Running / Stopped / Error）
│   ├─ 活跃会话数
│   ├─ 队列长度（pending / waiting）
│   └─ 当前处理的 Case
├─ 会话列表
│   ├─ 每个活跃 Case 的摘要
│   ├─ turnCount / messageCount / lastActiveAt
│   └─ awaitingUserInput 状态
├─ 操作按钮
│   ├─ [启动] / [停止]
│   └─ [清空所有会话]
```

需要：
- 新路由 `/agent-runtime/sessions` 返回完整 session 列表（含 messages 摘要）
- 前端 `/agent-runtime` 页面（可从 Settings 导航）
- `runtime.getStatus()` 返回 session 详情

#### 3.3.2 WebSocket 实时推送（2-3 天）

Agent Runtime 运行时状态变化实时推送到前端：

```typescript
// WebSocket 事件
type WsEvent =
  | { type: 'turn_started'; caseId: string; action: Action }
  | { type: 'turn_completed'; caseId: string; durationMs: number }
  | { type: 'turn_failed'; caseId: string; error: string }
  | { type: 'session_created'; caseId: string }
  | { type: 'session_evicted'; caseId: string }
  | { type: 'queue_update'; pending: number; waiting: number }
```

需要：
- `@fastify/websocket` 插件
- `agentRuntime` 订阅 WebSocket 广播
- 前端 React 组件监听 ws 事件更新 UI

#### 3.3.3 多 CLI 后端切换（1-2 天）

允许用户在 Settings 中切换默认 CLI 和查看已检测到的 Agent：

```
Settings → Agent Runtime
  ├─ 可用 Agent 列表：
  │   ✅ Codex CLI   路径：/usr/local/bin/codex
  │   ✅ Claude Code 路径：/usr/local/bin/claude
  │
  ├─ 默认 CLI：[Codex CLI ▼]  ← 下拉切换
  ├─ CLI 路径（可选覆盖）：[________________]
```

需要：
- 前端 `detectAvailableAgents()` API → 轮询显示列表
- 切换时重启 Runtime

#### 3.3.4 沙箱权限控制（1-2 天）

根据 `sandboxMode` 配置限制 CLI 子进程的访问范围：

| 模式 | 可读 | 可写 | 实现方式 |
|------|------|------|---------|
| `workspace-only` | `workspace/agents/{caseId}/context/` | `workspace/agents/{caseId}/output/` | 默认，目录白名单 |
| `vault-readonly` | Vault 文件 + workspace | `output/` | 文件复制到 context/ |
| `full` | 全部 | 全部 | 不限制 |

需要：
- `cli-runner.ts` 根据 sandboxMode 复制文件到 context/
- Settings UI 下拉选择

#### 3.3.5 错误恢复 + 重试（1 天）

- CLI 子进程崩溃后自动重试（最多 3 次）
- 持久化 session 恢复时的完整性检查
- 超过 maxTurnsPerCall 后中止并通知用户

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
| `packages/agent-runtime/` | Agent Runtime 完整包（11 个源文件） |
| `apps/server/src/index.ts` | 启动时初始化 Agent Runtime + 注入 persistence |
| `apps/server/src/routes/cases.ts` | comment 路由优先走 Agent Runtime 路径 |
| `apps/server/src/routes/settings.ts` | GET/PUT 支持 Agent Runtime 字段 |
| `apps/server/src/routes/agent-runtime.ts` | GET/DELETE session 管理 API |
| `apps/web/src/pages/Settings.tsx` | 新增 Agent Runtime tab（配置信息展示） |
| `packages/shared/src/index.ts` | Settings/SettingsUpdate 增加 Agent Runtime 字段 |
| `packages/shared/src/utils.ts` | SettingsUpdateSchema 增加 Agent Runtime 字段 |
| `packages/storage/src/schema.ts` | settings 表 + agent_sessions 表 |
| `packages/storage/drizzle/0001_agent_runtime_settings.sql` | settings 表迁移 |
| `packages/storage/drizzle/0002_agent_sessions_table.sql` | agent_sessions 表迁移 |

### 4.3 参考项目

| 项目 | 参考内容 |
|------|---------|
| Snorkeling (`E:/code/snorkeling/`) | `pkg/aisessions/paths.go` — Agent 检测路径 |
| Snorkeling | `pkg/aisessions/provider_codex.go` — Codex 会话格式 |
| Snorkeling | `pkg/aisessions/provider_claude.go` — Claude 会话格式 |

---

## 5. 注意事项

1. **不破坏现有回退路径**——Agent Runtime 启用时走新路径，关闭时回退到 Job Queue
2. **与短期优化代码的关系**——短期优化在 `handlers.ts` 中的 `caseContexts` 保留不动，Agent Runtime 启用时通过新路径调用
3. **CLI 权限控制**——CLI 子进程在隔离工作目录中运行，`sandboxMode` 控制文件访问范围
4. **类型检查**——当前代码库有一些预先存在的类型错误（Vercel AI SDK 版本不兼容、template literal types 等），改动时不要引入新错误
5. **WebSocket 事件**——Scheduler 的 event handler 已预留，可扩展为 WebSocket 广播
6. **持久化兼容性**——`agent_sessions` 表通过 migration 0002 创建，已有数据的系统需手动运行迁移
