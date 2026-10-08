import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createRuntime } from '../server/app-server.ts';
import { enhanceDesktop } from '../server/desktop-optimizer.ts';
import { listModelOptions, selectModel } from '../server/model-options.ts';

assert(process.env.POC_VERIFY_MODEL && process.env.POC_VERIFY_EFFORT, '请通过 POC_VERIFY_MODEL 和 POC_VERIFY_EFFORT 显式指定验收模型与推理强度');
mkdirSync('.poc/unit', { recursive: true });
const cwd = mkdtempSync(resolve('.poc/unit/model-real-'));
writeFileSync(join(cwd, 'package.json'), '{"name":"model-choice-real","private":true}');
const runtime = await createRuntime();
const rpc = runtime.rpc, turn = runtime.turn;
const calls: { method: string; model?: string; effort?: string }[] = [];
try {
  const options = await listModelOptions(runtime);
  const selection = selectModel({ model: process.env.POC_VERIFY_MODEL, effort: process.env.POC_VERIFY_EFFORT }, options);
  runtime.rpc = async (method: string, params: any) => {
    if (method === 'thread/start' || method === 'thread/fork') calls.push({ method, model: params.model });
    return rpc(method, params);
  };
  runtime.turn = async (id: string, text: string, schema?: any, chosen?: any) => {
    calls.push({ method: 'turn/start', model: chosen?.model, effort: chosen?.effort });
    return turn(id, text, schema, chosen);
  };
  const result = await enhanceDesktop(runtime, { sessionId: 'synthetic-model-check', cwd, transcriptPath: null, title: '验证模型切换', lastActiveAt: '', imported: true, warnings: [], messages: [{ role: 'user', turnId: 't1', text: '只需改写当前草稿，不增加其他任务。', at: '' }] }, '请把这个提问写得更清楚。', selection);
  assert(result.optimizedPrompt.trim());
  assert(calls.some(call => call.method === 'thread/start' && call.model === selection.model));
  assert(calls.some(call => call.method === 'thread/fork' && call.model === selection.model));
  assert(calls.filter(call => call.method === 'turn/start').length >= 4);
  assert(calls.filter(call => call.method === 'turn/start').every(call => call.model === selection.model && call.effort === selection.effort));
  writeFileSync('.poc/model-choice-real.json', JSON.stringify({ passed: true, selection, calls, result }, null, 2));
  console.log(JSON.stringify({ passed: true, selection, turns: calls.filter(call => call.method === 'turn/start').length }));
} finally { await runtime.close(); }
