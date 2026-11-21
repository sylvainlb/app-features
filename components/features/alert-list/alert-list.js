// <alert-list> — feature `alert-rules` (catalogue lot 1, route /alerts).
// Évaluation **côté front** (décision catalogue §4.1) sur données déjà fetchées :
//   - LDP publié : /gold/anomaly_candidates/ + /buildings/ (métadonnées parc)
//   - seuils par bâtiment : config `thresholds` (object bâtiment→{kW, eur_day}) des prefs.
// Canal de notification v1 = badge UI uniquement (pas d'email/push, §4.1).
import { html, css } from 'lit';
import { FeatureComponent } from '../../shared/feature-base.js';
import { loadAsset, getFeatureConfig, field, pick, fmtKwh, fmtFreshness } from '../../shared/feature-data.js';

// Seuil applicable à une anomalie : clé = id bâtiment ou meter_id.
export function thresholdFor(thresholds, anomaly, buildings) {
  if (!thresholds || typeof thresholds !== 'object') return null;
  const meter = pick(anomaly, 'meter_id', 'site_id');
  const b = (buildings ?? []).find((x) => pick(x, 'meter_id', 'site_id') === meter);
  const bid = b ? String(field(b, 'id') ?? field(b, '@id')) : null;
  return thresholds[bid] ?? thresholds[String(meter)] ?? thresholds['*'] ?? null;
}

// Règle de dépassement : kW estimé > seuil kW, ou severity CRITICAL/HIGH quand un seuil existe.
export function isBreach(anomaly, th) {
  if (!th) return false;
  const kw = Number(pick(anomaly, 'active_power_kw', 'estimated_kw', 'kw') ?? NaN);
  if (th.kW != null && !Number.isNaN(kw) && kw > Number(th.kW)) return true;
  const sev = String(pick(anomaly, 'severity') ?? '').toUpperCase();
  return (sev === 'CRITICAL' || sev === 'HIGH') && (th.kW != null || th.eur_day != null);
}

export function computeAlerts(anomalies, thresholds, buildings) {
  return (anomalies ?? [])
    .map((a) => ({ anomaly: a, th: thresholdFor(thresholds, a, buildings), breach: isBreach(a, thresholdFor(thresholds, a, buildings)) }))
    .filter((x) => x.breach);
}

export class AlertList extends FeatureComponent {
  static properties = {
    ...FeatureComponent.properties,
    alerts: { type: Array, attribute: false },
    freshness: { type: String },
  };

  static styles = css`
    ${FeatureComponent.styles}
    .head { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
    .head h2 { margin: 0; font-size: 1.05rem; flex: 1; }
    .fresh { font-size: .78rem; color: var(--muted); }
  `;

  constructor() {
    super();
    this.alerts = [];
    this.freshness = null;
  }

  async load() {
    const config = getFeatureConfig('alert-rules');
    const [anomalies, buildings] = await Promise.all([
      loadAsset('anomaly_candidates'),
      loadAsset('buildings'),
    ]);
    this.alerts = computeAlerts(anomalies, config.thresholds, buildings);
    const ts = anomalies.map((a) => pick(a, 'event_timestamp', 'hour')).filter(Boolean).sort().pop();
    this.freshness = ts ?? null;
    this.objects = this.alerts;
    return this.alerts;
  }

  isEmpty() { return this.alerts.length === 0; }

  renderContent() {
    const n = this.alerts.length;
    return html`
      <div class="head">
        <h2>Alertes personnalisées</h2>
        <span class="badge ${n ? 'sev-HIGH' : 'st-ok'}">${n} alerte${n > 1 ? 's' : ''}</span>
        <span class="fresh">fraîcheur : ${fmtFreshness(this.freshness)}</span>
      </div>
      ${n === 0
        ? html`<div class="empty">Aucune alerte — aucun seuil dépassé.</div>`
        : html`<table>
            <thead><tr><th>Date</th><th>Bâtiment</th><th>Type</th><th>Sévérité</th><th>Estimé</th><th>Seuil</th></tr></thead>
            <tbody>
              ${this.alerts.map(({ anomaly, th }) => html`<tr>
                <td>${field(anomaly, 'event_timestamp') ?? '—'}</td>
                <td>${pick(anomaly, 'meter_id', 'site_id') ?? '—'}</td>
                <td>${pick(anomaly, 'type', 'anomaly_type') ?? '—'}</td>
                <td><span class="badge sev-${String(pick(anomaly, 'severity') ?? 'LOW').toUpperCase()}">${String(pick(anomaly, 'severity') ?? '—').toUpperCase()}</span></td>
                <td>${fmtKwh(pick(anomaly, 'active_power_kw', 'estimated_kw', 'kw'))}</td>
                <td>${th?.kW != null ? `> ${th.kW} kW` : ''}${th?.eur_day != null ? ` / ${th.eur_day} €/j` : ''}</td>
              </tr>`)}
            </tbody>
          </table>`}
    `;
  }
}

customElements.define('alert-list', AlertList);
