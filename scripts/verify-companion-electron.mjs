// 可重复的真实 Electron 集成检查；不会操作 Codex Desktop 窗口。
// PROMPT_ENHANCER_PLAYWRIGHT_MODULE 可指定已安装的 playwright 包目录，无需新增产品依赖。
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { strict as assert } from 'node:assert';
import { execFileSync, spawn } from 'node:child_process';
const require = createRequire(import.meta.url);
const { _electron: electron } = require(process.env.PROMPT_ENHANCER_PLAYWRIGHT_MODULE || 'playwright');
const root = resolve('.');
const hostFile = join(root, 'desktop/main.cjs');
const lifecycleOnly = process.argv.includes('--lifecycle-only');
if (!lifecycleOnly) assert(process.env.PROMPT_ENHANCER_VERIFY_MODEL && process.env.PROMPT_ENHANCER_VERIFY_EFFORT && process.env.PROMPT_ENHANCER_VERIFY_PROJECT, '请显式设置 PROMPT_ENHANCER_VERIFY_MODEL、PROMPT_ENHANCER_VERIFY_EFFORT 和 PROMPT_ENHANCER_VERIFY_PROJECT');
const report = { passed: false, checks: [], manual: '本脚本为真实窗口自动化；未模拟按键操作 Codex Desktop，未物理点击系统托盘。' };
mkdirSync('.local', { recursive: true });
const env = { ...process.env, PROMPT_ENHANCER_NODE_EXE: process.execPath }; delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: require('electron'), args: [hostFile], cwd: root, env });
let page, originalClipboard, originalProject;
const desktopFetch = (url, options) => page.evaluate(async ({ url, options }) => { const response = await fetch(url, options); return { status: response.status, data: await response.json() }; }, { url, options });
const api = async (path = '/api/state') => (await desktopFetch(path)).data;
const check = name => { report.checks.push(name); console.log(name); };
const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex');
function snapshot(dir) {
  return Object.fromEntries(readdirSync(dir, { withFileTypes: true }).filter(e => !e.isSymbolicLink() && !['.git', '.poc', '.local', 'release', 'node_modules', '__pycache__', 'dist'].includes(e.name)).flatMap(e => {
    const path = join(dir, e.name); return e.isDirectory() ? Object.entries(snapshot(path)) : [[path, hash(path)]];
  }));
}
async function host(fn, arg) { return app.evaluate(fn, { hostFile, ...arg }); }
async function chooseProject(path) {
  await page.getByRole('button', { name: '选择项目', exact: true }).click();
  await page.locator('#project-path').fill(path);
  await page.getByRole('button', { name: '打开项目', exact: true }).click();
  await page.waitForFunction(path => document.querySelector('[data-testid="current-project"]')?.textContent === path && !document.querySelector('#desktop-session')?.disabled, path, { timeout: 90000 });
}
async function chooseModel(model, effort) {
  const state = await api();
  const option = state.models.find(item => item.model === model);
  assert(option && option.supportedReasoningEfforts.includes(effort), '验收模型和强度不在可用目录中');
  await page.locator('.model-button').click();
  await page.locator('.model-select-trigger').click();
  await page.locator('.model-menu-item').filter({ hasText: option.displayName.replace(/^(GPT-[\d.]+)-/, '$1 ') }).click();
  const slider = page.locator('#enhance-effort');
  await slider.press('Home');
  for (let i = 0; i < option.supportedReasoningEfforts.indexOf(effort); i++) await slider.press('ArrowRight');
  assert.equal(await slider.inputValue(), String(option.supportedReasoningEfforts.indexOf(effort)));
  await slider.press('Escape');
}
try {
  page = await app.firstWindow();
  await page.waitForURL('http://127.0.0.1:4173/', { timeout: 120000 });
  await page.getByRole('button', { name: '选择项目', exact: true }).waitFor();
  await page.waitForFunction(() => !document.querySelector('button')?.disabled);
  const initial = await api(); originalProject = initial.project;
  assert(initial.threadId);
  assert(await page.evaluate(() => !!window.companion), 'preload 桥接未加载');
  check('真实 Electron 窗口、React 页面、Node 后端正常');
  assert(!('defaultModelSelection' in initial));
  for (const selection of [{}, { model: 'unavailable-model', effort: 'low' }, { model: initial.models[0].model, effort: 'unsupported-effort' }]) {
    const response = await desktopFetch('/api/enhance', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ threadId: initial.threadId, draft: '请检查当前项目，仅解释。', ...selection }) });
    assert.equal(response.status, 400);
  }
  check('真实 API 拒绝缺失模型、不可用模型及不兼容强度，不自动回退');
  assert(await page.getByRole('button', { name: '选择增强模型', exact: true }).isVisible());
  await page.locator('#draft').fill('请检查当前项目，仅解释。');
  assert(await page.getByRole('button', { name: '增强提问', exact: true }).isDisabled());
  let unselectedRequests = 0;
  const recordEnhance = request => { if (request.url().endsWith('/api/enhance')) unselectedRequests++; };
  page.on('request', recordEnhance);
  await page.locator('#draft').press('Control+Enter');
  await page.locator('#draft').press('Tab');
  assert.equal(unselectedRequests, 0);
  page.off('request', recordEnhance);
  assert(await page.getByRole('button', { name: '选择增强模型', exact: true }).isVisible());
  check('初始没有模型选择；增强按钮禁用，Ctrl+Enter 不提交增强请求');
  const option = initial.models.find(item => item.model === process.env.PROMPT_ENHANCER_VERIFY_MODEL) || initial.models[0];
  await chooseModel(option.model, option.supportedReasoningEfforts.at(-1));
  assert.equal(await page.locator('.model-reset, .model-menu-default').count(), 0);
  await page.locator('.model-button').click();
  await page.locator('.model-select-trigger').click();
  assert.equal(await page.locator('.model-menu-item').count(), initial.models.length);
  await page.screenshot({ path: '.local/model-picker-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '.local/model-picker-mobile.png', fullPage: true });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await page.setViewportSize({ width: 1040, height: 760 });
  await page.reload();
  await page.getByRole('button', { name: '选择增强模型', exact: true }).waitFor();
  assert(await page.getByRole('button', { name: '增强提问', exact: true }).isDisabled());
  check('模型列表、最高推理档位和窄屏显示正常；无恢复默认入口，刷新后重新选择');
  const backendPid = await host((_, { hostFile }) => process.getBuiltinModule('module').createRequire(hostFile)(hostFile).backend.pid);
  const processes = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-Command', 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name | ConvertTo-Json -Compress'], { encoding: 'utf8', windowsHide: true }));
  const owned = [backendPid];
  for (let i = 0; i < owned.length; i++) for (const p of processes.filter(p => p.ParentProcessId === owned[i])) owned.push(p.ProcessId);
  report.ownedProcesses = processes.filter(p => owned.includes(p.ProcessId));
  assert(report.ownedProcesses.some(p => p.Name === 'codex.exe'));
  assert.equal((await fetch('http://127.0.0.1:4173/')).status, 403);
  assert.equal(await page.evaluate(async () => (await fetch('/@fs/server/index.ts')).status), 404);
  report.shortcut = await app.evaluate(({ globalShortcut }) => ['Control+Alt+E', 'Alt+Shift+E'].find(key => globalShortcut.isRegistered(key)));
  assert(report.shortcut);
  check(`Windows 全局快捷键注册成功：${report.shortcut}`);
  originalClipboard = await app.evaluate(({ clipboard }) => clipboard.readText());
  await page.locator('#draft').fill('');
  const importedText = await host(async ({ clipboard, BrowserWindow }, { hostFile }) => {
    BrowserWindow.getAllWindows()[0].hide(); await clipboard.writeText('Companion 草稿 A');
    await process.getBuiltinModule('module').createRequire(hostFile)(hostFile).importClipboard();
    return clipboard.readText();
  });
  assert.equal(importedText, 'Companion 草稿 A', '系统剪贴板未写入测试文本');
  await page.waitForFunction(() => document.querySelector('#draft')?.value === 'Companion 草稿 A');
  assert(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()));
  check('调用已注册快捷键的同一回调：隐藏窗口唤起、系统剪贴板载入 Draft，不自动 Enhance');
  await host(async ({ clipboard }, { hostFile }) => { await clipboard.writeText('Companion 草稿 B'); await process.getBuiltinModule('module').createRequire(hostFile)(hostFile).importClipboard(); });
  await page.getByRole('button', { name: '保留当前草稿', exact: true }).click();
  assert.equal(await page.locator('#draft').inputValue(), 'Companion 草稿 A');
  await host((_, { hostFile }) => process.getBuiltinModule('module').createRequire(hostFile)(hostFile).importClipboard());
  await page.getByRole('button', { name: '替换当前草稿', exact: true }).click();
  assert.equal(await page.locator('#draft').inputValue(), 'Companion 草稿 B');
  check('非空草稿冲突：保留与替换都正常');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  assert(!(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())));
  assert((await api()).threadId);
  await host((_, { hostFile }) => process.getBuiltinModule('module').createRequire(hostFile)(hostFile).trayMenu.items[0].click());
  assert(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()));
  check('窗口 close 隐藏且后端存活；托盘菜单“打开”回调可恢复');

  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide());
  const duplicate = spawn(require('electron'), [hostFile], { cwd: root, env, windowsHide: true, stdio: 'ignore' });
  await new Promise((done, fail) => { duplicate.on('error', fail); duplicate.on('exit', code => code === 0 ? done() : fail(new Error(`重复启动退出码 ${code}`))); });
  assert.equal(await host((_, { hostFile }) => process.getBuiltinModule('module').createRequire(hostFile)(hostFile).backend.pid), backendPid);
  assert(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()));
  check('重复启动只唤起原窗口，不创建第二个后端；桌面服务拒绝开发源码 URL');

  if (!lifecycleOnly) {
  page.on('dialog', dialog => dialog.accept());
  await chooseModel(process.env.PROMPT_ENHANCER_VERIFY_MODEL, process.env.PROMPT_ENHANCER_VERIFY_EFFORT);
  await chooseProject(process.env.PROMPT_ENHANCER_VERIFY_PROJECT);
  let state = await api();
  const sessions = state.desktopSessions;
  assert(sessions.length >= 2, '验证项目需要至少两个 Desktop 对话');
  const transcripts = Object.fromEntries(sessions.filter(s => s.transcriptPath).map(s => [s.transcriptPath, hash(s.transcriptPath)]));
  const files = snapshot(state.project), beforeTurns = state.turns;
  const selectedId = sessions[0].sessionId;
  await page.locator('#desktop-session').selectOption(selectedId);
  const draft = '请说明这个项目的入口文件在哪里，仅解释，不修改任何文件。';
  await page.locator('#draft').fill(draft);
  await app.evaluate(({ clipboard }) => clipboard.writeText('失败时应保持的剪贴板'));
  await page.route('**/api/enhance', route => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: '测试模拟：范围检查失败', optimizedPrompt: '未经验证的 candidate' }) }));
  await page.getByRole('button', { name: '增强提问', exact: true }).click();
  await page.getByText('测试模拟：范围检查失败', { exact: false }).waitFor();
  assert.equal(await app.evaluate(({ clipboard }) => clipboard.readText()), '失败时应保持的剪贴板');
  assert.equal(await page.locator('#draft').inputValue(), draft);
  await page.unroute('**/api/enhance');
  check('模拟 HTTP Enhance 失败：candidate 不写入 Draft/剪贴板');
  const responsePromise = page.waitForResponse(r => r.url().endsWith('/api/enhance'), { timeout: 600000 });
  await page.locator('#draft').press('Control+Enter');
  console.log('正在执行一次真实 Enhance（源码采集 + optimizer + Scope Validator）');
  const response = await responsePromise, result = await response.json();
  assert(response.ok(), result.error);
  await page.getByText('✓ 优化完成，已复制到剪贴板。可以返回 Codex Desktop 粘贴；尚未发送。', { exact: true }).waitFor({ timeout: 10000 });
  assert.equal(await page.locator('#draft').inputValue(), result.optimizedPrompt);
  assert.equal(await app.evaluate(({ clipboard }) => clipboard.readText()), result.optimizedPrompt);
  assert.equal(result.conversationSource.sessionId, selectedId);
  assert(result.isolation.unchanged && result.isolation.transcriptVerified);
  assert.equal(result.isolation.beforeTurns, result.isolation.afterTurns);
  assert(Number.isInteger(result.scopeValidation.removedCount));
  assert(result.contextInspection.filesRead.length > 0);
  check('Ctrl+Enter 真实 Enhance 成功；最终已校验文本与 textarea、系统剪贴板完全相同');
  report.enhance = { sessionId: selectedId, turns: result.isolation.beforeTurns, filesRead: result.contextInspection.filesRead, scopeValidation: result.scopeValidation };
  await page.screenshot({ path: '.local/companion-window.png', fullPage: true });
  await page.locator('#desktop-session').selectOption(sessions[1].sessionId);
  assert.equal(await page.locator('#draft').inputValue(), draft);
  await page.locator('#desktop-session').selectOption(selectedId);
  assert.equal(await page.locator('#draft').inputValue(), draft);
  check('同项目多 session 切换恢复原草稿，上一会话增强文本不沿用');
  for (const [file, digest] of Object.entries(transcripts)) assert.equal(hash(file), digest);
  assert.deepEqual(snapshot(state.project), files);
  assert.deepEqual((await api()).turns, beforeTurns);
  check('真实验收项目全部快照文件、所有已发现 transcript 字节和 fallback Turns 均不变');
  if (originalProject) await chooseProject(originalProject);
  assert.equal((await api()).project, originalProject);
  check('不同真实项目切换正常，并已恢复启动时项目');
  }
  await app.evaluate(({ clipboard }, text) => clipboard.writeText(text), originalClipboard);
  report.backendPid = backendPid;
  const exited = app.waitForEvent('close', { timeout: 30000 });
  await host((_, { hostFile }) => { process.getBuiltinModule('module').createRequire(hostFile)(hostFile).trayMenu.items.at(-1).click(); });
  await exited;
  assert.throws(() => process.kill(backendPid, 0));
  for (const pid of owned) assert.throws(() => process.kill(pid, 0), `本次子进程 ${pid} 仍存在`);
  await assert.rejects(fetch('http://127.0.0.1:4173/api/state'));
  check('托盘退出回调结束 Electron、Node 与所有记录的 Codex 子进程，4173 监听释放');
  report.passed = true;
} catch (error) {
  report.error = String(error);
  if (page) {
    report.uiAlerts = await page.locator('[role="alert"]').allTextContents().catch(() => []);
    report.draft = await page.locator('#draft').inputValue().catch(() => '');
    await page.screenshot({ path: '.local/companion-failure.png', fullPage: true }).catch(() => {});
    console.log(JSON.stringify({ alerts: report.uiAlerts, draft: report.draft }));
  }
  throw error;
}
finally {
  writeFileSync(lifecycleOnly ? '.local/companion-lifecycle-results.json' : '.local/companion-electron-results.json', JSON.stringify(report, null, 2));
  if (!report.passed) {
    if (originalClipboard !== undefined) await app.evaluate(({ clipboard }, text) => clipboard.writeText(text), originalClipboard).catch(() => {});
    await host((_, { hostFile }) => { void process.getBuiltinModule('module').createRequire(hostFile)(hostFile).quit(); }).catch(() => {});
  }
}
