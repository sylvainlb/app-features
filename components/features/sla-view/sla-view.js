// <sla-view> — feature `sla-dashboard` (catalogue lot 1, route /sla).
// SLA = délai création (tickets.created_at) → statut RESOLVED (lu dans
// /tickets/<pk>/versions/, CR-3) — décision catalogue §4.2. Seuil `sla_hours`
// (défaut 24) depuis les prefs. Données LDP : /tickets/ + versions.
import { html, css } from 'lit';
import { FeatureComponent } from '../../shared/feature-base.js';
import { getJson, resolveMembers } from '@facis/app-store/components/boilerplate/index.js';
import { loadAsset, loadVersions, getFeatureConfig, field, fmtHours } from '../../shared/feature-data.js';

/** Délai de résolution en heures : 1ère version RESOLVED − created_at (null si jamais résololu). */
export function resolutionDelayHours(ticket, versions) {
  const created = new Date(field(ticket, 'created_at')).getTime();
  if (Number.isNaN(created)) return null;
  const resolved = (versions ?? [])
    .map((v) => ({ at: new Date(field(v, 'changed_at') ?? field(v, 'ts')).getTime(), status: String(field(v, 'status') ?? '').toUpperCase() }))
    .filter((v) => v.status === 'RESOLVED' && !Number.isNaN(v.at))
    .sort((a, b) => a.at - b.at)[0];
  if (!resolved) return null;
  return (resolved.at - created) / 3600e3;
}

export function slaRow(ticket, versions, slaHours) {
  const delay = resolutionDelayHours(ticket, versions);
  const status = String(field(ticket, 'status') ?? '').toUpperCase();
  const breached = delay != null && delay > slaHours;
  return { ticket, delay, status, breached, open: status !== 'RESOLVED' && status !== 'CLOSED' };
}

export class SlaView extends FeatureComponent {
  static properties = {
    ...FeatureComponent.properties,
    rows: { type: Array, attribute: false },
    slaHours: { type: Number },
  };

  static styles = css`
    ${FeatureComponent.styles}
    .head { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
    .head h2 { margin: 0; font-size: 1.05rem; flex: 1; }
  `;

  constructor() {
    super();
    this.rows = [];
    this.slaHours = 24;
  }

  async load() {
    const config = getFeatureConfig('sla-dashboard');
    this.slaHours = Number(config.sla_hours ?? 24);
    const tickets = await loadAsset('tickets');
    this.rows = await Promise.all(tickets.map(async (t) => {
      const pk = field(t, 'id') ?? String(field(t, '@id') ?? '').split('/').pop();
      let versions = [];
      try { versions = await loadVersions(pk); } catch { versions = []; } // CR-3 non déployé → pas d'historique
      return slaRow(t, versions, this.slaHours);
    }));
    this.objects = this.rows;
    return this.rows;
  }

  isEmpty() { return this.rows.length === 0; }

  renderContent() {
    const breached = this.rows.filter((r) => r.breached).length;
    return html`
      <div class="head">
        <h2>SLA des interventions</h2>
        <span class="badge ${breached ? 'sev-CRITICAL' : 'st-ok'}">${breached} SLA dépassé${breached > 1 ? 's' : ''}</span>
        <span class="fresh">seuil : ${this.slaHours} h</span>
      </div>
      <table>
        <thead><tr><th>Ticket</th><th>Bâtiment</th><th>Statut</th><th>Créé</th><th>Résolution</th><th>SLA</th></tr></thead>
        <tbody>
          ${this.rows.map(({ ticket, delay, status, breached: b, open }) => html`<tr>
            <td>${field(ticket, 'title') ?? field(ticket, '@id')}</td>
            <td>${field(ticket, 'building_id') ?? '—'}</td>
            <td><span class="badge st-${status}">${status || '—'}</span></td>
            <td>${field(ticket, 'created_at') ?? '—'}</td>
            <td>${fmtHours(delay)}</td>
            <td>${b ? html`<span class="badge sev-CRITICAL">dépassé</span>` : open ? html`<span class="badge st-IN_PROGRESS">en cours</span>` : html`<span class="badge st-ok">ok</span>`}</td>
          </tr>`)}
        </tbody>
      </table>
    `;
  }
}

customElements.define('sla-view', SlaView);
