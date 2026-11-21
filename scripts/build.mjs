// build.mjs — build des 12 features du catalogue en bundles ES autonomes (v2).
//
// Pour chaque slug du catalogue (FEATURE_COMPONENTS) :
//   dist/<slug>.js        ← bundle ESM self-contained (lit + boilerplate app-store inclus)
//   dist/manifest.json    ← { slug: { tag, npm_package, version, file, sri (sha384-<b64>), bytes } }
//   ../app-store/sql/130_features_catalogue_v2.sql  ← seed du catalogue v2 (idempotent : ON CONFLICT DO UPDATE, met à jour le sri à chaque rebuild)
//
// cdn_url seedé en relatif same-origin `/features-dist/<slug>.js` (servi par le front :
// app-supervision/public/features-dist/) — en prod, remplacer par le jsDelivr du package
// publié : https://cdn.jsdelivr.net/npm/@facis/app-features@<version>/dist/<slug>.js
// (le sri du manifest reste valable tant que le binaire publié est identique au build).
//
// Usage : node scripts/build.mjs
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

// mapping slug → tag depuis le barrel (évite de parser le JS à la main si l'import échoue)
const components = Object.keys(FEATURE_COMPONENTS ?? {}).length
  ? FEATURE_COMPONENTS
  : Object.fromEntries(readdirSync(join(ROOT, 'components/features'), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => [d.name, d.name])); // fallback : dir == slug (pas le cas ici, voir FEATURE_COMPONENTS)

// slug → tag réel (FEATURE_COMPONENTS), ex. 'pv-selfconsumption' → 'pv-gauge'
const barrel = readFileSync(join(ROOT, 'components/features/index.js'), 'utf8');
const slugToTag = {};
for (const m of barrel.matchAll(/'([a-z0-9-]+)':\s*'([a-z0-9-]+)'/g)) slugToTag[m[1]] = m[2];

// métadonnées du catalogue (spec/app-store-catalogue.md v0.4 §3) : rôle, route, menu_order, config_schema
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
    // lit/@lit/* résolus depuis app-store/node_modules (arbre complet) — le symlink
    // @facis/app-store → ../app-store et le node_modules local d'app-features ont des
    // arbres partiels ; on force une seule source pour tout le bundle.
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
    cdn_url: '/features-dist/' + slug + '.js', // same-origin (dev) ; prod = manifest.cdn
    sri,
    bytes: bytes.length,
    ...meta,
  };
  console.log(`build ${slug} → dist/${slug}.js (${bytes.length} o, ${sri.slice(0, 20)}…)`);
}

writeFileSync(join(DIST, 'manifest.json'), JSON.stringify(manifest, null, 2));

// --- génère le seed SQL du catalogue v2 (app-store/sql/130_features_catalogue_v2.sql) ---
const esc = (s) => String(s ?? '').replace(/'/g, "''");
const rows = Object.entries(manifest.features).map(([slug, f]) => {
  const cs = JSON.stringify(f.config_schema ?? { fields: [] }).replace(/'/g, "''");
  return `('${esc(slug)}', '${esc(JSON.stringify(f.title_i18n ?? { fr: slug }))}', '${esc(JSON.stringify(f.description_i18n ?? {}))}', `
    + `'${esc(f.icon ?? 'extension')}', ${f.menu_order ?? 50}, '${esc(f.role_min ?? 'gestionnaire')}', `
    + `'${esc(f.tag)}', '${esc(f.route ?? '/' + slug)}', '${cs}', ${f.default_enabled ?? false}, `
    + `true, '${esc(f.npm_package)}', '${esc(f.version)}', '${esc(f.cdn_url)}', '${esc(f.sri)}', '${esc(f.tag)}', false)`;
}).join(',\n');

const sql = `-- ============================================================================
-- App store — 130_features_catalogue_v2.sql : catalogue v2 des 12 features métier
-- (spec/app-store-catalogue.md v0.4 §3, lots 1–3) en features DISTANTES :
-- npm_package/version/cdn_url/sri/tag renseignés (020_features_v2.sql), sri =
-- sha384 réelle du bundle buildé (app-features/scripts/build.mjs → dist/manifest.json).
-- cdn_url en relatif same-origin /features-dist/<slug>.js (dev) ; prod = jsDelivr.
-- default_enabled=false (opt-in), in_menu=true, model_injected=false (pas de tables propres).
-- Généré par app-features/scripts/build.mjs — ne PAS éditer à la main.
-- Rôle : admin. Idempotent : ON CONFLICT (slug) DO UPDATE — rejoue au boot, met à jour
-- notamment sri/cdn_url/version à chaque rebuild des bundles (sinon le sri en base diverge du binaire servi).
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
console.log(`seed SQL généré → ${sqlPath} (${Object.keys(manifest.features).length} features)`);
