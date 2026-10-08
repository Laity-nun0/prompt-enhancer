import { createServer } from 'node:http';
import { createServer as createVite } from 'vite';
import { writeFileSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createRuntime, stateDir } from './app-server.ts';
import { createRequire } from 'node:module';
const { startupFailure } = createRequire(import.meta.url)('../scripts/startup-support.cjs');
import { enhance } from './optimizer.ts';
import { Projects } from './projects.ts';
import { resolve } from 'node:path';
import { DesktopSessions, selectedDesktopIds } from './desktop-sessions.ts';
import { enhanceDesktop } from './desktop-optimizer.ts';
import { randomUUID } from 'node:crypto';
import { listModelOptions, selectModel, type ModelOption } from './model-options.ts';

const abort = new AbortController();
let runtime: Awaited<ReturnType<typeof createRuntime>> | undefined;
let projects: Projects;
let desktop: DesktopSessions;
let ready = false;
let startupWarning = '';
let busy = false;
let models: ModelOption[] = [];
const port = 4173;
const origin = `http://127.0.0.1:${port}`;
const vite = process.send ? null : await createVite({ server: { middlewareMode: true,
  fs: { deny: ['**/.poc/**', '**/.local/**', '**/.git/**', '**/.{aws,ssh,azure,kube,docker,codex,agents}/**', '**/.env*', '**/{.npmrc,.netrc,_netrc,.pypirc,auth.json,credentials*,secrets*}', '**/*.{crt,pem,key,p12,pfx}', `${stateDir.replaceAll('\\', '/')}/**`] } }, appType: 'spa' });
function state() { const current = projects.current; return { desktopSessions: current ? desktop.list(current.path) : [], threadId: current?.threadId || null, project: current?.path || null, turns: current?.turns || [], busy, model: current?.model || null, models, restored: current?.restored || false, warning: [current?.warning, startupWarning].filter(Boolean).join('；') }; }
const server = createServer(async (req, res) => {
  if (!ready) { res.statusCode = 503; res.end('服务正在启动或退出'); return; }
  if (!req.url?.startsWith('/api/')) {
    if (vite) return vite.middlewares(req, res);
    // 桌面入口只提供构建产物，不公开 Vite 开发文件读取接口。
    const path = req.url === '/' ? '/index.html' : req.url || '';
    if (req.method !== 'GET' || !/^\/(?:index\.html|assets\/[\w.-]+\.(?:js|css))$/.test(path)) { res.statusCode = 404; res.end(); return; }
    try {
      res.setHeader('Content-Type', path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html; charset=utf-8');
      res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'none'");
      res.end(readFileSync(resolve('dist', '.' + path)));
    } catch { res.statusCode = 404; res.end('请先执行 npm run build'); }
    return;
  }
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  const json = (code: number, data: unknown) => { res.statusCode = code; res.end(JSON.stringify(data)); };
  // 只接受本机页面请求，避免其他网站向本地服务提交模型任务。
  if (req.headers.host !== `127.0.0.1:${port}` || (req.headers.origin && req.headers.origin !== origin)) return json(403, { error: '来源不允许' });
  if (req.method === 'GET' && req.url === '/api/state') {
    try { return json(200, state()); } catch (e) { return json(500, { error: String(e) }); }
  }
  if (req.method !== 'POST' || !['/api/send', '/api/enhance', '/api/project/select', '/api/desktop/import', '/api/desktop/refresh'].includes(req.url)) return json(404, { error: '接口不存在' });
  if (!req.headers['content-type']?.startsWith('application/json')) return json(415, { error: '需要 JSON 请求' });
  if (busy) return json(409, { error: '当前操作尚未完成' });
  busy = true;
  try {
    let body = '';
    for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > 64000) throw new Error('请求过大'); }
    const payload = JSON.parse(body);
    if (req.url === '/api/project/select') {
      if (typeof payload.path !== 'string') return json(400, { error: '请输入项目路径' });
      await projects.select(payload.path.trim().replace(/^"(.*)"$/, '$1'));
      startupWarning = desktop.discover(projects.current!.path).join('；');
      return json(200, state());
    }
    const current = projects.current;
    if (!current) return json(409, { error: '请先选择项目' });
    if (payload.threadId !== current.threadId) return json(409, { error: '当前项目或会话已变化，请刷新页面后重试' });
    let ids: string[] | null;
    try { ids = selectedDesktopIds(payload); } catch (e) { return json(400, { error: String(e) }); }
    if (req.url === '/api/desktop/refresh') {
      if (!ids) return json(400, { error: '请选择 Desktop 对话' });
      return json(200, payload.contextMode === 'multi' ? { desktopSessions: desktop.refreshMany(current.path, ids) } : { desktopSession: desktop.refresh(current.path, ids[0]) });
    }
    if (req.url === '/api/desktop/import') {
      if (typeof payload.path !== 'string') return json(400, { error: '请输入 transcript 绝对路径' });
      desktop.import(payload.path.trim().replace(/^"(.*)"$/, '$1'), undefined, current.path);
      return json(200, state());
    }
    const { draft } = payload;
    if (typeof draft !== 'string' || !draft.trim() || draft.length > 12000) return json(400, { error: '请输入 1–12000 字符的内容' });
    if (req.url === '/api/enhance') {
      let selection;
      try { selection = selectModel(payload, models); } catch (e) { return json(400, { error: String(e) }); }
      if (ids) {
        const sessions = payload.contextMode === 'multi' ? desktop.refreshMany(current.path, ids) : [desktop.refresh(current.path, ids[0])];
        const result = await enhanceDesktop(runtime, payload.contextMode === 'multi' ? sessions : sessions[0], draft, selection);
        return json(200, { ...result, modelSelection: selection, copyToken: publishValidated(result.optimizedPrompt), ...(payload.contextMode === 'multi' ? { desktopSessions: sessions } : { desktopSession: sessions[0] }), turns: current.turns });
      }
      if (!current.turns.length) return json(409, { error: '请先发送一条消息，建立主线程上下文' });
      const result = await enhance(runtime, current.threadId, draft, current.path, undefined, selection);
      await projects.refresh();
      return json(200, { ...result, modelSelection: selection, copyToken: publishValidated(result.optimizedPrompt), turns: current.turns });
    }
    if (payload.contextMode === 'multi' || ids) return json(409, { error: 'Desktop 会话仅作上下文；请切换到 Enhancer fallback 后发送' });
    await runtime!.turn(current.threadId, draft);
    await projects.refresh();
    json(200, state());
  } catch (error) {
    // 失败的生成也可能留下 Turn，不能用旧计数掩盖真实状态。
    try { await projects.refresh(); } catch { /* 首条消息尚未物化时无历史 */ }
    json(500, { error: String(error), turns: projects.current?.turns || [] });
  } finally { busy = false; }
});
// 只有完整 Enhance（包括 finally 内的完整性核验）成功，才交付宿主可复制的结果。
function publishValidated(prompt: string) {
  if (!process.send || !process.connected) return undefined;
  const token = randomUUID();
  process.send({ type: 'validated-result', token, prompt });
  return token;
}
let closing: Promise<void> | undefined;
function close() {
  return closing ||= (async () => {
    ready = false; abort.abort();
    const stopped = new Promise<void>(done => server.close(() => done()));
    server.closeAllConnections();
    await Promise.all([runtime?.close(), vite?.close(), stopped]);
    if (process.connected) process.disconnect?.();
  })();
}
process.once('SIGINT', () => void close());
process.once('SIGTERM', () => void close());
process.on('message', message => { if ((message as any)?.type === 'shutdown') void close(); });
// 宿主意外退出时 IPC 断开，只清理本服务自己持有的资源。
if (process.send) process.once('disconnect', () => void close());
try {
  // 先独占固定端口，再打开 Registry/启动 runtime，拒绝与网页入口并行写状态。
  await new Promise<void>((done, fail) => { server.once('error', fail); server.listen(port, '127.0.0.1', done); });
  runtime = await createRuntime(abort.signal);
  models = await listModelOptions(runtime);
  if (abort.signal.aborted) throw new Error('启动已取消');
  projects = new Projects(runtime, resolve(stateDir, 'projects.json'));
  desktop = new DesktopSessions();
  if (projects.registry.currentProject) {
    try { await projects.select(projects.registry.currentProject); startupWarning = desktop.discover(projects.current!.path).join('；'); }
    catch (e) { startupWarning = `原项目暂时无法打开，请重新选择：${String(e)}`; }
  }
  if (abort.signal.aborted) throw new Error('启动已取消');
  ready = true;
  writeFileSync(resolve(stateDir, 'ui-session.json'), JSON.stringify({ pid: process.pid, origin, ...state() }, (key, value) => ['turns', 'desktopSessions'].includes(key) ? undefined : value, 2));
  console.log(`Prompt Enhancer 已启动：${origin}`);
  process.send?.({ type: 'ready', origin });
  if (process.env.POC_OPEN_BROWSER === '1') spawn('powershell.exe', ['-NoProfile', '-Command', `Start-Process '${origin}'`], { windowsHide: true, stdio: 'ignore' }).on('error', console.error);
} catch (error) {
  const message = startupFailure(error);
  if (!abort.signal.aborted) { console.error(message); process.send?.({ type: 'startup-error', message }); }
  process.exitCode = abort.signal.aborted ? 0 : 1; await close();
}
