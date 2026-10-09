import { strict as assert } from 'node:assert';
import { writeFileSync } from 'node:fs';
import { createRuntime } from '../server/app-server.ts';
import { validateScope } from '../server/scope-validator.ts';
const cases = [
  { name:'删除额外同步任务', draft:'只把问候文案改为 AUTO_START_HELLO。', conversation:[{role:'user',text:'只修改备用程序问候文案，不改说明或其他实现。'}], candidate:'只把问候文案改为 AUTO_START_HELLO。同时同步备用实现和说明。', required:/AUTO_START_HELLO/, forbidden:/同时同步/ },
  { name:'保留最新确认方案及源码定位', draft:'按照刚才确定的方案实现', conversation:[{role:'user',text:'方案确定：只把 daily_hello.py 的问候文案改为 AUTO_START_HELLO，不改定时、模型、重试或文档。'}], candidate:'按刚才确定的方案，将 daily_hello.py 中的问候文案改为 AUTO_START_HELLO，不改定时、模型、重试或文档。', required:/daily_hello.py.*AUTO_START_HELLO/, unchanged:true },
  { name:'代码存在重试实现不等于要求增加重试', draft:'仅在 create_conversation 调用失败时记录错误日志。', conversation:[], candidate:'仅在 adapter.py 的 create_conversation 调用失败时记录错误日志。另外增加自动重试功能。', required:/adapter.py.*错误日志/, forbidden:/另外增加自动重试/ }
];
const runtime=await createRuntime(); const results:any[]=[];
try {
  const base=await runtime.rpc('thread/start',{cwd:runtime.cwd,ephemeral:false,sandbox:'read-only',approvalPolicy:'never'});
  try {
    await runtime.turn(base.thread.id,'这是只读范围检查测试。只回复 READY，不调用工具。');
    for (const c of cases) {
      const fork=await runtime.rpc('thread/fork',{threadId:base.thread.id,ephemeral:true,cwd:runtime.cwd,sandbox:'read-only',approvalPolicy:'never'});
      try {
        const output=await validateScope(runtime,fork.thread.id,c.draft,c.conversation,{files:{'daily_hello.py':'备用调度入口，包含失败重试逻辑。','adapter.py':'create_conversation 是调用入口。','README.md':'说明文档存在。'}},c.candidate);
        assert(c.required.test(output.optimizedPrompt)); if(c.forbidden) assert(!c.forbidden.test(output.optimizedPrompt));
        if(c.unchanged) assert.equal(output.optimizedPrompt,c.candidate); else assert(output.removedCount>0);
        results.push({name:c.name,passed:true,candidate:c.candidate,...output}); console.log(JSON.stringify(results.at(-1)));
      } finally { await runtime.rpc('thread/unsubscribe',{threadId:fork.thread.id}); }
    }
  } finally { await runtime.rpc('thread/archive',{threadId:base.thread.id}); }
  writeFileSync('.local/scope-results.json',JSON.stringify({passed:true,results},null,2));
} finally {runtime.close();}
