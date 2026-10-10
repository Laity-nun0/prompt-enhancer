import { useEffect, useRef, useState } from 'react';
import { Sparkles, Folder, MessageCircle, RefreshCw, ChevronRight, Info, Settings2, Check } from 'lucide-react';
import { clipboardDecision } from './companion.ts';
import type { Optimized } from '../server/optimizer.ts';
import type { DesktopSession } from '../server/desktop-sessions.ts';
import { MAX_DESKTOP_CONTEXTS } from './context-limits.ts';

type Turn = { id: string; status: string; items: { id: string; type: string; text?: string; content?: { type: string; text?: string }[] }[] };
type DisplayResult = Optimized & { conversationSource?: { sessionId?: string; sessionIds?: string[] } };
type ModelOption = { model: string; displayName: string; defaultReasoningEffort: string; supportedReasoningEfforts: string[] };
const effortNames: Record<string, string> = { none: '无', minimal: '极低', low: '低', medium: '中', high: '高', xhigh: '极高', max: '最高', ultra: '超高' };
const displayModelName = (name: string) => name.replace(/^(GPT-[\d.]+)-/, '$1 ');
export function App() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [original, setOriginal] = useState<string | null>(null);
  const [result, setResult] = useState<DisplayResult | null>(null);
  const [project, setProject] = useState<string | null>(null);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<DesktopSession[]>([]);
  const [desktopId, setDesktopId] = useState('');
  const [multi, setMulti] = useState(false);
  const [desktopIds, setDesktopIds] = useState<string[]>([]);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [model, setModel] = useState('');
  const [effort, setEffort] = useState('');
  const [modelOpen, setModelOpen] = useState(false);
  const [modelListOpen, setModelListOpen] = useState(false);
  const modelPicker = useRef<HTMLDivElement>(null);
  const modelInfo = models.find(item => item.model === model);
  const supportedEfforts = modelInfo?.supportedReasoningEfforts || [];
  const effortIndex = Math.max(0, supportedEfforts.indexOf(effort));
  const effortRatio = supportedEfforts.length > 1 ? effortIndex / (supportedEfforts.length - 1) : 0;
  const effortFill = `calc(${effortRatio * 100}% + ${15 - effortRatio * 30}px)`;
  const selected = sessions.find(s => s.sessionId === desktopId);
  const selectedSessions = sessions.filter(s => desktopIds.includes(s.sessionId));
  function loadSessions(data: any) { setSessions(data.desktopSessions || []); setDesktopId(data.desktopSessions?.[0]?.sessionId || ''); setMulti(false); setDesktopIds([]); }
  function contextChanged() {
    if (original !== null) setDraft(original);
    setClipboardDraft(null); setError(''); setResult(null); setOriginal(null);
    setNotice(original === null ? '上下文已变更；当前编辑文字已保留，若含旧上下文信息，请检查后重新增强。' : '已切换上下文；增强结果不会沿用上一对话。');
  }
  function modelChanged() {
    if (original !== null) setDraft(original);
    setResult(null); setOriginal(null); setError('');
    setNotice('模型或推理强度已切换；请检查草稿后重新增强。');
  }
  function chooseModel(next: ModelOption) {
    if (next.model !== model) {
      modelChanged(); setModel(next.model);
      setEffort(next.defaultReasoningEffort);
    }
    setModelListOpen(false);
  }
  function chooseEffort(next: string) {
    if (next === effort) return;
    modelChanged(); setEffort(next);
  }
  useEffect(() => {
    if (!modelOpen) return;
    function onPointerDown(event: PointerEvent) {
      if (!modelPicker.current?.contains(event.target as Node)) { setModelOpen(false); setModelListOpen(false); }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        if (modelListOpen) { setModelListOpen(false); modelPicker.current?.querySelector<HTMLButtonElement>('.model-select-trigger')?.focus(); }
        else { setModelOpen(false); modelPicker.current?.querySelector<HTMLButtonElement>('.model-button')?.focus(); }
      }
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('pointerdown', onPointerDown); document.removeEventListener('keydown', onKeyDown); };
  }, [modelOpen, modelListOpen]);
  const [choosing, setChoosing] = useState(false);
  const [projectInput, setProjectInput] = useState('');
  const [pickingFolder, setPickingFolder] = useState(false);
  const [busy, setBusy] = useState<'init' | 'enhance' | 'send' | 'project' | 'sync' | null>('init');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [clipboardDraft, setClipboardDraft] = useState<string | null>(null);
  const [companionWarning, setCompanionWarning] = useState('');
  const [shortcut, setShortcut] = useState('Ctrl+Alt+E');
  const latest = useRef({ draft, busy });
  latest.current = { draft, busy };
  function loadClipboard(text: string) {
    latest.current.draft = text;
    setDraft(text); setOriginal(null); setResult(null); setClipboardDraft(null);
    setNotice('已载入剪贴板草稿；请确认项目和上下文对话后点击增强。');
  }
  useEffect(() => {
    const bridge = window.companion;
    if (!bridge) return;
    let active = true;
    function receive(text: string) {
      if (!active) return;
      const decision = clipboardDecision(latest.current.draft, text, !!latest.current.busy);
      if (decision === 'load') loadClipboard(text);
      else if (decision === 'confirm') setClipboardDraft(text);
      else if (decision === 'too-long') setCompanionWarning('剪贴板超过 12000 字符，未载入；请缩短后重新复制。');
    }
    const unsubscribe = bridge.onDraft(receive);
    bridge.ready().then(data => {
      if (!active) return;
      setCompanionWarning(data.shortcutWarning);
      setShortcut(data.shortcut);
      if (data.text !== undefined) receive(data.text);
    }).catch(e => { if (active) setCompanionWarning(String(e)); });
    return () => { active = false; unsubscribe(); };
  }, []);
  useEffect(() => {
    fetch('/api/state').then(async response => { if (!response.ok) throw new Error('无法读取对话'); const data = await response.json(); loadSessions(data); setModels(data.models || []); setTurns(data.turns); setProject(data.project); setThreadId(data.threadId); setNotice(data.warning || (data.restored ? '已恢复此项目的原有对话。' : '')); })
      .catch(e => setError(String(e))).finally(() => setBusy(null));
  }, []);
  async function browseProjectFolder() {
    if (busy || pickingFolder || !window.companion) return;
    setPickingFolder(true); setError('');
    try {
      const path = await window.companion.chooseProjectFolder();
      if (path !== null) setProjectInput(path);
    } catch { setError('无法打开文件夹选择器，请重试或手动输入路径。'); }
    finally { setPickingFolder(false); }
  }
  async function selectProject() {
    if (busy || pickingFolder || !projectInput.trim()) return;
    if (draft && !window.confirm('切换项目后将清空当前草稿，是否继续？')) return;
    setBusy('project'); setError('');
    try {
      const response = await fetch('/api/project/select', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: projectInput }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '选择项目失败');
      setProject(data.project); setThreadId(data.threadId); setTurns(data.turns);
      loadSessions(data);
      setDraft(''); setOriginal(null); setResult(null); setChoosing(false); setClipboardDraft(null);
      setNotice(data.warning || (data.restored ? '已恢复此项目的原有对话。' : '已为此项目创建独立对话。'));
    } catch (e) { setError(String(e)); } finally { setBusy(null); }
  }
  async function syncSelected() {
    const response = await fetch('/api/desktop/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(multi ? { threadId, contextMode: 'multi', desktopSessionIds: desktopIds } : { threadId, desktopSessionId: desktopId }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '同步失败');
    const updated: DesktopSession[] = data.desktopSessions || [data.desktopSession];
    setSessions(items => items.map(s => updated.find(fresh => fresh.sessionId === s.sessionId) || s));
  }
  async function act(action: 'enhance' | 'send') {
    if (busy || !draft.trim()) return;
    setBusy(action); setError(''); setNotice('');
    if (action === 'enhance') { setOriginal(draft); setResult(null); }
    try {
      // 先在界面显示同步结果；服务端 Enhance 仍独立刷新，以覆盖直接 API 调用。
      if (action === 'enhance' && (multi || desktopId)) await syncSelected();
      const context = multi ? { draft, threadId, contextMode: 'multi', desktopSessionIds: desktopIds } : { draft, threadId, desktopSessionId: desktopId || null };
      const response = await fetch(`/api/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(action === 'enhance' ? { ...context, model, effort } : context) });
      const data = await response.json();
      if (data.turns) setTurns(data.turns);
      if (data.desktopSession) setSessions(items => items.map(s => s.sessionId === data.desktopSession.sessionId ? data.desktopSession : s));
      if (data.desktopSessions) setSessions(items => items.map(s => data.desktopSessions.find((fresh: DesktopSession) => fresh.sessionId === s.sessionId) || s));
      if (!response.ok) throw new Error(data.error || '请求失败');
      if (action === 'enhance') {
        setDraft(data.optimizedPrompt); setResult(data);
        if (window.companion) {
          try {
            await window.companion.copyResult(data.copyToken);
            setNotice('✓ 优化完成，已复制到剪贴板。可以返回 Codex Desktop 粘贴；尚未发送。');
          } catch (e) { setNotice('优化完成，但未复制到剪贴板。请手动复制下方结果。'); setError(String(e)); }
        } else setNotice('已增强，可继续编辑或复制使用；尚未发送。');
      } else { setDraft(''); setOriginal(null); setResult(null); setNotice('已发送到主线程。'); }
    } catch (e) { setError(String(e)); } finally { setBusy(null); }
  }
  const count = multi ? selectedSessions.reduce((n, s) => n + new Set(s.messages.map(m => m.turnId)).size, 0) : selected ? new Set(selected.messages.map(m => m.turnId)).size : turns.length;
  const hasContext = multi ? desktopIds.length > 0 && selectedSessions.length === desktopIds.length && selectedSessions.every(s => s.messages.length) : desktopId ? !!selected?.messages.length : !!turns.length;
  const sourceIds = result?.conversationSource?.sessionIds || (result?.conversationSource?.sessionId ? [result.conversationSource.sessionId] : []);
  return <main>
    <header className="app-header"><h1><Sparkles className="brand-icon" aria-hidden="true" />Prompt <span>Enhancer</span></h1><span className="header-caption"><MessageCircle size={18} aria-hidden="true" />上下文感知</span></header>
    <div className="workspace">
    {companionWarning && <p role="alert" className="error">{companionWarning}</p>}
    <div className="sources">
      <section aria-label="项目选择">
        <label>当前项目</label>
        <div className="field-row"><div className="project-field" title={project || '未选择项目'}><Folder size={19} aria-hidden="true" /><span data-testid="current-project">{project || '未选择项目'}</span></div><button aria-label="选择项目" disabled={!!busy} onClick={() => { setProjectInput(project || ''); setChoosing(!choosing); }}>切换</button></div>
      </section>
      <section aria-label="上下文选择">
        <label htmlFor={multi ? 'multi-toggle' : 'desktop-session'}>上下文对话</label>
        <div className="context-mode"><label htmlFor="multi-toggle"><input id="multi-toggle" type="checkbox" checked={multi} disabled={!!busy || !project} onChange={e => { contextChanged(); setMulti(e.target.checked); setDesktopIds(e.target.checked && desktopId ? [desktopId] : []); }} />多对话上下文</label>{multi && <span>已选 {desktopIds.length} / {MAX_DESKTOP_CONTEXTS} 个</span>}</div>
        {!multi ? <div className="field-row"><select id="desktop-session" title={selected?.title || 'Enhancer 独立对话'} disabled={!!busy || !project} value={desktopId} onChange={e => {
          contextChanged(); setDesktopId(e.target.value);
        }}>
          {sessions.map(s => <option key={s.sessionId} value={s.sessionId} title={`${s.title} · ${new Date(s.lastActiveAt).toLocaleString()}`}>{s.title}{sessions.filter(other => other.title === s.title).length > 1 ? ` · …${s.sessionId.slice(-8)}` : ''}</option>)}
          <option value="">Enhancer 独立对话</option>
        </select><button className="icon-button" aria-label="刷新上下文" title="刷新上下文" disabled={!!busy || !desktopId} onClick={async () => {
          setBusy('sync'); setError('');
          try { await syncSelected(); setResult(null); setNotice('已同步所选对话。'); }
          catch (e) { setError(String(e)); } finally { setBusy(null); }
        }}><RefreshCw size={20} className={busy === 'sync' ? 'spinning' : ''} aria-hidden="true" /></button></div> : <><div className="multi-list" role="group" aria-label="选择 Desktop 对话">{sessions.map(s => <label key={s.sessionId} className="multi-item" title={s.title}><input type="checkbox" checked={desktopIds.includes(s.sessionId)} disabled={!!busy || (!desktopIds.includes(s.sessionId) && desktopIds.length >= MAX_DESKTOP_CONTEXTS)} onChange={e => { contextChanged(); setDesktopIds(ids => e.target.checked ? [...ids, s.sessionId] : ids.filter(id => id !== s.sessionId)); }} /><span className="multi-title">{s.title} <small>…{s.sessionId.slice(-8)} · {new Date(s.lastActiveAt).toLocaleString()}</small></span></label>)}</div><button className="refresh-multi" disabled={!!busy || !desktopIds.length} onClick={async () => { setBusy('sync'); setError(''); try { await syncSelected(); setResult(null); setNotice('已同步所选对话。'); } catch (e) { setError(String(e)); } finally { setBusy(null); } }}><RefreshCw size={16} aria-hidden="true" />刷新所选</button></>}
      </section>
    </div>
    {choosing && <form className="project-form" onSubmit={e => { e.preventDefault(); void selectProject(); }}>
      <label htmlFor="project-path">本地项目目录（可选择文件夹或手动输入）</label>
      <input autoFocus id="project-path" value={projectInput} onChange={e => setProjectInput(e.target.value)} disabled={!!busy || pickingFolder} placeholder="D:\项目目录" />
      <div className="actions">{window.companion && <button type="button" disabled={!!busy || pickingFolder} onClick={() => void browseProjectFolder()}><Folder size={16} aria-hidden="true" />{pickingFolder ? '正在选择…' : '选择文件夹'}</button>}<button type="submit" disabled={!!busy || pickingFolder || !projectInput.trim()}>打开项目</button><button type="button" disabled={!!busy || pickingFolder} onClick={() => setChoosing(false)}>取消</button></div>
    </form>}
    <section className="composer" aria-label="提问编辑器">
      {clipboardDraft !== null && <div role="alert" className="clipboard-conflict">
        <p>收到新的剪贴板文本，当前草稿已保留。{busy ? '操作完成后可选择是否替换。' : '是否替换当前草稿？'}</p>
        <pre style={{ whiteSpace: 'pre-wrap', maxHeight: 160, overflow: 'auto' }}>{clipboardDraft}</pre>
        <button disabled={!!busy} onClick={() => loadClipboard(clipboardDraft)}>替换当前草稿</button>
        <button onClick={() => setClipboardDraft(null)}>保留当前草稿</button>
      </div>}
      <div className="editor-heading"><label htmlFor="draft">你的提问</label><div className="model-heading"><div className="model-picker" ref={modelPicker}>
        <button type="button" className="model-button" aria-label={modelInfo ? `增强模型 ${displayModelName(modelInfo.displayName)}，推理强度 ${effortNames[effort] || effort}` : '选择增强模型'} aria-expanded={modelOpen} aria-controls="model-panel" disabled={!!busy || !models.length} onClick={() => { setModelOpen(!modelOpen); setModelListOpen(false); }}><Settings2 size={16} aria-hidden="true" /><span>{modelInfo ? `${displayModelName(modelInfo.displayName)} · ${effortNames[effort] || effort}` : '选择模型'}</span><ChevronRight size={14} className={modelOpen ? 'model-chevron open' : 'model-chevron'} aria-hidden="true" /></button>
        {modelOpen && <div id="model-panel" className="model-panel" role="group" aria-label="增强模型和推理强度">
          <div className="model-panel-top"><button type="button" className="model-select-trigger" aria-label={modelInfo ? `选择模型，当前为 ${displayModelName(modelInfo.displayName)}` : '选择模型'} aria-haspopup="menu" aria-expanded={modelListOpen} aria-controls="model-menu" disabled={!!busy} onClick={() => setModelListOpen(!modelListOpen)}><span className="model-trigger-icons"><Sparkles size={13} aria-hidden="true" /><ChevronRight size={13} aria-hidden="true" /></span><span>{displayModelName(modelInfo?.displayName || '选择模型')}</span></button></div>
          <div className="effort-meter" style={{ background: `linear-gradient(to right, #3a83f7 0, #3a83f7 ${effortFill}, #434347 ${effortFill}, #434347 100%)` }}><div className="effort-marks" aria-hidden="true">{supportedEfforts.map((value, index) => <span key={value} style={{ background: index < effortIndex ? '#9cc8ff' : '#85858d' }} />)}</div><input id="enhance-effort" className="effort-slider" type="range" min="0" max={Math.max(0, supportedEfforts.length - 1)} step="1" value={effortIndex} aria-label="推理强度" aria-valuetext={effortNames[effort] || effort} title={`推理强度：${effortNames[effort] || effort}`} disabled={!!busy || supportedEfforts.length < 2} onChange={e => chooseEffort(supportedEfforts[Number(e.target.value)])} /></div>
          {modelListOpen && <div id="model-menu" className="model-menu" role="group" aria-label="选择模型"><div className="model-menu-heading">选择模型</div>{models.map(item => <button type="button" key={item.model} className="model-menu-item" aria-current={item.model === model ? 'true' : undefined} disabled={!!busy} onClick={() => chooseModel(item)}><span>{displayModelName(item.displayName)}</span>{item.model === model && <Check size={17} aria-hidden="true" />}</button>)}</div>}
        </div>}
      </div><span className="muted">{draft.length.toLocaleString()} / 12000</span></div></div>
      <div className="editor-surface" aria-busy={busy === 'enhance'}>
      <textarea id="draft" maxLength={12000} rows={10} value={draft} disabled={!!busy || !project} placeholder="例如：再给这个项目加一个任务系统" onKeyDown={e => {
        if (e.ctrlKey && e.key === 'Enter' && !e.nativeEvent.isComposing && !e.repeat) {
          e.preventDefault();
          if (hasContext && modelInfo && effort) void act('enhance');
        }
      }} onChange={e => { setDraft(e.target.value); setOriginal(null); setResult(null); setNotice(''); setError(''); }} />
      <div className="editor-toolbar"><span className="editor-hint"><Info size={16} aria-hidden="true" />增强不会自动发送</span><div className="editor-actions">
        {original !== null && <button className="text-button" onClick={() => { setDraft(original); setOriginal(null); setResult(null); setNotice('已恢复原文，尚未发送。'); }} disabled={!!busy}>恢复原文</button>}
        <kbd>Ctrl + Enter</kbd><button className="enhance" onClick={() => void act('enhance')} disabled={!!busy || !project || !draft.trim() || !hasContext || !modelInfo || !effort}><Sparkles size={19} aria-hidden="true" />{busy === 'enhance' ? '正在增强…' : '增强提问'}</button>
        {!multi && !desktopId && <button onClick={() => void act('send')} disabled={!!busy || !project || !draft.trim()}>{busy === 'send' ? '正在发送…' : '发送'}</button>}
      </div></div></div>
      <p className="status" role="status">{busy === 'init' ? '正在读取对话…' : !project ? '请选择项目后开始编辑。' : !hasContext ? (multi ? desktopIds.length ? '所选对话暂无可用内容，请刷新或调整选择。' : '请至少选择一个 Desktop 对话。' : desktopId ? '此对话暂无内容，请刷新或选择其他对话。' : '先发送一条消息建立上下文，即可增强后续提问。') : notice}</p>
      {error && <p className="error" role="alert">{error}</p>}
    </section>
    <details className="conversation">
      <summary><ChevronRight size={18} /><span>查看上下文</span><span className="muted" data-testid="turn-count">{count} 轮</span><span className="readonly">只读预览</span></summary>
      <div className="messages">
        {multi && !desktopIds.length && <p className="empty">请先选择 Desktop 对话。</p>}
        {!multi && selected && !selected.messages.length && <p className="empty">此对话暂无可用内容，请刷新或选择其他对话。</p>}
        {multi ? selectedSessions.map(s => <article key={s.sessionId}><h3>{s.title} · …{s.sessionId.slice(-8)}</h3>{s.messages.map((m, i) => <div className="message" key={i}><strong>{m.role === 'user' ? '你' : 'Codex'}</strong><p>{m.text}</p></div>)}</article>) : selected ? selected.messages.map((m, i) => <div className="message" key={i}><strong>{m.role === 'user' ? '你' : 'Codex'}</strong><p>{m.text}</p></div>) : <>
          {!turns.length && <p className="empty">先发送一条消息，建立对话上下文后即可增强提问。</p>}
          {turns.map(turn => <article key={turn.id} data-testid="turn">{turn.items.filter(item => ['userMessage', 'agentMessage'].includes(item.type)).map(item => <div className={`message ${item.type}`} key={item.id}><strong>{item.type === 'userMessage' ? '你' : 'Codex'}</strong><p>{item.type === 'userMessage' ? item.content?.filter(c => c.type === 'text').map(c => c.text).join('\n') : item.text}</p></div>)}{turn.status !== 'completed' && <small>状态：{turn.status}</small>}</article>)}
        </>}
      </div>
    </details>
    <details className="more-options"><summary>更多选项</summary><div className="more-content">
      <button disabled={!!busy || !project} onClick={async () => {
        const path = window.prompt('输入当前项目已有 Desktop 对话的 transcript 绝对路径：');
        if (!path) return;
        setBusy('project'); setError('');
        try {
          const response = await fetch('/api/desktop/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path, threadId }) });
          const data = await response.json(); if (!response.ok) throw new Error(data.error);
          setSessions(data.desktopSessions); setNotice('历史已导入；请选择要使用的对话。');
        } catch (e) { setError(String(e)); } finally { setBusy(null); }
      }}>导入已有会话</button>
      {selected && <p data-testid="sync-status">{selected.lastSyncedAt ? `最后同步：${new Date(selected.lastSyncedAt).toLocaleTimeString()}` : '增强前会自动同步最新对话。'}</p>}
      {window.companion && <p>{shortcut} 唤起并载入剪贴板 · 关闭窗口后驻留托盘</p>}
    </div></details>
    {result && <details className="result-details" open={result.warnings.length > 0}><summary>优化依据{result.warnings.length > 0 ? ` · ${result.warnings.length} 条提醒` : ''}</summary><div className="details">{([['本次选中的来源', sourceIds.map(id => { const source = sessions.find(s => s.sessionId === id); return `${source?.title || 'Desktop 对话'} · …${id.slice(-8)}`; })], ['实际用于改写的依据', result.contextUsed], ['补充假设', result.assumptions], ['注意事项', result.warnings]] as const).map(([title, items]) => <div key={title}><h3>{title}</h3>{items.length ? <ul>{items.map((text, i) => <li key={i}>{text}</li>)}</ul> : <p>无</p>}</div>)}</div></details>}
    </div>
  </main>;
}
