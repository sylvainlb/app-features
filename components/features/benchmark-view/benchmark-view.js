// <benchmark-view> — feature `benchmark` (catalogue batch 2, route /benchmark).
// Building comparison in kWh/m² (or €/m²) — config metric (kwh_m2|eur_m2),
// period (month|year), ref_building. Data: LDP container (consumption) + /buildings/
// (area `area_m2`, CR-2: manual entry v1). Depends on CR-2 (LDP publication).
import { html, css } from 'lit';
import { FeatureComponent } from '../../shared/feature-base.js';
import { loadAsset, getFeatureConfig, monthBounds, field, pick, fmtKwh, fmtEur } from '../../shared/feature-data.js';

/** Benchmark rows: {building, name, kwh, eur, area, kwhM2, eurM2}. */
export function benchmarkRows(buildings, costRows, { metric = 'kwh_m2', period = 'month' } = {}) {
  const { from } = period === 'year'
    ? { from: new Date(new Date().getFullYear(), 0, 1).toISOString() }
    : monthBounds();
  const bySite = new Map();
  for (const c of costRows ?? []) {
    const d = field(c, 'day');
    if (d < from.slice(0, 10)) continue;
    const site = String(pick(c, 'site_id', 'meter_id') ?? '');
    if (!bySite.has(site)) bySite.set(site, { kwh: 0, eur: 0 });
    const acc = bySite.get(site);
    acc.eur += Number(pick(c, 'total_cost_eur', 'cost_eur') ?? 0);
    acc.kwh += Number(pick(c, 'consumption_kwh', 'kwh', 'energy_kwh') ?? 0);
  }
  return (buildings ?? []).map((b) => {
    const site = String(pick(b, 'meter_id', 'site_id') ?? field(b, 'id') ?? '');
    const agg = bySite.get(site) ?? { kwh: 0, eur: 0 };
    const area = Number(field(b, 'area_m2') ?? NaN);
    return {
      building: site,
      name: field(b, 'name') ?? site,
      area: Number.isNaN(area) ? null : area,
      kwh: agg.kwh,
      eur: agg.eur,
      kwhM2: area ? agg.kwh / area : null,
      eurM2: area ? agg.eur / area : null,
      value: metric === 'eur_m2' ? (area ? agg.eur / area : null) : (area ? agg.kwh / area : null),
    };
  }).sort((a, b) => (b.value ?? -1) - (a.value ?? -1));
}

export class BenchmarkView extends FeatureComponent {
  static properties = {
    ...FeatureComponent.properties,
    rows: { type: Array, attribute: false },
    metric: { type: String },
    ref: { type: String },
  };

  static styles = css`
    ${FeatureComponent.styles}
    .ref { background: #f0fdfa !important; font-weight: 600; }
  `;

  constructor() {
    super();
    this.rows = [];
    this.metric = 'kwh_m2';
    this.ref = '';
  }

  async load() {
    const config = getFeatureConfig('benchmark');
    this.metric = config.metric ?? 'kwh_m2';
    this.ref = String(config.ref_building ?? '');
    const period = config.period ?? 'month';
    const [buildings, costs] = await Promise.all([
      loadAsset('buildings'),
      loadAsset('annual_site_consumption', { from: period === 'year' ? new Date(new Date().getFullYear(), 0, 1).toISOString() : monthBounds().from }).catch(() => []),
    ]);
    // annual_site_consumption is annual (CR-4); for period=month we fall back on energy_cost_daily LDP
    let costRows = costs;
    if (period !== 'year') {
      const daily = await loadAsset('energy_cost_daily');
      costRows = daily.map((c) => ({ day: field(c, 'day'), site_id: pick(c, 'site_id', 'meter_id'), cost_eur: pick(c, 'total_cost_eur', 'cost_eur'), kwh: pick(c, 'consumption_kwh', 'kwh', 'energy_kwh') }));
    }
    this.rows = benchmarkRows(buildings, costRows, { metric: this.metric, period });
    this.objects = this.rows;
    return this.rows;
  }

  isEmpty() { return this.rows.length === 0; }

  renderContent() {
    const unit = this.metric === 'eur_m2' ? '€/m²' : 'kWh/m²';
    return html`
      <h2 style="margin:0 0 10px;font-size:1.05rem">Building comparison (${unit})</h2>
      <table>
        <thead><tr><th>Building</th><th>Area</th><th>kWh</th><th>€</th><th>${unit}</th></tr></thead>
        <tbody>
          ${this.rows.map((r) => html`<tr class=${r.building === this.ref ? 'ref' : ''}>
            <td>${r.name}${r.building === this.ref ? ' ★' : ''}</td>
            <td>${r.area == null ? '—' : `${r.area} m²`}</td>
            <td>${fmtKwh(r.kwh)}</td>
            <td>${fmtEur(r.eur)}</td>
            <td>${r.value == null ? '—' : `${r.value.toFixed(1)} ${unit}`}</td>
          </tr>`)}
        </tbody>
      </table>
      <p class="fresh">★ = reference building. Area "area_m2" entered manually (CR-2).</p>
    `;
  }
}

customElements.define('benchmark-view', BenchmarkView);
