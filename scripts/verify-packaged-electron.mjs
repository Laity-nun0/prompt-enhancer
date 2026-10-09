// 打包后的EXE验收，不调用模型、不写剪贴板，不操作Codex Desktop。
import { createRequire } from 'node:module';
import { resolve, join, dirname } from 'node:path';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { strict as assert } from 'node:assert';
const require = createRequire(import.meta.url);
const { _electron, chromium } = require(process.env.PROMPT_ENHANCER_PLAYWRIGHT_MODULE || 'playwright');
const portable = process.argv.includes('--portable');
const executablePath = resolve(portable ? 'release/Prompt-Enhancer-Windows-x64.exe' : 'release/win-unpacked/Prompt Enhancer.exe');
assert(existsSync(executablePath), '请先运行 npm run package:win');
const env = { ...process.env, PATH: 'C:\\Windows\\System32;C:\\Windows' };
for (const key of ['ELECTRON_RUN_AS_NODE', 'PROMPT_ENHANCER_NODE_EXE', 'PROMPT_ENHANCER_CODEX_EXE', 'PROMPT_ENHANCER_STATE_DIR']) delete env[key];
const report = { passed: false, checks: [], portable, generatedAt: new Date().toISOString() };
const check = value => { report.checks.push(value); console.log(value); };
mkdirSync('.local', { recursive: true });

// portable 外层使用原生启动器，不转发调试标准流；只在验收时使用本机调试端口。
async function launchPortable() {
  const reservations = await Promise.all([0, 0].map(() => new Promise(done => {
    const server = createServer(); server.listen(0, '127.0.0.1', () => done(server));
  })));
  const [inspectorPort, browserPort] = reservations.map(server => server.address().port);
  await Promise.all(reservations.map(server => new Promise(done => server.close(done))));
  const child = spawn(executablePath, ['--inspect=127.0.0.1:' + inspectorPort, '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=' + browserPort], { cwd: dirname(executablePath), env, windowsHide: true, stdio: 'ignore' });
  const exited = new Promise(done => child.once('exit', done));
  let socket, browser;
  async function close() {
    try { if (socket?.readyState === WebSocket.OPEN) await evaluate(({ app }) => { app.quit(); }); }
    finally { socket?.close(); await browser?.close(); }
    if (child.exitCode === null) {
      await Promise.race([exited, new Promise((_, reject) => setTimeout(() => reject(new Error('单文件启动器退出超时')), 15000))]);
    }
  }
  let seq = 0;
  const pending = new Map();
  async function evaluate(fn, arg) {
    return await new Promise((done, fail) => {
      const id = ++seq;
      const timer = setTimeout(() => { pending.delete(id); fail(new Error('主进程验收响应超时')); }, 15000);
      pending.set(id, { done, fail, timer });
      const expression = '(' + fn.toString() + ')(process.getBuiltinModule("module").createRequire(process.resourcesPath + "/app.asar/desktop/main.cjs")("electron"), ' + JSON.stringify(arg ?? null) + ')';
      socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
    });
  }
  try {
    let inspector;
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error('单文件启动器提前退出');
      try {
        const response = await fetch('http://127.0.0.1:' + inspectorPort + '/json/list', { signal: AbortSignal.timeout(1000) });
        inspector = (await response.json())[0];
        if (inspector?.webSocketDebuggerUrl) break;
      } catch { /* 等待资源展开和真实主进程启动。 */ }
      await new Promise(done => setTimeout(done, 200));
    }
    if (!inspector?.webSocketDebuggerUrl) throw new Error('单文件EXE未启动主进程');
    socket = new WebSocket(inspector.webSocketDebuggerUrl);
    await new Promise((done, fail) => { socket.addEventListener('open', done, { once: true }); socket.addEventListener('error', fail, { once: true }); });
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data), entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id); clearTimeout(entry.timer);
      if (message.error || message.result?.exceptionDetails) entry.fail(new Error('主进程验收表达式失败'));
      else entry.done(message.result.result.value);
    });
    browser = await chromium.connectOverCDP('http://127.0.0.1:' + browserPort, { timeout: 60000 });
    return { firstWindow: async () => browser.contexts()[0].pages()[0], evaluate, close };
  } catch (error) {
    await close().catch(() => {});
    if (child.exitCode === null && child.pid) spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    throw error;
  }
}

let application, backendPid;
try {
  try { await fetch('http://127.0.0.1:4173', { signal: AbortSignal.timeout(1000) }); throw new Error('端口4173已占用'); }
  catch (error) { if (error.message.includes('4173')) throw error; }
  application = portable ? await launchPortable() : await _electron.launch({ executablePath, args: [], cwd: dirname(executablePath), env, timeout: 60000 });
  const page = await application.firstWindow();
  await page.waitForURL('http://127.0.0.1:4173/', { timeout: 120000 });
  await page.getByRole('button', { name: '选择项目', exact: true }).waitFor();
  assert(await page.evaluate(() => !!window.companion));
  check('打包EXE在PATH无Node环境启动，真实窗口与预加载桥接正常');
  const info = await application.evaluate(({ app, globalShortcut }) => {
    const path = process.getBuiltinModule('path');
    const host = process.getBuiltinModule('module').createRequire(path.join(process.resourcesPath, 'app.asar', 'desktop/main.cjs'))(path.join(process.resourcesPath, 'app.asar', 'desktop/main.cjs'));
    return { resources: process.resourcesPath, portableFile: process.env.PORTABLE_EXECUTABLE_FILE, packaged: app.isPackaged, node: process.versions.node, backendPid: host.backend.pid, userData: app.getPath('userData'), sessionData: app.getPath('sessionData'), shortcut: ['Control+Alt+E', 'Alt+Shift+E'].find(key => globalShortcut.isRegistered(key)), menu: host.trayMenu.items.map(item => item.label) };
  });
  backendPid = info.backendPid;
  assert(info.packaged); if (portable) assert.equal(resolve(info.portableFile), executablePath); assert(info.shortcut); assert(info.menu.includes('退出'));
  const expected = join(process.env.LOCALAPPDATA, 'PromptEnhancer', 'state');
  assert.equal(info.userData, join(expected, 'electron-user-data'));
  assert.equal(info.sessionData, join(expected, 'electron-session-data'));
  check('正式状态与缓存目录、托盘退出入口和全局快捷键正确');
  const state = await page.evaluate(async () => (await fetch('/api/state')).json());
  assert(Array.isArray(state.models) && state.models.length > 0);
  check('内置Codex CLI启动并读取模型目录');
  assert.equal((await fetch('http://127.0.0.1:4173/')).status, 403);
  assert.equal(await page.evaluate(async () => (await fetch('/@fs/server/index.ts')).status), 404);
  check('普通浏览器403，桌面内部不公开开发文件接口');
  const root = info.resources;
  const asar = require('@electron/asar');
  const files = asar.listPackage(join(root, 'app.asar'));
  assert(!files.some(file => /(?:^|[\\/])(?:\.poc|\.local|node_modules|verify-[^\\/]*|auth\.json|credentials\.json)(?:[\\/]|$)/.test(file)));
  assert(existsSync(join(root, 'app.asar.unpacked/server/index.mjs')));
  assert(existsSync(join(root, 'codex/bin/codex.exe')));
  assert(existsSync(join(root, 'codex/LICENSE')));
  check('发布内容无PoC、测试、账户文件或开发依赖，内置后端与许可证齐全');
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), false);
  check('关闭窗口隐藏到托盘');
  await application.evaluate(() => {
    const path = process.getBuiltinModule('path');
    const host = process.getBuiltinModule('module').createRequire(path.join(process.resourcesPath, 'app.asar', 'desktop/main.cjs'))(path.join(process.resourcesPath, 'app.asar', 'desktop/main.cjs'));
    host.show();
  });
  await page.screenshot({ path: '.local/packaged-window.png' });
  report.passed = true;
} finally {
  if (application) await application.close();
  if (backendPid) {
    let alive = true;
    for (let attempt = 0; attempt < 50; attempt++) {
      try { process.kill(backendPid, 0); } catch (error) { if (error.code === 'ESRCH') { alive = false; break; } throw error; }
      await new Promise(done => setTimeout(done, 200));
    }
    if (alive) { report.passed = false; throw new Error('退出后后端仍存活'); }
    check('退出清理自有后端进程');
  }
  writeFileSync('.local/package-smoke-results.json', JSON.stringify(report, null, 2));
}
