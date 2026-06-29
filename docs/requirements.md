# 持续知识工作流系统 MVP 需求文档

> 版本：v0.2
> 状态：需求草案
> 阶段：MVP 需求定义
> 更新日期：2026-06-27

## 1. 背景

Obsidian Web Clipper 已经很好地解决了网页内容捕获、模板化保存和 Markdown 生成问题。用户可以快速把网页、文章、资料保存到 Obsidian Vault。

但网页收藏之后常见问题仍然存在：

- 收藏内容长期停留在 Inbox，没有后续处理。
- 用户不知道哪些内容值得精读、整理、合并或丢弃。
- AI 可以生成总结，但缺少任务生命周期、审批、回滚和审计。
- 如果直接让 AI 修改 Vault，用户会担心污染知识库。

因此，本系统不重复建设剪藏能力，而是在 Obsidian Web Clipper 之后补上知识工作流。

## 2. 产品定位

本系统是一个 Persistent Knowledge Workflow System。

它的核心对象不是 Chat，而是 Case。

每个 Case 表示一个持续的知识处理任务，从收藏进入系统开始，经过 AI 分析、用户审批、应用到 Vault，最终进入 Done、Drop 或 Archive。

## 3. MVP 目标

MVP 只验证一个核心闭环：

```text
网页收藏直接落地 Vault
  -> PKWS 写入最小 pkws_id
  -> 创建 Case
  -> AI 分析并生成 Proposal
  -> 用户 Review
  -> Done / Drop / Move / Enrich / Generate Formal Note
```

MVP 的成功标准：

- 用户可以把网页收藏转成一个 Case。
- 用户可以看到 AI 的整理建议。
- 用户可以在应用前预览会影响哪些文件。
- 用户可以 Approve、Reject、Comment、Drop 或 Mark Done。
- 系统默认不重写 Clipper 原始笔记内容。
- AI 默认只生成 Proposal，不默认生成整理后 Markdown。
- 只有用户选择 Move / Enrich / Generate Formal Note 等动作时，系统才生成 Patch。
- 系统只在用户批准具体 Patch 后写入 Vault。
- 系统造成的 Vault 修改可以回滚。
- Vault 中不出现半成品、临时文件或系统工作垃圾。

## 4. 非目标

MVP 阶段不做以下能力：

- 不自研完整网页剪藏插件。
- 不替代 Obsidian Web Clipper。
- 不做复杂多 Agent 协作。
- 不做 Obsidian 伴侣插件。
- 不做自动学习全局规则。
- 不做多 Vault 管理。
- 不集成 Notion、Readwise、Zotero、Google Drive 等外部系统。
- 不承诺恢复用户在系统外手动造成的任意 Vault 修改。

## 5. 用户故事

### 5.1 网页收藏后形成 Case

作为 Obsidian 用户，我希望每次网页收藏都可以进入一个待处理队列，而不是直接沉没在 Inbox 中。

系统需要把收藏内容识别为一个 Case，并记录来源、标题、捕获时间和初始内容。

### 5.2 AI 给出整理提案

作为用户，我希望 AI 帮我判断这条收藏应该如何处理。

MVP 中，AI 默认只生成 Proposal，不默认生成整理后的新 Markdown。

AI 可以建议：

- 是否值得保留。
- 应该放到哪个知识目录。
- 应该生成什么标题。
- 应该整理为独立笔记，还是合并到已有笔记。
- 应该补充哪些标签、摘要和来源信息。
- 是否建议后续生成正式笔记或增强原笔记。

### 5.3 用户审批

作为用户，我希望 AI 的任何建议都只是 Proposal，而不是自动执行结果。

用户至少需要能做这些决策：

- Approve：批准提案，但不立即执行。
- Approve & Apply：批准并立即应用。
- Reject：拒绝当前提案。
- Comment：补充要求，让 AI 重新生成提案。
- Drop：确认该收藏不再处理。

### 5.4 安全写入 Vault

作为用户，我希望系统只在必要时、且经过批准后，修改 Obsidian Vault。

默认情况下，Obsidian Web Clipper 生成的原始笔记已经是 Vault 中的受管对象，PKWS 不需要再生成一份整理后 Markdown。

系统可以在用户授权下写入：

- 最小 `pkws_id`。
- 用户批准的文件移动。
- 用户批准的 Frontmatter 更新。
- 用户批准的摘要追加。
- 用户批准的新正式笔记。

系统不得在 Vault 中写入：

- AI 草稿。
- 临时文件。
- 半成品。
- Proposal 全文。
- Patch 全文。
- Timeline。
- 系统元数据垃圾。
- 未审批内容。

### 5.5 回滚

作为用户，我希望如果系统应用结果不满意，可以撤销系统造成的修改。

MVP 的回滚承诺范围：

- 可以回滚本系统某次 Apply 造成的新增文件。
- 可以回滚本系统某次 Apply 造成的文件覆盖。
- 可以回滚本系统某个 Case 的 Apply 结果。

MVP 不承诺：

- 恢复用户手动编辑后又被继续改动的所有复杂状态。
- 恢复系统之外其他工具造成的 Vault 变更。
- 做整个 Vault 的时间机器。

## 6. 核心对象

### 6.1 Case

Case 是系统的一等公民，表示一个知识处理任务。

一个 Case 至少包含：

- 标题。
- 来源。
- 当前状态。
- 关联 Artifact。
- Timeline。
- 当前 Proposal。
- 当前 Patch。
- 审批记录。
- Snapshot 记录。

### 6.2 Artifact

Artifact 是被处理的知识对象。

MVP 中主要是来自网页剪藏的 Markdown 内容。

### 6.3 Knowledge Anchor

Knowledge Anchor 是系统用于追溯 Obsidian 笔记、Case、批注、提案、快照和历史事件的稳定身份锚点。

笔记中只保存最小身份字段：

```yaml
---
pkws_id: kw_20260627_x7f3a
---
```

设计原则：

- `pkws_id` 不是 Case ID。
- `pkws_id` 不是路径 ID。
- `pkws_id` 不表达笔记角色。
- 笔记 Frontmatter 不保存复杂 Case 列表、角色列表或操作历史。
- Case、角色、路径历史、批注、提案、快照等复杂关系全部保存在系统 Workspace 中。

这样可以支持一个知识对象长期关联多个 Case，例如首次收藏整理、后续合并、半年后更新、用户批注后重写、某次 Apply 回滚等。

推荐绑定模型：

```text
Obsidian Note
  -> pkws_id
  -> Workspace 查询关联 Case、批注、Proposal、Patch、Snapshot、Timeline
```

### 6.4 Proposal

Proposal 是 AI 的整理建议，用于解释为什么这样处理。

MVP 中，Proposal 是 AI 的默认输出。Proposal 不等于整理后 Markdown，也不直接修改 Vault。

Proposal 应该回答：

- 这个内容的价值是什么。
- 建议如何命名。
- 建议放到哪里。
- 是否建议合并到已有笔记。
- 为什么这样做。

### 6.5 Patch

Patch 是可执行变更集合，用于说明系统将对 Vault 做什么。

MVP 中，Patch 只在用户选择具体动作后生成，例如 Move、Add Tags、Append Summary、Generate Formal Note。

Patch 必须可预览、可审批、可回滚。

默认 Proposal 阶段不生成内容 Patch，避免不必要地重写 Clipper 原始笔记。

### 6.6 Snapshot

Snapshot 是 Apply 前的安全检查点。

它记录系统即将影响的文件在 Apply 前的状态，用于后续 Rollback。

### 6.7 Memory

Memory 用于保持 Case 连续性和用户长期偏好。

MVP 只包含两类轻量记忆：

```text
Case Instruction Summary：当前 Case 的有效用户指示摘要
Workspace Rules：用户手动配置的全局整理偏好
```

设计原则：

- 记忆必须可见、可编辑、可禁用。
- Case 指示优先于 Workspace Rules。
- AI 不能自动写入长期记忆。
- Learned Memory 放到后续阶段，必须由用户审批后才可写入 Workspace Rules。
- 记忆保存在系统 Workspace 中，不写入 Obsidian Vault。

详细设计见 `docs/memory-design.md`。

### 6.8 Timeline

Timeline 是 Case 的事件历史。

用户应该能通过 Timeline 理解：

- 这个 Case 从哪里来。
- AI 做过什么。
- 用户做过什么决策。
- 系统什么时候应用过修改。
- 是否发生过回滚。

## 7. 状态设计

MVP 使用简化状态机：

```text
Captured
  -> Analyzing
  -> ReviewRequired
  -> Approved
  -> Applying
  -> Done

ReviewRequired
  -> NeedDiscussion
  -> Rejected
  -> Dropped

Done
  -> RollbackRequested
  -> RolledBack
```

状态说明：

| 状态 | 含义 |
| --- | --- |
| Captured | 内容已进入系统 |
| Analyzing | AI 正在分析 |
| ReviewRequired | 等待用户审批 |
| NeedDiscussion | 用户提出补充意见，需要重新生成提案 |
| Approved | 用户已批准，等待应用 |
| Applying | 系统正在应用到 Vault |
| Done | 已完成 |
| Rejected | 用户拒绝当前提案 |
| Dropped | 用户确认放弃处理 |
| RollbackRequested | 用户请求回滚 |
| RolledBack | 系统已回滚自身造成的修改 |

## 8. 首页需求

MVP 首页不做聊天窗口，只做知识任务控制台。

首页包含四个主队列：

- Inbox：刚捕获或待分析的 Case。
- Review：等待用户审批的 Case。
- Active：处理中、已批准、正在应用的 Case。
- Closed：Done、Dropped、RolledBack 的 Case。

Case 详情需要展示：

- 当前目标。
- 当前状态。
- 来源信息。
- AI Proposal。
- Patch 预览。
- Timeline。
- 可执行操作。
- Snapshot 与 Rollback 信息。

## 9. 与 Obsidian Web Clipper 的关系

系统长期跟进 Obsidian Web Clipper。

边界划分：

| 模块 | 职责 |
| --- | --- |
| Obsidian Web Clipper | 网页捕获、内容提取、模板化 Markdown、保存入口 |
| 本系统 | Case 生命周期、AI 后处理、审批、Patch、Snapshot、Rollback |

MVP 优先兼容 Obsidian Web Clipper 生成的 Markdown 文件与元信息。

后续可以进一步复用或对接 Obsidian Web Clipper 的 API、CLI、模板和 Interpreter 能力。

参考链接：

- https://github.com/obsidianmd/obsidian-clipper
- https://help.obsidian.md/web-clipper

## 10. 技术与生态原则

本节只定义选型约束，不展开具体实现。

### 10.1 Node 生态优先

MVP 优先使用 Node.js 与 TypeScript 生态，因为 Obsidian、Obsidian 插件、Web Clipper、前端控制台和多数 AI SDK 都天然贴近这个生态。

### 10.2 成熟开源模块优先

关键模块尽量使用成熟开源库，避免重复造轮子。

优先复用方向包括：

- 状态机与工作流编排。
- Markdown 解析与转换。
- 文件监听。
- 本地任务队列。
- 本地数据库或嵌入式存储。
- AI Provider SDK 与统一适配层。
- Web 控制台组件库。

### 10.3 AI Provider 可替换

系统不应把核心领域模型绑定到单一模型或单一供应商。

AI 能力应该被视为可替换的分析、规划和生成服务。

### 10.4 本地优先

MVP 优先本地运行、本地存储、本地 Vault 操作，符合 Obsidian 用户对数据控制权的预期。

### 10.5 Vault-first 内容流

MVP 采用 Vault-first 内容流。

Obsidian Web Clipper 生成的 Markdown 直接落地到 Vault Inbox，PKWS 将这篇笔记视为受管对象，而不是把它复制到独立处理空间再重新生成一份内容。

PKWS 默认只补充最小身份锚点：

```yaml
pkws_id: kw_xxx
```

可选状态字段如 `pkws_status` 不作为 MVP 默认写入，避免状态与 Workspace 不同步。

### 10.6 不污染 Vault

系统中间态必须保存在 Vault 外部。

Vault 可以保存原始 Clipper 笔记和最终批准的修改，但不保存 AI 草稿、Proposal、Patch、Timeline 等工作流状态。

## 11. 设计原则

### 11.1 AI 执行，用户决策

AI 可以分析、总结、规划和生成提案，但不能越过用户审批直接修改 Vault。

### 11.2 所有 AI 输出都是 Proposal

AI 输出不是事实，也不是命令，而是待用户确认的提案。

### 11.3 系统只回滚自己造成的影响

Rollback 是系统信任基础，但边界必须明确。

MVP 只承诺回滚本系统 Apply 造成的修改。

### 11.4 Case 是一等公民

Conversation 不是首页主体。

用户管理的是知识任务，而不是聊天会话。

## 12. 记忆需求边界

MVP 必须支持：

- Case Detail 中展示当前 Case 的有效指示摘要。
- 用户可以编辑或标记某条 Case 指示失效。
- AI 生成 Proposal 时读取 Case Instruction Summary。
- Settings 中支持手动维护 Workspace Rules。
- AI 生成 Proposal 时读取 Workspace Rules。

MVP 不做：

- 自动学习长期规则。
- 黑箱用户画像。
- 向量数据库记忆。
- Project Memory。
- 多用户共享记忆。

## 13. 下一步设计议题

下一阶段进入架构设计与模块设计，建议依次明确：

1. 总体架构图。
2. 核心模块边界。
3. Case Engine 职责。
4. Capture Adapter 与 Obsidian Web Clipper 的关系。
5. Proposal / Patch 的边界。
6. Vault Safety Layer 的安全承诺。
7. Timeline 与事件模型。
8. MVP 页面与交互流。
