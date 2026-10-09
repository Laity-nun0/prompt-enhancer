import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { optimizerInstructions, outputSchema } from '../server/optimizer.ts';

// Node 24 原生运行 TypeScript；无需构建工具或第三方依赖。
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const state = join(root, '.local', 'core-probe');
const home = join(state, 'codex-home');
const profile = join(state, 'profile');
const cwd = join(state, 'fixture');
const reportFile = join(state, 'result.json');
for (const dir of [home, profile, cwd, join(profile, 'AppData', 'Roaming'), join(profile, 'AppData', 'Local')]) mkdirSync(dir, { recursive: true });

// 仅发现独立 npm CLI，不查找或读取 Desktop 的运行时或内部文件。
const exe = process.env.PROMPT_ENHANCER_CODEX_EXE || join(root, 'node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe');
assert(existsSync(exe), '未找到独立 Codex runtime，可由宿主设置 PROMPT_ENHANCER_CODEX_EXE。');
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
const initialFiles = snapshot(cwd);
const report: Record<string, any> = { status: 'running', version, startedAt: new Date().toISOString(), steps: [] };
function save() { writeFileSync(reportFile, JSON.stringify(report, null, 2)); }
function step(name: string, detail: any = {}) {
  report.steps.push({ name, ...detail }); save(); console.log(JSON.stringify({ step: name, ...detail }));
}
const child = spawn(exe, ['app-server', '--stdio'], { cwd, env, windowsHide: true, stdio: ['pipe','pipe','pipe'] });
let seq = 0;
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
const events: any[] = [];
let stderr = '';
let closed = false;
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
async function turn(threadId: string, text: string, outputSchema?: any) {
  const { turn } = await rpc('turn/start', { threadId, input: [{ type: 'text', text }],
    sandboxPolicy: { type: 'readOnly', networkAccess: false }, approvalPolicy: 'never', ...(outputSchema ? { outputSchema } : {}) });
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
const schema = outputSchema;
let forkId: string | undefined;
try {
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
    const browser = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Start-Process -FilePath $env:PROMPT_ENHANCER_AUTH_URL'],
      { env: { ...process.env, PROMPT_ENHANCER_AUTH_URL: login.authUrl }, windowsHide: true, stdio: 'ignore' });
    browser.on('error', () => console.log('浏览器未能自动打开，请由宿主打开 .local/core-probe/login-url.txt 中的地址。'));
    browser.on('exit', code => {
      if (code !== 0) console.log('浏览器启动被系统阻止，请由宿主打开 .local/core-probe/login-url.txt 中的地址；登录流程仍在等待。');
    });
    const result = await waitEvent('account/login/completed', p => p.loginId === login.loginId, 15 * 60000);
    assert(result.success, result.error || '浏览器登录失败');
    account = await rpc('account/read', { refreshToken: false });
    assert.equal(account.account?.type, 'chatgpt');
    step('account/login/completed', { authenticated: true });
  }
  const main = await rpc('thread/start', { cwd, ephemeral: false, sandbox: 'read-only', approvalPolicy: 'never',
    developerInstructions: '这是只读对话验证。不要调用任何工具，不要执行任务或修改文件，只回答用户消息。' });
  const mainId = main.thread.id;
  assert.equal(main.sandbox.type, 'readOnly');
  step('thread/start', { mainThreadId: mainId, model: main.model, sandbox: main.sandbox });
  const first = await turn(mainId, '我们正在做一个小型项目管理应用。后续任务系统需要归属项目；任务字段暂定标题和完成状态。不需要登录、云同步或数据库。这里只记录这些约束，请简短确认，不要开始实现。');
  step('main-turn-completed', { turnId: first.id });
  const before = (await rpc('thread/read', { threadId: mainId, includeTurns: true })).thread.turns;
  assert(before.length >= 1);
  assert(before.every((t: any) => t.status === 'completed'));
  writeFileSync(join(state, 'main-before.json'), JSON.stringify(before, null, 2));
  const fork = await rpc('thread/fork', { threadId: mainId, ephemeral: true, excludeTurns: true, cwd, sandbox: 'read-only', approvalPolicy: 'never',
    developerInstructions: optimizerInstructions });
  forkId = fork.thread.id;
  assert(typeof forkId === 'string');
  assert.notEqual(forkId, mainId);
  assert.equal(fork.thread.ephemeral, true);
  assert.equal(fork.sandbox.type, 'readOnly');
  step('ephemeral-fork', { forkThreadId: forkId, ephemeral: fork.thread.ephemeral });
  const result = await turn(forkId, `${optimizerInstructions}\n\n待优化数据：\n${JSON.stringify({ draft: '再给这个项目加一个任务系统', projectContext: initialFiles })}`, schema);
  const optimized = JSON.parse(result.text);
  assert.deepEqual(Object.keys(optimized).sort(), [...schema.required].sort());
  assert(typeof optimized.optimizedPrompt === 'string' && optimized.optimizedPrompt.trim());
  for (const key of ['contextUsed','assumptions','warnings']) assert(Array.isArray(optimized[key]) && optimized[key].every((x: any) => typeof x === 'string'));
  const after = (await rpc('thread/read', { threadId: mainId, includeTurns: true })).thread.turns;
  writeFileSync(join(state, 'main-after.json'), JSON.stringify(after, null, 2));
  assert.deepEqual(after, before, 'Main Thread Turn 数量或内容发生变化');
  assert.deepEqual(snapshot(cwd), initialFiles, '测试项目文件发生变化');
  assert(!events.some(e => e.method === 'probe/unexpectedRequest'), '出现意外服务端请求');
  const mainStarts = events.filter(e => e.method === 'turn/started' && e.params.threadId === mainId);
  assert.equal(mainStarts.length, 1, 'Main Thread 出现额外 Turn');
  report.status = 'passed';
  report.optimized = optimized;
  report.validation = { beforeTurns: before.length, afterTurns: after.length, historyDeepEqual: true,
    projectFilesUnchanged: true, mainTurnStarts: mainStarts.length,
    historySha256: createHash('sha256').update(JSON.stringify(before)).digest('hex') };
  step('verification-passed', report.validation);
  console.log(JSON.stringify(optimized, null, 2));
} catch (error) {
  report.status = 'failed'; report.error = String(error); save();
  console.error(String(error));
  writeFileSync(join(state, 'server-stderr.log'), stderr);
  process.exitCode = 1;
} finally {
  if (forkId && !closed) await rpc('thread/unsubscribe', { threadId: forkId }).catch(() => {});
  child.stdin.end(); child.kill();
  report.finishedAt = new Date().toISOString(); save();
}
