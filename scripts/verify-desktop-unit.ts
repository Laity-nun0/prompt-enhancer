import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DesktopSessions } from '../server/desktop-sessions.ts';
import { parseTranscript } from '../server/transcript.ts';
import { enhanceDesktop } from '../server/desktop-optimizer.ts';
const cwd = process.cwd(); mkdirSync('.local/test', { recursive: true });
const dir = () => mkdtempSync(resolve('.local/test/desktop-'));
test('Hook 被动输出、错误不阻断、仅写指定数据目录', () => {
  const root = dir();
  for (const input of ['invalid', JSON.stringify({ hook_event_name: 'Stop', session_id: 'A', cwd, turn_id: 't', last_assistant_message: 'done' })]) {
    const child = spawnSync(process.execPath, ['scripts/desktop-hook.cjs', root], { input, encoding: 'utf8' });
    assert.equal(child.status, 0); assert.equal(child.stdout.trim(), '{}'); assert.equal(child.stderr, '');
  }
  assert.equal(readdirSync(join(root, 'inbox')).length, 1);
});
test('同项目三会话、乱序 Stop、去重和重启恢复', () => {
  const root = dir(); const r = new DesktopSessions(root);
  for (const id of ['A', 'B', 'C']) {
    r.ingest({ hook_event_name: 'Stop', session_id: id, cwd, turn_id: id, last_assistant_message: id, receivedAt: '2026-09-23T00:00:02Z' });
    r.ingest({ hook_event_name: 'UserPromptSubmit', session_id: id, cwd, turn_id: id, prompt: `only-${id}`, receivedAt: '2026-09-23T00:00:01Z' });
    r.ingest({ hook_event_name: 'UserPromptSubmit', session_id: id, cwd, turn_id: id, prompt: `only-${id}`, receivedAt: '2026-09-23T00:00:01Z' });
  }
  r.save(); const restored = new DesktopSessions(root);
  assert.equal(restored.list(cwd).length, 3);
  for (const id of ['A', 'B', 'C']) { const s = restored.get(cwd, id); assert.equal(s.messages.length, 2); assert.equal(s.messages[0].text, `only-${id}`); }
  assert.throws(() => restored.get(resolve('.poc'), 'A'));
});
test('transcript 独立解析：忽略工具/系统/中间回复；只导入一次', () => {
  const root = dir(), file = join(root, 'history.jsonl');
  const rows = [ { type: 'session_meta', payload: { id: 'A', cwd, originator: 'Codex Desktop' } },
    { type: 'turn_context', payload: { turn_id: 't' } },
    { type: 'event_msg', payload: { type: 'item_completed', item: { type: 'UserMessage', content: [{ type: 'text', text: 'hello' }] } } },
    { type: 'response_item', payload: { role: 'developer', content: 'SECRET' } },
    { type: 'event_msg', payload: { type: 'item_completed', item: { type: 'AgentMessage', phase: 'commentary', text: 'SECRET' } } },
    { type: 'event_msg', payload: { type: 'task_complete', last_agent_message: 'final' } } ];
  writeFileSync(file, rows.map(r => JSON.stringify({ ...r, timestamp: '2026-09-23T00:00:00Z' })).join('\n'));
  assert.deepEqual(parseTranscript(file).messages.map(m => m.text), ['hello', 'final']);
  const r = new DesktopSessions(root); r.import(file);
  r.ingest({ hook_event_name: 'Stop', session_id: 'A', cwd, turn_id: 't', last_assistant_message: 'new final', receivedAt: '2026-09-23T00:01:00Z' }); r.save();
  r.import(file); assert.equal(r.get(cwd, 'A').messages[1].text, 'new final');
});
test('Desktop A/B/C 不传入其他会话；RPC 绝不操作 Desktop ID；保持 ephemeral fork', async () => {
  const root = dir(); writeFileSync(join(root, 'package.json'), '{}');
  for (const id of ['A', 'B', 'C']) {
    const calls: any[] = [], inputs: string[] = []; const turns = [{ id: 'neutral', status: 'completed', items: [] }];
    const runtime = {
      rpc: async (method: string, p: any) => { calls.push({ method, ...p });
        assert.notEqual(p.threadId, id);
        if (method === 'thread/start') return { thread: { id: 'anchor' } };
        if (method === 'thread/read') return { thread: { turns } };
        if (method === 'thread/fork') return { thread: { id: 'fork', cwd: root, ephemeral: true }, sandbox: { type: 'readOnly' } };
        return {};
      },
      turn: async (_: string, text: string, schema?: any) => { inputs.push(text); return { text: !schema ? 'READY' : schema.required.includes('removals') ? '{"removals":[]}' : schema.required.includes('files') ? '{"directories":[],"files":[]}' : '{"optimizedPrompt":"原文","contextUsed":[],"assumptions":[],"warnings":[]}' }; }
    };
    await enhanceDesktop(runtime, { sessionId: id, cwd: root, transcriptPath: null, title: id, lastActiveAt: '', imported: false, warnings: [], messages: [{ turnId: id, role: 'user', text: `ONLY_SESSION_${id}`, at: '' }] }, '原文');
    const all = inputs.join('\n'); assert(all.includes(`ONLY_SESSION_${id}`));
    for (const other of ['A','B','C'].filter(x => x !== id)) assert(!all.includes(`ONLY_SESSION_${other}`));
    assert(calls.some(c => c.method === 'thread/fork' && c.ephemeral === true));
    assert(calls.some(c => c.method === 'thread/archive'));
  }
});
