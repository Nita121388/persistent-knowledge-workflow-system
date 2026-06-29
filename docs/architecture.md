# 持续知识工作流系统总体架构设计

> 版本：v0.3
> 状态：架构草案
> 阶段：MVP 架构设计
> 更新日期：2026-06-27

## 1. 架构目标

MVP 架构要回答两个层面的问题：

1. 产品运行时由哪些可见组件组成。
2. 这些组件内部如何支撑 Case、Proposal、Patch、Snapshot、Rollback 等领域能力。

MVP 必须满足：

- 复用 Obsidian Web Clipper，不重复建设网页剪藏能力。
- 提供一个清晰的 Web 前端，让用户查看 Proposal、审批 Patch、执行 Rollback。
- 提供一个本地后端服务，统一管理 Case、AI、文件监听、Vault 写入和系统配置。
- 提供后台 Worker，让 AI 分析、Patch 生成、Apply、Rollback 等任务异步执行。
- 提供 AI 配置能力，让用户配置 Provider、Model、Key、默认策略和安全边界。
- 用 Knowledge Anchor 连接 Obsidian 笔记与系统侧复杂关系。
- 保证系统对 Vault 的写入可预览、可审计、可回滚。

## 2. MVP 产品形态

MVP 采用本地优先架构。

用户机器上运行一个 PKWS 本地应用，它包含：

```text
PKWS Local App
  - Web Console Frontend
  - Local Backend API Service
  - Background Worker
  - File Watcher
  - AI Gateway
  - Workspace / Backup Storage
  - Optional Staging for generated content preview
```

浏览器侧采集入口优先使用官方 Obsidian Web Clipper。

Obsidian 侧 MVP 先不强制开发完整伴侣插件，但架构预留 Obsidian Companion Plugin。

## 3. 产品运行时组件图

```text
+----------------------+          +---------------------------+
| Browser              |          | Obsidian                  |
|                      |          |                           |
| Obsidian Web Clipper |--------->| Vault Inbox Markdown      |
|                      |          | - clipped note            |
| PKWS Browser         |          | - optional pkws_id        |
| Companion (Phase 2)  |          |                           |
+----------------------+          +-------------+-------------+
                                                 |
                                                 | file watch / vault access
                                                 v
+---------------------------------------------------------------+
| PKWS Local App                                                |
|                                                               |
|  +--------------------+      +-----------------------------+  |
|  | Web Console        |<---->| Local Backend API Service   |  |
|  |                    |      |                             |  |
|  | Case List          |      | Case API                    |  |
|  | Case Detail        |      | Proposal / Patch API        |  |
|  | Proposal Review    |      | Approval API                |  |
|  | Patch Preview      |      | Rollback API                |  |
|  | Settings           |      | Settings API                |  |
|  +--------------------+      +-------------+---------------+  |
|                                            |                  |
|                                            v                  |
|  +---------------------------------------------------------+  |
|  | Background Worker                                      |  |
|  |                                                         |  |
|  | File Watcher -> Case Engine -> AI Workflow -> Proposal  |  |
|  | Approval -> Vault Safety -> Snapshot / Rollback         |  |
|  +-------------------------+-------------------------------+  |
|                            |                                  |
|                            v                                  |
|  +--------------------+  +----------------+  +-------------+ |
|  | Workspace Store    |  | Staging Store  |  | AI Gateway  | |
|  | cases / events     |  | drafts         |  | providers   | |
|  | anchors / patches  |  | raw copies     |  | models      | |
|  | memory / rules     |  | preview files  |  | policies    | |
|  | settings           |  |                |  |             | |
|  +--------------------+  +----------------+  +-------------+ |
|                                                               |
+---------------------------------------------------------------+
                                                 |
                                                 | safe apply / rollback
                                                 v
                                      +----------+-----------+
                                      | Obsidian Vault       |
                                      | final clean notes    |
                                      +----------------------+
```

## 4. 组件职责概览

| 组件 | MVP 是否必需 | 主要职责 |
| --- | --- | --- |
| Obsidian Web Clipper | 必需 | 浏览器侧网页捕获、内容提取、生成 Markdown |
| PKWS Web Console | 必需 | Case 列表、详情、Proposal、Patch、审批、回滚、设置 |
| PKWS Local Backend API Service | 必需 | 为前端和集成入口提供统一 API |
| PKWS Background Worker | 必需 | 异步执行 AI 分析、Proposal 生成、按需 Patch、Apply、Rollback |
| PKWS File Watcher | 必需 | 监听 Vault Inbox，发现 Clipper 新笔记 |
| PKWS AI Gateway | 必需 | 管理 AI Provider、模型、Key、调用策略 |
| PKWS Workspace Store | 必需 | 保存 Case、事件、Anchor、配置、Proposal、Patch |
| PKWS Staging Store | 可选 | 仅在用户要求生成内容 Patch 时保存草稿和预览内容 |
| PKWS Snapshot Store | 必需 | 保存 Apply 前快照与回滚 Manifest |
| Obsidian Companion Plugin | 延后 | Obsidian 内状态卡、快捷批注、Case 选择 |
| PKWS Browser Companion | 延后 | 浏览器中增强采集入口，不替代官方 Clipper |

## 5. 浏览器侧架构

### 5.1 MVP：复用 Obsidian Web Clipper

MVP 不自研完整浏览器剪藏插件。

用户使用官方 Obsidian Web Clipper 保存网页到 Vault 的指定 Inbox 目录。

PKWS 通过 File Watcher 发现新文件，并创建 Case。

```text
网页
  -> Obsidian Web Clipper
  -> Vault/Inbox/Web Clips/*.md
  -> PKWS File Watcher
  -> Case Created
```

### 5.2 推荐 Clipper 配置

MVP 需要给用户提供一套推荐 Clipper 模板或配置说明。

目标是尽可能稳定地得到：

- title
- url
- captured_at
- source
- author
- description
- tags
- raw clipped content

如果 Clipper 模板允许写入固定字段，可以让其预留：

```yaml
---
pkws_id:
source_url: "{{url}}"
captured_at: "{{date}}"
---
```

如果不适合由 Clipper 写入 `pkws_id`，则由 PKWS 在发现文件后补写最小 `pkws_id`。

### 5.3 Phase 2：PKWS Browser Companion

后续可以做一个很薄的浏览器伴侣插件。

它不负责网页正文提取，也不替代 Obsidian Web Clipper。

它只负责：

- 向 PKWS 本地后端发送当前网页 URL 与用户意图。
- 打开对应 Case。
- 显示该网页是否已有 Knowledge Anchor。
- 提供“收藏后进入 PKWS Review”的快捷入口。

## 6. 前端架构

### 6.1 Web Console 是主交互界面

MVP 的主界面是 Web Console。

它是用户的决策台，不是聊天窗口。

核心页面：

```text
Dashboard
  - Inbox
  - Review
  - Active
  - Closed

Case Detail
  - Case Summary
  - Knowledge Anchor
  - Source Artifact
  - AI Proposal
  - Patch Preview
  - Timeline
  - Approval Actions
  - Snapshot / Rollback

Settings
  - Vault 配置
  - Inbox 配置
  - AI Provider 配置
  - Model 配置
  - Apply 安全策略
  - Obsidian Web Clipper 集成说明
```

### 6.2 前端职责

Web Console 负责：

- 展示当前队列。
- 展示 AI Proposal。
- 展示 Patch Preview。
- 发起 Approve、Reject、Comment、Drop。
- 发起 Apply 或 Rollback。
- 配置 Vault、AI、模型和安全策略。

Web Console 不负责：

- 直接访问 Vault 文件系统。
- 直接调用 AI Provider。
- 直接执行 Patch。

所有敏感操作都通过 Local Backend API。

## 7. 后端服务架构

### 7.1 Local Backend API Service

本地后端服务是 Web Console、Obsidian 插件、浏览器伴侣插件和后台 Worker 的统一协调层。

它提供：

- Case API
- Knowledge Anchor API
- Proposal API
- Patch API
- Approval API
- Rollback API
- Settings API
- Integration API

### 7.2 API Service 的边界

API Service 负责接收请求、校验权限、读写 Workspace、派发任务。

它不直接长时间执行 AI 分析或大文件操作。

长任务交给 Background Worker。

## 8. 后台 Worker 架构

Background Worker 负责异步任务。

MVP 任务类型：

- 监听 Inbox 新文件。
- 创建 Artifact 与 Case。
- 调用 AI 生成 Proposal。
- 在用户创建 Patch Intent 后按需生成 Patch。
- 根据用户审批执行 Apply。
- 创建 Snapshot。
- 执行 Rollback。
- 处理失败并将 Case 转为 Need Review。

```text
API / Watcher Event
  -> Job Queue
  -> Worker
  -> Domain Service
  -> Workspace Event
```

MVP 可以先使用本地轻量任务队列，但架构上应保留队列语义，避免把长任务绑在 HTTP 请求中。

## 9. AI 配置架构

### 9.1 AI Gateway

AI Gateway 是系统访问模型的唯一入口。

它负责：

- 管理 Provider。
- 管理模型。
- 管理 API Key 或本地模型地址。
- 管理默认任务模型。
- 管理调用超时、重试、费用提示和日志。
- 把模型输出转换为系统结构化结果。

### 9.2 MVP AI 配置项

Settings 中至少需要：

```text
AI Provider
  - provider name
  - base url
  - api key
  - default model

Task Model Mapping
  - analysis model
  - proposal model
  - drafting model
  - patch planning model

Safety
  - 是否允许自动分析
  - 是否允许用户请求后生成 Patch Preview
  - 是否允许低风险自动 Apply
  - 单次最大 token / 费用限制
```

MVP 建议：

- 允许自动分析。
- 允许自动生成 Proposal。
- 不默认自动生成内容 Patch，Patch 由用户选择具体动作后按需生成。
- 不允许自动 Apply。

### 9.3 AI 输出边界

AI 只能输出：

- Analysis Result
- Proposal
- Draft
- Patch Plan（仅在用户选择 Move / Enrich / Generate Formal Note 等动作后生成）

AI 不允许直接写 Vault。

所有写入必须经过 Approval 与 Vault Safety Layer。

## 10. Obsidian 集成架构

### 10.1 MVP：文件系统集成

MVP 通过文件系统与 Obsidian 集成：

```text
Obsidian Web Clipper -> Vault 文件
PKWS File Watcher -> 发现新文件
PKWS Vault Safety Layer -> 写入最终文件
```

### 10.2 `pkws_id` 写入策略

笔记中只写入最小身份锚点：

```yaml
---
pkws_id: kw_20260627_x7f3a
---
```

复杂关系不写入笔记。

### 10.3 Phase 2：Obsidian Companion Plugin

后续插件负责：

- 读取当前笔记 `pkws_id`。
- 展示轻量 Case 状态。
- 添加批注。
- 多 Case 选择。
- 打开 Web Console 对应 Case。

插件不负责：

- 展示完整 Patch。
- 修改系统复杂关系。
- 把 Proposal / Timeline 写入正文。

## 11. 存储架构

### 11.1 Vault

用户知识库。

MVP 采用 Vault-first 内容流：Obsidian Web Clipper 生成的原始 Markdown 直接落地到 Vault Inbox，PKWS 将其作为受管笔记。

Vault 保存：

- Clipper 原始 Markdown。
- 必要的最小 `pkws_id`。
- 用户批准后的移动、Frontmatter 更新、摘要追加或新正式笔记。

不保存：

- AI 草稿。
- Proposal。
- Patch。
- Timeline。
- Snapshot。
- 系统任务状态。

### 11.2 Workspace

系统数据区。

保存：

- Case 当前状态。
- Timeline 事件。
- Knowledge Anchor 关系。
- Case Instruction Summary。
- Workspace Rules。
- Proposal。
- Patch。
- Approval。
- AI 配置。
- Vault 配置。
- Clipper 集成配置。

### 11.3 Staging

系统暂存区。

MVP 默认不把 Clipper 原始笔记复制到 Staging 重新处理。

Staging 只在以下场景按需使用：

- 用户要求 AI 生成正式笔记。
- 用户要求追加摘要或结构化段落。
- Patch Preview 需要保存待写入内容。

保存：

- AI 中间草稿。
- 待预览内容。
- Patch 引用内容。

### 11.4 Snapshot

回滚安全区。

保存：

- Apply 前受影响文件备份。
- 文件存在性。
- 原路径。
- 内容摘要。
- 回滚 Manifest。

## 12. 核心数据流

### 12.1 收藏进入系统

```text
1. 用户在浏览器中使用 Obsidian Web Clipper
2. Clipper 保存 Markdown 到 Vault Inbox
3. File Watcher 发现新文件
4. Backend 读取 Frontmatter 和内容
5. Knowledge Anchor Manager 读取或写入 pkws_id
6. Case Engine 创建 Case
7. Worker 触发 AI 分析
8. Proposal 生成
9. Case 进入 ReviewRequired
10. Web Console 显示到 Review 队列
```

### 12.2 用户审批并应用

```text
1. 用户在 Web Console 打开 Case
2. 查看 Proposal
3. 用户选择 Mark Done / Drop / Move / Enrich / Generate Formal Note
4. 如果动作需要修改 Vault，系统生成 Patch Preview
5. 用户点击 Approve & Apply
6. API Service 记录审批事件
7. Worker 调用 Vault Safety Layer
8. 创建 Snapshot
9. 执行 Patch
10. 更新 Workspace Mapping
11. Case 进入 Done
```

### 12.3 用户批注

MVP 主路径：

```text
1. 用户在 Web Console Case Detail 中添加 Comment
2. Case Engine 记录 Timeline 事件
3. Worker 根据批注重新生成 Proposal
```

Phase 2 Obsidian 路径：

```text
1. 用户在 Obsidian 打开笔记
2. Companion Plugin 读取 pkws_id
3. 查询 Backend 关联 Case
4. 用户输入批注
5. 如果多个活跃 Case，选择目标 Case
6. 批注进入 Timeline
```

## 13. MVP 架构范围

MVP 必须包含：

- 官方 Obsidian Web Clipper 集成说明与模板建议。
- PKWS Web Console。
- PKWS Local Backend API Service。
- PKWS Background Worker。
- File Watcher。
- AI Gateway 与 AI Settings。
- Case / Proposal / Patch / Approval / Snapshot / Rollback 领域能力。
- Case Instruction Summary 与手动 Workspace Rules。
- Workspace / Backup 存储。
- 按需 Staging，用于 AI 生成内容 Patch 的预览。

MVP 暂不包含：

- 自研完整浏览器剪藏插件。
- Obsidian Companion Plugin。
- 云端账号系统。
- 多 Vault 同步。
- 多 Agent 协作。
- 外部系统集成。
- 自动长期记忆学习。
- Project Memory。
- 向量数据库记忆。

## 14. 架构风险

### 14.1 产品组件边界模糊

风险：用户不知道该去浏览器、Obsidian 还是 Web Console 操作。

应对：MVP 明确分工：浏览器负责收藏，Web Console 负责决策，Obsidian 负责阅读和最终知识承载。

### 14.2 AI 配置复杂

风险：用户配置 Provider、模型、Key 时感到复杂。

应对：提供默认配置向导，高级配置折叠。

### 14.3 Vault 污染

风险：Proposal、Patch、Timeline 写入 Vault。

应对：Vault 只允许最终内容和最小 `pkws_id`。

### 14.4 长任务阻塞界面

风险：AI 分析或 Apply 阻塞前端请求。

应对：所有长任务由 Background Worker 执行，前端只观察任务状态。

## 15. 下一步

下一步在模块设计中把产品组件拆成：

- 可见产品组件。
- 后端服务模块。
- Worker 任务模块。
- AI 配置模块。
- 领域模块。
- 存储模块。
