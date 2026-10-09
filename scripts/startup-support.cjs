const { isAbsolute, join, relative, sep, toNamespacedPath } = require('node:path');
const { homedir } = require('node:os');
const { mkdirSync, existsSync, cpSync, renameSync, rmSync, lstatSync, readFileSync, readdirSync } = require('node:fs');

function stateDirectory(root, env = process.env) {
  const path = env.PROMPT_ENHANCER_STATE_DIR;
  if (path !== undefined && (!path || !isAbsolute(path))) throw new Error('PROMPT_ENHANCER_STATE_DIR 必须是非空绝对路径');
  return path || join(env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'PromptEnhancer', 'state');
}
// 只复制旧版本的正式状态；成功前不启用目标，保留旧数据以便恢复。
function migrateLegacyState(root, target) {
  const legacy = join(root, '.poc');
  if (existsSync(target) || !existsSync(legacy)) return false;
  const items = ['codex-home', 'profile', 'projects.json', 'electron-user-data', 'electron-session-data'].filter(name => existsSync(join(legacy, name)));
  if (!items.length) return false;
  const session = join(legacy, 'ui-session.json');
  if (existsSync(session)) {
    const { pid } = JSON.parse(readFileSync(session, 'utf8'));
    if (Number.isSafeInteger(pid) && pid > 0) {
      let running = false;
      try { process.kill(pid, 0); running = true; } catch (error) { if (error.code !== 'ESRCH') throw error; }
      if (running) throw new Error('请先退出旧版本，再迁移登录和会话状态');
    }
  }
  const staging = target + '.migrating';
  if (existsSync(staging)) throw new Error('上次状态迁移未完成，请保留原 .poc 并检查 ' + staging);
  mkdirSync(staging, { recursive: true });
  try {
    for (const name of items) cpSync(join(legacy, name), join(staging, name), { recursive: true, errorOnExist: true, force: false,
      filter: source => { if (lstatSync(source).isSymbolicLink()) throw new Error('旧状态包含符号链接，请先检查'); return true; } });
    // 固定 Codex 版本的索引保存绝对 rollout 路径，必须随 home 一起重定位。
    const stagedHome = join(staging, 'codex-home');
    if (existsSync(stagedHome)) {
      const { DatabaseSync } = require('node:sqlite');
      for (const name of readdirSync(stagedHome).filter(name => /^state_\d+\.sqlite$/.test(name))) {
        const db = new DatabaseSync(join(stagedHome, name));
        try {
          const columns = db.prepare('PRAGMA table_info(threads)').all().map(row => row.name);
          if (!columns.includes('rollout_path')) throw new Error('旧会话数据库版本不支持迁移，请保留旧数据');
          db.exec('BEGIN IMMEDIATE');
          const update = db.prepare('UPDATE threads SET rollout_path = ? WHERE id = ?');
          for (const row of db.prepare('SELECT id, rollout_path FROM threads').all()) {
            if (typeof row.rollout_path !== 'string' || typeof row.id !== 'string') throw new Error('旧会话索引格式错误');
            const suffix = relative(toNamespacedPath(join(legacy, 'codex-home')), toNamespacedPath(row.rollout_path));
            if (isAbsolute(suffix) || suffix === '..' || suffix.startsWith('..' + sep)) throw new Error('旧会话索引指向数据目录之外，请先检查');
            update.run(join(target, 'codex-home', suffix), row.id);
          }
          db.exec('COMMIT');
          db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
        } finally { db.close(); }
      }
    }
    renameSync(staging, target);
    return true;
  } catch (error) { rmSync(staging, { recursive: true, force: true }); throw error; }
}
function loginUrl(value) {
  if (typeof value !== 'string') throw new Error('登录地址无效');
  let url;
  try { url = new URL(value); } catch { throw new Error('登录地址无效'); }
  if (url.protocol !== 'https:' || url.hostname !== 'auth.openai.com' || url.port || url.username || url.password || url.hash) throw new Error('登录地址未通过安全校验');
  return url.href;
}
function backendEnvironment(env = process.env) {
  const backend = { ...env };
  delete backend.PROMPT_ENHANCER_OPEN_BROWSER;
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
  if (error?.code === 'ENOENT') return '启动运行时失败：未找到 Node.js 或 Codex 可执行文件。请重新下载应用 EXE并检查运行时路径。';
  // 启动 RPC 错误可能携带 OAuth 参数；不向页面或日志泄漏原始错误。
  const message = error instanceof Error ? error.message : '';
  if (/登录|account\/login/.test(message)) return 'ChatGPT 登录失败或超时。请检查浏览器登录和网络后重新启动。';
  if (/runtime|运行时|schema/.test(message)) return 'Codex 运行时缺失或版本不匹配。请重新下载应用 EXE后重试。';
  return '服务启动失败。请检查应用文件和状态目录的读写权限后重试。';
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
module.exports = { stateDirectory, migrateLegacyState, loginUrl, startupFailure, backendEnvironment, snapshotTestClipboard, restoreTestClipboard };
