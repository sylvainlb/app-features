// fixtures/index.js — fixtures de démo pour les 12 composants features.
// Semantique identique à app-supervision (VITE_FIXTURES=1) : le back reste la
// source de vérité ; les fixtures ne servent qu'en repli (404/5xx/réseau) ou
// quand aucun back n'est configuré (tests, démo statique).
//
//   import { installFixtureFetch } from '@facis/app-features/fixtures/index.js';
//   installFixtureFetch(window);   // wrappe window.sibStore.fetchAuthn
//
// Régénérer les données : npm run fixtures   (node fixtures/generate.mjs)
import FIXTURE_DATA from './data.js';

export { generateFixtures } from './generate.mjs';

/** data.js (resources + containers compacts) → mappe chemin → ressource JSON-LD. */
export function buildFixtureMap(data = FIXTURE_DATA) {
  const map = {};
  for (const [p, r] of Object.entries(data.resources ?? {})) map[p] = r;
  for (const [p, c] of Object.entries(data.containers ?? {})) {
    const cols = c.columns ?? [];
    map[p] = {
      '@id': p,
      'ldp:contains': (c.rows ?? []).map((r) => (Array.isArray(r) ? Object.fromEntries(cols.map((c2, i) => [c2, r[i]])) : r)),
    };
  }
  return map;
}

export const FIXTURES = buildFixtureMap();

function pathnameOf(u) {
  const s = String(u);
  return s.startsWith('http') ? new URL(s).pathname : s;
}

const jsonRes = (data, status = 200, etag = null) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (h) => (h === 'etag' ? etag : null) },
  json: async () => data,
});

function mergePatch(target, patch) {
  for (const [k, v] of Object.entries(patch ?? {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && target[k] && typeof target[k] === 'object' && !Array.isArray(target[k])) {
      mergePatch(target[k], v);
    } else {
      target[k] = v;
    }
  }
  return target;
}

/**
 * Wrappe window.sibStore.fetchAuthn : sert les fixtures en repli quand le back
 * ne répond pas (404/5xx/réseau) ; PATCH /prefs/<pk> est appliqué en mémoire sur
 * la fixture (démo interactive : toggles et configs fonctionnent sans back).
 */
export function installFixtureFetch(win, fixtures = FIXTURES) {
  const prev = win.sibStore?.fetchAuthn?.bind(win.sibStore) ?? win.fetch?.bind(win);
  const fn = async (url, init = {}) => {
    const u = pathnameOf(url);
    const method = init.method ?? 'GET';
    // PATCH prefs → merge RFC 7386 sur la fixture en mémoire
    if (method === 'PATCH' && fixtures[u]) {
      const body = JSON.parse(init.body ?? '{}');
      mergePatch(fixtures[u], body);
      return jsonRes(fixtures[u], 200, '"fx"');
    }
    // POST fonctionnel (LLM, contrat DSP) → fixture si présente
    if (method === 'POST' && fixtures[u]) return jsonRes(fixtures[u]);
    if (prev) {
      try {
        const res = await prev(url, init);
        if (res.ok) return res; // back = source de vérité
        if ((res.status === 404 || res.status >= 500) && fixtures[u]) return jsonRes(fixtures[u]);
        return res;
      } catch (e) {
        if (fixtures[u]) return jsonRes(fixtures[u]); // réseau coupé → fixture
        throw e;
      }
    }
    if (fixtures[u]) return jsonRes(fixtures[u]);
    return jsonRes({ error: 'not found' }, 404);
  };
  win.sibStore = { ...(win.sibStore ?? {}), fetchAuthn: fn };
  return fn;
}
