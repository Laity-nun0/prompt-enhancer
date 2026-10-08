export type Companion = {
  onDraft: (callback: (text: string) => void) => () => void;
  ready: () => Promise<{ text?: string; shortcutWarning: string; shortcut: string }>;
  copyResult: (token: string) => Promise<void>;
};
declare global { interface Window { companion?: Companion } }

export function clipboardDecision(draft: string, text: string, busy: boolean) {
  if (!text.trim()) return 'empty';
  if (text.length > 12000) return 'too-long';
  if (text === draft) return 'same';
  if (busy || draft.length) return 'confirm';
  return 'load';
}
