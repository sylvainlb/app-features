# @facis/app-features — feature components of the catalogue (energy supervision app)

The **12 business components** of the `app.features` catalogue proposed by
`spec/app-store-catalogue.md` v0.4 §3 (atlas repo). In v1, these components are
**packaged into the app** (declared in `orbit.json`, app-store-spec §1.6.3) — they do
**not** live in the `@facis/app-store` package (the mechanism), hence this separate repo.

Dependency: `@facis/app-store` (app store mechanism: `<app-store>`, `<app-menu>`,
`window.appStore`, OrbitComponent boilerplate, `getJson`/`resolveMembers`).

## Installation in the supervision app

```js
import '@facis/app-features/components/features/index.js'; // registers the 12 custom elements
// FEATURE_COMPONENTS: catalogue slug → tag (CI check seed ↔ orbit.json, app-store-spec §1.9.8)
```

Then declare the routes + components in the app's `orbit.json` and ship the catalogue
seed in initdb SQL (batch 1 first).

## Covered catalogue

| Batch | slug → component | data | server dependencies |
|---|---|---|---|
| 1 | `alert-rules` → `<alert-list>` | LDP `/gold/anomaly_candidates/` + `/buildings/` + prefs | — (client-side evaluation, UI badge) |
| 1 | `sla-dashboard` → `<sla-view>` | LDP `/tickets/` + `/tickets/<pk>/versions/` | CR-3 (FAP-LDP core) |
| 1 | `report-builder` → `<report-form>` | LDP `/gold/net_grid_hourly/` + `/gold/energy_cost_daily/` | — (PDF via optional jsPDF, CSV fallback) |
| 2 | `budget-tracker` → `<budget-gauge>` | LDP `/gold/net_grid_hourly/` + `/gold/energy_cost_daily/` | — |
| 2 | `price-optimizer` → `<shift-advisor>` | LDP `/gold/price_hourly/` + `/gold/net_grid_hourly/` | CR-1 (matview + LDP container) |
| 2 | `pv-selfconsumption` → `<pv-gauge>` | LDP `/gold/pv_performance_hourly/` + `/gold/net_grid_hourly/` | — |
| 2 | `benchmark` → `<benchmark-view>` | LDP `/gold/annual_site_consumption/` + `/buildings/` (`area_m2`) | CR-2 (DDL) + LDP publication |
| 2 | `regulatory-export` → `<regulatory-export>` | LDP `/gold/annual_site_consumption/` | CR-4 (matview + LDP container) |
| 3 | `weather-correlation` → `<weather-chart>` | LDP `/gold/weather_hourly/` | — (existing matview, to publish as LDP) |
| 3 | `city-events` → `<city-feed>` | LDP `/gold/city_event_hourly/` | CR-1 (matview + LDP container) |
| 3 | `ai-assistant` → `<ai-chat>` | LDP (data, ACL) + `POST /app/llm` (LLM function) | CR-5 (LLM endpoint only) |
| 3 | `data-sharing` → `<share-manager>` (admin) | DSP catalogue + control plane | negotiation to be confirmed (catalogue §4.7) |

## Data access — LDP only

Decision: **no voluminous queries in the use cases** → everything goes through
**published LDP containers** (`GET` via `fetchAuthn`, OIDC session + ACL/RLS on the
FAP-LDP side). The `POST /app/query` proxy (work item O-1) is **removed**; the
`/dsp/data` data plane (HMAC) remains reserved for external server-to-server consumers (§13.1).
The `from`/`to` windowing is done **client-side** (`filterWindow` in
`components/shared/feature-data.js`). Per-feature config = `config_schema` defaults
merged with `prefs.<slug>.config`.

## Demo fixtures (`fixtures/`)

**Business-consistent** generated data for the 12 components, served as a fallback
when the back does not answer (same semantics as `VITE_FIXTURES=1` in the app):

```js
import { installFixtureFetch } from '@facis/app-features/fixtures/index.js';
installFixtureFetch(window);   // wraps window.sibStore.fetchAuthn (back = truth, fixture = 404/5xx/network fallback)
```

- `fixtures/generate.mjs`: deterministic generator (fixed seed) — `npm run fixtures`
  regenerates `fixtures/data.js`. A **5-building fleet in Lyon** (HQ, warehouse,
  pool, high school, city hall) with areas/coords, **30 hourly days**: consumption by
  occupancy profile + degree-days, PV (solar bell × weather), peak/off-peak prices with
  peaks, hourly weather, city events, correlated anomalies (HQ peak 220 kW…),
  daily cost, annual consumption 2024/2025, tickets with versions (mix of SLA ok /
  breached), catalogue of the 19 features + configured prefs (300 MWh budget,
  per-building alert thresholds, window 01:00-06:00…).
- `fixtures/index.js`: `FIXTURES`, `buildFixtureMap()`, `installFixtureFetch()`
  (prefs PATCH applied in memory → interactive demo without a back).
- `tck/fixtures.test.js`: the 12 components mounted against the generated fixtures
  (business assertions: Lyon marathon, 30 h SLA breached, 300 MWh budget…).

## Tests

```bash
npm test    # node --test tck/ — 12 components mounted (mocked DOM) + pure helpers
```
