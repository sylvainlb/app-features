// <share-manager> — feature `data-sharing` (catalogue batch 3, route /sharing, role admin).
// Data sharing (DSP contracts): wraps existing core endpoints —
// DSP catalogue + contract lookup (PostgreSQL state + TTL token, summary §4.1).
// The self-service journey "offer → negotiation → agreement" is NOT demonstrated
// on the core side (catalogue §4.7, to be confirmed): v1 lists the assets and submits a
// contract request (asset, consumer_did, duration_days) to the control plane.
import { html, css } from 'lit';
import { getJson } from '@facis/app-store/components/boilerplate/index.js';
import { FeatureComponent } from '../../shared/feature-base.js';
import appStore from '@facis/app-store/components/shared/app-store-api.js';
import { getFeatureConfig, field } from '../../shared/feature-data.js';

export async function requestContract({ asset, consumer_did, duration_days }) {
  const base = String(appStore.getPodUrl?.() ?? window.config?.podUrl ?? '').replace(/\/+$/, '');
  const url = base ? `${base}/dsp/contracts/request` : '/dsp/contracts/request';
  const fetchFn = window.sibStore?.fetchAuthn ?? fetch;
  const res = await fetchFn(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', accept: 'application/ld+json' },
    body: JSON.stringify({ asset, consumer_did, duration_days }),
  });
  if (!res.ok) {
    const hint404 = 'contract negotiation not demonstrated on the core side (catalogue §4.7 — to be confirmed)';
    const e = new Error(res.status === 404
      ? `POST /dsp/contracts/request → 404 : ${hint404}`
      : `POST /dsp/contracts/request → ${res.status}`);
    e.status = res.status;
    e.url = url;
    e.hint = res.status === 404 ? hint404 : 'DSP control plane — see catalogue §4.7';
    throw e;
  }
  return res.json();
}

export class ShareManager extends FeatureComponent {
  static properties = {
    ...FeatureComponent.properties,
    assets: { type: Array, attribute: false },
    form: { type: Object, attribute: false },
    message: { type: String },
    busy: { type: Boolean, attribute: false },
  };

  static styles = css`
    ${FeatureComponent.styles}
    form { display: flex; gap: 10px; flex-wrap: wrap; align-items: end; margin: 10px 0; }
    label { display: flex; flex-direction: column; gap: 4px; font-size: .8rem; color: var(--muted); }
  `;

  constructor() {
    super();
    this.assets = [];
    this.form = {};
    this.message = '';
    this.busy = false;
  }

  async load() {
    this.form = getFeatureConfig('data-sharing');
    // DSP catalogue (core read, session required).
    const cat = await getJson('/dsp/catalogue');
    const ds = cat?.dataset ?? cat?.datasets ?? (Array.isArray(cat) ? cat : []);
    this.assets = ds.map((d) => ({ id: field(d, 'id') ?? field(d, '@id'), title: field(d, 'title') ?? '' }));
    this.objects = this.assets;
    return this.assets;
  }

  isEmpty() { return false; }

  async _request() {
    this.busy = true;
    this.message = '';
    try {
      const res = await requestContract(this.form);
      this.message = `Contract requested: ${field(res, 'id') ?? field(res, '@id') ?? 'OK'}`;
    } catch (e) {
      this.message = e.message;
    } finally {
      this.busy = false;
    }
  }

  _onInput(e) {
    this.form = { ...this.form, [e.target.name]: e.target.value };
  }

  renderContent() {
    return html`
      <h2 style="margin:0 0 10px;font-size:1.05rem">Data sharing (DSP contracts)</h2>
      <table>
        <thead><tr><th>Asset</th><th>Title</th></tr></thead>
        <tbody>${this.assets.map((a) => html`<tr><td><code>${a.id}</code></td><td>${a.title}</td></tr>`)}</tbody>
      </table>
      <form @submit=${(e) => { e.preventDefault(); this._request(); }}>
        <label>Asset <input name="asset" .value=${this.form.asset ?? ''} @input=${this._onInput} placeholder="dataset:facis:…"></label>
        <label>Consumer DID <input name="consumer_did" .value=${this.form.consumer_did ?? ''} @input=${this._onInput} placeholder="did:web:…"></label>
        <label>Duration (days) <input name="duration_days" type="number" .value=${this.form.duration_days ?? ''} @input=${this._onInput}></label>
        <button type="submit" ?disabled=${this.busy}>Request a contract</button>
      </form>
      ${this.message ? html`<p class="toast">${this.message}</p>` : ''}
    `;
  }
}

customElements.define('share-manager', ShareManager);
