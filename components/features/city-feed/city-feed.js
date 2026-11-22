// <city-feed> — feature `city-events` (catalogue batch 3, route /city).
// City events: LDP container /gold/city_event_hourly/ (matview CR-1 from
// silver.city_event, published as a DSP asset). Config: zone, radius_km.
// Depends on CR-1 (LDP publication).
import { html, css } from 'lit';
import { FeatureComponent } from '../../shared/feature-base.js';
import { loadAsset, getFeatureConfig, isoDaysAgo, pick } from '../../shared/feature-data.js';

/** Zone filter (equality on the zone/city field); radius_km is informational (no client-side geometry in v1). */
export function filterEvents(rows, { zone } = {}) {
  if (!zone) return rows ?? [];
  return (rows ?? []).filter((r) => String(pick(r, 'zone_id', 'zone', 'city') ?? '') === String(zone));
}

export class CityFeed extends FeatureComponent {
  static properties = {
    ...FeatureComponent.properties,
    events: { type: Array, attribute: false },
  };

  constructor() {
    super();
    this.events = [];
  }

  async load() {
    const config = getFeatureConfig('city-events');
    const rows = await loadAsset('city_event_hourly', { from: isoDaysAgo(30) }); // no `to` bound: an event feed also shows upcoming events
    this.events = filterEvents(rows, config);
    this.objects = this.events;
    return this.events;
  }

  isEmpty() { return this.events.length === 0; }

  renderContent() {
    return html`
      <h2 style="margin:0 0 10px;font-size:1.05rem">City events</h2>
      ${this.events.length === 0
        ? html`<div class="empty">No event (check the zone, CR-1).</div>`
        : html`<table>
            <thead><tr><th>Start</th><th>Name</th><th>Zone</th><th>Type</th></tr></thead>
            <tbody>${this.events.map((e) => html`<tr>
              <td>${pick(e, 'event_timestamp', 'hour', 'start') ?? '—'}</td>
              <td>${pick(e, 'event_type', 'type') ?? '—'}</td>
              <td>${pick(e, 'zone_id', 'zone') ?? '—'}</td>
              <td><span class="badge sev-${String(pick(e, 'severity') ?? '').toUpperCase() || 'LOW'}">${pick(e, 'severity') ?? '—'}</span></td>
            </tr>`)}</tbody>
          </table>`}
    `;
  }
}

customElements.define('city-feed', CityFeed);
