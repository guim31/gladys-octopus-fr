# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration**: a Node.js service (Node 22+, ESM,
no build step) that runs in its own sandboxed Docker container and talks to
Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js),
its only runtime dependency. It started from the official JavaScript template.

This one follows an Octopus Energy France contract: it signs in to the Kraken
GraphQL API of Octopus France (`api.oefr-kraken.energy`), reads the supply
points (Linky, Gazpar), the agreements and their rates, the ledgers and the
daily measurements, and computes the tariff period of the contract every
minute. Electricity feeds the Gladys 5.2 energy tracking through dated daily
consumption (`publishEnergyConsumption`).

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/app.test.js              # one file
node --test --test-name-pattern "off-peak" # tests whose name matches
node scripts/probe.mjs                    # live API, read-only (needs Internet)
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npx github:GladysAssistant/integration-store .   # store admission checks
```

The CI (`.github/workflows/ci.yml`) runs `format:check`, `lint` and `test` on
Node 22 and 24, and builds the Docker image: run the three commands before
pushing.

## Architecture

```
index.js                          SDK wiring only: createApp + registerHandlers, then connect()
src/app.js                        the cloud cycle, the clock, the refresh action, widget, scene action
src/poller.js                     the container's timers: 3-hour cloud cycle, 1-minute clock
src/octopus/client.js             Kraken GraphQL client: sign-in, refresh token, errors, pages
src/octopus/queries.js            the GraphQL documents (adapted from ha-octopus-french, MIT)
src/octopus/parse.js              pure: raw account → supply points; measurement → kWh and cost
src/tariff.js                     pure: off-peak ranges of a contract, tariff period of an instant
src/summary.js                    pure: measurements → French days, daily feed, last day / month
src/meters.js                     one device per supply point, feature keys, states
src/widgets.js                    the "energy_summary" widget content (pure)
src/store.js                      /data/octopus-state.json (0600): refresh token, per-meter cursor
src/time.js, src/issues.js        Paris time without a library; failures logged once
src/i18n.js, src/config.js        texts in four languages; DEFAULT_CONFIG mirrors the manifest
scripts/probe.mjs                 checks the live API read-only (schema, made-up account, real one)
gladys-assistant-integration.json manifest: name, config_schema, actions, image...
docs/{en,fr,de,es}.md             user documentation, re-hosted by Gladys, same sections
test/                             node --test, SDK fake Gladys + test/helpers/kraken-server.js
.github/scripts/release.mjs       release helpers (manifest bump, changelog), tested in test/
```

## Rules

- **External ids are forever.** Build them with
  `gladys.externalIds(type, platformId)`, `platformId` being the unique id the
  platform gives the device (serial, cloud id, MAC), never a label. Gladys keys
  devices, their history, scenes and dashboards on them: changing one creates a
  new device and orphans the old one. The same goes for every key users store:
  manifest `config_schema`, `actions`, widget and scene keys, feature keys.
- **The container rootfs is read-only.** Write only under `/data`, the one
  writable volume. Never log tokens, passwords or API keys.
- **Versions belong to the Release workflow** (Actions → Release). Never edit
  `version` in `package.json` or in the manifest, nor the `docker_image` tag,
  by hand — except on the README's hand-pushed tag path, which bumps all three
  together before tagging. `test/manifest.test.js` checks they agree.
- **Changelog.** Every user-visible change adds a line under `## [Unreleased]`
  in `CHANGELOG.md` (`### Added`, `Changed`, `Fixed`, `Removed`, `Security`).
  Never write a version heading: the Release workflow moves the section, and it
  becomes the notes of the GitHub Release.
- **Manifest.** Texts are multi-language objects `{ "en": ..., "fr": ... }`:
  `label`, `description` and `placeholder` alike, never a plain string. The
  catalog `description` holds 10 to 100 characters per language. A field the
  older cores do not know needs a higher `gladys_version` minimum
  (`categories`: 4.86.0; `widgets`, `scene_triggers`, `scene_actions`,
  `type: "provider"`: 5.1.0). `test/manifest.test.js` ties the manifest to the
  code (defaults, action, scene and widget handlers): change both sides
  together.
- **User-facing text** is in four languages (English, French, German with
  "du", Spanish with "usted"): action messages, manifest texts, widget texts,
  feature names, and `docs/en.md`, `docs/fr.md`, `docs/de.md`, `docs/es.md`
  with the same sections. `test/i18n.test.js` enforces it.
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network.

---

# Notes du mainteneur (guim31)

Ce qui suit complète les règles du template ci-dessus. Ce sont des faits vérifiés dans le code du
cœur Gladys ou payés sur les intégrations déjà publiées par guim31. Ils ne se lisent pas dans le
code de ce dépôt. Compléter ce fichier quand un nouveau piège est découvert.

## Travailler sur ce dépôt

- Mêmes étapes que la CI, dans le même ordre : `npm ci`, `npm run format:check`, `npm run lint`,
  `npm test`. Prettier contrôle **aussi le Markdown** : lancer `npm run format` après avoir
  modifié ce fichier, le README ou la documentation, sinon la CI tombe.
- Une session de code n'a **ni instance Gladys ni appareil réel**. La suite de tests, le lint et
  le validateur du store sont les seules vérifications possibles : le test réel se fait ailleurs.
  Le dire, plutôt que de conclure que « ça marche ».
- **Tout le code de démonstration du template disparaît** : station météo, prise, lampe, caméra,
  capteur de mouvement, `src/weather.js`, leurs tests, leurs entrées du manifeste et de la
  documentation. Il ne reste que ce que l'intégration fait vraiment.
- **Publier n'est jamais le travail d'une session de code** : ni Release, ni tag, ni topic, ni
  version modifiée à la main. L'orchestrateur s'en charge une fois la PR fusionnée. Les workflows
  sont ceux du template : ne pas les modifier.
- Le dépôt est **public** : aucun secret, aucune adresse ni détail d'infrastructure privée, ni
  ici, ni dans les tests, ni dans les captures.

## Pièges du cœur Gladys

**Appareils et fonctionnalités**

- **Polling** : le planificateur n'interroge un appareil que si `should_poll: true` **et**
  `poll_frequency` vaut une valeur de la liste fixe, **en millisecondes** (1000, 2000, 10000,
  15000, 30000, 60000). Le template publie `poll_frequency: 300` sans `should_poll` : c'est faux,
  le cœur répond 400 à la découverte. Pour une cadence hors liste, publier `should_poll: false` et
  pousser les états depuis le conteneur, en gardant un `onPoll` de repli.
  **Piège du 5.2.0** (GladysAssistant/Gladys#3198, correctif #3199, relevé sur gladys-ping-wol) :
  un appareil **créé sans `should_poll`** n'est jamais sondé, même après correction du cœur (valeur
  stockée à la création), et la 5.2.1 du 13/10/2026 ne le corrige pas. **Le conteneur sonde donc
  lui-même** par un minuteur, qui saute un appareil sondé il y a moins d'une demi-période, en gardant
  `onPoll` comme repli ; seuls les appareils ajoutés (`gladys.devices`) sont lus. Un test le prouve
  sans appeler `onPoll`.
- **`min` et `max` sont NOT NULL** dans `t_device_feature`, y compris pour `text/text` : sans eux,
  « Ajouter à Gladys » échoue en HTTP 422. Mettre 0/0, comme Zigbee2MQTT.
- Un état publié sur une fonctionnalité **pas encore ajoutée** dans Gladys reçoit un 200 puis est
  jeté (simple ligne de log) : republier les états dans `onDeviceCreated`.
- `level-sensor/decimal` n'existe pas côté serveur. `light-sensor/binary` n'a pas de libellé dans
  le front (pastille vide) : préférer `input/binary`. Un `text/text` reçoit `{ text }`, jamais
  vide, sinon l'état est ignoré.
- **Détecteur d'ouverture (`opening-sensor`) : 0 = ouvert, 1 = fermé** (`OPENING_SENSOR_STATE`), à
  l'inverse de l'intuition et des autres détecteurs (mouvement, fuite, fumée : 1 = détecté). Une
  porte ouverte publiée à 1 s'affiche « Fermé » et fausse scènes et historique. Le figer par un test.
- **Un `external_id` de fonctionnalité ne change jamais d'appareil** d'une version à l'autre. UniFi
  1.5.2 avait sorti les ports PoE dans un appareil dédié, la 1.6.0 les a remis dans la passerelle avec
  les mêmes identifiants : ceux qui avaient ajouté l'appareil dédié ne peuvent plus « Mettre à jour » la
  passerelle (409 `external_id must be unique`). Pour regrouper, garder l'appareil existant
  (`gladys.getDevices()`) ou changer d'identifiant.
- Les **noms de fonctionnalités sont figés à la création**. Et quand une fonctionnalité est seule
  de son type sur l'appareil, le tableau de bord affiche le libellé générique du type à la place
  du nom publié.
- **Aucune commande d'appareil ne permet un choix multiple** : un `text/select` n'a qu'un choix
  actif.
- Un changement de structure fait proposer « Mettre à jour » dans l'onglet Découverte
  (`structure_changed`). Un changement des seules `supported_options` ne le déclenche pas.
- **Jauge** : l'aiguille se place par `(value - min) / (max - min)` des bornes de la
  fonctionnalité. `gauge_min`/`gauge_max` ne pilotent que les couleurs, et le cœur n'applique
  jamais `min`/`max` en écriture : ce sont des bornes d'affichage. Une valeur signée exige des
  bornes symétriques.
- Le cœur plafonne à **300 états par minute** et réévalue les scènes à chaque état : ne publier
  que les changements.
- Une intégration `device` ne reçoit pas la langue de l'utilisateur, une action de scène non
  plus (un widget, si) : prévoir un champ de config `language` si des textes partent du
  conteneur. Le superviseur injecte `TZ`, le fuseau de Gladys. La sandbox est limitée à 256 Mo.

**Formulaires de configuration et actions**

- Les champs `number` sont rendus **sans `step`** : le navigateur n'accepte alors que `min + k`.
  Min et défaut **entiers** seulement ; une valeur décimale passe par un `select` ou par un
  `string` parsé (virgule acceptée).
- Un champ `secret` dans les `fields` d'une **action** est impossible à remplir, et une action
  n'applique **aucun `default`** tout en exigeant les champs `required` (422). Issues
  GladysAssistant/Gladys#3154 et #3155.

**SDK 0.15 et journaux**

- SDK `@gladysassistant/integration-sdk` **^0.15.0** (12/10/2026) : `DEVICE_POLL_FREQUENCIES`, faux
  Gladys de test (`@gladysassistant/integration-sdk/testing`, à préférer à un faux maison),
  déduplication des états, `parseMdnsTxt`. Lire son README et son CHANGELOG.
- **Journaux calmes** (demande de Guilhem, 13/10/2026) : rien au niveau info pour un cycle normal de
  lecture, un état publié ou un message reçu. L'info ne garde que le cycle de vie : démarrage,
  connexion, perte et retour d'un appareil ou d'un service, erreurs utiles, une ligne par action de
  l'utilisateur. Le reste passe en debug (`LOG_LEVEL=debug`). Une erreur qui se répète écrit une ligne
  au premier échec et une au rétablissement, pas une par tentative. Jamais de secret ni d'adresse
  avec identifiants. Un test vérifie qu'un cycle normal n'écrit rien en info.
- **Heartbeat** : republier au moins toutes les 12 h une valeur qui ne change pas, sinon le front
  affiche « Pas de valeur récente » au-delà de 48 h.

**Widgets, déclencheurs, actions de scène (SDK ≥ 0.14, Gladys ≥ 5.1)**

- **Cibler la dernière version publiée du cœur, pas `master`** : la spec de `master` décrit des
  fonctions non publiées. Les boutons de widget qui ouvrent un formulaire (#3168, commit 3feb2cf8)
  sont absents de la 5.1.4 mais **livrés dans la 5.2.0** (sortie le 12/10/2026) : `gladys_version`
  `>=5.2.0` si on s'en sert, ou un bouton direct en repli. Vérifier par `git tag --contains`.

- Un réglage de widget ne propose en liste que les **appareils** de l'intégration
  (`source: "devices"`, seule source dynamique).
- Budget du cœur : **8 composants par widget, dont 2 textes au plus**, appliqué **avant** la
  résolution des références ; un contenu amputé reste en cache jusqu'au TTL. Appeler
  `requestWidgetRefresh` à la création d'un appareil. `validateWidgetContent` est exporté pour les
  tests, mais ne vérifie pas que les `external_id` liés existent : les croiser avec `buildDevice`.
- Une ligne de `status` exige un `value` (nombre ou texte ≤ 40).
- Le cœur **jette un bouton dont la clé d'action est déjà prise** : clés numérotées.
- Le vocabulaire des widgets n'a ni liste ni curseur, **par choix** du cœur. Seul un bouton
  `device_feature` numérique a un état actif natif.
- **En mode sombre, le style `primary` d'un bouton de widget ne se voit pas** (#3153) : signaler
  un choix courant par l'icône (`check-circle`), jamais par le style.
- Dans une grille `card-list`, la `date` s'affiche **à la place** du sous-titre.
- `onWidgetAction` fait recharger le widget dès la résolution, alors que `requestWidgetRefresh`
  est plafonné à un appel toutes les 10 s. Un toast d'action est tronqué à 200 caractères.
- Le cœur met le contenu d'un widget en cache par (réglages, langue, unités) : pré-localiser
  d'après `language` est correct.
- Les filtres de scène ne font qu'égalité et appartenance : un seuil reste le travail d'un capteur.
- **Les clés de widgets, de déclencheurs et d'actions sont figées une fois publiées.**
- `gladys_version` `>=5.1.0` dès qu'il y a widgets, déclencheurs ou actions de scène.

## Intégration Octopus Energy France : API et pièges

**Sources.** Requêtes GraphQL et lecture des réponses adaptées de `domodom30/ha-octopus-french`
(MIT, crédité dans le README et les docs). L'API de la France est une instance Kraken à part
(`https://api.oefr-kraken.energy/v1/graphql/`), différente d'Octopus UK. Le proxy des sessions de
code la refuse (403) : `scripts/probe.mjs` éprouve l'API réelle depuis une machine qui a le réseau
(introspection du schéma, faux compte → refus propre attendu, vrai compte → comptages seulement).
**Rien n'a encore été vérifié contre l'API réelle** : les formes viennent du code et des tests de
ha-octopus-french (fixtures `test/fixtures/kraken/`, anonymisées).

**Connexion.** `obtainKrakenToken(input: { email, password })` → jeton d'accès (JWT ~1 h, en-tête
`Authorization: JWT <jeton>`, comme ha-octopus-french) et jeton de renouvellement (~7 j,
`refreshExpiresIn`), gardé dans `/data` sous un hachage de l'e-mail : un redémarrage ne renvoie pas
le mot de passe. Kraken répond HTTP 200 avec `errors` : une erreur **avec `path`** levée par le
résolveur = identifiants refusés ; **sans `path`** = requête invalide (API changée), jamais lue
comme un mauvais mot de passe. `KT-CT-1199` = limite de débit (nouvel essai dans 1 h). Jeton
expiré en cours de requête (`KT-CT-1111/1112/1124` ou mots-clés) : une seule reconnexion. Les codes
d'erreur exacts sont à confirmer par la sonde. Un mot de passe refusé **arrête les essais** jusqu'à
un changement de config (risque de blocage du compte).

**Données.**

- Montants en **centimes** (`balance`, `nextPaymentForecast.amount`, `costInclTax.estimatedAmount`),
  prix unitaires en **c€/kWh** (`pricePerUnitWithTaxes`) : tout sort en euros de `parse.js`. Les
  nombres arrivent en chaînes, parfois `"0E-18"`.
- Relevés : `property(id).measurements` avec `utilityFilters: [{ electricityFilters | gasFilters:
{ readingFrequencyType: DAY_INTERVAL | MONTH_INTERVAL, marketSupplyPointId, readingQuality: ACTUAL
(électricité seulement) } }]`, paginés (`first`/`after`). Le jour d'un relevé = date de `startAt`
  **à Paris** (on voit des `startAt` à `T02:00:00+02:00`). Le coût d'un jour = somme des
  `costInclTax` des statistiques **sauf `ABONNEMENT`** ; le gaz n'a pas de montant : kWh × prix
  unique du contrat.
- Compteur résilié (`distributorStatus: RESIL` et `poweredStatus` absent ou `LIMI`) : non proposé.
  Deux compteurs de la même énergie : le ledger se trouve par le numéro entre parenthèses de son nom.
- Le « mois » est celui du **dernier relevé**, pas le mois civil (pas de faux zéro le 1er).

**Heures creuses** (`src/tariff.js`) : plages du tarif HC de l'accord (`timeSlots`
`"22:00:00"`), sinon description de la classe HC du calendrier fournisseur (`"0H50-6H50"`,
`"Novembre à mars, de 23h à 7h"`), sinon `offPeakLabel` du Linky (`"HC (22H00-6H00)"`), en heure de
Paris. Codes : `HP/HC/BASE`, deux saisons `HPB/HCB/HPH/HCH` (saison par les mois de la
description, avril–octobre par défaut), Tempo `HPE/HCE/HPHI/HCHI/HPP/HCP` (prix inconnu : couleur du
jour absente du compte). Tarifs sans classe : deux prix → le moins cher est HC.

**Gladys.**

- Électricité : `energy-sensor/daily-consumption` alimenté par `publishEnergyConsumption` (`date`
  = jour français, tamponné au minuit du fuseau de Gladys), 3 jours de recouvrement à chaque cycle,
  **aucun index**. Gaz : pas de consommation (le cœur la rattacherait au compteur électrique).
  Bilans en `energy-sensor/index-yesterday` (ignoré par la logique du cœur), coûts et solde en
  `currency/decimal` `euro`.
- Le front n'affiche le nom publié d'une fonctionnalité que si une autre de l'appareil a le même
  **type** (`matchFeature` de `front/src/utils/device.js` compare le seul `type`, pas la
  catégorie) : la seule `input/binary` (« Heures creuses en cours ») s'affiche donc sous le nom de
  l'appareil. Les `text/text`, `decimal` et `index-yesterday` sont plusieurs : noms visibles.
- Les états sont republiés toutes les 6 h (battement) : une scène « état = 1 » sur **Heures creuses
  en cours** pourrait se relancer. D'où les déclencheurs `off_peak_started`/`off_peak_ended`, une
  fois au changement, jamais au redémarrage (la première minute ne fixe que la référence).
- Deux minuteurs : cycle cloud de 3 h (≈ 5 requêtes, nouvel essai 1 h) et horloge d'une minute
  sans réseau. Une reconnexion à Gladys ne relit Octopus que si un cycle est dû.

**Pistes non faites** : capacité `energy_contracts` (la 5.2.1 la porte) pour publier les gabarits
de contrat Octopus ; clé d'API (non trouvée côté France) ; Octopus Intelligent (pilotage, hors
lecture seule).

## Store

- Validateur officiel, depuis la racine : `npx -y github:GladysAssistant/integration-store .`
  (schéma, `description` **100 caractères au plus par langue**, documentation de 300 caractères
  au moins, image Docker, cover de **150 Ko au plus**). Il demande Node ≥ 24 mais tourne sous
  Node 22 avec un avertissement.
- L'indexeur lit le manifeste de la **dernière release**, pas celui de `main` : une correction du
  manifeste (catégorie, description…) n'atteint le store qu'avec une release.
- L'indexeur rejette **en silence** : la raison n'apparaît que dans `rejected.json`, à côté de
  `https://integration-store-storage.gladysassistant.com/index.json`.
- **Image de base** : `FROM public.ecr.aws/docker/library/node:…` (miroir officiel ECR Public, même
  empreinte) et non `node:…` de Docker Hub, qui refuse en 429 les pulls anonymes des runners GitHub
  dès qu'il y a plusieurs builds à la fois. Un échec 429 dans le job « Docker build » n'est pas un bug
  du code. Même parade dans `.github/workflows/build.yml` (posée par l'orchestrateur, ne pas la
  retirer) : QEMU et BuildKit tirés de `mirror.gcr.io`.
- La règle `data/` du `.gitignore` du template (pour le volume `/data`) exclut aussi `src/data/` :
  l'ancrer en `/data/`, dans `.prettierignore` aussi.

### Langues (depuis le 11/10/2026)

Tout texte montré à l'utilisateur existe en **`en`, `fr`, `de` et `es`** : manifeste, contenu des widgets, messages,
noms de fonctionnalités. L'allemand **tutoie** (« du »), l'espagnol **vouvoie** (« usted ») : décision de Guilhem,
appliquée à ses 21 intégrations. `test/i18n.test.js` doit échouer sur une langue manquante, un texte vide ou trop
long, et sur un « Sie »/« Ihr… » de politesse en allemand. Le store exige `docs/en.md` et `docs/fr.md`
(`DOCS_LANGUAGES`) et publie aussi `docs/de.md` et `docs/es.md` quand ils existent
(`DOCS_OPTIONAL_LANGUAGES` d'integration-store) : écrire les quatre, avec les mêmes sections.

## Choix par défaut de Guilhem (12/10/2026)

- Langue par défaut des noms de fonctionnalités et des textes produits par le conteneur : **`fr`**.
- Fichier `LICENSE` Apache-2.0 (texte complet) à la racine.
- `transports` : `local` seul quand le cloud n'est qu'une option annexe.
- Docs `en`, `fr`, `de`, `es` avec les mêmes sections.
- Chauffe, ouverture, sécurité : ne rien rendre pilotable « comme un thermostat » ou par un assistant
  vocal quand une erreur serait dangereuse (leçon d'OctoPrint).
