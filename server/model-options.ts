export type ModelOption = {
  model: string;
  displayName: string;
  defaultReasoningEffort: string;
  supportedReasoningEfforts: string[];
};
export type ModelSelection = { model: string; effort: string };

export async function listModelOptions(runtime: { rpc: (method: string, params: unknown) => Promise<any> }): Promise<ModelOption[]> {
  const data: any[] = [];
  let cursor: string | null = null;
  const seen = new Set<string>();
  do {
    const response = await runtime.rpc('model/list', cursor ? { cursor } : {});
    data.push(...(response.data || []));
    cursor = response.nextCursor || null;
    if (cursor && seen.has(cursor)) throw new Error('模型目录分页游标重复');
    if (cursor) seen.add(cursor);
  } while (cursor);
  const options = data.filter((item: any) => !item.hidden && typeof item.model === 'string')
    .map((item: any): ModelOption => ({
      model: item.model,
      displayName: item.displayName || item.model,
      defaultReasoningEffort: item.defaultReasoningEffort,
      supportedReasoningEfforts: (item.supportedReasoningEfforts || []).map((value: any) => value.reasoningEffort)
    })).filter((item: ModelOption) => item.supportedReasoningEfforts.includes(item.defaultReasoningEffort));
  if (!options.length) throw new Error('无法读取可用模型及其推理强度');
  return options;
}

export function selectModel(payload: any, options: ModelOption[]): ModelSelection {
  if (typeof payload.model !== 'string' || !payload.model || typeof payload.effort !== 'string' || !payload.effort) throw new Error('请选择模型和推理强度');
  const chosen = options.find(item => item.model === payload.model);
  if (!chosen) throw new Error('模型不在当前运行时的可用列表中');
  if (!chosen.supportedReasoningEfforts.includes(payload.effort)) throw new Error('该模型不支持所选推理强度');
  return { model: chosen.model, effort: payload.effort };
}
