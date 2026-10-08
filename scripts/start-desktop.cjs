const { spawn } = require('node:child_process');
const { join } = require('node:path');
if (!require('node:fs').existsSync(join(__dirname, '../dist/index.html'))) {
  console.error('缺少前端构建产物，请先执行 npm run build'); process.exit(1);
}
/** @type {NodeJS.ProcessEnv} */
const env = { ...process.env, POC_NODE_EXE: process.execPath };
delete env.ELECTRON_RUN_AS_NODE;
// electron npm 包在普通 Node 中返回可执行文件路径，在 Electron 内返回 API。
const executable = /** @type {string} */ (/** @type {unknown} */ (require('electron')));
const child = spawn(executable, [join(__dirname, '../desktop/main.cjs')], {
  cwd: join(__dirname, '..'), env, windowsHide: false, stdio: 'inherit',
});
child.on('error', error => { console.error(error); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code || 0; });
