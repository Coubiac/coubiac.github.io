---
layout: post
title: "Exchange Server : restaurer une boîte aux lettres, une base et un membre de DAG"
description: "Récupérer des messages avec une Recovery Database, suivre une MailboxRestoreRequest et reconstruire un serveur Exchange ou un membre de DAG avec RecoverServer."
tags:
  - Exchange Server
  - PowerShell
  - Active Directory
  - DAG
permalink: /articles/exchange-restaurer-rdb-recoverserver-dag/
---


Quand un utilisateur supprime des messages, quand une base de données devient inutilisable ou quand un serveur Exchange disparaît, on ne suit pas la même procédure. L'important n'est pas tant le logiciel qui a produit la sauvegarde que **ce qu'Exchange sait faire avec les fichiers récupérés et avec sa configuration Active Directory**.

Dans cet article, je reviens sur trois opérations : exploiter une *Recovery Database* (RDB), restaurer son contenu dans une boîte aux lettres de production, et reconstruire un serveur Exchange avec `RecoverServer`, y compris lorsqu'il faisait partie d'un DAG. Les exemples utilisent Exchange Server 2019 et restent, sur ces mécanismes, pertinents pour Exchange Server 2016 et Exchange Server Subscription Edition. Les commandes doivent naturellement être adaptées à la version et à la topologie en place.

> **Préalable :** avant de sortir une sauvegarde, vérifier les éléments récupérables, les mécanismes de récupération d'élément unique, les rétentions et les copies saines du DAG. Une RDB n'est pas la réponse à toute suppression de message.

## 1. Choisir la bonne méthode de récupération

| Incident | Mécanisme Exchange adapté |
| --- | --- |
| Un message a été supprimé récemment | Éléments supprimés / éléments récupérables / rétention, si encore disponibles |
| Des messages historiques doivent être extraits d'une ancienne base | Recovery Database + `New-MailboxRestoreRequest` |
| Une copie de base est perdue, mais une autre copie DAG est saine | Activation de la copie saine, puis recréation de la redondance |
| Un serveur Exchange est définitivement perdu | `Setup.exe /Mode:RecoverServer` |
| Un serveur Exchange membre d'un DAG est perdu | Nettoyage de l'ancienne appartenance, `RecoverServer`, réintégration au DAG et reseed |
| Il faut rétablir immédiatement l'envoi et la réception sans attendre les anciens messages | *Dial-tone recovery* selon le contexte |

Une idée essentielle : **haute disponibilité et restauration ne sont pas synonymes**. Un DAG réduit les interruptions liées aux pannes de disques et de serveurs. Il ne garantit pas, à lui seul, le retour à un état antérieur en cas de suppression ou de corruption logique propagée à toutes les copies.

## 2. Recovery Database : accéder à une ancienne base sans toucher à la production

Une *Recovery Database* est une base Exchange particulière. Elle permet de monter les données d'une base `.edb` récupérée et de les extraire avec les outils Exchange. Les clients Outlook ou OWA ne peuvent pas ouvrir directement les boîtes qu'elle contient : c'est le service de restauration qui recopie les éléments vers une boîte existante.

Quelques limites utiles : une seule RDB peut être montée simultanément sur un même serveur Exchange ; elle ne peut pas avoir de copies DAG ; elle ne compte pas dans la limite habituelle de bases de l'édition Standard ou Enterprise.

### Étape 1 — Identifier la base source

Dans l'Exchange Management Shell :

```powershell
Get-MailboxDatabase -Identity "Mailbox Database 1" |
    Format-List Name,Guid,EdbFilePath,LogFolderPath
```

Cette commande fournit notamment le GUID de la **base**, son fichier EDB et l'emplacement des journaux de transaction. Le GUID est pratique pour retrouver les données dans une arborescence de restauration qui utilise cet identifiant comme nom de répertoire.


Attention à ne pas confondre **GUID de base de données** (`Get-MailboxDatabase`) et **MailboxGUID de la boîte à extraire** (`Get-MailboxStatistics`). Ils ne désignent pas la même chose.

### Étape 2 — Préparer les fichiers récupérés

Dans l'exemple, on dispose des éléments suivants, dans un répertoire distinct de la production :

```text
D:\RDB\
  DB1.edb
  E01*.log
  E01.chk    (si présent)
```

On ne remplace pas les fichiers d'une base active par ceux d'une sauvegarde pour récupérer quelques messages. On travaille sur une copie dans un emplacement isolé, avec les journaux appartenant à la même chaîne de transactions que le fichier EDB.

Pour connaître l'état de la base :

```powershell
eseutil /mh "D:\RDB\DB1.edb"
```

Examiner le champ `State` :

- `Clean Shutdown` : la base peut normalement être montée sans relecture complémentaire des journaux.
- `Dirty Shutdown` : il faut d'abord effectuer une *soft recovery* si les journaux nécessaires sont présents.

Exemple avec le préfixe de journal `E01` (à identifier dans les fichiers restaurés, et non à recopier sans vérification) :

```powershell
eseutil /r E01 /l "D:\RDB" /d "D:\RDB"
eseutil /mh "D:\RDB\DB1.edb"
```

La seconde commande doit permettre de vérifier le retour à `Clean Shutdown`. `eseutil /r` rejoue des journaux cohérents ; ce n'est pas la même opération que `eseutil /p`, une réparation lourde susceptible d'entraîner une perte de données et qui ne doit surtout pas devenir le réflexe habituel.

**Cas particulier Exchange 2019/SE :** si la base utilise *MetaCache Database* (MCDB), une ancienne liaison MCDB peut empêcher le montage malgré un `Clean Shutdown`. Microsoft documente dans ce cas une récupération `eseutil /r ... /i` pour supprimer la liaison devenue invalide : c'est une procédure spécifique, pas un commutateur à ajouter systématiquement.

### Étape 3 — Déclarer et monter la RDB

Une fois les bons fichiers récupérés et la cohérence vérifiée, on crée la base de récupération en la faisant pointer vers **les fichiers existants**, pas vers un répertoire vide :

```powershell
New-MailboxDatabase -Recovery `
    -Name "RecoveryDB" `
    -Server "EX1" `
    -EdbFilePath "D:\RDB\DB1.edb" `
    -LogFolderPath "D:\RDB"
```

Vérifier immédiatement les chemins enregistrés :

```powershell
Get-MailboxDatabase "RecoveryDB" |
    Format-List Name,Recovery,EdbFilePath,LogFolderPath,Server
```

Si nécessaire, redémarrer le service Information Store, puis monter la RDB :

```powershell
Restart-Service MSExchangeIS
Mount-Database "RecoveryDB"
```

**Attention en production :** `Restart-Service MSExchangeIS` affecte aussi les autres bases desservies par cette instance. Ce redémarrage doit être planifié ; un serveur de récupération approprié peut être préférable à un serveur très sollicité.

Contrôle du montage et des boîtes présentes :

```powershell
Get-MailboxDatabase "RecoveryDB" -Status |
    Format-List Name,Mounted

Get-MailboxStatistics -Database "RecoveryDB" |
    Format-Table DisplayName,MailboxGuid,ItemCount -AutoSize
```

C'est le contrôle à ne pas manquer : **si la boîte recherchée n'apparaît pas dans `Get-MailboxStatistics`, inutile de lancer une `MailboxRestoreRequest`**. Il faut d'abord vérifier que le chemin `EdbFilePath` pointe vers la bonne sauvegarde et que son contenu correspond bien à la période recherchée.

### Étape 4 — Restaurer dans un dossier séparé

Imaginons que la RDB contienne l'ancienne boîte de Beth Burke et que sa boîte actuelle existe toujours. On récupère d'abord son `MailboxGUID` dans la **RDB** :

```powershell
$source = Get-MailboxStatistics -Database "RecoveryDB" |
    Where-Object { $_.DisplayName -eq "Beth Burke" }

$source | Format-List DisplayName,MailboxGuid,ItemCount
```

Puis on demande à Exchange de recopier les données :

```powershell
New-MailboxRestoreRequest `
    -Name "RDB_Beth_20261029" `
    -SourceDatabase "RecoveryDB" `
    -SourceStoreMailbox $source.MailboxGuid `
    -TargetMailbox "beth@adatum.com" `
    -TargetRootFolder "Restauration_20261029"
```

Le paramètre **`-TargetRootFolder` est particulièrement important** : les données récupérées sont placées sous un dossier dédié dans la boîte de destination, plutôt que fusionnées directement avec sa boîte de réception, ses éléments envoyés, etc. Il est alors bien plus facile de comparer les éléments, de les restituer sélectivement et d'éviter la confusion entre ancien contenu et contenu actuel.

C'est aussi ce qui a été retenu pendant le TP. Il était possible de fusionner directement les messages, mais cette approche compliquait nettement la vérification du résultat.


Il est possible de limiter la restauration à un dossier précis avec `-IncludeFolders`. Par exemple, pour viser la boîte de réception et ses sous-dossiers :

```powershell
New-MailboxRestoreRequest `
    -Name "RDB_Beth_Inbox" `
    -SourceDatabase "RecoveryDB" `
    -SourceStoreMailbox $source.MailboxGuid `
    -TargetMailbox "beth@adatum.com" `
    -IncludeFolders '#Inbox#/*' `
    -TargetRootFolder "Restauration_Inbox"
```

Le nom spécial `#Inbox#` évite de dépendre de la langue d'affichage de la boîte. On peut également filtrer le dossier source avec `-SourceRootFolder`, mais ces deux paramètres ne sont pas interchangeables : `SourceRootFolder` désigne la racine source, `TargetRootFolder` la racine créée côté destination.

Si le `LegacyExchangeDN` de la boîte source ne correspond pas à celui de la cible, `-AllowLegacyDNMismatch` peut être nécessaire. Il vaut mieux comprendre l'origine de cette différence plutôt que contourner systématiquement la vérification.

### Étape 5 — Suivre, diagnostiquer et nettoyer les demandes

Comme pour les migrations de boîtes aux lettres, Exchange utilise une *request* asynchrone. La commande initiale peut donc retourner rapidement `Queued`, sans que la copie soit déjà terminée.

```powershell
Get-MailboxRestoreRequest |
    Format-Table Name,TargetMailbox,Status -AutoSize
```

Pour le suivi détaillé :

```powershell
Get-MailboxRestoreRequest -Name "RDB_Beth_20261029" |
    Get-MailboxRestoreRequestStatistics -IncludeReport |
    Format-List Status,PercentComplete,ItemsTransferred,Report
```

Le commutateur `-IncludeReport` donne accès au journal détaillé du traitement et devient particulièrement intéressant lorsqu'une requête échoue ou reste bloquée.


Un statut `Completed` prouve que la requête a terminé, **pas que le message précis recherché se trouvait dans la sauvegarde**. Vérifier les éléments dans le dossier de destination avec Outlook/OWA. Après validation, supprimer uniquement la demande concernée :

```powershell
Get-MailboxRestoreRequest -Name "RDB_Beth_20261029" |
    Remove-MailboxRestoreRequest
```

Quand la RDB n'est plus nécessaire :

```powershell
Dismount-Database "RecoveryDB"
Remove-MailboxDatabase "RecoveryDB"
```

La suppression de l'objet RDB n'efface pas automatiquement les fichiers `.edb` et les journaux. Il faut nettoyer **manuellement** le répertoire de travail après avoir confirmé qu'aucune récupération supplémentaire n'est nécessaire.

## 3. Reconstruire un serveur Exchange perdu : `RecoverServer`

Le deuxième scénario est différent : ce n'est plus un message qui manque, mais **le serveur Exchange lui-même**. L'élément qui rend cette opération possible, c'est qu'une grande partie de la configuration Exchange est enregistrée dans **Active Directory**.

Le mode `RecoverServer` lit cette configuration pour réinstaller Exchange sur une nouvelle machine qui reprend **l'identité de l'ancien serveur**. C'est une reconstruction contrôlée de l'installation, pas une restauration automatique des fichiers `.edb`, des certificats privés ou des personnalisations locales.

### Étape 1 — Conserver l'objet ordinateur Active Directory

Il ne faut **pas supprimer puis recréer** l'objet ordinateur du serveur perdu sans raison. Le TP montre la procédure suivante : réinitialiser le compte ordinateur existant dans AD, préparer une nouvelle machine portant le même nom, puis la joindre au domaine.

La réinitialisation du compte machine permet de renégocier le secret de la relation sécurisée lors de la jonction. Elle **conserve l'objet AD, son `objectGUID`, son SID de compte de domaine et ses appartenances aux groupes**, contrairement à une suppression suivie d'une recréation. À ne pas confondre avec le SID local de l'installation Windows, qui est un autre identifiant.

### Étape 2 — Préparer Windows avec une configuration compatible

Avant l'installation :

- même nom de serveur et même domaine Active Directory ;
- version de Windows Server compatible et, pour `RecoverServer`, même version de Windows que le serveur perdu selon la procédure Microsoft ;
- prérequis Exchange installés ;
- mêmes lettres de lecteurs pour les bases qui doivent être retrouvées ;
- capacités suffisantes et accès correct à AD/DNS ;
- média Exchange adapté. La documentation Microsoft autorise dans certains cas l'utilisation du dernier CU disponible si celui du serveur perdu n'est plus disponible.

L'adresse IP peut changer, mais ce n'est pas neutre : vérifier DNS, équilibreurs de charge, règles de pare-feu, relais SMTP et éventuels connecteurs configurés avec des adresses IP. Pour limiter les écarts, reprendre l'ancienne IP est souvent le choix le plus simple si c'est possible.

### Étape 3 — Réinstaller en mode récupération

Depuis une invite administrateur, sur la **nouvelle machine** préparée avec l'ancien nom :

```powershell
E:\Setup.exe /Mode:RecoverServer `
    /IAcceptExchangeServerLicenseTerms_DiagnosticDataOFF
```

L'ancienne syntaxe `/IAcceptExchangeServerLicenseTerms` figurant dans certains supports de cours n'est plus valide pour les CU Exchange 2016/2019 publiés depuis septembre 2021. On utilise désormais la forme `..._DiagnosticDataON` ou `..._DiagnosticDataOFF`.

Si les binaires Exchange se trouvaient ailleurs que dans le chemin par défaut, il faut aussi spécifier l'ancien répertoire avec `/TargetDir`.

À l'issue de l'installation, vérifier au minimum :

```powershell
Get-ExchangeServer -Identity "EX1" |
    Format-List Name,AdminDisplayVersion,ServerRole

Get-Service MSExchange* |
    Format-Table Name,Status,StartType -AutoSize
```

**Ce que `RecoverServer` ne récupère pas tout seul :** les certificats TLS avec leurs clés privées, certains réglages propres à l'OS ou à IIS, les personnalisations locales, ainsi que les données des bases si les fichiers sont perdus. Les certificats doivent être réimportés et affectés aux services concernés.

## 4. Le cas d'un membre de DAG définitivement perdu

Si le serveur était membre d'un *Database Availability Group*, la reconstruction demande une préparation supplémentaire : le DAG possède encore des références à l'ancienne machine et à ses copies de bases.

L'ordre compte. Les exemples supposent **EX1 irrécupérable**, **EX2 opérationnel**, un DAG `DAG1` et une copie `DB1\EX1`. Il faut d'abord confirmer la santé des autres copies et du quorum. Ne pas dérouler mécaniquement cette procédure sur un serveur simplement indisponible quelques minutes.

### Étape 1 — Inventorier les copies et les paramètres de décalage

Sur un serveur survivant :

```powershell
Get-DatabaseAvailabilityGroup "DAG1" -Status |
    Format-List Name,Servers,OperationalServers

Get-MailboxDatabaseCopyStatus * |
    Format-Table Name,Status,CopyQueueLength,ReplayQueueLength

Get-MailboxDatabase "DB1" |
    Format-List Name,ReplayLagTime,TruncationLagTime
```

Conserver les paramètres éventuels de *lagged copies* avant leur suppression, pour pouvoir les recréer à l'identique.

### Étape 2 — Retirer la copie et le membre disparu

```powershell
Remove-MailboxDatabaseCopy -Identity "DB1\EX1"

Remove-DatabaseAvailabilityGroupServer `
    -Identity "DAG1" `
    -MailboxServer "EX1" `
    -ConfigurationOnly
```

La première commande doit être répétée **pour chaque copie réellement hébergée sur EX1**. `-ConfigurationOnly` sert ici parce que le serveur perdu n'est plus joignable : Exchange modifie les informations de configuration sans pouvoir réaliser l'opération sur le membre lui-même.

Dans ce cas particulier, il faut **également évincer le nœud EX1 du cluster Windows** depuis un membre survivant, par exemple avec Failover Cluster Manager. C'est une exception documentée à la règle pratique consistant à administrer le DAG avec les cmdlets Exchange plutôt qu'avec la console de cluster. Ne pas supprimer arbitrairement d'autres objets ou ressources du cluster.

### Étape 3 — Recréer le serveur

Réinitialiser l'objet ordinateur `EX1` dans Active Directory, puis construire une machine Windows propre sous ce nom et la joindre au domaine. Lancer `Setup.exe /Mode:RecoverServer` comme indiqué dans la section précédente.

### Étape 4 — Réintégrer EX1 au DAG et reconstruire les copies

Une fois Exchange opérationnel et après vérification de ses services :

```powershell
Add-DatabaseAvailabilityGroupServer `
    -Identity "DAG1" `
    -MailboxServer "EX1"

Add-MailboxDatabaseCopy `
    -Identity "DB1" `
    -MailboxServer "EX1"
```

Réappliquer si nécessaire les paramètres d'activation et de décalage de réplication. La nouvelle copie doit être alimentée depuis une copie saine : c'est le **reseed**. Vérifier ensuite l'état, sans conclure à un échec définitif si une copie apparaît encore momentanément en cours d'initialisation :

```powershell
Get-MailboxDatabaseCopyStatus -Server "EX1" |
    Format-Table Name,Status,CopyQueueLength,ReplayQueueLength,ContentIndexState

Test-ReplicationHealth -Identity "EX1"
```

Ne considérer l'opération comme terminée qu'après retour à une situation attendue pour les copies, les services, les certificats et les chemins d'accès clients.

## 5. Points de vigilance rencontrés pendant le TP

Le cours a mis en évidence plusieurs pièges qui valent une note dans une procédure de production.

**Une RDB peut être créée correctement et pointer vers le mauvais fichier.** C'est arrivé dans le TP à cause d'une confusion autour du répertoire portant le GUID. La commande `New-MailboxDatabase -Recovery` peut réussir sans démontrer que les données attendues sont présentes. Le véritable contrôle vient du chemin EDB puis de `Get-MailboxStatistics -Database RecoveryDB`.

**Une requête de restauration terminée n'est pas une preuve que le bon message a été récupéré.** Il faut vérifier le point de restauration, les données source et la destination. `-TargetRootFolder` rend cette vérification beaucoup plus simple.

**Le contenu du cache Outlook n'est pas une stratégie de reprise.** On peut rencontrer des cas historiques où des fichiers OST ont aidé à retrouver des messages, mais le comportement de synchronisation et les risques de suppression rendent cette méthode impropre à une procédure fiable.

**L'objet ordinateur AD est un élément de la reconstruction.** La distinction entre `Reset Account` et suppression/recréation n'est pas cosmétique : réinitialiser l'objet préserve les identifiants et appartenances du compte ordinateur de domaine.

**Un DAG ne dispense pas de comprendre les chemins de restauration.** Les répliques aident à absorber des pannes d'infrastructure, mais elles ne constituent pas automatiquement un historique point-in-time ou une réponse à toutes les corruptions logiques.

**Une sauvegarde d'Exchange ne remplace pas celle d'Active Directory.** `RecoverServer` dépend des informations Exchange présentes dans AD ; si toute la forêt a été perdue et ne peut pas être restaurée, on ne peut pas simplement recréer un AD vide et espérer retrouver l'organisation Exchange.

## Conclusion

La logique Exchange est finalement assez claire quand on sépare les objectifs :

- **RDB + `New-MailboxRestoreRequest`** : extraire des données historiques sans remplacer la base en production.
- **`RecoverServer`** : réinstaller un serveur en reconstituant sa configuration enregistrée dans AD.
- **`RecoverServer` + opérations DAG** : reconstruire un membre perdu, puis rétablir la redondance des copies.

Les étapes les plus importantes ne sont pas les commandes de création elles-mêmes, mais les vérifications **avant** et **après** : cohérence de l'EDB, bonne source, bonne boîte, bonnes copies, certificats réinstallés et validation fonctionnelle. C'est là que se joue la différence entre une requête qui affiche `Completed` et une restauration réellement réussie.

## Références

- [Microsoft Learn — Restore data using a recovery database](https://learn.microsoft.com/en-us/exchange/high-availability/disaster-recovery/restore-data-using-recovery-dbs)
- [Microsoft Learn — Recovery databases](https://learn.microsoft.com/en-us/exchange/high-availability/disaster-recovery/recovery-databases)
- [Microsoft Learn — New-MailboxRestoreRequest](https://learn.microsoft.com/en-us/powershell/module/exchangepowershell/new-mailboxrestorerequest)
- [Microsoft Learn — Get-MailboxRestoreRequestStatistics](https://learn.microsoft.com/en-us/powershell/module/exchange/get-mailboxrestorerequeststatistics)
- [Microsoft Learn — Recover Exchange servers](https://learn.microsoft.com/en-us/exchange/high-availability/disaster-recovery/recover-exchange-servers)
- [Microsoft Learn — Recover a DAG member server](https://learn.microsoft.com/en-us/exchange/high-availability/disaster-recovery/recover-dag-member-servers)
- [Microsoft Learn — Recover an MCDB-enabled database](https://learn.microsoft.com/en-us/troubleshoot/exchange/administration/restore-database-backup-mcdb-enable)

*Contenu élaboré à partir des manipulations de la formation 20345-1B, module 7, et revérifié avec la documentation Microsoft Learn. Les exemples sont volontairement génériques et ne constituent pas une procédure de reprise universelle.*