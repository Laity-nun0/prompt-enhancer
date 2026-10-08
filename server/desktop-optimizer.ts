import { strict as assert } from 'node:assert';
import { enhance } from './optimizer.ts';
import type { DesktopSession } from './desktop-sessions.ts';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import type { ModelSelection } from './model-options.ts';

// 按引用顺序绑定来源，避免真实会话 ID 与另一会话的真实轮次拼成假引用。
export function validateContextSources(claims: string[], sessions: DesktopSession[]) {
  for (const claim of claims) {
    let source = sessions.length === 1 ? sessions[0] : undefined;
    for (const match of claim.matchAll(/(sessionId|turnId)\s*[：:=]\s*([^\s,，;；:：)）\]}]+)/g)) {
      if (match[1] === 'sessionId') {
        source = sessions.find(s => s.sessionId === match[2]);
        assert(source, `优化依据引用了未选中的会话：${match[2]}`);
      } else {
        assert(source, '优化依据的轮次缺少对应 sessionId');
        assert(source.messages.some(m => m.turnId === match[2]), `优化依据的轮次不属于会话 ${source.sessionId}：${match[2]}`);
      }
    }
  }
}
// 独立空白基底只含固定确认消息；不 fork、resume 或写入任何 Desktop session。
// 空线程不能直接沿用已验证的 fork 路径，因此先物化一个固定 Turn。
export async function enhanceDesktop(runtime: any, selected: DesktopSession | DesktopSession[], draft: string, selection?: ModelSelection) {
  const sessions = Array.isArray(selected) ? selected : [selected];
  assert(sessions.length > 0, '未选择 Desktop 对话');
  const conversation = sessions.length === 1 && !Array.isArray(selected)
    ? { sessionId: sessions[0].sessionId, messages: sessions[0].messages }
    : { mode: 'multi', sessions: sessions.map(s => ({ sessionId: s.sessionId, title: s.title, messages: s.messages })) };
  assert(Buffer.byteLength(JSON.stringify(conversation)) <= 256 * 1024, '所选对话合计超过 256 KiB，请减少所选对话');
  const transcripts = sessions.map(s => {
    try {
      const bytes = s.transcriptPath ? readFileSync(s.transcriptPath) : null;
      if (s.transcriptHash && bytes) assert.equal(createHash('sha256').update(bytes).digest('hex'), s.transcriptHash);
      return bytes;
    } catch { throw new Error(`会话 …${s.sessionId.slice(-8)} 同步后 transcript 已变化，请重试`); }
  });
  const source = await runtime.rpc('thread/start', { cwd: sessions[0].cwd, ephemeral: false, sandbox: 'read-only', approvalPolicy: 'never', ...(selection ? { model: selection.model } : {}),
    developerInstructions: '这是 Prompt Optimizer 的独立空白基底。不要调用工具或执行用户任务；后续临时线程按当次增强指令生成结果。' });
  const id = source.thread.id;
  for (const s of sessions) assert.notEqual(id, s.sessionId);
  try {
    await runtime.turn(id, '仅回复 READY。', undefined, selection);
    const result = await enhance(runtime, id, draft, sessions[0].cwd, conversation, selection);
    validateContextSources(result.contextUsed, sessions);
    const verification = sessions.map((s, i) => {
      try {
        if (transcripts[i]) assert(transcripts[i].equals(readFileSync(s.transcriptPath!)));
        return { sessionId: s.sessionId, transcriptVerified: !!transcripts[i] };
      } catch { throw new Error(`会话 …${s.sessionId.slice(-8)} 在优化期间发生变化，请刷新后重试`); }
    });
    const count = sessions.reduce((n, s) => n + new Set(s.messages.map(m => m.turnId)).size, 0);
    return { ...result, warnings: [...result.warnings, ...sessions.flatMap(s => s.warnings)],
      conversationSource: sessions.length === 1 && !Array.isArray(selected) ? { type: 'desktop', sessionId: sessions[0].sessionId } : { type: 'desktop-multi', sessionIds: sessions.map(s => s.sessionId) },
      isolation: { beforeTurns: count, afterTurns: count, unchanged: true, transcriptVerified: verification.every(v => v.transcriptVerified), sources: verification, mode: 'desktop-data-only' } };
  } finally { await runtime.rpc('thread/archive', { threadId: id }); }
}
