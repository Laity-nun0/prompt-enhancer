import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, symlinkSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { ProjectContext, projectKey, projectPath } from '../server/project-context.ts';
import { Projects } from '../server/projects.ts';

mkdirSync('.local/test', { recursive: true });
const root = mkdtempSync(resolve('.local/test/project-'));
const a = join(root, 'a'), b = join(root, 'b');
mkdirSync(a); mkdirSync(b); mkdirSync(join(a, 'src'));
writeFileSync(join(a, 'README.md'), '工程 A');
writeFileSync(join(a, 'src/main.ts'), 'export const value = 1;');
writeFileSync(join(a, 'src/AGENTS.md'), '保留现有函数名。');
writeFileSync(join(a, '.env'), 'secret');
writeFileSync(join(a, 'binary.dat'), Buffer.from([0,1,2]));
writeFileSync(join(a, 'big.txt'), 'a'.repeat(40000));

test('根目录初始读取不递归；按需源码读取会补充局部 AGENTS', () => {
  const context = new ProjectContext(a); context.initial();
  assert.deepEqual(Object.keys(context.files), ['README.md']);
  context.read('src/main.ts'); assert(context.files['src/AGENTS.md']);
  assert(!context.directories.src);
  context.assertUnchanged();
});
test('拒绝越界、绝对路径、凭据、二进制与目录联接', () => {
  const context = new ProjectContext(a);
  for (const path of ['../b/README.md', resolve(a, 'README.md'), '.env', 'binary.dat']) assert.throws(() => context.read(path));
  symlinkSync(b, join(a, 'outside'), 'junction');
  assert.throws(() => context.list('outside'));
});
test('大文件截断并报告，文件变化可检测', () => {
  const context = new ProjectContext(a); context.read('big.txt');
  assert.equal(Buffer.byteLength(context.files['big.txt']), 24576); assert(context.warnings.length);
  writeFileSync(join(a, 'big.txt'), 'changed'); assert.throws(() => context.assertUnchanged());
});
test('项目路径规范化和无效目录校验', () => {
  assert.equal(projectPath(a), projectPath(join(a, '.')));
  assert.throws(() => projectPath('relative')); assert.throws(() => projectPath(join(a, 'README.md')));
});
test('按项目保存 ID、恢复原线程，不复制聊天历史', async () => {
  let counter = 0; const threads = new Map<string, any>(); const calls: string[] = [];
  const runtime = { rpc: async (method: string, params: any) => {
    calls.push(method);
    if (method === 'thread/start') { const thread = { id: `thread-${++counter}`, cwd: params.cwd, turns: [] }; threads.set(thread.id, thread); return { thread, model: 'test' }; }
    const thread = threads.get(params.threadId); if (!thread) throw new Error('thread not found');
    return { thread, model: 'test' };
  } };
  const file = join(root, 'projects.json');
  let projects = new Projects(runtime, file);
  const first = await projects.select(a); first.turns.push({ id: 'existing-turn', status: 'completed' });
  const second = await projects.select(b); assert.notEqual(first.threadId, second.threadId); assert.equal(second.turns.length,0);
  projects = new Projects(runtime,file);
  const restored = await projects.select(a); assert.equal(restored.threadId,first.threadId); assert(restored.restored); assert.equal(restored.turns.length,1);
  assert(calls.includes('thread/resume'));
  assert(!readFileSync(file,'utf8').includes('existing-turn'));
  threads.delete(first.threadId); projects = new Projects(runtime,file);
  const replaced = await projects.select(a); assert.notEqual(replaced.threadId,first.threadId); assert(replaced.warning);
  const saved = readFileSync(file,'utf8');
  const broken = new Projects({ rpc: async () => { throw new Error('connection timeout'); } },file);
  await assert.rejects(() => broken.select(a)); assert.equal(readFileSync(file,'utf8'),saved);
  assert.equal(JSON.parse(saved).threads[projectKey(a)].threadId,replaced.threadId);
});

test('私密目录不可列出或读取，嵌套与 Windows 路径同样阻止', () => {
  const project = join(root, 'private-boundaries');
  mkdirSync(join(project, '.local', 'github-auth'), { recursive: true });
  mkdirSync(join(project, 'src', '.local'), { recursive: true });
  writeFileSync(join(project, '.local', 'github-auth', 'hosts.yml'), 'synthetic credential');
  writeFileSync(join(project, 'src', '.local', 'notes.txt'), 'synthetic private note');
  writeFileSync(join(project, 'src', 'main.ts'), 'export const value = 1;');
  for (const name of ['.aws', '.ssh', '.azure', '.kube', '.docker']) {
    mkdirSync(join(project, name));
    writeFileSync(join(project, name, 'config'), 'synthetic credential');
  }
  for (const name of ['.npmrc', '.netrc', '_netrc', '.pypirc', 'id_rsa', 'id_ed25519', 'hosts.yml']) writeFileSync(join(project, name), 'synthetic credential');
  const context = new ProjectContext(project);
  context.initial();
  assert.deepEqual(context.directories['.'], ['src/']);
  context.list('src');
  assert.deepEqual(context.directories.src, ['main.ts']);
  for (const name of ['.local', '.local/github-auth', 'src/.local', '.aws', '.ssh', '.azure', '.kube', '.docker']) assert.throws(() => context.list(name), /路径不可读取/);
  for (const name of ['.local/github-auth/hosts.yml', '.local\\github-auth\\hosts.yml', 'src/.local/notes.txt', '.LOCAL/github-auth/hosts.yml', '.aws/config', '.ssh/config', '.azure/config', '.kube/config', '.docker/config', '.npmrc', '.netrc', '_netrc', '.pypirc', 'id_rsa', 'id_ed25519', 'hosts.yml']) assert.throws(() => context.read(name), /路径不可读取/);
  context.read('src/main.ts');
  assert.deepEqual(Object.keys(context.files), ['src/main.ts']);
  context.assertUnchanged();
});

test('重启后未加载的线程先 resume；不覆盖 cwd，不误用其他项目', async () => {
  const file = join(root, 'unloaded.json');
  const saved = { version: 1, currentProject: a, threads: { [projectKey(a)]: { threadId: 'saved' } } };
  writeFileSync(file, JSON.stringify(saved));
  const calls: string[] = [];
  let originalCwd = a;
  const runtime = { rpc: async (method: string, params: any) => {
    calls.push(method);
    if (method === 'thread/read') throw new Error('thread not loaded: saved');
    if (method === 'thread/resume') {
      assert(!Object.hasOwn(params, 'cwd'), '不能用目标项目覆盖原 cwd');
      return { thread: { id: 'saved', cwd: originalCwd, turns: [{ id: 'old-turn' }] }, model: 'test' };
    }
    return { thread: { id: 'new', cwd: params.cwd, turns: [] }, model: 'test' };
  } };
  const restored = await new Projects(runtime, file).select(a);
  assert.equal(restored.threadId, 'saved'); assert(restored.restored);
  assert.deepEqual(calls, ['thread/resume']);
  originalCwd = b;
  const replaced = await new Projects(runtime, file).select(a);
  assert.equal(replaced.threadId, 'new'); assert(replaced.warning);
  assert.equal(replaced.turns.length, 0);
});

test('未物化的旧 Thread 无 rollout 时新建；临时错误不覆盖映射', async () => {
  const file = join(root, 'empty-thread.json');
  writeFileSync(file, JSON.stringify({ version: 1, currentProject: a, threads: { [projectKey(a)]: { threadId: 'empty' } } }));
  const runtime = { rpc: async (method: string, params: any) => {
    if (method === 'thread/resume') throw new Error('no rollout found for thread id empty');
    assert.equal(method, 'thread/start');
    return { thread: { id: 'replacement', cwd: params.cwd, turns: [] }, model: 'test' };
  } };
  const selected = await new Projects(runtime, file).select(a);
  assert.equal(selected.threadId, 'replacement'); assert(selected.warning);
});
