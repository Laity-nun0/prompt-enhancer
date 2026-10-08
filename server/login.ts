import { createRequire } from 'node:module';
import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
const { loginUrl } = createRequire(import.meta.url)('../scripts/startup-support.cjs');

export async function authenticateChatgpt(rpc: (method: string, params?: any) => Promise<any>, waitEvent: (method: string, matches: (p: any) => boolean, timeout?: number) => Promise<any>, state: string, open: (url: string) => void) {
  const file = join(state, 'login-url.txt');
  rmSync(file, { force: true });
  let account = await rpc('account/read', { refreshToken: false });
  if (account.account) return;
  try {
    const login = await rpc('account/login/start', { type: 'chatgpt' });
    if (login.type !== 'chatgpt' || typeof login.loginId !== 'string' || !login.loginId) throw new Error('登录响应无效');
    const url = loginUrl(login.authUrl);
    writeFileSync(file, url);
    open(url);
    const result = await waitEvent('account/login/completed', p => p.loginId === login.loginId, 15 * 60000);
    if (!result.success) throw new Error('登录失败');
    account = await rpc('account/read', { refreshToken: false });
    if (account.account?.type !== 'chatgpt') throw new Error('登录状态未确认');
  } catch { throw new Error('ChatGPT 登录失败或超时，请完成浏览器登录后重新启动。'); }
  finally { rmSync(file, { force: true }); }
}
