---
layout: post
title: "Exchange Server : Circular Logging, sauvegardes, Preferred Architecture et ransomware"
description: "Circular Logging, copies DAG, lagged copy et sauvegarde indépendante : quels incidents chaque mécanisme permet-il de couvrir ?"
tags:
  - Exchange
  - Sauvegarde
  - Sécurité
---

Quand on commence à s'intéresser sérieusement aux sauvegardes Exchange, une question revient rapidement : pourquoi faut-il généralement désactiver le Circular Logging lorsqu'on utilise un logiciel de sauvegarde Exchange-aware ?

Et une seconde question arrive juste derrière : si Microsoft considère les sauvegardes traditionnelles comme inutiles dans sa Preferred Architecture, comment récupère-t-on les données en cas de ransomware ?

Pour comprendre, il faut commencer par les transaction logs d'Exchange.

## Les transaction logs : avant l'EDB

Exchange ne travaille pas directement dans le fichier `.edb` pour chaque opération.

Lorsqu'un message est reçu, supprimé ou déplacé, Exchange commence par écrire l'opération dans un transaction log.

Le principe est approximativement le suivant :

```text
Message reçu
     |
     v
Transaction log
E00xxxxx.log
     |
     v
Cache / mémoire Exchange
     |
     v
MailboxDatabase.edb
```

Ces fichiers journaux permettent notamment de garantir la cohérence de la base et de rejouer des transactions lors de certaines opérations de récupération.

Ils sont générés continuellement :

```text
E000000001.log
E000000002.log
E000000003.log
E000000004.log
...
```

Sans mécanisme de nettoyage, le volume contenant les logs finirait évidemment par se remplir.

Il existe principalement deux façons de les tronquer :

```text
Backup VSS réussi
      |
      v
Troncature des logs
```

ou :

```text
Circular Logging
      |
      v
Exchange tronque lui-même
les logs devenus inutiles
```

C'est précisément là que les deux philosophies commencent à diverger.

---

## Fonctionnement sans Circular Logging

Prenons une base Exchange avec le Circular Logging désactivé :

```powershell
Get-MailboxDatabase |
    Format-Table Name,CircularLoggingEnabled
```

On obtient par exemple :

```text
Name    CircularLoggingEnabled
----    ----------------------
DB01    False
```

Exchange conserve les transaction logs.

Une sauvegarde Exchange-aware utilisant VSS sauvegarde la base de manière cohérente avec Exchange.

Une fois une sauvegarde complète ou incrémentielle correctement terminée, les logs devenus inutiles peuvent être tronqués.

```text
Exchange
   |
   +--> DB01.edb
   |
   +--> transaction logs
              |
              v
       Backup Exchange-aware
              |
              v
        Backup validé
              |
              v
       Troncature des logs
```

Le système de sauvegarde participe donc indirectement à la gestion du cycle de vie des transaction logs.

Si les sauvegardes échouent pendant plusieurs jours, les logs peuvent continuer à s'accumuler.

C'est d'ailleurs un des premiers éléments à vérifier lorsqu'un volume contenant les journaux Exchange commence à se remplir anormalement.

---

# Circular Logging

Le Circular Logging change cette logique.

Avec :

```powershell
Set-MailboxDatabase DB01 -CircularLoggingEnabled $true
```

Exchange peut tronquer les anciens transaction logs lorsqu'ils ne lui sont plus nécessaires.

L'objectif principal est d'éviter une croissance infinie des fichiers journaux.

En simplifiant :

```text
E000001.log
E000002.log
E000003.log
E000004.log
E000005.log
     |
     v
transactions intégrées
et logs devenus inutiles
     |
     v
E000004.log
E000005.log
```

Les anciens logs peuvent ainsi disparaître sans attendre une sauvegarde.

Cela réduit considérablement le stockage nécessaire aux journaux mais modifie également la stratégie de sauvegarde et de restauration.

---

# Pourquoi désactiver le Circular Logging avec des backups traditionnels ?

Prenons un exemple.

Nous réalisons dimanche une sauvegarde :

```text
Dimanche

DB01.edb
+
logs disponibles au moment du backup
```

Les jours suivants, Exchange continue à générer des journaux :

```text
Lundi
E000101 -> E000500

Mardi
E000501 -> E000900

Mercredi
E000901 -> E001300
```

Lorsque la stratégie de sauvegarde s'appuie sur la conservation et la troncature des journaux Exchange, on veut que leur cycle de vie soit contrôlé par le mécanisme de backup plutôt que par le Circular Logging.

Microsoft distingue d'ailleurs explicitement les deux approches :

```text
Backup VSS
    |
    v
troncature après sauvegarde réussie
```

et :

```text
Circular Logging
    |
    v
Exchange gère lui-même
la troncature
```

Dans une architecture utilisant les backups pour la troncature des journaux, Microsoft recommande donc :

```text
Circular Logging = OFF
```

Il faut également tenir compte du fonctionnement précis du produit de sauvegarde utilisé, notamment pour les sauvegardes incrémentielles.

---

# Et dans un DAG ?

La situation devient plus intéressante avec une base répliquée dans un Database Availability Group.

Lorsqu'une base possède plusieurs copies et que le Circular Logging est activé, Exchange utilise le mécanisme de Continuous Replication Circular Logging, ou CRCL.

Le service de réplication doit tenir compte des autres copies de la base avant de pouvoir supprimer certains journaux.

Par exemple :

```text
                 DB01 active
                     |
            transaction logs
                     |
          +----------+----------+
          |                     |
          v                     v
     DB01 copy             DB01 copy
       EXCH02                EXCH03
```

Un journal encore nécessaire à une copie passive ne peut pas simplement disparaître.

Avec une lagged copy, la gestion des journaux doit également tenir compte du délai de replay configuré.

C'est ce fonctionnement qui permet d'utiliser le Circular Logging dans une architecture basée sur Exchange Native Data Protection.

---

# La Preferred Architecture Microsoft

C'est ici qu'arrive une recommandation Microsoft qui peut sembler étrange lorsqu'on vient du monde des sauvegardes traditionnelles.

Dans sa Preferred Architecture, Microsoft estime qu'avec l'ensemble des mécanismes natifs de résilience Exchange, les sauvegardes traditionnelles ne sont plus nécessaires.

Cela ne signifie pas qu'elles ne sont plus supportées.

Microsoft propose simplement une autre philosophie :

```text
Restaurer une base après une panne
```

devient :

```text
Activer une autre copie de la base
```

La Preferred Architecture prévoit quatre copies de chaque base, distribuées entre deux datacenters :

```text
                  DB01

        +-----------+-----------+
        |           |           |
        v           v           v

     copie 1     copie 2     copie 3
     active        HA           HA

                                +
                                |
                                v

                           copie lagged
                              7 jours
```

On obtient donc :

```text
3 copies haute disponibilité
+
1 lagged database copy
```

La quatrième copie est configurée avec un `ReplayLagTime` de sept jours.

---

# Pourquoi Microsoft préfère cette approche ?

Imaginons une base Exchange de plusieurs téraoctets qui devient indisponible.

Avec une sauvegarde classique :

```text
DB perdue
   |
   v
récupération du backup
   |
   v
restauration de plusieurs To
   |
   v
replay éventuel des logs
   |
   v
remontage
```

Avec un DAG :

```text
DB01 active
    |
    X panne
    |
    v
DB01 passive
    |
    v
activation
```

Le service peut revenir beaucoup plus rapidement.

La Preferred Architecture traite ainsi directement plusieurs scénarios :

| Incident | Mécanisme |
|---|---|
| Disque HS | autre copie de DB |
| Serveur Exchange HS | autre membre du DAG |
| Datacenter HS | copies de l'autre datacenter |
| Corruption logique | lagged copy |
| Message supprimé | Single Item Recovery / rétention |
| Base HS | activation d'une copie saine |

Microsoft appelle cette stratégie :

```text
Exchange Native Data Protection
```

Dans ce modèle, Microsoft recommande l'utilisation du Circular Logging / CRCL plutôt que de conserver les logs dans l'attente d'un backup.

---

# Deux philosophies différentes

On peut donc résumer les recommandations Microsoft ainsi.

## Architecture utilisant des backups

```text
DB + logs
    |
    v
Backup VSS Exchange-aware
    |
    v
Backup réussi
    |
    v
Troncature des logs

Circular Logging : OFF
```

## Exchange Native Data Protection

```text
                DB active
                    |
          +---------+---------+
          |         |         |
          v         v         v
       HA copy   HA copy   lagged copy

               DAG
                |
                v
        plusieurs copies

Circular Logging / CRCL : ON
```

---

# Mais qu'en est-il d'un ransomware ?

C'est là qu'il faut distinguer haute disponibilité et cyber-résilience.

Un DAG est avant tout un mécanisme de réplication et de haute disponibilité.

Ce n'est pas nécessairement une sauvegarde indépendante.

## Ransomware limité à un serveur Exchange

Si un ransomware chiffre uniquement EXCH01 :

```text
EXCH01     DB01 active      HS
EXCH02     DB01 passive     OK
EXCH03     DB01 passive     OK
EXCH04     DB01 lagged      OK
```

Le DAG joue parfaitement son rôle.

Une copie saine peut être activée et le serveur compromis reconstruit.

---

# Suppression logique des données

Imaginons maintenant qu'un attaquant utilise Exchange lui-même pour supprimer massivement des messages.

Pour Exchange, cette suppression est une transaction parfaitement valide :

```text
Delete message
      |
      v
transaction log
      |
      +----> DB active
      |
      +----> DB passive
      |
      +----> DB passive
```

La réplication fonctionne parfaitement.

Le problème est justement qu'elle fonctionne parfaitement :

```text
DB active       données supprimées
DB passive      données supprimées
DB passive      données supprimées
```

Une réplication parfaite d'une mauvaise opération reste une mauvaise opération.

C'est précisément l'un des intérêts de la lagged database copy.

---

# La lagged copy

Avec :

```text
ReplayLagTime = 7 jours
```

les transaction logs arrivent sur la copie mais leur application dans la base est retardée.

Par exemple :

```text
Dimanche     état sain

Lundi        attaque
             suppression massive

Mardi        attaque détectée
```

Les bases actives et passives classiques contiennent déjà les suppressions.

La lagged copy peut en revanche encore représenter un état antérieur :

```text
DB active       état actuel
DB HA           état actuel
DB HA           état actuel

DB lagged       état antérieur
```

Elle peut ainsi permettre de récupérer rapidement d'une corruption logique catastrophique.

---

# Une lagged copy n'est pourtant pas un backup

Microsoft insiste sur ce point.

La lagged database copy n'est pas une sauvegarde point-in-time garantie.

Le Replay Lag Manager peut notamment décider de rejouer automatiquement les journaux lorsqu'il considère que la disponibilité globale des autres copies est insuffisante.

Microsoft indique d'ailleurs une disponibilité typique d'environ 90 % pour cette copie en tant que mécanisme de récupération.

Autrement dit :

```text
Lagged copy
    !=
Backup garanti
```

---

# Le véritable problème : le domaine de compromission

Supposons maintenant qu'un attaquant ne compromette pas simplement un serveur Exchange.

Il obtient des privilèges élevés dans Active Directory et sur l'infrastructure Exchange.

On peut alors arriver à :

```text
                Active Directory
                   compromis
                       |
             +---------+---------+
             |         |         |
             v         v         v
          EXCH01    EXCH02    EXCH03
             X         X         X
                       |
                       v
                    EXCH04
                  lagged copy
                       X
```

À ce moment-là, le fait d'avoir quatre copies de la base ne suffit plus forcément.

Les serveurs sont :

```text
connectés au même environnement
membres du même DAG
administrés depuis le même SI
dépendants du même Active Directory
```

Un attaquant disposant des privilèges nécessaires peut potentiellement atteindre les copies actives, passives et lagged.

C'est toute la différence entre :

```text
Haute disponibilité
```

et :

```text
Cyber Recovery
```

---

# DAG != backup

Il faut donc éviter le raisonnement :

```text
Nous avons quatre copies de la base,
donc nous avons quatre sauvegardes.
```

Ce n'est pas le cas.

Nous avons quatre copies répliquées.

La réplication protège très efficacement contre de nombreuses pannes, mais n'apporte pas nécessairement l'isolation d'une sauvegarde.

Et sur ce point, les recommandations de l'ANSSI sont particulièrement intéressantes.

L'ANSSI recommande notamment :

```text
Infrastructure de sauvegarde
indépendante des annuaires
de production
```

Autrement dit, une infrastructure Exchange dépendant de l'Active Directory de production ne devrait idéalement pas partager exactement le même domaine de confiance que son dernier niveau de sauvegarde.

L'ANSSI recommande également de réaliser régulièrement des sauvegardes hors ligne, c'est-à-dire déconnectées du système d'information.

Elle préconise également le principe :

```text
3 - 2 - 1
```

soit :

```text
3 copies des données
2 supports différents
1 copie hors ligne
```

L'objectif est précisément d'éviter qu'un attaquant ayant compromis le système de production puisse également détruire toutes les possibilités de restauration.

---

# Sauvegarde et comptes d'administration

L'ANSSI va également plus loin sur l'isolation administrative.

Les opérations de sauvegarde et de restauration doivent être considérées comme des opérations sensibles d'administration.

Les comptes d'administration de la plateforme de sauvegarde doivent donc être dédiés.

On évitera par exemple :

```text
DOMAIN\Domain Admin
        |
        +--> administration AD
        +--> administration Exchange
        +--> administration backup
```

au profit d'une séparation plus forte :

```text
Administration production
          |
       comptes A

Administration sauvegarde
          |
       comptes B
```

avec une infrastructure de sauvegarde aussi indépendante que possible de l'annuaire de production.

L'idée est simple :

> Si l'attaquant compromet le système d'identité de production, cela ne doit pas lui donner automatiquement les clés de la dernière copie permettant de reconstruire ce système.

---

# Peut-on cumuler lagged copy et backup ?

Oui.

Et c'est même une architecture très cohérente si l'on souhaite appliquer le principe "ceinture + bretelles".

Une lagged copy et un backup ne remplissent pas le même rôle.

On peut par exemple avoir :

```text
                         DB01
                          |
             +------------+------------+
             |            |            |
             v            v            v
          EXCH01        EXCH02       EXCH03
          Active        Passive      Passive
                                        |
                                        v
                                    EXCH04
                               Lagged copy 7j
```

et en parallèle :

```text
        Infrastructure Exchange
                  |
                  v
        Backup Exchange-aware
                  |
                  v
       Infrastructure de backup
        indépendante du SI de prod
                  |
                  v
          sauvegarde hors ligne
       ou fortement protégée
```

On dispose alors de plusieurs niveaux de récupération.

---

# Premier niveau : copie HA

La copie HA sert à la continuité de service.

```text
EXCH01 tombe
     |
     v
EXCH02 active DB01
```

C'est le mécanisme à privilégier en cas de panne matérielle ou de perte d'un serveur.

L'objectif est un RTO très faible.

---

# Deuxième niveau : lagged copy

La lagged copy permet de remonter rapidement dans le temps lorsque l'infrastructure Exchange est toujours considérée comme fiable.

Par exemple :

```text
Lundi      état sain

Mardi      suppression massive

Mercredi   découverte
```

Avec une lagged copy de sept jours :

```text
DB active       mercredi
DB HA           mercredi

DB lagged       état antérieur
```

La récupération peut alors être beaucoup plus rapide qu'une reconstruction depuis une sauvegarde externe.

Cette copie reste néanmoins dans l'environnement Exchange.

Elle ne constitue donc pas une copie indépendante du domaine de compromission.

---

# Troisième niveau : backup indépendant

Le backup apporte cette séparation.

Il doit permettre de couvrir des scénarios plus sévères :

```text
compromission Active Directory
compromission de tous les Exchange
suppression des bases
chiffrement des volumes
destruction du DAG
attaque découverte après la période de lag
```

Pour être réellement utile dans ce scénario, la plateforme de sauvegarde doit elle-même être protégée.

En reprenant les recommandations ANSSI :

```text
Infrastructure indépendante
        +
Comptes administratifs dédiés
        +
Sauvegarde hors ligne
        +
Contrôle strict des accès
        +
Tests réguliers de restauration
```

Une sauvegarde que personne n'a jamais essayé de restaurer reste une hypothèse.

---

# Lagged copy et backup ne sont donc pas redondants

Une architecture de ce type peut sembler redondante :

```text
DAG
+
lagged copy
+
backup
```

mais chaque mécanisme couvre un besoin différent.

| Incident | Mécanisme privilégié |
|---|---|
| panne disque | copie HA |
| panne serveur | copie HA |
| panne datacenter | copie HA distante |
| corruption logique récente | lagged copy |
| suppression massive récente | lagged copy / rétention |
| compromission Exchange complète | backup indépendant |
| compromission Active Directory | backup isolé |
| attaque découverte après plusieurs semaines | backup |
| restauration très rapide | DAG / lagged copy |
| reconstruction cyber complète | backup |

La différence fondamentale peut se résumer ainsi :

> La lagged copy permet de revenir rapidement dans le passé tant que l'infrastructure Exchange est encore digne de confiance. Le backup indépendant permet de revenir dans le passé lorsque l'infrastructure Exchange elle-même ne l'est plus.

---

# Et le Circular Logging dans cette architecture ?

Si l'on utilise exclusivement Exchange Native Data Protection sans backup traditionnel, Microsoft recommande le Circular Logging / CRCL.

Mais lorsque la stratégie utilise les backups VSS pour gérer la troncature des logs, la recommandation Microsoft est :

```text
Circular Logging = OFF
```

Microsoft distingue très clairement ces deux cas dans ses recommandations de stockage :

```text
Backup utilisé pour la troncature
        |
        v
Circular Logging OFF
```

contre :

```text
Exchange Native Data Protection
        |
        v
Circular Logging ON
```

Il ne faut donc pas activer le Circular Logging uniquement parce qu'un DAG existe.

La décision dépend de la stratégie globale de protection des données.

---

# Une architecture "ceinture + bretelles"

On peut finalement obtenir quelque chose de ce genre :

```text
                    PRODUCTION

              Datacenter A
         +-----------------------+
         |                       |
      EXCH01                  EXCH02
       Active                  Passive
         |                       |
         +---------- DAG --------+
                    |
                    |
              Datacenter B
         +-----------------------+
         |                       |
      EXCH03                  EXCH04
       Passive                Lagged
                              7 jours


                    +
                    |
                    v

               CYBER RECOVERY
             ------------------
             Backup Exchange-aware
                    |
                    v
          Infrastructure de backup
        indépendante de l'AD de prod
                    |
                    v
            sauvegarde hors ligne
          / stockage très protégé
                    |
                    v
             comptes dédiés
```

Dans ce modèle :

```text
DAG
=
haute disponibilité

Lagged copy
=
retour rapide dans le temps

Backup indépendant
=
dernier recours cyber
```

Ce n'est pas simplement de la duplication.

Ce sont trois mécanismes répondant à trois problèmes différents.

---

# Preferred Architecture et Cyber Recovery

La protection Exchange peut donc être séparée en deux grandes couches.

Première couche :

```text
          EXCHANGE NATIVE DATA PROTECTION

                   DB active
                       |
             +---------+---------+
             |         |         |
             v         v         v
          HA copy   HA copy   lagged copy

              haute disponibilité
              panne matérielle
              panne serveur
              panne datacenter
              corruption logique
```

Deuxième couche :

```text
                    CYBER RECOVERY

Exchange / Active Directory
             |
             |
             v
     sauvegarde indépendante
             |
             v
    infrastructure distincte
             |
             v
       copie hors ligne
             |
             v
    comptes d'administration
          séparés
```

La première couche permet surtout de conserver un RTO très faible.

La seconde permet de traiter un scénario beaucoup plus grave : la compromission du système de confiance qui administre Exchange lui-même.

---

# Faut-il donc encore sauvegarder Exchange ?

Tout dépend du risque que l'on souhaite couvrir.

La Preferred Architecture Microsoft est cohérente.

Avec :

```text
plusieurs copies de bases
+
deux datacenters
+
lagged copy
+
Single Item Recovery
+
rétention
+
Safety Net
```

de nombreuses situations historiquement traitées par restauration de sauvegarde peuvent maintenant être traitées directement par Exchange.

Pour une panne de disque ou de serveur, restaurer plusieurs téraoctets depuis un backup serait même une solution particulièrement inefficace alors qu'une copie passive est immédiatement disponible.

Mais il faut éviter d'en déduire :

```text
DAG = backup
```

ou :

```text
lagged copy = sauvegarde indépendante
```

Ce n'est pas le cas.

Si la compromission Active Directory ou Exchange fait partie des scénarios de risque, ajouter un système de sauvegarde indépendant reste parfaitement cohérent.

Et les recommandations de l'ANSSI vont justement dans ce sens : indépendance vis-à-vis des annuaires de production, comptes dédiés, sauvegardes hors ligne et tests réguliers de restauration.

---

# En résumé

Dans une architecture utilisant des backups Exchange-aware :

```text
Backup
  |
  +--> protège les données
  |
  +--> permet la restauration
  |
  +--> participe à la troncature des logs
```

On retrouve généralement :

```text
Circular Logging = OFF
```

Dans une Preferred Architecture reposant uniquement sur Exchange Native Data Protection :

```text
DAG
+
plusieurs copies
+
lagged copy
+
rétention
+
Single Item Recovery
```

Microsoft recommande :

```text
Circular Logging / CRCL = ON
```

Mais les deux philosophies peuvent également être combinées :

```text
DAG
+
lagged copy
+
backup indépendant
+
copie hors ligne
```

On obtient alors plusieurs lignes de défense :

```text
Panne
   |
   v
copie HA

Corruption logique
   |
   v
lagged copy

Compromission générale
   |
   v
backup indépendant
```

Les trois phrases à retenir sont finalement :

```text
Réplication != sauvegarde

Haute disponibilité != Cyber Recovery

Lagged copy != copie indépendante
```

La question n'est donc pas simplement :

"Faut-il sauvegarder Exchange ?"

La véritable question est :

**"Contre quels scénarios voulons-nous être capables de restaurer Exchange ?"**

## Sources

### Microsoft

- Microsoft Learn - ["Architecture préférée Exchange Server"](https://learn.microsoft.com/fr-fr/exchange/plan-and-deploy/deployment-ref/preferred-architecture)
- Microsoft Learn - ["Options de configuration du stockage Exchange Server"](https://learn.microsoft.com/fr-fr/exchange/plan-and-deploy/deployment-ref/storage-configuration)
- Microsoft Learn - ["Gestion des copies de base de données de boîtes aux lettres"](https://learn.microsoft.com/fr-fr/exchange/high-availability/manage-ha/manage-database-copies)

### ANSSI

- ANSSI - ["Les Essentiels - Sauvegarde des systèmes d'information"](https://messervices.cyber.gouv.fr/guides/sauvegarde-des-systemes-dinformation)
- ANSSI - ["Les fondamentaux - Sauvegarde des systèmes d'information"](https://messervices.cyber.gouv.fr/guides/fondamentaux-sauvegarde-systemes-dinformation)
- ANSSI - ["Les mesures cyber préventives prioritaires"](https://messervices.cyber.gouv.fr/guides/les-mesures-cyber-preventives-prioritaires)
- ANSSI - ["Guide d'administration sécurisée des systèmes d'information"](https://messervices.cyber.gouv.fr/guides/recommandations-relatives-ladministration-securisee-des-si)
