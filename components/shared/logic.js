// PURE logic of the app store (no DOM, testable with node --test) — spec v0.4 §1.4–§1.9.
// Separated from the Lit components (logic.js pattern of business components).

// ---------------------------------------------------------------------------
// §1.9.12 — <me>: pk extracted from the webid claim (https://<pod>/users/<pk>).
// A webid OUTSIDE the pod is forbidden in v1 → null.
// Returns { pk, host } or null.
export function parseWebidPk(webid, podUrl) {
  if (!webid || typeof webid !== 'string') return null;
  let u;
  try { u = new URL(webid); } catch { return null; }
  if (podUrl) {
    let pod;
    try { pod = new URL(podUrl); } catch { return null; }
    if (u.origin !== pod.origin) return null; // webid outside pod → forbidden in v1 (403)
  }
  const m = u.pathname.match(/^\/users\/(\d+)\/?$/);
  if (!m) return null;
  return { pk: m[1], host: u.host };
}

// IRI (relative path, resolved to POD_URL by fetchAuthn) of <me>'s prefs.
export function prefsPath(webid, podUrl) {
  const p = parseWebidPk(webid, podUrl);
  return p ? `/prefs/${p.pk}` : null;
}

// ---------------------------------------------------------------------------
// §1.9.4a — rule "key absent from prefs = default_enabled".
// prefsObj = content of the prefs jsonb column: {"<slug>": {"enabled":…, "config":…}}
export function featureEnabled(prefsObj, feature) {
  if (!feature) return false;
  const slug = get(feature, 'slug');
  const entry = prefsObj?.[slug];
  if (entry && typeof entry.enabled === 'boolean') return entry.enabled;
  return !!get(feature, 'default_enabled');
}

// ---------------------------------------------------------------------------
// Localized title §1.9.2: title_i18n[locale] → fallback fr → fallback slug.
// Default locale is 'en' (English first, French as locale fallback).
export function titleOf(feature, locale = 'en') {
  const t = get(feature, 'title_i18n') ?? {};
  return t[locale] ?? t.fr ?? get(feature, 'slug') ?? '';
}

// ---------------------------------------------------------------------------
// §1.6.1 / CA-A1 — menu entries: join catalogue × prefs, sort
// (menu_order ASC, slug ASC) (§1.9.1), prefs slugs unknown to the catalogue
// are ignored (§1.9.4d). routeExists(slug/route) filters out features whose
// route does not exist in orbit.json (§1.9.8).
export function menuEntries(catalogue, prefsObj, { locale = 'en', routeExists, role } = {}) {
  const knownSlugs = new Set((prefsObj ? Object.keys(prefsObj) : []));
  return (catalogue ?? [])
    .filter((f) => !routeExists || routeExists(f))
    .filter((f) => roleAllowed(get(f, 'role_min') ?? 'all', role))
    .map((f) => ({
      slug: get(f, 'slug'),
      title: titleOf(f, locale),
      icon: get(f, 'icon') || 'extension',
      route: get(f, 'route'),
      enabled: featureEnabled(prefsObj, f),
      // §1.9.4d: a prefs entry without a catalogue feature is ignored —
      // only catalogue features are rendered (knownSlugs is used by the
      // non-regression tests: menuEntries never yields a slug outside the catalogue).
      _known: knownSlugs.has(f.slug) || Object.keys(prefsObj ?? {}).length === 0,
    }))
    .filter((e) => e.enabled)
    .sort((a, b) => {
      const fa = catalogue.find((f) => get(f, 'slug') === a.slug);
      const fb = catalogue.find((f) => get(f, 'slug') === b.slug);
      return ((get(fa, 'menu_order') ?? 0) - (get(fb, 'menu_order') ?? 0)) || a.slug.localeCompare(b.slug);
    });
}

// Read a JSON-LD field regardless of prefix (features:role_min, role_min…).
export function get(obj, name) {
  if (!obj || typeof obj !== 'object') return undefined;
  if (obj[name] !== undefined) return obj[name];
  for (const k of Object.keys(obj)) if (k.endsWith(':' + name)) return obj[k];
  return undefined;
}

// ---------------------------------------------------------------------------
// §1.4.1 — role_min: 'all' | 'technician' | 'manager' | 'admin'.
// EXACT match (like the "roles" of orbit.json routes):
// visible if role_min == 'all', or role_min == the user's role, or admin.
// (Menu + guard filtering only — security remains on the ACL/PDP side.)
export function roleAllowed(roleMin, role) {
  if (!roleMin || roleMin === 'all') return true;
  if (role === 'admin') return true;
  return roleMin === role;
}

// ---------------------------------------------------------------------------
// §1.9.6 — config_schema meta-schema:
// {"fields": [{"key","label","type":"string"|"number"|"boolean"|"enum"|"object"|"array",
//              "default"?,"options"? (enum),"items"? (array),"required"?}]}
export function configDefaults(schema) {
  const out = {};
  for (const f of schema?.fields ?? []) {
    if (f.default !== undefined) out[f.key] = f.default;
  }
  return out;
}

// §1.9.11 — "configured" badge: non-empty config AND different from the defaults
// (JSON comparison).
export function isConfigured(config, schema) {
  if (!config || typeof config !== 'object' || Object.keys(config).length === 0) return false;
  return JSON.stringify(config) !== JSON.stringify(configDefaults(schema));
}

// ---------------------------------------------------------------------------
// R1 form of PATCHes (§1.5): the prefs jsonb is NOT flattened at the root —
// body = {"prefs": {…}}. The RFC 7386 merge is recursive: the config of the other
// features is preserved.
export function togglePatch(slug, enabled) {
  return { [slug]: { enabled: !!enabled } };
}
export function configPatch(slug, config) {
  return { [slug]: { config } };
}
export function prefsPatchBody(patch) {
  return { prefs: patch };
}

// ---------------------------------------------------------------------------
// Route guard (§1.9.7 / CA-A4): finds the feature whose Orbit route
// matches the requested path. Exact match, or prefix if the route has a :param
// (e.g. route "/buildings/:id", path "/buildings/42").
export function featureForPath(catalogue, pathname) {
  if (!pathname) return null;
  const path = pathname.split('?')[0].replace(/\/+$/, '') || '/';
  for (const f of catalogue ?? []) {
    const route = get(f, 'route');
    if (!route) continue;
    const r = route.replace(/\/+$/, '') || '/';
    if (r === path) return f;
  }
  for (const f of catalogue ?? []) {
    const route = get(f, 'route');
    if (!route || !route.includes(':')) continue;
    const base = route.split(':')[0].replace(/\/+$/, '');
    if (base && (path === base || path.startsWith(base + '/'))) return f;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Config form (client-side validation v1, §1.9.6 / CA-A3).

// Normalizes an entered value according to the field type.
export function normalizeFieldValue(fieldDef, raw) {
  switch (fieldDef.type) {
    case 'number': {
      if (raw === '' || raw === null || raw === undefined) return undefined;
      const n = Number(raw);
      return Number.isFinite(n) ? n : undefined;
    }
    case 'boolean':
      return !!raw;
    case 'enum':
      return fieldDef.options?.includes(raw) ? raw : undefined;
    case 'array':
      // text entry: one value per line (or JSON array)
      if (Array.isArray(raw)) return raw.map(String);
      if (typeof raw === 'string') {
        const s = raw.trim();
        if (s.startsWith('[')) {
          try { const a = JSON.parse(s); return Array.isArray(a) ? a.map(String) : undefined; } catch { return undefined; }
        }
        return s ? s.split(/[\n,]+/).map((x) => x.trim()).filter(Boolean) : [];
      }
      return undefined;
    case 'object':
      if (typeof raw === 'object' && raw !== null) return raw;
      if (typeof raw === 'string' && raw.trim().startsWith('{')) {
        try { return JSON.parse(raw); } catch { return undefined; }
      }
      return undefined;
    case 'string':
    default:
      return raw === '' || raw === null || raw === undefined ? undefined : String(raw);
  }
}

// Validates a config object against the schema → { ok, errors: {key: message} }.
export function validateConfig(schema, values) {
  const errors = {};
  const fields = schema?.fields ?? [];
  for (const f of fields) {
    const v = values?.[f.key];
    if (f.required && (v === undefined || v === null || v === '')) {
      errors[f.key] = 'required';
      continue;
    }
    if (v === undefined) continue;
    if (f.type === 'enum' && f.options && !f.options.includes(v)) errors[f.key] = 'not_in_options';
    if (f.type === 'number' && typeof v !== 'number') errors[f.key] = 'not_a_number';
    if (f.type === 'boolean' && typeof v !== 'boolean') errors[f.key] = 'not_a_boolean';
    if (f.type === 'array' && !Array.isArray(v)) errors[f.key] = 'not_an_array';
    if (f.type === 'object' && (typeof v !== 'object' || v === null || Array.isArray(v))) errors[f.key] = 'not_an_object';
  }
  return { ok: Object.keys(errors).length === 0, errors };
}
