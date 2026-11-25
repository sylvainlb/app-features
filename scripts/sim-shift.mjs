import { readFileSync } from 'node:fs';
import { setupDom, fireOrbitReady } from '../tck/helpers/dom.js';
const window = setupDom();
window.orbit = { ready: Promise.resolve(), routes: [] };
const TOK = readFileSync('/tmp/tok', 'utf8').trim();
const BASE = 'http://localhost';
let calls = 0;
window.sibStore = { fetchAuthn: async (u, init = {}) => { calls++; return fetch(new URL(String(u), BASE).href, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${TOK}`, accept: 'application/ld+json' } }); } };
const { appStore } = await import('@facis/app-store/components/shared/app-store-api.js');
appStore.configure({ podUrl: BASE, getWebid: () => `${BASE}/users/1`, getRole: () => 'manager' });
await appStore.refresh();
await import('../components/features/index.js');
const el = document.createElement('shift-advisor');
document.body.appendChild(el);
fireOrbitReady();
const t0 = Date.now();
for (let i = 0; i < 240; i++) {
  await el.updateComplete; await new Promise((r) => setTimeout(r, 500));
  if (el.advice?.length || el._task?.error) break;
}
console.log(`après ${((Date.now()-t0)/1000).toFixed(1)}s, ${calls} requêtes: advice=${el.advice?.length} erreur=${el._task?.error?.message ?? 'non'}`);
console.log(el.renderRoot.textContent.replace(/\s+/g,' ').trim().slice(0,200));
