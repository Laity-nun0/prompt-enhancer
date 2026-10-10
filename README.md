# Prompt Enhancer

Windows 上的 Codex 提问增强桌面伴侣。选择本地项目及已有 Codex Desktop 对话，把尚未发送的草稿补充为更明确、有上下文依据的提问。

本项目是独立的 Electron 应用，不是安装到 Codex Desktop 内的插件。它不操作 Codex 输入框或发送按钮；增强成功后复制结果，由你审阅并手动粘贴、发送。

## 下载与启动

支持 Windows x64。下载 [免安装 EXE](https://github.com/Laity-nun0/prompt-enhancer/releases/latest/download/Prompt-Enhancer-Windows-x64.exe)，双击 `Prompt-Enhancer-Windows-x64.exe` 即可使用，无需安装、CMD 或配套目录。程序自带 Electron、Node 后端和固定版本的独立 Codex 可执行文件，无需另外安装 Node.js、npm 或 Codex CLI。

启动时会自动将内部资源展开到系统临时目录，首次启动可能稍慢；退出后自动清理。运行状态与账号数据保存在用户目录，替换 EXE 不会删除这些数据。

首次启动会通过浏览器完成独立 OAuth 登录。你需要可登录 Codex 的 ChatGPT 账号及模型访问权限；增强需要联网并消耗模型额度。程序不使用 Codex Desktop 内置运行时，也不复制其登录凭据。

下载与版本记录见 [GitHub Releases](https://github.com/Laity-nun0/prompt-enhancer/releases)。日常操作在桌面窗口完成，不需要打开网页。源码构建与排查见下文及[启动排查](docs/troubleshooting.md)。

## 使用

1. 点击“切换”，再点“选择文件夹”从 Windows 文件夹选择器选取项目，点击“打开项目”；也可手动输入绝对路径。确认需要使用的 Desktop 对话。可启用多对话上下文，手动选择同项目的 1–5 条对话。
2. 输入草稿，或在 Codex Desktop 复制草稿后按 `Ctrl+Alt+E` 唤起伴侣。快捷键冲突时尝试 `Alt+Shift+E`，以窗口显示为准。
3. 手动选择增强模型和推理强度，再点击“增强提问”或按 `Ctrl+Enter`。
4. 查看增强文本、使用的依据、假设和警告。完整校验成功后应用复制结果，返回 Codex Desktop 审阅、粘贴并发送。

模型与可用推理强度从独立运行时动态读取。没有默认增强模型，不记忆上次选择；启动或刷新界面后需重新选择。目录当前包含 GPT-6.1 Sol，实际可用性取决于运行时和账号。未选择或不兼容的组合会被拒绝，不自动回退。

选定模型时以运行时建议值初始化推理强度，可继续调整。更换模型或上下文会撤回已有增强结果。关闭窗口隐藏到托盘；通过托盘“退出”才能关闭后台。

## 数据与边界

- 草稿、所选对话中的用户/助手消息及按需读取的项目结构和源码，会通过独立 Codex 运行时发送给 OpenAI 模型。只有符合你及所属组织数据政策的材料才应用于增强。
- 仅读取选中项目的相关文件及选定对话；不修改项目文件，不向 Desktop 对话写入消息。
- 每次增强前同步所选对话。范围检查只删除未经授权的扩写；完整校验失败时保留草稿，不交付未经校验的候选。
- 最终文本仍需用户审阅；模型的范围判断和事实理解可能出错。
- 默认运行状态保存在 `%LOCALAPPDATA%\PromptEnhancer\state`，包括独立登录、项目映射和 Electron 缓存。Desktop 上下文副本保存在 `%LOCALAPPDATA%\PromptEnhancer\desktop-sessions`。
- 从旧源码版本启动时，会将 `.poc/` 中的 `codex-home/`、`profile/`、`projects.json`、`electron-user-data/` 和 `electron-session-data/` 迁移到新状态目录；不迁移测试数据，也不删除旧源。清理旧目录前应确认新状态可用并保留必要备份。
- `PROMPT_ENHANCER_STATE_DIR` 可指定非空绝对路径以隔离运行状态。删除状态目录中的 `codex-home/` 会丢失本应用的独立登录和会话状态。

上下文读取会排除 `.local/`、常见凭据目录和文件，但不会自动遵守项目的全部 `.gitignore`，也不能识别任意名称的秘密。详细说明见[数据处理说明](docs/privacy.md)。

## 开发与打包

源码开发需要 Node.js 24 或更新版本，以及 npm：

```powershell
git clone https://github.com/Laity-nun0/prompt-enhancer.git
cd prompt-enhancer
npm ci
npm run build
npm run desktop
```

`npm run dev` 会构建并启动桌面应用。`127.0.0.1:4173` 是 Electron 界面的内部服务，每个实例使用随机授权 token，仅 Electron 注入；普通本机浏览器访问返回 403。源码更新后需重新构建并重启。

```powershell
npm test
npm run typecheck
npm run package:dir
npm run package:win
```

`package:win` 生成免安装单文件 `release/Prompt-Enhancer-Windows-x64.exe`，它是正式发布产物。`package:dir` 仅用于调试，生成 `release/win-unpacked/Prompt Enhancer.exe`，调试版需要保留整个目录。打包可能需要下载 Electron 和构建工具。当前 EXE 未使用代码签名证书，Windows 可能显示未知发布者提示。测试材料放在 `.local/`，不随产品打包；源码仓库不提交账号状态、依赖和构建产物，EXE 通过 Releases 分发。

`npm test` 只执行离线单元测试，不登录、不调用模型。真实模型与 Electron 验收见[测试说明](docs/testing.md)，已验证及未覆盖范围见[发布前验证记录](docs/validation.md)。

```text
desktop/     Electron 宿主、托盘与剪贴板桥接
src/         React 界面与客户端逻辑
server/      本地 API、独立运行时及上下文增强
scripts/     构建、维护工具、测试和合成评测用例
docs/        架构与测试说明
release/     本地打包产物
```

实现和修改约束见[架构说明](docs/architecture.md)。

## 许可证

本项目采用 [MIT License](LICENSE)。依赖组件保留各自的许可证；本项目许可证不授予 OpenAI 服务访问权，也不替代账号及服务使用条款。
