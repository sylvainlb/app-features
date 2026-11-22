// <pv-gauge> — feature `pv-selfconsumption` (catalogue batch 2, route /pv).
// PV self-consumption (+ optional battery, config battery_kwh, default 0).
// Data: LDP containers pv_performance_hourly + net_grid_hourly.
// net_kw < 0 = grid injection; self-consumption = (PV − injection) / PV.
import { html, css } from 'lit';
import { FeatureComponent } from '../../shared/feature-base.js';
import { loadAsset, getFeatureConfig, monthBounds, pick } from '../../shared/feature-data.js';

export function selfConsumptionPct(pvRows, gridRows, batteryKwh = 0) {
  let pv = 0, inj = 0;
  for (const r of pvRows ?? []) pv += Math.max(0, Number(pick(r, 'pv_generation_kw', 'production_kw', 'pv_kw') ?? 0));
  for (const r of gridRows ?? []) inj += Math.max(0, -Number(pick(r, 'net_grid_kw', 'net_kw') ?? 0));
  if (pv <= 0) return null;
  const battery = Math.max(0, Number(batteryKwh ?? 0));
  // the battery absorbs part of the injection → improves self-consumption
  const self = Math.min(pv, pv - Math.min(inj, inj) + Math.min(inj, battery * 0)); // base: pv - inj
  const base = pv - inj;
  const withBattery = Math.min(pv, base + Math.min(inj, battery)); // stored energy returned
  return { pct: (Math.max(0, base) / pv) * 100, pctBattery: (Math.max(0, withBattery) / pv) * 100, pv, injection: inj };
}

export class PvGauge extends FeatureComponent {
  static properties = {
    ...FeatureComponent.properties,
    stats: { type: Object, attribute: false },
    batteryKwh: { type: Number, attribute: false },
  };

  static styles = css`
    ${FeatureComponent.styles}
    .gauge { height: 18px; border-radius: 999px; background: #e2e8f0; overflow: hidden; margin: 8px 0; }
    .gauge > div { height: 100%; background: linear-gradient(90deg, #f59e0b, #fbbf24); }
    .kpis { display: flex; gap: 18px; flex-wrap: wrap; }
    .kpi { font-size: .85rem; color: var(--muted); } .kpi b { display: block; font-size: 1.15rem; color: var(--ink); }
  `;

  constructor() {
    super();
    this.stats = null;
    this.batteryKwh = 0;
  }

  async load() {
    const config = getFeatureConfig('pv-selfconsumption');
    this.batteryKwh = Number(config.battery_kwh ?? 0);
    const { from, to } = monthBounds();
    const [pv, grid] = await Promise.all([
      loadAsset('pv_performance_hourly', { from, to }),
      loadAsset('net_grid_hourly', { from, to }),
    ]);
    this.stats = selfConsumptionPct(pv, grid, this.batteryKwh);
    this.objects = [this.stats];
    return this.stats;
  }

  isEmpty() { return !this.stats; }

  renderContent() {
    const s = this.stats;
    const pct = this.batteryKwh > 0 ? s.pctBattery : s.pct;
    return html`
      <h2 style="margin:0 0 6px;font-size:1.05rem">PV self-consumption${this.batteryKwh > 0 ? ` (+ battery ${this.batteryKwh} kWh)` : ''}</h2>
      <div class="kpis">
        <span class="kpi"><b>${pct == null ? '—' : pct.toFixed(0) + ' %'}</b>self-consumption</span>
        <span class="kpi"><b>${s.pv.toFixed(0)} kWh</b>PV production</span>
        <span class="kpi"><b>${s.injection.toFixed(0)} kWh</b>grid injection</span>
      </div>
      <div class="gauge" role="progressbar" aria-valuenow=${(pct ?? 0).toFixed(0)}>
        <div style="width:${Math.min(100, pct ?? 0)}%"></div>
      </div>
    `;
  }
}

customElements.define('pv-gauge', PvGauge);
