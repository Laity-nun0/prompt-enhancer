import { test, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, existsSync, writeFileSync, rmSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, toNamespacedPath } from 'node:path';
import { authenticateChatgpt } from '../server/login.ts';
const { snapshotTestClipboard, restoreTestClipboard } = createRequire(import.meta.url)('./startup-support.cjs');
import { DatabaseSync } from 'node:sqlite';
import { EventEmitter } from 'node:events';
import { runInNewContext } from 'node:vm';
import { resolve, dirname } from 'node:path';
const { stateDirectory, migrateLegacyState, loginUrl, startupFailure, backendEnvironment } = createRequire(import.meta.url)('./startup-support.cjs');
const fixtures: string[] = [];
function tempDir(prefix: string) { const path = mkdtempSync(join(tmpdir(), prefix)); fixtures.push(path); return path; }
after(() => { for (const path of fixtures) rmSync(path, { recursive: true, force: true }); });

test('正式状态位于用户数据目录，拒绝相对覆盖路径', () => {
  const root = tempDir('enhancer-state-');
  assert.equal(stateDirectory(root, { LOCALAPPDATA: root }), join(root, 'PromptEnhancer', 'state'));
  assert.equal(stateDirectory(root, { PROMPT_ENHANCER_STATE_DIR: root }), root);
  for (const path of ['', 'relative', '../state']) assert.throws(() => stateDirectory(root, { PROMPT_ENHANCER_STATE_DIR: path }));
});
test('只有测试目录标记隔离后端环境，不修改Electron传入的标准环境', () => {
  const original = { HOME: 'original-home', USERPROFILE: 'original-profile', APPDATA: 'original-roaming', LOCALAPPDATA: 'original-local', PROMPT_ENHANCER_OPEN_BROWSER: '1' };
  const { PROMPT_ENHANCER_OPEN_BROWSER: _browser, ...expected } = original;
  assert.deepEqual(backendEnvironment(Object.freeze(original)), expected);
  const profile = join(tempDir('enhancer-backend-env-'), 'profile');
  const incoming = Object.freeze({ ...original, PROMPT_ENHANCER_TEST_PROFILE_DIR: profile });
  const backend = backendEnvironment(incoming);
  assert.equal(backend.HOME, profile); assert.equal(backend.USERPROFILE, profile);
  assert.equal(backend.APPDATA, join(profile, 'AppData', 'Roaming'));
  assert.equal(backend.LOCALAPPDATA, join(profile, 'AppData', 'Local'));
  for (const path of [profile, backend.APPDATA, backend.LOCALAPPDATA]) assert(existsSync(path));
  for (const key of ['HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA'] as const) assert.equal(incoming[key], original[key]);
  for (const path of ['', 'relative']) assert.throws(() => backendEnvironment({ PROMPT_ENHANCER_TEST_PROFILE_DIR: path }));
  const script = readFileSync(resolve('scripts/verify-first-run-electron.mjs'), 'utf8');
  const envLine = script.split('\n').find(line => line.startsWith('const env ='))!;
  for (const key of ['HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA']) assert(!new RegExp(`\\b${key}:`).test(envLine));
});
test('默认与显式状态目录的Electron缓存都在单实例锁前设置', () => {
  const host = resolve('desktop/main.cjs'), require = createRequire(import.meta.url);
  for (const state of [undefined, tempDir('enhancer-electron-paths-')]) {
    const paths: [string, string][] = [];
    const local = tempDir('enhancer-local-');
    const effective = state || join(local, 'PromptEnhancer', 'state');
    const env = state ? { PROMPT_ENHANCER_STATE_DIR: state } : { LOCALAPPDATA: local };
    const electron = { app: { setPath(name: string, path: string) { assert(existsSync(path)); paths.push([name, path]); }, requestSingleInstanceLock() { assert.equal(paths.length, 2); return false; }, quit() {} } };
    runInNewContext(readFileSync(host, 'utf8'), { require: (name: string) => name === 'electron' ? electron : name.startsWith('.') ? createRequire(host)(name) : require(name), __dirname: join(tempDir('enhancer-empty-root-'), 'desktop'), module: { exports: {} }, process: { env } });
    assert.deepEqual(paths, [['userData', join(effective, 'electron-user-data')], ['sessionData', join(effective, 'electron-session-data')]]);
  }
});
test('OAuth 仅允许无凭据且无非默认端口的 HTTPS 官方认证地址', () => {
  assert.equal(loginUrl('https://auth.openai.com/authorize?state=synthetic'), 'https://auth.openai.com/authorize?state=synthetic');
  for (const url of [null, 'bad', 'http://auth.openai.com/', 'https://auth.openai.com.evil.test/', 'https://user@auth.openai.com/', 'https://auth.openai.com:444/', 'https://auth.openai.com/#token', 'file:///tmp/login', 'javascript:alert(1)']) assert.throws(() => loginUrl(url));
});
test('桌面自动打开浏览器失败后显示手动入口，仅启动页可打开同一受校验地址', async () => {
  let window: any, opened = 0, failBrowser = true;
  const backend: any = new EventEmitter(); backend.stdout = new EventEmitter(); backend.stderr = new EventEmitter();
  class MockWindow extends EventEmitter {
    url = ''; webContents: any = new EventEmitter();
    constructor() { super(); window = this; this.webContents.session = { setPermissionRequestHandler() {} }; this.webContents.setWindowOpenHandler = (callback: any) => { this.webContents.openHandler = callback; }; this.webContents.getURL = () => this.url; }
    loadURL(url: string) { this.url = url; return Promise.resolve(); }
    isDestroyed() { return false; } isMinimized() { return false; } show() {} focus() {}
  }
  const electron = {
    app: { setPath() {}, requestSingleInstanceLock: () => true, on() {}, whenReady: () => Promise.resolve() },
    BrowserWindow: MockWindow,
    Tray: class extends EventEmitter { setToolTip() {} setContextMenu() {} },
    Menu: { setApplicationMenu() {}, buildFromTemplate: () => ({}) }, nativeImage: { createFromPath() {} },
    globalShortcut: { register: () => true }, clipboard: {}, ipcMain: { handle() {} },
    dialog: { showErrorBox: () => assert.fail('不应退出或显示错误对话框') },
    shell: { openExternal: async (url: string) => { assert.equal(url, 'https://auth.openai.com/?state=synthetic'); opened++; if (failBrowser) throw new Error('blocked'); } },
  };
  const host = resolve('desktop/main.cjs'); const require = createRequire(import.meta.url);
  runInNewContext(readFileSync(host, 'utf8'), { require: (name: string) => name === 'electron' ? electron : name === 'node:child_process' ? { spawn: () => backend } : name.startsWith('.') ? createRequire(host)(name) : require(name), __dirname: dirname(host), module: { exports: {} }, process: { env: { PROMPT_ENHANCER_NODE_EXE: process.execPath, PROMPT_ENHANCER_STATE_DIR: tempDir('enhancer-host-') }, stdout: { write() {} }, stderr: { write() {} } }, setTimeout, clearTimeout });
  await new Promise(done => setImmediate(done));
  backend.emit('message', { type: 'login-required', url: 'https://auth.openai.com/?state=synthetic' });
  await new Promise(done => setImmediate(done));
  assert.equal(opened, 1); assert(decodeURIComponent(window.url).includes('浏览器未能自动打开'));
  assert(decodeURIComponent(window.url).includes('id="login-link"'));
  let prevented = false; failBrowser = false;
  window.webContents.emit('will-navigate', { preventDefault() { prevented = true; } }, 'https://auth.openai.com/?state=synthetic');
  await new Promise(done => setImmediate(done)); assert(prevented); assert.equal(opened, 2);
  window.webContents.emit('will-navigate', { preventDefault() {} }, 'https://evil.test/'); assert.equal(opened, 2);
  backend.emit('message', { type: 'ready', origin: 'http://127.0.0.1:4173' });
  window.webContents.emit('will-navigate', { preventDefault() {} }, 'https://auth.openai.com/?state=synthetic'); assert.equal(opened, 2);
  assert.equal(window.webContents.openHandler().action, 'deny');
});
test('首次登录通过模拟 RPC 等待指定 loginId，清理一次性地址且不读取另一个状态', async () => {
  const state = tempDir('enhancer-login-');
  const old = tempDir('enhancer-old-');
  writeFileSync(join(old, 'auth.json'), 'existing-account-marker');
  const calls: string[] = []; let accountReads = 0; let opened = false;
  await authenticateChatgpt(async method => {
    calls.push(method);
    if (method === 'account/read') return { account: ++accountReads === 1 ? null : { type: 'chatgpt' } };
    return { type: 'chatgpt', loginId: 'new-login', authUrl: 'https://auth.openai.com/authorize?state=synthetic' };
  }, async (method, matches) => {
    assert.equal(method, 'account/login/completed');
    assert(!matches({ loginId: 'old-login' })); assert(matches({ loginId: 'new-login' }));
    assert(opened); return { success: true };
  }, state, url => { opened = true; assert.equal(readFileSync(join(state, 'login-url.txt'), 'utf8'), url); });
  assert.deepEqual(calls, ['account/read', 'account/login/start', 'account/read']);
  assert(!existsSync(join(state, 'login-url.txt')));
  assert.equal(readFileSync(join(old, 'auth.json'), 'utf8'), 'existing-account-marker');
});
test('登录响应错误、登录失败、超时和浏览器异常均清理地址且不泄漏原始 OAuth 错误', async () => {
  for (const mode of ['invalid', 'failed', 'timeout', 'browser']) {
    const state = tempDir('enhancer-failure-');
    await assert.rejects(authenticateChatgpt(async method => method === 'account/read' ? { account: null } : { type: 'chatgpt', loginId: 'new', authUrl: mode === 'invalid' ? 'https://evil.test/SECRET' : 'https://auth.openai.com/?state=SECRET' }, async () => {
      if (mode === 'timeout') throw new Error('SECRET');
      return { success: false, error: 'SECRET' };
    }, state, () => { if (mode === 'browser') throw new Error('SECRET'); }), error => error instanceof Error && /登录失败/.test(error.message) && !error.message.includes('SECRET'));
    assert(!existsSync(join(state, 'login-url.txt')));
  }
});
test('已登录时不再次发起登录；错误说明区分端口、运行时与登录', async () => {
  const state = tempDir('enhancer-existing-');
  await authenticateChatgpt(async method => { assert.equal(method, 'account/read'); return { account: { type: 'chatgpt' } }; }, async () => assert.fail('不能等待登录'), state, () => assert.fail('不能打开浏览器'));
  assert.match(startupFailure({ code: 'EADDRINUSE' }), /4173.*占用/);
  assert.match(startupFailure({ code: 'ENOENT' }), /运行时/);
  assert.match(startupFailure(new Error('account/login/start SECRET')), /登录失败/);
  assert(!startupFailure(new Error('https://auth.openai.com/?state=SECRET')).includes('SECRET'));
});

test('首次验收拒绝覆盖图片或富文本剪贴板，纯文本快照不写入', async () => {
  let writes = 0;
  for (const formats of [['image/png'], ['text/plain', 'text/html']]) await assert.rejects(snapshotTestClipboard({ availableFormats: () => formats, readText: () => '', writeText: () => writes++ }), /纯文本剪贴板/);
  assert.equal(await snapshotTestClipboard({ availableFormats: () => ['text/plain'], readText: () => 'latest text' }), 'latest text');
  assert.equal(writes, 0);
});

test('未生成、用户新复制内容及非文本格式均不恢复，只有本轮结果可恢复', async () => {
  let text = 'user copied later', formats = ['text/plain'], writes = 0;
  const clipboard = { availableFormats: () => formats, readText: () => text, writeText: (value: string) => { text = value; writes++; } };
  assert.equal(await restoreTestClipboard(clipboard, 'old', undefined), false);
  assert.equal(await restoreTestClipboard(clipboard, 'old', 'test result'), false);
  text = 'test result'; formats = ['text/plain', 'image/png'];
  assert.equal(await restoreTestClipboard(clipboard, 'old', 'test result'), false);
  assert.equal(writes, 0);
  formats = ['text/plain'];
  assert.equal(await restoreTestClipboard(clipboard, 'old', 'test result'), true);
  assert.equal(text, 'old'); assert.equal(writes, 1);
});

for (const scenario of [
  { name: '首选可用', results: [true], label: 'Ctrl+Alt+E', warning: '' },
  { name: '首选冲突后备用可用', results: [false, true], label: 'Alt+Shift+E', warning: '使用 Alt+Shift+E 唤起。' },
  { name: '均被占用', results: [false, false], label: '快捷键不可用', warning: '快捷键暂不可用，请从托盘打开，或关闭占用程序后重启 Companion。' }
]) test(`简化快捷键：${scenario.name}，桥接和托盘展示一致`, async () => {
  let window: any, tooltip = '';
  let folderSelection = { canceled: false, filePaths: ['D:\\测试项目 中文'] };
  const registrations: string[] = [], sent: unknown[][] = [];
  const callbacks = new Map<string, () => Promise<void>>(), handlers = new Map<string, (event: any) => any>();
  const backend: any = new EventEmitter(); backend.stdout = new EventEmitter(); backend.stderr = new EventEmitter();
  class MockWindow extends EventEmitter {
    webContents: any = new EventEmitter();
    constructor() {
      super(); window = this;
      this.webContents.mainFrame = { url: '' };
      this.webContents.session = { setPermissionRequestHandler() {} };
      this.webContents.setWindowOpenHandler = () => {};
      this.webContents.getURL = () => this.webContents.mainFrame.url;
      this.webContents.send = (...args: unknown[]) => sent.push(args);
    }
    loadURL(url: string) { this.webContents.mainFrame.url = url; return Promise.resolve(); }
    isDestroyed() { return false; } isMinimized() { return false; } show() {} focus() {}
  }
  const electron = {
    app: { setPath() {}, requestSingleInstanceLock: () => true, on() {}, whenReady: () => Promise.resolve() },
    BrowserWindow: MockWindow,
    Tray: class extends EventEmitter { setToolTip(value: string) { tooltip = value; } setContextMenu() {} },
    Menu: { setApplicationMenu() {}, buildFromTemplate: () => ({}) }, nativeImage: { createFromPath() {} },
    globalShortcut: { register(key: string, callback: () => Promise<void>) { registrations.push(key); const registered = scenario.results[registrations.length - 1]; if (registered) callbacks.set(key, callback); return registered; } },
    clipboard: { readText: () => 'synthetic draft' }, ipcMain: { handle(name: string, callback: (event: any) => any) { handlers.set(name, callback); } },
    dialog: { showOpenDialog: async (owner: any, options: any) => { assert.equal(owner, window); assert.equal(JSON.stringify(options.properties), '["openDirectory"]'); return folderSelection; }, showErrorBox: () => assert.fail('快捷键冲突不能阻止应用启动') }, shell: {},
  };
  const host = resolve('desktop/main.cjs'), require = createRequire(import.meta.url);
  runInNewContext(readFileSync(host, 'utf8'), { require: (name: string) => name === 'electron' ? electron : name === 'node:child_process' ? { spawn: () => backend } : name.startsWith('.') ? createRequire(host)(name) : require(name), __dirname: dirname(host), module: { exports: {} }, process: { env: { PROMPT_ENHANCER_NODE_EXE: process.execPath }, stdout: { write() {} }, stderr: { write() {} } }, setTimeout, clearTimeout });
  await new Promise(done => setImmediate(done));
  assert.deepEqual(registrations, ['Control+Alt+E', 'Alt+Shift+E'].slice(0, scenario.results.length));
  await window.loadURL('http://127.0.0.1:4173/');
  const state = handlers.get('companion:ready')!({ sender: window.webContents, senderFrame: window.webContents.mainFrame });
  assert.equal(state.shortcut, scenario.label); assert.equal(state.shortcutWarning, scenario.warning);
  assert.equal(tooltip, `Prompt Enhancer · ${scenario.label}`);
  const chooseFolder = handlers.get('companion:choose-project-folder')!;
  const event = { sender: window.webContents, senderFrame: window.webContents.mainFrame };
  assert.equal(await chooseFolder(event), 'D:\\测试项目 中文');
  folderSelection = { canceled: true, filePaths: [] };
  assert.equal(await chooseFolder(event), null);
  await assert.rejects(() => chooseFolder({ ...event, sender: {} }), /拒绝/);
  await assert.rejects(() => chooseFolder({ ...event, senderFrame: { url: 'http://127.0.0.1:4173/' } }), /拒绝/);
  assert(!state.shortcutWarning.includes('Ctrl+Shift+E 不可用'));
  for (const callback of callbacks.values()) await callback();
  assert.equal(sent.length, callbacks.size);
  if (callbacks.size) assert.deepEqual(sent[0], ['companion:draft', 'synthetic draft']);
});

 test('迁移只复制正式状态，保留源目录，不覆盖已有数据', () => {
  const root = tempDir('enhancer-migrate-'), target = join(root, 'state');
  const legacy = join(root, '.poc');
  mkdirSync(join(legacy, 'codex-home'), { recursive: true });
  mkdirSync(join(legacy, 'unit'), { recursive: true });
  writeFileSync(join(legacy, 'codex-home', 'auth.json'), 'synthetic');
  writeFileSync(join(legacy, 'projects.json'), '{"version":1}');
  writeFileSync(join(legacy, 'unit', 'report.json'), 'test-only');
  assert.equal(migrateLegacyState(root, target), true);
  assert.equal(readFileSync(join(target, 'codex-home', 'auth.json'), 'utf8'), 'synthetic');
  assert(existsSync(join(legacy, 'codex-home', 'auth.json')));
  assert(!existsSync(join(target, 'unit')));
  writeFileSync(join(legacy, 'projects.json'), 'changed');
  assert.equal(migrateLegacyState(root, target), false);
  assert.equal(readFileSync(join(target, 'projects.json'), 'utf8'), '{"version":1}');
});
 test('未完成迁移阻止启用残缺状态，旧状态保持完整', () => {
  const root = tempDir('enhancer-incomplete-'), target = join(root, 'state');
  mkdirSync(join(root, '.poc'), { recursive: true });
  writeFileSync(join(root, '.poc', 'projects.json'), 'original');
  mkdirSync(target + '.migrating');
  assert.throws(() => migrateLegacyState(root, target), /未完成/);
  assert(!existsSync(target));
  assert.equal(readFileSync(join(root, '.poc', 'projects.json'), 'utf8'), 'original');
});

test('迁移重定位SQLite会话索引，旧目录移走后仍读取新rollout', () => {
  const root = tempDir('enhancer-rollout-'), home = join(root, '.poc', 'codex-home');
  mkdirSync(join(home, 'sessions'), { recursive: true });
  const rollout = join(home, 'sessions', 'synthetic.jsonl');
  writeFileSync(rollout, 'synthetic-history');
  const db = new DatabaseSync(join(home, 'state_5.sqlite'));
  db.exec('CREATE TABLE threads (id TEXT PRIMARY KEY, rollout_path TEXT NOT NULL)');
  db.prepare('INSERT INTO threads VALUES (?, ?)').run('synthetic', toNamespacedPath(rollout)); db.close();
  const target = join(root, 'state');
  assert(migrateLegacyState(root, target));
  renameSync(join(root, '.poc'), join(root, 'retired'));
  const migrated = new DatabaseSync(join(target, 'codex-home', 'state_5.sqlite'), { readOnly: true });
  const row = migrated.prepare('SELECT rollout_path FROM threads').get(); migrated.close(); assert(row);
  assert.equal(row.rollout_path, join(target, 'codex-home', 'sessions', 'synthetic.jsonl'));
  assert.equal(readFileSync(row.rollout_path, 'utf8'), 'synthetic-history');
});
