import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';

// Node 24 原生运行 TypeScript；无需构建工具或第三方依赖。
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const state = join(root, '.poc');
const home = join(state, 'codex-home');
const profile = join(state, 'profile');
const cwd = join(state, 'fixture');
for (const dir of [home, profile, cwd, join(profile, 'AppData', 'Roaming'), join(profile, 'AppData', 'Local')]) mkdirSync(dir, { recursive: true });

// 使用项目固定版本的独立 CLI，不查找或读取 Desktop 的运行时或内部文件。
const exe = process.env.POC_CODEX_EXE || join(root, 'node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe');
assert(existsSync(exe), '未找到独立 Codex runtime，可由宿主设置 POC_CODEX_EXE。');
const version = spawnSync(exe, ['--version'], { encoding: 'utf8', windowsHide: true }).stdout.trim();
assert.equal(version, 'codex-cli 0.161.0', 'runtime 版本变化，需要重新核验 schema。');

// 同时隔离用户级 Skill 搜索目录；不复制现有配置、凭据或插件。
const env: NodeJS.ProcessEnv = { ...process.env, CODEX_HOME: home, HOME: profile, USERPROFILE: profile,
  APPDATA: join(profile, 'AppData', 'Roaming'), LOCALAPPDATA: join(profile, 'AppData', 'Local') };
for (const key of Object.keys(env)) {
  if (/^(OPENAI_|CODEX_|CHATGPT_)/.test(key) && key !== 'CODEX_HOME') delete env[key];
}
writeFileSync(join(home, 'config.toml'), `cli_auth_credentials_store = "file"
web_search = "disabled"
[features]
hooks = false
plugins = false
remote_plugin = false
apps = false
multi_agent = false
memories = false
shell_tool = false
shell_snapshot = false
browser_use = false
browser_use_external = false
computer_use = false
image_generation = false
workspace_dependencies = false
`);
if (!existsSync(join(cwd, 'README.md'))) {
  writeFileSync(join(cwd, 'README.md'), '# 小型项目管理应用\n当前使用 TypeScript，领域函数置于 src，数据保存在内存中。现有项目实体只有 id 和 name。\n');
  mkdirSync(join(cwd, 'src'), { recursive: true });
  writeFileSync(join(cwd, 'src', 'projects.ts'), 'export type Project = { id: string; name: string };\nexport const projects: Project[] = [];\n');
}
function snapshot(dir: string, prefix = ''): Record<string, string> {
  const files: Record<string, string> = {};
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name))) {
    const name = prefix + entry.name;
    if (entry.isDirectory()) Object.assign(files, snapshot(join(dir, entry.name), name + '/'));
    else files[name] = readFileSync(join(dir, entry.name), 'utf8');
  }
  return files;
}

export async function createRuntime(signal?: AbortSignal) {
signal?.throwIfAborted();
function step(name: string, detail: any = {}) { console.log(JSON.stringify({step:name,...detail})); }
const child = spawn(exe, ['app-server', '--stdio'], { cwd, env, windowsHide: true, stdio: ['pipe','pipe','pipe'] });
let seq = 0;
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
const events: any[] = [];
let stderr = '';
let closed = false;
let stopping: Promise<void> | undefined;
function close() {
  return stopping ||= new Promise<void>(done => {
    if (closed) { done(); return; }
    const timer = setTimeout(() => {
      if (process.platform === 'win32' && child.pid) {
        spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on('error', () => child.kill());
      } else child.kill();
    }, 3000);
    child.once('exit', () => { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); done(); });
    child.stdin.end();
  });
}
function onAbort() { void close(); }
signal?.addEventListener('abort', onAbort, { once: true });
child.stderr.on('data', data => { stderr = (stderr + data.toString()).slice(-16000); });
child.on('error', failPending);
child.on('exit', code => { closed = true; failPending(new Error(`App Server 退出：${code}`)); });
function failPending(error: Error) {
  for (const p of pending.values()) { clearTimeout(p.timer); p.reject(error); }
  pending.clear();
}
createInterface({ input: child.stdout }).on('line', line => {
  let m: any;
  try { m = JSON.parse(line); } catch { return; }
  if (m.method && m.id !== undefined) {
    // 本验证不批准任何工具、提权或用户输入请求。
    events.push({ method: 'probe/unexpectedRequest', params: { method: m.method } });
    child.stdin.write(JSON.stringify({ id: m.id, error: { code: -32601, message: '只读核心验证不支持此请求' } }) + '\n');
  } else if (m.id !== undefined) {
    const p = pending.get(m.id);
    if (p) { clearTimeout(p.timer); pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); }
  } else events.push(m);
});
function rpc(method: string, params: any = {}): Promise<any> {
  if (closed) return Promise.reject(new Error('App Server 已关闭'));
  return new Promise((resolve, reject) => {
    const id = ++seq;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} 超时`)); }, 60000);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
  });
}
async function waitEvent(method: string, matches: (p: any) => boolean, timeout = 300000): Promise<any> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const event = events.find(e => e.method === method && matches(e.params));
    if (event) return event.params;
    if (closed) throw new Error('等待事件时 App Server 已退出');
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error(`等待 ${method} 超时`);
}
async function turn(threadId: string, text: string, outputSchema?: any, selection?: { model: string; effort: string }) {
  const { turn } = await rpc('turn/start', { threadId, input: [{ type: 'text', text }],
    sandboxPolicy: { type: 'readOnly', networkAccess: false }, approvalPolicy: 'never', ...(outputSchema ? { outputSchema } : {}),
    ...(selection ? { model: selection.model, effort: selection.effort } : {}) });
  let completed: any;
  try { completed = await waitEvent('turn/completed', p => p.threadId === threadId && p.turn.id === turn.id); }
  catch (error) { await rpc('turn/interrupt', { threadId, turnId: turn.id }).catch(() => {}); throw error; }
  assert.equal(completed.turn.status, 'completed', JSON.stringify(completed.turn.error));
  const items = events.filter(e => e.method === 'item/completed' && e.params.threadId === threadId && e.params.turnId === turn.id).map(e => e.params.item);
  assert(items.every(i => ['userMessage','agentMessage','reasoning'].includes(i.type)), '检测到意外工具执行');
  const messages = items.filter(i => i.type === 'agentMessage');
  assert(messages.length, '未收到助手最终消息');
  return { id: turn.id, text: messages.at(-1).text };
}
async function initialize() {
  const init = await rpc('initialize', { clientInfo: { name: 'prompt_enhancer_core_probe', version: '0.1.0' } });
  child.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n');
  step('initialize', { userAgent: init.userAgent });
  let account = await rpc('account/read', { refreshToken: false });
  step('account/read', { authenticated: !!account.account, requiresOpenaiAuth: account.requiresOpenaiAuth });
  if (!account.account) {
    const login = await rpc('account/login/start', { type: 'chatgpt' });
    assert.equal(login.type, 'chatgpt');
    const url = new URL(login.authUrl);
    assert.equal(url.protocol, 'https:');
    assert.equal(url.hostname, 'auth.openai.com');
    // 授权地址仅存于被 gitignore 的本地状态，不写入结果报告。
    writeFileSync(join(state, 'login-url.txt'), login.authUrl);
    step('waiting-for-browser-login');
    const browser = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Start-Process -FilePath $env:POC_AUTH_URL'],
      { env: { ...process.env, POC_AUTH_URL: login.authUrl }, windowsHide: true, stdio: 'ignore' });
    browser.on('error', () => console.log('浏览器未能自动打开，请由宿主打开 .poc/login-url.txt 中的地址。'));
    browser.on('exit', code => {
      if (code !== 0) console.log('浏览器启动被系统阻止，请由宿主打开 .poc/login-url.txt 中的地址；登录流程仍在等待。');
    });
    const result = await waitEvent('account/login/completed', p => p.loginId === login.loginId, 15 * 60000);
    assert(result.success, result.error || '浏览器登录失败');
    account = await rpc('account/read', { refreshToken: false });
    assert.equal(account.account?.type, 'chatgpt');
    step('account/login/completed', { authenticated: true });
  }

}
try { await initialize(); } catch(error) { await close(); throw error; }
return { rpc, turn, cwd, snapshot: () => snapshot(cwd), close, events };
}
