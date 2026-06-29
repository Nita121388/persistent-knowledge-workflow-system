# Vault Safety Layer 设计

> 版本：v0.1
> 状态：安全设计草案
> 阶段：MVP 设计
> 更新日期：2026-06-27

## 1. 设计目标

Vault Safety Layer 是系统写入 Obsidian Vault 的唯一通道。

它的目标不是让 AI 永不犯错，而是保证：

- 写入前用户可预览。
- 写入前系统可校验。
- 写入前有备份。
- 写入后可审计。
- 出错后可恢复。
- 系统只回滚自己造成的影响。

## 2. 基本原则

### 2.1 AI 不直接写 Vault

AI 只能生成：

```text
Proposal
Patch Plan / Patch Manifest 草案
Markdown Draft for Preview
```

AI 不能：

- 调用文件系统写 Vault。
- 决定自动 Apply。
- 绕过 Patch Manifest。
- 绕过用户审批。

### 2.2 Vault 写入必须来自白名单操作

MVP 只允许：

```text
write_pkws_id
create_file
update_file
move_file
rollback_apply
```

其中：

- `write_pkws_id` 是系统默认最小写入。
- `create_file / update_file / move_file` 必须来自用户批准的 Patch Manifest。
- `rollback_apply` 必须来自已有 Apply Manifest。

### 2.3 Workspace 与 Vault 分离

Workspace 保存系统状态。

Vault 保存用户知识内容。

禁止把这些写入 Vault：

- AI 草稿。
- Proposal。
- Patch Manifest。
- Timeline。
- Job 状态。
- 系统日志。
- 临时文件。

## 3. 默认写入：pkws_id

MVP 唯一默认 Vault 修改是补写 `pkws_id`。

示例：

```yaml
---
pkws_id: kw_20260627_x7f3a
---
```

约束：

- 如果已有 `pkws_id`，不得重复写入。
- 不写 `case_id`。
- 不默认写 `pkws_status`。
- 必须尽量保留已有 frontmatter 字段和顺序。
- 写入失败必须在 UI 可见。

## 4. 路径安全

所有 Vault 路径必须满足：

- 必须在配置的 `vaultPath` 内。
- 不允许 `..` 逃逸。
- 不允许跨 Vault。
- 不允许写入 Workspace 目录。
- 不允许写入系统临时目录。
- 不允许覆盖 Obsidian 配置目录，除非未来明确支持。

MVP 建议禁止写入：

```text
.obsidian/
.trash/
.pkws-workspace/
```

## 5. Patch Apply 流程

```text
用户 Approve & Apply
  -> 加载 Patch Manifest
  -> 校验 Patch 状态
  -> 校验路径边界
  -> 校验 operation 白名单
  -> 校验目标文件 hash
  -> 创建备份
  -> 执行原子写入 / 移动
  -> 记录 Apply Manifest
  -> 记录 Timeline Event
```

任何一步失败，都必须停止 Apply，并把 Case 转为 Error 或 Blocked。

## 6. Hash 校验

Patch 生成时记录受影响文件 hash。

Apply 前重新计算 hash。

如果 hash 不一致：

```text
阻止 Apply
-> 标记 VAULT_HASH_CHANGED
-> 提示用户文件已被修改
-> 允许用户重新生成 Patch 或放弃
```

目的：避免覆盖用户在 Obsidian 中的手动修改。

## 7. 备份策略

Apply 前必须为受影响文件创建备份。

备份位置：

```text
.pkws-workspace/
  backups/
    case_xxx/
      apply_xxx/
        manifest.json
        files/
```

备份内容：

| Operation | 备份内容 |
| --- | --- |
| create_file | 记录目标不存在，无需备份文件 |
| update_file | 备份更新前文件内容 |
| move_file | 备份移动前文件内容和原路径 |

备份 Manifest 至少记录：

```json
{
  "applyManifestId": "apply_20260627_001",
  "caseId": "case_20260627_001",
  "patchManifestId": "patch_20260627_001",
  "operations": [],
  "createdAt": "2026-06-27T10:30:00.000Z"
}
```

## 8. 原子写入

文件写入必须尽量使用：

```text
write-file-atomic
proper-lockfile
fs-extra
```

要求：

- 写入前获取文件锁。
- 写入临时文件后原子替换。
- 写入失败不留下半成品。
- 移动文件时目标存在则失败。

## 9. Operation 安全规则

### 9.1 create_file

允许：

- 创建新 Markdown 文件。
- 创建必要的父目录。

禁止：

- 覆盖已有文件。
- 创建 Vault 外文件。
- 创建隐藏系统文件。

默认策略：

```text
ifExists: fail
```

### 9.2 update_file

允许：

- 更新已有 Markdown 文件。
- 更新 frontmatter。
- 追加摘要。

必须：

- 校验 beforeHash。
- 展示 diff。
- 备份旧内容。

禁止：

- 未经 diff 预览直接写入。
- 更新二进制文件。
- 删除正文大段内容，除非未来有专门高风险审批。

### 9.3 move_file

允许：

- 在同一个 Vault 内移动 Markdown 文件。

必须：

- 校验源文件存在。
- 校验源文件 beforeHash。
- 校验目标不存在。
- 移动后更新 Knowledge Anchor 的 currentVaultPath。

禁止：

- 跨 Vault 移动。
- 覆盖目标文件。
- 自动修复所有反向链接。

## 10. Rollback 流程

```text
用户请求 Rollback
  -> 加载 Apply Manifest
  -> 校验该 Apply 未回滚
  -> 检查当前目标文件是否被用户修改
  -> 无冲突则恢复备份 / 删除系统新增文件 / 移回原路径
  -> 记录 RolledBack Event
```

Rollback 行为：

| 原操作 | Rollback 行为 |
| --- | --- |
| create_file | 删除系统创建的文件；若文件已被用户修改则阻止 |
| update_file | 恢复备份内容；若当前文件 hash 已变化则阻止 |
| move_file | 移回原路径；若目标或源路径冲突则阻止 |

## 11. Rollback 边界

MVP 只承诺：

- 回滚本系统某次 Apply 造成的变更。
- 回滚 create_file / update_file / move_file。
- 在无用户手动冲突时恢复。

MVP 不承诺：

- 恢复整个 Vault 到某天状态。
- 回滚其他工具造成的修改。
- 合并用户手动编辑后的复杂冲突。
- 自动修复所有 Obsidian 链接。

## 12. 冲突处理

冲突场景：

```text
目标文件 hash 改变
目标路径已存在
源文件不存在
目标文件被用户编辑
备份文件丢失
Workspace 数据不一致
```

处理原则：

- 不静默失败。
- 不强行覆盖。
- Case 进入 Error 或 Blocked。
- Timeline 记录冲突原因。
- UI 给出下一步选项。

可选下一步：

```text
重新扫描
重新生成 Patch
另存为新文件
手动重新映射
放弃 Apply
```

## 13. Timeline 记录

Vault Safety Layer 必须记录这些事件：

```text
pkws_id_written
patch_approved
apply_started
apply_completed
rollback_requested
rollback_completed
error_occurred
```

事件必须包含：

- actor。
- operation 类型。
- 影响路径。
- 错误码。
- applyManifestId 或 patchManifestId。

## 14. UI 呈现要求

Apply 前必须展示：

- 操作类型。
- 影响文件列表。
- 新增 / 修改 / 移动路径。
- diff 或 Markdown 预览。
- 是否会创建备份。

Rollback 前必须展示：

- 将恢复哪个 Apply。
- 将影响哪些文件。
- 是否检测到冲突。
- 回滚后 Case 状态。

## 15. 测试用例

MVP 至少测试：

1. 为无 frontmatter 笔记写入 `pkws_id`。
2. 为已有 frontmatter 笔记写入 `pkws_id`。
3. 已有 `pkws_id` 时重复扫描不重复写入。
4. create_file 目标不存在时成功。
5. create_file 目标存在时失败。
6. update_file hash 一致时成功。
7. update_file hash 变化时失败。
8. move_file 目标不存在时成功。
9. move_file 目标存在时失败。
10. Rollback create_file 删除系统新增文件。
11. Rollback update_file 恢复备份。
12. Rollback move_file 移回原路径。
13. Rollback 时目标被用户修改则阻止。

## 16. 开发红线

实现阶段不得出现：

- AI 调用直接写文件。
- Controller 直接写 Vault 文件。
- 前端传任意路径让后端写入。
- 没有 Patch Manifest 的 Apply。
- 没有备份的 update / move。
- 没有 hash 校验的覆盖写入。
- Drop 删除 Vault 文件。
- Mark Done 修改 Vault 文件。
