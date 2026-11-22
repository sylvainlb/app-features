// <ai-chat> — feature `ai-assistant` (catalogue batch 3, route /assistant).
// Data AI assistant: POST /app/llm (CR-5 — **the CR creates the endpoint**
// (a function, not a data resource: data is read via LDP, ACL/RLS);
// no LLM flow exists yet on the FAP-light side, catalogue §4.6). Contract: OIDC session auth,
// rate limit 10 req/min/user, dsp.audit audit. The PDP rejects any asset outside
// the `config.assets` allowlist — never the whole gold.
import { html, css } from 'lit';
import { FeatureComponent } from '../../shared/feature-base.js';
import appStore from '@facis/app-store/components/shared/app-store-api.js';
import { getFeatureConfig } from '../../shared/feature-data.js';

export async function askLlm(question, config) {
  const base = String(appStore.getPodUrl?.() ?? window.config?.podUrl ?? '').replace(/\/+$/, '');
  const url = base ? `${base}/app/llm` : '/app/llm';
  const fetchFn = window.sibStore?.fetchAuthn ?? fetch;
  const res = await fetchFn(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', accept: 'application/ld+json' },
    body: JSON.stringify({ question, assets: config.assets ?? [], model: config.model ?? '' }),
  });
  if (!res.ok) {
    const hint404 = 'CR-5: endpoint POST /app/llm not deployed (created by the CR, catalogue §4.6)';
    const e = new Error(res.status === 404
      ? `POST /app/llm → 404 : ${hint404}`
      : `POST /app/llm → ${res.status}`);
    e.status = res.status;
    e.url = url;
    e.hint = res.status === 404 ? hint404 : 'DSP control plane — see catalogue §4.7';
    throw e;
  }
  return res.json();
}

export class AiChat extends FeatureComponent {
  static properties = {
    ...FeatureComponent.properties,
    messages: { type: Array, attribute: false },
    draft: { type: String },
    busy: { type: Boolean, attribute: false },
    llmError: { type: String },
  };

  static styles = css`
    ${FeatureComponent.styles}
    .chat { display: flex; flex-direction: column; gap: 8px; max-height: 50vh; overflow: auto; margin-bottom: 10px; }
    .msg { max-width: 80%; padding: 8px 12px; border-radius: 12px; font-size: .9rem; white-space: pre-wrap; }
    .msg.user { align-self: flex-end; background: #ccfbf1; }
    .msg.bot { align-self: flex-start; background: #f1f5f9; }
    .row { display: flex; gap: 8px; }
    .row input { flex: 1; }
  `;

  constructor() {
    super();
    this.messages = [];
    this.draft = '';
    this.busy = false;
    this.llmError = '';
  }

  async load() {
    this.config = getFeatureConfig('ai-assistant');
    this.objects = [this.config];
    return this.config;
  }

  isEmpty() { return false; }

  async _send() {
    const q = this.draft.trim();
    if (!q || this.busy) return;
    this.messages = [...this.messages, { role: 'user', text: q }];
    this.draft = '';
    this.busy = true;
    this.llmError = '';
    try {
      const res = await askLlm(q, this.config);
      this.messages = [...this.messages, { role: 'bot', text: String(res.answer ?? res.text ?? JSON.stringify(res)) }];
    } catch (e) {
      this.llmError = e.message;
      this.messages = [...this.messages, { role: 'bot', text: `Error: ${e.message}` }];
    } finally {
      this.busy = false;
    }
  }

  renderContent() {
    return html`
      <h2 style="margin:0 0 10px;font-size:1.05rem">Data AI assistant</h2>
      <p class="fresh">allowed assets: ${(this.config?.assets ?? []).join(', ') || '—'} · model: ${this.config?.model || '—'}</p>
      <div class="chat">
        ${this.messages.length === 0 ? html`<div class="empty">Ask a question about your data (scope bounded server-side, CR-5).</div>` : ''}
        ${this.messages.map((m) => html`<div class="msg ${m.role}">${m.text}</div>`)}
      </div>
      ${this.llmError ? html`<div class="error" role="alert">${this.llmError}</div>` : ''}
      <div class="row">
        <input .value=${this.draft} @input=${(e) => { this.draft = e.target.value; }}
               @keydown=${(e) => { if (e.key === 'Enter') this._send(); }} placeholder="Your question…">
        <button ?disabled=${this.busy} @click=${() => this._send()}>Send</button>
      </div>
    `;
  }
}

customElements.define('ai-chat', AiChat);
