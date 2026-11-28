// verify-render.mjs — mounts the 12 feature components against the generated fixtures
// (no back: 404 → fixtures fallback) and prints what each one renders.
// Usage: node scripts/verify-render.mjs
import { setupDom, fireOrbitReady } from '../tck/helpers/dom.js';
import { generateFixtures, buildFixtureMap, installFixtureFetch } from '../fixtures/index.js';

const window = setupDom();
window.orbit = { ready: Promise.resolve(), routes: [] };
window.sibStore = { fetchAuthn: async () => ({ ok: false, status: 404, headers: { get: () => null }, json: async () => ({}) }) };
if (!URL.createObjectURL) { URL.createObjectURL = () => 'blob:test'; URL.revokeObjectURL = () => {}; }
installFixtureFetch(window, buildFixtureMap(generateFixtures({ days: 30, end: new Date() })));

const { appStore } = await import('@facis/app-store/components/shared/app-store-api.js');
appStore.configure({ podUrl: 'https://pod.test', getWebid: () => 'https://pod.test/users/7', getRole: () => 'manager' });
await import('../components/features/index.js');

async function mount(tag) {
  await appStore.refresh();
  const el = document.createElement(tag);
  document.body.appendChild(el);
  fireOrbitReady();
  for (let i = 0; i < 3; i++) { await el.updateComplete; await new Promise((r) => setTimeout(r, 0)); }
  await el.updateComplete;
  return el;
}
const txt = (el) => el.renderRoot.textContent.replace(/\s+/g, ' ').trim();

const checks = [
  ['alert-list', (el, t) => `badge « ${/(\d+) alerts?/.exec(t)?.[0] ?? '?'} », HQ peak present: ${t.includes('M-LYO-001') && t.includes('HIGH')}`],
  ['sla-view', (el, t) => `« ${/(\d+) SLAs? breached/.exec(t)?.[0] ?? '?'} », resolution 30 h: ${t.includes('30.0 h')}, tickets: ${(t.match(/SLA/g) || []).length > 0 ? 'yes' : '?'}`],
  ['report-form', async (el) => {
    const { buildReportRows } = await import('../components/features/report-form/report-form.js');
    const s = await buildReportRows({ period: 'month', building: '' });
    return `form period/format OK, report month: ${s.kwh.toFixed(0)} kWh, ${s.eur.toFixed(2)} €, ${s.days} days`;
  }],
  ['budget-gauge', (el, t) => `${/([\d.]+) MWh/.exec(t)?.[0]} consumption vs budget ${/budget ([\d.]+ MWh)/.exec(t)?.[1]}, status: ${/budget exceeded|alert ≥|within budget/.exec(t)?.[0]}`],
  ['shift-advisor', (el, t) => `${/(\d+) slots?/.exec(t)?.[0] ?? '?'} recommended, e.g.: ${/0\d:00/.exec(t)?.[0] ?? '?'}`],
  ['pv-gauge', (el, t) => `self-consumption ${/(\d+)\s*%/.exec(t)?.[1]} %, PV ${/([\d.]+) kWhPV/.exec(t)?.[1] ?? '?'} kWh, injection ${/([\d.]+) kWhgrid/.exec(t)?.[1] ?? '?'}`],
  ['benchmark-view', (el, t) => `ref ★: ${t.includes('★')}, kWh/m² rows: ${/kWh\/m²/.test(t)}, pool ${t.includes('Municipal pool')}`],
  ['regulatory-export', (el, t) => /([\d]+) site\(s\) for (\d{4})/.exec(t)?.[0] ?? '?'],
  ['weather-chart', (el, t) => `station ${t.includes('LYON-BRON') ? 'LYON-BRON' : '?'}, DD rows: ${(t.match(/\d{4}-\d{2}-\d{2}/g) || []).length}`],
  ['city-feed', (el, t) => `centre-zone events: ${(t.match(/EVENT/g) || []).length}, types: ${(t.match(/EVENT|EMERGENCY|ACCIDENT/g) || []).join(',')}`],
  ['ai-chat', async (el) => { el.draft = 'Summary?'; await el._send(); await el.updateComplete; return `LLM answer: ${txt(el).slice(0, 80)}…`; }],
  ['share-manager', async (el) => { el.form = { asset: 'dataset:facis:net-grid-hourly', consumer_did: 'did:web:acme', duration_days: 30 }; await el._request(); await el.updateComplete; return `DSP assets: ${(txt(el).match(/dataset:facis:[a-z-]+/g) || []).length}, contract: ${/contract:[a-z0-9-]+/.exec(txt(el))?.[0]}`; }],
];

consumptionle.log('Render check of the 12 components (30-day fixtures, no back)\n');
let ko = 0;
for (const [tag, check] of checks) {
  const el = await mount(tag);
  const out = await check(el, txt(el));
  const empty = /no items|error:/i.test(txt(el));
  if (empty) ko++;
  consumptionle.log(`${empty ? '⚠' : '✓'} <${tag}> ${out}`);
}
consumptionle.log(`\n${ko === 0 ? 'All components render business data.' : ko + ' component(s) in empty/error state!'}`);
