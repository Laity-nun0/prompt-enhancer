import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { listModelOptions, selectModel } from '../server/model-options.ts';
import { enhanceDesktop } from '../server/desktop-optimizer.ts';

test('模型目录决定允许的组合，必须显式选择模型和强度', async () => {
  const options = await listModelOptions({ rpc: async (_method, params: any) => params.cursor ? ({ data: [
    { model: 'model-b', displayName: 'B', isDefault: false, hidden: false, defaultReasoningEffort: 'medium', supportedReasoningEfforts: [{ reasoningEffort: 'medium' }] },
    { model: 'hidden', hidden: true, isDefault: false, defaultReasoningEffort: 'low', supportedReasoningEfforts: [{ reasoningEffort: 'low' }] }
  ] }) : ({ nextCursor: 'page-2', data: [
    { model: 'model-a', displayName: 'A', isDefault: true, hidden: false, defaultReasoningEffort: 'low', supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'high' }] }
  ] }) });
  assert.equal(options.length, 2);
  assert.throws(() => selectModel({}, options), /请选择模型和推理强度/);
  assert.deepEqual(selectModel({ model: 'model-a', effort: 'high' }, options), { model: 'model-a', effort: 'high' });
  for (const payload of [{ model: '', effort: '' }, { model: 'model-b', effort: 'high' }, { model: 'hidden', effort: 'low' }, { model: 'unknown', effort: 'low' }, { model: 'model-a' }, { effort: 'low' }, { model: 1, effort: 'low' }]) assert.throws(() => selectModel(payload, options));
});

test('没有运行时默认模型也可读取目录，新模型与新增强度直接可用', async () => {
  const options = await listModelOptions({ rpc: async () => ({ data: [
    { model: 'gpt-6.1-sol', displayName: 'GPT-6.1-Sol', defaultReasoningEffort: 'medium', supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'medium' }, { reasoningEffort: 'ultra' }] },
    { model: 'future-model', defaultReasoningEffort: 'high', supportedReasoningEfforts: [{ reasoningEffort: 'high' }] }
  ] }) });
  assert.equal(options.length, 2);
  assert.deepEqual(selectModel({ model: 'gpt-6.1-sol', effort: 'ultra' }, options), { model: 'gpt-6.1-sol', effort: 'ultra' });
  assert.deepEqual(selectModel({ model: 'future-model', effort: 'high' }, options), { model: 'future-model', effort: 'high' });
  assert.throws(() => selectModel({}, options), /请选择模型和推理强度/);
  await assert.rejects(listModelOptions({ rpc: async () => ({ data: [] }) }), /无法读取可用模型/);
  await assert.rejects(listModelOptions({ rpc: async () => ({ nextCursor: 'same', data: [] }) }), /游标重复/);
});

test('所选模型和强度贯穿 READY、fork、上下文、优化与范围检查', async () => {
  mkdirSync('.poc/unit', { recursive: true });
  const cwd = mkdtempSync(resolve('.poc/unit/model-option-'));
  writeFileSync(join(cwd, 'package.json'), '{}');
  const selection = { model: 'model-b', effort: 'high' };
  const calls: { method: string; params: any }[] = [];
  const turns: { text: string; selection: any }[] = [];
  const runtime = {
    rpc: async (method: string, params: any) => {
      calls.push({ method, params });
      if (method === 'thread/start') return { thread: { id: 'anchor' } };
      if (method === 'thread/read') return { thread: { turns: [{ id: 'ready', status: 'completed', items: [] }] } };
      if (method === 'thread/fork') return { thread: { id: 'fork', cwd, ephemeral: true }, sandbox: { type: 'readOnly' } };
      return {};
    },
    turn: async (_id: string, text: string, schema?: any, applied?: any) => {
      turns.push({ text, selection: applied });
      if (!schema) return { text: 'READY' };
      if (schema.required.includes('removals')) return { text: '{"removals":[]}' };
      if (schema.required.includes('directories')) return { text: '{"directories":[],"files":[]}' };
      return { text: '{"optimizedPrompt":"原文","contextUsed":[],"assumptions":[],"warnings":[]}' };
    }
  };
  const session = { sessionId: 'desktop', cwd, transcriptPath: null, title: 'test', lastActiveAt: '', imported: true, warnings: [], messages: [{ role: 'user' as const, turnId: 'one', text: 'context', at: '' }] };
  await enhanceDesktop(runtime, session, '原文', selection);
  assert.equal(calls.find(x => x.method === 'thread/start')?.params.model, selection.model);
  assert.equal(calls.find(x => x.method === 'thread/fork')?.params.model, selection.model);
  assert.equal(calls.find(x => x.method === 'thread/fork')?.params.excludeTurns, true);
  assert(turns.length >= 5);
  assert(turns.every(x => x.selection?.model === selection.model && x.selection?.effort === selection.effort));
  assert(turns.some(x => x.text.includes('Prompt Scope Validator')));
});
