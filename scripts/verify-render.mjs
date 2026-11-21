// verify-render.mjs — monte les 12 composants features contre les fixtures générées
// (aucun back : repli 404 → fixtures) et imprime ce que chacun affiche.
// Usage : node scripts/verify-render.mjs
import { setupDom, fireOrbitReady } from '../tck/helpers/dom.js';
import { generateFixtures, buildFixtureMap, installFixtureFetch } from '../fixtures/index.js';

const window = setupDom();
window.orbit = { ready: Promise.resolve(), routes: [] };
window.sibStore = { fetchAuthn: async () => ({ ok: false, status: 404, headers: { get: () => null }, json: async () => ({}) }) };
if (!URL.createObjectURL) { URL.createObjectURL = () => 'blob:test'; URL.revokeObjectURL = () => {}; }
installFixtureFetch(window, buildFixtureMap(generateFixtures({ days: 30, end: new Date() })));

const { appStore } = await import('@facis/app-store/components/shared/app-store-api.js');
appStore.configure({ podUrl: 'https://pod.test', getWebid: () => 'https://pod.test/users/7', getRole: () => 'gestionnaire' });
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
  ['alert-list', (el, t) => `badge « ${/(\d+) alertes?/.exec(t)?.[0] ?? '?'} », pic Siège présent: ${t.includes('M-LYO-001') && t.includes('HIGH')}`],
  ['sla-view', (el, t) => `« ${/(\d+) SLA dépassé/.exec(t)?.[0] ?? '?'} », résolution 30 h: ${t.includes('30.0 h')}, tickets: ${(t.match(/SLA/g) || []).length > 0 ? 'oui' : '?'}`],
  ['report-form', async (el) => {
    const { buildReportRows } = await import('../components/features/report-form/report-form.js');
    const s = await buildReportRows({ period: 'month', building: '' });
    return `form period/format OK, rapport month: ${s.kwh.toFixed(0)} kWh, ${s.eur.toFixed(2)} €, ${s.days} j`;
  }],
  ['budget-gauge', (el, t) => `${/([\d.]+) MWh/.exec(t)?.[0]} conso vs budget ${/budget ([\d.]+ MWh)/.exec(t)?.[1]}, statut: ${/budget dépassé|alerte|dans le budget/.exec(t)?.[0]}`],
  ['shift-advisor', (el, t) => `${/(\d+) créneaux/.exec(t)?.[0] ?? '?'} conseillés, ex: ${/0\d:00/.exec(t)?.[0] ?? '?'}`],
  ['pv-gauge', (el, t) => `autoconso ${/(\d+)\s*%/.exec(t)?.[1]} %, PV ${/([\d.]+) kWhproduction/.exec(t)?.[1] ?? '?'} kWh, injection ${/([\d.]+) kWhinjection/.exec(t)?.[1] ?? '?'}`],
  ['benchmark-view', (el, t) => `réf ★: ${t.includes('★')}, lignes kWh/m²: ${/kWh\/m²/.test(t)}, piscine ${t.includes('Piscine')}`],
  ['regulatory-export', (el, t) => /([\d]+) site\(s\) pour (\d{4})/.exec(t)?.[0] ?? '?'],
  ['weather-chart', (el, t) => `station ${t.includes('LYON-BRON') ? 'LYON-BRON' : '?'}, lignes DJ: ${(t.match(/\d{4}-\d{2}-\d{2}/g) || []).length}`],
  ['city-feed', (el, t) => `événements zone centre: ${(t.match(/EVENT/g) || []).length}, types: ${(t.match(/EVENT|EMERGENCY|ACCIDENT/g) || []).join(',')}`],
  ['ai-chat', async (el) => { el.draft = 'Synthèse ?'; await el._send(); await el.updateComplete; return `réponse LLM: ${txt(el).slice(0, 80)}…`; }],
  ['share-manager', async (el) => { el.form = { asset: 'dataset:facis:net-grid-hourly', consumer_did: 'did:web:acme', duration_days: 30 }; await el._request(); await el.updateComplete; return `assets DSP: ${(txt(el).match(/dataset:facis:[a-z-]+/g) || []).length}, contrat: ${/contract:[a-z0-9-]+/.exec(txt(el))?.[0]}`; }],
];

console.log('Vérification du rendu des 12 composants (fixtures 30 j, aucun back)\n');
let ko = 0;
for (const [tag, check] of checks) {
  const el = await mount(tag);
  const out = await check(el, txt(el));
  const empty = /no items|error:/i.test(txt(el));
  if (empty) ko++;
  console.log(`${empty ? '⚠' : '✓'} <${tag}> ${out}`);
}
console.log(`\n${ko === 0 ? 'Tous les composants affichent des données métier.' : ko + ' composant(s) en état vide/erreur !'}`);
