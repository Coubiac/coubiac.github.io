---
layout: post
title: "Exchange Server : comprendre le JBOD, les points de montage et AutoReseed"
description: "Comprendre pourquoi Exchange peut utiliser des disques sans RAID pour les bases de données, le rôle des deux arborescences de points de montage et la reconstruction automatique assurée par AutoReseed."
tags:
  - Exchange Server
  - DAG
  - JBOD
  - AutoReseed
  - stockage
  - haute disponibilité
---

# Exchange Server : comprendre le JBOD, les points de montage et AutoReseed

Quand on vient de l'administration système classique, installer une base Exchange et ses journaux de transactions sur un disque sans RAID paraît assez risqué.

Dans une architecture Exchange correctement dimensionnée, la logique est pourtant différente : la résilience des données n'est plus assurée principalement par le stockage local, mais par les copies de bases réparties dans un groupe de disponibilité de base de données, ou DAG.

AutoReseed complète cette architecture en reconstruisant automatiquement les copies perdues sur un volume de réserve.

## Ce que signifie réellement JBOD dans Exchange

JBOD signifie "Just a Bunch Of Disks". Chaque disque constitue un volume indépendant et n'appartient pas à une grappe RAID protégeant les données Exchange.

Il ne faut pas confondre cette organisation avec un volume agrégé regroupant plusieurs disques :

```text
Disque 1 + Disque 2 + Disque 3 = un grand volume
```

Dans une architecture Exchange JBOD, le principe est au contraire :

```text
Disque 1 = Volume 1
Disque 2 = Volume 2
Disque 3 = Volume 3
```

Chaque disque reste ainsi un domaine de panne distinct.

Certains contrôleurs matériels ne permettent d'utiliser leur cache d'écriture qu'avec des volumes RAID. Dans ce cas, Microsoft autorise la création d'un RAID 0 composé d'un seul disque pour chaque volume. Il n'apporte aucune redondance, mais conserve fonctionnellement le modèle "un disque, un volume".

La [Preferred Architecture d'Exchange Server](https://learn.microsoft.com/en-us/exchange/plan-and-deploy/deployment-ref/preferred-architecture) conserve néanmoins une paire de disques en RAID 1 pour :

- le système d'exploitation ;
- les fichiers binaires d'Exchange ;
- les journaux des protocoles et des clients ;
- la base de données du service de transport.

Les autres disques peuvent être utilisés en JBOD pour les bases de boîtes aux lettres et leurs journaux de transactions.

## Le DAG remplace la redondance du RAID

Avec un stockage RAID traditionnel, la perte d'un disque ne doit pas provoquer la perte du volume.

Dans une architecture Exchange JBOD, la perte du volume est acceptée. C'est la copie locale de la base qui devient indisponible, mais les autres membres du DAG possèdent leurs propres copies.

Prenons une base `DB001` présente sur trois serveurs :

| Serveur | Copie de DB001 | État |
|---|---|---|
| MBX01 | Copie active | Mounted |
| MBX02 | Copie passive | Healthy |
| MBX03 | Copie passive | Healthy |

Si le disque de `MBX01` tombe en panne, la copie présente sur ce serveur est perdue. Exchange peut activer une copie saine sur `MBX02` ou `MBX03`.

La haute disponibilité porte donc sur la base Exchange, et non sur le disque qui héberge l'une de ses copies.

Cette architecture n'est valable qu'avec une redondance suffisante. Microsoft demande au minimum trois copies hautement disponibles d'une base pour utiliser le JBOD dans ce scénario. La Preferred Architecture va plus loin avec quatre copies réparties entre deux centres de données : trois copies hautement disponibles et une copie retardée.

Sur un serveur Exchange autonome, sans DAG, le JBOD serait une mauvaise solution. Microsoft recommande alors de protéger les volumes des bases et des journaux avec du RAID. Ces conditions sont détaillées dans les [recommandations de stockage d'Exchange Server](https://learn.microsoft.com/en-us/exchange/plan-and-deploy/deployment-ref/storage-configuration).

## Bases et journaux sur le même volume

Dans une architecture traditionnelle, il est fréquent de séparer le fichier `.edb` et les journaux de transactions sur des disques différents.

Avec le JBOD et plusieurs copies de bases, Microsoft permet de les regrouper sur le même volume :

```text
DB001
├── DB001.db
│   └── DB001.edb
└── DB001.log
    ├── E00.log
    └── E0000000001.log
```

Si le disque tombe en panne, la copie de la base et ses journaux sont perdus ensemble. Les autres copies du DAG assurent la continuité du service et fournissent la source nécessaire à la reconstruction.

## Pourquoi placer plusieurs bases sur le même volume

La Preferred Architecture permet de placer jusqu'à quatre copies de bases sur un même disque.

Il s'agit de copies de bases différentes :

```text
Volume1
├── copie de DB001
├── copie de DB002
├── copie de DB003
└── copie de DB004
```

Il ne s'agit pas de placer plusieurs copies de `DB001` sur le même volume. Une telle organisation n'apporterait aucune résilience : toutes les copies seraient perdues en même temps.

Cette possibilité répond notamment à l'utilisation de disques de grande capacité. Une organisation peut choisir de créer beaucoup de bases relativement petites afin de limiter le nombre de boîtes aux lettres contenues dans chacune d'elles.

Un disque de 10 To serait mal utilisé s'il ne contenait qu'une base de 1 ou 2 To. Plusieurs bases peuvent donc partager sa capacité tout en restant des objets Exchange indépendants.

Cette organisation facilite également :

- la répartition des bases actives entre les serveurs ;
- la limitation du nombre d'utilisateurs concernés par le démontage d'une base ;
- le déplacement d'une population de boîtes aux lettres ;
- la reconstruction d'une copie ;
- les opérations de maintenance et de récupération.

Le nombre de boîtes ne suffit toutefois pas à déterminer la taille d'une base. Quelques centaines de boîtes avec des quotas importants peuvent représenter plusieurs téraoctets.

## Répartir les bases actives entre les serveurs

Le placement de plusieurs bases sur un disque ne signifie pas que toutes doivent être actives simultanément sur ce disque.

Microsoft recommande de ne pas avoir plus d'une copie active par disque pendant le fonctionnement normal.

Avec quatre serveurs, la répartition peut ressembler à ceci :

| Serveur | Contenu du volume | Base active |
|---|---|---|
| MBX01 | DB001, DB002, DB003 et DB004 | DB001 |
| MBX02 | DB001, DB002, DB003 et DB004 | DB002 |
| MBX03 | DB001, DB002, DB003 et DB004 | DB003 |
| MBX04 | DB001, DB002, DB003 et DB004 | DB004 |

Chaque serveur possède une copie des quatre bases, mais leurs copies actives sont réparties.

Si le disque de `MBX01` tombe en panne, les quatre copies locales deviennent indisponibles. En revanche :

- seule `DB001` doit immédiatement être activée sur un autre serveur ;
- les copies actives de `DB002`, `DB003` et `DB004` continuent de fonctionner ;
- AutoReseed peut reconstruire les quatre copies perdues sur un volume de réserve.

Cette organisation permet donc d'utiliser efficacement la capacité des disques tout en répartissant la charge et l'impact d'une panne.

Elle augmente néanmoins le nombre d'objets à gérer : davantage de bases, de flux de journaux, de copies, de points de montage et d'états à superviser. Le découpage ne doit pas être poussé inutilement.

## Pourquoi utiliser des points de montage

Les lettres de lecteurs deviennent rapidement difficiles à gérer sur un serveur équipé de nombreux disques.

Windows permet de monter un volume dans un dossier vide :

```text
C:\ExchangeVolumes\Volume1
```

Le volume reste indépendant, mais il est accessible par ce chemin au lieu d'utiliser une lettre comme `E:` ou `F:`.

Il faut toutefois parler de points de montage Windows plutôt que de "dossiers NTFS". Les volumes Exchange peuvent être formatés en NTFS ou en ReFS. La Preferred Architecture actuelle recommande ReFS pour les volumes de données Exchange, avec les fonctions d'intégrité désactivées.

Avec NTFS comme avec ReFS, Microsoft recommande une unité d'allocation de 64 Ko pour les volumes contenant les bases et les journaux.

## Pourquoi un même volume possède plusieurs points de montage

AutoReseed utilise deux arborescences distinctes :

```text
C:\ExchangeVolumes
C:\ExchangeDatabases
```

Leur rôle n'est pas le même.

| Arborescence | Fonction |
|---|---|
| `C:\ExchangeVolumes` | Inventorier tous les volumes utilisables, y compris les volumes de réserve |
| `C:\ExchangeDatabases` | Présenter les emplacements logiques utilisés par les bases Exchange |

Un même volume peut être monté simultanément sous les deux chemins :

| Chemin | Volume réel | Fonction |
|---|---|---|
| `C:\ExchangeVolumes\Volume1` | Volume 1 | Présentation physique |
| `C:\ExchangeDatabases\DB001` | Volume 1 | Emplacement logique de DB001 |
| `C:\ExchangeVolumes\Volume2` | Volume 2 | Présentation physique |
| `C:\ExchangeDatabases\DB002` | Volume 2 | Emplacement logique de DB002 |
| `C:\ExchangeVolumes\Volume3` | Volume 3 | Volume de réserve |

Les deux chemins associés à `Volume1` donnent accès au même système de fichiers. Il ne s'agit pas de deux copies des données.

Le volume de réserve possède un point de montage sous `C:\ExchangeVolumes`, mais aucun sous `C:\ExchangeDatabases`. Cette différence permet au Disk Reclaimer d'identifier un volume disponible.

Les chemins utilisés par défaut par Exchange sont définis par les propriétés suivantes du DAG :

```powershell
AutoDagVolumesRootFolderPath
AutoDagDatabasesRootFolderPath
AutoDagDatabaseCopiesPerVolume
```

Il est possible de les afficher avec :

```powershell
Get-DatabaseAvailabilityGroup DAG1 |
    Format-List *Auto*
```

## Exemple de configuration simplifiée

L'exemple suivant utilise une base par volume :

```powershell
Set-DatabaseAvailabilityGroup -Identity DAG1 `
    -AutoDagVolumesRootFolderPath "C:\ExchangeVolumes" `
    -AutoDagDatabasesRootFolderPath "C:\ExchangeDatabases" `
    -AutoDagDatabaseCopiesPerVolume 1 `
    -FileSystem ReFS
```

Les dossiers racines et les points de montage peuvent ensuite être préparés sur chaque membre du DAG :

```text
C:\ExchangeVolumes\Volume1
C:\ExchangeVolumes\Volume2
C:\ExchangeVolumes\Volume3

C:\ExchangeDatabases\DB001
C:\ExchangeDatabases\DB002
```

Le même volume est monté sous les deux arborescences :

```powershell
mountvol C:\ExchangeVolumes\Volume1 \\?\Volume{GUID-VOLUME-1}\
mountvol C:\ExchangeDatabases\DB001 \\?\Volume{GUID-VOLUME-1}\

mountvol C:\ExchangeVolumes\Volume2 \\?\Volume{GUID-VOLUME-2}\
mountvol C:\ExchangeDatabases\DB002 \\?\Volume{GUID-VOLUME-2}\

mountvol C:\ExchangeVolumes\Volume3 \\?\Volume{GUID-VOLUME-3}\
```

`Volume3` n'est associé à aucune base. Il reste disponible pour AutoReseed.

La structure attendue pour `DB001` peut alors être créée :

```powershell
New-Item -ItemType Directory `
    -Path "C:\ExchangeDatabases\DB001\DB001.db"

New-Item -ItemType Directory `
    -Path "C:\ExchangeDatabases\DB001\DB001.log"
```

La base est créée en utilisant son chemin logique :

```powershell
New-MailboxDatabase `
    -Name DB001 `
    -Server MBX01 `
    -EdbFilePath "C:\ExchangeDatabases\DB001\DB001.db\DB001.edb" `
    -LogFolderPath "C:\ExchangeDatabases\DB001\DB001.log"
```

Le GUID du volume réellement utilisé peut être vérifié avec :

```powershell
mountvol C:\ExchangeDatabases\DB001 /L
```

Les chemins connus par Exchange peuvent également être contrôlés :

```powershell
Get-MailboxDatabase DB001 |
    Format-List Name,EdbFilePath,LogFolderPath
```

## Ce qui se passe lorsqu'un disque tombe en panne

Supposons que le disque correspondant à `Volume1` devienne indisponible.

Les copies présentes sur ce volume passent dans un état d'échec. Les autres copies du DAG peuvent être activées pour maintenir le service.

AutoReseed intervient ensuite selon plusieurs étapes :

1. Le service Microsoft Exchange Replication détecte les copies dans l'état `FailedAndSuspended`.
2. Lorsque toutes les copies présentes sur le volume restent dans cet état pendant 15 minutes consécutives, le workflow AutoReseed démarre.
3. Exchange tente d'abord de reprendre les copies afin d'écarter un problème temporaire.
4. Il vérifie la présence d'un volume de réserve et la conformité de l'arborescence.
5. Le Disk Reclaimer affecte le volume disponible, le remappe et le formate.
6. Exchange lance une opération `InPlaceSeed`.
7. Toutes les bases qui se trouvaient sur le disque défaillant sont reseedées depuis leurs copies actives.
8. Le service de réplication vérifie que les nouvelles copies sont saines.

AutoReseed ne remplace pas physiquement le disque en panne. L'installation du nouveau disque et sa préparation comme futur volume de réserve restent des opérations d'administration.

## Les deux arborescences résument toute la logique

Les deux chemins peuvent finalement être lus ainsi :

```text
C:\ExchangeVolumes
```

répond à la question :

```text
Quels volumes physiques sont présents et lesquels sont disponibles ?
```

Alors que :

```text
C:\ExchangeDatabases
```

répond à la question :

```text
Où Exchange doit-il trouver chaque base ?
```

AutoReseed fait le lien entre l'emplacement logique de la base et le volume physique qui l'héberge.

Lorsqu'un disque est perdu, le chemin de la base ne change pas. C'est le volume monté derrière ce chemin qui est remplacé, puis son contenu est reconstruit depuis une copie saine du DAG.

## Sources

- [Exchange Server Preferred Architecture](https://learn.microsoft.com/en-us/exchange/plan-and-deploy/deployment-ref/preferred-architecture)
- [Exchange Server storage configuration options](https://learn.microsoft.com/en-us/exchange/plan-and-deploy/deployment-ref/storage-configuration)
- [About AutoReseed](https://learn.microsoft.com/en-us/exchange/high-availability/database-availability-groups/autoreseed)
- [Configure AutoReseed for a database availability group](https://learn.microsoft.com/en-us/exchange/high-availability/manage-ha/configure-dag-autoreseed)
