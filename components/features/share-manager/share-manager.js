// <share-manager> — feature `data-sharing` (catalogue lot 3, route /sharing, role admin).
// Partage de données (contrats DSP) : wrappe les endpoints cœur existants —
// catalogue DSP + lookup de contrat (état PostgreSQL + jeton TTL, synthèse §4.1).
// Le parcours self-service « offre → négociation → agreement » n'est PAS démontré
// côté cœur (catalogue §4.7, à confirmer) : v1 liste les assets et soumet une
// demande de contrat (asset, consumer_did, duration_days) au plan de contrôle.
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
    const hint404 = 'négociation de contrat non démontrée côté cœur (catalogue §4.7 — à confirmer)';
    const e = new Error(res.status === 404
      ? `POST /dsp/contracts/request → 404 : ${hint404}`
      : `POST /dsp/contracts/request → ${res.status}`);
    e.status = res.status;
    e.url = url;
    e.hint = res.status === 404 ? hint404 : 'plan de contrôle DSP — voir catalogue §4.7';
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
    // Catalogue DSP (lecture cœur, session requise).
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
      this.message = `Contrat demandé : ${field(res, 'id') ?? field(res, '@id') ?? 'OK'}`;
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
      <h2 style="margin:0 0 10px;font-size:1.05rem">Partage de données (contrats DSP)</h2>
      <table>
        <thead><tr><th>Asset</th><th>Titre</th></tr></thead>
        <tbody>${this.assets.map((a) => html`<tr><td><code>${a.id}</code></td><td>${a.title}</td></tr>`)}</tbody>
      </table>
      <form @submit=${(e) => { e.preventDefault(); this._request(); }}>
        <label>Asset <input name="asset" .value=${this.form.asset ?? ''} @input=${this._onInput} placeholder="dataset:facis:…"></label>
        <label>Consumer DID <input name="consumer_did" .value=${this.form.consumer_did ?? ''} @input=${this._onInput} placeholder="did:web:…"></label>
        <label>Durée (jours) <input name="duration_days" type="number" .value=${this.form.duration_days ?? ''} @input=${this._onInput}></label>
        <button type="submit" ?disabled=${this.busy}>Demander un contrat</button>
      </form>
      ${this.message ? html`<p class="toast">${this.message}</p>` : ''}
    `;
  }
}

customElements.define('share-manager', ShareManager);
