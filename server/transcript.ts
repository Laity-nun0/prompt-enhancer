// 非官方稳定协议：集中封装，供首次导入及选中会话的按需同步使用。
import { closeSync, openSync, readSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
export type Message = { turnId: string; role: 'user' | 'assistant'; text: string; at: string };
// 发现会话时只解析首行元数据，不解析其他项目的聊天正文。
export function readTranscriptMetadata(path: string) {
  const fd = openSync(path, 'r');
  try {
    const parts: Buffer[] = []; let size = 0;
    while (size < 256 * 1024) {
      const chunk = Buffer.alloc(1024); const n = readSync(fd, chunk, 0, chunk.length, null);
      if (!n) break;
      const lineEnd = chunk.subarray(0, n).indexOf(10);
      parts.push(chunk.subarray(0, lineEnd < 0 ? n : lineEnd)); size += n;
      if (lineEnd >= 0) {
        const row = JSON.parse(Buffer.concat(parts).toString('utf8').replace(/^\uFEFF/, ''));
        if (row.type !== 'session_meta' || typeof row.payload?.id !== 'string' || typeof row.payload?.cwd !== 'string') throw new Error('不支持的会话元数据');
        return row.payload as { id: string; cwd: string; originator?: string; source?: unknown };
      }
    }
    throw new Error('会话元数据未完成或超过读取上限');
  } finally { closeSync(fd); }
}
export function parseTranscript(path: string) {
  if (statSync(path).size > 64 * 1024 * 1024) throw new Error('历史文件超过 64 MiB，未导入');
  let sessionId = '', cwd = '', originator = '', turnId = '', lastActiveAt = '';
  const messages: Message[] = []; const warnings: string[] = [];
  function add(role: Message['role'], text: unknown, at: string) {
    if (typeof text !== 'string' || !text.trim()) return;
    const found = messages.find(m => m.turnId === turnId && m.role === role && (role === 'assistant' || m.text === text));
    if (found) { found.text = text; found.at = at; }
    else messages.push({ turnId, role, text, at });
  }
  const bytes = readFileSync(path);
  for (const line of bytes.toString('utf8').split('\n')) {
    if (!line.trim()) continue;
    let row: any; try { row = JSON.parse(line); } catch { warnings.push('跳过未完成或损坏的 transcript 行'); continue; }
    const p = row.payload || {}; const at = row.timestamp || '';
    if (row.type === 'session_meta') { sessionId = p.id; cwd = p.cwd; originator = p.originator || ''; }
    if (row.type === 'turn_context' || (row.type === 'event_msg' && p.type === 'task_started')) turnId = p.turn_id || turnId;
    if (row.type !== 'event_msg') continue;
    turnId = p.turn_id || turnId;
    if (p.type === 'user_message') add('user', p.message, at);
    if (p.type === 'agent_message') add('assistant', p.message, at);
    if (p.type === 'task_complete') add('assistant', p.last_agent_message, at);
    if (p.type === 'item_completed') {
      const item = p.item || {};
      const text = item.text || item.content?.filter((c: any) => /^(text|input_text|output_text)$/i.test(c.type)).map((c: any) => c.text).join('\n');
      if (/^userMessage$/i.test(item.type)) add('user', text, at);
      if (/^agentMessage$/i.test(item.type) && item.phase === 'final_answer') add('assistant', text, at);
    }
    if (at > lastActiveAt) lastActiveAt = at;
  }
  if (!sessionId || !cwd) throw new Error('不支持的 transcript 格式：缺少会话元数据');
  if (!messages.length) warnings.push('未识别出消息；不猜测未知 transcript 格式');
  return { sessionId, cwd, originator, messages, lastActiveAt, warnings, transcriptHash: createHash('sha256').update(bytes).digest('hex') };
}
