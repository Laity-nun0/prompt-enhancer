import type { Optimized } from '../server/optimizer.ts';

type Check = { label: string; field: 'optimizedPrompt' | 'warnings' | 'contextUsed'; pattern: RegExp; absent?: boolean };
export type EnhancementCase = {
  id: string; draft: string;
  history: { id: string; messages: { role: 'user' | 'assistant'; text: string }[] }[];
  files: Record<string, string>;
  preserve: Check[]; gain: Check[]; boundary: Check[]; clarification: Check[];
};
const prompt = (label: string, pattern: RegExp, absent = false): Check => ({ label, field: 'optimizedPrompt', pattern, absent });
const warning = (label: string, pattern: RegExp): Check => ({ label, field: 'warnings', pattern });
const titleFiles = { 'src/header.ts': 'export const HOME_TITLE = "旧标题";\nexport const HOME_SUBTITLE = "保持原样";\n' };
const user = (text: string) => ({ role: 'user' as const, text });

// 每例明确保留项、可证实增益、禁止扩展和澄清要求；不以长度或模型自评分代替质量。
export const enhancementCases: EnhancementCase[] = [
  { id: 'confirmed-plan', draft: '按照刚才确定的方案修改首页标题。', files: titleFiles,
    history: [{ id: 'A', messages: [user('我确认：首页标题改为“晨光计划”，只修改标题，不改副标题。')] }],
    preserve: [prompt('保留首页标题对象', /首页.*标题/)],
    gain: [prompt('补入已确认文案', /晨光计划/), prompt('补入副标题限制', /(?:不改|不修改|保持|保留|不变|不动).*副标题|副标题.*(?:不变|不改|保持)/), prompt('补入源码入口', /src\/header\.ts|HOME_TITLE/)],
    boundary: [prompt('没有新增标题功能', /新增.*(?:动画|按钮|主题)/, true)], clarification: [] },
  { id: 'bug-location', draft: '修复首页搜索框按 Enter 没反应的问题。',
    history: [{ id: 'A', messages: [user('首页搜索框由 src/search.ts 处理。')] }],
    files: { 'src/search.ts': 'export function handleSearchKey(event: KeyboardEvent) {\n  if (event.key === "Enter") return;\n  submitSearch();\n}\ndeclare function submitSearch(): void;\n' },
    preserve: [prompt('保留 Enter 触发条件', /Enter/), prompt('保留修复动作', /修复|解决/)],
    gain: [prompt('定位真实处理入口', /src\/search\.ts|handleSearchKey/), prompt('指出提前返回行为', /提前返回|直接返回|return|直接退出/)],
    boundary: [prompt('不引入搜索附加功能', /Redis|自动补全|搜索建议/, true)], clarification: [] },
  { id: 'revised-decision', draft: '按最终确认的名字修改首页标题，副标题保持原样。', files: titleFiles,
    history: [{ id: 'A', messages: [user('首页标题先确定为“晨光计划”。'), user('撤销刚才的名字，最终确认改为“星河计划”，副标题不改。')] }],
    preserve: [prompt('保留副标题限制', /副标题/)], gain: [prompt('采用明确撤销后的决定', /星河计划/)],
    boundary: [prompt('不把旧文案作为待实施方案', /(?:改为|使用|采用)[“「"]?晨光计划/, true)],
    clarification: [{ label: '明确修订不应误报未决冲突', field: 'warnings', pattern: /无法确定|尚未确定|需要.*(?:确认|澄清)|存在冲突/, absent: true }] },
  { id: 'stale-turn-only', draft: '现在实现刚才确认的导出功能，仅支持 CSV。',
    history: [{ id: 'A', messages: [user('已确认：导出订单列表，只导出订单号和金额，不含客户邮箱。这一轮先记录，不要实现。')] }],
    files: { 'src/orders.ts': 'export const orders = [{ orderNo: "A1", amount: 10, email: "private@example.test" }];\n' },
    preserve: [prompt('仍然要求实施', /实现|开发/), prompt('保留 CSV', /CSV/)],
    gain: [prompt('补入确认的字段', /订单号.*金额|金额.*订单号/), prompt('补入邮箱排除约束', /(?:不含|不包含|排除|不导出|禁止导出).*邮箱|邮箱.*(?:排除|不导出)/)],
    boundary: [prompt('不沿用临时停止指令', /(?:先|仅|只)(?:记录|写需求)|不要实现|暂不实现/, true), prompt('不新增导出格式', /支持.*(?:Excel|PDF|JSON)/, true)], clarification: [] },
  { id: 'unconfirmed-suggestion', draft: '按照已经确认的范围添加搜索。',
    history: [{ id: 'A', messages: [user('确认只在订单列表中按订单号精确搜索。'), { role: 'assistant', text: '建议顺便加入模糊匹配、分页和自动补全，但这些尚未确认。' }] }],
    files: { 'src/orders.ts': 'export const orders = [];\n' },
    preserve: [prompt('保留搜索动作', /搜索/)], gain: [prompt('补入确认的对象和匹配方式', /订单号.*精确|精确.*订单号/)],
    boundary: [prompt('不把助手建议变成任务', /(?:增加|添加|实现|支持|加入|提供)(?:模糊匹配|分页|自动补全)/, true)], clarification: [] },
  { id: 'unresolved-conflict', draft: '按讨论过的标题方案修改首页。', files: titleFiles,
    history: [{ id: 'A', messages: [user('我确认首页标题使用“晨光计划”。')] }, { id: 'B', messages: [user('我确认首页标题使用“星河计划”。')] }],
    preserve: [prompt('保留首页对象', /首页/)], gain: [],
    boundary: [prompt('不直接定案', /(?:^|[。；;\n])\s*(?:请)?(?:将?首页标题)?(?:最终使用|最终采用|最终确定为|直接改为)\s*[“「"]?(?:晨光计划|星河计划)/, true)],
    // 联合检查双方来源、两个方案和执行前澄清，不强制提醒出现“冲突”等措辞。
    clarification: [warning('提醒中标出双方来源', /A[\s\S]*B|B[\s\S]*A/), prompt('执行文本中保留具体分歧', /晨光计划[\s\S]*星河计划|星河计划[\s\S]*晨光计划/), prompt('执行文本中也保留待定状态', /澄清|确认|未决|未确定|冲突|待定/)] },
  { id: 'draft-overrides-history', draft: '这次首页标题直接改为“远山计划”，不要再询问标题方案，副标题不变。', files: titleFiles,
    history: [{ id: 'A', messages: [user('首页标题用“晨光计划”。')] }, { id: 'B', messages: [user('首页标题用“星河计划”。')] }],
    preserve: [prompt('当前文案优先', /远山计划/), prompt('保留副标题限制', /副标题/)], gain: [],
    boundary: [prompt('不实施旧方案', /(?:改为|采用|使用)[“「"]?(?:晨光计划|星河计划)/, true)],
    clarification: [{ label: '草稿已解决冲突，不再阻塞实施', field: 'warnings', pattern: /需要.*(?:确认|澄清)|无法确定|尚未确定/, absent: true }] },
  { id: 'ambiguous-object', draft: '给这里加缓存。',
    history: [{ id: 'A', messages: [user('此前讨论的是页脚文案，与本次缓存对象无关。')] }],
    files: { 'src/cache.ts': 'export const redisExample = { ttl: 60 };\n', 'src/footer.ts': 'export const footer = "页脚";\n' },
    preserve: [prompt('保留缓存动作', /缓存/)], gain: [],
    boundary: [prompt('不被无关源码诱导指定方案', /Redis|TTL|src\/cache\.ts|redisExample|页脚缓存/i, true)],
    clarification: [warning('指出缓存对象缺失', /对象|哪里|位置|哪部分|哪个|范围/)] }
];

export function evaluateEnhancement(test: EnhancementCase, output: Optimized) {
  const checks = (['preserve', 'gain', 'boundary', 'clarification'] as const).flatMap(category =>
    test[category].map(check => {
      const value = output[check.field];
      const matched = check.pattern.test(Array.isArray(value) ? value.join('\n') : value);
      return { category, label: check.label, passed: check.absent ? !matched : matched };
    }));
  return { passed: checks.every(c => c.passed), checks, failures: checks.filter(c => !c.passed) };
}
