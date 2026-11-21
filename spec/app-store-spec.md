# Spécification — App store (catalogue de fonctionnalités activables)

Composant réutilisable permettant à une application FAP/Startin'blox de proposer un **catalogue de
fonctionnalités** que l'utilisateur active ou non, avec **configuration par fonctionnalité**, et un
**menu généré dynamiquement** depuis la configuration utilisateur.

- **Version** : 0.4 — document en **deux parties** : Partie 1 = v1 (à implémenter, précisions
  tranchées en §1.9), Partie 2 = v2 (spécifiée, non prioritaire)
- **Projet à part : oui** — dépôt/package indépendant, installable dans toute app FAP/SIB
- **Références** :
  - `supervision-energetique-front-technique.md` (§7 composants, §13 décisions)
  - `fap-ldp-spec.md` v0.4 (endpoint LDP, `app.*`, RLS/ACL, PEP, triggers génériques §5.1/5.2)
  - `../architecture-djangoldp/1_SIB_ARCHITECTURE.md` (sibStore, Orbit, sib-router, boilerplate, CDN/SRI)
  - `app-store-catalogue.md` (contenu proposé du catalogue `app.features` — spec à part)

---

# Partie 1 — v1 : fonctionnalités packagées, menu dynamique

## 1.1 Objet et périmètre (v1)

Deux blox livrés par le projet : `<app-store>` (liste du catalogue + toggles + formulaires de
configuration) et `<app-menu>` (menu de l'app généré depuis les préférences). Plus le **modèle
déclaratif** (catalogue + préférences) : fragment `model.json` appliqué au boot par le nœud FAP-LDP
(fap-ldp-spec §5), le seed du catalogue restant en SQL d'initdb côté app (§1.3).

En v1, seules des fonctionnalités **déjà packagées** dans l'app (déclarées dans `orbit.json`) sont
proposées : l'app store les active/désactive et les configure ; le menu et les guards de routes sont
dynamiques. Le chargement de composants distants est en Partie 2 (v2).

## 1.2 Principes

1. **Tout est ressource LDP** : catalogue et préférences vivent dans `app.*`, servis par l'endpoint
   FAP-LDP, lus/écrits via sibStore. **Rien n'est persisté en localStorage en v1** (le cache sibStore
   est en mémoire uniquement).
2. **Le menu est de l'UX, pas de la sécurité** : masquer une entrée ne désactive rien côté serveur —
   toute fonctionnalité à effet serveur reste gardée par ACL/PDP (ex. publication data space).
3. **Préférences par utilisateur, synchronisées** : une ressource par user, RLS `webid` — lisible/
   modifiable uniquement par son propriétaire (et `admin`).

## 1.3 Projet à part — layout proposé

```
app-store/                         ← dépôt indépendant (ex. facis/app-store)
├── components/                    ← package web components (boilerplate SIB)
│   ├── app-store/                 ← <app-store> : liste catalogue + toggles + config
│   └── app-menu/                  ← <app-menu> : menu dynamique depuis les prefs
│   └── shared/                    ← helpers livrés : window.appStore.isEnabled(slug),
│                                  ←   mePrefsIri(), AppStoreGuardMixin (§1.9.7)
├── model/
│   └── app-store.model.json       ← SOURCE DE VÉRITÉ du modèle : fragment model.json (tables,
│                                  ←   champs, RLS, ACL, asset_mapping, triggers référencés),
│                                  ←   intégré au model.json de l'app et appliqué AU BOOT par le
│                                  ←   nœud FAP-LDP (fap-ldp-spec §5 ; même DSL que E11, annexe A)
├── sql/
│   ├── triggers/                  ← corps plpgsql des 2 triggers référencés par le JSON
│   │   ├── app_store_on_user_insert.sql
│   │   └── app_store_on_feature_insert.sql
│   ├── 010_features.sql           ← DDL de RÉFÉRENCE généré depuis le JSON (debug/drift — ne PAS
│   │                              ←   appliquer à la main ; éditer le JSON)
│   ├── 011_prefs.sql              ← idem (app.prefs + RLS/ACL + CREATE TRIGGER)
│   ├── 012_backfill_prefs.sql     ← migration ONE-SHOT : backfill prefs/ACL des users existants
│   │                              ←   au déploiement (rôle admin, idempotent)
│   ├── 020_features_v2.sql        ← Partie 2 : colonnes v2 (npm/sri…) + model_injected
│                                  ←   (L3 : PAS en v1, Partie 1 inchangée)
│   └── README.md                  ← procédure d'installation
├── spec/                          ← cette spec (source : atlas/spec/app-store-spec.md)
└── tck/                           ← tests Cypress composants + e2e LDP
```

Installation dans une app (v1) : intégrer `model/app-store.model.json` dans le `model.json` de
l'app (appliqué au boot par le nœud, après `core/sql/00*.sql`), exécuter **une fois**
`sql/012_backfill_prefs.sql` (rôle `admin`), monter `<app-store>` / `<app-menu>` dans le shell
Orbit, déclarer les features dans `orbit.json`. **Le package livre la structure du modèle en JSON +
les triggers + la migration ; le seed du catalogue est fourni par l'app via un fichier SQL
d'initdb** (pattern `101_seed_demo.sql`, canal tranché avec `model-injection-spec.md` §1.4 — pas de
clé `seed` dans `model.json`), avec check CI seed ↔ `orbit.json` (§1.9.8). Contenu proposé :
`app-store-catalogue.md`.

**Frontière statique vs injecté (L2)** : le mécanisme app store lui-même (`app.features`,
`app.prefs`, `model/app-store.model.json`) est **statique** — déployé avec le serveur, identique
pour toutes les apps. Ce qui est **injecté à chaud**, c'est le modèle des *features tierces* : via
E11 (`model-injection-spec.md`, contrat `POST /admin/apps`, fragments de modèle, `app.app_packages`,
conteneurs `/apps/<slug>/…`, tables `store_<slug>_*`), utilisé par la Partie 2 en v2.

## 1.4 Modèle de données v1 (`app.*`)

Champs transverses sur **les deux tables** (bénéficient des triggers génériques fap-ldp §5.1/5.2) :
`created_at`, `updated_at` (+ trigger), `deleted_at` (tombstone), versioning via `app.versions`.
`published=false` dans `dsp.asset_mapping` pour `/features/` et `/prefs/` (interne pod, jamais exposé
en data space).

### 1.4.1 Catalogue — `app.features` (géré par `admin`)
| Colonne | Type | Rôle |
|---|---|---|
| `id` | bigserial PK | clé interne (l'IRI exposée est le slug : décision B2, voir CA-A7) |
| `slug` | text UNIQUE NOT NULL | identifiant stable (`building-map`, …) — IRI `/features/<slug>` |
| `title_i18n`, `description_i18n` | jsonb | **localisés dès la v1** : `{"fr": "…"}` (décision A2, §1.9.2) |
| `icon` | text | nom d'icône du set autorisé (Material Icons), fallback `extension` (§1.9.3) |
| `menu_order` | int NOT NULL DEFAULT 0 | ordre du menu ; tri = `(menu_order, slug)` (§1.9.1) |
| `component` | text | tag du custom element (packagé dans l'app en v1) |
| `route` | text | route Orbit associée |
| `role_min` | text DEFAULT 'all' | rôle minimal pour voir/activer la feature (`all` \| `technicien` \| `gestionnaire` \| `admin`) — filtrage menu + guard ; la sécurité reste côté ACL/PDP |
| `config_schema` | jsonb | méta-schéma §1.9.6 |
| `default_enabled` | bool | état par défaut (aussi utilisé si la clé manque dans les prefs) |

LDP : conteneur `https://<pod>/features/`, ressources `/features/<slug>` (résolution du slug via
`dsp.asset_mapping.resource_iri_pattern`, PK interne restant bigint — aucun changement du PEP, mais
le PEP doit faire le lookup slug→id sur GET/PATCH/DELETE : couvert par CA-A7).
Lecture : tous les users authentifiés du pod ; écriture : `admin`.
**ACL seed (M2)** : `foaf:Agent` + `inherited=true` en `read` sur `/features/` (les externes sont de
toute façon arrêtés à l'étape 1 du PDP, conteneur `published=false`) ; `role:admin` en `write` sur
`/features/`.

### 1.4.2 Préférences — `app.prefs` (une ligne par user)
| Colonne | Type | Rôle |
|---|---|---|
| `user_id` | bigint PK, FK → app.users **ON DELETE CASCADE** (RGPD) | propriétaire |
| `prefs` | jsonb NOT NULL DEFAULT '{}' | `{"<slug>": {"enabled": bool, "config": {...}}}` |

LDP : ressource **unique** par utilisateur `https://<pod>/prefs/<user_id>` (décision B1/B3 :
ressource aplatie avec colonne jsonb, PATCH atomique — et non `/users/<pk>/prefs`).
PUT/PATCH merge-patch pour modifier. RLS : `auth.can` sur l'IRI → un utilisateur ne voit/modifie
**que** ses prefs ; pour un autre user, la ligne est filtrée par RLS → le PEP rend **404** (décision
§1.9.10 : ne divulgue pas l'existence). Trigger à la création d'un user : prefs par défaut depuis
`app.features.default_enabled` **et** ACL owner-webid (read/write/control) sur `/prefs/<pk>` +
`role:admin` (M2) ; backfill des users existants au déploiement via `012_backfill_prefs.sql`
(prefs + ACL, §1.9.4). À l'ajout d'une feature par l'admin : trigger sur INSERT `app.features` qui
injecte la clé par défaut dans toutes les prefs existantes.

## 1.5 Contrat LDP exposé (v1)

- `GET /features/` → catalogue (conteneur, `ldp:contains` = slugs) ; `GET /features/<slug>` → fiche.
- `GET /prefs/<user_pk>` → prefs de l'utilisateur connecté (RLS filtre les autres → **404**).
- `PATCH /prefs/<user_pk>` (merge-patch **RFC 7386 récursif**) — body conforme au mapping
  colonne→propriété, le jsonb n'est **pas** aplati à la racine (R1) :
  `{"prefs": {"building-map": {"enabled": false}}}` — la config des autres features est préservée
  par le merge récursif → nouvelle version.
- Erreurs `dspace:Error` ; ETag/If-Match comme le reste de l'endpoint ; `412` → recharger les prefs +
  toast « modifié entre-temps » (§1.9.9).

## 1.6 Composants et comportement (v1)

### 1.6.1 `<app-menu>` (dans le shell)
- Lit `window.appStore.mePrefsIri()` (= `/prefs/<pk>` extrait du claim webid) via
  `window.sibStore.getData()` ; s'abonne au PubSub du store sur cet IRI et à l'événement `save`.
- Rend un `solid-link` par feature `enabled=true` **et** `role_min` compatible du rôle courant
  (correspondance exacte, comme les `roles` des routes d'orbit.json ; `admin` voit tout), triées par
  `(menu_order, slug)`, en joignant au catalogue (les slugs inconnus des prefs sont ignorés, §1.9.4).
- Guard de route : écoute de l'événement `navigate` dans le shell + helper `window.appStore
  .isEnabled(slug)` → feature désactivée ou inconnue → redirect `/` (§1.9.7).

### 1.6.2 `<app-store>` (route `/store`, tout utilisateur authentifié ; admin édite les métadonnées)
- **Liste** : `ComponentObjectsHandler` sur `/features/` + prefs courante → toggle (switch) par
  feature ; badge « configuré » (définition §1.9.11) ; bouton « Configurer ».
- **Toggle** : PATCH merge-patch sur `/prefs/<user_pk>` avec body `{"prefs": {"<slug>": {"enabled":
  false}}}` (forme R1, §1.5) puis dispatch manuel de l'événement `save` (contrat §1.9.9) →
  `<app-menu>` et la route courante se mettent à jour à chaud.
- **Formulaire de config** : **modale dans `/store`** (§1.9.11), `solid-form` piloté par
  `config_schema`, écrivant la sous-clé `config` des prefs.
- **Admin (v1)** : édition des **métadonnées uniquement** des features déjà packagées
  (décision A8, §1.9.8) : title/description/icon/menu_order/config_schema/default_enabled.

### 1.6.3 Intégration Orbit (v1)
Toutes les features sont **déclarées au build** dans `orbit.json` (routes + composants, npm épinglé,
SRI au build). L'app store ne fait que les afficher/masquer/configurer — pas d'enregistrement
dynamique de composants en v1.

## 1.7 Sécurité (v1)

- Prefs : RLS/ACL owner-only (§1.4.2). Catalogue : lecture interne, écriture `admin`.
- Menu = UX uniquement ; jamais une barrière d'autorisation (§1.2.2).

## 1.8 Critères d'acceptation (v1)

- CA-A1 : `<app-menu>` affiche exactement les features `enabled=true` des prefs de l'utilisateur
  connecté, triées par `(menu_order, slug)` ; un PATCH de prefs met le menu à jour sans rechargement.
- CA-A2 : toggle dans `<app-store>` → PATCH merge-patch sur `/prefs/<user_pk>` avec body
  `{"prefs": {"<slug>": {"enabled": …}}}` (forme R1) → version créée, read-after-write immédiat,
  config des autres features préservée ; un autre utilisateur qui GET mes prefs → **404** (pas 403).
- CA-A3 : formulaire de config d'une feature écrit `config` conformément à `config_schema`
  (validation front en v1, §1.9.6).
- CA-A4 : route d'une feature désactivée → redirect `/` (guard shell + mixin).
- CA-A7 : `GET`/`PATCH`/`DELETE /features/<slug>` résolu via `resource_iri_pattern` (lookup slug→id
  côté PEP, M1) — prouvé par un test TCK.

## 1.9 Précisions tranchées (revues avant dev des composants)

1. **Ordre du menu** : `menu_order int NOT NULL DEFAULT 0` sur `app.features` ; tri du menu =
   `(menu_order ASC, slug ASC)`.
2. **i18n du catalogue (A2)** : `title_i18n`/`description_i18n` en **jsonb localisé dès la v1**
   (`{"fr": "…"}`) — le package est générique ; le front v1 est FR-only et lit `…_i18n[locale]` avec
   fallback `fr` puis `slug`. Pas de migration de schéma en v2.
3. **Icônes** : set autorisé = noms **Material Icons** ; fallback `extension` si le nom est inconnu.
4. **Features ajoutées/supprimées après coup** : (a) règle front « clé absente dans prefs =
   `default_enabled` » ; (b) trigger sur INSERT `app.features` qui injecte la clé par défaut dans
   toutes les prefs existantes ; (c) `012_backfill_prefs.sql` pour les users existants au
   déploiement ; (d) à la suppression d'une feature, le menu **joint au catalogue et ignore les
   slugs inconnus** des prefs, et un job de maintenance retire les clés fantômes des prefs jsonb.
5. **Champs transverses** : `created_at`/`updated_at` + trigger, versioning (`app.versions`),
   tombstone (`deleted_at`) sur `app.features` et `app.prefs` ; index sur `features.slug` (unique) ;
   `ON DELETE CASCADE` prefs→users ; `published=false` dans `dsp.asset_mapping` pour `/features/`
   et `/prefs/`.
6. **Validation de `config` contre `config_schema` (A6)** : **front seul en v1** (solid-form) ;
   validation PEP (409 `dspace:Error`, comme la décision K des transitions) prévue **en v2
   (post-v1)** (M3 : pas de « v2.1 » dans le phasage). Méta-schéma exact de `config_schema` (N1 :
   élargi à `object` et `array` pour couvrir le catalogue) :
   `{"fields": [{"key": string, "label": string,
   "type": "string"|"number"|"boolean"|"enum"|"object"|"array",
   "default"?: any, "options"?: string[] (si enum), "items"?: "string" (si array),
   "required"?: bool}]}` — `object` = jsonb libre, `array` = tableau de string.
   Note (M4) : les `label` ne sont **pas localisés** en v1 (front FR-only) — à localiser en v2
   (`label_i18n`) pour éviter une migration de schéma.
7. **Guard de route** : sib-router/Orbit n'a pas de guard natif → implémentation : le shell écoute
   `navigate` et redirige `/` si `!window.appStore.isEnabled(slug)` ; le package livre le helper
   `window.appStore.isEnabled(slug)` (lit les prefs en cache) et un `AppStoreGuardMixin` pour les
   composants de route, afin de ne rien réimplémenter par composant métier.
8. **Cohérence catalogue ↔ orbit.json (A8)** : en v1, l'admin édite **uniquement les métadonnées** des
   features déjà déclarées dans `orbit.json` (ajouter une feature = repackager l'app). Le menu
   n'affiche que les features dont la route existe (`window.orbit.getRoute`), et un check CI au build
   avertit si le seed du catalogue référence un composant/route inconnu.
9. **Contrat de l'événement `save`** : `sibStore.patch()` n'émet pas `save` tout seul — après le
   PATCH des prefs, `<app-store>` fait
   `document.dispatchEvent(new CustomEvent("save", {detail: {resource: {"@id": prefsIri}}}))` ;
   `<app-menu>` se rafraîchit via son abonnement PubSub sur cet IRI. `412` → recharger les prefs +
   toast « modifié entre-temps ».
10. **403 vs 404 pour les prefs d'un autre user** : décision **404** (la RLS filtre la ligne, le PEP
    rend la ressource comme inexistante — ne divulgue pas l'existence) ; à confirmer dans le PEP et à
    écrire dans le TCK (CA-A2).
11. **UX du formulaire de config** : « Configurer » ouvre une **modale dans `/store`** (pas de route
    dédiée en v1). Badge « configuré » = `config` non vide **et** différent des `default` du
    `config_schema` (comparaison JSON).
12. **`<me>`** : le pk est extrait du claim `webid` (`https://<pod>/users/<pk>` → `/prefs/<pk>`) via
    le helper `window.appStore.mePrefsIri()` ; un webid hors pod est **interdit en v1** (403).

---

# Partie 2 — v2 : chargement à chaud de composants distants (spécifié, non prioritaire)

Tout ce qui suit **s'ajoute** à la Partie 1 sans la modifier (les colonnes v2 vivent dans
`sql/020_features_v2.sql`, appliquées uniquement en v2).

## 2.1 Ce que v2 ajoute au modèle de données

- `app.features` + colonnes : `npm_package`, `version` (exacte, sans `^`), `cdn_url` (jsDelivr),
  `sri` (SHA-384), `tag` (custom element distant).
- `app.prefs.prefs` : chaque entrée de feature peut porter `installed_version`, `installed_sri`
  (version réellement chargée).

## 2.2 Ce que v2 implique techniquement

1. **Loader dynamique** : à l'activation d'une feature distante, le shell importe le module ES :
   `await import(cdn_url)` puis monte `<tag>` dans un hôte `<dynamic-feature>`.
2. **SRI et import dynamique — point dur** : l'attribut `integrity` ne s'applique qu'aux balises
   `<script>`, **pas** à `import()`. Il faut donc vérifier manuellement : `fetch(cdn_url)` →
   `crypto.subtle.digest('SHA-384', buf)` → comparaison avec `sri` du catalogue → import via
   `URL.createObjectURL(new Blob([src], {type:'text/javascript'}))`. Alternative plus simple :
   whitelist d'origines CDN + version épinglée, sans vérification de hash. **Décision v2 retenue :
   fetch + vérification SHA-384 manuelle avant import** (sinon un CDN compromis = XSS signé).
3. **Confirmation et audit** : boîte de dialogue « installer <package>@<version> ? » (affiche le
   sri) ; l'installation est enregistrée dans les prefs (`installed_version`, `installed_sri`) et
   auditée côté serveur (`dsp.audit` / log ORCE : webid, slug, version, ts).
4. **Révocation** : depuis l'app store, « désinstaller » → prefs mises à jour, module retiré du
   cache, élément désenregistré. Les features packagées (v1) ne sont pas « désinstallables ».
5. **Cache** : Cache API / service worker pour l'offline ; **upgrade** : si le catalogue annonce
   une version > `installed_version` → prompt de mise à jour (re-vérification du nouveau sri).
6. **Modèle de confiance** : un composant chargé a accès au `fetchAuthn` de l'utilisateur — donc à
   tout ce que l'utilisateur peut lire/écrire. La décision de confiance se prend **à
   l'installation** (UI explicite). Option post-v1 : bac à sable iframe + pont postMessage restreint
   (le composant distant ne touche pas directement à fetchAuthn).
7. **Menu** : `<app-menu>` inchangé (il lit les prefs) ; la route d'une feature distante est montée
   à la volée via `<dynamic-feature>`.

## 2.3 Ce que v2 ne change pas

Le PDP/ACL/RLS serveur : un composant distant tourne avec les credentials de l'utilisateur, rien de
plus. Les features à effet serveur restent gardées par le serveur quoi qu'affiche le menu.

## 2.4 Sécurité (v2)

- En plus de la sécurité v1 (§1.7) : version épinglée + sri vérifié avant chaque import ;
  confirmation utilisateur ; audit ; révocation.

## 2.5 Critères d'acceptation (v2)

- CA-A5 (v2) : activation d'une feature distante sans sri valide → refusée ; avec sri valide →
  import vérifié, composant monté, menu mis à jour ; révocation → composant retiré.
- CA-A6 (v2) : catalogue v2 (version > installée) → prompt upgrade avec re-vérification du hash.

## 2.6 Phasage et points ouverts (v2)

- **v1 à livrer d'abord** (Partie 1) : `model/app-store.model.json` + `sql/012_backfill_prefs.sql`,
  `<app-store>` + `<app-menu>`, intégration Orbit dans l'app de supervision (features de base, slugs
  du seed alignés sur `orbit.json` : `dashboard`, `anomalies`, `tickets`, `interventions`,
  `building-detail`, `store`, `admin` — voir `app-store-catalogue.md` §1).
- **v2 spécifiée ici, à valider** : la vérification manuelle du SRI sur `import()` dynamique (O-A1),
  et le choix bac à sable iframe vs confiance-à-l'installation (O-A2).
- **Chaînon back (L4)** : une feature distante qui a besoin de **tables** ne les crée pas elle-même
  côté front — elle passe par **E11** (`model-injection-spec.md` : `POST /admin/apps`, fragment de
  modèle, conteneurs `/apps/<slug>/…`, tables `store_<slug>_*` ; injection à chaud en v2 via E12).
  La Partie 2 ne décrit que le chargement du binaire (npm/CDN + SRI) ; le modèle est du ressort
  d'E11.
