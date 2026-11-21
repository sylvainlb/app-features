// TCK — fixtures de démo : les 12 composants s'affichent avec des données métier
// cohérentes (parc lyonnais, 30 jours) quand aucun back ne répond (repli fixtures).
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
  // aucun back : tout 404 → repli fixtures
  window.sibStore = { fetchAuthn: async () => ({ ok: false, status: 404, headers: { get: () => null }, json: async () => ({}) }) };
  if (!URL.createObjectURL) { URL.createObjectURL = () => 'blob:test'; URL.revokeObjectURL = () => {}; }
  const fixtures = buildFixtureMap(generateFixtures({ days: 30, end: new Date() }));
  installFixtureFetch(window, fixtures);
  const mod = await import('@facis/app-store/components/shared/app-store-api.js');
  appStore = mod.appStore;
  appStore.configure({ podUrl: POD, getWebid: () => `${POD}/users/7`, getRole: () => 'gestionnaire' });
  await import('../components/features/index.js');
});

test('fixtures : 40 chemins servis, séries horaires cohérentes (30 j × 24 h × 5 sites)', async () => {
  const { FIXTURES } = await import('../fixtures/index.js');
  const fx = buildFixtureMap(generateFixtures({ days: 30, end: new Date() }));
  assert.ok(Object.keys(fx).length >= 35);
  assert.equal(fx['/gold/net_grid_hourly/']['ldp:contains'].length, 30 * 24 * 5 + 5); // 5 sites × 721 h
  const prefs = fx['/prefs/7'].prefs;
  assert.equal(prefs['budget-tracker'].config.budget_kwh, 300000);
  assert.equal(prefs['price-optimizer'].config.window, '01:00-06:00');
  assert.ok(FIXTURES['/features/alert-rules'].config_schema.fields.length > 0);
});

test('<alert-list> : alerte sur le pic du Siège (220 kW > seuil 180 kW)', async () => {
  const el = await mountFeature('alert-list');
  const txt = el.renderRoot.textContent;
  assert.match(txt, /alerte/);
  assert.match(txt, /M-LYO-001/);
  assert.match(txt, /HIGH/);
});

test('<sla-view> : ticket n°3 résolu en 30 h → SLA dépassé (seuil 24 h)', async () => {
  const el = await mountFeature('sla-view');
  const txt = el.renderRoot.textContent;
  assert.match(txt, /SLA dépassé/);
  assert.match(txt, /Pic de conso — Siège/);
  assert.match(txt, /30\.0 h/);
});

test('<report-form> + buildReportRows : rapport du mois avec kWh et € > 0 (données fixture)', async () => {
  const el = await mountFeature('report-form');
  assert.equal(el.renderRoot.querySelectorAll('select').length, 2);
  const { buildReportRows } = await import('../components/features/report-form/report-form.js');
  const s = await buildReportRows({ period: 'month', building: '' });
  assert.ok(s.kwh > 1000, `kwh=${s.kwh}`);
  assert.ok(s.eur > 100, `eur=${s.eur}`);
});

test('<budget-gauge> : conso du mois vs budget 300 MWh (fixture)', async () => {
  const el = await mountFeature('budget-gauge');
  const txt = el.renderRoot.textContent;
  assert.match(txt, /Budget énergétique mensuel/);
  assert.match(txt, /kWh/);
  assert.match(txt, /300.0 MWh/);
});

test('<shift-advisor> : créneaux nocturnes HP/HC conseillés (01:00-06:00)', async () => {
  const el = await mountFeature('shift-advisor');
  const txt = el.renderRoot.textContent;
  assert.match(txt, /créneaux conseillés/);
  assert.match(txt, /0[1-5]:00/);
});

test('<pv-gauge> : taux d’autoconsommation entre 0 et 100 % (PV du parc)', async () => {
  const el = await mountFeature('pv-gauge');
  const m = el.renderRoot.textContent.match(/(\d+)\s*%\s*autoconsommation/);
  assert.ok(m, 'pourcentage affiché');
  assert.ok(Number(m[1]) >= 0 && Number(m[1]) <= 100);
});

test('<benchmark-view> : 5 bâtiments en kWh/m², Siège en référence ★', async () => {
  const el = await mountFeature('benchmark-view');
  const txt = el.renderRoot.textContent;
  assert.match(txt, /Siège — 12 rue des Lilas ★/);
  assert.match(txt, /Piscine municipale/);
  assert.match(txt, /kWh\/m²/);
});

test('<regulatory-export> : 5 sites pour 2025 (annual_site_consumption)', async () => {
  const el = await mountFeature('regulatory-export');
  assert.match(el.renderRoot.textContent, /5 site\(s\) pour 2025/);
});

test('<weather-chart> : degré-jours journaliers (base 18 °C)', async () => {
  const el = await mountFeature('weather-chart');
  const txt = el.renderRoot.textContent;
  assert.match(txt, /DJ \(base 18 °C\)/);
  assert.match(txt, /LYON-BRON/);
});

test('<city-feed> : événements de la zone centre (Marathon de Lyon)', async () => {
  const el = await mountFeature('city-feed');
  const txt = el.renderRoot.textContent;
  assert.equal((txt.match(/EVENT/g) || []).length, 2);   // 2 événements zone centre
  assert.match(txt, /centre/);
  assert.doesNotMatch(txt, /ACCIDENT/);                   // zone nord filtrée
});

test('<ai-chat> : réponse simulée de POST /app/llm (fixture)', async () => {
  const el = await mountFeature('ai-chat');
  el.draft = 'Pourquoi le pic du 19/11 au Siège ?';
  await el._send();
  await el.updateComplete;
  assert.match(el.renderRoot.textContent, /baisse de 6 %/);
});

test('<share-manager> : catalogue DSP + demande de contrat (fixture)', async () => {
  const el = await mountFeature('share-manager');
  assert.match(el.renderRoot.textContent, /dataset:facis:net-grid-hourly/);
  el.form = { asset: 'dataset:facis:net-grid-hourly', consumer_did: 'did:web:acme', duration_days: 30 };
  await el._request();
  await el.updateComplete;
  assert.match(el.renderRoot.textContent, /contract:demo-1/);
});

test('menu app-store : les 12 features du catalogue sont servies par les fixtures', async () => {
  const fx = buildFixtureMap(generateFixtures({ days: 30, end: new Date() }));
  const slugs = fx['/features/']['ldp:contains'].map((m) => m['@id'].split('/').pop());
  for (const s of ['alert-rules', 'sla-dashboard', 'report-builder', 'budget-tracker', 'price-optimizer', 'pv-selfconsumption', 'benchmark', 'regulatory-export', 'weather-correlation', 'city-events', 'ai-assistant', 'data-sharing']) {
    assert.ok(slugs.includes(s), `feature ${s} dans le catalogue fixture`);
  }
});
