---
layout: post
article_type: comprendre
title: "Exchange Server : comprendre la distribution automatique des boîtes aux lettres entre les bases et les DAG"
date: 2026-11-15
description: "Exchange sait choisir automatiquement une base lors de la création ou du déplacement d'une boîte, y compris lorsque plusieurs DAG sont concernés. Explications, critères et commandes PowerShell."
categories: [Exchange]
tags:
  - Exchange
  - DAG
  - PowerShell
  - Boîtes aux lettres
mermaid: true
---

Une organisation Exchange peut posséder des dizaines de bases réparties sur plusieurs DAG. Lorsqu'une nouvelle boîte aux lettres est créée, faut-il déterminer manuellement le DAG puis la base de données qui l'hébergera ?

**Non. Exchange Server possède un mécanisme natif de distribution automatique des boîtes aux lettres : Automatic Mailbox Distribution.** Sans base de destination explicitement indiquée, Exchange peut sélectionner lui-même une base éligible.

Le point important est le suivant : **Exchange choisit une base de données et non un DAG.** Si des bases appartenant à plusieurs DAG sont éligibles, cette sélection peut naturellement répartir les boîtes entre ces DAG.

> **Périmètre :** Exchange Server on-premises. Les commandes de cet article concernent Exchange Server 2016, 2019 et Subscription Edition (SE). La description détaillée de l'algorithme est issue de la documentation Microsoft Exchange 2013, encore utile pour comprendre ce mécanisme ; les commandes et paramètres mentionnés sont documentés pour les versions plus récentes. Les exemples sont fictifs.

## L'essentiel en 30 secondes

- **New-Mailbox** et **Enable-Mailbox** peuvent choisir la base automatiquement si le paramètre **-Database** est absent.
- **New-MoveRequest** peut également sélectionner la base de destination si **-TargetDatabase** est absent.
- Le choix se fait **parmi les bases éligibles**, après application de filtres, notamment les exclusions, le site Active Directory et les éventuelles étendues RBAC.
- Plusieurs DAG peuvent recevoir de nouvelles boîtes, à condition que leurs bases figurent dans ce périmètre.
- Ce mécanisme **ne déplace pas spontanément les boîtes existantes** et ne configure pas la réplication des bases.

## 1. Boîte aux lettres, base et DAG : trois notions différentes

Une boîte aux lettres est hébergée dans **une base de données logique**. Cette base peut être autonome ou posséder plusieurs copies sur des serveurs membres d'un même DAG (*Database Availability Group*).

Avec quatre copies d'une base, une seule est normalement active ; les trois autres sont passives. Quand la copie active bascule sur un autre serveur, **les utilisateurs restent dans la même base logique**.

| Objet | Exemple | Rôle |
| --- | --- | --- |
| Boîte aux lettres | jdupont | Données de l'utilisateur |
| Base de données | DB-A03 | Contient la boîte |
| DAG | DAG-A | Groupe de serveurs assurant la disponibilité |
| Copies de DB-A03 | EX01, EX02, EX03 et EX04 | Une copie active et trois passives |

La distribution automatique répond uniquement à la question **"Dans quelle base placer la boîte ?"**.

Elle ne choisit pas les quatre serveurs qui hébergeront les copies : cette configuration appartient à l'architecture DAG et existe indépendamment du provisionnement des utilisateurs.

## 2. Comment Exchange sélectionne une base

La documentation Microsoft décrit cinq étapes :

1. Exchange recense les bases de données de l'organisation.
2. Il retire celles qui sont **exclues du provisionnement automatique**.
3. Il écarte les bases situées hors des **étendues de gestion** applicables à l'administrateur, lorsque des restrictions RBAC existent.
4. Il conserve les bases du **site Active Directory local** où la commande est exécutée.
5. Il choisit une base **aléatoirement** parmi les candidates et vérifie qu'elle est en ligne et utilisable. Si elle ne convient pas, il peut essayer une autre candidate.

~~~mermaid
flowchart TD
    A["Création ou déplacement sans base cible"] --> B["Inventaire des bases"]
    B --> C["Filtrer les exclusions de provisionnement"]
    C --> D["Appliquer les étendues RBAC"]
    D --> E["Limiter au site Active Directory concerné"]
    E --> F{"Une base candidate ?"}
    F -->|"Non"| G["Opération en échec"]
    F -->|"Oui"| H["Choix aléatoire"]
    H --> I{"Base utilisable ?"}
    I -->|"Oui"| J["Boîte créée ou déplacée"]
    I -->|"Non"| K["Essayer une autre candidate"]
    K --> F
~~~

Il s'agit d'une **représentation pédagogique** de l'algorithme décrit historiquement par Microsoft, pas d'une reproduction de son code interne.

### Le rôle déterminant des sites Active Directory

La distribution automatique n'est pas un tirage au sort parmi **tous les DAG de tous les sites**.

Si des bases de plusieurs DAG sont candidates dans le site AD concerné, Exchange peut choisir l'une ou l'autre. En revanche, des bases situées exclusivement dans un autre site AD ne sont pas automatiquement candidates à l'opération en cours.

C'est la principale précaution à garder en tête lorsqu'on parle de distribution entre plusieurs DAG.

## 3. Comment plusieurs DAG participent à la distribution

Imaginons deux DAG possédant chacun deux bases éligibles dans le même site AD :

~~~mermaid
flowchart TB
    P["Nouvelle boîte sans base imposée"] --> S["Distribution automatique Exchange"]
    S --> A1["DB-A01 dans DAG-A"]
    S --> A2["DB-A02 dans DAG-A"]
    S --> B1["DB-B01 dans DAG-B"]
    S --> B2["DB-B02 dans DAG-B"]
~~~

Dans cet exemple, Exchange dispose de **quatre bases candidates**.

Il ne sélectionne pas d'abord un DAG, puis une base. Il sélectionne directement une base parmi les quatre.

Cela explique pourquoi le nombre de bases candidates compte : un DAG qui offre davantage de bases éligibles présente davantage de destinations possibles. L'aléatoire peut donner une répartition statistiquement homogène **par base**, mais il ne garantit pas une égalité stricte **par DAG**.

## 4. Utiliser la distribution automatique lors d'une création

### Activer la boîte d'un compte Active Directory existant

~~~powershell
Enable-Mailbox -Identity "jdupont"
~~~

Le paramètre **-Database** est absent. Exchange choisit donc une base éligible.

Pour contrôler le résultat :

~~~powershell
Get-Mailbox -Identity "jdupont" |
    Format-List Name,Database
~~~

Exemple de sortie fictive :

~~~text
Name     : Jean Dupont
Database : DB-B02
~~~

### Créer un nouveau compte avec New-Mailbox

Pour un exemple de laboratoire, le mot de passe est demandé de façon sécurisée :

~~~powershell
$password = Read-Host "Mot de passe initial" -AsSecureString

New-Mailbox -Name "Utilisateur Demo" -Alias "udemo" -UserPrincipalName "udemo@exemple.test" -Password $password -ResetPasswordOnNextLogon $true
~~~

La commande ne précise pas de base. La sélection reste donc automatique.

Le choix exact des paramètres de **New-Mailbox** dépend du type de destinataire et du contexte Active Directory.

**Aucune option supplémentaire n'est nécessaire pour activer la distribution automatique : il suffit de ne pas imposer de base.**

## 5. Imposer une destination précise

Si un emplacement particulier est souhaité, il est possible de préciser la base :

~~~powershell
Enable-Mailbox -Identity "jdupont" -Database "DB-A01"
~~~

La même logique s'applique à une demande de déplacement :

~~~powershell
New-MoveRequest -Identity "jdupont" -TargetDatabase "DB-A02"
~~~

Dans ces deux cas, la destination est imposée par l'administrateur, sous réserve des autorisations et de l'état de la base.

## 6. Utiliser la sélection automatique lors d'un déplacement

La sélection automatique fonctionne aussi lorsqu'une boîte existante doit changer de base.

~~~powershell
New-MoveRequest -Identity "jdupont"
~~~

Sans **-TargetDatabase**, la documentation actuelle de Microsoft indique que la distribution automatique sélectionne une base aléatoire dans le site Active Directory où la commande s'exécute.

Suivi du déplacement :

~~~powershell
Get-MoveRequest -Identity "jdupont"

Get-MoveRequestStatistics -Identity "jdupont" |
    Format-List Status,PercentComplete,SourceDatabase,TargetDatabase
~~~

**Attention :** New-MoveRequest est une commande qui déclenche une opération réelle. Les deux commandes de consultation servent seulement à examiner l'état de la demande.

Le fonctionnement ne doit pas être confondu avec un rééquilibrage permanent : **Exchange ne déplace pas spontanément les boîtes existantes entre les bases simplement pour les répartir plus uniformément**.

## 7. Inventorier les bases éligibles

L'inventaire commence par une commande en lecture seule :

~~~powershell
Get-MailboxDatabase |
    Format-Table Name,MasterServerOrAvailabilityGroup,IsExcludedFromProvisioning
~~~

La propriété **MasterServerOrAvailabilityGroup** permet de retrouver le DAG responsable d'une base répliquée, ou le serveur pour une base autonome.

Pour examiner les propriétés liées à la distribution :

~~~powershell
Get-MailboxDatabase |
    Format-List Name,IsExcludedFromProvisioning,IsSuspendedFromProvisioning,IsExcludedFromProvisioningReason
~~~

La propriété **IsExcludedFromProvisioning** est particulièrement utile. Une valeur **False** ne suffit toutefois pas à garantir la sélection : la base doit aussi satisfaire aux autres critères, notamment le site AD, les éventuelles étendues d'administration et son état.

## 8. Retirer volontairement une base de la distribution

Une base peut être exclue de la sélection automatique sans la démonter ni déplacer les boîtes qu'elle héberge déjà.

Sur Exchange Server 2016, 2019 et SE, la documentation actuelle précise qu'une raison d'au moins **dix caractères** doit être fournie si aucun motif d'exclusion n'existe déjà :

~~~powershell
Set-MailboxDatabase -Identity "DB-A01" -IsExcludedFromProvisioning $true -IsExcludedFromProvisioningReason "Exclusion manuelle du provisionnement"
~~~

Vérification :

~~~powershell
Get-MailboxDatabase -Identity "DB-A01" |
    Format-List Name,IsExcludedFromProvisioning,IsExcludedFromProvisioningReason
~~~

Réintégration dans la sélection automatique, **uniquement après vérification de l'état et des autres éventuels motifs d'exclusion** :

~~~powershell
Set-MailboxDatabase -Identity "DB-A01" -IsExcludedFromProvisioning $false
~~~

> **Prudence :** Set-MailboxDatabase modifie effectivement la configuration Exchange. L'exclusion du provisionnement automatique n'interdit pas nécessairement la désignation explicite d'une base dans une commande, et le retour à False ne corrige pas une éventuelle défaillance technique. Certaines propriétés d'exclusion spécialisées ont une signification propre : elles ne doivent pas être modifiées sans consulter la documentation de la version installée.

## 9. Vérifier la base et le DAG d'une boîte

**Identifier la base d'un utilisateur :**

~~~powershell
Get-Mailbox -Identity "jdupont" |
    Select-Object Name,Database
~~~

**Identifier le DAG associé à cette base :**

~~~powershell
Get-MailboxDatabase -Identity "DB-B02" |
    Format-List Name,MasterServerOrAvailabilityGroup
~~~

**Examiner les copies de la base :**

~~~powershell
Get-MailboxDatabaseCopyStatus "DB-B02\*" |
    Format-Table Name,Status,CopyQueueLength,ReplayQueueLength
~~~

Les quatre copies éventuelles sont des copies de **la même base logique**, hébergées au sein **du même DAG**. La création d'une boîte dans cette base ne crée pas quatre nouvelles bases.

**Compter les boîtes utilisateur d'une base :**

~~~powershell
Get-Mailbox -Database "DB-B02" -RecipientTypeDetails UserMailbox -ResultSize Unlimited |
    Measure-Object
~~~

Cette commande ne compte que les boîtes de type **UserMailbox**, et non les boîtes partagées, les salles ou les équipements.

L'option **-ResultSize Unlimited** évite la limite de résultats par défaut. Sur une grande organisation, l'énumération de nombreuses boîtes peut être coûteuse ; elle est à réserver aux vérifications pertinentes.

## 10. Le hasard est utile, mais ne résout pas tous les problèmes

Avec de nombreuses créations et un ensemble de bases éligibles comparable, une sélection aléatoire conduit naturellement à une répartition statistique des nouvelles boîtes.

Elle ne garantit cependant pas :

- un nombre exactement égal de boîtes par base ;
- le même nombre de boîtes par DAG lorsqu'ils ne présentent pas le même nombre de bases candidates ;
- une charge identique sur chaque serveur ;
- le déplacement automatique des utilisateurs déjà présents.

**La fonction a un objectif précis : déterminer une destination lors d'une création ou d'un déplacement demandé, et non redistribuer en continu toutes les boîtes existantes.**

## 11. Ne pas confondre les mécanismes

| Mécanisme | Question traitée | Ce qu'il ne fait pas |
| --- | --- | --- |
| **Automatic Mailbox Distribution** | Dans quelle base créer ou déplacer une boîte si aucune destination n'est précisée ? | Ne crée pas de copies passives |
| **Réplication DAG** | Comment maintenir plusieurs copies d'une base ? | Ne choisit pas la base d'une nouvelle boîte |
| **Rééquilibrage des copies actives** | Sur quel serveur du DAG faire fonctionner une base active ? | Ne déplace pas les utilisateurs vers une autre base |

Le rééquilibrage des bases actives peut notamment utiliser les préférences d'activation et le script Microsoft **RedistributeActiveDatabases.ps1**.

Faire basculer la copie active de DB-A01 d'EX01 vers EX02 **ne déplace pas les boîtes de DB-A01 vers DB-A02**.

## 12. Mini-TP de compréhension

Voici quatre commandes de **lecture seule** permettant d'examiner une installation Exchange de laboratoire :

~~~powershell
# Bases et DAG
Get-MailboxDatabase |
    Format-Table Name,MasterServerOrAvailabilityGroup

# Bases exclues
Get-MailboxDatabase |
    Where-Object { $_.IsExcludedFromProvisioning } |
    Format-Table Name,IsExcludedFromProvisioning

# Base d'un utilisateur
Get-Mailbox -Identity "jdupont" |
    Format-List Name,Database

# Copies de cette base
Get-MailboxDatabaseCopyStatus "DB-B02\*" |
    Format-Table Name,Status
~~~

### Trois questions pour retenir le fonctionnement

**1.** Deux DAG possèdent des bases éligibles dans le même site AD. Exchange peut-il utiliser des bases de chacun d'eux ?

**2.** Si un DAG possède davantage de bases candidates qu'un autre, Exchange garantit-il une répartition identique du nombre de boîtes par DAG ?

**3.** Si une base active bascule sur un autre serveur, les utilisateurs changent-ils de base logique ?

**Réponses :** 1. Oui, si toutes ces bases sont bien dans le périmètre de sélection. 2. Non, la sélection porte sur les bases candidates, pas sur les DAG. 3. Non, seul le serveur hébergeant la copie active change.

## Ce qu'il faut retenir

**Exchange Server sait distribuer automatiquement les nouvelles boîtes entre des bases et donc, indirectement, entre plusieurs DAG.** La condition est que ces bases soient candidates à la sélection dans le contexte de l'opération.

L'usage est simple : omettre **-Database** lors d'une création ou activation de boîte, ou **-TargetDatabase** lors d'un déplacement, pour laisser Exchange choisir.

Cela reste une **sélection de base**, et non un mécanisme de rééquilibrage permanent des boîtes entre les serveurs.

## Pour prolonger la lecture

- [Comprendre le fonctionnement d'un DAG](/articles/comprendre-fonctionnement-dag-exchange-server/) : réplication, Active Manager et basculements.
- [RBAC : rôles et étendues](/articles/exchange-server-rbac-roles-scopes-delegation/) : permissions et périmètres de gestion.
- [Destinataires, groupes et politiques d'adressage](/articles/exchange-server-destinataires-groupes-politiques-adressage/) : types de boîtes et administration des destinataires.

## Sources Microsoft

- [Automatic mailbox distribution (documentation historique Exchange 2013)](https://learn.microsoft.com/en-us/exchange/automatic-mailbox-distribution-exchange-2013-help) : sélection, filtres et étendues.
- [New-Mailbox](https://learn.microsoft.com/en-us/powershell/module/exchangepowershell/new-mailbox?view=exchange-ps) et [Enable-Mailbox](https://learn.microsoft.com/en-us/powershell/module/exchangepowershell/enable-mailbox?view=exchange-ps).
- [New-MoveRequest](https://learn.microsoft.com/en-us/powershell/module/exchangepowershell/new-moverequest?view=exchange-ps) et [Manage on-premises mailbox moves](https://learn.microsoft.com/en-us/exchange/architecture/mailbox-servers/manage-mailbox-moves).
- [Set-MailboxDatabase](https://learn.microsoft.com/en-us/powershell/module/exchangepowershell/set-mailboxdatabase?view=exchange-ps) : exclusions du provisionnement et motif associé.
- [Get-MailboxDatabase](https://learn.microsoft.com/en-us/powershell/module/exchangepowershell/get-mailboxdatabase?view=exchange-ps) et [Get-Mailbox](https://learn.microsoft.com/en-us/powershell/module/exchangepowershell/get-mailbox?view=exchange-ps).
- [Manage mailbox database copies](https://learn.microsoft.com/en-us/exchange/high-availability/manage-ha/manage-database-copies) : gestion des copies et équilibre des bases actives.

*Tous les exemples d'utilisateurs, de serveurs et de bases sont fictifs. Les commandes de modification doivent être évaluées et testées avant utilisation.*
