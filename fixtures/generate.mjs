// generate.mjs — demo fixture generator for the 12 feature components.
// Consistent business data over N days (default 30): a 5-building fleet in Lyon,
// consumption curves by occupancy profile + degree-days, PV production (solar
// bell × weather), peak/off-peak prices, hourly weather, city events, correlated anomalies,
// daily cost, annual consumption, tickets with version history (SLA), feature
// catalogue + prefs.
// Usage: node fixtures/generate.mjs [--days 30]   → rewrites fixtures/data.js (export default)
// Importable as a module: export generateFixtures({days, end}) (tests).
import { writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

// Deterministic PRNG (fixed seed) → reproducible fixtures.
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BUILDINGS = [
  { id: 1, name: 'HQ — 12 Lilas Street', address: '12 Lilas Street, 69003 Lyon', meter_id: 'M-LYO-001', area_m2: 4200, lat: 45.7640, lon: 4.8357, profile: 'bureaux', pv_kw: 60 },
  { id: 2, name: 'North warehouse', address: '8 North Zone, 69007 Lyon', meter_id: 'M-LYO-002', area_m2: 9800, lat: 45.7840, lon: 4.8200, profile: 'entrepot', pv_kw: 0 },
  { id: 3, name: 'Municipal pool', address: '3 South Ave., 69002 Lyon', meter_id: 'M-LYO-003', area_m2: 1800, lat: 45.7540, lon: 4.8450, profile: 'piscine', pv_kw: 25 },
  { id: 4, name: 'Jean Moulin high school', address: '17 East Quay, 69006 Lyon', meter_id: 'M-LYO-004', area_m2: 7600, lat: 45.7740, lon: 4.8600, profile: 'lycee', pv_kw: 80 },
  { id: 5, name: 'Annex city hall', address: '5 Republic Square, 69001 Lyon', meter_id: 'M-LYO-005', area_m2: 2300, lat: 45.7672, lon: 4.8340, profile: 'mairie', pv_kw: 15 },
];

// Occupancy profiles: base/peak kW, hourly range, weekend factor, heating sensitivity (DD).
const PROFILES = {
  bureaux:  { base: 40,  peak: 160, hours: [8, 19],  weekend: 0.30, dj: 0.8 },
  entrepot: { base: 120, peak: 200, hours: [0, 24],  weekend: 0.90, dj: 0.3 },
  piscine:  { base: 80,  peak: 150, hours: [6, 22],  weekend: 0.80, dj: 1.5 },
  lycee:    { base: 20,  peak: 140, hours: [8, 17],  weekend: 0.05, dj: 1.0 },
  mairie:   { base: 25,  peak: 90,   hours: [8, 18],  weekend: 0.10, dj: 1.0 },
};
// Reference annual intensity (kWh/m²/yr) per profile — for annual_site_consumption.
const INTENSITY = { bureaux: 180, entrepot: 90, piscine: 450, lycee: 95, mairie: 120 };

function weatherTempAt(d, rnd) {
  const doy = Math.floor((d - new Date(d.getUTCFullYear(), 0, 0)) / 86400e3);
  const seasonal = 9 + 3.5 * Math.sin(((doy - 80) / 365) * 2 * Math.PI); // ~6 °C mid-November
  const hourly = 2 * Math.sin(((d.getUTCHours() - 14) / 24) * 2 * Math.PI);  // max at 2 pm
  return seasonal + hourly + (rnd() - 0.5) * 3;
}

function consumptionKw(b, d, temp, rnd) {
  const p = PROFILES[b.profile];
  const dow = d.getUTCDay();
  const weekend = dow === 0 || dow === 6;
  const h = d.getUTCHours();
  const span = p.hours[1] - p.hours[0] || 1;
  const inHours = h >= p.hours[0] && h < p.hours[1];
  const shape = inHours ? 0.6 + 0.4 * Math.sin((Math.PI * (h - p.hours[0])) / span) : 0.15;
  const dj = Math.max(0, 18 - temp);
  const heat = 1 + p.dj * dj * 0.03;
  const kw = (p.base + (p.peak - p.base) * shape) * (weekend ? p.weekend : 1) * heat;
  return Math.max(0, kw * (1 + (rnd() - 0.5) * 0.08));
}

function pvKw(b, d, cloud) {
  if (!b.pv_kw) return 0;
  const h = d.getUTCHours();
  if (h < 6 || h > 20) return 0;
  const bell = Math.max(0, Math.sin((Math.PI * (h - 6)) / 14));
  return b.pv_kw * bell * (1 - 0.7 * cloud);
}

function priceEurKwh(d, rnd) {
  const h = d.getUTCHours();
  const weekend = d.getUTCDay() === 0 || d.getUTCDay() === 6;
  let p = (h >= 23 || h < 7) ? 0.1299 : 0.1874;           // off-peak night / on-peak day
  if ([7, 8, 18, 19, 20].includes(h)) p *= 1.35;            // morning/evening peaks
  if (weekend) p *= 0.9;
  return Math.round(p * (1 + (rnd() - 0.5) * 0.04) * 10000) / 10000;
}

// Actual silver.city_event schema: event_timestamp, zone_id, type, event_type (Avro enum), severity (int).
const CITY_EVENTS = [
  { event_timestamp: '2026-11-22T07:00:00Z', zone_id: 'centre', type: 'city_event', event_type: 'EVENT', severity: 1 },     // Lyon marathon
  { event_timestamp: '2026-11-23T08:00:00Z', zone_id: 'centre', type: 'city_event', event_type: 'EVENT', severity: 1 },     // Christmas market
  { event_timestamp: '2026-11-24T06:00:00Z', zone_id: 'est',    type: 'city_event', event_type: 'EMERGENCY', severity: 3 },  // Road works
  { event_timestamp: '2026-11-27T19:30:00Z', zone_id: 'ouest',  type: 'city_event', event_type: 'EVENT', severity: 2 },     // Concert
  { event_timestamp: '2026-11-28T09:00:00Z', zone_id: 'nord',   type: 'city_event', event_type: 'ACCIDENT', severity: 3 },  // Eurexpo accident
];

// Anomalies correlated with the profiles (detected by the FAP, read in gold).
// Actual gold.anomaly_candidates schema: event_timestamp, site_id, meter_id, active_power_kw, z_score, severity ('high'|'medium').
const ANOMALIES = [
  { event_timestamp: '2026-11-19T02:10:00Z', site_id: 'M-LYO-002', meter_id: 'M-LYO-002', active_power_kw: 280, z_score: 4.2, severity: 'high' },   // warehouse: ventilation blocked at night
  { event_timestamp: '2026-11-19T13:40:00Z', site_id: 'M-LYO-004', meter_id: 'M-LYO-004', active_power_kw: 0,   z_score: -3.1, severity: 'high' },  // high school: power outage at 2 pm
  { event_timestamp: '2026-11-19T18:30:00Z', site_id: 'M-LYO-001', meter_id: 'M-LYO-001', active_power_kw: 220, z_score: 3.8, severity: 'high' },   // HQ: evening peak (180 kW threshold exceeded)
  { event_timestamp: '2026-11-20T09:15:00Z', site_id: 'M-LYO-003', meter_id: 'M-LYO-003', active_power_kw: 130, z_score: 2.4, severity: 'medium' }, // pool: filter drift
  { event_timestamp: '2026-11-20T19:05:00Z', site_id: 'M-LYO-005', meter_id: 'M-LYO-005', active_power_kw: 120, z_score: 2.2, severity: 'medium' }, // city hall: evening peak
];

// Tickets with version history → mix of SLA ok / breached (sla_hours = 24).
const TICKETS = [
  { id: 3, title: 'Consumption peak — HQ', building: 1, anomaly: 'M-LYO-001', status: 'RESOLVED', priority: 'CRITICAL', created: '2026-11-19T18:35:00Z', resolved: '2026-11-21T00:35:00Z' }, // 30 h → SLA breached
  { id: 4, title: 'Power outage — Jean Moulin high school', building: 4, anomaly: 'M-LYO-004', status: 'IN_PROGRESS', priority: 'CRITICAL', created: '2026-11-19T13:45:00Z' },
  { id: 5, title: 'Blocked ventilation — North warehouse', building: 2, anomaly: 'M-LYO-002', status: 'OPEN', priority: 'HIGH', created: '2026-11-19T02:15:00Z' },
  { id: 6, title: 'Filter drift — Municipal pool', building: 3, anomaly: 'M-LYO-003', status: 'RESOLVED', priority: 'MEDIUM', created: '2026-11-20T09:20:00Z', resolved: '2026-11-20T17:20:00Z' }, // 8 h → ok
  { id: 7, title: 'Evening peak — Annex city hall', building: 5, anomaly: 'M-LYO-005', status: 'RESOLVED', priority: 'MEDIUM', created: '2026-11-20T19:10:00Z', resolved: '2026-11-21T02:10:00Z' }, // 7 h → ok
  { id: 8, title: 'Drift monitoring — HQ', building: 1, anomaly: null, status: 'CLOSED', priority: 'LOW', created: '2026-11-18T08:00:00Z', resolved: '2026-11-18T13:00:00Z' }, // 5 h → ok
];

// Catalogue entries carry BOTH locales: en (default) + fr (locale).
function featureRes(slug, { title, desc, icon, order, role, comp, route, schema }) {
  return {
    '@id': `/features/${slug}`, slug, title_i18n: title, description_i18n: desc,
    icon, menu_order: order, role_min: role, component: comp, route,
    config_schema: { fields: schema }, default_enabled: false,
  };
}

// Row layout: [slug, title {en, fr}, description {en, fr}, icon, order, role, component, route, schema]
const BASE_FEATURES = [
  ['dashboard', { en: 'Dashboard', fr: 'Tableau de bord' }, { en: 'Fleet map and energy summary.', fr: 'Carte du parc et synthèse énergie.' }, 'map', 0, 'manager', 'building-map', '/', []],
  ['anomalies', { en: 'Anomalies', fr: 'Anomalies' }, { en: 'Anomalies detected by the FAP.', fr: 'Anomalies détectées par la FAP.' }, 'warning', 1, 'manager', 'anomaly-list', '/anomalies', []],
  ['tickets', { en: 'Tickets', fr: 'Tickets' }, { en: 'Interventions and their tracking.', fr: 'Interventions et leur suivi.' }, 'confirmation_number', 2, 'manager', 'ticket-board', '/tickets', []],
  ['interventions', { en: 'My interventions', fr: 'Mes interventions' }, { en: 'Assigned tickets (technician).', fr: 'Tickets assignés (technicien).' }, 'assignment', 3, 'technician', 'ticket-board', '/interventions', []],
  ['building-detail', { en: 'Building detail', fr: 'Détail bâtiment' }, { en: 'Consumption/PV curves.', fr: 'Courbes de conso/PV.' }, 'insights', 4, 'manager', 'energy-chart', '/buildings/:id', []],
  ['store', { en: 'App store', fr: 'App store' }, { en: 'Enable and configure features.', fr: 'Activer / configurer les fonctionnalités.' }, 'storefront', 8, 'all', 'app-store', '/store', []],
  ['admin', { en: 'Administration', fr: 'Administration' }, { en: 'Users, roles, catalogue.', fr: 'Utilisateurs, rôles, catalogue.' }, 'admin_panel_settings', 9, 'admin', 'user-admin', '/admin', []],
];
const EXT_FEATURES = [
  ['alert-rules', { en: 'Custom alerts', fr: 'Alertes personnalisées' }, { en: 'Consumption/cost thresholds per building.', fr: 'Seuils de conso/coût par bâtiment.' }, 'notifications', 10, 'manager', 'alert-list', '/alerts', [{ key: 'thresholds', label: 'Thresholds per building', type: 'object' }]],
  ['sla-dashboard', { en: 'Intervention SLA', fr: 'SLA des interventions' }, { en: 'Creation → resolution delay vs threshold.', fr: 'Délai création → résolution vs seuil.' }, 'schedule', 11, 'manager', 'sla-view', '/sla', [{ key: 'sla_hours', label: 'SLA threshold (h)', type: 'number', default: 24 }]],
  ['report-builder', { en: 'PDF/CSV reports', fr: 'Rapports PDF/CSV' }, { en: 'Downloadable consumption/cost report.', fr: 'Rapport conso/coût téléchargeable.' }, 'description', 12, 'manager', 'report-form', '/reports', [
    { key: 'period', label: 'Period', type: 'enum', options: ['day', 'week', 'month', 'year'], default: 'month' },
    { key: 'building', label: 'Building', type: 'string' },
    { key: 'format', label: 'Format', type: 'enum', options: ['csv', 'pdf'], default: 'csv' }]],
  ['budget-tracker', { en: 'Monthly energy budget', fr: 'Budget énergétique mensuel' }, { en: 'Actual consumption vs kWh/€ budget.', fr: 'Conso réelle vs budget kWh/€.' }, 'account_balance', 20, 'manager', 'budget-gauge', '/budget', [
    { key: 'budget_kwh', label: 'Budget kWh', type: 'number' }, { key: 'budget_eur', label: 'Budget €', type: 'number' },
    { key: 'alert_pct', label: 'Alert at %', type: 'number', default: 80 }]],
  ['price-optimizer', { en: 'Load shifting (off-peak hours)', fr: 'Décalage de conso (heures creuses)' }, { en: 'Cheapest slots.', fr: 'Créneaux les moins chers.' }, 'swap_horiz', 21, 'manager', 'shift-advisor', '/optimize', [
    { key: 'shiftable_kwh', label: 'Shiftable kWh', type: 'number' },
    { key: 'window', label: 'Window', type: 'string', default: '01:00-06:00' }]],
  ['pv-selfconsumption', { en: 'PV self-consumption', fr: 'Autoconsommation PV' }, { en: 'Self-consumption rate (+ battery).', fr: 'Taux d’autoconsommation (+ batterie).' }, 'solar_power', 22, 'manager', 'pv-gauge', '/pv', [
    { key: 'battery_kwh', label: 'Battery kWh', type: 'number', default: 0 }]],
  ['benchmark', { en: 'Building comparison', fr: 'Comparaison des bâtiments' }, { en: 'kWh/m² or €/m² per building.', fr: 'kWh/m² ou €/m² par bâtiment.' }, 'bar_chart', 23, 'manager', 'benchmark-view', '/benchmark', [
    { key: 'metric', label: 'Metric', type: 'enum', options: ['kwh_m2', 'eur_m2'], default: 'kwh_m2' },
    { key: 'period', label: 'Period', type: 'enum', options: ['month', 'year'], default: 'month' },
    { key: 'ref_building', label: 'Reference building', type: 'string' }]],
  ['regulatory-export', { en: 'Regulatory export', fr: 'Export réglementaire' }, { en: 'Annual CSV/JSON per site (tertiary decree).', fr: 'CSV/JSON annuel par site (décret tertiaire).' }, 'gavel', 24, 'manager', 'regulatory-export', '/regulatory', [
    { key: 'year', label: 'Year', type: 'number' }, { key: 'format', label: 'Format', type: 'enum', options: ['csv', 'json'], default: 'csv' }]],
  ['weather-correlation', { en: 'Weather & degree-days', fr: 'Météo & degré-jours' }, { en: 'Temperature and degree-days base 18 °C.', fr: 'Température et DJ base 18 °C.' }, 'cloud', 30, 'manager', 'weather-chart', '/weather', [
    { key: 'station', label: 'Station', type: 'string' }, { key: 'period', label: 'Period', type: 'enum', options: ['7d', '30d', '90d'], default: '30d' }]],
  ['city-events', { en: 'City events', fr: 'Événements ville' }, { en: 'Events near the fleet.', fr: 'Événements à proximité du parc.' }, 'location_city', 31, 'manager', 'city-feed', '/city', [
    { key: 'zone', label: 'Zone', type: 'string' }, { key: 'radius_km', label: 'Radius (km)', type: 'number' }]],
  ['ai-assistant', { en: 'AI assistant', fr: 'Assistant IA' }, { en: 'Questions about the data (bounded scope).', fr: 'Questions sur les données (périmètre borné).' }, 'smart_toy', 32, 'manager', 'ai-chat', '/assistant', [
    { key: 'assets', label: 'Allowed assets', type: 'array', items: 'string' }, { key: 'model', label: 'Model', type: 'string' }]],
  ['data-sharing', { en: 'Data sharing', fr: 'Partage de données' }, { en: 'DSP contracts (admin).', fr: 'Contrats DSP (admin).' }, 'share', 33, 'admin', 'share-manager', '/sharing', [
    { key: 'asset', label: 'Asset', type: 'string' }, { key: 'consumer_did', label: 'Consumer DID', type: 'string' },
    { key: 'duration_days', label: 'Duration (days)', type: 'number' }]],
];

const PREFS = {
  'alert-rules': { enabled: true, config: { thresholds: { '1': { kW: 180, eur_day: 800 }, '2': { kW: 260, eur_day: 1000 }, '3': { kW: 150, eur_day: 500 }, '4': { kW: 150, eur_day: 400 }, '5': { kW: 110, eur_day: 250 } } } },
  'sla-dashboard': { enabled: true, config: { sla_hours: 24 } },
  'report-builder': { enabled: true, config: { period: 'month', format: 'csv' } },
  'budget-tracker': { enabled: true, config: { budget_kwh: 300000, budget_eur: 55000, alert_pct: 80 } },
  'price-optimizer': { enabled: true, config: { shiftable_kwh: 120, window: '01:00-06:00' } },
  'pv-selfconsumption': { enabled: true, config: { battery_kwh: 40 } },
  'benchmark': { enabled: true, config: { metric: 'kwh_m2', period: 'month', ref_building: 'M-LYO-001' } },
  'regulatory-export': { enabled: true, config: { year: 2025, format: 'csv' } },
  'weather-correlation': { enabled: true, config: { station: 'LYON-BRON', period: '30d' } },
  'city-events': { enabled: true, config: { zone: 'centre', radius_km: 5 } },
  'ai-assistant': { enabled: true, config: { assets: ['net_grid_hourly', 'energy_cost_daily'], model: 'mistral-small' } },
  'data-sharing': { enabled: true, config: { asset: 'dataset:facis:net-grid-hourly' } },
};

export function generateFixtures({ days = 30, end = new Date() } = {}) {
  const rnd = mulberry32(20261120);
  const containers = {};
  const resources = {};
  const endH = new Date(Math.floor(end.getTime() / 3600e3) * 3600e3);
  const start = new Date(endH.getTime() - days * 86400e3);

  // --- hourly series -----------------------------------------------------
  const netRows = [], pvRows = [], priceRows = [], weatherRows = [];
  const costByDay = new Map(); // `${day}|${site}` → {kwh, cost}
  for (let t = new Date(start); t <= endH; t = new Date(t.getTime() + 3600e3)) {
    const ts = t.toISOString();
    const temp = weatherTempAt(t, rnd);
    const cloud = Math.round((0.2 + rnd() * 0.8) * 100) / 100;
    weatherRows.push([ts, 'LYON-BRON', Math.round(temp * 10) / 10, Math.round(cloud * 100)]);
    const price = priceEurKwh(t, rnd);
    priceRows.push([ts, 'ALL', price]);
    for (const b of BUILDINGS) {
      const pv = pvKw(b, t, cloud);
      const consumption = consumptionKw(b, t, temp, rnd);
      const net = Math.round((consumption - pv) * 10) / 10;
      netRows.push([ts, b.meter_id, net, Math.round(consumption)]);
      if (pv > 0) pvRows.push([ts, b.meter_id, Math.round(pv * 10) / 10, Math.round((pv / b.pv_kw) * 1000) / 1000]);
      const day = ts.slice(0, 10);
      const k = `${day}|${b.meter_id}`;
      if (!costByDay.has(k)) costByDay.set(k, { kwh: 0, cost: 0 });
      const acc = costByDay.get(k);
      acc.kwh += Math.max(0, net);
      acc.cost += Math.max(0, net) * price;
    }
  }
  containers['/gold/net_grid_hourly/'] = { columns: ['hour', 'site_id', 'net_grid_kw', 'total_consumption_kw'], rows: netRows };
  containers['/gold/pv_performance_hourly/'] = { columns: ['hour', 'site_id', 'pv_generation_kw', 'capacity_factor'], rows: pvRows };
  containers['/gold/price_hourly/'] = { columns: ['hour', 'site_id', 'price_eur_kwh'], rows: priceRows };
  containers['/gold/weather_hourly/'] = { columns: ['hour', 'site_id', 'temperature_c', 'cloud_cover_pct'], rows: weatherRows };
  containers['/gold/city_event_hourly/'] = { columns: ['event_timestamp', 'zone_id', 'type', 'event_type', 'severity'], rows: CITY_EVENTS.map((e) => [e.event_timestamp, e.zone_id, e.type, e.event_type, e.severity]) };
  containers['/gold/energy_cost_daily/'] = {
    columns: ['day', 'site_id', 'consumption_kwh', 'total_cost_eur'],
    rows: [...costByDay.entries()].map(([k, v]) => { const [day, site] = k.split('|'); return [day, site, Math.round(v.kwh), Math.round(v.cost * 100) / 100]; }),
  };
  containers['/gold/anomaly_candidates/'] = {
    columns: ['event_timestamp', 'site_id', 'meter_id', 'active_power_kw', 'z_score', 'severity'],
    rows: ANOMALIES.map((a) => [a.event_timestamp, a.site_id, a.meter_id, a.active_power_kw, a.z_score, a.severity]),
  };
  // annual consumption 2024/2025 (intensity per profile × area ± noise)
  const annual = [];
  for (const b of BUILDINGS) {
    for (const year of [2024, 2025]) {
      const kwh = Math.round(b.area_m2 * INTENSITY[b.profile] * (year === 2025 ? 0.94 : 1) * (1 + (rnd() - 0.5) * 0.1));
      annual.push([year, b.meter_id, kwh, Math.round(kwh * 0.19 * 100) / 100]);
    }
  }
  containers['/gold/annual_site_consumption/'] = { columns: ['year', 'site_id', 'consumption_kwh', 'total_cost_eur'], rows: annual };

  // --- app.* ----------------------------------------------------------------
  containers['/buildings/'] = { columns: ['id', 'name', 'address', 'meter_id', 'area_m2', 'lat', 'lon'], rows: BUILDINGS.map((b) => [b.id, b.name, b.address, b.meter_id, b.area_m2, b.lat, b.lon]) };
  const ticketRows = [];
  const versionContainers = {};
  for (const t of TICKETS) {
    ticketRows.push([t.id, t.title, t.status, t.priority, t.building, t.anomaly, t.created, t.resolved ?? null]);
    const vers = [{ version: 1, status: 'OPEN', changed_at: t.created }];
    if (t.status !== 'OPEN') vers.push({ version: 2, status: 'IN_PROGRESS', changed_at: new Date(new Date(t.created).getTime() + 2 * 3600e3).toISOString() });
    if (t.resolved) vers.push({ version: 3, status: 'RESOLVED', changed_at: t.resolved });
    if (t.status === 'CLOSED') vers.push({ version: 4, status: 'CLOSED', changed_at: new Date(new Date(t.resolved).getTime() + 3600e3).toISOString() });
    versionContainers[`/tickets/${t.id}/versions/`] = { columns: ['version', 'status', 'changed_at'], rows: vers.map((v) => [v.version, v.status, v.changed_at]) };
  }
  containers['/tickets/'] = { columns: ['id', 'title', 'status', 'priority', 'building_id', 'anomaly_ref', 'created_at', 'resolved_at'], rows: ticketRows };
  Object.assign(containers, versionContainers);

  // --- app store: catalogue + prefs ---------------------------------------
  const featureSlugs = [];
  for (const [slug, title, desc, icon, order, role, comp, route, schema] of [...BASE_FEATURES.map((f) => [...f, f[8] ?? []]), ...EXT_FEATURES]) {
    featureSlugs.push({ '@id': `/features/${slug}` });
    resources[`/features/${slug}`] = featureRes(slug, { title, desc, icon, order, role, comp, route, schema });
  }
  containers['/features/'] = { columns: null, rows: featureSlugs };
  // base features enabled by default
  const baseOn = Object.fromEntries(BASE_FEATURES.map(([s]) => [s, { enabled: true, config: {} }]));
  resources['/prefs/7'] = { '@id': '/prefs/7', prefs: { ...baseOn, ...PREFS } };

  // --- misc ---------------------------------------------------------------
  resources['/dsp/catalogue'] = { dataset: [
    { id: 'dataset:facis:net-grid-hourly', title: 'Hourly grid consumption per site' },
    { id: 'dataset:facis:energy-balance-hourly', title: 'Hourly energy balance' },
    { id: 'dataset:facis:anomaly-candidates', title: 'Detected anomalies' },
    { id: 'dataset:facis:weather-hourly', title: 'Hourly weather' },
    { id: 'dataset:facis:event-impact-daily', title: 'Event impact (daily)' },
    { id: 'dataset:facis:streetlight-zone-hourly', title: 'Street lighting by zone' },
  ] };
  resources['/app/llm'] = { answer: 'Over the last 7 days, fleet consumption is down 6 % (milder weather: −18 DD). The 19/11 6 pm peak at HQ (220 kW) exceeds your 180 kW threshold: ticket #3, resolved in 30 h (24 h SLA breached).' };
  resources['/dsp/contracts/request'] = { id: 'contract:demo-1', status: 'PENDING' };

  return { generated_at: new Date().toISOString(), end: end.toISOString(), days, resources, containers };
}

// CLI: node fixtures/generate.mjs [--days 30] → rewrites fixtures/data.js
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const daysArg = process.argv.indexOf('--days');
  const days = daysArg > -1 ? Number(process.argv[daysArg + 1]) : 30;
  const data = generateFixtures({ days });
  const out = join(dirname(fileURLToPath(import.meta.url)), 'data.js');
  writeFileSync(out, `// Generated by fixtures/generate.mjs — do not edit by hand.\n// ${data.days} days, end = ${data.end}\nexport default ${JSON.stringify(data)};\n`);
  consumptionle.log(`fixtures written: ${out} (${(JSON.stringify(data).length / 1024).toFixed(0)} KB, ${data.containers['/gold/net_grid_hourly/'].rows.length} net_grid rows)`);
}
