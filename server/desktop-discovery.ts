import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { projectKey, projectPath } from './project-context.ts';
import { readTranscriptMetadata } from './transcript.ts';

// 只读用户会话目录；不启动 Desktop runtime，不访问凭据或内部数据库。
export function discoverDesktopSessions(cwd: string, sessionsRoot = join(homedir(), '.codex', 'sessions')) {
  const matches: { sessionId: string; path: string }[] = [];
  const warnings: string[] = []; let skipped = 0;
  const target = projectKey(projectPath(cwd));
  function visit(dir: string) {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); }
    catch { warnings.push('部分 Desktop 会话目录不可读取，列表可能不完整'); return; }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) { visit(path); continue; }
      if (!entry.isFile() || !/^rollout-.*\.jsonl$/.test(entry.name)) continue;
      try {
        const meta = readTranscriptMetadata(path);
        if (meta.originator !== 'Codex Desktop' || (typeof meta.source === 'object' && meta.source !== null && 'subagent' in meta.source)) continue;
        let key: string; try { key = projectKey(projectPath(meta.cwd)); } catch { continue; }
        if (key === target) matches.push({ sessionId: meta.id, path });
      } catch { skipped++; }
    }
  }
  if (existsSync(sessionsRoot)) visit(sessionsRoot);
  else warnings.push('未找到本机 Desktop sessions 目录，可使用“导入已有会话”指定 transcript');
  if (skipped) warnings.push(`${skipped} 个会话文件的元数据不可读取，已跳过`);
  return { matches, warnings: [...new Set(warnings)] };
}
