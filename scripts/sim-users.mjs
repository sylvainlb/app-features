import { readFileSync } from 'node:fs';
import { setupDom, fireOrbitReady } from '../tck/helpers/dom.js';
const BASE = 'http://localhost';
const creds = { 2: ['bob', 'dev'], 3: ['admin', 'dev'] };
for (const uid of ['2', '3']) {
  const [uname] = creds[uid];
  const r = await fetch(`${BASE}/auth/realms/fap-light/protocol/openid-connect/token`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'password', client_id: 'fap-light-ui', username: uname, password: 'dev', scope: 'openid' }),
  });
  const TOK = (await r.json()).access_token;
  const ui = await (await fetch(`${BASE}/auth/realms/fap-light/protocol/openid-connect/userinfo`, { headers: { Authorization: `Bearer ${TOK}` } })).json();
  const window = setupDom();
  window.orbit = { ready: Promise.resolve(), routes: [] };
  window.sibStore = { fetchAuthn: async (u, init = {}) => fetch(new URL(String(u), BASE).href, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${TOK}`, accept: 'application/ld+json' } }) };
  const { appStore } = await import('@facis/app-store/components/shared/app-store-api.js');
  appStore.configure({ podUrl: BASE, getWebid: () => `${BASE}/users/${uid}`, getRole: () => ui.role });
  await appStore.refresh();
  const fd = await import('../components/shared/feature-data.js');
  const sa = await import('../components/features/alert-list/alert-list.js');
  const anomalies = await fd.loadAsset('anomaly_candidates').catch((e) => ({ err: e.message }));
  const buildings = await fd.loadAsset('buildings').catch((e) => ({ err: e.message }));
  const cfg = fd.getFeatureConfig('alert-rules');
  const alerts = Array.isArray(anomalies) ? sa.computeAlerts(anomalies, cfg.thresholds, Array.isArray(buildings) ? buildings : []).length : 'ERR ' + anomalies.err;
  consumptionle.log(`user ${uid} (${uname}, role=${ui.role}): anomalies=${Array.isArray(anomalies) ? anomalies.length : anomalies.err}, buildings=${Array.isArray(buildings) ? buildings.length : buildings.err}, thresholds=${cfg.thresholds ? 'oui' : 'NON'}, alertes=${alerts}`);
}
