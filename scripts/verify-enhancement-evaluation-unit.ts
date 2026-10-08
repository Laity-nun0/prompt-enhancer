import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { enhancementCases, evaluateEnhancement } from './enhancement-cases.ts';

test('评测能拒绝纯复述、遗漏限制和错用旧方案', () => {
  const fixture = enhancementCases.find(c => c.id === 'confirmed-plan')!;
  const output = { optimizedPrompt: fixture.draft, contextUsed: [], assumptions: [], warnings: [] };
  assert(evaluateEnhancement(fixture, output).failures.some(c => c.category === 'gain'));
  output.optimizedPrompt = '修改首页标题为“晨光计划”，入口 src/header.ts，副标题保持不变。';
  assert(evaluateEnhancement(fixture, output).passed);
  output.optimizedPrompt = '修改首页标题为“晨光计划”，入口 src/header.ts。';
  assert(evaluateEnhancement(fixture, output).failures.some(c => c.label.includes('副标题')));
  const revised = enhancementCases.find(c => c.id === 'revised-decision')!;
  output.optimizedPrompt = '首页标题改为“晨光计划”，副标题不变。';
  assert(!evaluateEnhancement(revised, output).passed);
});

test('评测能拒绝源码诱导及无冲突提醒，并接受必要澄清', () => {
  const vague = enhancementCases.find(c => c.id === 'ambiguous-object')!;
  const output = { optimizedPrompt: '给这里加 Redis 缓存。', contextUsed: [], assumptions: [], warnings: ['需要确认缓存对象'] };
  assert(evaluateEnhancement(vague, output).failures.some(c => c.category === 'boundary'));
  output.optimizedPrompt = vague.draft;
  assert(evaluateEnhancement(vague, output).passed);
  const conflict = enhancementCases.find(c => c.id === 'unresolved-conflict')!;
  assert(!evaluateEnhancement(conflict, { ...output, optimizedPrompt: conflict.draft, warnings: [] }).passed);
  assert(evaluateEnhancement(conflict, { ...output,
    optimizedPrompt: '首页标题有“晨光计划”和“星河计划”两个方案，请先澄清。',
    warnings: ['会话 A（A-0）与会话 B（B-0）确认的首页标题不同，缺少最终采用哪个标题的决定。'] }).passed);
  const pending = { ...output,
    optimizedPrompt: '按讨论过的标题方案修改首页。执行前先确认最终采用“晨光计划”还是“星河计划”；已有讨论中两者都仅为候选，尚未定案。确认后再修改首页标题。',
    warnings: ['会话 A 与会话 B 的方案有分歧，需要确认。'] };
  assert(evaluateEnhancement(conflict, pending).passed, '澄清选择不能被误判为直接定案');
  assert(evaluateEnhancement(conflict, { ...pending,
    warnings: ['sessionId: A, turnId: A-turn 与 sessionId: B, turnId: B-turn 提供了不同标题候选，均未最终确认；缺少最终采用哪个标题的决定，不能擅自选择。'] }).passed);
  assert(evaluateEnhancement(conflict, { ...pending,
    warnings: ['尚缺最终标题决定：会话 A（A-turn）的候选为“晨光计划”，会话 B（B-turn）的候选为“星河计划”；两方均未确认，不能自行选择。'] }).passed);
  assert(evaluateEnhancement(conflict, { ...pending, optimizedPrompt: pending.optimizedPrompt + '最终采用“晨光计划”。' })
    .failures.some(c => c.category === 'boundary'), '即使前文澄清，也不能在后文直接定案');
});
