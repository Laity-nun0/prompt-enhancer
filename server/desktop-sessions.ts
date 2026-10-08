import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { projectKey, projectPath } from './project-context.ts';
import { parseTranscript, type Message } from './transcript.ts';
import { discoverDesktopSessions } from './desktop-discovery.ts';
import { readTranscriptMetadata } from './transcript.ts';
import { MAX_DESKTOP_CONTEXTS } from '../src/context-limits.ts';
export function selectedDesktopIds(payload: any): string[] | null {
  if (payload.contextMode === undefined || payload.contextMode === 'single') {
    if (payload.desktopSessionIds !== undefined) throw new Error('单对话模式不能传入多对话集合');
    if (payload.desktopSessionId == null || payload.desktopSessionId === '') return null;
    if (typeof payload.desktopSessionId !== 'string' || !payload.desktopSessionId.trim()) throw new Error('无效的 Desktop 会话 ID');
    return [payload.desktopSessionId];
  }
  if (payload.contextMode !== 'multi' || payload.desktopSessionId != null) throw new Error('上下文模式与会话字段不一致');
  const ids = payload.desktopSessionIds;
  if (!Array.isArray(ids) || !ids.length || ids.length > MAX_DESKTOP_CONTEXTS || ids.some((id: unknown) => typeof id !== 'string' || !id.trim()) || new Set(ids).size !== ids.length) throw new Error(`请选择 1–${MAX_DESKTOP_CONTEXTS} 个不同的 Desktop 对话`);
  return ids;
}
export type DesktopSession = { sessionId: string; cwd: string; transcriptPath: string | null; title: string; lastActiveAt: string; messages: Message[]; warnings: string[]; imported: boolean; hookEvents?: Record<string, string>; lastSyncedAt?: string; transcriptHash?: string };
export const desktopDataRoot = () => join(process.env.LOCALAPPDATA || process.env.HOME || '.', 'PromptEnhancer', 'desktop-sessions');
export class DesktopSessions {
  root: string; sessions: Record<string, DesktopSession>;
  constructor(root = desktopDataRoot()) {
    this.root = root; mkdirSync(root, { recursive: true });
    const file = join(root, 'registry.json');
    this.sessions = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')).sessions : {};
  }
  save() {
    const file = join(this.root, 'registry.json');
    writeFileSync(file + '.tmp', JSON.stringify({ version: 1, sessions: this.sessions }, null, 2)); renameSync(file + '.tmp', file);
  }
  discover(cwd: string, sessionsRoot?: string) {
    const found = discoverDesktopSessions(cwd, sessionsRoot);
    for (const match of found.matches) {
      const previous = Object.hasOwn(this.sessions, match.sessionId) ? this.sessions[match.sessionId] : undefined;
      if (previous?.imported && previous.transcriptPath === match.path && projectKey(previous.cwd) === projectKey(cwd)) continue;
      try { this.import(match.path, match.sessionId, cwd); }
      catch (e) { found.warnings.push(`Desktop 会话 …${match.sessionId.slice(-8)} 导入失败：${String(e)}`); }
    }
    return found.warnings;
  }
  import(path: string, expectedId?: string, expectedCwd?: string) {
    const parsed = parseTranscript(path);
    if (expectedId && parsed.sessionId !== expectedId) throw new Error('transcript 会话 ID 不符');
    if (parsed.originator !== 'Codex Desktop') throw new Error('该历史不是 Codex Desktop 会话');
    if (expectedCwd && projectKey(projectPath(parsed.cwd)) !== projectKey(projectPath(expectedCwd))) throw new Error('历史文件不属于当前项目');
    if (Object.hasOwn(this.sessions, parsed.sessionId) && this.sessions[parsed.sessionId]?.imported) return this.sessions[parsed.sessionId];
    const previous = this.sessions[parsed.sessionId];
    const session: DesktopSession = { sessionId: parsed.sessionId, cwd: projectPath(parsed.cwd), transcriptPath: path,
      title: '', lastActiveAt: parsed.lastActiveAt, messages: parsed.messages, warnings: parsed.warnings, imported: true };
    if (previous) for (const m of previous.messages) this.merge(session, m);
    if (previous && previous.lastActiveAt > session.lastActiveAt) session.lastActiveAt = previous.lastActiveAt;
    this.title(session); this.sessions[session.sessionId] = session; this.save(); return session;
  }
  title(s: DesktopSession) { s.title = s.messages.find(m => m.role === 'user')?.text.replace(/\s+/g, ' ').slice(0, 60) || '尚无用户消息'; }
  refresh(cwd: string, id: string) {
    // 按 ID 直接取当前会话；不 drain inbox、不读取其他会话 transcript。
    const previous = Object.hasOwn(this.sessions, id) ? this.sessions[id] : undefined;
    if (!previous || projectKey(previous.cwd) !== projectKey(cwd)) throw new Error('所选 Desktop 会话不属于当前项目');
    if (!previous.transcriptPath) throw new Error('当前会话没有 transcript 路径，无法同步');
    const parsed = parseTranscript(previous.transcriptPath);
    if (parsed.sessionId !== id || projectKey(projectPath(parsed.cwd)) !== projectKey(cwd) || parsed.originator !== 'Codex Desktop') throw new Error('transcript 的会话或项目与选择不符');
    if (!parsed.messages.length || parsed.warnings.length) throw new Error(`transcript 未完整解析，请等待 Desktop 写入完成后重试：${parsed.warnings.join('；')}`);
    const next: DesktopSession = { ...previous, messages: parsed.messages, lastActiveAt: parsed.lastActiveAt,
      warnings: parsed.warnings, imported: true, lastSyncedAt: new Date().toISOString(), transcriptHash: parsed.transcriptHash };
    this.title(next); this.sessions[id] = next;
    try { this.save(); } catch (e) { this.sessions[id] = previous; throw e; }
    return structuredClone(next);
  }
  refreshMany(cwd: string, ids: string[]) {
    if (!ids.length || ids.length > MAX_DESKTOP_CONTEXTS || new Set(ids).size !== ids.length) throw new Error(`请选择 1–${MAX_DESKTOP_CONTEXTS} 个不同的 Desktop 对话`);
    // 先验证整个集合的项目归属及首行身份，再解析任何正文。
    const current = ids.map(id => {
      const s = Object.hasOwn(this.sessions, id) ? this.sessions[id] : undefined;
      if (!s || projectKey(s.cwd) !== projectKey(cwd) || !s.transcriptPath) throw new Error(`会话 …${id.slice(-8)} 不属于当前项目或无法同步`);
      return s;
    });
    for (const s of current) {
      try {
        const meta = readTranscriptMetadata(s.transcriptPath!);
        if (meta.id !== s.sessionId || meta.originator !== 'Codex Desktop' || projectKey(projectPath(meta.cwd)) !== projectKey(cwd)) throw new Error('身份或项目不符');
      } catch (e) { throw new Error(`会话 …${s.sessionId.slice(-8)} 元数据校验失败：${String(e)}`); }
    }
    const next = current.map(s => {
      try {
        const parsed = parseTranscript(s.transcriptPath!);
        if (parsed.sessionId !== s.sessionId || parsed.originator !== 'Codex Desktop' || projectKey(projectPath(parsed.cwd)) !== projectKey(cwd) || !parsed.messages.length || parsed.warnings.length) throw new Error(`会话内容无效：${parsed.warnings.join('；')}`);
        const fresh: DesktopSession = { ...s, messages: parsed.messages, lastActiveAt: parsed.lastActiveAt, warnings: parsed.warnings, imported: true, lastSyncedAt: new Date().toISOString(), transcriptHash: parsed.transcriptHash };
        this.title(fresh); return fresh;
      } catch (e) { throw new Error(`会话 …${s.sessionId.slice(-8)} 同步失败：${String(e)}`); }
    });
    const previous = this.sessions;
    this.sessions = { ...previous, ...Object.fromEntries(next.map(s => [s.sessionId, s])) };
    try { this.save(); } catch (e) { this.sessions = previous; throw e; }
    return structuredClone(next);
  }
  merge(s: DesktopSession, m: Message) {
    const previous = s.messages.find(x => x.turnId === m.turnId && x.role === m.role);
    if (previous) { if (m.at >= previous.at) Object.assign(previous, m); }
    else s.messages.push(m);
    s.messages.sort((a, b) => a.turnId === b.turnId ? (a.role === b.role ? 0 : a.role === 'user' ? -1 : 1) : a.at.localeCompare(b.at));
  }
  ingest(e: any) {
    if (!['SessionStart', 'UserPromptSubmit', 'Stop'].includes(e.hook_event_name) || typeof e.session_id !== 'string' || typeof e.cwd !== 'string' || !Number.isFinite(Date.parse(e.receivedAt))) throw new Error('无效 Hook 事件');
    const cwd = projectPath(e.cwd);
    if (['__proto__','constructor','prototype'].includes(e.session_id)) throw new Error('无效 session ID');
    let s = this.sessions[e.session_id];
    if (s && projectKey(s.cwd) !== projectKey(cwd)) throw new Error('会话 cwd 冲突');
    if (!s && typeof e.transcript_path === 'string' && existsSync(e.transcript_path)) {
      try { s = this.import(e.transcript_path, e.session_id); } catch { /* 仍保留标准 Hook 消息，不猜测 transcript。 */ }
    }
    if (!s) s = { sessionId: e.session_id, cwd, transcriptPath: e.transcript_path || null, title: '', lastActiveAt: e.receivedAt, messages: [], warnings: ['历史未导入；当前仅包含已采集 Hook 消息'], imported: false };
    if (typeof e.transcript_path === 'string') s.transcriptPath = e.transcript_path;
    if (e.receivedAt > s.lastActiveAt) s.lastActiveAt = e.receivedAt;
    s.hookEvents ||= {};
    s.hookEvents[e.hook_event_name] = e.receivedAt;
    const role = e.hook_event_name === 'UserPromptSubmit' ? 'user' : 'assistant';
    const text = role === 'user' ? e.prompt : e.last_assistant_message;
    if (e.hook_event_name !== 'SessionStart' && typeof e.turn_id === 'string' && typeof text === 'string' && text.trim()) this.merge(s, { turnId: e.turn_id, role, text, at: e.receivedAt });
    this.title(s); this.sessions[s.sessionId] = s;
  }
  drain() {
    const inbox = join(this.root, 'inbox'); if (!existsSync(inbox)) return;
    for (const name of readdirSync(inbox).filter(n => n.endsWith('.json')).sort()) {
      const file = join(inbox, name);
      try { this.ingest(JSON.parse(readFileSync(file, 'utf8'))); this.save(); unlinkSync(file); }
      catch { renameSync(file, file + '.rejected'); }
    }
  }
  list(cwd: string) { this.drain(); return Object.values(this.sessions).filter(s => projectKey(s.cwd) === projectKey(cwd)).sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt)); }
  get(cwd: string, id: string) {
    const session = this.list(cwd).find(s => s.sessionId === id);
    if (!session) throw new Error('所选 Desktop 会话不属于当前项目或已不可用');
    if (!session.messages.length) throw new Error('该 Desktop 会话尚无可用消息');
    return structuredClone(session);
  }
}
