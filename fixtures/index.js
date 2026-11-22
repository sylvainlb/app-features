// fixtures/index.js — demo fixtures for the 12 feature components.
// Same semantics as app-supervision (VITE_FIXTURES=1): the back remains the
// source of truth; fixtures are only a fallback (404/5xx/network) or when no
// back is configured (tests, static demo).
//
//   import { installFixtureFetch } from '@facis/app-features/fixtures/index.js';
//   installFixtureFetch(window);   // wraps window.sibStore.fetchAuthn
//
// Regenerate the data: npm run fixtures   (node fixtures/generate.mjs)
import FIXTURE_DATA from './data.js';

export { generateFixtures } from './generate.mjs';

/** data.js (resources + compact containers) → path → JSON-LD resource map. */
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
 * Wraps window.sibStore.fetchAuthn: serves the fixtures as a fallback when the
 * back does not answer (404/5xx/network); PATCH /prefs/<pk> is applied in
 * memory on the fixture (interactive demo: toggles and configs work without a back).
 */
export function installFixtureFetch(win, fixtures = FIXTURES) {
  const prev = win.sibStore?.fetchAuthn?.bind(win.sibStore) ?? win.fetch?.bind(win);
  const fn = async (url, init = {}) => {
    const u = pathnameOf(url);
    const method = init.method ?? 'GET';
    // PATCH prefs → RFC 7386 merge on the in-memory fixture
    if (method === 'PATCH' && fixtures[u]) {
      const body = JSON.parse(init.body ?? '{}');
      mergePatch(fixtures[u], body);
      return jsonRes(fixtures[u], 200, '"fx"');
    }
    // Functional POST (LLM, DSP contract) → fixture if present
    if (method === 'POST' && fixtures[u]) return jsonRes(fixtures[u]);
    if (prev) {
      try {
        const res = await prev(url, init);
        if (res.ok) return res; // back = source of truth
        if ((res.status === 404 || res.status >= 500) && fixtures[u]) return jsonRes(fixtures[u]);
        return res;
      } catch (e) {
        if (fixtures[u]) return jsonRes(fixtures[u]); // network down → fixture
        throw e;
      }
    }
    if (fixtures[u]) return jsonRes(fixtures[u]);
    return jsonRes({ error: 'not found' }, 404);
  };
  win.sibStore = { ...(win.sibStore ?? {}), fetchAuthn: fn };
  return fn;
}
