import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { strict as assert } from 'node:assert';
import { projectKey, projectPath } from './project-context.ts';

type Registry = { version: 1; currentProject: string | null; threads: Record<string, { threadId: string }> };
export class Projects {
  runtime: any;
  file: string;
  registry: Registry;
  current: { path: string; threadId: string; turns: any[]; model: string; restored: boolean; warning: string } | null = null;
  constructor(runtime: any, file: string) {
    this.runtime = runtime; this.file = file;
    this.registry = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { version: 1, currentProject: null, threads: {} };
    assert(this.registry.version === 1 && this.registry.threads && typeof this.registry.threads === 'object', '项目注册文件损坏，请保留原文件并检查');
    for (const value of Object.values(this.registry.threads)) assert(typeof value?.threadId === 'string', '项目 Thread ID 损坏');
  }
  async select(input: string) {
    const path = projectPath(input);
    if (this.current && projectKey(this.current.path) === projectKey(path)) return this.current;
    const saved = this.registry.threads[projectKey(path)];
    const params = { cwd: path, sandbox: 'read-only', approvalPolicy: 'never',
      developerInstructions: '这是 Prompt Enhancer 的只读独立对话。可以讨论项目和回答用户，但不要调用工具、修改文件或实际执行项目任务。不要将这个宿主限制当成用户需求。' };
    let response: any;
    let restored = false;
    let warning = '';
    if (saved) {
      try {
        // read 不能读取尚未加载的线程。先恢复且不覆盖 cwd，再验证原项目归属。
        const { cwd: _cwd, ...resumeParams } = params;
        const resumed = await this.runtime.rpc('thread/resume', { threadId: saved.threadId, ...resumeParams });
        assert.equal(projectKey(projectPath(resumed.thread.cwd)), projectKey(path), '保存的 Thread 属于其他项目');
        response = resumed;
        restored = true;
      } catch (error) {
        // 只对确定不存在/不能恢复的 Thread 新建。网络或服务错误不丢弃已有映射。
        const message = String(error);
        if (!/not found|no rollout found|not materialized|does not exist|unable to find|属于其他项目/i.test(message)) throw error;
        warning = 'Enhancer fallback 对话无法恢复，已新建；不会影响 Desktop 历史。';
      }
    }
    if (!response) response = await this.runtime.rpc('thread/start', { ...params, ephemeral: false });
    assert.equal(projectKey(projectPath(response.thread.cwd)), projectKey(path));
    const current = { path, threadId: response.thread.id, turns: response.thread.turns || [], model: response.model, restored, warning };
    const next: Registry = { version: 1, currentProject: path, threads: { ...this.registry.threads, [projectKey(path)]: { threadId: current.threadId } } };
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(`${this.file}.tmp`, JSON.stringify(next, null, 2));
    renameSync(`${this.file}.tmp`, this.file);
    this.registry = next; this.current = current;
    return current;
  }
  async refresh() {
    if (this.current) this.current.turns = (await this.runtime.rpc('thread/read', { threadId: this.current.threadId, includeTurns: true })).thread.turns;
  }
}
