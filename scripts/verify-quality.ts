import { strict as assert } from 'node:assert';
import { writeFileSync } from 'node:fs';
import { createRuntime } from '../server/app-server.ts';
import { enhance, parseOptimized } from '../server/optimizer.ts';

// 正向用例避免把“保守”实现成机械删掉用户明确要求；反向用例防止旧问题回归。
import { cases } from './quality-cases.ts';
assert.throws(() => parseOptimized('{"optimizedPrompt":""}'));
const runtime = await createRuntime();
const results: any[] = [];
try {
  const main = await runtime.rpc('thread/start', { cwd: runtime.cwd, ephemeral: false, sandbox: 'read-only', approvalPolicy: 'never',
    developerInstructions: '这是只读测试。不要调用工具或修改文件，只简短回复。' });
  await runtime.turn(main.thread.id, '我们在做小型项目管理应用，任务需要归属项目，字段暂定标题和完成状态。不需要登录、云同步或数据库。只是记录约束，不要实现。');
  for (const test of cases) {
    const output = await enhance(runtime, main.thread.id, test.draft);
    const text = output.optimizedPrompt;
    const passed = !test.forbidden.test(text) && test.required.test(text) && text.length <= (test.maxLength || 260);
    results.push({ draft: test.draft, passed, output });
    console.log(JSON.stringify(results.at(-1)));
  }
  writeFileSync('.poc/quality-results.json', JSON.stringify({ passed: results.every(x => x.passed), results }, null, 2));
  assert(results.every(x => x.passed), '优化器质量用例未全部通过，请检查报告');
} finally { runtime.close(); }
