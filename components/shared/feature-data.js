// feature-data.js — accès aux données des features du catalogue.
//
// DÉCISION LDP-ONLY : toutes les lectures passent par des **conteneurs LDP publiés**
// (GET via fetchAuthn, session OIDC + ACL/RLS côté FAP-LDP). Le proxy
// POST /app/query (chantier O-1) est SUPPRIMÉ : les matviews gold sont toutes
// publiées en conteneurs LDP (décision G §13.3 révisée — cas d'usage sans requête
// volumineuse) et le fenêtrage from/to est fait **côté client** (filterWindow).
// Le data plane /dsp/data (HMAC) reste réservé aux consommateurs externes
// serveur-à-serveur — jamais appelé depuis le navigateur (§13.1).
import appStore from '@facis/app-store/components/shared/app-store-api.js';
import { get, configDefaults } from '@facis/app-store/components/shared/logic.js';
import { getJson, resolveMembers } from '@facis/app-store/components/boilerplate/index.js';

// Mapping asset → conteneur LDP publié (étendre 104_gold_ldp_published.sql / asset_mapping).
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

// Lecture d'un champ JSON-LD quel que soit le préfixe (table:champ, ns:champ, champ).
export { get as field };

/** Config effective d'une feature = defaults du config_schema fusionnés avec prefs.<slug>.config. */
export function getFeatureConfig(slug) {
  const feature = appStore.getFeature(slug);
  const schema = feature ? get(feature, 'config_schema') : null;
  const stored = appStore.getPrefs()?.[slug]?.config ?? {};
  return { ...configDefaults(schema), ...stored };
}

/** Champ timestamp d'une ligne gold (hour | ts | timestamp | event_timestamp | day). */
export function tsOf(row) {
  return get(row, 'hour') ?? get(row, 'ts') ?? get(row, 'timestamp') ?? get(row, 'event_timestamp') ?? get(row, 'day') ?? null;
}

/** Première colonne définie parmi les alias (schémas réels gold vs noms courts). */
export function pick(row, ...names) {
  for (const n of names) { const v = get(row, n); if (v !== undefined && v !== null) return v; }
  return undefined;
}

/** Fenêtrage client from/to (ISO 8601) sur les lignes d'un conteneur LDP. */
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
 * Charge un asset via son conteneur LDP publié (+ fenêtrage client optionnel).
 * 404 = conteneur non publié → erreur tracée (url = conteneur, hint = CR à livrer).
 */
export async function loadAsset(assetId, { from, to } = {}) {
  const container = ASSETS[assetId];
  if (!container) throw new Error(`asset inconnu du mapping LDP: ${assetId}`);
  let rows;
  try {
    rows = await resolveMembers(await getJson(container));
  } catch (e) {
    if (e.status === 404) {
      e.url = container;
      e.hint = `conteneur LDP non publié : ${container} — livrer la matview gold + son asset_mapping (CR, catalogue §2)`;
    }
    throw e;
  }
  return filterWindow(rows, { from, to });
}

/** Lecture d'un sous-conteneur LDP de versions (CR-3 : /tickets/<pk>/versions/). */
export async function loadVersions(ticketId) {
  return resolveMembers(await getJson(`/tickets/${ticketId}/versions/`));
}

/** Vrai si l'erreur = chantier non livré (conteneur LDP non publié, endpoint LLM CR-5, négociation DSP). */
export function isMissingBackend(e) {
  return e?.status === 404 && typeof e?.url === 'string'
    && (e.url.startsWith('/gold/') || e.url.includes('/app/llm') || e.url.includes('/dsp/'));
}

// ---------------------------------------------------------------- utilitaires
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

/** Frise « fraîcheur » RG-4 (gold 10–20 min). */
export function fmtFreshness(ts) {
  if (!ts) return '—';
  const s = (Date.now() - new Date(ts).getTime()) / 1000;
  if (s < 90) return 'à l’instant';
  if (s < 5400) return `il y a ${Math.round(s / 60)} min`;
  return `il y a ${Math.round(s / 3600)} h`;
}

/** Téléchargement client (rapport CSV/PDF, export réglementaire). */
export function download(filename, content, mime = 'text/csv') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** CSV à partir de lignes objets + colonnes [{key,label}]. */
export function toCsv(rows, cols) {
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = cols.map((c) => esc(c.label ?? c.key)).join(';');
  const body = rows.map((r) => cols.map((c) => esc(r[c.key])).join(';')).join('\n');
  return `${head}\n${body}\n`;
}
