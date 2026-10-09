import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createRuntime } from '../server/app-server.ts';
import { enhanceDesktop } from '../server/desktop-optimizer.ts';
import type { DesktopSession } from '../server/desktop-sessions.ts';
import { enhancementCases, evaluateEnhancement } from './enhancement-cases.ts';

mkdirSync('.local/test', { recursive: true });
const cwd = mkdtempSync(resolve('.local/test/multi-real-'));
writeFileSync(join(cwd, 'package.json'), '{"name":"multi-real-fixture","private":true}');
function session(sessionId: string, text: string): DesktopSession {
  return { sessionId, cwd, transcriptPath: null, title: text.slice(0, 40), lastActiveAt: '2026-09-24T00:00:00Z', imported: true,
    warnings: [], messages: [{ role: 'user', turnId: `${sessionId}-turn`, text, at: '2026-09-24T00:00:00Z' }] };
}
const runtime = await createRuntime();
try {
  const complementary = await enhanceDesktop(runtime, [
    session('A', '当前讨论的是首页标题文案调整，只需要修改标题文字。'),
    session('B', '我确认首页标题最终使用“晨光计划”；不要顺带修改副标题。')
  ], '按照刚才确认的方案修改首页标题。');
  assert(complementary.optimizedPrompt.includes('晨光计划'), '互补来源中的已确认标题未纳入结果');
  assert(!/同时修改副标题|并修改副标题|新增副标题/.test(complementary.optimizedPrompt), '结果额外要求修改副标题');
  const conflicting = await enhanceDesktop(runtime, [
    session('A', '首页标题候选为“晨光计划”，目前尚未最终确认。'),
    session('B', '首页标题候选为“星河计划”，与另一候选之间尚未决定。')
  ], '按讨论过的标题方案修改首页。');
  const conflictCheck = evaluateEnhancement(enhancementCases.find(c => c.id === 'unresolved-conflict')!, conflicting);
  writeFileSync('.local/multi-real-results.json', JSON.stringify({ passed: conflictCheck.passed, complementary, conflicting, conflictCheck }, null, 2));
  assert(conflictCheck.passed, `未决冲突处理不完整：${JSON.stringify(conflictCheck.failures)}；${conflicting.optimizedPrompt}`);
  console.log(JSON.stringify({ passed: true, complementary: complementary.optimizedPrompt, conflictWarnings: conflicting.warnings, conflictAssumptions: conflicting.assumptions }));
} finally { await runtime.close(); }
