// <budget-gauge> — feature `budget-tracker` (catalogue batch 2, route /budget).
// Actual consumption vs monthly kWh/€ budget — config budget_kwh (req),
// budget_eur, alert_pct (default 80). Data: LDP container /gold/net_grid_hourly/ (current month,
// + LDP energy_cost_daily. Client-side computation (no matview, §4 v0.3).
import { html, css } from 'lit';
import { FeatureComponent } from '../../shared/feature-base.js';
import { loadAsset, getFeatureConfig, monthBounds, field, pick, fmtKwh, fmtEur } from '../../shared/feature-data.js';

export function budgetPct(consumed, budget) {
  const b = Number(budget);
  if (!b || Number.isNaN(b)) return null;
  return (Number(consumed) / b) * 100;
}

export function budgetStatus(pct, alertPct = 80) {
  if (pct == null) return 'unknown';
  if (pct >= 100) return 'over';
  if (pct >= Number(alertPct)) return 'alert';
  return 'ok';
}

export class BudgetGauge extends FeatureComponent {
  static properties = {
    ...FeatureComponent.properties,
    consumedKwh: { type: Number, attribute: false },
    costEur: { type: Number, attribute: false },
    budgetKwh: { type: Number, attribute: false },
    budgetEur: { type: Number, attribute: false },
    alertPct: { type: Number, attribute: false },
  };

  static styles = css`
    ${FeatureComponent.styles}
    .gauge { height: 18px; border-radius: 999px; background: #e2e8f0; overflow: hidden; margin: 8px 0; }
    .gauge > div { height: 100%; border-radius: 999px; transition: width .3s ease; }
    .g-ok { background: #10b981; } .g-alert { background: #f59e0b; } .g-over { background: #ef4444; }
    .kpis { display: flex; gap: 18px; flex-wrap: wrap; margin: 6px 0 12px; }
    .kpi { font-size: .85rem; color: var(--muted); } .kpi b { display: block; font-size: 1.15rem; color: var(--ink); }
  `;

  constructor() {
    super();
    this.consumedKwh = 0; this.costEur = 0;
    this.budgetKwh = 0; this.budgetEur = 0; this.alertPct = 80;
  }

  async load() {
    const config = getFeatureConfig('budget-tracker');
    this.budgetKwh = Number(config.budget_kwh ?? 0);
    this.budgetEur = Number(config.budget_eur ?? 0);
    this.alertPct = Number(config.alert_pct ?? 80);
    const { from, to } = monthBounds();
    const [hourly, costs] = await Promise.all([
      loadAsset('net_grid_hourly', { from, to }).catch(() => []), // container not published → cost-only fallback
      loadAsset('energy_cost_daily'),
    ]);
    this.consumedKwh = hourly.reduce((s, r) => s + Math.max(0, Number(pick(r, 'net_grid_kw', 'net_kw') ?? 0)), 0);
    this.costEur = costs
      .filter((c) => { const d = field(c, 'day'); return d >= from.slice(0, 10) && d <= to.slice(0, 10); })
      .reduce((s, c) => s + Number(pick(c, 'total_cost_eur', 'cost_eur') ?? 0), 0);
    this.objects = [this];
    return this;
  }

  isEmpty() { return false; }

  renderContent() {
    const pctKwh = budgetPct(this.consumedKwh, this.budgetKwh);
    const pctEur = budgetPct(this.costEur, this.budgetEur);
    const status = budgetStatus(Math.max(pctKwh ?? 0, pctEur ?? 0), this.alertPct);
    const pct = Math.min(100, Math.max(pctKwh ?? 0, pctEur ?? 0));
    return html`
      <h2 style="margin:0 0 6px;font-size:1.05rem">Monthly energy budget</h2>
      <div class="kpis">
        <span class="kpi"><b>${fmtKwh(this.consumedKwh)}</b>current month consumption (budget ${fmtKwh(this.budgetKwh)})</span>
        <span class="kpi"><b>${fmtEur(this.costEur)}</b>current month cost (budget ${fmtEur(this.budgetEur)})</span>
        <span class="badge ${status === 'over' ? 'sev-CRITICAL' : status === 'alert' ? 'sev-HIGH' : 'st-ok'}">${status === 'over' ? 'budget exceeded' : status === 'alert' ? `alert ≥ ${this.alertPct} %` : 'within budget'}</span>
      </div>
      <div class="gauge" role="progressbar" aria-valuenow=${pct.toFixed(0)}>
        <div class="g-${status === 'unknown' ? 'ok' : status}" style="width:${pct}%"></div>
      </div>
      <div class="fresh">kWh : ${pctKwh == null ? '—' : pctKwh.toFixed(0) + ' %'} · € : ${pctEur == null ? '—' : pctEur.toFixed(0) + ' %'}</div>
    `;
  }
}

customElements.define('budget-gauge', BudgetGauge);
