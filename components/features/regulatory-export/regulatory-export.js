// <regulatory-export> — feature `regulatory-export` (catalogue batch 2, route /regulatory).
// Regulatory export (tertiary decree / OPERAT): v1 = **annual CSV per site**
// computed server-side (gold matview annual_site_consumption, CR-4), exported as
// CSV or JSON (config year, format). The exact OPERAT format remains an open
// business point — the v1 CSV is the common subset. Depends on CR-4 (LDP publication).
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
    { key: 'year', label: 'year' },
    { key: 'kwh', label: 'annual_kwh' },
    { key: 'eur', label: 'annual_eur' },
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
    if (this.rows.length === 0) { this.message = 'No data for this year.'; return; }
    if (this.format === 'json') {
      download(`regulatory-export-${this.year}.json`, JSON.stringify(this.rows, null, 2), 'application/json');
    } else {
      download(`regulatory-export-${this.year}.csv`, toExportCsv(this.rows));
    }
    this.message = `${this.format} export ${this.year} generated (${this.rows.length} sites).`;
  }

  renderContent() {
    return html`
      <h2 style="margin:0 0 10px;font-size:1.05rem">Regulatory export (tertiary decree / OPERAT)</h2>
      <div class="bar">
        <label>Year <input type="number" .value=${String(this.year)} @change=${(e) => { this.year = Number(e.target.value); }}></label>
        <label>Format
          <select .value=${this.format} @change=${(e) => { this.format = e.target.value; }}>
            <option value="csv">csv</option><option value="json">json</option>
          </select>
        </label>
        <button @click=${() => this._export()}>Export</button>
      </div>
      ${this.message ? html`<p class="toast">${this.message}</p>` : ''}
      <p class="fresh">${this.rows.length} site(s) for ${this.year} — gold matview <code>annual_site_consumption</code> (CR-4). Exact OPERAT format: open business point.</p>
    `;
  }
}

customElements.define('regulatory-export', RegulatoryExport);
