// sim-live.mjs — monte alert-list et shift-advisor contre le VRAI back (token dev).
import { readFileSync } from 'node:fs';
import { setupDom, fireOrbitReady } from '../tck/helpers/dom.js';
const window = setupDom();
window.orbit = { ready: Promise.resolve(), routes: [] };
if (!URL.createObjectURL) { URL.createObjectURL = () => 'blob:test'; URL.revokeObjectURL = () => {}; }

const TOK = readFileSync('/tmp/tok', 'utf8').trim();
const BASE = 'http://localhost';
window.sibStore = {
  fetchAuthn: async (u, init = {}) => {
    const url = new URL(String(u), BASE).href;
    return fetch(url, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${TOK}`, accept: 'application/ld+json' } });
  },
};

const { appStore } = await import('@facis/app-store/components/shared/app-store-api.js');
appStore.configure({ podUrl: BASE, getWebid: () => `${BASE}/users/1`, getRole: () => 'manager' });
await appStore.refresh();
console.log('prefs alert-rules:', JSON.stringify(appStore.getPrefs()?.['alert-rules']));
console.log('prefs price-optimizer:', JSON.stringify(appStore.getPrefs()?.['price-optimizer']));
console.log('feature alert-rules cdn_url:', appStore.getFeature('alert-rules')?.['app_features:cdn_url'] ?? appStore.getFeature('alert-rules')?.cdn_url);
await import('../components/features/index.js');

for (const tag of ['alert-list', 'shift-advisor']) {
  const el = document.createElement(tag);
  document.body.appendChild(el);
  fireOrbitReady();
  for (let i = 0; i < 40; i++) { await el.updateComplete; await new Promise((r) => setTimeout(r, 250)); if (el.state === "mounted" || el.alerts?.length || el.advice?.length) break; }
  await el.updateComplete;
  const t = el.renderRoot.textContent.replace(/\s+/g, ' ').trim();
  console.log(`\n=== ${tag} === alerts/advice: ${el.alerts?.length ?? el.advice?.length} isEmpty: ${el.isEmpty?.()}`);
  console.log(t.slice(0, 250));
}
