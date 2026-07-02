# 持续知识工作流系统交互设计

> 版本：v0.3
> 状态：交互设计草案
> 阶段：MVP 交互设计
> 更新日期：2026-07-02

> 📊 相关图表：`docs/diagrams/user-surface-roles.md`（三个界面各自职责）

## 1. 交互设计目标

MVP 交互设计要解决三个核心问题：

1. 用户在哪里看到 AI 的整理提案。
2. 用户在 Obsidian 笔记中如何针对某个知识对象追加批注。
3. 笔记、`pkws_id`、Case 之间如何自然绑定与选择。

核心原则：

```text
Obsidian = 内容上下文
Web Console = 决策上下文
Workspace = 关系与历史真相来源
```

## 2. 交互分工

### 2.1 Web Console

Web Console 是权威决策台，也是用户处理未 Done Case 的主面板。

适合处理：

- 查看哪些 Case 还没有 Done。
- 查看哪些 Case 等待用户下一步指示。
- 查看完整 AI Proposal。
- 查看 Patch 预览。
- 审批或拒绝。
- 评论并要求重新生成。
- 要求 AI 增加、优化或补充调研内容。
- 跳转到 Obsidian 中对应笔记。
- 查看完整 Timeline。
- 执行 Rollback。
- 批量处理 Case。

### 2.2 Obsidian

Obsidian 是内容上下文。

适合处理：

- 阅读收藏笔记。
- 在当前笔记上下文中追加批注。
- 查看轻量 Case 状态。
- 快速跳转到 Web Console。
- 在没有绑定时创建或绑定知识对象。

### 2.3 不推荐的交互

不推荐把以下内容写入 Obsidian 正文：

- AI Proposal。
- Patch 详情。
- Timeline。
- AI 草稿。
- 系统事件。
- Case 列表和角色信息。

这些内容属于工作流状态，不属于最终知识内容。

### 2.4 典型案例约束

后续设计必须围绕以下行为样本校验：

```text
浏览器收藏网页
  -> 用户可选地添加收藏批注
  -> AI 异步处理
  -> Case 进入等待 Review / 等待指示状态
  -> 用户稍后在 Web Console 面板集中处理未 Done Case
  -> 用户可要求 AI 增加、优化、补充调研或指定目标笔记
  -> 用户可跳转到 Obsidian 对应笔记继续阅读和批注
```

以及：

```text
用户在 Obsidian 中阅读笔记
  -> 选中文本
  -> 追加批注
  -> 选择已有 Case 或创建新 Case
  -> 批注进入 Case Timeline
  -> AI 异步处理，Case 可跨多轮、跨很长时间持续演进
```

这些案例的详细版本记录在 `docs/use-cases.md`。

## 3. 用户在哪里看到 AI 整理提案

### 3.1 权威入口：Web Console Case Detail

用户在 Web Console 中查看完整提案。

Case Detail 至少展示：

```text
Case #23：AI 绘画工具汇总
状态：等待审批

来源：Obsidian Web Clipper
关联知识对象：kw_20260627_x7f3a
当前笔记：Inbox/Web Clips/AI绘画工具汇总.md

AI Proposal：
- 内容价值：适合作为 AI 绘画工具资源清单
- 建议标题：AI 绘画工具汇总
- 建议位置：资源库/AI工具/
- 建议动作：整理为结构化资源笔记
- 理由：内容包含多个工具、来源链接和使用场景

Patch Preview：
+ 创建 资源库/AI工具/AI绘画工具汇总.md
~ 保留 pkws_id

操作：
[Approve] [Approve & Apply] [Reject] [Comment] [Drop]
```

### 3.2 轻量入口：Obsidian 状态卡

当用户打开包含 `pkws_id` 的笔记时，Obsidian 侧只展示摘要。

示例：

```text
PKWS
关联知识对象：kw_20260627_x7f3a
活跃 Case：#23 等待审批
AI 建议：整理到 资源库/AI工具/

[查看提案] [添加批注] [打开后台]
```

Obsidian 中不展示完整 Patch，避免把决策复杂度塞进阅读场景。

## 4. 笔记与系统的绑定方式

### 4.1 最小绑定字段

笔记中只保存稳定身份字段：

```yaml
---
pkws_id: kw_20260627_x7f3a
---
```

该字段表示：这篇笔记对应一个系统可追溯的知识对象。

### 4.2 不写入笔记的信息

不写入：

```yaml
case_id: case_23
cases:
  - case_23
roles:
  - source_of
```

原因：

- Case 是任务，会结束。
- 角色是关系，会变化。
- 一个知识对象可能关联多个 Case。
- Frontmatter 不应该成为系统数据库。

### 4.3 系统侧关系

系统 Workspace 维护完整关系：

```text
pkws_id: kw_20260627_x7f3a
  current_paths:
    - Inbox/Web Clips/AI绘画工具汇总.md
  related_cases:
    - case_23
    - case_41
  annotations:
    - ann_001
  proposals:
    - proposal_23_001
  snapshots:
    - snapshot_23_001
```

## 5. 收藏进入系统的交互

### 5.1 推荐 MVP 流程

```text
1. 用户使用 Obsidian Web Clipper 收藏网页
2. 笔记保存到指定 Inbox 目录
3. 系统发现新笔记
4. 系统生成 pkws_id
5. 系统在允许的情况下写入笔记 Frontmatter
6. 系统创建 Knowledge Anchor
7. 系统创建 Case
8. Case 进入 AI 分析流程
9. 用户在 Web Console 的 Review 队列看到提案
```

### 5.2 如果不允许自动写入 pkws_id

系统可以先建立临时路径映射：

```text
path -> temporary anchor -> case
```

但当用户第一次打开或审批该 Case 时，应提示：

```text
是否为这篇笔记写入 PKWS 追踪 ID？

写入后，系统可以在文件移动或重命名后继续追踪它。

[写入 pkws_id] [暂不写入]
```

## 6. 用户在 Obsidian 中追加批注

### 6.1 单一活跃 Case

当当前 `pkws_id` 只关联一个活跃 Case 时：

```text
1. 用户打开笔记
2. 用户选中文本或不选文本
3. 用户触发快捷入口
4. 输入批注
5. 系统默认追加到唯一活跃 Case
6. Timeline 记录 User Annotation Added
7. Case 进入 NeedDiscussion 或重新分析流程
```

示例弹窗：

```text
添加到 Case #23：AI 绘画工具汇总

批注：
[这一段不要总结，保留原始工具列表]

[发送]
```

### 6.2 多个活跃 Case

当当前 `pkws_id` 关联多个活跃 Case 时，用户必须选择目标。

示例：

```text
这条批注要发送到哪里？

( ) Case #23：整理这篇网页收藏
    状态：等待审批

( ) Case #41：合并到 AI 工具库
    状态：需要讨论

( ) 创建新 Case

批注：
[补充你的要求]

[发送]
```

默认可以选中最近活跃的 Case，但必须允许用户切换。

### 6.3 没有活跃 Case

当当前 `pkws_id` 没有关联活跃 Case 时：

```text
当前笔记没有活跃 Case

[创建新 Case]
[查看历史 Case]
[取消]
```

用户选择创建新 Case 后，可以输入目标：

```text
你希望 AI 对这篇笔记做什么？

[整理成结构化笔记]
[合并到已有主题]
[检查是否值得保留]
[自定义指令]
```

## 7. 批注的锚定方式

### 7.1 不依赖行号

Markdown 行号容易变化，因此批注不应只依赖行号。

推荐锚定信息：

- `pkws_id`
- 当前文件路径
- 选中文本 quote
- 所在标题层级
- 前后文片段
- 创建时间

### 7.2 批注事件示例

```json
{
  "type": "user_annotation_added",
  "actor": "user",
  "pkws_id": "kw_20260627_x7f3a",
  "case_id": "case_23",
  "data": {
    "note_path": "Inbox/Web Clips/AI绘画工具汇总.md",
    "selected_text": "原文片段",
    "comment": "这一段不要总结，保留原始工具列表",
    "anchor": {
      "heading": "工具列表",
      "quote": "原文片段",
      "context_before": "前文",
      "context_after": "后文"
    }
  }
}
```

## 8. 手动绑定场景

### 8.1 当前笔记没有 pkws_id

Obsidian 侧显示：

```text
这篇笔记尚未关联 PKWS

[创建知识对象]
[绑定到已有知识对象]
[从这篇笔记创建 Case]
```

### 8.2 绑定到已有知识对象

适合场景：

- 用户手动移动了文件。
- 用户复制了笔记。
- 系统路径映射丢失。
- 用户希望把当前笔记纳入已有知识对象。

交互：

```text
搜索 Knowledge Anchor 或相关 Case

输入：AI 绘画工具

结果：
- kw_20260627_x7f3a：AI 绘画工具汇总
  相关 Case：#23, #41

[绑定]
```

### 8.3 从笔记创建新 Case

适合场景：

- 这篇笔记不是通过 Web Clipper 进入的。
- 用户希望让 AI 对已有笔记进行整理。
- 用户希望创建新的工作流任务。

流程：

```text
当前笔记 -> 创建 pkws_id -> 创建 Knowledge Anchor -> 创建 Case -> AI 分析
```

## 9. Web Console 页面设计

### 9.1 首页队列

首页面板的第一目标是帮助用户处理没有 Done 的 Case。

首页使用四个主队列：

```text
Inbox   Review   Active   Closed
```

设计上预留第五个队列：

```text
Blocked
```

Blocked 用于承载需要用户补充信息、处理冲突或选择目标笔记的 Case。

每个 Case 卡片展示：

- 标题。
- 状态。
- 来源。
- 更新时间。
- 当前建议动作。
- 是否等待用户指示。
- 是否可直接 Approve & Apply。
- 是否可跳转 Obsidian 对应笔记。
- 风险级别。

### 9.2 Case Detail

Case Detail 包含：

1. Case Summary
2. Knowledge Anchor 信息
3. Source / Artifact
4. AI Proposal
5. Patch Preview
6. Timeline
7. Approval Actions
8. Snapshot / Rollback
9. Comment Box

### 9.3 Proposal 与 Patch 的展示顺序

推荐顺序：

```text
先看 Proposal，理解为什么
再看 Patch，确认会改什么
最后做审批动作
```

这样降低用户审批成本。

## 10. Obsidian 侧轻量交互

MVP 可以先不实现完整 Obsidian 插件，但交互目标应明确。

Obsidian 插件应保持轻量，不应成为完整工作台。它只做当前笔记上下文里的状态、批注、选择和跳转。完整看板、Proposal Review、Patch Preview、Rollback 和复杂设置仍然放在 Web Console。

### 10.1 状态卡

```text
PKWS
知识对象：kw_20260627_x7f3a
活跃 Case：#23 等待审批
建议：整理到 资源库/AI工具/

[查看提案] [添加批注] [打开后台]
```

### 10.2 快捷批注

快捷键：

```text
Cmd/Ctrl + Shift + K
```

行为：

```text
读取当前笔记 pkws_id
查询活跃 Case
让用户输入批注
必要时选择目标 Case
发送到后台 Timeline
```

### 10.3 从 Obsidian 新增笔记并创建 Case

用户可能不从浏览器收藏开始，而是在 Obsidian 中通过快捷键新增一条笔记和 Case。

典型交互：

```text
用户按快捷键
-> 输入标题和批注
-> 系统创建新笔记或草稿笔记
-> 系统写入 pkws_id
-> 系统创建 Knowledge Anchor
-> 系统创建 Case
-> 批注进入 Timeline
-> AI 异步处理
```

输入框至少包含：

```text
标题
批注 / 目标
创建新 Case 或补充到已有 Case
```

### 10.4 补充到已有 Case

用户也可以把当前笔记、选中文本或新建笔记补充到已有 Case。

如果 Obsidian 插件内选择体验过重，应跳转 Web Console 的 Case Selector 完成选择。

```text
Obsidian 轻量入口
  -> 打开 Web Console Case Selector
  -> 用户搜索或筛选 Case
  -> 选择目标 Case
  -> 返回当前上下文继续提交批注或材料
```

### 10.5 不污染正文

批注默认不写入 Markdown 正文。

如果用户确实需要把某条批注保留在笔记中，应由用户手动写入，而不是系统自动写入。

## 11. 典型用户路径

> 以下路径可从 `docs/diagrams/user-end-to-end-flow.md` 获得直观的流程概览。

### 11.1 收藏并审批

```text
Clipper 收藏网页
-> 系统创建 pkws_id 和 Case
-> AI 生成 Proposal / Patch
-> 用户在 Review 队列查看
-> Approve & Apply
-> 系统 Snapshot
-> 写入 Vault
-> Done
```

### 11.2 阅读时补充批注

```text
用户打开 Obsidian 笔记
-> 插件读取 pkws_id
-> 查询活跃 Case
-> 用户选中文本并添加批注
-> 批注进入 Case Timeline
-> AI 重新生成 Proposal
-> 用户在 Web Console 审批
```

### 11.3 多 Case 选择

```text
用户打开笔记
-> 系统发现 pkws_id 关联多个活跃 Case
-> 用户添加批注
-> 系统要求选择 Case
-> 批注进入所选 Case
```

### 11.4 没有 Case 时创建

```text
用户打开旧笔记
-> 没有 pkws_id 或没有活跃 Case
-> 用户选择从当前笔记创建 Case
-> 系统建立 Knowledge Anchor
-> AI 进入分析流程
```

### 11.5 在 Obsidian 中新增笔记并创建 Case

```text
用户按快捷键
-> 输入标题和批注
-> 创建新笔记
-> 写入 pkws_id
-> 创建 Case
-> AI 异步处理
-> 用户稍后在 Web Console Review
```

### 11.6 补充到已有 Case

```text
用户在 Obsidian 中选择文本或创建新笔记
-> 选择“补充到已有 Case”
-> 插件提供最近 Case 或跳转 Web Console 选择
-> 材料和批注进入目标 Case Timeline
```

## 12. MVP 交互边界

MVP 必须实现：

- Web Console 查看 Proposal。
- Web Console 查看 Patch。
- Web Console 审批。
- Web Console 评论。
- Web Console 回滚。
- `pkws_id` 作为笔记身份锚点。

MVP 可以延后：

- Obsidian 插件状态卡。
- Obsidian 快捷批注。
- Obsidian 中新增笔记并创建 Case。
- Obsidian 中补充到已有 Case。
- 多 Case 可视化选择器。
- 高级批注锚定。
- 批量审批。

但架构和产品设计必须预留这些能力。
