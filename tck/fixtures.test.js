// TCK — demo fixtures: the 12 components render with consistent business data
// (Lyon fleet, 30 days) when no back answers (fixtures fallback).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { setupDom, fireOrbitReady } from './helpers/dom.js';
import { generateFixtures, buildFixtureMap, installFixtureFetch } from '../fixtures/index.js';

let window;
let appStore;
const POD = 'https://pod.test';

async function mountFeature(tag) {
  await appStore.refresh();
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
  // no back: everything 404 → fixtures fallback
  window.sibStore = { fetchAuthn: async () => ({ ok: false, status: 404, headers: { get: () => null }, json: async () => ({}) }) };
  if (!URL.createObjectURL) { URL.createObjectURL = () => 'blob:test'; URL.revokeObjectURL = () => {}; }
  const fixtures = buildFixtureMap(generateFixtures({ days: 30, end: new Date() }));
  installFixtureFetch(window, fixtures);
  const mod = await import('@facis/app-store/components/shared/app-store-api.js');
  appStore = mod.appStore;
  appStore.configure({ podUrl: POD, getWebid: () => `${POD}/users/7`, getRole: () => 'manager' });
  await import('../components/features/index.js');
});

test('fixtures: 40 paths served, consistent hourly series (30 d × 24 h × 5 sites)', async () => {
  const { FIXTURES } = await import('../fixtures/index.js');
  const fx = buildFixtureMap(generateFixtures({ days: 30, end: new Date() }));
  assert.ok(Object.keys(fx).length >= 35);
  assert.equal(fx['/gold/net_grid_hourly/']['ldp:contains'].length, 30 * 24 * 5 + 5); // 5 sites × 721 h
  const prefs = fx['/prefs/7'].prefs;
  assert.equal(prefs['budget-tracker'].config.budget_kwh, 300000);
  assert.equal(prefs['price-optimizer'].config.window, '01:00-06:00');
  assert.ok(FIXTURES['/features/alert-rules'].config_schema.fields.length > 0);
});

test('<alert-list>: alert on the HQ peak (220 kW > 180 kW threshold)', async () => {
  const el = await mountFeature('alert-list');
  const txt = el.renderRoot.textContent;
  assert.match(txt, /alert/);
  assert.match(txt, /M-LYO-001/);
  assert.match(txt, /HIGH/);
});

test('<sla-view>: ticket #3 resolved in 30 h → SLA breached (threshold 24 h)', async () => {
  const el = await mountFeature('sla-view');
  const txt = el.renderRoot.textContent;
  assert.match(txt, /SLA breached/);
  assert.match(txt, /Consumption peak — HQ/);
  assert.match(txt, /30\.0 h/);
});

test('<report-form> + buildReportRows: month report with kWh and € > 0 (fixture data)', async () => {
  const el = await mountFeature('report-form');
  assert.equal(el.renderRoot.querySelectorAll('select').length, 2);
  const { buildReportRows } = await import('../components/features/report-form/report-form.js');
  const s = await buildReportRows({ period: 'month', building: '' });
  assert.ok(s.kwh > 1000, `kwh=${s.kwh}`);
  assert.ok(s.eur > 100, `eur=${s.eur}`);
});

test('<budget-gauge>: month consumption vs 300 MWh budget (fixture)', async () => {
  const el = await mountFeature('budget-gauge');
  const txt = el.renderRoot.textContent;
  assert.match(txt, /Monthly energy budget/);
  assert.match(txt, /kWh/);
  assert.match(txt, /300.0 MWh/);
});

test('<shift-advisor>: recommended night peak/off-peak slots (01:00-06:00)', async () => {
  const el = await mountFeature('shift-advisor');
  const txt = el.renderRoot.textContent;
  assert.match(txt, /slots recommended/);
  assert.match(txt, /0[1-5]:00/);
});

test('<pv-gauge>: self-consumption rate between 0 and 100 % (fleet PV)', async () => {
  const el = await mountFeature('pv-gauge');
  const m = el.renderRoot.textContent.match(/(\d+)\s*%\s*self-consumption/);
  assert.ok(m, 'percentage displayed');
  assert.ok(Number(m[1]) >= 0 && Number(m[1]) <= 100);
});

test('<benchmark-view>: 5 buildings in kWh/m², HQ as reference ★', async () => {
  const el = await mountFeature('benchmark-view');
  const txt = el.renderRoot.textContent;
  assert.match(txt, /HQ — 12 Lilas Street ★/);
  assert.match(txt, /Municipal pool/);
  assert.match(txt, /kWh\/m²/);
});

test('<regulatory-export>: 5 sites for 2025 (annual_site_consumption)', async () => {
  const el = await mountFeature('regulatory-export');
  assert.match(el.renderRoot.textContent, /5 site\(s\) for 2025/);
});

test('<weather-chart>: daily degree-days (base 18 °C)', async () => {
  const el = await mountFeature('weather-chart');
  const txt = el.renderRoot.textContent;
  assert.match(txt, /DD \(base 18 °C\)/);
  assert.match(txt, /LYON-BRON/);
});

test('<city-feed>: centre-zone events (Lyon marathon)', async () => {
  const el = await mountFeature('city-feed');
  const txt = el.renderRoot.textContent;
  assert.equal((txt.match(/EVENT/g) || []).length, 2);   // 2 centre-zone events
  assert.match(txt, /centre/);
  assert.doesNotMatch(txt, /ACCIDENT/);                   // north zone filtered out
});

test('<ai-chat>: simulated answer from POST /app/llm (fixture)', async () => {
  const el = await mountFeature('ai-chat');
  el.draft = 'Why the 19/11 peak at HQ?';
  await el._send();
  await el.updateComplete;
  assert.match(el.renderRoot.textContent, /down 6 %/);
});

test('<share-manager>: DSP catalogue + contract request (fixture)', async () => {
  const el = await mountFeature('share-manager');
  assert.match(el.renderRoot.textContent, /dataset:facis:net-grid-hourly/);
  el.form = { asset: 'dataset:facis:net-grid-hourly', consumer_did: 'did:web:acme', duration_days: 30 };
  await el._request();
  await el.updateComplete;
  assert.match(el.renderRoot.textContent, /contract:demo-1/);
});

test('app-store menu: the 12 catalogue features are served by the fixtures', async () => {
  const fx = buildFixtureMap(generateFixtures({ days: 30, end: new Date() }));
  const slugs = fx['/features/']['ldp:contains'].map((m) => m['@id'].split('/').pop());
  for (const s of ['alert-rules', 'sla-dashboard', 'report-builder', 'budget-tracker', 'price-optimizer', 'pv-selfconsumption', 'benchmark', 'regulatory-export', 'weather-correlation', 'city-events', 'ai-assistant', 'data-sharing']) {
    assert.ok(slugs.includes(s), `feature ${s} in the fixture catalogue`);
  }
});
