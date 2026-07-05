# 持续知识工作流系统数据模型设计

> 版本：v0.1
> 状态：数据模型草案
> 阶段：MVP 设计
> 更新日期：2026-06-27

## 1. 设计目标

数据模型需要支撑 MVP 的核心闭环：

```text
Vault 笔记
  -> pkws_id
  -> Knowledge Anchor
  -> Case
  -> Proposal
  -> optional Patch
  -> Apply Manifest / Rollback
```

设计重点：

- `pkws_id` 是笔记内唯一默认身份锚点。
- Case 是工作流对象，不直接写入 Obsidian 笔记。
- Proposal 是 AI 建议，不是可执行文件操作。
- Patch Manifest 是可执行变更，必须可预览、可审批、可回滚。
- Workspace 是系统事实来源，Vault 只保存用户内容和最小锚点。

## 2. 数据边界

### 2.1 Vault 中允许保存

MVP 默认只写：

```yaml
---
pkws_id: kw_20260627_x7f3a
---
```

用户批准后可以写：

- 文件移动结果。
- Frontmatter 更新。
- 摘要追加。
- 新正式笔记。
- 明确批准的索引链接。

### 2.2 Vault 中不保存

- `case_id`。
- Case 列表。
- Proposal 全文。
- Patch Manifest。
- Timeline。
- Job 状态。
- Workspace Rules。
- AI 草稿。
- 系统日志。

### 2.3 Workspace 中保存

- Settings。
- Knowledge Anchor。
- Artifact。
- Case。
- Timeline Event。
- Proposal。
- Patch Intent。
- Patch Manifest。
- Apply Manifest。
- Case Instruction Summary。
- Workspace Rules。
- Job。

## 3. 核心关系

```text
KnowledgeAnchor 1 -> N Artifact
KnowledgeAnchor 1 -> N Case
Case 1 -> N TimelineEvent
Case 1 -> N Proposal
Case 1 -> N PatchIntent
PatchIntent 1 -> 0..1 PatchManifest
PatchManifest 1 -> 0..1 ApplyManifest
Case 1 -> 0..1 CaseInstructionSummary
Workspace 1 -> N WorkspaceRule
```

说明：

- 一个 `pkws_id` 可以关联多个 Case。
- 一个 Case 默认处理一个主 Artifact，后续可以扩展多 Artifact。
- 一个 Case 可以多次生成 Proposal。
- Patch 不是 Proposal 的必然结果。
- Apply Manifest 只在真正写入 Vault 后产生。

## 4. ID 规则

| 对象 | ID 前缀 | 示例 | 说明 |
| --- | --- | --- | --- |
| Knowledge Anchor | `kw_` | `kw_20260627_x7f3a` | 写入 Vault 的稳定锚点 |
| Case | `case_` | `case_20260627_001` | 工作流任务 ID |
| Artifact | `art_` | `art_20260627_001` | 被处理内容对象 |
| Event | `evt_` | `evt_20260627_001` | Timeline 事件 |
| Proposal | `prop_` | `prop_20260627_001` | AI 提案 |
| Patch Intent | `pi_` | `pi_20260627_001` | 用户请求生成 Patch 的意图 |
| Patch Manifest | `patch_` | `patch_20260627_001` | 可执行变更集合 |
| Apply Manifest | `apply_` | `apply_20260627_001` | 已执行变更记录 |
| Job | `job_` | `job_20260627_001` | 后台任务 |
| Agent Session | `as_` | `as_20260701_001` | Phase 2。CaseSession 持久化快照，用于 Agent Runtime 的 eviction 恢复 |

ID 要求：

- 全局唯一。
- 不依赖路径。
- 不因文件移动而变化。
- 可以用 `nanoid` 或类似方案生成。

## 5. Settings

Settings 保存本地应用配置。

```ts
interface Settings {
  id: string;
  vaultPath: string;
  inboxPath: string;
  workspacePath: string;
  aiProvider: 'openai-compatible';
  aiBaseUrl: string;
  aiApiKeyRef: string;
  aiDefaultModel: string;
  aiMaxTokens?: number;
  autoAnalyze: boolean;
  createdAt: string;
  updatedAt: string;
}
```

MVP 约束：

- 单 Vault。
- 单 Inbox。
- 单 AI Provider。
- API Key 可以先保存在本地配置或环境变量，后续再接系统密钥库。

## 6. Knowledge Anchor

Knowledge Anchor 是 `pkws_id` 在 Workspace 中的实体。

```ts
interface KnowledgeAnchor {
  id: string;              // kw_xxx
  currentVaultPath: string;
  originalVaultPath: string;
  title?: string;
  sourceUrl?: string;
  firstSeenAt: string;
  lastSeenAt: string;
  status: 'active' | 'missing' | 'archived';
  createdAt: string;
  updatedAt: string;
}
```

设计说明：

- `id` 对应 Vault frontmatter 中的 `pkws_id`。
- `currentVaultPath` 可随用户移动而更新。
- 如果 Watcher 发现路径失效，状态变为 `missing`，等待用户重新映射。
- Anchor 不表达笔记角色，也不表达 Case 状态。

## 7. Artifact

Artifact 表示被处理的知识对象。

```ts
interface Artifact {
  id: string;
  anchorId: string;
  type: 'vault_markdown' | 'web_clip';
  vaultPath: string;
  title?: string;
  sourceUrl?: string;
  contentHash: string;
  frontmatterJson?: string;
  capturedAt?: string;
  createdAt: string;
  updatedAt: string;
}
```

MVP 中主要是 Obsidian Web Clipper 生成的 Markdown。

## 8. Case

Case 是一等公民，表示持续知识工作流任务。

```ts
interface CaseRecord {
  id: string;
  anchorId: string;
  primaryArtifactId: string;
  title: string;
  status: CaseStatus;
  source: 'clipper' | 'manual' | 'obsidian_shortcut' | 'system';
  currentProposalId?: string;
  createdAt: string;
  updatedAt: string;
  closedAt?: string;
}

type CaseStatus =
  | 'Captured'
  | 'Analyzing'
  | 'ReviewRequired'
  | 'NeedDiscussion'
  | 'Done'
  | 'Dropped'
  | 'Rejected'
  | 'Error';
```

状态原则：

- `ReviewRequired` 表示等待用户看 Proposal。
- `NeedDiscussion` 表示用户对 Proposal 给了反馈或选择了某个 `proposedNextAction`，AI 正在跑下一轮。
- `Done` 不一定意味着文件被修改，也可能只是用户确认原始笔记无需处理。
- `Dropped` 表示用户放弃处理，但 Anchor 仍保留。
- 注：`PatchPreview` / `Approved` / `Applying` / `RolledBack` 是已退役的旧补丁编排状态（line 1）。AI 现在通过 `invoke-next` 接收用户批准的 `modify_vault` 动作后直接写真 vault，并在 timeline 留下 `vault_modified` 事件；回滚交给 Obsidian 原生版本历史。

## 9. Timeline Event

Timeline Event 是 Case 的审计日志。

```ts
interface TimelineEvent {
  id: string;
  caseId: string;
  type: TimelineEventType;
  actor: 'user' | 'ai' | 'system';
  summary: string;
  dataJson?: string;
  createdAt: string;
}

type TimelineEventType =
  | 'case_created'
  | 'anchor_created'
  | 'artifact_detected'
  | 'pkws_id_written'
  | 'ai_proposal_started'
  | 'ai_proposal_generated'
  | 'user_commented'
  | 'user_marked_done'
  | 'user_dropped'
  | 'vault_modified'
  | 'error_occurred';
```

原则：

- Timeline 只存 Workspace，不写入 Vault。
- 用户后续在 Obsidian 中批注，也转换为 Timeline Event。

## 10. Proposal

Proposal 是 AI 的整理建议。

```ts
interface Proposal {
  id: string;
  caseId: string;
  model: string;
  title: string;
  summary: string;
  valueJudgement: 'high' | 'medium' | 'low' | 'drop';
  suggestedActions: ProposalAction[];
  suggestedTargetPath?: string;
  reasoningSummary: string;
  risks?: string[];
  requiresPatch: boolean;
  rawJson?: string;
  createdAt: string;
}

type ProposalAction =
  | 'mark_done'
  | 'drop'
  | 'move'
  | 'append_summary'
  | 'update_frontmatter'
  | 'generate_formal_note'
  | 'merge_later'
  | 'need_more_research';
```

约束：

- Proposal 不包含可执行文件操作。
- Proposal 不直接修改 Vault。
- Proposal 不等于整理后 Markdown。

## 11. （已退役）Patch Intent / Patch Manifest / Apply Manifest

> **`patch_intents` / `patch_manifests` / `apply_manifests` 三张表整体退役（line 1）。** 历史上的设计是：用户在 Proposal 上点某个静态动作 → 后端创建 `patch_intent` → 生成 `patch_manifest`（含 operations / preview）→ 用户审批 → 创建 `apply_manifest` → 写 vault → `rollback` 用 apply_manifest 反演。
>
> 现在的流程是「放权给 AI」：
>
> - AI 直接在 Proposal 里写 `proposedNextActions[]`，前端把这些动作渲染成动态按钮。
> - 用户点某个动作 → `POST /cases/:caseId/invoke-next`，把它委托的 `intent` / `sideEffect` / `payload` 回灌给下一轮 AI。
> - 当 `sideEffect === 'modify_vault'` 时，下一轮 AI 通过 Agent Runtime 直接把 `patch-operations.json` 应用到真 vault，并在 `timeline_events` 留一条 `vault_modified` 事件，CaseDetail 上的 AiRunCard 透明展示这一轮的 rulesSnapshot / inputContext / outputSummary。
> - 回滚交给 Obsidian 原生版本历史 / 文件备份；系统不再保留 `apply_manifests`。
>
> `PatchOperation` 类型本身仍在使用（`@pkws/vault` 的 `applyOperations` 消费它），白名单保持不变：
>
> ```ts
> type PatchOperation =
>   | CreateFileOperation
>   | UpdateFileOperation
>   | MoveFileOperation;
>
> interface CreateFileOperation {
>   type: 'create_file';
>   path: string;
>   content: string;
>   ifExists: 'fail';
> }
>
> interface UpdateFileOperation {
>   type: 'update_file';
>   path: string;
>   beforeHash: string;
>   newContent: string;
> }
>
> interface MoveFileOperation {
>   type: 'move_file';
>   fromPath: string;
>   toPath: string;
>   beforeHash: string;
>   ifTargetExists: 'fail';
> }
> ```
>
> 约束：
>
> - 不支持 delete。
> - 不支持跨 Vault。
> - 执行前必须重新校验 hash。

## 12. AI Run

`ai_runs` 表是 line 2 引入的"每轮 AI 节点透明化"主载体。每次 AI 跑一轮（生成 Proposal / 跑 invoke-next 委派 / regenerate）都写一行，前端 CaseDetail 的 `AiRunCard` 据此把每轮投喂给 AI 的内容、AI 的输出摘要、以及规则快照都展开来。

```ts
interface AiRun {
  id: string;
  caseId: string;
  trigger: 'proposal' | 'invoke_next' | 'regenerate';
  rulesSnapshotJson: string;        // 本轮重读 DB Rules 后的快照（line 2 / Agent Runtime #12）
  inputContextJson: string;         // 投喂给 AI 的 case 摘要 / artifact 内容（按字数截取）
  outputKind: 'proposal' | 'vault_modified' | 'no_op';
  outputSummary: string;            // AI 自己给的简短总结（不要求结构化）
  outputRefId?: string;             // 关联的 proposalId / timelineEventId
  startedAt: string;
  finishedAt?: string;
  createdAt: string;
}
```

说明：

- `rulesSnapshotJson` 是 Agent Runtime 每轮开始时从 `workspace_rules` 表重新读取的快照（用户偏好可以热更新，AI 不会读到过期的 Rules）。
- AI 不再返回 diff / 不再写 `patch_manifests`；`outputKind: 'vault_modified'` 时 `outputRefId` 指向 `timeline_events` 的 `vault_modified` 事件。
- 同一个 Case 的多轮 AI 节点全部保留，`AiRunCard` 按 `startedAt` 倒序展示。

## 13. Case Instruction Summary

Case Instruction Summary 保存当前 Case 的有效用户指示摘要。

```ts
interface CaseInstructionSummary {
  id: string;
  caseId: string;
  summary: string;
  invalidatedItemsJson?: string;
  updatedBy: 'user' | 'system';
  createdAt: string;
  updatedAt: string;
}
```

MVP 原则：

- 用户可见、可编辑。
- 只影响当前 Case。
- 优先级高于 Workspace Rules。

## 14. Workspace Rule

Workspace Rule 是用户手动维护的全局偏好。

```ts
interface WorkspaceRule {
  id: string;
  title: string;
  content: string;
  enabled: boolean;
  priority: number;
  createdAt: string;
  updatedAt: string;
}
```

MVP 不做自动学习写入。

## 15. Job

Job 保存后台任务状态。

```ts
interface Job {
  id: string;
  type: JobType;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  payloadJson: string;
  resultJson?: string;
  errorMessage?: string;
  retryCount: number;
  idempotencyKey?: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
}

type JobType =
  | 'scan_inbox'
  | 'write_pkws_id'
  | 'generate_proposal';
```

> 注：`generate_patch` / `apply_patch` / `rollback_apply` 是已退役的旧补丁编排 Job 类型。Vault 写入现在由 Agent Runtime 在用户通过 `invoke-next` 批准 `modify_vault` 动作后直接做，不再入 Job 队列；回滚交给 Obsidian 原生版本历史。

要求：

- 长任务不绑在 HTTP 请求中。
- 失败原因必须在 UI 可见。
- 同一文件扫描要具备幂等性。

## 16. MVP 最小表清单

```text
settings
knowledge_anchors
artifacts
cases
timeline_events
proposals
case_instruction_summaries
workspace_rules
jobs
agent_sessions
log_entries
ai_runs
```

> 注：`patch_intents` / `patch_manifests` / `apply_manifests` 已在 line 1 退役。AI 直接写真 vault，回滚交给 Obsidian 原生版本历史；vault 写入会在 `timeline_events` 留下 `vault_modified` 事件，对应的"每轮 AI 节点透明化"信息存于 `ai_runs` 表。

## 17. 待后续扩展

MVP 暂不设计或只预留：

- 多 Vault。
- 多用户。
- 多 Artifact Case。
- Project Memory。
- Learned Memory。
- 向量索引。
- Git history 集成。
- 外部系统同步。
