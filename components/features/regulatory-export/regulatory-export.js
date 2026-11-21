// <regulatory-export> — feature `regulatory-export` (catalogue lot 2, route /regulatory).
// Export réglementaire (décret tertiaire / OPERAT) : v1 = **CSV annuel par site**
// calculé côté serveur (matview gold annual_site_consumption, CR-4), exporté en
// CSV ou JSON (config year, format). Le format OPERAT exact reste un point ouvert
// (métier) — le CSV v1 est le sous-ensemble commun. Dépend CR-4 (publication LDP).
import { html, css } from 'lit';
import { FeatureComponent } from '../../shared/feature-base.js';
import { loadAsset, getFeatureConfig, download, toCsv, pick } from '../../shared/feature-data.js';

export function regulatoryRows(rows, year) {
  return (rows ?? [])
    .filter((r) => String(r.year) === String(year))
    .map((r) => ({ site_id: pick(r, 'site_id', 'meter_id'), year: r.year, kwh: pick(r, 'consumption_kwh', 'kwh', 'annual_kwh'), eur: pick(r, 'total_cost_eur', 'cost_eur', 'eur') ?? null }));
}

export function toExportCsv(rows) {
  return toCsv(rows, [
    { key: 'site_id', label: 'site_id' },
    { key: 'year', label: 'annee' },
    { key: 'kwh', label: 'kwh_an' },
    { key: 'eur', label: 'eur_an' },
  ]);
}

export class RegulatoryExport extends FeatureComponent {
  static properties = {
    ...FeatureComponent.properties,
    rows: { type: Array, attribute: false },
    year: { type: Number },
    format: { type: String },
    message: { type: String },
  };

  static styles = css`
    ${FeatureComponent.styles}
    .bar { display: flex; gap: 10px; align-items: end; flex-wrap: wrap; margin-bottom: 10px; }
    label { display: flex; flex-direction: column; gap: 4px; font-size: .8rem; color: var(--muted); }
  `;

  constructor() {
    super();
    this.rows = [];
    this.year = new Date().getFullYear() - 1;
    this.format = 'csv';
    this.message = '';
  }

  async load() {
    const config = getFeatureConfig('regulatory-export');
    this.year = Number(config.year ?? this.year);
    this.format = config.format ?? 'csv';
    this.rows = regulatoryRows(await loadAsset('annual_site_consumption'), this.year);
    this.objects = this.rows;
    return this.rows;
  }

  isEmpty() { return false; }

  _export() {
    if (this.rows.length === 0) { this.message = 'Aucune donnée pour cette année.'; return; }
    if (this.format === 'json') {
      download(`export-reglementaire-${this.year}.json`, JSON.stringify(this.rows, null, 2), 'application/json');
    } else {
      download(`export-reglementaire-${this.year}.csv`, toExportCsv(this.rows));
    }
    this.message = `Export ${this.format} ${this.year} généré (${this.rows.length} sites).`;
  }

  renderContent() {
    return html`
      <h2 style="margin:0 0 10px;font-size:1.05rem">Export réglementaire (décret tertiaire / OPERAT)</h2>
      <div class="bar">
        <label>Année <input type="number" .value=${String(this.year)} @change=${(e) => { this.year = Number(e.target.value); }}></label>
        <label>Format
          <select .value=${this.format} @change=${(e) => { this.format = e.target.value; }}>
            <option value="csv">csv</option><option value="json">json</option>
          </select>
        </label>
        <button @click=${() => this._export()}>Exporter</button>
      </div>
      ${this.message ? html`<p class="toast">${this.message}</p>` : ''}
      <p class="fresh">${this.rows.length} site(s) pour ${this.year} — matview gold <code>annual_site_consumption</code> (CR-4). Format OPERAT exact : point ouvert métier.</p>
    `;
  }
}

customElements.define('regulatory-export', RegulatoryExport);
