const { spawn } = require('node:child_process');
const { join } = require('node:path');
const { existsSync } = require('node:fs');
const { stateDirectory } = require('./startup-support.cjs');
function fail(message) { console.error(message); process.exit(1); }
if (Number(process.versions.node.split('.')[0]) < 24) fail('需要 Node.js >=24。请安装 Node.js 24 或更新版本后重试。');
if (process.platform !== 'win32' || process.arch !== 'x64') fail('当前版本仅支持 Windows x64（win32 x64），请使用对应平台的 Node.js。');
try { stateDirectory(join(__dirname, '..')); } catch (error) { fail(error.message); }
if (!existsSync(join(__dirname, '../dist/index.html'))) fail('缺少前端构建产物，请先执行 npm run build。');
/** @type {NodeJS.ProcessEnv} */
const env = { ...process.env, PROMPT_ENHANCER_NODE_EXE: process.execPath };
delete env.ELECTRON_RUN_AS_NODE;
// electron npm 包在普通 Node 中返回可执行文件路径，在 Electron 内返回 API。
let executable;
try { executable = require('electron'); } catch { fail('Electron 二进制尚未下载。请执行 npm ci；如安装脚本被禁用，再执行 node node_modules/electron/install.js。'); }
if (typeof executable !== 'string' || !existsSync(executable)) fail('Electron 二进制缺失，请执行 node node_modules/electron/install.js 下载后重试。');
if (process.argv.includes('--check')) { console.log('启动准备检查通过：Node.js、Windows x64、构建产物及 Electron 二进制可用。'); process.exit(0); }
const child = spawn(executable, [join(__dirname, '../desktop/main.cjs')], {
  cwd: join(__dirname, '..'), env, windowsHide: false, stdio: 'inherit',
});
child.on('error', () => { console.error('Electron 无法启动，请检查二进制文件和系统权限。'); process.exitCode = 1; });
child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
