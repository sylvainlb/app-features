import { readFileSync } from 'node:fs';
import { setupDom, fireOrbitReady } from '/home/sylvain/atlas/app-features/tck/helpers/dom.js';
const window = setupDom();
window.orbit = { ready: Promise.resolve(), routes: [] };
if (!URL.createObjectURL) { URL.createObjectURL = () => 'blob:test'; URL.revokeObjectURL = () => {}; }

// real data from the database, serialized as LDP (schema_table: prefix)
const P = 'gold_anomaly_candidates:';
const rows = readFileSync('/tmp/anomalies.jsonl', 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const members = rows.map((o) => {
  const iri = `http://localhost/gold/anomaly_candidates/${o.event_timestamp}/${o.meter_id}`;
  const doc = { '@id': iri, '@type': ['ldp:Resource'] };
  for (const [k, v] of Object.entries(o)) doc[P + k] = v;
  return { iri, doc };
});
const container = { '@id': 'http://localhost/gold/anomaly_candidates/', 'ldp:contains': members.map((m) => ({ '@id': m.iri })) };

const buildings = readFileSync('/tmp/buildings.jsonl', 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const BP = 'app_buildings:';
const bContainer = { '@id': 'http://localhost/buildings/', 'ldp:contains': buildings.map((b) => ({ '@id': `http://localhost/buildings/${b.id}` })) };
const bDocs = Object.fromEntries(buildings.map((b) => {
  const doc = { '@id': `http://localhost/buildings/${b.id}` };
  for (const [k, v] of Object.entries(b)) doc[BP + k] = v;
  return [doc['@id'], doc];
}));

const prefs = { '@id': 'http://localhost/prefs/1', 'app_prefs:prefs': { 'alert-rules': { enabled: true, config: { thresholds: { 'M-LYO-001': { kW: 180 }, 'M-LYO-002': { kW: 250 }, 'M-LYO-003': { eur_day: 120 }, 'M-LYO-004': { kW: 50 }, 'M-LYO-005': { kW: 100 } } } } } };
const features = { '@id': 'http://localhost/features/', 'ldp:contains': [{ '@id': 'http://localhost/features/alert-rules' }] };
const featDoc = { '@id': 'http://localhost/features/alert-rules', 'app_features:slug': 'alert-rules', 'app_features:component': 'alert-list', 'app_features:route': '/alerts', 'app_features:default_enabled': false, 'app_features:menu_order': 10, 'app_features:title_i18n': { en: 'Custom alerts' }, 'app_features:config_schema': { fields: [{ key: 'thresholds', type: 'object' }] } };

const jsonRes = (data) => ({ ok: true, status: 200, headers: { get: () => '"e1"' }, json: async () => data });
let memberGets = 0, memberFails = 0;
window.sibStore = { fetchAuthn: async (u) => {
  const url = String(u);
  if (url.endsWith('/gold/anomaly_candidates/')) return jsonRes(container);
  const m = members.find((x) => x.iri === url);
  if (m) { memberGets++; return jsonRes(m.doc); }
  if (url.endsWith('/buildings/')) return jsonRes(bContainer);
  if (bDocs[url]) return jsonRes(bDocs[url]);
  if (url.endsWith('/prefs/1')) return jsonRes(prefs);
  if (url.endsWith('/features/')) return jsonRes(features);
  if (url.endsWith('/features/alert-rules')) return jsonRes(featDoc);
  memberFails++; return { ok: false, status: 404, headers: { get: () => null }, json: async () => ({}) };
} };

const { appStore } = await import('@facis/app-store/components/shared/app-store-api.js');
appStore.configure({ podUrl: 'http://localhost', getWebid: () => 'http://localhost/users/1', getRole: () => 'manager' });
await import('/home/sylvain/atlas/app-features/components/features/index.js');
await appStore.refresh();
const el = document.createElement('alert-list');
document.body.appendChild(el);
fireOrbitReady();
for (let i = 0; i < 5; i++) { await el.updateComplete; await new Promise((r) => setTimeout(r, 10)); }
await el.updateComplete;
consumptionle.log('member GETs:', memberGets, 'failures:', memberFails);
consumptionle.log('alerts.length:', el.alerts?.length, 'isEmpty:', el.isEmpty?.());
consumptionle.log('text:', el.renderRoot.textContent.replace(/\s+/g, ' ').trim().slice(0, 300));
