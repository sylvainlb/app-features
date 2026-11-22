// feature-data.js — data access for the catalogue features.
//
// LDP-ONLY DECISION: all reads go through **published LDP containers**
// (GET via fetchAuthn, OIDC session + ACL/RLS on the FAP-LDP side). The
// POST /app/query proxy (work item O-1) is REMOVED: all gold matviews are
// published as LDP containers (decision G §13.3 revised — use cases without
// voluminous queries) and the from/to windowing is done **client-side** (filterWindow).
// The /dsp/data data plane (HMAC) remains reserved for external
// server-to-server consumers — never called from the browser (§13.1).
import appStore from '@facis/app-store/components/shared/app-store-api.js';
import { get, configDefaults } from '@facis/app-store/components/shared/logic.js';
import { getJson, resolveMembers } from '@facis/app-store/components/boilerplate/index.js';

// Asset → published LDP container mapping (extend 104_gold_ldp_published.sql / asset_mapping).
export const ASSETS = {
  anomaly_candidates:      '/gold/anomaly_candidates/',
  city_dashboard_summary:  '/gold/city_dashboard_summary/',
  energy_cost_daily:       '/gold/energy_cost_daily/',
  net_grid_hourly:         '/gold/net_grid_hourly/',
  pv_performance_hourly:   '/gold/pv_performance_hourly/',
  weather_hourly:          '/gold/weather_hourly/',
  price_hourly:            '/gold/price_hourly/',             // CR-1
  city_event_hourly:       '/gold/city_event_hourly/',        // CR-1
  annual_site_consumption: '/gold/annual_site_consumption/',  // CR-4
  buildings:               '/buildings/',
  tickets:                 '/tickets/',
};

// Read a JSON-LD field regardless of prefix (table:field, ns:field, field).
export { get as field };

/** Effective config of a feature = config_schema defaults merged with prefs.<slug>.config. */
export function getFeatureConfig(slug) {
  const feature = appStore.getFeature(slug);
  const schema = feature ? get(feature, 'config_schema') : null;
  const stored = appStore.getPrefs()?.[slug]?.config ?? {};
  return { ...configDefaults(schema), ...stored };
}

/** Timestamp field of a gold row (hour | ts | timestamp | event_timestamp | day). */
export function tsOf(row) {
  return get(row, 'hour') ?? get(row, 'ts') ?? get(row, 'timestamp') ?? get(row, 'event_timestamp') ?? get(row, 'day') ?? null;
}

/** First defined column among the aliases (actual gold schemas vs short names). */
export function pick(row, ...names) {
  for (const n of names) { const v = get(row, n); if (v !== undefined && v !== null) return v; }
  return undefined;
}

/** Client-side from/to windowing (ISO 8601) on the rows of an LDP container. */
export function filterWindow(rows, { from, to } = {}) {
  if (!from && !to) return rows ?? [];
  return (rows ?? []).filter((r) => {
    const ts = tsOf(r);
    if (!ts) return true;
    const s = String(ts);
    if (from && s < String(from).slice(0, s.length)) return false;
    if (to && s > String(to).slice(0, s.length)) return false;
    return true;
  });
}

/**
 * Load an asset via its published LDP container (+ optional client-side windowing).
 * 404 = container not published → traced error (url = container, hint = CR to deliver).
 */
export async function loadAsset(assetId, { from, to } = {}) {
  const container = ASSETS[assetId];
  if (!container) throw new Error(`asset unknown to the LDP mapping: ${assetId}`);
  let rows;
  try {
    rows = await resolveMembers(await getJson(container));
  } catch (e) {
    if (e.status === 404) {
      e.url = container;
      e.hint = `LDP container not published: ${container} — deliver the gold matview + its asset_mapping (CR, catalogue §2)`;
    }
    throw e;
  }
  return filterWindow(rows, { from, to });
}

/** Read a versions sub-container LDP (CR-3: /tickets/<pk>/versions/). */
export async function loadVersions(ticketId) {
  return resolveMembers(await getJson(`/tickets/${ticketId}/versions/`));
}

/** True if the error = undelivered work item (LDP container not published, LLM endpoint CR-5, DSP negotiation). */
export function isMissingBackend(e) {
  return e?.status === 404 && typeof e?.url === 'string'
    && (e.url.startsWith('/gold/') || e.url.includes('/app/llm') || e.url.includes('/dsp/'));
}

// ---------------------------------------------------------------- utilities
export function isoDaysAgo(n, from = new Date()) {
  return new Date(from.getTime() - n * 86400e3).toISOString();
}

export function monthBounds(now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  return { from: start.toISOString(), to: now.toISOString() };
}

export function fmtKwh(v) {
  if (v == null || Number.isNaN(Number(v))) return '—';
  const n = Number(v);
  return Math.abs(n) >= 10000 ? `${(n / 1000).toFixed(1)} MWh` : `${n.toFixed(1)} kWh`;
}

export function fmtEur(v) {
  if (v == null || Number.isNaN(Number(v))) return '—';
  return `${Number(v).toFixed(2)} €`;
}

export function fmtHours(h) {
  if (h == null || Number.isNaN(Number(h))) return '—';
  return `${Number(h).toFixed(1)} h`;
}

/** "Freshness" timeline RG-4 (gold 10–20 min). */
export function fmtFreshness(ts) {
  if (!ts) return '—';
  const s = (Date.now() - new Date(ts).getTime()) / 1000;
  if (s < 90) return 'just now';
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  return `${Math.round(s / 3600)} h ago`;
}

/** Client-side download (CSV/PDF report, regulatory export). */
export function download(filename, content, mime = 'text/csv') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** CSV from object rows + columns [{key,label}]. */
export function toCsv(rows, cols) {
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = cols.map((c) => esc(c.label ?? c.key)).join(';');
  const body = rows.map((r) => cols.map((c) => esc(r[c.key])).join(';')).join('\n');
  return `${head}\n${body}\n`;
}
