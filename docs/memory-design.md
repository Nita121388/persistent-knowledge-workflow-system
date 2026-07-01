# 持续知识工作流系统记忆设计

> 版本：v0.1
> 状态：记忆设计草案
> 阶段：MVP / Phase 2 边界设计
> 更新日期：2026-06-27

## 1. 设计结论

PKWS 需要记忆，但记忆必须分层、可见、可编辑、可撤销。

系统不能做黑箱记忆，也不能让 AI 悄悄改变长期行为。

MVP 只做两类轻量记忆：

```text
Case Instruction Summary
Workspace Rules
```

后续再做：

```text
Learned Memory
Project Memory
```

## 2. 为什么需要记忆

PKWS 的 Case 可以跨越多轮、数天、数周甚至更久。

如果没有记忆，AI 会反复忘记：

- 用户前面要求过什么。
- 这次 Case 已经讨论到哪里。
- 哪些内容不要改。
- 用户偏好的整理结构。
- 用户对 Vault 目录的使用习惯。

因此系统需要记忆来保持连续感。

但记忆如果不可见，会带来风险：

- AI 长期学错用户偏好。
- 用户不知道系统为什么这样建议。
- 错误规则反复影响后续 Case。
- 系统行为变得不可预测。

所以 PKWS 的记忆原则是：

```text
AI 可以建议记住，用户决定是否记住。
```

## 3. 记忆分层

| 层级 | 生命周期 | 来源 | 作用 | MVP 是否做 |
| --- | --- | --- | --- | --- |
| Case Memory | 单个 Case 内 | Timeline / 用户批注 / 用户决策 | 保持当前 Case 连续性 | 做，轻量 |
| Workspace Rules | 全局长期 | 用户手动配置 | 提供稳定偏好和整理规则 | 做，简单 |
| Learned Memory | 跨 Case 长期 | Done 后 AI 提炼，用户审批 | 从完成经验中沉淀偏好 | 后置 |
| Project Memory | 主题或目录级 | 多个相关 Case 归纳 | 支持特定领域偏好 | 后置 |

## 4. Case Memory

### 4.1 定义

Case Memory 是单个 Case 内的短期工作记忆。

它不是独立知识库，而是当前 Case 的有效约束摘要。

示例：

```text
当前 Case 有效指示：
- 先不要合并到正式笔记，先补充调研。
- 工具列表必须保留原始链接。
- 不要写成教程，写成资源清单。
- 目标笔记可能是 Agent 方法论。
```

### 4.2 来源

Case Memory 来源于：

- 用户批注。
- 用户 Comment。
- 用户审批决策。
- 用户 Reject 理由。
- 用户指定目标笔记。
- Timeline 中仍然有效的约束。

### 4.3 MVP 实现边界

MVP 不做复杂自动记忆系统。

MVP 做：

```text
Case Instruction Summary
```

即：在 Case Detail 中展示当前 Case 的有效用户指示摘要。

AI 重新生成 Proposal 时，必须读取该摘要。

### 4.4 用户体验

Case Detail 中展示：

```text
当前有效指示
- 保留原始工具链接
- 先补充调研，不要直接合并
- 输出结构使用：摘要 / 关键观点 / 待确认问题

[编辑] [标记某条已失效]
```

### 4.5 安全边界

- Case Memory 只影响当前 Case。
- Case Done 后不自动变成全局规则。
- 如果要成为长期规则，必须进入 Learned Memory 审批流程。

## 5. Workspace Rules

### 5.1 定义

Workspace Rules 是用户手动配置的全局偏好。

它用于指导 AI 生成 Proposal 和 Patch。

示例：

```text
- 工具类文章默认放到 资源库/工具/
- 技术文章默认整理为：摘要 / 核心观点 / 可执行清单
- 网页收藏必须保留 source_url 和 captured_at
- 不自动删除原始剪藏
- Proposal 不超过 5 条建议
```

### 5.2 MVP 实现边界

MVP 支持用户手动添加、编辑、禁用、删除 Workspace Rules。

MVP 不做 AI 自动学习全局规则。

### 5.3 用户体验

Settings 中增加 Workspace Rules 页面：

```text
Workspace Rules

[启用] 工具类文章默认放到 资源库/工具/
[启用] 网页收藏必须保留 source_url 和 captured_at
[禁用] 新闻类内容默认 Drop

[新增规则]
```

每条规则包含：

```text
rule_id
status: enabled / disabled
title
content
scope: global
created_at
updated_at
```

### 5.4 AI 使用方式

AI 生成 Proposal 前读取：

```text
Global Memory（Workspace Rules）
Case Memory（文件路径 + 用户批注）
Case Instruction Summary（可选）
```

Prompt 中必须明确：

```text
Workspace Rules 是用户长期偏好，优先遵守。
Case Instruction Summary 是当前 Case 的具体指示，如果与 Workspace Rules 冲突，以 Case 指示为准。
```

### 5.5 AI 输入设计（v0.2+）

#### 设计原则

AI 不应接收笔记全文，只接收最小必要信息以降低 Token 消耗并聚焦用户意图。

#### 收藏场景的 AI 输入结构

| 模块 | 内容 | 来源 |
|------|------|------|
| **Global Memory** | 用户长期偏好、知识分类体系 | Workspace Rules |
| **Case Memory** | 文件路径 + 用户批注 | 笔记文件路径 + Rules 声明中定义的批注来源属性 |
| **Workspace Rules** | 全局偏好 + 批注字段声明 | Rules 表 |

示例 Prompt：

```
## File Path
E:/File/.../Clippings/Superpowers.md

## User Annotations
整理到合适的位置

## Workspace Rules
[批注字段声明] 用户在 Clippings 的 frontmatter 中
可能使用"想法|描述"等属性记录初步想法，请参考。
[其他规则] ...
```

批注来源字段不由代码硬编码，而是用户在 Workspace Rules 中声明。

#### 后续交互场景的 AI 输入结构

| 模块 | 内容 |
|------|------|
| **Global Memory** | Workspace Rules（同上） |
| **Case Memory** | 文件路径 + 原始批注 + 历史评论批注元数据 + 本次新批注 |
| **Instructions** | Case Instruction Summary |

#### Token 优化策略

- 不传笔记正文全文
- 只传文件路径让 AI 知晓内容定位
- 只传用户批注（来自 frontmatter 指定属性）传达用户意图
- 正文超过 3000 字时只传前 2000 字摘要

## 6. Learned Memory

### 6.1 定义

Learned Memory 是 AI 从已完成 Case 中提炼出来的长期偏好建议。

它必须经过用户审批才能写入 Workspace Rules。

### 6.2 后续流程

Case Done 后，AI 可以提出：

```text
我观察到你这次要求：
“工具类内容放到 资源库/AI工具/，并保留官网链接。”

是否记住为以后默认规则？

[记住] [仅本 Case] [忽略]
```

### 6.3 为什么后置

自动学习风险高。

MVP 阶段不应该让系统悄悄形成长期偏好。

Learned Memory 放到 Phase 2。

## 7. Project Memory

### 7.1 定义

Project Memory 是某个主题、目录或知识区域内的偏好。

示例：

```text
Agent 方法论项目：
- 默认把工具和方法分开。
- 所有模型相关内容保留发布日期。
- 不把新闻类内容直接写入方法论笔记。
```

### 7.2 后置原因

Project Memory 需要更复杂的范围判断和目录语义。

MVP 不做。

## 8. 冲突规则

记忆优先级：

```text
用户本轮明确指示
  > Case Instruction Summary
  > Workspace Rules
  > AI 默认策略
```

如果冲突无法自动判断，Case 进入 Blocked / Need Review。

示例：

```text
Workspace Rule：工具类文章默认放到 资源库/工具/
Case 指示：这篇先放到 项目/2026/Q3/AI素材/

结果：遵守 Case 指示。
```

## 9. 不写入 Vault

所有记忆默认保存在 Workspace。

不写入 Obsidian 笔记：

- Case Memory。
- Workspace Rules。
- Learned Memory。
- Project Memory。

Vault 中只允许保留最小身份锚点：

```yaml
pkws_id: kw_xxx
```

## 10. MVP 记忆范围

MVP 必须做：

1. Case Detail 展示 Case Instruction Summary。
2. 用户可以编辑 Case Instruction Summary。
3. AI 生成 Proposal 时读取 Case Instruction Summary。
4. Settings 中支持 Workspace Rules。
5. AI 生成 Proposal 时读取 Workspace Rules。
6. 明确记忆不写入 Vault。

MVP 不做：

1. 自动学习长期规则。
2. Project Memory。
3. 多用户共享记忆。
4. 语义检索记忆。
5. 向量数据库。
6. 黑箱用户画像。

## 11. 数据对象草案

### 11.1 Case Instruction Summary

```json
{
  "case_id": "case_23",
  "summary": [
    {
      "id": "ins_001",
      "content": "保留原始工具链接",
      "status": "active",
      "source_event_id": "evt_23_004"
    }
  ],
  "updated_at": "2026-06-27T08:00:00Z"
}
```

### 11.2 Workspace Rule

```json
{
  "rule_id": "rule_001",
  "title": "工具类内容目录规则",
  "content": "工具类文章默认整理到 资源库/工具/，并保留官网链接。",
  "status": "enabled",
  "scope": "global",
  "created_at": "2026-06-27T08:00:00Z",
  "updated_at": "2026-06-27T08:00:00Z"
}
```

## 12. 设计原则

- 记忆必须可见。
- 记忆必须可编辑。
- 记忆必须可禁用。
- AI 只能建议长期记忆，不能自动写入长期记忆。
- Case 内记忆优先于全局规则。
- 记忆不进入 Obsidian Vault。
- 记忆服务于 Case 推进，不服务于陪伴式聊天。
