# 架构与开发边界

## 运行链

`启动Companion.cmd` → `scripts/start-desktop.vbs` → `scripts/start-desktop.cjs` → `desktop/main.cjs` → `server/index.ts` → 独立 Codex App Server。

Electron 读取 `dist/`，网页开发入口使用 Vite。两者共用 `127.0.0.1:4173`，服务先独占端口再初始化运行时，防止两个入口并发写入状态。

`server/app-server.ts` 使用项目内固定版本 CLI，单独设置配置、用户目录及认证存储。优化运行时禁用 Hook、插件、应用、多智能体、shell 等能力。升级 CLI 时须核对所用 JSON-RPC schema，并运行模型目录及真实增强验收。

## 三类对话

| 对象 | 用途 | 允许的动作 |
| --- | --- | --- |
| Desktop session | 用户选定的官方客户端历史 | 读取 transcript；不得以其 ID 发起模型 RPC |
| Enhancer 独立主线程 | 没有可用 Desktop 上下文时的对话 | 在独立对话模式下发送、恢复和读取 |
| Optimizer 临时 fork | 上下文分析、草稿改写及范围检查 | 只读、临时；结束后取消订阅 |

Desktop 增强先创建只含固定 READY 消息的独立基底，再产生临时 fork。不能改成继承其他用户主线程后声称上下文隔离。基底结束后归档；原 Desktop 对话不增加 Turn。

## 增强流程

1. 校验请求中的项目、线程、所选对话和显式模型/强度。
2. 重新读取所选 transcript，核对会话身份、项目和内容完整性。
3. 创建独立基底与临时 fork，把所选历史作为数据传入。
4. Node 只读采集项目结构及模型选定的相关源码。
5. Optimizer 保留当前草稿的全部动作和限制，只补充有据的信息。
6. Scope Validator 返回待删除的连续原文片段；Node 只执行唯一匹配的删除，不接受替换或插入。
7. 核对主线程历史、已读源码、transcript 和来源配对，再交付结果。
8. Electron 兑换一次性结果凭证后复制文本；renderer 不能直接提交任意文本到剪贴板接口。

最新草稿决定当前任务。历史助手建议、旧轮次的临时限制、源码中已有功能，不能自动变成本次用户要求。多个对话有未解决冲突时应保留分歧，不能替用户定案。

## 读取上限

- 草稿最多 12000 字符；多对话最多 5 个来源，序列化上下文合计最多 256 KiB。
- 项目文件选择最多 3 轮、10 个目录、16 个文件。
- 单文件正文最多 24 KiB，总正文最多 96 KiB；目录最多返回 100 项。
- 拒绝越界路径、符号链接/目录联接、明显凭据、依赖和构建产物。
- 截断及读取问题进入警告。只核对本次已读文件，不为校验而递归读取整个项目。

## 本地状态

| 位置 | 内容 | 是否提交 |
| --- | --- | --- |
| `.poc/codex-home/` | 独立配置、登录和线程历史 | 否 |
| `.poc/projects.json` | 项目路径及独立 Thread ID 映射 | 否 |
| `.poc/profile/`、`.poc/fixture/` | 隔离用户目录和合成项目 | 否 |
| `.poc/unit/` 及报告 | 测试临时材料 | 否 |
| `%LOCALAPPDATA%\PromptEnhancer\desktop-sessions` | Desktop 上下文注册与副本 | 否 |
| `.local/` | 本机归档及维护工具 | 否 |

项目切换按规范化路径保存映射。恢复时先 `thread/resume`，不覆盖原 cwd，再核对归属；临时服务或网络故障不能覆盖旧 Thread ID。只有确定旧线程不可恢复时才新建并提示。

自动发现只解析目标项目的 Desktop 会话正文，忽略 CLI、子智能体和其他项目正文。Hook 是可选采集方式，不是正常使用的前置条件；安装脚本会修改用户级 Hook 配置，不能作为普通启动或测试步骤执行。

## 界面与维护

模型列表及强度以 `model/list` 为准，不维护静态名单或默认增强模型。`defaultReasoningEffort` 仅初始化用户已选模型的强度。独立主线程的发送行为与增强模型选择分开。

关闭窗口隐藏到托盘；真正退出时仅清理本应用拥有的进程。重复启动唤起原窗口。不要杀掉占用端口的其他服务，不在后台轮询剪贴板。

UI 的视觉参考包括 [Uiverse Galaxy](https://github.com/uiverse-io/galaxy) 和其深色消息输入组件；本项目未复制其代码。图标使用 Lucide，窗口图标位于 `desktop/icon.png`。
