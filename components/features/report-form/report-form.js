// <report-form> — feature `report-builder` (catalogue lot 1, route /reports).
// v1 = génération **PDF/CSV côté client** depuis les données déjà fetchées,
// téléchargement direct (décision §4.3 ; `recipients`/mail = v2, aucun canal mail).
// Le formulaire est piloté par le config_schema de la feature (période, bâtiment,
// format) et persiste dans prefs.<slug>.config via appStore.patchPrefs (forme R1).
// Données : conteneurs LDP /gold/net_grid_hourly/ + /gold/energy_cost_daily/ (LDP-only).
import { html, css } from 'lit';
import { FeatureComponent } from '../../shared/feature-base.js';
import appStore from '@facis/app-store/components/shared/app-store-api.js';
import { configPatch } from '@facis/app-store/components/shared/logic.js';
import { loadAsset, getFeatureConfig, monthBounds, isoDaysAgo, download, toCsv, field, pick } from '../../shared/feature-data.js';

export const PERIODS = {
  day: () => ({ from: isoDaysAgo(1), to: new Date().toISOString() }),
  week: () => ({ from: isoDaysAgo(7), to: new Date().toISOString() }),
  month: () => monthBounds(),
  year: () => ({ from: new Date(new Date().getFullYear(), 0, 1).toISOString(), to: new Date().toISOString() }),
};

/** Lignes du rapport : conso horaire (LDP) + coût journalier (LDP). */
export async function buildReportRows({ period, building }) {
  const win = (PERIODS[period] ?? PERIODS.month)();
  const hourly = await loadAsset('net_grid_hourly', win); // conteneur LDP + fenêtrage client
  const costs = (await loadAsset('energy_cost_daily')).filter((c) => {
    const d = field(c, 'day');
    return (!win.from || d >= win.from.slice(0, 10)) && (!win.to || d <= win.to.slice(0, 10)) && (!building || String(pick(c, 'site_id', 'meter_id')) === String(building));
  });
  const kwh = hourly
    .filter((r) => !building || String(pick(r, 'site_id', 'meter_id')) === String(building))
    .reduce((s, r) => s + Math.max(0, Number(pick(r, 'net_grid_kw', 'net_kw') ?? 0)), 0);
  const eur = costs.reduce((s, c) => s + Number(pick(c, 'total_cost_eur', 'cost_eur') ?? 0), 0);
  return { kwh, eur, hourly: hourly.length, days: costs.length, from: win.from, to: win.to };
}

export function reportCsv(summary) {
  return toCsv([{ metrique: 'conso_kwh', valeur: summary.kwh.toFixed(1) },
                { metrique: 'cout_eur', valeur: summary.eur.toFixed(2) },
                { metrique: 'jours_couverts', valeur: summary.days },
                { metrique: 'fenetre', valeur: `${summary.from} → ${summary.to}` }],
    [{ key: 'metrique', label: 'metrique' }, { key: 'valeur', label: 'valeur' }]);
}

/** PDF via jsPDF chargé à la volée (dépendance optionnelle) ; repli CSV si absent. */
async function reportPdf(summary) {
  try {
    const { jsPDF } = await import('jspdf');
    const doc = new jsPDF();
    doc.text('Rapport énergétique', 14, 16);
    doc.text(`Conso : ${summary.kwh.toFixed(1)} kWh`, 14, 28);
    doc.text(`Coût : ${summary.eur.toFixed(2)} €`, 14, 36);
    doc.text(`Fenêtre : ${summary.from} → ${summary.to}`, 14, 44);
    return { content: doc.output('blob'), mime: 'application/pdf', ext: 'pdf' };
  } catch {
    return { content: reportCsv(summary), mime: 'text/csv', ext: 'csv' };
  }
}

export class ReportForm extends FeatureComponent {
  static properties = {
    ...FeatureComponent.properties,
    values: { type: Object, attribute: false },
    busy: { type: Boolean, attribute: false },
    message: { type: String },
  };

  static styles = css`
    ${FeatureComponent.styles}
    form { display: flex; gap: 10px; flex-wrap: wrap; align-items: end; }
    label { display: flex; flex-direction: column; gap: 4px; font-size: .8rem; color: var(--muted); }
  `;

  constructor() {
    super();
    this.values = {};
    this.busy = false;
    this.message = '';
  }

  async load() {
    this.values = getFeatureConfig('report-builder');
    this.objects = [this.values];
    return this.values;
  }

  isEmpty() { return false; }

  async _save() {
    await appStore.patchPrefs(configPatch('report-builder', this.values));
    this.message = 'Configuration enregistrée.';
  }

  async _generate() {
    this.busy = true;
    this.message = '';
    try {
      const summary = await buildReportRows(this.values);
      const format = this.values.format ?? 'csv';
      if (format === 'pdf') {
        const pdf = await reportPdf(summary);
        download(`rapport-${this.values.period ?? 'month'}.${pdf.ext}`, pdf.content, pdf.mime);
      } else {
        download(`rapport-${this.values.period ?? 'month'}.csv`, reportCsv(summary));
      }
      this.message = `Rapport ${format} généré (${summary.kwh.toFixed(1)} kWh, ${summary.eur.toFixed(2)} €).`;
    } finally {
      this.busy = false;
    }
  }

  _onInput(e) {
    const { name, value } = e.target;
    this.values = { ...this.values, [name]: value };
  }

  renderContent() {
    const v = this.values;
    return html`
      <h2 style="margin:0 0 10px;font-size:1.05rem">Rapports PDF/CSV</h2>
      <form @submit=${(e) => { e.preventDefault(); this._generate(); }}>
        <label>Période
          <select name="period" .value=${v.period ?? 'month'} @change=${this._onInput}>
            ${['day', 'week', 'month', 'year'].map((p) => html`<option value=${p}>${p}</option>`)}
          </select>
        </label>
        <label>Bâtiment (site_id, vide = tous)
          <input name="building" .value=${v.building ?? ''} @input=${this._onInput} placeholder="ex. site-1">
        </label>
        <label>Format
          <select name="format" .value=${v.format ?? 'csv'} @change=${this._onInput}>
            ${['csv', 'pdf'].map((f) => html`<option value=${f}>${f}</option>`)}
          </select>
        </label>
        <button type="submit" ?disabled=${this.busy}>${this.busy ? 'Génération…' : 'Générer'}</button>
        <button type="button" class="secondary" @click=${() => this._save()}>Enregistrer la config</button>
      </form>
      ${this.message ? html`<p class="toast">${this.message}</p>` : ''}
    `;
  }
}

customElements.define('report-form', ReportForm);
