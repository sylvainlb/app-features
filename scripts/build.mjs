// build.mjs — builds the 12 catalogue features into self-contained ES bundles (v2).
//
// For each catalogue slug (FEATURE_COMPONENTS):
//   dist/<slug>.js        ← self-contained ESM bundle (lit + app-store boilerplate included)
//   dist/manifest.json    ← { slug: { tag, npm_package, version, file, sri (sha384-<b64>), bytes } }
//   ../app-store/sql/130_features_catalogue_v2.sql  ← v2 catalogue seed (idempotent: ON CONFLICT DO UPDATE, updates the sri on each rebuild)
//
// cdn_url seeded as relative same-origin `/features-dist/<slug>.js` (served by the front:
// app-supervision/public/features-dist/) — in prod, replace with the jsDelivr URL of the
// published package: https://cdn.jsdelivr.net/npm/@facis/app-features@<version>/dist/<slug>.js
// (the manifest sri stays valid as long as the published binary is identical to the build).
//
// Usage: node scripts/build.mjs
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const DIST = join(ROOT, 'dist');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const { FEATURE_COMPONENTS } = await import(join(ROOT, 'components/features/index.js')).catch(() => ({}));

// slug → tag mapping from the barrel (avoids parsing the JS by hand if the import fails)
const components = Object.keys(FEATURE_COMPONENTS ?? {}).length
  ? FEATURE_COMPONENTS
  : Object.fromEntries(readdirSync(join(ROOT, 'components/features'), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => [d.name, d.name])); // fallback: dir == slug (not the case here, see FEATURE_COMPONENTS)

// actual slug → tag (FEATURE_COMPONENTS), e.g. 'pv-selfconsumption' → 'pv-gauge'
const barrel = readFileSync(join(ROOT, 'components/features/index.js'), 'utf8');
const slugToTag = {};
for (const m of barrel.matchAll(/'([a-z0-9-]+)':\s*'([a-z0-9-]+)'/g)) slugToTag[m[1]] = m[2];

// catalogue metadata (spec/app-store-catalogue.md v0.4 §3): role, route, menu_order, config_schema
const CATALOGUE = JSON.parse(readFileSync(join(HERE, 'catalogue.json'), 'utf8'));

mkdirSync(DIST, { recursive: true });
const manifest = { package: pkg.name, version: pkg.version, cdn: 'https://cdn.jsdelivr.net/npm/' + pkg.name + '@' + pkg.version + '/dist/<slug>.js', features: {} };

for (const [slug, tag] of Object.entries(slugToTag)) {
  const entry = join(ROOT, 'components/features', tag, tag + '.js');
  const outfile = join(DIST, slug + '.js');
  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    minify: false,
    sourcemap: false,
    logLevel: 'silent',
    // lit/@lit/* resolved from app-store/node_modules (full tree) — the
    // @facis/app-store → ../app-store symlink and the local app-features node_modules
    // have partial trees; we force a single source for the whole bundle.
    alias: {
      lit: join(ROOT, '../app-store/node_modules/lit'),
      '@lit/task': join(ROOT, '../app-store/node_modules/@lit/task'),
      '@lit/reactive-element': join(ROOT, '../app-store/node_modules/@lit/reactive-element'),
      'lit-html': join(ROOT, '../app-store/node_modules/lit-html'),
      'lit-element': join(ROOT, '../app-store/node_modules/lit-element'),
    },
  });
  const bytes = readFileSync(outfile);
  const sri = 'sha384-' + createHash('sha384').update(bytes).digest('base64');
  const meta = CATALOGUE[slug] ?? {};
  manifest.features[slug] = {
    tag,
    npm_package: pkg.name,
    version: pkg.version,
    file: 'dist/' + slug + '.js',
    cdn_url: '/features-dist/' + slug + '.js', // same-origin (dev); prod = manifest.cdn
    sri,
    bytes: bytes.length,
    ...meta,
  };
  console.log(`build ${slug} → dist/${slug}.js (${bytes.length} B, ${sri.slice(0, 20)}…)`);
}

writeFileSync(join(DIST, 'manifest.json'), JSON.stringify(manifest, null, 2));

// --- generates the v2 catalogue SQL seed (app-store/sql/130_features_catalogue_v2.sql) ---
const esc = (s) => String(s ?? '').replace(/'/g, "''");
const rows = Object.entries(manifest.features).map(([slug, f]) => {
  const cs = JSON.stringify(f.config_schema ?? { fields: [] }).replace(/'/g, "''");
  return `('${esc(slug)}', '${esc(JSON.stringify(f.title_i18n ?? { en: slug, fr: slug }))}', '${esc(JSON.stringify(f.description_i18n ?? {}))}', `
    + `'${esc(f.icon ?? 'extension')}', ${f.menu_order ?? 50}, '${esc(f.role_min ?? 'manager')}', `
    + `'${esc(f.tag)}', '${esc(f.route ?? '/' + slug)}', '${cs}', ${f.default_enabled ?? false}, `
    + `true, '${esc(f.npm_package)}', '${esc(f.version)}', '${esc(f.cdn_url)}', '${esc(f.sri)}', '${esc(f.tag)}', false)`;
}).join(',\n');

const sql = `-- ============================================================================
-- App store — 130_features_catalogue_v2.sql: v2 catalogue of the 12 business features
-- (spec/app-store-catalogue.md v0.4 §3, batches 1–3) as DISTANT features:
-- npm_package/version/cdn_url/sri/tag filled in (020_features_v2.sql), sri =
-- actual sha384 of the built bundle (app-features/scripts/build.mjs → dist/manifest.json).
-- cdn_url relative same-origin /features-dist/<slug>.js (dev); prod = jsDelivr.
-- default_enabled=false (opt-in), in_menu=true, model_injected=false (no own tables).
-- Generated by app-features/scripts/build.mjs — do NOT edit by hand.
-- Role: admin. Idempotent: ON CONFLICT (slug) DO UPDATE — replayed at boot, updates
-- notably sri/cdn_url/version on each bundle rebuild (otherwise the sri stored in the
-- DB diverges from the served binary).
-- ============================================================================

INSERT INTO app.features (slug, title_i18n, description_i18n, icon, menu_order, role_min,
                           component, route, config_schema, default_enabled, in_menu,
                           npm_package, version, cdn_url, sri, tag, model_injected) VALUES
${rows}
ON CONFLICT (slug) DO UPDATE SET
  title_i18n = EXCLUDED.title_i18n, description_i18n = EXCLUDED.description_i18n,
  icon = EXCLUDED.icon, menu_order = EXCLUDED.menu_order, role_min = EXCLUDED.role_min,
  component = EXCLUDED.component, route = EXCLUDED.route, config_schema = EXCLUDED.config_schema,
  npm_package = EXCLUDED.npm_package, version = EXCLUDED.version,
  cdn_url = EXCLUDED.cdn_url, sri = EXCLUDED.sri, tag = EXCLUDED.tag;
`;
const sqlPath = join(ROOT, '..', 'app-store', 'sql', '130_features_catalogue_v2.sql');
writeFileSync(sqlPath, sql);
console.log(`seed SQL generated → ${sqlPath} (${Object.keys(manifest.features).length} features)`);
