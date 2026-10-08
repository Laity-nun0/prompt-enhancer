// 默认仅准备；--run 才启动真实窗口，并等待用户完成全新 OAuth。
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { strict as assert } from 'node:assert';
const require = createRequire(import.meta.url);
const root = resolve('.');
execFileSync(process.execPath, ['scripts/start-desktop.cjs', '--check'], { cwd: root, stdio: 'inherit' });
const { _electron: electron } = require(process.env.POC_PLAYWRIGHT_MODULE || 'playwright');
if (!process.argv.includes('--run')) {
  console.log('首次启动准备完成。执行 node scripts/verify-first-run-electron.mjs --run 后，在新打开的浏览器中完成 OAuth。不会复用现有账号或 Desktop 历史。');
  process.exit(0);
}
assert(process.env.POC_VERIFY_MODEL && process.env.POC_VERIFY_EFFORT, '真实增强验收须显式设置 POC_VERIFY_MODEL 和 POC_VERIFY_EFFORT');
// 不停止已有服务；端口被占用时要求操作者自行安排验收时段。
try { await fetch('http://127.0.0.1:4173', { signal: AbortSignal.timeout(1000) }); throw new Error('端口 4173 已占用，请先退出现有应用再运行验收。'); }
catch (error) { if (error.message.includes('4173')) throw error; }
mkdirSync(join(root, '.local', 'first-run'), { recursive: true });
const state = mkdtempSync(join(root, '.local', 'first-run', 'run-'));
const project = join(state, 'sample-project');
const profile = join(state, 'desktop-profile');
mkdirSync(project, { recursive: true }); mkdirSync(profile);
writeFileSync(join(project, 'package.json'), '{"name":"synthetic-project","private":true}');
writeFileSync(join(project, 'README.md'), '# 合成项目\n项目实体包含 id 和 name，保存在内存。\n');
const transcript = join(state, 'synthetic-transcript.jsonl');
const rows = [
  { type: 'session_meta', payload: { id: 'first-run-synthetic', cwd: project, originator: 'Codex Desktop' } },
  { type: 'turn_context', payload: { turn_id: 'synthetic-turn' } },
  { type: 'event_msg', payload: { type: 'item_completed', item: { type: 'UserMessage', content: [{ type: 'text', text: '项目只有 id 和 name，请保持内存数据结构。' }] } } },
  { type: 'event_msg', payload: { type: 'task_complete', last_agent_message: '当前项目使用内存项目列表，尚无其他字段。' } },
];
writeFileSync(transcript, rows.map(row => JSON.stringify({ ...row, timestamp: '2026-10-08T00:00:00Z' })).join('\n'));
// Electron 保留系统标准用户环境；测试用户目录仅由宿主用于 Node 后端。
const env = { ...process.env, PROMPT_ENHANCER_STATE_DIR: state, PROMPT_ENHANCER_TEST_PROFILE_DIR: profile, POC_NODE_EXE: process.execPath };
delete env.ELECTRON_RUN_AS_NODE;
const report = { passed: false, stage: 'launch', checks: [], stateDirectory: state };
assert(!existsSync(join(state, 'codex-home', 'auth.json')), '新状态目录启动前不应存在凭据');
let app, originalClipboard, generatedClipboard;
try {
  app = await electron.launch({ executablePath: require('electron'), args: [join(root, 'desktop/main.cjs')], cwd: root, env });
  report.stage = 'login';
  const page = await app.firstWindow();
  await page.locator('#login-link').waitFor({ timeout: 90000 });
  report.checks.push('新状态目录启动且显示手动登录入口');
  console.log('请完成刚打开的浏览器 OAuth 登录，验收最多等待 15 分钟。');
  await page.waitForURL('http://127.0.0.1:4173/', { timeout: 15 * 60000 });
  assert(existsSync(join(state, 'codex-home', 'auth.json')), '应在新状态目录保存本次登录凭据');
  assert(!existsSync(join(state, 'login-url.txt')), '登录完成须清理一次性地址');
  const api = async path => (await fetch('http://127.0.0.1:4173' + path)).json();
  const initial = await api('/api/state'); assert.equal(initial.project, null); assert.deepEqual(initial.desktopSessions, []);
  report.checks.push('新浏览器登录完成，初始项目与Desktop历史为空');
  report.stage = 'project-and-context';
  await page.getByRole('button', { name: '选择项目', exact: true }).click();
  await page.locator('#project-path').fill(project);
  await page.getByRole('button', { name: '打开项目', exact: true }).click();
  await page.waitForFunction(path => document.querySelector('[data-testid="current-project"]')?.textContent === path, project);
  const current = await api('/api/state');
  const imported = await fetch('http://127.0.0.1:4173/api/desktop/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ threadId: current.threadId, path: transcript }) });
  assert.equal(imported.status, 200); await page.reload();
  await page.locator('#desktop-session').selectOption('first-run-synthetic');
  const catalog = await api('/api/state');
  const option = catalog.models.find(item => item.model === process.env.POC_VERIFY_MODEL);
  assert(option?.supportedReasoningEfforts.includes(process.env.POC_VERIFY_EFFORT), '指定模型及强度须在可用目录中');
  await page.locator('.model-button').click(); await page.locator('.model-select-trigger').click();
  await page.locator('.model-menu-item').filter({ hasText: option.displayName.replace(/^(GPT-[\d.]+)-/, '$1 ') }).click();
  const slider = page.locator('#enhance-effort'); await slider.press('Home');
  for (let i = 0; i < option.supportedReasoningEfforts.indexOf(process.env.POC_VERIFY_EFFORT); i++) await slider.press('ArrowRight');
  await slider.press('Escape');
  const beforeProject = readFileSync(join(project, 'README.md'), 'utf8');
  const beforeTranscript = readFileSync(transcript, 'utf8');
  await page.locator('#draft').fill('请给项目增加 description 字段，并解释必要改动。');
  report.stage = 'clipboard-snapshot';
  originalClipboard = await app.evaluate(async ({ clipboard }, helper) => await process.getBuiltinModule('module').createRequire(helper)(helper).snapshotTestClipboard(clipboard), join(root, 'scripts/startup-support.cjs'));
  report.stage = 'enhance';
  const response = page.waitForResponse(r => r.url().endsWith('/api/enhance'), { timeout: 600000 });
  await page.locator('#draft').press('Control+Enter');
  const resultResponse = await response; assert.equal(resultResponse.status(), 200);
  const result = await resultResponse.json(); assert(result.optimizedPrompt?.trim());
  generatedClipboard = result.optimizedPrompt;
  assert.equal(result.conversationSource.sessionId, 'first-run-synthetic');
  assert(result.isolation.unchanged && result.isolation.transcriptVerified);
  assert.equal(result.isolation.beforeTurns, result.isolation.afterTurns);
  report.stage = 'renderer-and-clipboard';
  await page.getByText('✓ 优化完成，已复制到剪贴板。可以返回 Codex Desktop 粘贴；尚未发送。', { exact: true }).waitFor({ timeout: 10000 });
  assert.equal(await page.locator('#draft').inputValue(), result.optimizedPrompt);
  assert.equal(await app.evaluate(({ clipboard }) => clipboard.readText()), result.optimizedPrompt);
  assert.equal(readFileSync(join(project, 'README.md'), 'utf8'), beforeProject);
  assert.equal(readFileSync(transcript, 'utf8'), beforeTranscript);
  assert(existsSync(join(state, 'projects.json')) && existsSync(join(state, 'ui-session.json')));
  report.checks.push('UI选择合成Desktop上下文与模型，输入草稿后真实增强成功，源文件未改变');
  report.checks.push('成功提示、输入框与最终校验结果和系统剪贴板一致');
  report.stage = 'complete';
  report.passed = true;
} catch {
  report.checks.push('验收未通过；请检查窗口显示及登录、网络或模型状态后重新创建新一轮验收');
  process.exitCode = 1;
} finally {
  if (typeof originalClipboard === 'string' && typeof generatedClipboard === 'string') {
    try {
      await app.evaluate(async ({ clipboard }, values) => await process.getBuiltinModule('module').createRequire(values.helper)(values.helper).restoreTestClipboard(clipboard, values.original, values.generated), { helper: join(root, 'scripts/startup-support.cjs'), original: originalClipboard, generated: generatedClipboard });
    } catch { report.passed = false; report.stage = 'clipboard-restore'; process.exitCode = 1; }
  }
  // 仅关闭本脚本启动的应用；报告不包含账号、OAuth URL、历史或增强内容。
  if (app) {
    await app.evaluate(async (_, hostFile) => { await process.getBuiltinModule('module').createRequire(hostFile)(hostFile).quit(); }, join(root, 'desktop/main.cjs')).catch(() => {});
    await app.close().catch(() => {});
  }
  writeFileSync(join(state, 'first-run-report.json'), JSON.stringify(report, null, 2));
  console.log(`验收${report.passed ? '通过' : '未通过'}，状态与报告目录：${state}`);
}
