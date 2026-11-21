# @facis/app-features — composants features du catalogue (app de supervision énergétique)

Les **12 composants métier** du catalogue `app.features` proposé par
`spec/app-store-catalogue.md` v0.4 §3 (dépôt atlas). En v1, ces composants sont
**packagés dans l'app** (déclarés dans `orbit.json`, app-store-spec §1.6.3) — ils ne
vivent **pas** dans le package `@facis/app-store` (mécanisme), d'où ce dépôt à part.

Dépendance : `@facis/app-store` (mécanisme app store : `<app-store>`, `<app-menu>`,
`window.appStore`, boilerplate OrbitComponent, `getJson`/`resolveMembers`).

## Installation dans l'app de supervision

```js
import '@facis/app-features/components/features/index.js'; // enregistre les 12 custom elements
// FEATURE_COMPONENTS : slug catalogue → tag (check CI seed ↔ orbit.json, app-store-spec §1.9.8)
```

Puis déclarer routes + composants dans `orbit.json` de l'app et livrer le seed du
catalogue en SQL initdb (lot 1 d'abord).

## Catalogue couvert

| Lot | slug → composant | via données | dépendances serveur |
|---|---|---|---|
| 1 | `alert-rules` → `<alert-list>` | LDP `/gold/anomaly_candidates/` + `/buildings/` + prefs | — (évaluation front, badge UI) |
| 1 | `sla-dashboard` → `<sla-view>` | LDP `/tickets/` + `/tickets/<pk>/versions/` | CR-3 (cœur FAP-LDP) |
| 1 | `report-builder` → `<report-form>` | LDP `/gold/net_grid_hourly/` + `/gold/energy_cost_daily/` | — (PDF via jsPDF optionnel, repli CSV) |
| 2 | `budget-tracker` → `<budget-gauge>` | LDP `/gold/net_grid_hourly/` + `/gold/energy_cost_daily/` | — |
| 2 | `price-optimizer` → `<shift-advisor>` | LDP `/gold/price_hourly/` + `/gold/net_grid_hourly/` | CR-1 (matview + conteneur LDP) |
| 2 | `pv-selfconsumption` → `<pv-gauge>` | LDP `/gold/pv_performance_hourly/` + `/gold/net_grid_hourly/` | — |
| 2 | `benchmark` → `<benchmark-view>` | LDP `/gold/annual_site_consumption/` + `/buildings/` (`area_m2`) | CR-2 (DDL) + publication LDP |
| 2 | `regulatory-export` → `<regulatory-export>` | LDP `/gold/annual_site_consumption/` | CR-4 (matview + conteneur LDP) |
| 3 | `weather-correlation` → `<weather-chart>` | LDP `/gold/weather_hourly/` | — (matview existante, à publier en LDP) |
| 3 | `city-events` → `<city-feed>` | LDP `/gold/city_event_hourly/` | CR-1 (matview + conteneur LDP) |
| 3 | `ai-assistant` → `<ai-chat>` | LDP (données, ACL) + `POST /app/llm` (fonction LLM) | CR-5 (endpoint LLM uniquement) |
| 3 | `data-sharing` → `<share-manager>` (admin) | catalogue DSP + plan de contrôle | négociation à confirmer (catalogue §4.7) |

## Accès aux données — LDP uniquement

Décision : **aucune requête volumineuse dans les cas d'usage** → tout passe par
des **conteneurs LDP publiés** (`GET` via `fetchAuthn`, session OIDC + ACL/RLS côté
FAP-LDP). Le proxy `POST /app/query` (chantier O-1) est **supprimé** ; le data plane
`/dsp/data` (HMAC) reste réservé aux consommateurs externes serveur-à-serveur (§13.1).
Le fenêtrage `from`/`to` est fait **côté client** (`filterWindow` dans
`components/shared/feature-data.js`). Config par feature = defaults du
`config_schema` fusionnés avec `prefs.<slug>.config`.

## Fixtures de démo (`fixtures/`)

Données générées **cohérentes métier** pour les 12 composants, servies en repli
quand le back ne répond pas (même sémantique que `VITE_FIXTURES=1` dans
l'app) :

```js
import { installFixtureFetch } from '@facis/app-features/fixtures/index.js';
installFixtureFetch(window);   // wrappe window.sibStore.fetchAuthn (back = vérité, fixture = repli 404/5xx/réseau)
```

- `fixtures/generate.mjs` : générateur déterministe (seed fixe) — `npm run fixtures`
  régénère `fixtures/data.js`. Parc de **5 bâtiments à Lyon** (siège, entrepôt,
  piscine, lycée, mairie) avec surfaces/coords, **30 jours horaires** : conso selon
  profil d'occupation + degré-jours, PV (cloche solaire × météo), prix HP/HC avec
  pointes, météo horaire, événements ville, anomalies corrélées (pic siège 220 kW…),
  coût journalier, conso annuelle 2024/2025, tickets avec versions (mix SLA ok /
  dépassé), catalogue des 19 features + prefs configurées (budget 300 MWh, seuils
  d'alertes par bâtiment, fenêtre 01:00-06:00…).
- `fixtures/index.js` : `FIXTURES`, `buildFixtureMap()`, `installFixtureFetch()`
  (PATCH des prefs appliqué en mémoire → démo interactive sans back).
- `tck/fixtures.test.js` : les 12 composants montés contre les fixtures générées
  (assertions métier : Marathon de Lyon, SLA 30 h dépassé, budget 300 MWh…).

## Tests

```bash
npm test    # node --test tck/ — 12 composants montés (DOM mocké) + helpers purs
```
