import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { createRequire } from 'node:module';
import { clipboardDecision } from '../src/companion.ts';
import { enhanceDesktop } from '../server/desktop-optimizer.ts';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
const { ValidatedResults } = createRequire(import.meta.url)('../desktop/results.cjs');

test('剪贴板导入不静默覆盖；空白、相同、超长、忙碌分别处理', () => {
  assert.equal(clipboardDecision('', '新草稿', false), 'load');
  assert.equal(clipboardDecision('旧草稿', '新草稿', false), 'confirm');
  assert.equal(clipboardDecision('', '新草稿', true), 'confirm');
  assert.equal(clipboardDecision('同一草稿', '同一草稿', false), 'same');
  assert.equal(clipboardDecision('草稿', ' \n', false), 'empty');
  assert.equal(clipboardDecision('', 'x'.repeat(12001), false), 'too-long');
});
test('只能兑换后端结果凭证，不接受 renderer 任意文本、旧凭证或重复复制', () => {
  const results = new ValidatedResults();
  assert.throws(() => results.take('candidate'));
  results.accept({ token: 'old', prompt: '旧结果' });
  results.accept({ token: 'current', prompt: '最终校验结果' });
  assert.throws(() => results.take('old'));
  assert.throws(() => results.take({ token: 'current' }));
  assert.equal(results.take('current'), '最终校验结果');
  assert.throws(() => results.take('current'));
});

for (const failure of ['none', 'optimizer', 'validator', 'transcript', 'source', 'citation', 'history', 'archive']) {
  test(`只有全部校验完成才交付可复制结果：${failure}`, async () => {
    mkdirSync('.poc/unit', { recursive: true });
    const root = mkdtempSync(resolve('.poc/unit/companion-'));
    const file = join(root, 'package.json'); writeFileSync(file, '{}');
    const transcript = join(root, 'history.jsonl'); writeFileSync(transcript, '测试只读原文');
    const sourceBytes = readFileSync(file), transcriptBytes = readFileSync(transcript);
    let reads = 0;
    const runtime = {
      rpc: async (method: string) => {
        if (method === 'thread/start') return { thread: { id: 'anchor' } };
        if (method === 'thread/fork') return { thread: { id: 'fork', cwd: root, ephemeral: true }, sandbox: { type: 'readOnly' } };
        if (method === 'thread/read') return { thread: { turns: [{ id: failure === 'history' && ++reads > 1 ? 'changed' : 'original', status: 'completed' }] } };
        if (method === 'thread/archive' && failure === 'archive') throw new Error('archive failed');
        return {};
      },
      turn: async (_: string, _text: string, schema?: any) => {
        if (!schema) return { text: 'READY' };
        if (schema.required.includes('files')) return { text: '{"directories":[],"files":[]}' };
        if (schema.required.includes('removals')) {
          if (failure === 'validator') throw new Error('validator failed');
          // 仅修改本次创建的测试 fixture，绝不接触真实项目和 transcript。
          if (failure === 'source') writeFileSync(file, '{"changed":true}');
          if (failure === 'transcript') writeFileSync(transcript, '测试并发变化');
          return { text: '{"removals":[{"text":"额外功能。","reason":"未授权"}]}' };
        }
        if (failure === 'optimizer') throw new Error('optimizer failed');
        if (failure === 'citation') return { text: '{"optimizedPrompt":"原始需求。额外功能。","contextUsed":["sessionId: desktop, turnId: other; 错误轮次"],"assumptions":[],"warnings":[]}' };
        return { text: '{"optimizedPrompt":"原始需求。额外功能。","contextUsed":[],"assumptions":[],"warnings":[]}' };
      },
    };
    let clipboard = '用户原有剪贴板';
    const run = async () => {
      const result = await enhanceDesktop(runtime, { sessionId: 'desktop', cwd: root, transcriptPath: transcript, title: '', lastActiveAt: '', imported: true, warnings: [], messages: [{ role: 'user', turnId: 't', text: '原始需求。', at: '' }] }, '原始需求。');
      const results = new ValidatedResults(); results.accept({ token: 'checked', prompt: result.optimizedPrompt });
      clipboard = results.take('checked');
    };
    if (failure === 'none') {
      await run(); assert.equal(clipboard, '原始需求。');
      assert.deepEqual(readFileSync(file), sourceBytes); assert.deepEqual(readFileSync(transcript), transcriptBytes);
    } else { await assert.rejects(run); assert.equal(clipboard, '用户原有剪贴板'); }
  });
}
