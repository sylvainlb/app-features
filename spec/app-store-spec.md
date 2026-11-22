# Specification — App store (catalogue of toggleable features)

Reusable component letting a FAP/Startin'blox application offer a **catalogue of
features** that the user enables or not, with **per-feature configuration**, and a
**menu generated dynamically** from the user configuration.

- **Version**: 0.4 — document in **two parts**: Part 1 = v1 (to implement, settled details
  in §1.9), Part 2 = v2 (specified, not a priority)
- **Separate project: yes** — independent repo/package, installable in any FAP/SIB app
- **References**:
  - `supervision-energetique-front-technique.md` (§7 components, §13 decisions)
  - `fap-ldp-spec.md` v0.4 (LDP endpoint, `app.*`, RLS/ACL, PEP, generic triggers §5.1/5.2)
  - `../architecture-djangoldp/1_SIB_ARCHITECTURE.md` (sibStore, Orbit, sib-router, boilerplate, CDN/SRI)
  - `app-store-catalogue.md` (proposed content of the `app.features` catalogue — separate spec)

---

# Part 1 — v1: packaged features, dynamic menu

## 1.1 Purpose and scope (v1)

Two blox delivered by the project: `<app-store>` (catalogue list + toggles + configuration
forms) and `<app-menu>` (app menu generated from the preferences). Plus the **declarative
model** (catalogue + preferences): a `model.json` fragment applied at boot by the FAP-LDP
node (fap-ldp-spec §5), the catalogue seed remaining in initdb SQL on the app side (§1.3).

In v1, only features **already packaged** in the app (declared in `orbit.json`) are
offered: the app store enables/disables and configures them; the menu and route guards are
dynamic. Loading remote components is Part 2 (v2).

## 1.2 Principles

1. **Everything is an LDP resource**: catalogue and preferences live in `app.*`, served by
   the FAP-LDP endpoint, read/written via sibStore. **Nothing is persisted in localStorage in v1** (the sibStore
   cache is in-memory only).
2. **The menu is UX, not security**: hiding an entry disables nothing server-side —
   any feature with a server-side effect remains guarded by ACL/PDP (e.g. data space publication).
3. **Per-user preferences, synchronized**: one resource per user, RLS `webid` — readable/
   modifiable only by its owner (and `admin`).

## 1.3 Separate project — proposed layout

```
app-store/                         ← independent repo (e.g. facis/app-store)
├── components/                    ← web components package (SIB boilerplate)
│   ├── app-store/                 ← <app-store>: catalogue list + toggles + config
│   └── app-menu/                  ← <app-menu>: dynamic menu from the prefs
│   └── shared/                    ← delivered helpers: window.appStore.isEnabled(slug),
│                                  ←   mePrefsIri(), AppStoreGuardMixin (§1.9.7)
├── model/
│   └── app-store.model.json       ← SOURCE OF TRUTH of the model: model.json fragment (tables,
│                                  ←   fields, RLS, ACL, asset_mapping, referenced triggers),
│                                  ←   integrated into the app's model.json and applied AT BOOT by the
│                                  ←   FAP-LDP node (fap-ldp-spec §5; same DSL as E11, appendix A)
├── sql/
│   ├── triggers/                  ← plpgsql bodies of the 2 triggers referenced by the JSON
│   │   ├── app_store_on_user_insert.sql
│   │   └── app_store_on_feature_insert.sql
│   ├── 010_features.sql           ← REFERENCE DDL generated from the JSON (debug/drift — do NOT
│   │                              ←   apply by hand; edit the JSON)
│   ├── 011_prefs.sql              ← idem (app.prefs + RLS/ACL + CREATE TRIGGER)
│   ├── 012_backfill_prefs.sql     ← ONE-SHOT migration: backfill prefs/ACL of existing users
│   │                              ←   at deployment (role admin, idempotent)
│   ├── 020_features_v2.sql        ← Part 2: v2 columns (npm/sri…) + model_injected
│                                  ←   (L3: NOT in v1, Part 1 unchanged)
│   └── README.md                  ← installation procedure
├── spec/                          ← this spec (source: atlas/spec/app-store-spec.md)
└── tck/                           ← Cypress component tests + LDP e2e
```

Installation in an app (v1): integrate `model/app-store.model.json` into the app's
`model.json` (applied at boot by the node, after `core/sql/00*.sql`), run **once**
`sql/012_backfill_prefs.sql` (role `admin`), mount `<app-store>` / `<app-menu>` in the
Orbit shell, declare the features in `orbit.json`. **The package delivers the model structure in JSON +
the triggers + the migration; the catalogue seed is provided by the app via an initdb SQL
file** (pattern `101_seed_demo.sql`, settled channel with `model-injection-spec.md` §1.4 — no
`seed` key in `model.json`), with a CI check seed ↔ `orbit.json` (§1.9.8). Proposed content:
`app-store-catalogue.md`.

**Static vs injected boundary (L2)**: the app store mechanism itself (`app.features`,
`app.prefs`, `model/app-store.model.json`) is **static** — deployed with the server, identical
for all apps. What is **injected hot** is the model of *third-party features*: via
E11 (`model-injection-spec.md`, contract `POST /admin/apps`, model fragments, `app.app_packages`,
containers `/apps/<slug>/…`, tables `store_<slug>_*`), used by Part 2 in v2.

## 1.4 v1 data model (`app.*`)

Transverse fields on **both tables** (they benefit from the generic fap-ldp triggers §5.1/5.2):
`created_at`, `updated_at` (+ trigger), `deleted_at` (tombstone), versioning via `app.versions`.
`published=false` in `dsp.asset_mapping` for `/features/` and `/prefs/` (pod-internal, never exposed
in the data space).

### 1.4.1 Catalogue — `app.features` (managed by `admin`)
| Column | Type | Role |
|---|---|---|
| `id` | bigserial PK | internal key (the exposed IRI is the slug: decision B2, see CA-A7) |
| `slug` | text UNIQUE NOT NULL | stable identifier (`building-map`, …) — IRI `/features/<slug>` |
| `title_i18n`, `description_i18n` | jsonb | **localized from v1**: `{"en": "…", "fr": "…"}` (decision A2, §1.9.2) |
| `icon` | text | icon name from the allowed set (Material Icons), fallback `extension` (§1.9.3) |
| `menu_order` | int NOT NULL DEFAULT 0 | menu order; sort = `(menu_order, slug)` (§1.9.1) |
| `component` | text | custom element tag (packaged in the app in v1) |
| `route` | text | associated Orbit route |
| `role_min` | text DEFAULT 'all' | minimum role to see/enable the feature (`all` \| `technician` \| `manager` \| `admin`) — menu + guard filtering; security remains on the ACL/PDP side |
| `config_schema` | jsonb | meta-schema §1.9.6 |
| `default_enabled` | bool | default state (also used if the key is missing from prefs) |

LDP: container `https://<pod>/features/`, resources `/features/<slug>` (slug resolution via
`dsp.asset_mapping.resource_iri_pattern`, internal PK remaining bigint — no PEP change, but
the PEP must do the slug→id lookup on GET/PATCH/DELETE: covered by CA-A7).
Read: all authenticated users of the pod; write: `admin`.
**ACL seed (M2)**: `foaf:Agent` + `inherited=true` in `read` on `/features/` (externals are anyway
stopped at step 1 of the PDP, container `published=false`); `role:admin` in `write` on
`/features/`.

### 1.4.2 Preferences — `app.prefs` (one row per user)
| Column | Type | Role |
|---|---|---|
| `user_id` | bigint PK, FK → app.users **ON DELETE CASCADE** (GDPR) | owner |
| `prefs` | jsonb NOT NULL DEFAULT '{}' | `{"<slug>": {"enabled": bool, "config": {...}}}` |

LDP: **single** resource per user `https://<pod>/prefs/<user_id>` (decision B1/B3:
flattened resource with a jsonb column, atomic PATCH — and not `/users/<pk>/prefs`).
PUT/PATCH merge-patch to modify. RLS: `auth.can` on the IRI → a user only sees/modifies
**their own** prefs; for another user, the row is filtered by RLS → the PEP returns **404** (decision
§1.9.10: do not leak existence). Trigger on user creation: default prefs from
`app.features.default_enabled` **and** owner-webid ACL (read/write/control) on `/prefs/<pk>` +
`role:admin` (M2); backfill of existing users at deployment via `012_backfill_prefs.sql`
(prefs + ACL, §1.9.4). When the admin adds a feature: trigger on INSERT `app.features` that
injects the default key into all existing prefs.

## 1.5 Exposed LDP contract (v1)

- `GET /features/` → catalogue (container, `ldp:contains` = slugs); `GET /features/<slug>` → record.
- `GET /prefs/<user_pk>` → prefs of the logged-in user (RLS filters the others → **404**).
- `PATCH /prefs/<user_pk>` (merge-patch **RFC 7386 recursive**) — body consistent with the
  column→property mapping, the jsonb is **not** flattened at the root (R1):
  `{"prefs": {"building-map": {"enabled": false}}}` — the config of the other features is preserved
  by the recursive merge → new version.
- `dspace:Error` errors; ETag/If-Match like the rest of the endpoint; `412` → reload the prefs +
  toast "changed in the meantime" (§1.9.9).

## 1.6 Components and behavior (v1)

### 1.6.1 `<app-menu>` (in the shell)
- Reads `window.appStore.mePrefsIri()` (= `/prefs/<pk>` extracted from the webid claim) via
  `window.sibStore.getData()`; subscribes to the store's PubSub on this IRI and to the `save` event.
- Renders one `solid-link` per feature `enabled=true` **and** `role_min` compatible with the current
  role (exact match, like the `roles` of orbit.json routes; `admin` sees everything), sorted by
  `(menu_order, slug)`, joined with the catalogue (prefs slugs unknown to the catalogue are ignored, §1.9.4).
- Route guard: listens to the `navigate` event in the shell + helper `window.appStore
  .isEnabled(slug)` → disabled or unknown feature → redirect `/` (§1.9.7).

### 1.6.2 `<app-store>` (route `/store`, any authenticated user; admin edits the metadata)
- **List**: `ComponentObjectsHandler` on `/features/` + current prefs → toggle (switch) per
  feature; "configured" badge (definition §1.9.11); "Configure" button.
- **Toggle**: PATCH merge-patch on `/prefs/<user_pk>` with body `{"prefs": {"<slug>": {"enabled":
  false}}}` (R1 form, §1.5) then manual dispatch of the `save` event (contract §1.9.9) →
  `<app-menu>` and the current route update on the fly.
- **Config form**: **modal in `/store`** (§1.9.11), `solid-form` driven by
  `config_schema`, writing the `config` sub-key of the prefs.
- **Admin (v1)**: editing of **metadata only** of already-packaged features
  (decision A8, §1.9.8): title/description/icon/menu_order/config_schema/default_enabled.

### 1.6.3 Orbit integration (v1)
All features are **declared at build time** in `orbit.json` (routes + components, pinned npm,
SRI at build). The app store only shows/hides/configures them — no dynamic component
registration in v1.

## 1.7 Security (v1)

- Prefs: RLS/ACL owner-only (§1.4.2). Catalogue: internal read, `admin` write.
- Menu = UX only; never an authorization barrier (§1.2.2).

## 1.8 Acceptance criteria (v1)

- CA-A1: `<app-menu>` displays exactly the `enabled=true` features from the logged-in user's
  prefs, sorted by `(menu_order, slug)`; a prefs PATCH updates the menu without reload.
- CA-A2: toggle in `<app-store>` → PATCH merge-patch on `/prefs/<user_pk>` with body
  `{"prefs": {"<slug>": {"enabled": …}}}` (R1 form) → version created, immediate read-after-write,
  config of the other features preserved; another user who GETs my prefs → **404** (not 403).
- CA-A3: config form of a feature writes `config` consistently with `config_schema`
  (client-side validation in v1, §1.9.6).
- CA-A4: route of a disabled feature → redirect `/` (shell guard + mixin).
- CA-A7: `GET`/`PATCH`/`DELETE /features/<slug>` resolved via `resource_iri_pattern` (slug→id
  lookup on the PEP side, M1) — proven by a TCK test.

## 1.9 Settled details (reviewed before component dev)

1. **Menu order**: `menu_order int NOT NULL DEFAULT 0` on `app.features`; menu sort =
   `(menu_order ASC, slug ASC)`.
2. **Catalogue i18n (A2)**: `title_i18n`/`description_i18n` in **jsonb localized from v1**
   (`{"en": "…", "fr": "…"}`) — the package is generic; the front defaults to locale `en` and reads
   `…_i18n[locale]` with fallback `fr` then `slug`. No schema migration in v2.
3. **Icons**: allowed set = **Material Icons** names; fallback `extension` if the name is unknown.
4. **Features added/removed after the fact**: (a) front rule "key missing from prefs =
   `default_enabled`"; (b) trigger on INSERT `app.features` that injects the default key into
   all existing prefs; (c) `012_backfill_prefs.sql` for existing users at deployment; (d) when a
   feature is removed, the menu **joins the catalogue and ignores unknown slugs** from the prefs,
   and a maintenance job removes ghost keys from the prefs jsonb.
5. **Transverse fields**: `created_at`/`updated_at` + trigger, versioning (`app.versions`),
   tombstone (`deleted_at`) on `app.features` and `app.prefs`; index on `features.slug` (unique);
   `ON DELETE CASCADE` prefs→users; `published=false` in `dsp.asset_mapping` for `/features/`
   and `/prefs/`.
6. **Validation of `config` against `config_schema` (A6)**: **front only in v1** (solid-form);
   PEP validation (409 `dspace:Error`, like decision K on transitions) planned **in v2
   (post-v1)** (M3: no "v2.1" in the phasing). Exact `config_schema` meta-schema (N1:
   extended to `object` and `array` to cover the catalogue):
   `{"fields": [{"key": string, "label": string,
   "type": "string"|"number"|"boolean"|"enum"|"object"|"array",
   "default"?: any, "options"?: string[] (if enum), "items"?: "string" (if array),
   "required"?: bool}]}` — `object` = free jsonb, `array` = string array.
   Note (M4): the `label`s are **not localized** in v1 — to localize in v2
   (`label_i18n`) to avoid a schema migration.
7. **Route guard**: sib-router/Orbit has no native guard → implementation: the shell listens
   to `navigate` and redirects `/` if `!window.appStore.isEnabled(slug)`; the package delivers the helper
   `window.appStore.isEnabled(slug)` (reads the cached prefs) and an `AppStoreGuardMixin` for route
   components, so nothing has to be re-implemented per business component.
8. **Catalogue ↔ orbit.json consistency (A8)**: in v1, the admin edits **only the metadata** of
   features already declared in `orbit.json` (adding a feature = repackaging the app). The menu
   only shows features whose route exists (`window.orbit.getRoute`), and a build-time CI check
   warns if the catalogue seed references an unknown component/route.
9. **`save` event contract**: `sibStore.patch()` does not emit `save` by itself — after the prefs
   PATCH, `<app-store>` does
   `document.dispatchEvent(new CustomEvent("save", {detail: {resource: {"@id": prefsIri}}}))`;
   `<app-menu>` refreshes via its PubSub subscription on this IRI. `412` → reload the prefs +
   toast "changed in the meantime".
10. **403 vs 404 for another user's prefs**: decision **404** (RLS filters the row, the PEP
    returns the resource as non-existent — do not leak existence); to be confirmed in the PEP and
    written into the TCK (CA-A2).
11. **Config form UX**: "Configure" opens a **modal in `/store`** (no dedicated route
    in v1). "configured" badge = non-empty `config` **and** different from the `config_schema`
    `default`s (JSON comparison).
12. **`<me>`**: the pk is extracted from the `webid` claim (`https://<pod>/users/<pk>` → `/prefs/<pk>`) via
    the helper `window.appStore.mePrefsIri()`; a webid outside the pod is **forbidden in v1** (403).

---

# Part 2 — v2: hot loading of remote components (specified, not a priority)

Everything below **adds** to Part 1 without modifying it (the v2 columns live in
`sql/020_features_v2.sql`, applied only in v2).

## 2.1 What v2 adds to the data model

- `app.features` + columns: `npm_package`, `version` (exact, no `^`), `cdn_url` (jsDelivr),
  `sri` (SHA-384), `tag` (remote custom element).
- `app.prefs.prefs`: each feature entry can carry `installed_version`, `installed_sri`
  (actually loaded version).

## 2.2 What v2 technically implies

1. **Dynamic loader**: when a remote feature is enabled, the shell imports the ES module:
   `await import(cdn_url)` then mounts `<tag>` in a `<dynamic-feature>` host.
2. **SRI and dynamic import — hard point**: the `integrity` attribute only applies to
   `<script>` tags, **not** to `import()`. So it must be verified manually: `fetch(cdn_url)` →
   `crypto.subtle.digest('SHA-384', buf)` → comparison with the catalogue `sri` → import via
   `URL.createObjectURL(new Blob([src], {type:'text/javascript'}))`. Simpler alternative:
   CDN origin whitelist + pinned version, without hash verification. **v2 decision kept:
   fetch + manual SHA-384 verification before import** (otherwise a compromised CDN = signed XSS).
3. **Confirmation and audit**: dialog "install <package>@<version>?" (displays the
   sri); the installation is recorded in the prefs (`installed_version`, `installed_sri`) and
   audited server-side (`dsp.audit` / ORCE log: webid, slug, version, ts).
4. **Revocation**: from the app store, "uninstall" → prefs updated, module removed from the
   cache, element unregistered. Packaged features (v1) are not "uninstallable".
5. **Cache**: Cache API / service worker for offline; **upgrade**: if the catalogue announces
   a version > `installed_version` → update prompt (re-verification of the new sri).
6. **Trust model**: a loaded component has access to the user's `fetchAuthn` — therefore to
   everything the user can read/write. The trust decision is made **at installation**
   (explicit UI). Post-v1 option: iframe sandbox + restricted postMessage bridge
   (the remote component does not touch fetchAuthn directly).
7. **Menu**: `<app-menu>` unchanged (it reads the prefs); the route of a remote feature is mounted
   on the fly via `<dynamic-feature>`.

## 2.3 What v2 does not change

The server-side PDP/ACL/RLS: a remote component runs with the user's credentials, nothing
more. Features with a server-side effect remain guarded by the server whatever the menu shows.

## 2.4 Security (v2)

- In addition to v1 security (§1.7): pinned version + sri verified before each import;
  user confirmation; audit; revocation.

## 2.5 Acceptance criteria (v2)

- CA-A5 (v2): enabling a remote feature without a valid sri → refused; with a valid sri →
  verified import, component mounted, menu updated; revocation → component removed.
- CA-A6 (v2): v2 catalogue (version > installed) → upgrade prompt with hash re-verification.

## 2.6 Phasing and open points (v2)

- **v1 to deliver first** (Part 1): `model/app-store.model.json` + `sql/012_backfill_prefs.sql`,
  `<app-store>` + `<app-menu>`, Orbit integration in the supervision app (base features, seed slugs
  aligned on `orbit.json`: `dashboard`, `anomalies`, `tickets`, `interventions`,
  `building-detail`, `store`, `admin` — see `app-store-catalogue.md` §1).
- **v2 specified here, to validate**: manual SRI verification on dynamic `import()` (O-A1),
  and the choice iframe sandbox vs trust-at-installation (O-A2).
- **Back link (L4)**: a remote feature that needs **tables** does not create them itself
  on the front side — it goes through **E11** (`model-injection-spec.md`: `POST /admin/apps`, model
  fragment, containers `/apps/<slug>/…`, tables `store_<slug>_*`; hot injection in v2 via E12).
  Part 2 only describes loading the binary (npm/CDN + SRI); the model is E11's responsibility.
