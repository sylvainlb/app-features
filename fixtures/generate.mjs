// generate.mjs — générateur de fixtures de démo pour les 12 composants features.
// Données business cohérentes sur N jours (défaut 30) : parc de 5 bâtiments à Lyon,
// courbes de conso selon le profil d'occupation + degré-jours, production PV (cloche
// solaire × météo), prix HP/HC, météo horaire, événements ville, anomalies corrélées,
// coût journalier, conso annuelle, tickets avec historique de versions (SLA), catalogue
// des features + prefs.
// Usage : node fixtures/generate.mjs [--days 30]   → réécrit fixtures/data.js (export default)
// Importable en module : export generateFixtures({days, end}) (tests).
import { writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

// PRNG déterministe (seed fixe) → fixtures reproductibles.
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BUILDINGS = [
  { id: 1, name: 'Siège — 12 rue des Lilas', address: '12 rue des Lilas, 69003 Lyon', meter_id: 'M-LYO-001', area_m2: 4200, lat: 45.7640, lon: 4.8357, profile: 'bureaux', pv_kw: 60 },
  { id: 2, name: 'Entrepôt Nord', address: '8 zone Nord, 69007 Lyon', meter_id: 'M-LYO-002', area_m2: 9800, lat: 45.7840, lon: 4.8200, profile: 'entrepot', pv_kw: 0 },
  { id: 3, name: 'Piscine municipale', address: '3 av. du Sud, 69002 Lyon', meter_id: 'M-LYO-003', area_m2: 1800, lat: 45.7540, lon: 4.8450, profile: 'piscine', pv_kw: 25 },
  { id: 4, name: 'Lycée Jean Moulin', address: '17 quai Est, 69006 Lyon', meter_id: 'M-LYO-004', area_m2: 7600, lat: 45.7740, lon: 4.8600, profile: 'lycee', pv_kw: 80 },
  { id: 5, name: 'Mairie annexe', address: '5 place de la République, 69001 Lyon', meter_id: 'M-LYO-005', area_m2: 2300, lat: 45.7672, lon: 4.8340, profile: 'mairie', pv_kw: 15 },
];

// Profils d'occupation : base/peak kW, plage horaire, facteur weekend, sensibilité chauffage (DJ).
const PROFILES = {
  bureaux:  { base: 40,  peak: 160, hours: [8, 19],  weekend: 0.30, dj: 0.8 },
  entrepot: { base: 120, peak: 200, hours: [0, 24],  weekend: 0.90, dj: 0.3 },
  piscine:  { base: 80,  peak: 150, hours: [6, 22],  weekend: 0.80, dj: 1.5 },
  lycee:    { base: 20,  peak: 140, hours: [8, 17],  weekend: 0.05, dj: 1.0 },
  mairie:   { base: 25,  peak: 90,   hours: [8, 18],  weekend: 0.10, dj: 1.0 },
};
// Intensité annuelle de référence (kWh/m²/an) par profil — pour annual_site_consumption.
const INTENSITY = { bureaux: 180, entrepot: 90, piscine: 450, lycee: 95, mairie: 120 };

function weatherTempAt(d, rnd) {
  const doy = Math.floor((d - new Date(d.getUTCFullYear(), 0, 0)) / 86400e3);
  const seasonal = 9 + 3.5 * Math.sin(((doy - 80) / 365) * 2 * Math.PI); // ~6 °C mi-novembre
  const hourly = 2 * Math.sin(((d.getUTCHours() - 14) / 24) * 2 * Math.PI);  // max à 14 h
  return seasonal + hourly + (rnd() - 0.5) * 3;
}

function consoKw(b, d, temp, rnd) {
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
  let p = (h >= 23 || h < 7) ? 0.1299 : 0.1874;           // HC nuit / HP jour
  if ([7, 8, 18, 19, 20].includes(h)) p *= 1.35;            // pointes matin/soir
  if (weekend) p *= 0.9;
  return Math.round(p * (1 + (rnd() - 0.5) * 0.04) * 10000) / 10000;
}

// Schéma réel silver.city_event : event_timestamp, zone_id, type, event_type (enum Avro), severity (int).
const CITY_EVENTS = [
  { event_timestamp: '2026-11-22T07:00:00Z', zone_id: 'centre', type: 'city_event', event_type: 'EVENT', severity: 1 },     // Marathon de Lyon
  { event_timestamp: '2026-11-23T08:00:00Z', zone_id: 'centre', type: 'city_event', event_type: 'EVENT', severity: 1 },     // Marché de Noël
  { event_timestamp: '2026-11-24T06:00:00Z', zone_id: 'est',    type: 'city_event', event_type: 'EMERGENCY', severity: 3 },  // Travaux voirie
  { event_timestamp: '2026-11-27T19:30:00Z', zone_id: 'ouest',  type: 'city_event', event_type: 'EVENT', severity: 2 },     // Concert
  { event_timestamp: '2026-11-28T09:00:00Z', zone_id: 'nord',   type: 'city_event', event_type: 'ACCIDENT', severity: 3 },  // Accident Eurexpo
];

// Anomalies corrélées aux profils (détectées par la FAP, lues en gold).
// Schéma réel gold.anomaly_candidates : event_timestamp, site_id, meter_id, active_power_kw, z_score, severity ('high'|'medium').
const ANOMALIES = [
  { event_timestamp: '2026-11-19T02:10:00Z', site_id: 'M-LYO-002', meter_id: 'M-LYO-002', active_power_kw: 280, z_score: 4.2, severity: 'high' },   // entrepôt : ventilation bloquée la nuit
  { event_timestamp: '2026-11-19T13:40:00Z', site_id: 'M-LYO-004', meter_id: 'M-LYO-004', active_power_kw: 0,   z_score: -3.1, severity: 'high' },  // lycée : coupure alim. 14 h
  { event_timestamp: '2026-11-19T18:30:00Z', site_id: 'M-LYO-001', meter_id: 'M-LYO-001', active_power_kw: 220, z_score: 3.8, severity: 'high' },   // siège : pic soirée (seuil 180 kW dépassé)
  { event_timestamp: '2026-11-20T09:15:00Z', site_id: 'M-LYO-003', meter_id: 'M-LYO-003', active_power_kw: 130, z_score: 2.4, severity: 'medium' }, // piscine : dérive filtration
  { event_timestamp: '2026-11-20T19:05:00Z', site_id: 'M-LYO-005', meter_id: 'M-LYO-005', active_power_kw: 120, z_score: 2.2, severity: 'medium' }, // mairie : pic soirée
];

// Tickets avec historique de versions → mix SLA ok / dépassé (sla_hours = 24).
const TICKETS = [
  { id: 3, title: 'Pic de conso — Siège', building: 1, anomaly: 'M-LYO-001', status: 'RESOLVED', priority: 'CRITICAL', created: '2026-11-19T18:35:00Z', resolved: '2026-11-21T00:35:00Z' }, // 30 h → SLA dépassé
  { id: 4, title: 'Coupure élec. — Lycée Jean Moulin', building: 4, anomaly: 'M-LYO-004', status: 'IN_PROGRESS', priority: 'CRITICAL', created: '2026-11-19T13:45:00Z' },
  { id: 5, title: 'Ventilation bloquée — Entrepôt Nord', building: 2, anomaly: 'M-LYO-002', status: 'OPEN', priority: 'HIGH', created: '2026-11-19T02:15:00Z' },
  { id: 6, title: 'Dérive filtration — Piscine', building: 3, anomaly: 'M-LYO-003', status: 'RESOLVED', priority: 'MEDIUM', created: '2026-11-20T09:20:00Z', resolved: '2026-11-20T17:20:00Z' }, // 8 h → ok
  { id: 7, title: 'Pic soirée — Mairie annexe', building: 5, anomaly: 'M-LYO-005', status: 'RESOLVED', priority: 'MEDIUM', created: '2026-11-20T19:10:00Z', resolved: '2026-11-21T02:10:00Z' }, // 7 h → ok
  { id: 8, title: 'Surveillance dérive — Siège', building: 1, anomaly: null, status: 'CLOSED', priority: 'LOW', created: '2026-11-18T08:00:00Z', resolved: '2026-11-18T13:00:00Z' }, // 5 h → ok
];

function featureRes(slug, { title, desc, icon, order, role, comp, route, schema }) {
  return {
    '@id': `/features/${slug}`, slug, title_i18n: { fr: title }, description_i18n: { fr: desc },
    icon, menu_order: order, role_min: role, component: comp, route,
    config_schema: { fields: schema }, default_enabled: false,
  };
}

const BASE_FEATURES = [
  ['dashboard', 'Tableau de bord', 'Carte du parc et synthèse énergie.', 'map', 0, 'gestionnaire', 'building-map', '/', []],
  ['anomalies', 'Anomalies', 'Anomalies détectées par la FAP.', 'warning', 1, 'gestionnaire', 'anomaly-list', '/anomalies', []],
  ['tickets', 'Tickets', 'Interventions et leur suivi.', 'confirmation_number', 2, 'gestionnaire', 'ticket-board', '/tickets', []],
  ['interventions', 'Mes interventions', 'Tickets assignés (technicien).', 'assignment', 3, 'technicien', 'ticket-board', '/interventions', []],
  ['building-detail', 'Détail bâtiment', 'Courbes de conso/PV.', 'insights', 4, 'gestionnaire', 'energy-chart', '/buildings/:id', []],
  ['store', 'App store', 'Activer / configurer les fonctionnalités.', 'storefront', 8, 'all', 'app-store', '/store', []],
  ['admin', 'Administration', 'Utilisateurs, rôles, catalogue.', 'admin_panel_settings', 9, 'admin', 'user-admin', '/admin', []],
];
const EXT_FEATURES = [
  ['alert-rules', 'Alertes personnalisées', 'Seuils de conso/coût par bâtiment.', 'notifications', 10, 'gestionnaire', 'alert-list', '/alerts', [{ key: 'thresholds', label: 'Seuils par bâtiment', type: 'object' }]],
  ['sla-dashboard', 'SLA des interventions', 'Délai création → résolution vs seuil.', 'schedule', 11, 'gestionnaire', 'sla-view', '/sla', [{ key: 'sla_hours', label: 'Seuil SLA (h)', type: 'number', default: 24 }]],
  ['report-builder', 'Rapports PDF/CSV', 'Rapport conso/coût téléchargeable.', 'description', 12, 'gestionnaire', 'report-form', '/reports', [
    { key: 'period', label: 'Période', type: 'enum', options: ['day', 'week', 'month', 'year'], default: 'month' },
    { key: 'building', label: 'Bâtiment', type: 'string' },
    { key: 'format', label: 'Format', type: 'enum', options: ['csv', 'pdf'], default: 'csv' }]],
  ['budget-tracker', 'Budget énergétique mensuel', 'Conso réelle vs budget kWh/€.', 'account_balance', 20, 'gestionnaire', 'budget-gauge', '/budget', [
    { key: 'budget_kwh', label: 'Budget kWh', type: 'number' }, { key: 'budget_eur', label: 'Budget €', type: 'number' },
    { key: 'alert_pct', label: 'Alerte à %', type: 'number', default: 80 }]],
  ['price-optimizer', 'Décalage de conso (heures creuses)', 'Créneaux les moins chers.', 'swap_horiz', 21, 'gestionnaire', 'shift-advisor', '/optimize', [
    { key: 'shiftable_kwh', label: 'kWh déplaçables', type: 'number' },
    { key: 'window', label: 'Fenêtre', type: 'string', default: '01:00-06:00' }]],
  ['pv-selfconsumption', 'Autoconsommation PV', 'Taux d’autoconsommation (+ batterie).', 'solar_power', 22, 'gestionnaire', 'pv-gauge', '/pv', [
    { key: 'battery_kwh', label: 'Batterie kWh', type: 'number', default: 0 }]],
  ['benchmark', 'Comparaison des bâtiments', 'kWh/m² ou €/m² par bâtiment.', 'bar_chart', 23, 'gestionnaire', 'benchmark-view', '/benchmark', [
    { key: 'metric', label: 'Métrique', type: 'enum', options: ['kwh_m2', 'eur_m2'], default: 'kwh_m2' },
    { key: 'period', label: 'Période', type: 'enum', options: ['month', 'year'], default: 'month' },
    { key: 'ref_building', label: 'Bâtiment réf.', type: 'string' }]],
  ['regulatory-export', 'Export réglementaire', 'CSV/JSON annuel par site (décret tertiaire).', 'gavel', 24, 'gestionnaire', 'regulatory-export', '/regulatory', [
    { key: 'year', label: 'Année', type: 'number' }, { key: 'format', label: 'Format', type: 'enum', options: ['csv', 'json'], default: 'csv' }]],
  ['weather-correlation', 'Météo & degré-jours', 'Température et DJ base 18 °C.', 'cloud', 30, 'gestionnaire', 'weather-chart', '/weather', [
    { key: 'station', label: 'Station', type: 'string' }, { key: 'period', label: 'Période', type: 'enum', options: ['7d', '30d', '90d'], default: '30d' }]],
  ['city-events', 'Événements ville', 'Événements à proximité du parc.', 'location_city', 31, 'gestionnaire', 'city-feed', '/city', [
    { key: 'zone', label: 'Zone', type: 'string' }, { key: 'radius_km', label: 'Rayon km', type: 'number' }]],
  ['ai-assistant', 'Assistant IA', 'Questions sur les données (périmètre borné).', 'smart_toy', 32, 'gestionnaire', 'ai-chat', '/assistant', [
    { key: 'assets', label: 'Assets autorisés', type: 'array', items: 'string' }, { key: 'model', label: 'Modèle', type: 'string' }]],
  ['data-sharing', 'Partage de données', 'Contrats DSP (admin).', 'share', 33, 'admin', 'share-manager', '/sharing', [
    { key: 'asset', label: 'Asset', type: 'string' }, { key: 'consumer_did', label: 'DID consommateur', type: 'string' },
    { key: 'duration_days', label: 'Durée (jours)', type: 'number' }]],
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

  // --- séries horaires -----------------------------------------------------
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
      const conso = consoKw(b, t, temp, rnd);
      const net = Math.round((conso - pv) * 10) / 10;
      netRows.push([ts, b.meter_id, net, Math.round(conso)]);
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
  // conso annuelle 2024/2025 (intensité par profil × surface ± bruit)
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

  // --- app store : catalogue + prefs ---------------------------------------
  const featureSlugs = [];
  for (const [slug, title, desc, icon, order, role, comp, route, schema] of [...BASE_FEATURES.map((f) => [...f, f[8] ?? []]), ...EXT_FEATURES]) {
    featureSlugs.push({ '@id': `/features/${slug}` });
    resources[`/features/${slug}`] = featureRes(slug, { title, desc, icon, order, role, comp, route, schema });
  }
  containers['/features/'] = { columns: null, rows: featureSlugs };
  // features de base allumées par défaut
  const baseOn = Object.fromEntries(BASE_FEATURES.map(([s]) => [s, { enabled: true, config: {} }]));
  resources['/prefs/7'] = { '@id': '/prefs/7', prefs: { ...baseOn, ...PREFS } };

  // --- divers ---------------------------------------------------------------
  resources['/dsp/catalogue'] = { dataset: [
    { id: 'dataset:facis:net-grid-hourly', title: 'Conso réseau horaire par site' },
    { id: 'dataset:facis:energy-balance-hourly', title: 'Bilan énergétique horaire' },
    { id: 'dataset:facis:anomaly-candidates', title: 'Anomalies détectées' },
    { id: 'dataset:facis:weather-hourly', title: 'Météo horaire' },
    { id: 'dataset:facis:event-impact-daily', title: 'Impact des événements (journalier)' },
    { id: 'dataset:facis:streetlight-zone-hourly', title: 'Éclairage public par zone' },
  ] };
  resources['/app/llm'] = { answer: 'Sur les 7 derniers jours, la conso du parc est en baisse de 6 % (météo plus douce : −18 DJ). Le pic du 19/11 18 h au Siège (220 kW) dépasse votre seuil de 180 kW : ticket n°3, résolu en 30 h (SLA 24 h dépassé).' };
  resources['/dsp/contracts/request'] = { id: 'contract:demo-1', status: 'PENDING' };

  return { generated_at: new Date().toISOString(), end: end.toISOString(), days, resources, containers };
}

// CLI : node fixtures/generate.mjs [--days 30] → réécrit fixtures/data.js
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const daysArg = process.argv.indexOf('--days');
  const days = daysArg > -1 ? Number(process.argv[daysArg + 1]) : 30;
  const data = generateFixtures({ days });
  const out = join(dirname(fileURLToPath(import.meta.url)), 'data.js');
  writeFileSync(out, `// Généré par fixtures/generate.mjs — ne pas éditer à la main.\n// ${data.days} jours, fin = ${data.end}\nexport default ${JSON.stringify(data)};\n`);
  console.log(`fixtures écrites: ${out} (${(JSON.stringify(data).length / 1024).toFixed(0)} Ko, ${data.containers['/gold/net_grid_hourly/'].rows.length} lignes net_grid)`);
}
