// emit-sql.mjs — génère le SQL de la fixture "prix horaires 30 j" pour le déploiement
// (app-supervision-backend/sql/150_fixtures_price_hourly.sql).
// Données identiques aux fixtures front (generateFixtures, PRNG seedé) → cohérence
// front/back en démo. Usage: node fixtures/emit-sql.mjs > /tmp/150.sql
import { generateFixtures } from './generate.mjs';

const days = Number(process.env.FIXTURE_DAYS ?? 30);
const fx = generateFixtures({ days, end: new Date() });
const c = fx.containers['/gold/price_hourly/'];
const cols = c.columns; // ['hour', 'site_id', 'price_eur_kwh']
const rows = c.rows;

const esc = (s) => String(s).replaceAll("'", "''");
const values = rows.map((r) => {
  const o = Object.fromEntries(cols.map((k, i) => [k, r[i]]));
  return `(jsonb_build_object('timestamp', '${esc(o.hour)}', 'site_id', '${esc(o.site_id)}', 'type', 'energy_price', 'price_eur_kwh', ${Number(o.price_eur_kwh)}), 'energy_price', 'fixture')`;
});

console.log(`-- ============================================================================`);
console.log(`-- 150_fixtures_price_hourly.sql — FIXTURE déploiement (démo)`);
console.log(`-- Prix horaires ${days} jours (heures creuses 23h-7h à 0.1299 €/kWh, pleines 0.1874, pics ×1.35),`);
console.log(`-- site 'ALL' (prix marché). Identiques aux fixtures front (app-features/fixtures).`);
console.log(`-- Démo : remplace les données partielles du flux bronze par la fixture complète.`);
console.log(`-- ============================================================================`);
console.log(`DELETE FROM bronze.energy_price;`);
for (let i = 0; i < values.length; i += 500) {
  console.log(`INSERT INTO bronze.energy_price (raw_payload, source_topic, source_system) VALUES`);
  console.log(values.slice(i, i + 500).join(',\n') + ';');
}
console.log(`REFRESH MATERIALIZED VIEW gold.price_hourly;`);
console.log(``);
console.log(`-- Config price-optimizer (sans shiftable_kwh, aucun créneau n'est conseillé : cap = 0).`);
console.log(`UPDATE app.prefs`);
console.log(`SET prefs = jsonb_set(prefs, '{price-optimizer}',`);
console.log(`  coalesce(prefs->'price-optimizer', '{}'::jsonb)`);
console.log(`  || jsonb_build_object('enabled', true, 'config', jsonb_build_object('shiftable_kwh', 120, 'window', '01:00-06:00')));`);
console.error(`émis: ${rows.length} prix horaires (${days} j)`);

// Bloc prefs appended by emit-sql (config price-optimizer) — see emit below
