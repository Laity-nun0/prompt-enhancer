import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { DesktopSessions } from '../server/desktop-sessions.ts';
import { discoverDesktopSessions } from '../server/desktop-discovery.ts';
mkdirSync('.local/test', { recursive: true });
test('按 cwd 自动导入多个 Desktop 会话，忽略其他项目正文、CLI 和子代理', () => {
  const root = mkdtempSync(resolve('.local/test/discovery-'));
  const a=join(root,'a'), b=join(root,'b'), transcripts=join(root,'sessions');
  for (const p of [a,b,transcripts]) mkdirSync(p);
  function create(id:string,cwd:string,originator='Codex Desktop',source:unknown='vscode',body?:string) {
    const rows=[{type:'session_meta',payload:{id,cwd,originator,source}},
      {type:'turn_context',payload:{turn_id:id}},
      {type:'event_msg',payload:{type:'user_message',message:`仅属于 ${id}`}},
      {type:'event_msg',payload:{type:'task_complete',last_agent_message:'确认'}}];
    writeFileSync(join(transcripts,`rollout-${id}.jsonl`),JSON.stringify(rows[0])+'\n'+(body??rows.slice(1).map(r=>JSON.stringify({...r,timestamp:'2026-09-23T01:00:00Z'})).join('\n')));
  }
  create('A1',a); create('A2',a); create('B',b,'Codex Desktop','vscode','INVALID FOREIGN BODY');
  create('CLI',a,'codex_cli_rs'); create('agent',a,'Codex Desktop',{subagent:{}});
  const found=discoverDesktopSessions(a,transcripts);
  assert.deepEqual(found.matches.map(m=>m.sessionId).sort(),['A1','A2']); assert.deepEqual(found.warnings,[]);
  const registry=new DesktopSessions(join(root,'registry'));
  assert.deepEqual(registry.discover(a,transcripts),[]);
  assert.deepEqual(Object.keys(registry.sessions).sort(),['A1','A2']);
  assert.equal(registry.sessions.A1.messages[0].text,'仅属于 A1');
  const previous=JSON.stringify(registry.sessions);
  registry.discover(a,transcripts); assert.equal(JSON.stringify(registry.sessions),previous);
  create('A3',a); registry.discover(a,transcripts); assert.equal(registry.list(a).length,3);
});
test('会话目录缺失或单个元数据损坏时提示，不阻断其余发现', () => {
  const root=mkdtempSync(resolve('.local/test/discovery-'));
  assert(discoverDesktopSessions(root,join(root,'missing')).warnings.length);
  writeFileSync(join(root,'rollout-broken.jsonl'),'BROKEN\n');
  const result=discoverDesktopSessions(root,root);
  assert.equal(result.matches.length,0); assert(result.warnings.some(x=>x.includes('1 个')));
});
