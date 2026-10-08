// 被动收集器：只写用户数据目录，不读取项目、不调用模型、不输出上下文。
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
let input = '', oversized = false;
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { if (input.length + chunk.length > 2 * 1024 * 1024) oversized = true; else input += chunk; });
process.stdin.on('error', () => process.exit(0));
process.stdin.on('end', () => {
  try {
    const e = JSON.parse(input);
    if (oversized || !['SessionStart', 'UserPromptSubmit', 'Stop'].includes(e.hook_event_name) || typeof e.session_id !== 'string' || typeof e.cwd !== 'string') return;
    const root = process.argv[2];
    if (!root || !path.isAbsolute(root)) return;
    const dir = path.join(root, 'inbox'); fs.mkdirSync(dir, { recursive: true });
    const event = { session_id: e.session_id, cwd: e.cwd, hook_event_name: e.hook_event_name,
      transcript_path: e.transcript_path, turn_id: e.turn_id, prompt: e.prompt,
      last_assistant_message: e.last_assistant_message, receivedAt: new Date().toISOString() };
    const file = path.join(dir, `${Date.now()}-${randomUUID()}`);
    fs.writeFileSync(file + '.tmp', JSON.stringify(event), { flag: 'wx' });
    fs.renameSync(file + '.tmp', file + '.json');
  } catch { /* 收集失败不得阻断 Desktop。 */ }
  finally { process.stdout.write('{}\n'); }
});
