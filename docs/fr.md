# Octopus Energy France

Suivez votre contrat **Octopus Energy France** (électricité et gaz, ex-Plüm
Énergie) dans Gladys : la consommation relevée par votre compteur Linky ou
Gazpar, son coût, le solde de votre compte, la prochaine échéance, et surtout
les **heures creuses** de votre contrat, à la minute près, pour lancer le
chauffe-eau ou la recharge de la voiture au bon moment.

L'électricité alimente aussi le **suivi d'énergie** de Gladys 5.2, jour par
jour, à la date où elle a vraiment été consommée, même quand Enedis transmet
les relevés avec un ou deux jours de retard.

> Sans lien avec Octopus Energy. **Developed without the hardware: feedback
> welcome** — développée sans compte Octopus Energy : vos retours sont les
> bienvenus (issues GitHub ou forum Gladys). Les échanges avec Octopus suivent
> ceux de l'intégration Home Assistant libre ha-octopus-french, mais n'ont pas
> pu être essayés avec un vrai compte.

## Présentation

- Un appareil Gladys par **point de livraison** : un compteur d'électricité
  (le numéro PRM de votre Linky) et un compteur de gaz (le numéro PCE de votre
  Gazpar), si votre contrat a les deux.
- **Électricité** : la consommation datée part dans le suivi d'énergie de
  Gladys ; s'y ajoutent la consommation et le coût du dernier jour relevé et
  du mois, le solde du compte, la prochaine échéance, le nom de l'offre, et la
  période tarifaire en cours (heures pleines ou heures creuses) avec son prix.
- **Gaz** : les mêmes bilans en kWh et en euros, le solde et la prochaine
  échéance.
- Un widget de tableau de bord, trois déclencheurs de scène et une action de
  scène.
- Le compte est lu toutes les 3 heures. Les heures creuses sont suivies à la
  minute, sans connexion à Octopus.

## Prérequis

- Gladys **5.2.0** ou plus récent (import d'une consommation datée dans le
  passé).
- Un contrat d'électricité ou de gaz chez **Octopus Energy France** et l'accès
  à votre espace client (adresse e-mail et mot de passe). Les clients
  d'Octopus au Royaume-Uni ou dans un autre pays ne sont pas concernés : leur
  plateforme est différente.
- Un compteur communicant (Linky, Gazpar) pour les consommations journalières.
  Sans lui, seuls le solde, l'échéance et le contrat sont affichés.
- Une connexion Internet pour votre Gladys : l'intégration parle à l'API
  d'Octopus Energy France (`api.oefr-kraken.energy`).

## Configuration

Installez l'intégration depuis **Intégrations → Installer depuis GitHub**
(ou depuis le store), puis remplissez :

| Champ                       | Ce qu'il faut mettre                                                                  |
| --------------------------- | ------------------------------------------------------------------------------------- |
| Adresse e-mail              | L'adresse de connexion à votre espace client Octopus Energy                           |
| Mot de passe                | Le mot de passe de cet espace client                                                  |
| Historique à importer       | Jours d'électricité envoyés au suivi d'énergie à la première lecture (7 jours à 1 an) |
| Langue des noms d'appareils | Langue des noms de fonctionnalités (français par défaut), fixés à l'ajout             |

Enregistrez : l'intégration se connecte, lit le compte et propose vos
compteurs dans l'onglet **Découverte**. Ajoutez-les ; leurs valeurs arrivent
aussitôt.

Le bouton **Se connecter et rafraîchir** relit le compte sans attendre le
cycle de 3 heures (une fois tous les quarts d'heure au plus).

Si Octopus refuse l'adresse ou le mot de passe, l'intégration s'arrête et ne
réessaie plus jusqu'à ce que vous corrigiez la configuration : trop d'échecs
pourraient bloquer votre compte.

## Appareils

Chaque compteur est un appareil nommé d'après l'énergie et les quatre
derniers chiffres de son numéro, par exemple « Octopus Électricité …0123 ».

### Compteur d'électricité

| Fonctionnalité                | Unité   | Ce que c'est                                                                                         |
| ----------------------------- | ------- | ---------------------------------------------------------------------------------------------------- |
| Consommation journalière      | kWh     | La consommation de chaque jour, datée, pour le suivi d'énergie de Gladys                             |
| Consommation du dernier jour  | kWh     | Le dernier jour complet relevé par Enedis (souvent avant-hier)                                       |
| Coût du dernier jour          | €       | Son coût TTC calculé par Octopus, hors abonnement                                                    |
| Consommation du mois          | kWh     | Le mois du dernier relevé, jusqu'à ce jour                                                           |
| Coût du mois                  | €       | Son coût TTC hors abonnement, seulement si chaque jour du mois a un coût                             |
| Solde du compte               | €       | Le solde de votre compte d'électricité chez Octopus : positif en votre faveur, négatif si vous devez |
| Prochaine échéance            | €       | Le montant du prochain prélèvement prévu                                                             |
| Date de la prochaine échéance | texte   | Sa date                                                                                              |
| Offre                         | texte   | Le nom de votre offre                                                                                |
| Heures creuses en cours       | oui/non | 1 pendant les heures creuses de votre contrat, 0 sinon                                               |
| Période tarifaire             | texte   | « Heures creuses », « Heures pleines » ou « Base »                                                   |
| Prix du kWh en cours          | €       | Le prix TTC du kWh de la période en cours                                                            |
| Heures creuses du contrat     | texte   | Les plages d'heures creuses, par exemple « 22:00–06:00 »                                             |

### Compteur de gaz

Les mêmes bilans, sans la consommation journalière ni les heures creuses :
**Consommation du dernier jour**, **Coût du dernier jour**, **Consommation du
mois**, **Coût du mois** (en kWh, comme sur vos factures), **Solde du
compte**, **Prochaine échéance**, **Date de la prochaine échéance** et
**Offre**. Octopus ne donnant pas le coût des relevés de gaz, il est calculé au
prix TTC du kWh de votre contrat, hors abonnement. Un Gazpar qui ne transmet
qu'un relevé mensuel n'affiche que le mois.

## Suivi d'énergie

Enedis transmet les relevés du Linky à Octopus avec un ou deux jours de
retard. Gladys 5.2 sait importer une consommation datée dans le passé :
l'intégration envoie chaque jour à sa vraie date, par le point d'entrée dédié
du cœur, et renvoie les trois derniers jours à chaque lecture (Enedis corrige
parfois ses relevés récents ; Gladys n'écrit que ce qui change). Les
graphiques d'énergie de Gladys et le coût calculé d'après votre contrat sont
donc justes malgré le retard.

Aucun index cumulé n'est publié, volontairement : Gladys transformerait un
index reçu avec un jour de retard en une seule demi-heure de consommation.

Pour que Gladys calcule les coûts, choisissez la fonctionnalité
**Consommation journalière** de votre compteur d'électricité comme compteur
principal dans les réglages d'énergie et créez-y votre contrat. Les
fonctionnalités **Coût du dernier jour** et **Coût du mois** viennent
d'Octopus et ne dépendent pas de ce contrat.

Le gaz n'est pas envoyé au suivi d'énergie : Gladys 5.2 ne valorise que
l'électricité, et une consommation de gaz s'ajouterait à celle de
l'électricité.

## Heures creuses et période tarifaire

L'intégration lit les heures creuses de votre contrat, de la source la plus
précise à la moins précise :

1. les plages du tarif heures creuses de votre contrat Octopus ;
2. le calendrier fournisseur de votre compteur ;
3. les heures creuses que le Linky annonce (« HC (22H00-6H00) »).

Chaque minute, sans connexion à Octopus, elle en déduit la période en cours,
en heure légale française (changements d'heure compris), publie **Heures
creuses en cours**, **Période tarifaire** et **Prix du kWh en cours**, et
déclenche les scènes au changement de période.

- Offre **Base** : une seule période, toute la journée.
- Offre **heures pleines / heures creuses** : la période et son prix.
- Offre **à deux saisons** (heures pleines et creuses d'été et d'hiver) : les
  plages et le prix de la saison en cours.
- Offre de type **Tempo** : la période est donnée, mais pas le prix, qui
  dépend de la couleur du jour qu'Octopus n'annonce pas dans le compte.

## Widget de tableau de bord

**Octopus Energy** affiche, pour un compteur (le premier compteur
d'électricité si vous n'en choisissez pas) : la date du dernier relevé, la
consommation de ce jour et du mois, leur coût, les 14 derniers jours en
barres, la période tarifaire en cours et jusqu'à quand, le prix du kWh, le
solde du compte et la prochaine échéance. Il se met à jour à chaque lecture
et à chaque changement de période. Quand la configuration manque ou que le
mot de passe est refusé, le widget le dit.

## Déclencheurs et action de scène

- **Début des heures creuses** (déclencheur) : se déclenche à la minute où
  commencent les heures creuses de votre contrat. Choisissez éventuellement
  le compteur. Variables : la fin des heures creuses (`until`, HH:MM) et le
  prix en heures creuses (`price`, €/kWh).
- **Fin des heures creuses** (déclencheur) : se déclenche à la minute où
  elles finissent et où commencent les heures pleines. Variables : l'heure
  des prochaines heures creuses (`until`) et le prix en heures pleines
  (`price`).
- **Nouvelle journée relevée** (déclencheur) : Octopus a reçu une nouvelle
  journée complète du Linky ou du Gazpar, souvent un ou deux jours après.
  Filtrez éventuellement sur le compteur ou l'énergie. Variables : le jour
  (`date`, AAAA-MM-JJ), sa consommation (`consumption`, kWh) et son coût
  (`cost`), la consommation et le coût du mois (`month_consumption`,
  `month_cost`), l'énergie (`energy` : `electricity` ou `gas`). Déclenché
  une fois par nouveau jour ; la première lecture après l'installation ne fait
  que fixer le point de départ.
- **Lire le bilan d'un compteur Octopus** (action) : donne le dernier jour
  relevé, sa consommation et son coût, la consommation et le coût du mois, le
  solde, la prochaine échéance et sa date, la période tarifaire (`base`,
  `peak` ou `off_peak`) et le prix en cours, pour les actions suivantes de la
  scène. Un chiffre inconnu reste vide.

Pourquoi des déclencheurs en plus de **Heures creuses en cours** ? L'état est
republié régulièrement (toutes les 6 heures) pour que Gladys ne le croie pas
périmé : une scène « quand l'état vaut 1 » pourrait se relancer. Les
déclencheurs, eux, ne partent qu'une fois, au changement de période, et jamais
au redémarrage. Utilisez l'état comme **condition** (« seulement en heures
creuses ») et les déclencheurs pour **démarrer** une scène.

## Exemples de scènes

- **Chauffe-eau en heures creuses** : déclencheur _Début des heures creuses_
  → allumer la prise du chauffe-eau ; déclencheur _Fin des heures creuses_ →
  l'éteindre.
- **Recharge de la voiture** : déclencheur _Début des heures creuses_ →
  allumer la borne, envoyer « Recharge lancée jusqu'à
  {{triggerEvent.data.until}} ».
- **Lave-linge différé** : quand le bouton « lancer plus tard » est pressé,
  condition **Heures creuses en cours** = 1 → démarrer tout de suite, sinon
  attendre le déclencheur.
- **Bilan quotidien** : déclencheur _Nouvelle journée relevée_ (énergie :
  électricité) → message « {{triggerEvent.data.date}} :
  {{triggerEvent.data.consumption}} kWh, {{triggerEvent.data.cost}} €. Mois :
  {{triggerEvent.data.month_cost}} €. »
- **Bilan hebdomadaire** : scène planifiée le dimanche → _Lire le bilan d'un
  compteur Octopus_ → message avec le coût du mois et le solde.

## Rafraîchissement et quotas

- Une lecture du compte toutes les 3 heures ; nouvel essai au bout d'une
  heure si Octopus ne répond pas ou demande de ralentir (limite de requêtes
  de l'API, erreur KT-CT-1199).
- Une lecture coûte une dizaine de requêtes : la connexion (le jeton
  d'accès dure une heure, le jeton de renouvellement une semaine, sans
  renvoyer le mot de passe), la liste des comptes, le compte, et les relevés
  de chaque compteur. La première lecture importe l'historique choisi :
  quatre requêtes de plus pour un an. L'intégration Home Assistant lit toutes
  les heures : c'est trois fois moins.
- Les heures creuses sont calculées dans Gladys, sans requête.
- L'intégration s'interroge elle-même : elle ne dépend pas du sondage de
  Gladys.
- Les conditions d'utilisation d'Octopus Energy s'appliquent à votre compte :
  cette intégration ne lit que vos propres données, en lecture seule.

## Dépannage

- **« Octopus Energy refuse l'adresse e-mail ou le mot de passe »** :
  vérifiez-les en vous connectant à votre espace client Octopus, puis
  corrigez la configuration (l'intégration réessaie alors aussitôt).
- **« Octopus Energy est injoignable »** : l'API n'a pas répondu ; nouvel
  essai dans l'heure. Si cela dure, Octopus a peut-être changé son API :
  ouvrez une issue GitHub avec les journaux.
- **Aucun compteur proposé** : le compte n'a encore aucun point de livraison
  actif (un compteur résilié n'est pas proposé).
- **Le dernier jour date d'avant-hier** : normal, Enedis et GRDF transmettent
  les relevés avec retard.
- **Pas de consommation journalière** : votre compteur n'est peut-être pas
  communicant, ou vous n'avez pas autorisé la collecte de vos données de
  consommation dans votre espace client.
- **Pas de période tarifaire** : Octopus n'a donné ni les plages d'heures
  creuses du contrat, ni celles du compteur. Signalez-le avec le nom de votre
  offre.
- **Journaux** : mettez `LOG_LEVEL=debug` pour voir chaque lecture. Les
  journaux ne montrent jamais l'adresse e-mail, le mot de passe ni les jetons.

## Limites

- **Developed without the hardware: feedback welcome** — développée sans
  compte Octopus. Les requêtes suivent celles de l'intégration Home Assistant
  ha-octopus-french, pas un essai réel : les premiers essais peuvent révéler
  des différences.
- Les relevés ont un ou deux jours de retard : pas de puissance instantanée,
  pas de « aujourd'hui ». Pour le temps réel, utilisez un module de
  téléinformation sur votre Linky.
- Le suivi d'énergie reçoit des jours, pas des demi-heures : un contrat
  heures pleines / heures creuses créé dans Gladys ne peut pas répartir un
  jour entre les deux tarifs. Les fonctionnalités de coût d'Octopus, elles,
  le font.
- Le gaz est hors du suivi d'énergie.
- Offres Tempo : pas de prix en cours, ni de couleur du jour. Les offres
  pilotées (Octopus Intelligent, recharge de véhicule) ne sont pas prises en
  charge.
- Le coût du gaz est estimé au prix du kWh de votre contrat ; les coûts
  n'incluent jamais l'abonnement.
- Une seule connexion par intégration ; tous les comptes et compteurs de
  cette connexion sont proposés.
- Aucune commande : l'intégration ne pilote rien chez Octopus.

## Confidentialité et données

L'adresse e-mail et le mot de passe restent dans la configuration de Gladys.
Le fichier `/data/octopus-state.json` garde le jeton de renouvellement
d'Octopus (pour ne pas renvoyer le mot de passe à chaque lecture) et, pour
chaque compteur, jusqu'où le suivi d'énergie a été alimenté. Il n'est lisible
que par l'intégration. Rien n'est envoyé ailleurs qu'à l'API d'Octopus
Energy France et à votre Gladys.

## Crédits

Les requêtes GraphQL et la lecture des réponses d'Octopus Energy France sont
adaptées de [ha-octopus-french](https://github.com/domodom30/ha-octopus-french)
de domodom30 (licence MIT), l'intégration Home Assistant pour Octopus Energy
France ; ses tests ont fourni les formes de réponses utilisées dans les tests
ici. Octopus Energy, Linky, Gazpar, Enedis et GRDF sont des marques de leurs
propriétaires respectifs.
