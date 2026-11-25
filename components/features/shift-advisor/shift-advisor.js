// <shift-advisor> — feature `price-optimizer` (catalogue batch 2, route /optimize).
// Shift consumption to off-peak hours: hourly prices (LDP /gold/price_hourly/, CR-1)
// + hourly consumption (LDP /gold/net_grid_hourly/). Config: shiftable_kwh, window "HH:MM-HH:MM"
// (regex validated §4.1).
import { html, css } from 'lit';
import { FeatureComponent } from '../../shared/feature-base.js';
import { loadAsset, getFeatureConfig, isoDaysAgo, fmtEur, tsOf, pick } from '../../shared/feature-data.js';

export const WINDOW_RE = /^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/;

export function parseWindow(window) {
  const m = WINDOW_RE.exec(String(window ?? ''));
  if (!m) return null;
  const toMin = (h) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));
  return { start: toMin(m[1]), end: toMin(m[2]) };
}

/** Hours of the window sorted by ascending price; accumulate until shiftable_kwh is covered. */
export function bestHours(prices, netGrid, { shiftable_kwh, window } = {}) {
  const w = parseWindow(window);
  if (!w) return [];
  const cap = Number(shiftable_kwh ?? 0);
  const rows = (prices ?? []).map((p) => {
    const d = new Date(tsOf(p));
    return { hour: d.getHours(), price: Number(pick(p, 'price_eur_kwh', 'price') ?? NaN), day: d.toISOString().slice(0, 10) };
  }).filter((r) => !Number.isNaN(r.price) && r.hour * 60 >= w.start && r.hour * 60 < w.end);
  const byDay = new Map();
  for (const r of rows) {
    if (!byDay.has(r.day)) byDay.set(r.day, []);
    byDay.get(r.day).push(r);
  }
  const out = [];
  for (const [day, list] of byDay) {
    list.sort((a, b) => a.price - b.price);
    let remaining = cap;
    for (const h of list) {
      if (remaining <= 0) break;
      out.push({ day, hour: h.hour, price: h.price });
      remaining -= 1; // 1 h ≈ 1 kWh shiftable by default
    }
  }
  return out.sort((a, b) => a.price - b.price);
}

export class ShiftAdvisor extends FeatureComponent {
  static properties = {
    ...FeatureComponent.properties,
    advice: { type: Array, attribute: false },
    error: { type: Object, attribute: false },
  };

  static styles = css`
    ${FeatureComponent.styles}
    .head { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
    .head h2 { margin: 0; font-size: 1.05rem; flex: 1; }
  `;

  constructor() {
    super();
    this.advice = [];
  }

  async load() {
    const config = getFeatureConfig('price-optimizer');
    const to = new Date().toISOString();
    const from = isoDaysAgo(7);
    // Perf: only price_hourly is needed (bestHours ranks hours by price); loading
    // net_grid_hourly (3600+ members → one GET each) dominated the load time.
    const [prices] = await Promise.all([
      loadAsset('price_hourly', { from, to }),
    ]);
    this.advice = bestHours(prices, [], config);
    this.objects = this.advice;
    return this.advice;
  }

  isEmpty() { return this.advice.length === 0; }

  renderContent() {
    return html`
      <div class="head"><h2>Load shifting (off-peak hours)</h2>
        <span class="badge st-ok">${this.advice.length} slot${this.advice.length > 1 ? 's' : ''} recommended</span></div>
      ${this.advice.length === 0
        ? html`<div class="empty">No slot — check the "window" setting and the prices (CR-1).</div>`
        : html`<table>
            <thead><tr><th>Day</th><th>Hour</th><th>Price</th></tr></thead>
            <tbody>${this.advice.slice(0, 24).map((a) => html`<tr>
              <td>${a.day}</td><td>${String(a.hour).padStart(2, '0')}:00</td><td>${fmtEur(a.price)}/kWh</td>
            </tr>`)}</tbody>
          </table>`}
    `;
  }
}

customElements.define('shift-advisor', ShiftAdvisor);
