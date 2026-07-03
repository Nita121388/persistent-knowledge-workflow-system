# 端到端用户业务流图：收藏 → 审批 → 归档

> 对应文档：`docs/use-cases.md`、`docs/interaction-design.md`
> 视角：用户视角，不包含系统内部技术细节

```mermaid
flowchart TB
    subgraph Step1[Step 1: 收藏 • 浏览器]
        A[用户在浏览器阅读网页] --> B[认为内容有价值]
        B --> C[Obsidian Web Clipper<br/>保存到 Vault Inbox]
        C --> D{添加收藏批注?}
        D -->|是| E[补充一句处理目标<br/>例如：帮我判断能否合并]
        D -->|否| F[直接收藏]
    end

    subgraph Step2[Step 2: 后台异步处理 • 用户不需等待]
        G[PKWS 自动发现新笔记]
        G --> H[写入 pkws_id<br/>创建知识追踪锚点]
        H --> I[创建 Case 工作流任务]
        I --> J[AI 分析内容和用户批注]
        J --> K[生成 Proposal 整理提案]
        K --> L[Case 进入 ReviewRequired<br/>等待用户决策]
    end

    subgraph Step3[Step 3: 用户决策 • Web Console]
        M[用户打开 Dashboard<br/>看到 Review 队列]
        M --> N{选择处理方式}
        N -->|Mark Done| O[✓ 确认无需处理<br/>不修改 Vault 文件]
        N -->|Drop| P[✗ 放弃此 Case<br/>不删除原始笔记]
        N -->|Comment| Q[追加新指示<br/>AI 重新分析]
        N -->|Generate Patch| R[需要修改 Vault]
    end

    subgraph Step4[Step 4: 按需生成 Patch]
        R --> S[用户选择具体动作<br/>移动 / 追加摘要 / 生成正式笔记]
        S --> T[AI 生成 Patch Manifest<br/>create_file / update_file / move_file]
        T --> U[Patch Preview<br/>展示：影响哪些文件 + Diff 差异]
    end

    subgraph Step5[Step 5: 安全执行]
        U --> V{用户审批}
        V -->|Approve & Apply| W[Vault Safety Layer]
        V -->|Reject| N
        W --> X[备份快照 → Hash 校验 → 原子写入]
        X --> Y[Case Done<br/>可 Rollback]
        Y --> Z((未来可能 Reopen<br/>关联新 Case))
    end

    E --> G
    F --> G

    style O fill:#90EE90,color:#000
    style Y fill:#90EE90,color:#000
    style P fill:#FFB6C1,color:#000
    style W fill:#FFD700,color:#000
```

## 各步骤用户行为说明

| 步骤 | 用户做什么 | 在哪做 | 需要等多久 |
|------|-----------|--------|-----------|
| **Step 1 收藏** | 点击 Clipper 收藏，可选加批注 | 浏览器 | 即时完成 |
| **Step 2 异步处理** | 不用等，继续做其他事 | — | 几秒 ~ 几分钟 |
| **Step 3 决策** | 查看提案，决定 Mark Done / Drop / 深入处理 | Web Console | 几秒 |
| **Step 4 Patch** | 选择具体动作，预览变更 | Web Console | 几秒 ~ 几十秒 |
| **Step 5 Apply** | 审批，系统安全写入 | Web Console | 即时完成 |

## 关键设计约束

- **Proposal ≠ Patch**：AI 默认只生成 Proposal，只有用户选择具体动作后才生成 Patch
- **Mark Done 不修改 Vault**：用户确认原始笔记已经足够
- **Drop 不删除文件**：放弃处理但不删除内容
- **Apply 前必须 Preview**：用户必须看到影响文件列表和 Diff
- **Apply 后可 Rollback**：Vault Safety Layer 负责安全回滚
