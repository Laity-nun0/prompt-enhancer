import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { desktopDataRoot } from '../server/desktop-sessions.ts';
// 仅修改官方用户级 hooks.json；不改 Desktop runtime、信任哈希或项目配置。
const root = desktopDataRoot();
const codexHome = process.env.CODEX_HOME || join(process.env.USERPROFILE!, '.codex');
const target = join(codexHome, 'hooks.json');
const config = existsSync(target) ? JSON.parse(readFileSync(target, 'utf8')) : { hooks: {} };
const collector = join(root, 'desktop-hook.cjs');
mkdirSync(root, { recursive: true });
copyFileSync(resolve('scripts/desktop-hook.cjs'), collector);
const command = `"${process.execPath}" "${collector}" "${root}"`;
config.hooks ||= {};
for (const event of ['SessionStart', 'UserPromptSubmit', 'Stop']) {
  config.hooks[event] ||= [];
  if (!config.hooks[event].some((group: any) => group.hooks?.some((h: any) => h.command === command))) {
    config.hooks[event].push({ hooks: [{ type: 'command', command, async: true, timeout: 2 }] });
  }
}
if (existsSync(target)) copyFileSync(target, join(root, `hooks-backup-${Date.now()}.json`));
writeFileSync(target, JSON.stringify(config, null, 2));
console.log(JSON.stringify({ target, collector, trust: '需要通过 Codex 官方 Hook 审核；脚本不修改信任状态。' }));
