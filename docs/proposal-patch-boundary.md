# Proposal 与 Patch 边界设计

> 版本：v0.1
> 状态：边界设计草案
> 阶段：MVP 设计
> 更新日期：2026-06-27

## 1. 为什么需要这份文档

本项目最容易跑偏的地方，是把 AI Proposal、整理后 Markdown 和 Patch 混成一个东西。

MVP 必须坚持：

```text
Proposal 是建议。
Patch 是变更。
Apply 是执行。
```

AI 默认只生成 Proposal。Patch 只有在用户选择具体动作后才生成。

## 2. 三个对象的区别

| 对象 | 本质 | 是否修改 Vault | 是否默认生成 | 谁触发 |
| --- | --- | --- | --- | --- |
| Proposal | AI 整理建议 | 否 | 是 | 系统自动或用户重新生成 |
| Patch Intent | 用户要求生成变更 | 否 | 否 | 用户 |
| Patch Manifest | 可执行文件变更集合 | 否，直到 Apply | 否 | Patch Intent 触发 Worker |
| Apply Manifest | 已执行变更记录 | 是 | 否 | 用户 Approve & Apply |

## 3. Proposal 的职责

Proposal 回答：

- 这条收藏有没有价值。
- 建议如何处理。
- 是否可以直接 Done。
- 是否建议 Drop。
- 是否建议移动到某个目录。
- 是否建议追加摘要或标签。
- 是否建议生成正式笔记。
- 风险或不确定点是什么。

Proposal 不回答：

- 最终文件完整内容是什么。
- 具体怎么写入 Vault。
- 要不要立即移动文件。
- 要不要覆盖某个文件。
- 要不要删除旧文件。

## 4. Proposal Schema 最小字段

```ts
interface Proposal {
  title: string;
  summary: string;
  valueJudgement: 'high' | 'medium' | 'low' | 'drop';
  suggestedActions: ProposalAction[];
  suggestedTargetPath?: string;
  reasoningSummary: string;
  risks?: string[];
  requiresPatch: boolean;
}
```

示例：

```json
{
  "title": "AI 绘画工具汇总",
  "summary": "这是一篇工具清单型收藏，适合保留为资源索引。",
  "valueJudgement": "medium",
  "suggestedActions": ["move", "update_frontmatter"],
  "suggestedTargetPath": "资源库/AI工具/AI 绘画工具汇总.md",
  "reasoningSummary": "内容偏资源清单，长期复用价值高，但正文不需要重写。",
  "risks": ["工具链接可能过期，需要后续定期复查"],
  "requiresPatch": true
}
```

注意：

- `requiresPatch` 只是提示用户如果要采纳建议，需要后续生成 Patch。
- 它不是授权系统自动生成或应用 Patch。

## 5. 用户在 Proposal 阶段可以做什么

用户动作：

```text
Mark Done
Drop
Comment
Regenerate Proposal
Generate Patch: Move
Generate Patch: Update Frontmatter
Generate Patch: Append Summary
Generate Patch: Generate Formal Note
```

动作含义：

| 动作 | 是否生成 Patch | 是否修改 Vault |
| --- | --- | --- |
| Mark Done | 否 | 否 |
| Drop | 否 | 否 |
| Comment | 否 | 否 |
| Regenerate Proposal | 否 | 否 |
| Generate Patch | 是 | 否 |

## 6. Patch Intent 的职责

Patch Intent 表示用户明确要求系统生成某类可执行变更。

示例：

```json
{
  "caseId": "case_20260627_001",
  "action": "move",
  "targetPath": "项目/2026/Q3/设计素材/AI 绘画工具汇总.md",
  "instruction": "只移动文件，不改正文。"
}
```

Patch Intent 的价值：

- 把用户决策和 AI 建议分开。
- 让系统知道用户到底想生成哪类 Patch。
- 避免 Proposal 阶段提前生成不必要的文件内容。

## 7. Patch Manifest 的职责

Patch Manifest 是可执行变更集合。

它必须回答：

- 会影响哪些文件。
- 每个文件当前 hash 是什么。
- 每个操作是什么类型。
- 新内容或新路径是什么。
- 如果冲突应该失败还是另存。

MVP 支持：

```text
create_file
update_file
move_file
```

MVP 禁止：

```text
delete_file
bulk_update
cross_vault_move
complex_merge
workspace_wide_refactor
```

## 8. Patch Manifest 示例

### 8.1 Move

```json
{
  "operations": [
    {
      "type": "move_file",
      "fromPath": "Inbox/Web Clips/AI 绘画工具汇总.md",
      "toPath": "资源库/AI工具/AI 绘画工具汇总.md",
      "beforeHash": "sha256:abc",
      "ifTargetExists": "fail"
    }
  ]
}
```

### 8.2 Update Frontmatter

```json
{
  "operations": [
    {
      "type": "update_file",
      "path": "Inbox/Web Clips/AI 绘画工具汇总.md",
      "beforeHash": "sha256:abc",
      "newContent": "---\npkws_id: kw_20260627_x7f3a\ntags:\n  - ai/tools\n---\n正文..."
    }
  ]
}
```

### 8.3 Generate Formal Note

```json
{
  "operations": [
    {
      "type": "create_file",
      "path": "资源库/AI工具/AI 绘画工具汇总.md",
      "content": "# AI 绘画工具汇总\n\n...",
      "ifExists": "fail"
    }
  ]
}
```

## 9. 正式笔记生成原则

AI 可以生成正式 Markdown，但只能发生在用户选择 `generate_formal_note` 后。

这类生成必须满足：

- 原始 Clipper 笔记不被默认覆盖。
- 新正式笔记作为 `create_file` Patch 预览。
- 用户必须看到完整 Markdown 预览。
- 用户 Approve & Apply 后才写入 Vault。
- 若目标文件存在，默认失败，不覆盖。

## 10. Append Summary 原则

用户选择 `append_summary` 时，系统可以生成一个追加摘要 Patch。

约束：

- 必须基于最新文件 hash。
- 必须展示追加后的完整预览或局部 diff。
- 不允许静默插入到用户不可见位置。
- 不允许删除原文。

## 11. Move 原则

用户选择 `move` 时，系统只移动文件，不改正文。

如需同时更新 frontmatter 或链接，必须生成独立 operation，并在 Preview 中明确展示。

## 12. Mark Done 不等于 Apply

用户可以在不修改 Vault 的情况下完成 Case。

适用场景：

- 原始 Clipper 笔记已经足够。
- 用户暂时只想记录已读。
- AI Proposal 只是提醒用户内容价值，不需要整理。

Mark Done 行为：

- 不生成 Patch。
- 不写 Vault。
- 记录 Timeline Event。
- Case 进入 Done。

## 13. Drop 不等于删除文件

Drop 表示用户放弃处理该 Case。

MVP 中 Drop 不删除原始 Vault 笔记。

如果未来支持删除，也必须作为单独高风险 Patch，且 MVP 不实现。

## 14. 交互呈现建议

Case Detail 中建议分区：

```text
AI Proposal
  - 建议动作
  - 理由
  - 风险
  - 操作按钮：Mark Done / Drop / Comment / Generate Patch

Patch Preview
  - 只在有 Patch 时出现
  - 文件影响清单
  - Diff / Markdown 预览
  - Approve & Apply / Reject
```

避免把 Patch Preview 永久放在 Proposal 区里，否则用户会误以为每个 Proposal 都会修改文件。

## 15. Worker 行为约束

Worker 可以自动执行：

- 扫描 Inbox。
- 写入最小 `pkws_id`。
- 创建 Case。
- 生成 Proposal。

Worker 不可以自动执行：

- 生成 Patch，除非存在用户 Patch Intent。
- Apply Patch，除非用户 Approve & Apply。
- Drop Case。
- Mark Done。
- 写入 Proposal 到 Vault。

## 16. 开发验收标准

实现阶段必须通过这些检查：

1. 新 Case 进入 ReviewRequired 后，Vault 原文没有被 AI 重写。
2. Proposal 生成后，没有 Patch Manifest 也可以正常存在。
3. 用户 Mark Done 后，没有任何 Vault 文件被修改。
4. 用户 Drop 后，没有任何 Vault 文件被删除。
5. 用户 Generate Patch 后，Patch 只处于 Preview 状态。
6. 只有 Approve & Apply 后，Vault Safety Layer 才执行文件操作。
