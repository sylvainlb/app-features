// emit-sql-meter.mjs — génère le SQL de la fixture "compteurs 30 j + anomalies" (151)
// pour le déploiement. Données = generateFixtures() (identiques au front).
// Alimente bronze.energy_meter → REFRESH des 6 matviews gold qui en dépendent.
// Usage: node fixtures/emit-sql-meter.mjs > /tmp/151.sql
import { generateFixtures } from './generate.mjs';

const days = Number(process.env.FIXTURE_DAYS ?? 30);
const fx = generateFixtures({ days, end: new Date() });

const esc = (s) => String(s).replaceAll("'", "''");
const row = (ts, site, meter, kw) =>
  `(jsonb_build_object('timestamp', '${esc(ts)}', 'site_id', '${esc(site)}', 'meter_id', '${esc(meter)}', 'asset_id', '${esc(meter)}', 'schema_version', '1.0', 'type', 'smart_energy.meter', 'active_power_kw', ${Number(kw)}), 'energy_meter', 'fixture')`;

const values = [];
// 30 j de conso horaire par bâtiment (colonne total_consumption_kw = conso)
const netC = fx.containers['/gold/net_grid_hourly/'];
const netCols = netC.columns; // hour, site_id, net_grid_kw, total_consumption_kw
for (const r of netC.rows) {
  const o = Object.fromEntries(netCols.map((k, i) => [k, r[i]]));
  values.push(row(o.hour, o.site_id, o.site_id, o.total_consumption_kw));
}
// + les anomalies fixtures (pics) → détectées par le z-score de gold.anomaly_candidates
const anC = fx.containers['/gold/anomaly_candidates/'];
const anCols = anC.columns; // event_timestamp, site_id, meter_id, active_power_kw, z_score, severity
for (const r of anC.rows) {
  const o = Object.fromEntries(anCols.map((k, i) => [k, r[i]]));
  values.push(row(o.event_timestamp, o.site_id, o.meter_id, o.active_power_kw));
}

console.log(`-- ============================================================================`);
console.log(`-- 151_fixtures_energy_meter.sql — FIXTURE déploiement (démo)`);
console.log(`-- Compteurs ${days} j (5 bâtiments Lyon) + pics d'anomalies, identicalques aux`);
console.log(`-- fixtures front. Démo : remplace les données partielles du flux par la fixture.`);
console.log(`-- ============================================================================`);
console.log(`DELETE FROM bronze.energy_meter;`);
for (let i = 0; i < values.length; i += 500) {
  console.log(`INSERT INTO bronze.energy_meter (raw_payload, source_topic, source_system) VALUES`);
  console.log(values.slice(i, i + 500).join(',\n') + ';');
}
for (const mv of ['anomaly_candidates', 'net_grid_hourly', 'energy_cost_daily', 'annual_site_consumption', 'energy_balance_hourly', 'city_dashboard_summary']) {
  console.log(`REFRESH MATERIALIZED VIEW gold.${mv};`);
}
console.log(``);
console.log(`-- Seuils alert-rules (sans thresholds, aucune alerte n'est levée).`);
console.log(`UPDATE app.prefs`);
console.log(`SET prefs = jsonb_set(prefs, '{alert-rules}',`);
console.log(`  coalesce(prefs->'alert-rules', '{}'::jsonb)`);
console.log(`  || jsonb_build_object('enabled', true, 'config', jsonb_build_object('thresholds', jsonb_build_object(`);
console.log(`    'M-LYO-001', jsonb_build_object('kW', 180),`);
console.log(`    'M-LYO-002', jsonb_build_object('kW', 250),`);
console.log(`    'M-LYO-003', jsonb_build_object('eur_day', 120),`);
console.log(`    'M-LYO-004', jsonb_build_object('kW', 50),`);
console.log(`    'M-LYO-005', jsonb_build_object('kW', 100)))));`);
console.error(`émis: ${values.length} relevés (${netC.rows.length} horaires + ${anC.rows.length} anomalies)`);
