import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createRuntime } from '../server/app-server.ts';
import { enhanceDesktop } from '../server/desktop-optimizer.ts';
import type { DesktopSession } from '../server/desktop-sessions.ts';

mkdirSync('.local/test', { recursive: true });
const cwd = mkdtempSync(resolve('.local/test/enhancement-real-'));
mkdirSync(join(cwd, 'src'));
writeFileSync(join(cwd, 'package.json'), '{"name":"enhancement-fixture","private":true}');
writeFileSync(join(cwd, 'README.md'), '# 示例应用\n首页标题和搜索框分别实现在 src/header.ts 与 src/search.ts。\n');
writeFileSync(join(cwd, 'src/header.ts'), 'export const HOME_TITLE = "旧标题";\nexport const HOME_SUBTITLE = "保持原样";\n');
writeFileSync(join(cwd, 'src/search.ts'), 'export function handleSearchKey(event: KeyboardEvent) {\n  if (event.key === "Enter") return;\n  submitSearch();\n}\ndeclare function submitSearch(): void;\n');

function session(text: string): DesktopSession {
  return { sessionId: 'enhancement-session', cwd, transcriptPath: null, title: '首页讨论',
    lastActiveAt: '2026-09-25T00:00:00Z', imported: true, warnings: [],
    messages: [{ role: 'user', turnId: 'confirmed-title', text, at: '2026-09-25T00:00:00Z' }] };
}

const runtime = await createRuntime();
try {
  const confirmed = await enhanceDesktop(runtime,
    session('我确认：首页标题改为“晨光计划”，只修改标题，不改副标题。'),
    '按照刚才确定的方案修改首页标题。');
  assert.match(confirmed.optimizedPrompt, /晨光计划/, '未带入用户已确认的标题');
  assert.match(confirmed.optimizedPrompt, /副标题/, '未保留用户已确认的范围限制');
  assert.match(confirmed.optimizedPrompt, /src\/header\.ts|HOME_TITLE/, '未定位已读源码中的标题入口');
  assert(confirmed.contextUsed.some(x => x.includes('confirmed-title')), '未说明已确认方案的来源');

  const located = await enhanceDesktop(runtime,
    session('当前讨论的是首页搜索框，相关代码在 src/search.ts。'),
    '修复首页搜索框按 Enter 没反应的问题。');
  assert.match(located.optimizedPrompt, /Enter/, '丢失原草稿中的触发条件');
  assert.match(located.optimizedPrompt, /handleSearchKey|src\/search\.ts/, '未提供可证实的实现入口');
  assert(located.contextUsed.some(x => x.includes('src/search.ts')), '未说明源码定位的依据');
  assert(!/Redis|数据库|搜索建议|自动补全/.test(located.optimizedPrompt), '增加了无依据的功能');
  console.log(JSON.stringify({ passed: true, confirmed: confirmed.optimizedPrompt, located: located.optimizedPrompt }));
} finally { await runtime.close(); }
