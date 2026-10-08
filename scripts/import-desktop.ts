import { DesktopSessions } from '../server/desktop-sessions.ts';
const registry = new DesktopSessions();
for (const path of process.argv.slice(2)) {
  const s = registry.import(path);
  console.log(JSON.stringify({ sessionId: s.sessionId, cwd: s.cwd, title: s.title, messages: s.messages.length, turns: new Set(s.messages.map(m => m.turnId)).size, warnings: s.warnings }));
}
