import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { DesktopSessions } from '../server/desktop-sessions.ts';
import { applyScopeRemovals } from '../server/scope-validator.ts';
mkdirSync('.local/test', {recursive:true});
const cwd = process.cwd();
function history(id: string, count: number) {
  const rows: any[] = [{ type: 'session_meta', payload: { id, cwd, originator: 'Codex Desktop' } }];
  for (let i=0; i<count; i++) rows.push(
    {type:'turn_context',payload:{turn_id:`${id}-${i}`}},
    {type:'event_msg',payload:{type:'user_message',message:`${id} 方案 ${i}`}},
    {type:'event_msg',payload:{type:'task_complete',last_agent_message:`确认 ${id}-${i}`}});
  return rows.map(r=>JSON.stringify({...r,timestamp:'2026-09-23T01:00:00Z'})).join('\n');
}
test('无 Hook：已导入 A 从 4 到 7 Turns，按需同步最新消息且不读取 B/C', () => {
  const root=mkdtempSync(resolve('.local/test/refresh-')); const registry=new DesktopSessions(root);
  for (const id of ['A','B','C']) { writeFileSync(join(root,id+'.jsonl'),history(id,4)); registry.import(join(root,id+'.jsonl')); }
  const otherBefore=JSON.stringify([registry.sessions.B,registry.sessions.C]);
  unlinkSync(join(root,'B.jsonl')); unlinkSync(join(root,'C.jsonl'));
  const file=join(root,'A.jsonl'); writeFileSync(file,history('A',7)); const bytes=readFileSync(file);
  const fresh=registry.refresh(cwd,'A');
  assert.equal(new Set(fresh.messages.map(m=>m.turnId)).size,7); assert(fresh.messages.some(m=>m.text==='A 方案 6'));
  assert(fresh.lastSyncedAt && fresh.transcriptHash); assert.equal(fresh.hookEvents,undefined);
  assert.equal(JSON.stringify([registry.sessions.B,registry.sessions.C]),otherBefore); assert(bytes.equals(readFileSync(file)));
  assert.deepEqual(new DesktopSessions(root).sessions.A,fresh);
});
test('同步失败不覆盖旧记录；拒绝 session/cwd 错配和损坏文件', () => {
  const root=mkdtempSync(resolve('.local/test/refresh-')); const file=join(root,'A.jsonl'); const registry=new DesktopSessions(root);
  writeFileSync(file,history('A',4)); registry.import(file); const old=structuredClone(registry.sessions.A);
  for (const content of [history('B',7),history('A',7)+'\nBROKEN']) {
    writeFileSync(file,content); assert.throws(()=>registry.refresh(cwd,'A')); assert.deepEqual(registry.sessions.A,old);
  }
  assert.throws(()=>registry.refresh(resolve('.poc'),'A'));
});
test('范围检查只能精确删除，不能改写、插入、含糊匹配或删除整个候选', () => {
  const candidate='仅修改问候文案。同时同步备用实现和说明。';
  const clean=applyScopeRemovals(candidate,{removals:[{text:'同时同步备用实现和说明。',reason:'未要求同步其他文件'}]});
  assert.equal(clean.optimizedPrompt,'仅修改问候文案。'); assert.equal(clean.removedCount,1); assert(clean.warnings[0].includes('同步备用'));
  assert.equal(applyScopeRemovals(candidate,{removals:[]}).optimizedPrompt,candidate);
  for (const text of ['不存在',candidate]) assert.throws(()=>applyScopeRemovals(candidate,{removals:[{text,reason:'test'}]}));
  assert.throws(()=>applyScopeRemovals('重复重复',{removals:[{text:'重复',reason:'test'}]}));
});
