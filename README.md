# Prompt Enhancer

Windows 上的 Codex 提问增强桌面伴侣。选择本地项目及已有 Codex Desktop 对话，把尚未发送的草稿补充为更明确、有上下文依据的提问。

本项目是独立的 Electron 应用，不是安装到 Codex Desktop 内的正式插件。它不操作 Codex 输入框或发送按钮；增强成功后复制结果，由你审阅并手动粘贴、发送。

## 环境要求

- Windows x64。
- Node.js 24 或更新版本，以及 npm。
- Codex Desktop 已有项目对话，或在本应用中建立独立对话作为上下文。
- 可登录 Codex 的 ChatGPT 账号及模型访问权限。增强需要联网并消耗模型额度，不是离线处理。

独立 Codex CLI 固定为项目依赖 `@openai/codex@0.161.0`。程序不使用 Desktop 内置运行时，也不复制其登录凭据。

## 安装与启动

```powershell
git clone https://github.com/Laity-nun0/prompt-enhancer.git
cd prompt-enhancer
npm ci
npm run build
npm run desktop
```

也可在安装、构建完成后双击 `启动Companion.cmd`。首次启动会通过浏览器完成独立 OAuth 登录，无需手动执行 Codex CLI 登录命令。

开发入口为 `npm run dev`，地址是 `http://127.0.0.1:4173`。双击 `启动PoC.cmd` 会同时打开浏览器。桌面和网页入口共用端口及本地状态，不能同时运行。

## 使用

1. 选择本地项目，并确认需要使用的 Desktop 对话。可启用多对话上下文，手动选择同项目的 1–5 条对话。
2. 输入草稿，或在 Codex Desktop 复制草稿后按 `Ctrl+Shift+E` 唤起伴侣。快捷键冲突时尝试 `Ctrl+Alt+Shift+E`，以窗口显示为准。
3. 手动选择增强模型和推理强度，再点击“增强提问”或按 `Ctrl+Enter`。
4. 查看增强文本、使用的依据、假设和警告。桌面入口在完整校验成功后复制结果，返回 Codex Desktop 审阅、粘贴并发送。

模型与可用推理强度从独立运行时动态读取。没有默认增强模型，不记忆上次选择；启动或刷新页面后需重新选择。目录当前包含 GPT-6.1 Sol，实际可用性取决于运行时和账号。未选择或不兼容的组合会被拒绝，不自动回退。

选定模型时以运行时建议值初始化推理强度，可继续调整。更换模型或上下文会撤回已有增强结果。关闭窗口隐藏到托盘；通过托盘“退出”才能关闭后台。源码更新后重新构建并重启。

## 数据与边界

- 仅读取选中项目的相关文件及选定对话；不修改项目文件，不向 Desktop 对话写入消息。
- 每次增强前同步所选对话。范围检查只删除未经授权的扩写；完整校验失败时保留草稿，不交付未经校验的候选。
- 最终文本仍需用户审阅；模型的范围判断和事实理解可能出错。
- 项目目录下 `.poc/` 保存独立登录、会话映射、临时项目及报告；Desktop 上下文副本保存在 `%LOCALAPPDATA%\PromptEnhancer\desktop-sessions`。
- `.poc/`、`.local/`、依赖、构建产物和凭据均不提交。删除 `.poc/codex-home` 会丢失本应用的独立登录和会话状态。

## 开发

```powershell
npm test
npm run typecheck
npm run build
```

`npm test` 只执行离线单元测试，不登录、不调用模型。GitHub Actions 在 Windows 和 Node.js 24 上执行相同检查。真实模型与 Electron 验收另见[测试说明](docs/testing.md)。

```text
desktop/     Electron 宿主、托盘与剪贴板桥接
src/         React 界面与客户端逻辑
server/      本地 API、独立运行时及上下文增强
scripts/     启动、维护工具、测试和合成评测用例
docs/        架构与测试说明
```

实现和修改约束见[架构说明](docs/architecture.md)。当前提供源码运行方式，尚未提供安装包或开机自启。
