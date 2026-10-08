import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { DesktopSessions, selectedDesktopIds } from '../server/desktop-sessions.ts';
import { enhanceDesktop, validateContextSources } from '../server/desktop-optimizer.ts';

mkdirSync('.poc/unit', { recursive: true });
const cwd = process.cwd();
const dir = () => mkdtempSync(resolve('.poc/unit/multi-'));
function history(id: string, project = cwd, text = id) {
  return [
    { type: 'session_meta', payload: { id, cwd: project, originator: 'Codex Desktop' } },
    { type: 'turn_context', payload: { turn_id: `${id}-turn` } },
    { type: 'event_msg', payload: { type: 'user_message', message: text } }
  ].map(row => JSON.stringify({ ...row, timestamp: '2026-09-24T00:00:00Z' })).join('\n');
}
test('服务端拒绝空、重复、超量、矛盾及非字符串 ID', () => {
  assert.deepEqual(selectedDesktopIds({ desktopSessionId: 'A' }), ['A']);
  assert.deepEqual(selectedDesktopIds({ contextMode: 'multi', desktopSessionIds: ['A', 'B'] }), ['A', 'B']);
  for (const payload of [
    { contextMode: 'multi', desktopSessionIds: [] },
    { contextMode: 'multi', desktopSessionIds: ['A', 'A'] },
    { contextMode: 'multi', desktopSessionIds: ['A', 'B', 'C', 'D', 'E', 'F'] },
    { contextMode: 'multi', desktopSessionIds: ['A', 1] },
    { contextMode: 'multi', desktopSessionIds: ['A'], desktopSessionId: 'B' },
    { contextMode: 'single', desktopSessionIds: ['A'] },
    { contextMode: 'unknown' }
  ]) assert.throws(() => selectedDesktopIds(payload));
});
test('批量同步只提交全部成功的集合；跨项目 ID 在读取正文前拒绝', () => {
  const root = dir(), registry = new DesktopSessions(root);
  for (const id of ['A', 'B', 'C']) { writeFileSync(join(root, `${id}.jsonl`), history(id)); registry.import(join(root, `${id}.jsonl`)); }
  const other = dir(); writeFileSync(join(root, 'X.jsonl'), history('X', other)); registry.import(join(root, 'X.jsonl'));
  writeFileSync(join(root, 'A.jsonl'), history('A', cwd, 'NEW_A'));
  const before = JSON.stringify(registry.sessions);
  assert.throws(() => registry.refreshMany(cwd, ['A', 'X']), /X/);
  assert.equal(JSON.stringify(registry.sessions), before);
  writeFileSync(join(root, 'B.jsonl'), history('B') + '\nBROKEN');
  assert.throws(() => registry.refreshMany(cwd, ['A', 'B']), /B/);
  assert.equal(JSON.stringify(registry.sessions), before);
  writeFileSync(join(root, 'B.jsonl'), history('B', cwd, 'NEW_B'));
  const fresh = registry.refreshMany(cwd, ['A', 'B']);
  assert(fresh[0].messages.some(m => m.text === 'NEW_A'));
  assert(fresh[1].messages.some(m => m.text === 'NEW_B'));
  assert.deepEqual(registry.sessions.C.messages, JSON.parse(before).C.messages);
});

test('来源必须配对，单来源同样拒绝伪造；源码引用不要求会话标签', () => {
  const root = dir(), registry = new DesktopSessions(root);
  for (const id of ['A', 'B']) { writeFileSync(join(root, `${id}.jsonl`), history(id)); registry.import(join(root, `${id}.jsonl`)); }
  const sources = registry.refreshMany(cwd, ['A', 'B']);
  validateContextSources(['sessionId：A：说明 turnId：A-turn：事实', 'sessionId: B, turnId: B-turn; 事实', 'src/a.ts: 入口'], sources);
  assert.throws(() => validateContextSources(['sessionId: A, turnId: B-turn; 错配'], sources), /不属于/);
  assert.throws(() => validateContextSources(['turnId: A-turn; 未绑定'], sources), /缺少/);
  assert.throws(() => validateContextSources(['sessionId: X, turnId: A-turn; 未选'], sources), /未选中/);
  assert.throws(() => validateContextSources(['sessionId: A, turnId: missing; 伪造'], [sources[0]]), /不属于/);
  assert.throws(() => validateContextSources(['sessionId: B, turnId: B-turn; 未选'], [sources[0]]), /未选中/);
  validateContextSources(['sessionId: A, turnId: A-turn; 事实 sessionId: B, turnId: B-turn; 事实'], sources);
});
test('A+B 共用优化与 Validator 快照，C 不进入；变化与总量超限阻止交付', async () => {
  const root = dir(); writeFileSync(join(root, 'package.json'), '{}');
  const registry = new DesktopSessions(root);
  for (const id of ['A', 'B', 'C']) { writeFileSync(join(root, `${id}.jsonl`), history(id, root, `ONLY_${id}`)); registry.import(join(root, `${id}.jsonl`)); }
  const [a, b] = registry.refreshMany(root, ['A', 'B']);
  const calls: string[] = [];
  const runtime = {
    rpc: async (method: string, p: any) => {
      calls.push(`${method}:${JSON.stringify(p)}`);
      assert(!['A', 'B', 'C'].includes(p.threadId));
      if (method === 'thread/start') return { thread: { id: 'anchor' } };
      if (method === 'thread/read') return { thread: { turns: [{ id: 'ready', status: 'completed', items: [] }] } };
      if (method === 'thread/fork') return { thread: { id: 'fork', cwd: root, ephemeral: true }, sandbox: { type: 'readOnly' } };
      return {};
    },
    turn: async (_id: string, text: string, schema?: any) => {
      calls.push(text);
      if (!schema) return { text: 'READY' };
      if (schema.required.includes('removals')) return { text: '{"removals":[]}' };
      if (schema.required.includes('files')) return { text: '{"directories":[],"files":[]}' };
      return { text: '{"optimizedPrompt":"原文","contextUsed":["sessionId：A：用户确认范围。turnId：A-turn：用户确认范围。"],"assumptions":[],"warnings":[]}' };
    }
  };
  const result = await enhanceDesktop(runtime, [a, b], '原文');
  const input = calls.join('\n');
  assert(input.includes('ONLY_A') && input.includes('ONLY_B') && !input.includes('ONLY_C'));
  assert(input.includes('selectedConversation') && input.includes('sessionId'));
  assert.deepEqual(result.conversationSource, { type: 'desktop-multi', sessionIds: ['A', 'B'] });
  assert.equal(result.isolation.sources.length, 2);
  const changedDuring = { ...runtime, turn: async (id: string, text: string, schema?: any) => {
    if (schema?.required.includes('removals')) writeFileSync(join(root, 'B.jsonl'), history('B', root, 'DURING'));
    return runtime.turn(id, text, schema);
  } };
  await assert.rejects(enhanceDesktop(changedDuring, [a, b], '原文'), /B/);
  writeFileSync(join(root, 'B.jsonl'), history('B', root, 'CHANGED'));
  await assert.rejects(enhanceDesktop(runtime, [a, b], '原文'), /B/);
  const huge = { ...b, messages: [{ turnId: 'B', role: 'user' as const, text: 'x'.repeat(270000), at: '' }] };
  const count = calls.length;
  await assert.rejects(enhanceDesktop(runtime, [a, huge], '原文'), /256 KiB/);
  assert.equal(calls.length, count);
  assert(readFileSync(join(root, 'A.jsonl'), 'utf8').includes('ONLY_A'));
});
