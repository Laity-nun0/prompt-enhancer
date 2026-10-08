// renderer 只能兑换由本次后端 IPC 交付的已校验结果，不能传任意 candidate 写剪贴板。
class ValidatedResults {
  latest;
  accept(message) {
    if (typeof message.token !== 'string' || typeof message.prompt !== 'string' || !message.prompt.trim()) return;
    this.latest = { token: message.token, prompt: message.prompt };
  }
  take(token) {
    if (typeof token !== 'string' || !this.latest || token !== this.latest.token) throw new Error('没有对应的已校验结果，未修改剪贴板');
    const prompt = this.latest.prompt; this.latest = undefined; return prompt;
  }
}
module.exports = { ValidatedResults };
