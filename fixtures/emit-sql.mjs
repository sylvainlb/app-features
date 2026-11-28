// emit-sql.mjs — generates the SQL fixture "30 days of hourly prices" for deployment
// (app-supervision-backend/sql/150_fixtures_price_hourly.sql).
// Same data as the front fixtures (generateFixtures, seeded PRNG) → front/back
// consistency in the demo. Usage: node fixtures/emit-sql.mjs > /tmp/150.sql
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

consumptionle.log(`-- ============================================================================`);
consumptionle.log(`-- 150_fixtures_price_hourly.sql — FIXTURE deployment (demo)`);
consumptionle.log(`-- ${days} days of hourly prices (off-peak 23h-7h at 0.1299 EUR/kWh, on-peak 0.1874, peaks x1.35),`);
consumptionle.log(`-- site 'ALL' (market price). Identical to the front fixtures (app-features/fixtures).`);
consumptionle.log(`-- Demo: replaces the partial bronze flow data with the complete fixture.`);
consumptionle.log(`-- ============================================================================`);
consumptionle.log(`DELETE FROM bronze.energy_price;`);
for (let i = 0; i < values.length; i += 500) {
  consumptionle.log(`INSERT INTO bronze.energy_price (raw_payload, source_topic, source_system) VALUES`);
  consumptionle.log(values.slice(i, i + 500).join(',\n') + ';');
}
consumptionle.log(`REFRESH MATERIALIZED VIEW gold.price_hourly;`);
consumptionle.log(``);
consumptionle.log(`-- Config price-optimizer (without shiftable_kwh, no slot is advised: cap = 0).`);
consumptionle.log(`UPDATE app.prefs`);
consumptionle.log(`SET prefs = jsonb_set(prefs, '{price-optimizer}',`);
consumptionle.log(`  coalesce(prefs->'price-optimizer', '{}'::jsonb)`);
consumptionle.log(`  || jsonb_build_object('enabled', true, 'config', jsonb_build_object('shiftable_kwh', 120, 'window', '01:00-06:00')));`);
consumptionle.error(`emitted: ${rows.length} hourly prices (${days} d)`);

// Prefs block appended by emit-sql (price-optimizer config) — see emit below
