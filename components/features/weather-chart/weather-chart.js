// <weather-chart> — feature `weather-correlation` (catalogue batch 3, route /weather).
// Weather & degree-days: LDP container /gold/weather_hourly/ (existing gold matview).
// Config: station, period
// (7d|30d|90d). Heating degree-days = Σ max(0, 18 − T) per day (base 18 °C).
import { html, css } from 'lit';
import { FeatureComponent } from '../../shared/feature-base.js';
import { loadAsset, getFeatureConfig, isoDaysAgo, tsOf, pick } from '../../shared/feature-data.js';

export const DJ_BASE = 18;

/** Daily aggregate: {day, tAvg, dj} — degree-days base 18 °C. */
export function degreeDays(rows, base = DJ_BASE) {
  const byDay = new Map();
  for (const r of rows ?? []) {
    const day = String(tsOf(r) ?? '').slice(0, 10);
    if (!day) continue;
    const t = Number(pick(r, 'temperature_c') ?? NaN);
    if (!byDay.has(day)) byDay.set(day, { day, sum: 0, n: 0, dj: 0 });
    const acc = byDay.get(day);
    if (!Number.isNaN(t)) { acc.sum += t; acc.n += 1; acc.dj += Math.max(0, base - t); }
  }
  return [...byDay.values()].map((a) => ({ day: a.day, tAvg: a.n ? a.sum / a.n : null, dj: a.dj })).sort((a, b) => a.day.localeCompare(b.day));
}

export class WeatherChart extends FeatureComponent {
  static properties = {
    ...FeatureComponent.properties,
    days: { type: Array, attribute: false },
    station: { type: String },
    period: { type: String },
  };

  static styles = css`
    ${FeatureComponent.styles}
    .bar { height: 14px; background: linear-gradient(90deg, #38bdf8, #0369a1); border-radius: 4px; }
  `;

  constructor() {
    super();
    this.days = [];
    this.station = '';
    this.period = '30d';
  }

  async load() {
    const config = getFeatureConfig('weather-correlation');
    this.station = String(config.station ?? '');
    this.period = String(config.period ?? '30d');
    const n = Number(String(this.period).replace('d', '')) || 30;
    const rows = await loadAsset('weather_hourly', { from: isoDaysAgo(n), to: new Date().toISOString() });
    const station = this.station;
    this.days = degreeDays(station ? rows.filter((r) => !pick(r, 'site_id') || String(pick(r, 'site_id')) === station) : rows);
    this.objects = this.days;
    return this.days;
  }

  isEmpty() { return this.days.length === 0; }

  renderContent() {
    const maxDj = Math.max(1, ...this.days.map((d) => d.dj));
    return html`
      <h2 style="margin:0 0 10px;font-size:1.05rem">Weather & degree-days${this.station ? ` — ${this.station}` : ''} (${this.period})</h2>
      <table>
        <thead><tr><th>Day</th><th>Avg T°</th><th>DD (base ${DJ_BASE} °C)</th><th></th></tr></thead>
        <tbody>${this.days.slice(-30).map((d) => html`<tr>
          <td>${d.day}</td>
          <td>${d.tAvg == null ? '—' : `${d.tAvg.toFixed(1)} °C`}</td>
          <td>${d.dj.toFixed(1)}</td>
          <td style="width:40%"><div class="bar" style="width:${(d.dj / maxDj) * 100}%"></div></td>
        </tr>`)}</tbody>
      </table>
    `;
  }
}

customElements.define('weather-chart', WeatherChart);
