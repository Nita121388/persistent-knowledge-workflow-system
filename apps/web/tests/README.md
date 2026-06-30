# PKWS E2E 测试

## 快速开始

### 1. 安装依赖

```bash
# 已在 root 执行过 pnpm install
cd apps/web
npx playwright install chromium
```

### 2. 创建本地配置

```bash
cd apps/web
cp e2e.local.example.json e2e.local.json
```

编辑 `e2e.local.json`，填入你的配置（特别是路径和 AI Key）。

### 3. 运行测试

```bash
# 确保后端和前端在运行
pnpm dev

# 在另一个终端运行测试
cd apps/web
pnpm test:e2e:headed
```

## 配置文件

`e2e.local.json` 是本地私有配置，**不要提交到 Git**。配置项：

| 字段 | 说明 | 默认值 |
|---|---|---|
| `baseUrl` | 前端地址 | `http://127.0.0.1:5174` |
| `backend` | 后端地址 | `http://127.0.0.1:3731` |
| `vaultPath` | Obsidian Vault 路径（Setup 用） | `""` |
| `inboxPath` | Clipper Inbox 路径 | `""` |
| `workspacePath` | PKWS Workspace 路径 | `""` |
| `aiApiKey` | AI API Key | `""` |
| `aiBaseUrl` | AI Base URL | `https://api.openai.com/v1` |
| `aiDefaultModel` | 默认模型 | `gpt-4.1-mini` |
| `repeat` | 用例重复次数 | `1` |
| `viewports` | 视口名，逗号分隔 | `desktop-1280` |
| `pageTimeout` | 页面超时（ms） | `30000` |
| `testTimeout` | 测试超时（ms） | `120000` |
| `headed` | 是否显示浏览器 | `false` |

也可以通过环境变量覆盖：
- `E2E_BASE_URL`
- `E2E_VAULT_PATH`
- `E2E_INBOX_PATH`
- `E2E_WORKSPACE_PATH`
- `E2E_AI_API_KEY`
- `E2E_VIEWPORTS`
- `E2E_HEADED=1`
- `E2E_REPEAT`

## 测试文件结构

```
tests/
  e2e/
    setup-wizard.spec.ts   # Setup Wizard 测试
    cases.spec.ts          # Dashboard 和 Case 流程测试
  fixtures/
    config.ts              # 共享 Fixture 和配置
```

## 常用命令

```bash
# 无头模式
pnpm test:e2e

# 显示浏览器
pnpm test:e2e:headed

# Debug 模式
pnpm test:e2e:debug

# UI 模式
pnpm test:e2e:ui

# 指定视口
E2E_VIEWPORTS=desktop-1280,tablet-768 pnpm test:e2e:headed

# 指定重复次数
E2E_REPEAT=3 pnpm test:e2e:headed
```
