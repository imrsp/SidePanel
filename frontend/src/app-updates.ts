import { LitElement, html, css, nothing } from 'lit';

interface UpdateResult {
  status: 'available' | 'current' | 'unpublished' | 'unconfigured' | 'error';
  currentVersion: string;
  latestVersion?: string;
  message: string;
  releaseUrl?: string;
  checkedAt?: string;
}

class AppUpdates extends LitElement {
  static properties = { version: { state: true }, checking: { state: true }, result: { state: true }, loadError: { state: true } };
  private version = '';
  private checking = false;
  private result?: UpdateResult;
  private loadError = false;
  private lifetime = new AbortController();

  connectedCallback() {
    super.connectedCallback();
    this.lifetime = new AbortController();
    void this.loadVersion();
  }
  disconnectedCallback() { super.disconnectedCallback(); this.lifetime.abort(); }

  private async loadVersion() {
    try {
      const response = await fetch('/api/v1/app', { signal: AbortSignal.any([this.lifetime.signal, AbortSignal.timeout(10000)]) });
      if (!response.ok) throw new Error();
      const info = await response.json();
      if (typeof info.version !== 'string' || !info.version) throw new Error();
      this.version = info.version;
      this.loadError = false;
    } catch { if (!this.lifetime.signal.aborted) this.loadError = true; }
  }

  private async checkUpdates() {
    if (this.checking) return;
    this.checking = true;
    this.result = undefined;
    try {
      const response = await fetch('/api/v1/updates/check', { method: 'POST', signal: AbortSignal.any([this.lifetime.signal, AbortSignal.timeout(15000)]) });
      if (!response.ok) throw new Error();
      const result = await response.json() as UpdateResult;
      if (!result.currentVersion || !result.message || !['available', 'current', 'unpublished', 'unconfigured', 'error'].includes(result.status)) throw new Error();
      this.result = result;
      this.version = result.currentVersion;
      this.loadError = false;
    } catch {
      if (!this.lifetime.signal.aborted) this.result = { status: 'error', currentVersion: this.version, message: '检查更新失败，请检查本地服务和网络后重试。' };
    } finally { this.checking = false; }
  }

  private get releaseUrl() {
    if (this.result?.status !== 'available' || !this.result.releaseUrl) return undefined;
    try {
      const url = new URL(this.result.releaseUrl);
      return url.origin === 'https://github.com' && url.pathname.startsWith('/imrsp/SidePanel/releases/') && !url.username && !url.password ? url.href : undefined;
    } catch { return undefined; }
  }

  static styles = css`
    :host{display:block;margin-top:24px;font:inherit;color:var(--text)}
    *{box-sizing:border-box}.panel{border:1px solid var(--line);background:var(--surface);padding:18px}
    h3{font:inherit;font-weight:700;color:var(--accent);margin:0 0 16px}
    .row{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px}
    .version{color:var(--accent);font-weight:700;margin-left:12px;white-space:nowrap}
    button,a{font:inherit}button{cursor:pointer;color:var(--accent);background:var(--bg);border:1px solid var(--line);padding:9px 14px}
    button:hover:not(:disabled){border-color:var(--accent)}button:disabled{opacity:.6;cursor:wait}
    button:focus-visible,a:focus-visible{outline:2px solid var(--warn);outline-offset:3px}
    p{margin:14px 0 0;overflow-wrap:anywhere}.hint{color:var(--muted);font-size:.87em;line-height:1.6}
    .message{line-height:1.6}.error{color:var(--warn)}a{display:inline-block;color:var(--accent);margin-top:12px;text-underline-offset:3px}
  `;

  render() {
    const releaseUrl = this.releaseUrl;
    return html`<section class="panel" aria-labelledby="update-title">
      <h3 id="update-title">版本与更新</h3>
      <div class="row"><span>当前版本<span class="version">${this.version ? `v${this.version}` : this.loadError ? '读取失败' : '读取中…'}</span></span>
        <button type="button" @click=${this.checkUpdates} ?disabled=${this.checking} aria-busy=${this.checking}>${this.checking ? '正在检查…' : '检查更新'}</button></div>
      <p class="hint">手动检查 GitHub 正式发行版，发现更新后可前往下载。</p>
      <div role="status" aria-live="polite" aria-atomic="true">
        ${this.result ? html`<p class=${`message ${this.result.status === 'error' ? 'error' : ''}`}>${this.result.message}</p>` : nothing}
      </div>
      ${releaseUrl ? html`<a href=${releaseUrl} target="_blank" rel="noopener noreferrer">前往发行页面 · v${this.result?.latestVersion}</a>` : nothing}
    </section>`;
  }
}

customElements.define('app-updates', AppUpdates);
