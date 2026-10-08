const { isAbsolute, join } = require('node:path');
const { mkdirSync } = require('node:fs');

function stateDirectory(root, env = process.env) {
  const path = env.PROMPT_ENHANCER_STATE_DIR;
  if (path !== undefined && (!path || !isAbsolute(path))) throw new Error('PROMPT_ENHANCER_STATE_DIR 必须是非空绝对路径');
  return path || join(root, '.poc');
}
function loginUrl(value) {
  if (typeof value !== 'string') throw new Error('登录地址无效');
  let url;
  try { url = new URL(value); } catch { throw new Error('登录地址无效'); }
  if (url.protocol !== 'https:' || url.hostname !== 'auth.openai.com' || url.port || url.username || url.password || url.hash) throw new Error('登录地址未通过安全校验');
  return url.href;
}
function backendEnvironment(env = process.env) {
  const backend = { ...env, POC_OPEN_BROWSER: '0' };
  const profile = env.PROMPT_ENHANCER_TEST_PROFILE_DIR;
  if (profile !== undefined) {
    if (!profile || !isAbsolute(profile)) throw new Error('PROMPT_ENHANCER_TEST_PROFILE_DIR 必须是非空绝对路径');
    // 仅隔离 Node 后端；本机实测覆盖 Electron 的 USERPROFILE 会导致 GUI 初始化崩溃。
    const roaming = join(profile, 'AppData', 'Roaming'), local = join(profile, 'AppData', 'Local');
    for (const path of [profile, roaming, local]) mkdirSync(path, { recursive: true });
    Object.assign(backend, { HOME: profile, USERPROFILE: profile, APPDATA: roaming, LOCALAPPDATA: local });
  }
  return backend;
}
function startupFailure(error) {
  if (error?.code === 'EADDRINUSE') return '本机端口 4173 已被占用。请退出正在运行的 Prompt Enhancer 或释放该端口后重试。';
  if (error?.code === 'ENOENT') return '启动运行时失败：未找到 Node.js 或 Codex 可执行文件。请重新安装项目依赖并检查运行时路径。';
  // 启动 RPC 错误可能携带 OAuth 参数；不向页面或日志泄漏原始错误。
  const message = error instanceof Error ? error.message : '';
  if (/登录|account\/login/.test(message)) return 'ChatGPT 登录失败或超时。请检查浏览器登录和网络后重新启动。';
  if (/runtime|运行时|schema/.test(message)) return 'Codex 运行时缺失或版本不匹配。请执行 npm ci 后重试。';
  return '服务启动失败。请检查 Node.js 24、项目依赖、构建产物和状态目录的读写权限后重试。';
}
async function snapshotTestClipboard(clipboard) {
  const formats = await clipboard.availableFormats();
  if (formats.some(format => format !== 'text/plain')) throw new Error('首次验收仅自动处理纯文本剪贴板，请先保存图片、文件或富文本再运行。');
  return await clipboard.readText();
}
async function restoreTestClipboard(clipboard, original, generated) {
  if (typeof original !== 'string' || typeof generated !== 'string' || !generated) return false;
  const formats = await clipboard.availableFormats();
  if (formats.some(format => format !== 'text/plain') || await clipboard.readText() !== generated) return false;
  await clipboard.writeText(original);
  if (await clipboard.readText() !== original) throw new Error('验收剪贴板恢复失败');
  return true;
}
module.exports = { stateDirectory, loginUrl, startupFailure, backendEnvironment, snapshotTestClipboard, restoreTestClipboard };
