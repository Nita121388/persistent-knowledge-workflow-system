# 持续知识工作流系统典型使用案例

> 版本：v0.2
> 状态：案例草案
> 阶段：产品行为约束
> 更新日期：2026-07-02

> 📊 相关图表：`docs/diagrams/user-end-to-end-flow.md`（端到端用户业务流）、`docs/diagrams/case-lifecycle-timeline.md`（长期 Case 生命周期）

## 1. 文档目的

本文档用于记录典型使用案例，约束后续需求、架构、模块和交互设计，避免系统跑偏成普通 Chat、普通剪藏工具或普通 Obsidian 插件。

核心提醒：

```text
用户管理的是长期知识工作流，不是一次性 AI 对话。
Case 可以跨越多轮、数天、数周甚至更长时间。
```

## 2. 核心使用原则

### 2.1 Case 是长期任务

一个 Case 不一定在当天结束。

它可能经历：

```text
收藏
  -> 初步分析
  -> 等待用户 Review
  -> 用户补充指示
  -> AI 重新调研或重写
  -> 再次等待 Review
  -> 用户审批
  -> Apply
  -> Done
  -> 未来 Reopen
```

### 2.2 用户按自己的节奏处理 AI 结果

AI 可以异步处理，但用户不需要实时等待。

用户回到系统时，应该能通过面板快速看到：

- 哪些 Case 没有 Done。
- 哪些 Case 等待用户下一步指示。
- 哪些 Case 需要补充材料。
- 哪些 Case 可以直接审批。
- 哪些 Case 已经失败或需要人工确认。

### 2.3 Obsidian 是内容上下文，不是完整工作台

用户在 Obsidian 中阅读、选中文本、补充批注、发起轻量指令。

完整的 Case 管理、Proposal Review、Patch Preview、Rollback 和批量处理仍然在 Web Console 中完成。

### 2.4 Obsidian 插件必须轻量

如果需要 Obsidian 插件，它应该是轻量入口，而不是完整产品本体。

插件只负责：

- 读取当前笔记 `pkws_id`。
- 展示轻量 Case 状态。
- 添加批注。
- 选择已有 Case 或创建新 Case。
- 跳转 Web Console。

插件不负责：

- 完整 Case 看板。
- 完整 Proposal Review。
- 完整 Patch Preview。
- Rollback 操作。
- 复杂 AI 配置。
- 大量系统状态存储。

## 3. 案例一：浏览网页时收藏并进入异步知识工作流

### 3.1 场景描述

用户在浏览器中阅读一篇网页，认为它可能有价值，但不想立刻整理。

用户点击浏览器收藏入口，将内容保存到 Obsidian，同时补充一句批注：

```text
这篇文章里关于 AI Agent 工作流的部分值得整理，后面帮我判断是否可以合并到我的 Agent 方法论笔记。
```

系统异步处理，用户继续浏览网页或做其他事情。

### 3.2 目标

让一次网页收藏自动进入一个长期 Case，而不是沉没在 Inbox 中。

### 3.3 典型流程

```text
1. 用户在浏览器中打开网页
2. 用户点击 Obsidian Web Clipper 收藏
3. 用户可选地添加一条收藏批注
4. Clipper 保存 Markdown 到 Obsidian Vault Inbox
5. PKWS File Watcher 发现新笔记
6. PKWS 生成或写入 pkws_id
7. PKWS 创建 Knowledge Anchor
8. PKWS 创建 Case
9. AI 异步分析网页内容和用户批注
10. AI 生成 Proposal 和 Patch
11. Case 进入 ReviewRequired
12. 用户稍后在 Web Console 面板看到该 Case
```

### 3.4 用户稍后处理

用户打开 Web Console 面板，看到未完成 Case：

```text
Review
- Case #23：AI Agent 工作流文章
  状态：等待 Review
  AI 建议：合并到 Agent 方法论笔记
  下一步：需要用户确认是否合并
```

用户可以选择：

- Approve & Apply。
- Comment：要求 AI 补充调研。
- Comment：要求优化摘要结构。
- Comment：指定合并到某篇 Obsidian 笔记。
- Drop。
- 跳转到 Obsidian 中对应原始笔记。

### 3.5 追加指示示例

用户可能给出新的指示：

```text
先不要合并，补充调研一下作者提到的三个工具，看看它们是否仍然活跃。
```

或者：

```text
把这篇文章和我已有的“Agent 执行循环”笔记对比，只保留新增观点。
```

系统应把这些指示记录为 Case Timeline 事件，并触发 AI 异步处理。

### 3.6 长周期特征

这个 Case 可能不会当天 Done。

它可能在几天内反复经历：

```text
AI 分析
  -> 用户批注
  -> AI 补充调研
  -> 用户指定合并目标
  -> AI 生成新 Patch
  -> 用户审批
  -> Apply
```

设计要求：

- Case 面板必须清楚显示当前卡在哪里。
- 用户不需要记住上次聊到哪。
- Timeline 必须保留完整历史。

## 4. 案例二：用户在 Web Console 面板集中处理未 Done 的 Case

### 4.1 场景描述

用户不想实时处理每一条 AI 输出，而是像处理任务队列一样，定期打开面板处理。

### 4.2 面板目标

Web Console 面板要帮助用户快速回答：

```text
现在有哪些 Case 没有 Done？
哪些需要我做决定？
哪些可以快速批准？
哪些需要我补充指示？
哪些应该 Drop？
```

### 4.3 面板队列

推荐队列：

```text
Inbox：刚进入系统，还没形成明确提案
Review：AI 已完成处理，等待用户决策
Active：AI 正在处理，或等待 Apply / Rollback
Blocked：需要用户补充信息或处理冲突
Closed：Done / Dropped / RolledBack / Archived
```

MVP 可以先合并为：

```text
Inbox / Review / Active / Closed
```

但设计上要预留 Blocked。

### 4.4 用户操作

用户在面板中可以：

- 快速查看 Proposal 摘要。
- 打开完整 Case Detail。
- 添加新指示。
- 要求 AI 补充调研。
- 要求 AI 优化结构。
- 指定目标笔记。
- 跳转 Obsidian 对应笔记。
- Approve & Apply。
- Drop。
- Rollback。

### 4.5 设计约束

面板不是 Chat 首页。

面板首先是 Case 队列和决策台。

用户应该可以用类似任务管理的方式处理 Case，而不是逐条打开聊天记录。

## 5. 案例三：用户在 Obsidian 笔记中选中文本并追加到相关 Case

### 5.1 场景描述

用户在 Obsidian 中阅读一篇已关联 `pkws_id` 的笔记。

用户选中一段文本，希望让 AI 对这段内容做进一步处理。

例如：

```text
这一段提到的工具需要补充调研，看看有没有更好的替代品。
```

### 5.2 典型流程

```text
1. 用户在 Obsidian 中打开笔记
2. Obsidian 插件读取当前笔记 pkws_id
3. 插件查询 PKWS Backend，获取相关活跃 Case
4. 用户选中文本
5. 用户按快捷键或点击轻量入口
6. 用户输入批注
7. 如果只有一个活跃 Case，默认追加到该 Case
8. 如果有多个活跃 Case，用户选择目标 Case
9. 如果没有活跃 Case，用户可以创建新 Case
10. 批注作为 Timeline Event 进入对应 Case
11. AI 异步处理
```

### 5.3 多 Case 选择

如果该 `pkws_id` 关联多个活跃 Case，插件显示：

```text
这条批注要发送到哪里？

- Case #23：整理这篇网页收藏
- Case #41：合并到 Agent 方法论笔记
- 创建新 Case
```

用户选择后再发送。

### 5.4 新增 Case

如果用户选择创建新 Case，系统需要让用户输入一个目标：

```text
你希望 AI 做什么？

标题：调研这段提到的 Agent 工具
批注：看看这些工具是否仍然活跃，并补充替代方案。
```

系统创建：

- 新 Case。
- 与当前 `pkws_id` 的关联。
- 用户批注事件。
- 选中文本锚点。

### 5.5 设计约束

Obsidian 侧不展示复杂工作流。

它只做：

```text
当前笔记 -> 当前 pkws_id -> 选择或创建 Case -> 发送批注
```

完整处理仍然回到 Web Console。

## 6. 案例四：用户在 Obsidian 中通过快捷键新增一条笔记并创建 Case

### 6.1 场景描述

用户不一定从浏览器收藏开始。

用户可能正在 Obsidian 中想到一个知识处理任务，希望快速新增一个笔记和 Case。

例如用户按快捷键输入：

```text
标题：研究 Obsidian Web Clipper 的模板能力
批注：看看它是否能稳定生成 source_url、author、captured_at，并评估和 PKWS 的集成方式。
```

### 6.2 典型流程

```text
1. 用户在 Obsidian 中按快捷键
2. 弹出轻量输入框
3. 用户输入标题和批注
4. 系统创建一篇新笔记或草稿笔记
5. 系统写入 pkws_id
6. 系统创建 Knowledge Anchor
7. 系统创建 Case
8. 批注进入 Case Timeline
9. AI 异步处理
10. 用户稍后在 Web Console Review
```

### 6.3 用户选择已有 Case

用户也可能不是新增 Case，而是给已有 Case 补充材料。

流程：

```text
1. 用户按快捷键
2. 输入标题和批注
3. 选择“补充到已有 Case”
4. 从最近活跃 Case 或搜索结果中选择目标
5. 系统把新笔记作为该 Case 的补充 Artifact
6. Timeline 记录用户补充材料
```

### 6.4 看板选择更便捷

对于复杂场景，用户可以打开 Web Console 看板选择 Case。

例如：

```text
用户在 Obsidian 中点击“选择 Case”
-> 打开 Web Console Case Selector
-> 搜索或筛选 Case
-> 选择目标 Case
-> 回到当前笔记完成绑定或追加批注
```

这避免在 Obsidian 插件里实现过重的完整看板。

## 7. 案例五：同一个知识对象跨越很长时间多轮处理

### 7.1 场景描述

一个 `pkws_id` 对应的知识对象可能长期存在。

它可能在不同时间关联多个 Case。

例如：

```text
kw_20260627_agent_workflow
  - case_23：首次网页收藏整理
  - case_41：合并到 Agent 方法论笔记
  - case_58：补充调研工具现状
  - case_72：半年后更新过时链接
  - case_91：回滚一次错误整理
```

### 7.2 设计含义

因此笔记里不能只绑定 `case_id`。

笔记里只保存：

```yaml
---
pkws_id: kw_20260627_agent_workflow
---
```

所有 Case 关系通过 Workspace 查询。

### 7.3 用户体验

用户在 Obsidian 中看到的是当前知识对象状态：

```text
PKWS
知识对象：kw_20260627_agent_workflow
活跃 Case：2 个
最近完成：case_41 合并到方法论笔记

[查看相关 Case] [添加批注] [创建新 Case]
```

## 8. 反例：后续设计不能走偏的方向

### 8.1 不要把产品做成聊天窗口

错误方向：

```text
用户每次都要打开 Chat，问 AI 现在怎么样。
```

正确方向：

```text
用户打开 Case 面板，看到哪些任务等待处理。
```

### 8.2 不要让 Obsidian 插件变成完整后台

错误方向：

```text
插件里塞完整看板、完整设置、完整 Patch Review。
```

正确方向：

```text
插件只做轻量入口，复杂操作跳转 Web Console。
```

### 8.3 不要把 Case 复杂关系写进笔记

错误方向：

```yaml
cases:
  - case_23
  - case_41
roles:
  - source
  - target
```

正确方向：

```yaml
pkws_id: kw_xxx
```

复杂关系全部存在 Workspace。

### 8.4 不要让 AI 自动越权 Apply

错误方向：

```text
AI 分析完成后直接整理 Vault。
```

正确方向：

```text
AI 生成 Proposal 和 Patch，用户审批后 Apply。
```

## 9. MVP 结论

MVP 必须优先支持：

1. 浏览器收藏进入 Case。
2. AI 异步处理。
3. 用户通过 Web Console 面板处理未 Done Case。
4. 用户可以对 Case 追加指示。
5. 用户可以跳转到 Obsidian 对应笔记。
6. `pkws_id` 作为笔记与系统关系的稳定锚点。

MVP 可以延后但必须预留：

1. Obsidian 中选中文本后追加批注。
2. Obsidian 中创建新笔记并创建 Case。
3. Obsidian 中选择已有 Case。
4. 轻量 Obsidian 插件。
5. 轻量浏览器伴侣插件。
