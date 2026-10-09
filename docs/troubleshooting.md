# 启动排查

## 首次使用

1. 在 Windows x64 双击 `Prompt-Enhancer-Windows-x64.exe`，无需安装、CMD 或配套目录，也无需另行安装 Node.js 或 Codex CLI。
2. 在浏览器完成独立 Codex OAuth 登录，回到应用选择项目、对话、增强模型和推理强度。
3. 输入一个简短草稿，完成增强并审阅结果。后续可使用托盘或已注册的全局快捷键唤起窗口。

本仓库也支持源码开发：安装 Node.js 24+，运行 `npm ci`、`npm run build`、`npm run desktop`；`npm run dev` 会构建并启动桌面。`npm run prepare:desktop` 可检查源码开发环境，首次可能下载 Electron。内部 `127.0.0.1:4173` 仅供 Electron 界面使用。

## 常见问题

| 情况 | 排查方式 |
| --- | --- |
| 源码开发找不到 node 或版本过低 | 安装 Node.js 24+，重新打开终端核对 PATH；免安装版无需这一步 |
| 源码依赖或打包下载失败 | 查看终端报错，确认可访问 npm、Electron 下载及构建工具服务；不要复制他人的凭据代替登录 |
| 源码启动缺少 `dist/index.html` | 在项目根目录运行 `npm run build` |
| 找不到 Codex runtime | 免安装版重新下载完整 EXE；源码开发确认 Windows x64 并重新执行 `npm ci`，不要使用 `--omit=optional` |
| 4173 端口被占用 | 退出自己先前启动的开发服务或 Prompt Enhancer 后再试，不要直接结束不明来源进程 |
| 浏览器登录没有打开 | 点击启动页的登录入口，或仅在本机打开状态目录中的 `login-url.txt` 链接；该链接不可分享，登录结束后会被清理 |
| 登录超时、网络或账号权限报错 | 核查网络和账号是否能使用 Codex，重启应用重新登录；启动等待上限为 15 分钟 |
| 项目没有列出 Desktop 对话 | 确认项目路径匹配、本机有该项目历史；重新选择项目进行发现，或在更多选项中导入对应 transcript |
| 增强按钮不可点击 | 先选择项目、有消息的上下文、模型及推理强度，并输入非空草稿 |
| 快捷键冲突 | 首选 `Ctrl+Alt+E`，冲突时尝试 `Alt+Shift+E`；以窗口显示为准，都不可用时从托盘打开应用 |
| 关闭窗口后服务仍在 | 关闭窗口会隐藏到托盘，托盘“退出”才会结束后台 |

当前支持 Windows x64，不支持 Linux/macOS、Windows ARM64 或多人共享的公网服务。各使用者需要自己的账号与模型权限。

## 旧版本状态与迁移

默认运行状态位于 `%LOCALAPPDATA%\PromptEnhancer\state`。`PROMPT_ENHANCER_STATE_DIR` 可覆盖为非空绝对路径，用于隔离实例和验收。

旧源码目录的 `.poc/` 可能包含实际登录和会话。迁移只处理 `codex-home/`、`profile/`、`projects.json`、`electron-user-data/` 和 `electron-session-data/`，不复制测试材料、不删除旧源。测试输出使用 `.local/`；验收环境变量统一使用 `PROMPT_ENHANCER_` 前缀。不要通过清空新旧登录目录来排查启动问题；先确认应用已退出并备份需要保留的账号数据。
