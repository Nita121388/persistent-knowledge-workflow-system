# 持续知识工作流系统模块设计

> 版本：v0.3
> 状态：模块设计草案
> 阶段：MVP 模块设计
> 更新日期：2026-06-27

## 1. 模块设计目标

模块设计需要同时表达两层结构：

1. 产品级组件：用户能感知到的浏览器、前端、后端、Worker、AI 设置、Obsidian 集成。
2. 领域级模块：支撑 Case、Proposal、Patch、Snapshot、Rollback 的内部能力。

MVP 的运行闭环：

```text
Obsidian Web Clipper
  -> Vault Inbox
  -> PKWS File Watcher
  -> Case Created
  -> AI Proposal
  -> Web Console Review
  -> Mark Done / Drop / Move / Enrich
  -> 按需 Patch
  -> Safe Apply
  -> Done / Rollback
```

## 2. 产品级组件总览

| 产品组件 | MVP 是否必需 | 用户是否感知 | 核心职责 |
| --- | --- | --- | --- |
| Obsidian Web Clipper | 必需 | 是 | 网页捕获，生成 Markdown 到 Vault |
| PKWS Web Console | 必需 | 是 | 查看 Case、Proposal、Patch，审批、评论、回滚、配置 |
| PKWS Local Backend API | 必需 | 间接 | 提供前端、Worker、未来插件统一 API |
| PKWS Background Worker | 必需 | 间接 | 异步执行 AI Proposal、按需 Patch、Apply、Rollback |
| PKWS File Watcher | 必需 | 否 | 监听 Vault Inbox 新笔记 |
| PKWS AI Gateway | 必需 | 配置时感知 | 管理 AI Provider、Model、Key、调用策略 |
| PKWS Memory Service | 必需 | 是 | 管理 Case Instruction Summary 和 Workspace Rules |
| PKWS Workspace Store | 必需 | 否 | 保存系统数据和配置 |
| PKWS Staging Store | 可选 | 否 | 仅在生成内容 Patch 时保存 AI 草稿和预览内容 |
| PKWS Snapshot Store | 必需 | 回滚时感知 | 保存 Apply 前快照 |
| Obsidian Companion Plugin | 延后 | 是 | Obsidian 内状态卡、快捷批注、多 Case 选择 |
| PKWS Browser Companion | 延后 | 是 | 浏览器侧增强入口，不替代官方 Clipper |

## 3. 浏览器侧组件

### 3.1 Obsidian Web Clipper

MVP 直接复用官方 Obsidian Web Clipper。

职责：

- 捕获网页内容。
- 提取网页正文。
- 应用用户的 Clipper 模板。
- 保存 Markdown 到 Obsidian Vault。

PKWS 对它的要求：

- 建议用户把收藏保存到固定 Inbox 目录。
- 建议模板保留 source_url、title、captured_at 等元信息。
- 可以预留空的 `pkws_id` 字段，但不是强制。

不做：

- 不要求官方 Clipper 理解 Case。
- 不要求官方 Clipper 直接调用 PKWS。

### 3.2 PKWS Browser Companion（Phase 2）

MVP 不做。

后续职责：

- 检查当前网页是否已有 Knowledge Anchor。
- 向 PKWS 创建采集意图。
- 打开对应 Case。
- 提供“收藏后进入 Review”的快捷入口。

边界：

- 不做网页正文提取。
- 不替代 Obsidian Web Clipper。

## 4. 前端组件：PKWS Web Console

Web Console 是 MVP 的主界面。

### 4.1 页面模块

MVP 页面：

| 页面 | 职责 |
| --- | --- |
| Dashboard | 展示 Inbox、Review、Active、Closed 队列 |
| Case Detail | 展示单个 Case 的完整上下文 |
| Proposal Review | 展示 AI 整理提案 |
| Patch Preview | 仅在用户选择需要修改 Vault 的动作后，展示将影响哪些 Vault 文件 |
| Timeline | 展示事件历史和用户评论 |
| Rollback Confirm | 展示回滚范围和确认操作 |
| Settings | 配置 Vault、Inbox、AI Provider、模型、安全策略、Workspace Rules |

### 4.2 前端不负责

Web Console 不直接：

- 修改 Vault 文件。
- 调用 AI Provider。
- 执行 Patch。
- 写 Snapshot。
- 监听文件系统。

这些操作全部通过 Local Backend API 和 Worker 完成。

### 4.3 核心前端交互

- 打开 Review 队列。
- 查看 Proposal。
- 查看 Patch Preview。
- 添加 Comment。
- Approve / Approve & Apply。
- Reject / Drop。
- Request Rollback。
- 修改 AI 设置。

## 5. 后端组件：PKWS Local Backend API

Local Backend API 是系统协调层。

### 5.1 API 模块

| API 模块 | 职责 |
| --- | --- |
| Case API | Case 列表、详情、状态查询 |
| Knowledge Anchor API | `pkws_id` 查询、绑定、路径关系 |
| Proposal API | Proposal 查询、重新生成请求 |
| Patch API | Patch 查询、预览、校验 |
| Approval API | Approve、Reject、Comment、Drop |
| Rollback API | 查询 Snapshot、请求回滚 |
| Settings API | Vault、Inbox、AI、模型、安全策略、Workspace Rules 配置 |
| Integration API | 未来给 Obsidian 插件和浏览器插件调用 |

### 5.2 API Service 不负责

API Service 不直接执行长任务。

它负责：

- 参数校验。
- 权限和安全策略校验。
- 读写 Workspace。
- 投递 Worker 任务。
- 返回任务状态。

长任务包括：

- AI 分析。
- Patch 生成。
- Vault Apply。
- Rollback。
- 大文件扫描。

## 6. 后台组件：Background Worker

Background Worker 是 MVP 的异步执行中心。

> Phase 2 起，Agent Runtime 与 Worker 共享常驻进程，Worker 负责短周期任务（scan、apply、rollback），Agent Runtime 负责多 Case Agent 调度。详见 [agent/agent-runtime.md](agent/agent-runtime.md)。

### 6.1 Worker 任务类型

| 任务 | 触发来源 | 输出 | 说明 |
| --- | --- | --- | --- |
| Scan Inbox | File Watcher / 手动刷新 | 新 Artifact / Case | |
| Create Case From Clip | 新 Markdown | Case Created | |
| Analyze Artifact | Case Created / Comment | Analysis Result | |
| Generate Proposal | Analysis Result | Proposal | Phase 2 迁移到 Agent Runtime |
| Generate Patch | 用户选择 Move / Enrich / Generate Formal Note | Patch | Phase 2 迁移到 Agent Runtime |
| Run Agent | 用户评论 / 系统调度 | Case 状态更新 | Phase 2 新增，由 Agent Runtime 接管 |
| Apply Patch | 用户批准具体 Patch | Vault 修改 + Snapshot | |
| Rollback Patch | Request Rollback | Vault 恢复 | |
| Reconcile Path | 文件路径变化 | Mapping 更新或 Need Review | |

### 6.2 Worker 原则

- Worker 所有关键动作都写 Timeline 事件。
- Worker 失败不能静默，需要让 Case 进入可见错误或 Need Review 状态。
- Worker 不能绕过 Vault Safety Layer 写入 Vault。

## 7. 文件监听组件：File Watcher

File Watcher 负责发现 Obsidian Web Clipper 的新输出。

### 7.1 监听范围

MVP 监听用户配置的 Inbox 目录，例如：

```text
Vault/Inbox/Web Clips/
```

### 7.2 触发条件

- 新增 Markdown 文件。
- 文件稳定后再读取，避免 Clipper 尚未写完。
- 可选：手动刷新扫描。

### 7.3 输出

File Watcher 输出 Scan Inbox 任务，由 Worker 处理。

File Watcher 不直接创建 Case。

## 8. AI 配置组件：AI Gateway

AI Gateway 是 AI 访问统一入口。

### 8.1 Provider 配置

用户在 Settings 中配置：

```text
Provider Name
Base URL
API Key
Default Model
```

### 8.2 任务模型映射

不同任务可以使用不同模型：

```text
Analysis Model
Proposal Model
Drafting Model
Patch Planning Model
```

MVP 可以默认都使用同一个模型，但界面和配置模型要预留拆分。

### 8.3 安全策略

AI 设置需要包含：

- 是否允许自动分析。
- 是否允许用户请求后自动生成 Patch Preview。
- 是否允许自动 Apply。
- 单次最大 Token。
- 单次最大费用提示。
- 调用失败重试次数。

MVP 推荐默认：

```text
自动分析：开启
自动生成 Proposal：开启
用户请求后生成 Patch Preview：开启
自动 Apply：关闭
```

### 8.4 AI 输出边界

MVP 阶段 AI Gateway 只能返回结构化结果，不能直接调用文件系统写 Vault。

**Phase 2 Agent Runtime 启用后**，AI 通过 CLI 子进程执行文件操作，但受以下约束：

- CLI 只能在 PKWS 分配的隔离工作目录中操作
- 对 Vault 的写入仍走 Patch → Preview → Approve → Apply 审批链
- Agent 的任何文件修改必须在 Apply 前生成可预览的 Patch Manifest

## 9. Obsidian 集成组件

### 9.1 MVP：文件系统集成

MVP 与 Obsidian 的集成方式是文件系统。

```text
Clipper 保存 Markdown
PKWS 监听 Markdown
PKWS 安全写入最终 Markdown
```

### 9.2 `pkws_id` 策略

PKWS 可以在用户授权下给笔记写入：

```yaml
---
pkws_id: kw_20260627_x7f3a
---
```

只写这个最小字段。

不写：

- Case ID。
- Case 列表。
- 角色。
- Proposal。
- Timeline。

### 9.3 Obsidian Companion Plugin（Phase 2）

后续插件模块：

| 子模块 | 职责 |
| --- | --- |
| Status Card | 展示当前笔记关联状态 |
| Annotation Input | 快捷批注 |
| Case Selector | 多 Case 时选择目标 |
| Open Console | 打开 Web Console 对应 Case |
| Anchor Binder | 无 `pkws_id` 时绑定或创建知识对象 |

## 10. 存储模块

### 10.1 Workspace Store

保存系统真相数据。

内容：

- Case。
- Timeline Event。
- Knowledge Anchor。
- Proposal。
- Patch。
- Approval。
- Settings。
- AI 配置。
- Vault 配置。
- Mapping。

### 10.2 Staging Store

保存按需生成的内容中间态。

MVP 默认不复制 Clipper 原始笔记，也不默认生成整理后 Markdown。

只有在用户选择 Enrich / Generate Formal Note 等动作时才使用 Staging。

内容：

- AI 草稿。
- 预览 Markdown。
- Patch 引用内容。

### 10.3 Snapshot Store

保存回滚所需数据。

内容：

- Apply Manifest。
- 受影响文件备份。
- 文件 hash。
- 原路径。
- 回滚状态。

## 11. 领域模块

领域模块是后端和 Worker 内部能力。

| 领域模块 | 所属组件 | 职责 |
| --- | --- | --- |
| Case Engine | Backend / Worker | 管理 Case 生命周期和状态机 |
| Timeline Engine | Backend / Worker | 记录事件和审计日志 |
| Knowledge Anchor Manager | Backend / Worker | 管理 `pkws_id` 和关系查询 |
| Artifact Service | Worker | 管理捕获内容与原始副本 |
| Proposal Engine | Worker | 生成和规范化 AI 提案，默认不生成整理后 Markdown |
| Patch Engine | Worker | 在用户选择具体 Vault 修改动作后，生成结构化变更计划 |
| Approval Engine | Backend | 管理用户审批动作 |
| Vault Safety Layer | Worker | 校验并安全执行 Patch |
| Snapshot Engine | Worker | 创建 Apply 前快照 |
| Rollback Engine | Worker | 回滚系统造成的修改 |
| Settings Service | Backend | 管理配置 |
| Memory Service | Backend / Worker | 管理 Case Instruction Summary、Workspace Rules，并为 AI 提供记忆上下文 |
| Agent Runtime | Worker（常驻） | Phase 2 新增。常驻进程，内存中维护多 Case 上下文，调度本地 CLI 执行 Agent 任务。详见 [agent/agent-runtime.md](agent/agent-runtime.md) |

## 12. MVP 必做模块

第一阶段必须做：

1. Obsidian Web Clipper 集成说明和模板建议。
2. PKWS Web Console。
3. PKWS Local Backend API。
4. PKWS Background Worker。
5. File Watcher。
6. AI Gateway 和 Settings。
7. Workspace Store。
8. Snapshot Store。
9. 按需 Staging Store。
10. Case Engine。
11. Knowledge Anchor Manager。
12. Memory Service。
13. Proposal Engine。
14. Patch Engine。
15. Approval Engine。
16. Vault Safety Layer。
17. Snapshot / Rollback Engine。

第二阶段再做：

18. Agent Runtime（常驻 Agent 调度 + 多 Case 上下文管理）

1. Obsidian Companion Plugin。
2. PKWS Browser Companion。
3. 多 Case Obsidian 内选择器。
4. 路径漂移自动提示。
5. 批量审批。
6. Learned Memory。
7. Project Memory。

## 13. MVP 最小页面清单

Web Console MVP 页面：

```text
/dashboard
/cases/:caseId
/cases/:caseId/proposal
/cases/:caseId/patch
/cases/:caseId/timeline
/settings
/settings/ai
/settings/vault
```

## 14. MVP 最小配置清单

系统初始化至少需要用户配置：

```text
Vault Path
Clipper Inbox Path
Workspace Path
Snapshot Path
Optional Staging Path
AI Provider
AI API Key
Default Model
Apply Safety Policy
Workspace Rules
```

## 15. 关键设计结论

MVP 不是一个单纯的前端页面，也不是一个简单脚本。

它应该是一个本地优先的产品系统：

```text
官方 Obsidian Web Clipper + PKWS Web Console + Local Backend + Worker + AI Gateway + Vault Safety Layer
```

其中：

- 浏览器负责收藏。
- Web Console 负责决策。
- Backend 负责协调。
- Worker 负责异步执行。
- AI Gateway 负责模型接入。
- Vault Safety Layer 负责安全写入。
- Obsidian Vault 只保存最终知识和最小 `pkws_id`。
