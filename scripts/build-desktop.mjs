import { build } from 'esbuild';
import { cpSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
const directory = resolve('.local/package-app');
// 暂存目录位于项目内部，打包白名单不包含测试、账户或源码工作区。
rmSync(directory, { recursive: true, force: true });
mkdirSync(directory, { recursive: true });
for (const entry of ['desktop', 'dist', 'LICENSE']) cpSync(entry, resolve(directory, entry), { recursive: true });
mkdirSync(resolve(directory, 'scripts'), { recursive: true });
cpSync('scripts/startup-support.cjs', resolve(directory, 'scripts/startup-support.cjs'));
const { name, version, description, author, license, main } = JSON.parse(readFileSync('package.json', 'utf8'));
writeFileSync(resolve(directory, 'package.json'), JSON.stringify({ name, version, description, author, license, main, type: 'module' }, null, 2));
writeFileSync(resolve(directory, 'THIRD-PARTY-NOTICES.txt'), 'Electron, React, lucide-react and esbuild are MIT licensed. Codex CLI 0.161.0 is Apache-2.0 licensed; see resources/codex/LICENSE. Component licenses are included below.\n\n' + ['electron','react','react-dom','lucide-react'].map(name => name + '\n' + readFileSync('node_modules/' + name + '/LICENSE', 'utf8')).join('\n\n'));
await build({ entryPoints: ['server/index.ts'], outfile: resolve(directory, 'server/index.mjs'), bundle: true, platform: 'node', format: 'esm', target: 'node24', packages: 'external' });
console.log('桌面运行文件已生成：' + directory);
