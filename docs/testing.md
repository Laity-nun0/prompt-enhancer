# 测试与维护

## 离线检查

在项目根目录运行：

```powershell
npm ci
npm test
npm run typecheck
npm run build
```

`npm test` 发现 `scripts/*-unit.ts`。当前 35 项检查覆盖上下文隔离、来源配对、目录边界、项目恢复、模型参数、精确范围删除、剪贴板冲突及结果凭证。测试在 `.poc/unit/` 创建合成材料，不调用真实模型，也不需要 OAuth。

CI 使用 Windows runner 和 Node.js 24。不要把真实模型、Hook 安装或需要已有 Desktop 会话的脚本加入 CI。

## 真实模型

使用项目独立登录，会消耗模型额度并生成 `.poc/` 报告。运行前先退出 Companion 或网页服务；同一时刻只运行一个使用独立运行时的验收脚本。

```powershell
$env:POC_VERIFY_MODEL = 'gpt-6.1-sol'
$env:POC_VERIFY_EFFORT = 'low'
npm run verify:model
```

请替换为当前账号实际可用的组合。该检查验证模型和强度贯穿 READY、fork、上下文、优化及范围检查。它使用合成项目，不读写真实 Desktop 对话。

其他合成验收入口：

| 命令 | 目的 |
| --- | --- |
| `npm run verify:quality` | 简短草稿、边界保留及明确需求 |
| `npm run verify:enhancement` | 历史确认方案与源码入口补充 |
| `npm run verify:enhancement-suite` | 八类有据增强评测 |
| `npm run verify:scope` | 删除越界扩写，保留已确认限制 |
| `node scripts/verify-multi-context-real.ts` | 多来源互补、冲突和来源归属 |
| `npm run verify:core` | 原始主线程与临时 fork 隔离探针 |

除 `verify:model` 显式选择组合外，这些历史探针使用独立运行时配置的模型，不代表应用设有默认增强模型。结果属于有限样本，不能证明模型永不出错；报告应检查实际文本和失败原因。

## Electron 验收

使用已安装的 Playwright。它是验收工具，不是产品依赖；可通过 `POC_PLAYWRIGHT_MODULE` 指向本机包目录。

启动应用、完成独立登录并选择项目后退出，再运行：

```powershell
$env:POC_PLAYWRIGHT_MODULE = 'C:\tools\node_modules\playwright'
$env:POC_VERIFY_MODEL = 'gpt-6.1-sol'
node scripts/verify-companion-electron.mjs --lifecycle-only
```

该模式检查真实窗口、无默认模型、手动模型选择、强度档位、窄屏、刷新清空选择、快捷键回调、剪贴板冲突、单实例及退出清理，不调用模型。它会临时修改文本剪贴板，结束后尝试恢复；运行期间不要使用剪贴板或编辑应用草稿。

完整验收还需显式指定一个至少有两条 Desktop 对话的项目：

```powershell
$env:POC_VERIFY_PROJECT = 'C:\projects\example'
$env:POC_VERIFY_EFFORT = 'low'
node scripts/verify-companion-electron.mjs
```

完整检查会调用一次真实增强，并核对草稿、剪贴板、transcript、已读项目和独立主线程。失败时查看 `.poc/companion-electron-results.json`。自动化不代替物理托盘点击、双击入口或人工审阅。

## 维护工具

- `node scripts/import-desktop.ts <transcript绝对路径>`：手动导入已有 Desktop 对话。正常流程使用自动发现或 UI 导入。
- `node scripts/install-desktop-hooks.ts`：可选 Hook 安装，会修改用户级 `hooks.json` 并保留备份。仅在明确需要 Hook 时执行；普通启动、增强及 CI 无需它。

一次性的本机验收脚本和历史交接已归入被忽略的 `.local/archive/`，不作为发布内容。依赖真实会话 ID 的旧结果不可用于证明新版本通过。

## 清理与发布

应用退出后，`.poc/unit/`、schema 探针、截图和测试报告可以删除并重新生成。不要清空 `.poc/codex-home/`、`projects.json` 或 Desktop 注册目录来让测试通过。

上传前运行 `git status --short` 和 `git ls-files`，确认没有 `.poc/`、`.local/`、`node_modules/`、`dist/`、授权链接、凭据、真实会话或 SQLite 数据库。生产构建从源码生成，不提交 `dist/`。
