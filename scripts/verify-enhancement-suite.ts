import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createRuntime } from '../server/app-server.ts';
import { enhanceDesktop } from '../server/desktop-optimizer.ts';
import type { DesktopSession } from '../server/desktop-sessions.ts';
import { enhancementCases, evaluateEnhancement } from './enhancement-cases.ts';

mkdirSync('.poc/unit', { recursive: true });
const requested = process.argv.slice(2);
assert(requested.every(id => enhancementCases.some(c => c.id === id)), '未知评测 ID');
const cases = enhancementCases.filter(c => !requested.length || requested.includes(c.id));
const reportPath = resolve('.poc/enhancement-suite-results.json');
const results: any[] = [];
function save(status: 'running' | 'completed' | 'failed', error?: string) {
  writeFileSync(reportPath, JSON.stringify({ status, error, completed: results.length, total: cases.length,
    passed: status === 'completed' && results.every(r => r.passed), results }, null, 2));
}
save('running');
let runtime: Awaited<ReturnType<typeof createRuntime>> | undefined;
try {
  runtime = await createRuntime();
  for (const test of cases) {
    const cwd = mkdtempSync(resolve(`.poc/unit/suite-${test.id}-`));
    const files = { 'package.json': '{"name":"quality-fixture","private":true}', ...test.files };
    for (const [name, content] of Object.entries(files)) {
      mkdirSync(dirname(join(cwd, name)), { recursive: true });
      writeFileSync(join(cwd, name), content);
    }
    const sessions: DesktopSession[] = test.history.map(h => ({ sessionId: h.id, cwd, transcriptPath: null,
      title: test.id, imported: true, warnings: [], lastActiveAt: '2026-09-25T00:00:00Z',
      messages: h.messages.map((m, i) => ({ ...m, turnId: `${h.id}-${i}`, at: '2026-09-25T00:00:00Z' })) }));
    const baseline = evaluateEnhancement(test, { optimizedPrompt: test.draft, contextUsed: [], warnings: [], assumptions: [] });
    try {
      const output = await enhanceDesktop(runtime, sessions, test.draft);
      const evaluated = evaluateEnhancement(test, output);
      results.push({ id: test.id, draft: test.draft, baseline, ...evaluated, output });
    } catch (error) {
      results.push({ id: test.id, draft: test.draft, baseline, passed: false, error: String(error) });
      // 账号额度耗尽影响全部用例，停止请求，保留已完成结果和未完成数量。
      if (String(error).includes('usageLimitExceeded')) throw error;
    }
    // 每例完成即落盘，服务失败或进程中断时仍可复核已完成样本。
    save('running');
    console.log(JSON.stringify(results.at(-1)));
  }
  save('completed');
  assert(results.every(r => r.passed), `增强评测未全部通过：${reportPath}`);
} catch (error) { save('failed', String(error)); throw error; }
finally { await runtime?.close(); }
