// emit-sql-meter.mjs — generates the SQL fixture "30 days of meters + anomalies" (151)
// for deployment. Data = generateFixtures() (identical to the front).
// Feeds bronze.energy_meter → REFRESH of the 6 dependent gold matviews.
// Usage: node fixtures/emit-sql-meter.mjs > /tmp/151.sql
import { generateFixtures } from './generate.mjs';

const days = Number(process.env.FIXTURE_DAYS ?? 30);
const fx = generateFixtures({ days, end: new Date() });

const esc = (s) => String(s).replaceAll("'", "''");
const row = (ts, site, meter, kw) =>
  `(jsonb_build_object('timestamp', '${esc(ts)}', 'site_id', '${esc(site)}', 'meter_id', '${esc(meter)}', 'asset_id', '${esc(meter)}', 'schema_version', '1.0', 'type', 'smart_energy.meter', 'active_power_kw', ${Number(kw)}), 'energy_meter', 'fixture')`;

const values = [];
// 30 d of hourly consumption per building (column total_consumption_kw = consumption)
const netC = fx.containers['/gold/net_grid_hourly/'];
const netCols = netC.columns; // hour, site_id, net_grid_kw, total_consumption_kw
for (const r of netC.rows) {
  const o = Object.fromEntries(netCols.map((k, i) => [k, r[i]]));
  values.push(row(o.hour, o.site_id, o.site_id, o.total_consumption_kw));
}
// + the fixture anomalies (peaks) → detected by the z-score of gold.anomaly_candidates
const anC = fx.containers['/gold/anomaly_candidates/'];
const anCols = anC.columns; // event_timestamp, site_id, meter_id, active_power_kw, z_score, severity
for (const r of anC.rows) {
  const o = Object.fromEntries(anCols.map((k, i) => [k, r[i]]));
  values.push(row(o.event_timestamp, o.site_id, o.meter_id, o.active_power_kw));
}

consumptionle.log(`-- ============================================================================`);
consumptionle.log(`-- 151_fixtures_energy_meter.sql — FIXTURE deployment (demo)`);
consumptionle.log(`-- ${days} d of meters (5 buildings in Lyon) + anomaly peaks, identical to the`);
consumptionle.log(`-- front fixtures. Demo: replaces the partial flow data with the fixture.`);
consumptionle.log(`-- ============================================================================`);
consumptionle.log(`DELETE FROM bronze.energy_meter;`);
for (let i = 0; i < values.length; i += 500) {
  consumptionle.log(`INSERT INTO bronze.energy_meter (raw_payload, source_topic, source_system) VALUES`);
  consumptionle.log(values.slice(i, i + 500).join(',\n') + ';');
}
for (const mv of ['anomaly_candidates', 'net_grid_hourly', 'energy_cost_daily', 'annual_site_consumption', 'energy_balance_hourly', 'city_dashboard_summary']) {
  consumptionle.log(`REFRESH MATERIALIZED VIEW gold.${mv};`);
}
consumptionle.log(``);
consumptionle.log(`-- alert-rules thresholds (without thresholds, no alert is raised).`);
consumptionle.log(`UPDATE app.prefs`);
consumptionle.log(`SET prefs = jsonb_set(prefs, '{alert-rules}',`);
consumptionle.log(`  coalesce(prefs->'alert-rules', '{}'::jsonb)`);
consumptionle.log(`  || jsonb_build_object('enabled', true, 'config', jsonb_build_object('thresholds', jsonb_build_object(`);
consumptionle.log(`    'M-LYO-001', jsonb_build_object('kW', 180),`);
consumptionle.log(`    'M-LYO-002', jsonb_build_object('kW', 250),`);
consumptionle.log(`    'M-LYO-003', jsonb_build_object('eur_day', 120),`);
consumptionle.log(`    'M-LYO-004', jsonb_build_object('kW', 50),`);
consumptionle.log(`    'M-LYO-005', jsonb_build_object('kW', 100)))));`);
consumptionle.error(`emitted: ${values.length} readings (${netC.rows.length} hourly + ${anC.rows.length} anomalies)`);
