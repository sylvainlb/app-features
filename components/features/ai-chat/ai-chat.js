// <ai-chat> — feature `ai-assistant` (catalogue lot 3, route /assistant).
// Assistant IA sur les données : POST /app/llm (CR-5 — **c'est la CR qui crée
// l'endpoint** (fonction, pas une ressource de données : les données sont lues en LDP,
// ACL/RLS) ; aucun flux LLM n'existe aujourd'hui côté FAP-light, catalogue §4.6). Contrat : auth session OIDC,
// rate limit 10 req/min/user, audit dsp.audit. Le PDP refuse tout asset hors
// allowlist `config.assets` — jamais tout le gold.
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
    const hint404 = 'CR-5 : endpoint POST /app/llm non déployé (créé par la CR, catalogue §4.6)';
    const e = new Error(res.status === 404
      ? `POST /app/llm → 404 : ${hint404}`
      : `POST /app/llm → ${res.status}`);
    e.status = res.status;
    e.url = url;
    e.hint = res.status === 404 ? hint404 : 'plan de contrôle DSP — voir catalogue §4.7';
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
      this.messages = [...this.messages, { role: 'bot', text: `Erreur : ${e.message}` }];
    } finally {
      this.busy = false;
    }
  }

  renderContent() {
    return html`
      <h2 style="margin:0 0 10px;font-size:1.05rem">Assistant IA sur les données</h2>
      <p class="fresh">assets autorisés : ${(this.config?.assets ?? []).join(', ') || '—'} · modèle : ${this.config?.model || '—'}</p>
      <div class="chat">
        ${this.messages.length === 0 ? html`<div class="empty">Posez une question sur vos données (périmètre borné côté serveur, CR-5).</div>` : ''}
        ${this.messages.map((m) => html`<div class="msg ${m.role}">${m.text}</div>`)}
      </div>
      ${this.llmError ? html`<div class="error" role="alert">${this.llmError}</div>` : ''}
      <div class="row">
        <input .value=${this.draft} @input=${(e) => { this.draft = e.target.value; }}
               @keydown=${(e) => { if (e.key === 'Enter') this._send(); }} placeholder="Question…">
        <button ?disabled=${this.busy} @click=${() => this._send()}>Envoyer</button>
      </div>
    `;
  }
}

customElements.define('ai-chat', AiChat);
