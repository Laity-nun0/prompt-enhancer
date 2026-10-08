const { app, BrowserWindow, Tray, Menu, nativeImage, globalShortcut, clipboard, ipcMain, dialog, shell } = require('electron');
const { spawn } = require('node:child_process');
const { join } = require('node:path');
const { mkdirSync } = require('node:fs');
const { ValidatedResults } = require('./results.cjs');
const { loginUrl, stateDirectory, backendEnvironment } = require('../scripts/startup-support.cjs');

const root = join(__dirname, '..');
if (process.env.PROMPT_ENHANCER_STATE_DIR !== undefined) {
  const state = stateDirectory(root, process.env);
  for (const [name, path] of [['userData', join(state, 'electron-user-data')], ['sessionData', join(state, 'electron-session-data')]]) {
    mkdirSync(path, { recursive: true });
    app.setPath(name, path);
  }
}
const origin = 'http://127.0.0.1:4173';
const shortcut = 'Control+Alt+E';
let shortcutLabel = 'Ctrl+Alt+E';
const results = new ValidatedResults();
let window, tray, backend, trayMenu;
let quitting = false, stopped = false, rendererReady = false;
let pendingClipboard;
let shortcutWarning = '';
let pendingLoginUrl, startupPage, startupError;
function showStartup(message = '正在启动 Prompt Enhancer…') {
  const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const link = pendingLoginUrl ? `<p><a id="login-link" href="${escape(pendingLoginUrl)}">打开 ChatGPT 登录页</a></p><p>完成浏览器登录后，此窗口会自动进入应用。</p>` : '<p>首次使用需要在浏览器完成 ChatGPT 登录。</p>';
  startupPage = 'data:text/html;charset=utf-8,' + encodeURIComponent(`<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>Prompt Enhancer</title><body style="font:18px sans-serif;padding:40px"><h1 style="font-size:24px">Prompt Enhancer</h1><p>${escape(message)}</p>${link}</body>`);
  void window.loadURL(startupPage);
}
async function openLogin() {
  try { await shell.openExternal(loginUrl(pendingLoginUrl)); }
  catch { if (pendingLoginUrl && !quitting) showStartup('浏览器未能自动打开。请点击下方登录入口重试，并检查系统默认浏览器设置。'); }
}

function show() {
  if (!window || window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  window.show(); window.focus();
}
async function importClipboard() {
  show();
  // 只响应用户主动唤起，不轮询/监听系统剪贴板。
  try {
    const text = await clipboard.readText();
    if (quitting || window.isDestroyed()) return;
    if (rendererReady) window.webContents.send('companion:draft', text);
    else pendingClipboard = text;
  } catch (error) { dialog.showErrorBox('无法读取剪贴板', String(error)); }
}
function trusted(event) {
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== origin + '/') throw new Error('拒绝非 Companion 页面');
}
async function quit() {
  if (quitting) return;
  quitting = true; globalShortcut.unregisterAll();
  if (backend?.pid && backend.exitCode === null && backend.signalCode === null) {
    // 正常 IPC 退出先结束 runtime；兜底也只终止本次持有的 PID 进程树。
    await new Promise(resolve => {
      const timer = setTimeout(() => {
        const killer = spawn('taskkill.exe', ['/PID', String(backend.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        killer.on('error', () => backend.kill());
      }, 10000);
      backend.once('exit', () => { clearTimeout(timer); resolve(undefined); });
      if (backend.connected) backend.send({ type: 'shutdown' });
      else backend.kill();
    });
  }
  stopped = true; tray?.destroy(); app.quit();
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', importClipboard);
  app.on('before-quit', event => { if (!stopped) { event.preventDefault(); void quit(); } });
  app.on('window-all-closed', () => {});
  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    window = new BrowserWindow({ width: 1000, height: 820, minWidth: 660, minHeight: 520,
      title: 'Prompt Enhancer Desktop Companion', show: false, icon: join(__dirname, 'icon.png'),
      webPreferences: { preload: join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false } });
    window.on('close', event => { if (!quitting) { event.preventDefault(); window.hide(); } });
    window.on('page-title-updated', event => { event.preventDefault(); });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event, url) => {
      if (pendingLoginUrl && window.webContents.getURL() === startupPage && url === pendingLoginUrl) { event.preventDefault(); void openLogin(); return; }
      if (url !== origin + '/') event.preventDefault();
    });
    window.webContents.on('will-attach-webview', event => event.preventDefault());
    window.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    window.webContents.on('did-start-loading', () => { rendererReady = false; });
    tray = new Tray(nativeImage.createFromPath(join(__dirname, 'icon.png')));
    tray.setToolTip('Prompt Enhancer · Ctrl+Alt+E');
    trayMenu = Menu.buildFromTemplate([
      { label: '打开 Prompt Enhancer', click: show },
      { label: '隐藏', click: () => window.hide() },
      { type: 'separator' },
      { label: '退出', click: () => void quit() },
    ]);
    tray.setContextMenu(trayMenu);
    tray.on('double-click', show);
    ipcMain.handle('companion:ready', event => {
      trusted(event); rendererReady = true;
      const text = pendingClipboard; pendingClipboard = undefined;
      return { text, shortcutWarning, shortcut: shortcutLabel };
    });
    ipcMain.handle('companion:copy-result', async (event, token) => {
      trusted(event);
      const prompt = results.take(token);
      await clipboard.writeText(prompt);
      if (await clipboard.readText() !== prompt) throw new Error('剪贴板写入未成功，请手动复制结果');
    });
    if (!globalShortcut.register(shortcut, importClipboard)) {
      if (globalShortcut.register('Alt+Shift+E', importClipboard)) {
        shortcutLabel = 'Alt+Shift+E';
        shortcutWarning = '使用 Alt+Shift+E 唤起。';
      } else {
        shortcutLabel = '快捷键不可用';
        shortcutWarning = '快捷键暂不可用，请从托盘打开，或关闭占用程序后重启 Companion。';
      }
    }
    tray.setToolTip(`Prompt Enhancer · ${shortcutLabel}`);
    // 页面只访问同源本地服务；不向 Codex Desktop 暴露或注入任何能力。
    showStartup();
    show();
    const node = process.env.POC_NODE_EXE;
    if (!node) throw new Error('请使用“启动Companion.cmd”或 npm run desktop 启动，以定位 Node.js 24。');
    backend = spawn(node, ['server/index.ts'], { cwd: root, windowsHide: true,
      env: backendEnvironment(process.env), stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    backend.stdout.on('data', data => process.stdout.write(data));
    backend.stderr.on('data', data => process.stderr.write(data));
    backend.on('message', message => {
      if (!message || typeof message !== 'object' || !('type' in message)) return;
      if (quitting) return;
      if (message.type === 'login-required' && 'url' in message) {
        try { pendingLoginUrl = loginUrl(message.url); showStartup('请在浏览器完成 ChatGPT 登录。'); void openLogin(); }
        catch { startupError = '登录地址未通过安全校验，请重新安装固定版本运行时后重试。'; showStartup(startupError); void quit(); }
      }
      if (message.type === 'startup-error' && 'message' in message && typeof message.message === 'string') startupError = message.message;
      if (message?.type === 'validated-result') results.accept(message);
      if (message?.type === 'ready' && 'origin' in message && message.origin === origin) {
        pendingLoginUrl = undefined;
        window.loadURL(origin + '/').then(show).catch(error => { dialog.showErrorBox('页面加载失败', String(error)); void quit(); });
      }
    });
    backend.once('error', error => { dialog.showErrorBox('后端启动失败', String(error)); void quit(); });
    backend.once('exit', code => {
      if (!quitting) {
        pendingLoginUrl = undefined;
        dialog.showErrorBox('Prompt Enhancer 启动失败', startupError || `服务退出（${code}）。请检查 Node.js 24、运行时依赖、构建产物及端口 4173 后重试。`);
        void quit();
      }
    });
  }).catch(error => { dialog.showErrorBox('Companion 启动失败', String(error)); void quit(); });
}
// 供 Electron 集成测试在主进程直接验证；不会暴露给 renderer。
module.exports = { importClipboard, show, quit, get trayMenu() { return trayMenu; }, get backend() { return backend; } };
