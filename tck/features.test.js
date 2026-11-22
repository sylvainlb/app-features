// TCK — catalogue feature components (app-store-catalogue.md v0.4 §3):
// mounting the 12 components in a DOM (happy-dom) with a mocked sibStore + tests of
// the pure helpers (alerts, SLA, budget, price windows, self-consumption, benchmark, DD…).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { setupDom, fireOrbitReady } from './helpers/dom.js';

let window;
let appStore;

const POD = 'https://pod.test';

// ---------------------------------------------------------------- LDP fixtures
const FEATURE_RES = (slug, extra = {}) => ({
  '@id': `/features/${slug}`, slug, title_i18n: { en: slug, fr: slug }, icon: 'extension',
  menu_order: 10, route: '/x', role_min: 'all', default_enabled: false,
  config_schema: { fields: [] }, ...extra,
});
const FEATURES = {
  '/features/': { 'ldp:contains': [
    { '@id': '/features/alert-rules' }, { '@id': '/features/sla-dashboard' }, { '@id': '/features/report-builder' },
    { '@id': '/features/budget-tracker' }, { '@id': '/features/price-optimizer' }, { '@id': '/features/pv-selfconsumption' },
    { '@id': '/features/benchmark' }, { '@id': '/features/regulatory-export' }, { '@id': '/features/weather-correlation' },
    { '@id': '/features/city-events' }, { '@id': '/features/ai-assistant' }, { '@id': '/features/data-sharing' },
  ] },
  '/features/alert-rules': FEATURE_RES('alert-rules', { config_schema: { fields: [{ key: 'thresholds', type: 'object' }] } }),
  '/features/sla-dashboard': FEATURE_RES('sla-dashboard', { config_schema: { fields: [{ key: 'sla_hours', type: 'number', default: 24 }] } }),
  '/features/report-builder': FEATURE_RES('report-builder', { config_schema: { fields: [
    { key: 'period', type: 'enum', options: ['day', 'week', 'month', 'year'], default: 'month' },
    { key: 'building', type: 'string' }, { key: 'format', type: 'enum', options: ['csv', 'pdf'], default: 'csv' }] } }),
  '/features/budget-tracker': FEATURE_RES('budget-tracker', { config_schema: { fields: [
    { key: 'budget_kwh', type: 'number' }, { key: 'budget_eur', type: 'number' }, { key: 'alert_pct', type: 'number', default: 80 }] } }),
  '/features/price-optimizer': FEATURE_RES('price-optimizer', { config_schema: { fields: [
    { key: 'shiftable_kwh', type: 'number' }, { key: 'window', type: 'string', default: '01:00-06:00' }] } }),
  '/features/pv-selfconsumption': FEATURE_RES('pv-selfconsumption', { config_schema: { fields: [{ key: 'battery_kwh', type: 'number', default: 0 }] } }),
  '/features/benchmark': FEATURE_RES('benchmark', { config_schema: { fields: [
    { key: 'metric', type: 'enum', options: ['kwh_m2', 'eur_m2'], default: 'kwh_m2' },
    { key: 'period', type: 'enum', options: ['month', 'year'], default: 'month' },
    { key: 'ref_building', type: 'string' }] } }),
  '/features/regulatory-export': FEATURE_RES('regulatory-export', { config_schema: { fields: [
    { key: 'year', type: 'number' }, { key: 'format', type: 'enum', options: ['csv', 'json'], default: 'csv' }] } }),
  '/features/weather-correlation': FEATURE_RES('weather-correlation', { config_schema: { fields: [
    { key: 'station', type: 'string' }, { key: 'period', type: 'enum', options: ['7d', '30d', '90d'], default: '30d' }] } }),
  '/features/city-events': FEATURE_RES('city-events', { config_schema: { fields: [
    { key: 'zone', type: 'string' }, { key: 'radius_km', type: 'number' }] } }),
  '/features/ai-assistant': FEATURE_RES('ai-assistant', { config_schema: { fields: [
    { key: 'assets', type: 'array', items: 'string' }, { key: 'model', type: 'string' }] } }),
  '/features/data-sharing': FEATURE_RES('data-sharing', { role_min: 'admin', config_schema: { fields: [
    { key: 'asset', type: 'string' }, { key: 'consumer_did', type: 'string' }, { key: 'duration_days', type: 'number' }] } }),
};
const PREFS = { '@id': `${POD}/prefs/7`, prefs: {
  'alert-rules': { enabled: true, config: { thresholds: { '1': { kW: 100, eur_day: 50 } } } },
  'sla-dashboard': { enabled: true, config: { sla_hours: 24 } },
  'report-builder': { enabled: true, config: { period: 'month', format: 'csv' } },
  'budget-tracker': { enabled: true, config: { budget_kwh: 1000, budget_eur: 100, alert_pct: 80 } },
  'price-optimizer': { enabled: true, config: { shiftable_kwh: 5, window: '01:00-06:00' } },
  'pv-selfconsumption': { enabled: true, config: { battery_kwh: 0 } },
  'benchmark': { enabled: true, config: { metric: 'kwh_m2', period: 'month', ref_building: 'm1' } },
  'regulatory-export': { enabled: true, config: { year: 2025, format: 'csv' } },
  'weather-correlation': { enabled: true, config: { period: '7d' } },
  'city-events': { enabled: true, config: { zone: 'centre' } },
  'ai-assistant': { enabled: true, config: { assets: ['net_grid_hourly'], model: 'mistral-small' } },
  'data-sharing': { enabled: true, config: {} },
} };

const LDP = {
  '/gold/anomaly_candidates/': { 'ldp:contains': [{ '@id': '/gold/anomaly_candidates/a1' }, { '@id': '/gold/anomaly_candidates/a2' }] },
  '/gold/anomaly_candidates/a1': { '@id': '/gold/anomaly_candidates/a1', event_timestamp: '2026-11-20T03:00:00Z', site_id: 'm1', meter_id: 'm1', type: 'spike', severity: 'high', active_power_kw: 150 },
  '/gold/anomaly_candidates/a2': { '@id': '/gold/anomaly_candidates/a2', event_timestamp: '2026-11-20T05:00:00Z', site_id: 'm2', meter_id: 'm2', severity: 'medium', active_power_kw: 10 },
  '/buildings/': { 'ldp:contains': [{ '@id': '/buildings/1' }] },
  '/buildings/1': { '@id': '/buildings/1', id: 1, name: 'HQ', meter_id: 'm1', area_m2: 1000 },
  '/tickets/': { 'ldp:contains': [{ '@id': '/tickets/1' }] },
  '/tickets/1': { '@id': '/tickets/1', id: 1, title: 'Boiler room leak', status: 'RESOLVED', building_id: 1, created_at: '2026-11-18T08:00:00Z' },
  '/tickets/1/versions/': { 'ldp:contains': [{ '@id': '/tickets/1/versions/2' }] },
  '/tickets/1/versions/2': { '@id': '/tickets/1/versions/2', status: 'RESOLVED', changed_at: '2026-11-19T09:00:00Z' },
  '/gold/energy_cost_daily/': { 'ldp:contains': [{ '@id': '/gold/energy_cost_daily/c1' }] },
  '/gold/energy_cost_daily/c1': { '@id': '/gold/energy_cost_daily/c1', day: '2026-11-05', site_id: 'm1', total_cost_eur: 12.5, consumption_kwh: 300 },
  '/dsp/catalogue': { dataset: [{ id: 'dataset:facis:net-grid-hourly', title: 'Net grid hourly' }] },
};

// ---------------------------------------------------------------- LDP gold fixtures (published containers)
const LDP_GOLD = {
  '/gold/net_grid_hourly/': { 'ldp:contains': [
    { hour: '2026-11-20T01:00:00Z', site_id: 'm1', net_grid_kw: 100 },
    { hour: '2026-11-20T02:00:00Z', site_id: 'm1', net_grid_kw: 200 },
    { hour: '2026-11-20T03:00:00Z', site_id: 'm1', net_grid_kw: -50 },
  ] },
  '/gold/pv_performance_hourly/': { 'ldp:contains': [
    { hour: '2026-11-20T01:00:00Z', site_id: 'm1', pv_generation_kw: 80 }, { hour: '2026-11-20T02:00:00Z', site_id: 'm1', pv_generation_kw: 90 },
  ] },
  '/gold/price_hourly/': { 'ldp:contains': [
    { hour: '2026-11-20T01:00:00Z', site_id: 'ALL', price_eur_kwh: 0.10 }, { hour: '2026-11-20T02:00:00Z', site_id: 'ALL', price_eur_kwh: 0.08 },
    { hour: '2026-11-20T03:00:00Z', site_id: 'ALL', price_eur_kwh: 0.30 }, { hour: '2026-11-20T12:00:00Z', site_id: 'ALL', price_eur_kwh: 0.40 },
  ] },
  '/gold/weather_hourly/': { 'ldp:contains': [
    { hour: '2026-11-19T00:00:00Z', site_id: 's1', temperature_c: 10 },
    { hour: '2026-11-19T12:00:00Z', site_id: 's1', temperature_c: 14 },
    { hour: '2026-11-20T00:00:00Z', site_id: 's1', temperature_c: 5 },
  ] },
  '/gold/city_event_hourly/': { 'ldp:contains': [
    { event_timestamp: '2026-11-21T18:00:00Z', zone_id: 'centre', type: 'city_event', event_type: 'EVENT', severity: 1 },
    { event_timestamp: '2026-11-22T10:00:00Z', zone_id: 'nord', type: 'city_event', event_type: 'ACCIDENT', severity: 3 },
  ] },
  '/gold/annual_site_consumption/': { 'ldp:contains': [
    { year: 2025, site_id: 'm1', consumption_kwh: 120000, total_cost_eur: 18000 }, { year: 2026, site_id: 'm1', consumption_kwh: 9000, total_cost_eur: 1200 },
  ] },
};
Object.assign(LDP, LDP_GOLD);

function makeFetch(calls) {
  return async (url, init = {}) => {
    const u = String(url);
    const method = init.method ?? 'GET';
    calls.push([method, u, init]);
    const ok = (data) => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => data });
    if (method === 'PATCH') return ok(PREFS);
    if (method === 'POST' && u.endsWith('/app/llm')) return ok({ answer: 'Consumption of m1 dropped by 12 %.' });
    if (method === 'POST' && u.endsWith('/dsp/contracts/request')) return ok({ id: 'contract:42' });
    if (u === '/prefs/7') return ok(PREFS);
    if (FEATURES[u]) return ok(FEATURES[u]);
    if (LDP[u]) return ok(LDP[u]);
    return { ok: false, status: 404, headers: { get: () => null }, json: async () => ({ error: 'nf' }) };
  };
}

async function mountFeature(tag) {
  await appStore.refresh(); // prefs/catalogue ready BEFORE the component's 1st load
  const el = document.createElement(tag);
  document.body.appendChild(el);
  fireOrbitReady();
  await el.updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  await el.updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  await el.updateComplete;
  return el;
}

before(async () => {
  window = setupDom();
  window.orbit = { ready: Promise.resolve(), routes: [] };
  window.__calls = [];
  window.sibStore = { fetchAuthn: makeFetch(window.__calls) };
  if (!URL.createObjectURL) { URL.createObjectURL = () => 'blob:test'; URL.revokeObjectURL = () => {}; }
  const mod = await import('@facis/app-store/components/shared/app-store-api.js');
  appStore = mod.appStore;
  appStore.configure({ podUrl: POD, getWebid: () => `${POD}/users/7`, getRole: () => 'manager' });
  await import('../components/features/index.js');
});

// ---------------------------------------------------------------- pure helpers
test('computeAlerts: kW threshold exceeded → alert (catalogue §4.1)', async () => {
  const { computeAlerts } = await import('../components/features/alert-list/alert-list.js');
  const anomalies = LDP['/gold/anomaly_candidates/']['ldp:contains'].map((m) => LDP[m['@id']]);
  const buildings = [LDP['/buildings/1']];
  const alerts = computeAlerts(anomalies, { '1': { kW: 100 } }, buildings);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].anomaly.meter_id, 'm1');
});

test('resolutionDelayHours: creation → RESOLVED via versions (CR-3)', async () => {
  const { resolutionDelayHours, slaRow } = await import('../components/features/sla-view/sla-view.js');
  const versions = [LDP['/tickets/1/versions/2']];
  const delay = resolutionDelayHours(LDP['/tickets/1'], versions);
  assert.equal(delay, 25); // 2026-11-18T08:00 → 2026-11-19T09:00
  assert.equal(slaRow(LDP['/tickets/1'], versions, 24).breached, true);
  assert.equal(slaRow(LDP['/tickets/1'], versions, 48).breached, false);
});

test('budgetPct / budgetStatus', async () => {
  const { budgetPct, budgetStatus } = await import('../components/features/budget-gauge/budget-gauge.js');
  assert.equal(budgetPct(500, 1000), 50);
  assert.equal(budgetStatus(50, 80), 'ok');
  assert.equal(budgetStatus(85, 80), 'alert');
  assert.equal(budgetStatus(120, 80), 'over');
});

test('parseWindow + bestHours: cheapest slots within the window', async () => {
  const { parseWindow, bestHours } = await import('../components/features/shift-advisor/shift-advisor.js');
  assert.deepEqual(parseWindow('01:00-06:00'), { start: 60, end: 360 });
  assert.equal(parseWindow('25:00-06:00'), null);
  const prices = LDP['/gold/price_hourly/']['ldp:contains'];
  const advice = bestHours(prices, [], { shiftable_kwh: 2, window: '01:00-06:00' });
  assert.equal(advice.length, 2);
  assert.deepEqual(advice.map((a) => a.price), [0.08, 0.10]); // ascending sort, 12:00 outside the window
});

test('selfConsumptionPct : (PV − injection) / PV', async () => {
  const { selfConsumptionPct } = await import('../components/features/pv-gauge/pv-gauge.js');
  const s = selfConsumptionPct([{ production_kw: 100 }], [{ net_kw: -20 }]);
  assert.equal(s.pct, 80);
  assert.equal(s.injection, 20);
});

test('benchmarkRows: kWh/m² with area_m2 (CR-2)', async () => {
  const { benchmarkRows } = await import('../components/features/benchmark-view/benchmark-view.js');
  const rows = benchmarkRows([LDP['/buildings/1']], [{ day: '2026-11-05', site_id: 'm1', cost_eur: 12.5, kwh: 300 }], { metric: 'kwh_m2', period: 'month' });
  assert.equal(rows[0].kwhM2, 0.3);
  assert.equal(rows[0].eurM2, 0.0125);
});

test('degreeDays: DD base 18 °C', async () => {
  const { degreeDays } = await import('../components/features/weather-chart/weather-chart.js');
  const days = degreeDays([{ ts: '2026-11-19T00:00:00Z', temperature_c: 10 }, { ts: '2026-11-19T12:00:00Z', temperature_c: 14 }]);
  assert.equal(days.length, 1);
  assert.equal(days[0].dj, (18 - 10) + (18 - 14));
  assert.equal(days[0].tAvg, 12);
});

test('regulatoryRows / toExportCsv: year filter + CSV', async () => {
  const { regulatoryRows, toExportCsv } = await import('../components/features/regulatory-export/regulatory-export.js');
  const rows = regulatoryRows([{ year: 2025, site_id: 'm1', kwh: 120000, cost_eur: 18000 }, { year: 2026, site_id: 'm1', kwh: 9000, cost_eur: 1200 }], 2025);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kwh, 120000);
  const csv = toExportCsv(rows);
  assert.match(csv, /site_id;year;annual_kwh;annual_eur/);
  assert.match(csv, /m1;2025;120000;18000/);
});

test('filterWindow (client-side LDP windowing) + toCsv (feature-data)', async () => {
  const { filterWindow, toCsv, tsOf } = await import('../components/shared/feature-data.js');
  const rows = [{ ts: '2026-11-05T10:00:00Z', v: 1 }, { day: '2026-11-20', v: 2 }, { ts: '2026-11-25T10:00:00Z', v: 3 }];
  const out = filterWindow(rows, { from: '2026-11-13T00:00:00.000Z', to: '2026-11-20T23:59:59.000Z' });
  assert.deepEqual(out.map((r) => r.v), [2]);
  assert.equal(tsOf({ day: '2026-11-20' }), '2026-11-20');
  assert.equal(toCsv([{ a: 'x;y' }], [{ key: 'a' }]), 'a\n"x;y"\n');
});

// ---------------------------------------------------------------- mounted components
test('<alert-list> renders the badge and the alert row', async () => {
  const el = await mountFeature('alert-list');
  const txt = el.renderRoot.textContent;
  assert.match(txt, /1 alert/);
  assert.match(txt, /m1/);
  assert.match(txt, /HIGH/);
});

test('<sla-view> renders the ticket with breached SLA (25 h > 24 h)', async () => {
  const el = await mountFeature('sla-view');
  const txt = el.renderRoot.textContent;
  assert.match(txt, /1 SLA breached/);
  assert.match(txt, /Boiler room leak/);
  assert.match(txt, /25\.0 h/);
});

test('<report-form> renders the config_schema-driven form', async () => {
  const el = await mountFeature('report-form');
  const selects = el.renderRoot.querySelectorAll('select');
  assert.equal(selects.length, 2); // period + format
  const periods = [...selects[0].querySelectorAll('option')].map((o) => o.value);
  assert.deepEqual(periods, ['day', 'week', 'month', 'year']);
});

test('buildReportRows: read of the LDP container net_grid_hourly + client-side windowing', async () => {
  const { buildReportRows } = await import('../components/features/report-form/report-form.js');
  window.__calls.length = 0;
  const s = await buildReportRows({ period: 'month', building: '' });
  const ldpCall = window.__calls.find(([m, u]) => m === 'GET' && u === '/gold/net_grid_hourly/');
  assert.ok(ldpCall, 'GET LDP container /gold/net_grid_hourly/');
  assert.equal(window.__calls.some(([m, u]) => m === 'POST'), false, 'no POST (LDP-only)');
  assert.equal(s.kwh, 300); // 100 + 200, negative injection ignored (max(0, net_kw))
  assert.equal(s.eur, 12.5);
});

test('<budget-gauge> renders consumption vs budget and the status', async () => {
  const el = await mountFeature('budget-gauge');
  const txt = el.renderRoot.textContent;
  assert.match(txt, /300\.0 kWh/);       // month consumption (proxy)
  assert.match(txt, /12\.50 €/);         // month cost (LDP)
  assert.match(txt, /within budget/);    // 25 % < 80 %
});

test('<shift-advisor> renders the recommended slots', async () => {
  const el = await mountFeature('shift-advisor');
  const txt = el.renderRoot.textContent;
  assert.match(txt, /3 slots recommended/); // 01/02/03 UTC in the window, cap 5
  assert.match(txt, /02:00/);
});

test('<pv-gauge> renders the self-consumption rate', async () => {
  const el = await mountFeature('pv-gauge');
  const txt = el.renderRoot.textContent;
  assert.match(txt, /self-consumption/);
  assert.match(txt, /170 kWh/); // PV production
});

test('<benchmark-view> renders the kWh/m² table with reference ★', async () => {
  const el = await mountFeature('benchmark-view');
  const txt = el.renderRoot.textContent;
  assert.match(txt, /HQ ★/);
  assert.match(txt, /0\.3 kWh\/m²/);
});

test('<regulatory-export> renders the sites of the configured year (2025)', async () => {
  const el = await mountFeature('regulatory-export');
  assert.match(el.renderRoot.textContent, /1 site\(s\) for 2025/);
});

test('<weather-chart> renders the daily degree-days', async () => {
  const el = await mountFeature('weather-chart');
  const txt = el.renderRoot.textContent;
  assert.match(txt, /DD \(base 18 °C\)/);
  assert.match(txt, /2026-11-19/);
});

test('<city-feed> filters by zone (centre)', async () => {
  const el = await mountFeature('city-feed');
  const txt = el.renderRoot.textContent;
  assert.match(txt, /EVENT/);
  assert.doesNotMatch(txt, /ACCIDENT/);
});

test('<ai-chat> sends the question to POST /app/llm (CR-5) and displays the answer', async () => {
  const el = await mountFeature('ai-chat');
  el.draft = 'Why is consumption dropping?';
  await el._send();
  await el.updateComplete;
  const txt = el.renderRoot.textContent;
  assert.match(txt, /12 %/);
  const llmCall = window.__calls.find(([m, u]) => m === 'POST' && u.endsWith('/app/llm'));
  assert.ok(llmCall);
  assert.deepEqual(JSON.parse(llmCall[2].body).assets, ['net_grid_hourly']); // allowlist config
});

test('<share-manager> lists the DSP catalogue and submits a contract request', async () => {
  const el = await mountFeature('share-manager');
  assert.match(el.renderRoot.textContent, /dataset:facis:net-grid-hourly/);
  el.form = { asset: 'dataset:facis:net-grid-hourly', consumer_did: 'did:web:acme', duration_days: 30 };
  await el._request();
  await el.updateComplete;
  assert.match(el.renderRoot.textContent, /contract:42/);
});

test('unpublished container: <city-feed> renders an explicit panel (GET /gold/city_event_hourly/ → 404, CR-1)', async () => {
  const prev = window.sibStore.fetchAuthn;
  window.sibStore.fetchAuthn = async (url, init = {}) => {
    const u = String(url);
    if (u === '/gold/city_event_hourly/') {
      return { ok: false, status: 404, headers: { get: () => null }, json: async () => ({ error: 'nf' }) };
    }
    return prev(url, init);
  };
  try {
    const el = await mountFeature('city-feed');
    const txt = el.renderRoot.textContent;
    assert.match(txt, /Data unavailable on the server side/);
    assert.match(txt, /\/gold\/city_event_hourly\//);
    assert.match(txt, /LDP container not published/);
    assert.match(txt, /CR/);
  } finally {
    window.sibStore.fetchAuthn = prev;
  }
});
