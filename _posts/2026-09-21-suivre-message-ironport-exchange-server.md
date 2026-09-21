---
layout: post
title: "Suivre un message de bout en bout entre Cisco IronPort et Exchange Server"
description: "Une méthode de diagnostic pour corréler le Message Tracking Cisco IronPort avec les journaux de transport Exchange dans une infrastructure composée de plusieurs serveurs et d'un DAG."
tags:
  - Exchange Server
  - Cisco IronPort
  - Message Tracking
  - PowerShell
  - SMTP
  - diagnostic
---

Lorsqu'un utilisateur signale qu'un message n'est pas arrivé, la première difficulté consiste à déterminer où il s'est arrêté. Dans une infrastructure composée de plusieurs serveurs Exchange et de passerelles Cisco IronPort distinctes pour les flux entrants et sortants, il n'existe pas de suivi global unique.

Le diagnostic repose donc sur la corrélation de plusieurs traces :

- le Message Tracking du cluster IronPort entrant ;
- les journaux de suivi des différents serveurs Exchange ;
- le Message Tracking du cluster IronPort sortant.

L'objectif de cette procédure est de reconstruire le chemin du message et d'identifier le dernier composant qui l'a accepté.

## Architecture utilisée

Le scénario de référence utilise les flux suivants :

- Flux entrant : `Internet` → `cluster IronPort entrant` → `serveurs Exchange` → `boîte aux lettres`
- Flux sortant : `boîte aux lettres` → `serveurs Exchange` → `cluster IronPort sortant` → `Internet`

Les serveurs Exchange hébergent des bases de données membres d'un DAG.

Le DAG protège les bases de données de boîtes aux lettres, mais il ne centralise pas les journaux de transport. Chaque serveur Exchange conserve les événements des messages qu'il a effectivement traités.

Il ne faut donc pas limiter la recherche au serveur qui héberge actuellement la copie active de la base de données. Un message peut entrer par un autre serveur Exchange avant d'être routé vers le serveur chargé de la remise dans la boîte.

## Informations à collecter

Avant de commencer, il faut réunir le maximum d'informations disponibles :

| Information | Utilité |
|---|---|
| Sens du message | Détermine le point de départ de la recherche |
| Expéditeur | Permet un premier filtrage |
| Destinataire | Généralement le critère le plus fiable pour commencer |
| Date et heure | Limite le volume de résultats |
| Fuseau horaire | Évite de chercher dans une mauvaise plage |
| Objet | Utile pour confirmer, mais peu fiable comme identifiant |
| `Message-ID` | Meilleur identifiant commun entre IronPort et Exchange |
| Copie d'un éventuel NDR | Fournit le code SMTP et parfois l'identifiant du message |

Il faut autant que possible récupérer l'adresse SMTP d'enveloppe. Elle peut être différente de l'adresse visible dans le champ `From` du message, notamment pour les listes de diffusion, les messages automatiques et certains envois délégués.

## Les identifiants à ne pas confondre

Plusieurs identifiants apparaissent pendant le suivi.

| Identifiant | Portée | Utilisation |
|---|---|---|
| `Message-ID` | En-tête du message | Principal identifiant de corrélation entre IronPort et Exchange |
| MID IronPort | Une passerelle Cisco | Recherche détaillée sur l'appliance ayant traité le message |
| `NetworkMessageId` | Organisation Exchange | Regroupe les copies Exchange créées par bifurcation ou expansion |
| `InternalMessageId` | Un serveur Exchange | Suit le traitement local du message sur ce serveur |
| Objet | Aucune garantie d'unicité | Uniquement un critère de confirmation |

Le `Message-ID` est généralement le meilleur pont entre les deux produits. Dans Exchange, il correspond à l'en-tête `Message-Id` du message. Il reste normalement constant pendant la durée de vie du message.

Il peut par exemple avoir la forme suivante :

```text
<7f462a82-0712-4c49-a934-9737e24399ae@partner.example>
```

Il faut conserver la valeur complète, y compris les caractères `<` et `>`.

Le MID IronPort ne doit pas être utilisé directement dans Exchange. Il identifie le message sur une passerelle Cisco donnée. Dans un cluster, il est préférable de noter le nom de l'appliance avec le MID.

L'`InternalMessageId` Exchange est lui aussi local. Un même message reçoit un identifiant différent sur chaque serveur Exchange traversé.

## Interroger tous les serveurs Exchange

La fonction suivante interroge les journaux de suivi de tous les serveurs ayant le rôle Mailbox.

Elle ajoute une propriété `TrackingServer` afin d'identifier le serveur sur lequel chaque événement a été trouvé.

```powershell
function Get-OrgMessageTracking {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [datetime] $Start,

        [Parameter(Mandatory)]
        [datetime] $End,

        [string] $Sender,
        [string] $Recipient,
        [string] $MessageId,
        [string] $NetworkMessageId
    )

    $Servers = Get-ExchangeServer |
        Where-Object { $_.ServerRole -match 'Mailbox' }

    foreach ($Server in $Servers) {
        $Parameters = @{
            Server      = $Server.Name
            Start       = $Start
            End         = $End
            ResultSize  = 'Unlimited'
            ErrorAction = 'Stop'
        }

        if ($Sender) {
            $Parameters.Sender = $Sender
        }

        if ($Recipient) {
            $Parameters.Recipients = $Recipient
        }

        if ($MessageId) {
            $Parameters.MessageId = $MessageId
        }

        if ($NetworkMessageId) {
            $Parameters.NetworkMessageId = $NetworkMessageId
        }

        try {
            Get-MessageTrackingLog @Parameters |
                Select-Object `
                    @{Name = 'TrackingServer'; Expression = { $Server.Name }},
                    Timestamp,
                    EventId,
                    Source,
                    Sender,
                    ReturnPath,
                    Recipients,
                    MessageSubject,
                    MessageId,
                    NetworkMessageId,
                    InternalMessageId,
                    ConnectorId,
                    ClientHostname,
                    ClientIp,
                    ServerHostname,
                    ServerIp,
                    RecipientStatus
        }
        catch {
            Write-Warning "Impossible d'interroger $($Server.Name) : $($_.Exception.Message)"
        }
    }
}
```

Une première recherche peut être effectuée avec l'expéditeur, le destinataire et une plage horaire :

```powershell
$Start = Get-Date `
    -Year 2026 `
    -Month 9 `
    -Day 19 `
    -Hour 9 `
    -Minute 0 `
    -Second 0

$End = $Start.AddHours(1)

$Tracking = Get-OrgMessageTracking `
    -Start $Start `
    -End $End `
    -Sender 'alice@partner.example' `
    -Recipient 'bob@example.net'

$Tracking |
    Sort-Object Timestamp |
    Format-Table `
        Timestamp,
        TrackingServer,
        EventId,
        Source,
        Sender,
        Recipients,
        ConnectorId `
        -AutoSize
```

Si aucun résultat n'est trouvé, il faut retirer progressivement les critères, en commençant généralement par l'expéditeur.

En effet, le champ `Sender` des journaux Exchange et l'expéditeur d'enveloppe affiché par IronPort peuvent être différents. Une recherche limitée au destinataire et à l'heure permet alors de retrouver le message, puis d'examiner les propriétés `Sender` et `ReturnPath`.

Lorsque le `Message-ID` est disponible, une recherche exacte est préférable :

```powershell
$MessageId = '<7f462a82-0712-4c49-a934-9737e24399ae@partner.example>'

$Tracking = Get-OrgMessageTracking `
    -Start $Start `
    -End $End `
    -MessageId $MessageId

$Tracking |
    Sort-Object Timestamp |
    Format-List
```

Après avoir trouvé une première trace, l'`NetworkMessageId` peut servir à retrouver les différentes copies créées par Exchange :

```powershell
$NetworkMessageId = $Tracking |
    Where-Object { $_.NetworkMessageId } |
    Select-Object -First 1 -ExpandProperty NetworkMessageId

Get-OrgMessageTracking `
    -Start $Start `
    -End $End `
    -NetworkMessageId $NetworkMessageId |
    Sort-Object Timestamp
```

Le paramètre `-End` est exclusif : les événements ayant exactement la date et l'heure de fin ne sont pas retournés. La valeur par défaut de `ResultSize` étant limitée à 1 000 résultats, la fonction utilise explicitement `Unlimited`.

## Scénario 1 : suivre un message entrant

Pour un message envoyé depuis Internet, la recherche commence sur le cluster IronPort entrant.

### Rechercher le message sur IronPort

Selon la version de l'interface Cisco, le suivi est accessible depuis :

- `Tracking` puis `Messages` dans la nouvelle interface ;
- `Monitor` puis `Message Tracking` dans l'interface historique.

Commencer avec les critères suivants :

- une plage horaire courte ;
- l'expéditeur d'enveloppe ;
- le destinataire d'enveloppe.

Les critères IronPort sont généralement combinés avec un opérateur logique `AND`. Ajouter trop de critères dès la première recherche peut donc masquer le résultat.

L'objet peut être utilisé pour confirmer le message, mais il ne constitue pas un identifiant fiable. Il peut être absent des traces, modifié ou commun à plusieurs messages.

Si le suivi est centralisé, sélectionner le cluster entrant ou les appliances correspondantes dans le champ `Cisco Host`. Si le suivi est local, répéter la recherche sur chaque appliance susceptible d'avoir reçu le message.

Une fois le message trouvé, ouvrir ses détails et relever :

- le nom de l'appliance ;
- le MID IronPort ;
- l'heure de réception ;
- le `Message ID Header` ;
- les événements de traitement ;
- le verdict antispam ou antivirus ;
- une éventuelle mise en quarantaine ;
- le serveur Exchange utilisé comme destination ;
- la réponse SMTP retournée par Exchange.

La dernière ligne du traitement permet généralement de déterminer si le message a été bloqué, mis en quarantaine, rejeté ou remis au serveur Exchange.

### Cas des connexions rejetées

L'interface Cisco permet également de rechercher les connexions rejetées. Cette possibilité dépend toutefois de la configuration du Message Tracking.

Si l'enregistrement des connexions rejetées n'est pas activé, l'absence de résultat ne prouve pas que la tentative SMTP n'a jamais atteint IronPort.

### Continuer la recherche dans Exchange

Si IronPort indique que le message a été remis à Exchange, récupérer son `Message ID Header` et l'utiliser dans la fonction PowerShell :

```powershell
Get-OrgMessageTracking `
    -Start $Start `
    -End $End `
    -MessageId '<7f462a82-0712-4c49-a934-9737e24399ae@partner.example>' |
    Sort-Object Timestamp
```

Pour un message entrant remis correctement, les événements importants sont généralement :

- `RECEIVE` : le service de transport a reçu le message ;
- `SEND` : le message a été transmis à un autre service ou serveur Exchange ;
- `DELIVER` : le message a été remis à une boîte aux lettres locale.

D'autres événements peuvent apparaître en raison du routage, des agents de transport ou de la redondance d'ombre. Il ne faut donc pas chercher une séquence strictement identique pour tous les messages.

### Interpréter le résultat

| Observation | Interprétation |
|---|---|
| Aucun résultat sur IronPort | Mauvaise plage horaire, mauvaise appliance ou message non reçu |
| Message rejeté ou mis en quarantaine | Le traitement s'est arrêté sur IronPort |
| IronPort a reçu un code SMTP `250` d'Exchange | Exchange a accepté la responsabilité du message |
| `RECEIVE` sans `DELIVER` | Le message est entré dans Exchange mais la remise n'est pas terminée |
| Événement `DEFER` | Le traitement ou la remise est temporairement retardé |
| Événement `FAIL` | Échec de remise ou de routage |
| Événement `DELIVER` | Le transport Exchange a remis le message à la boîte |

Un événement `DELIVER` confirme la remise à la boîte aux lettres, mais pas sa visibilité dans Outlook. Si l'utilisateur ne trouve toujours pas le message, il faut ensuite examiner les règles de boîte de réception, le dossier Courrier indésirable, les délégations et les actions effectuées par le client.

## Scénario 2 : suivre un message sortant

Pour un message envoyé par un utilisateur interne, la recherche commence dans Exchange.

### Retrouver la soumission du message

La première recherche peut utiliser l'expéditeur, le destinataire et une plage horaire :

```powershell
$Tracking = Get-OrgMessageTracking `
    -Start $Start `
    -End $End `
    -Sender 'bob@example.net' `
    -Recipient 'alice@partner.example'

$Tracking |
    Sort-Object Timestamp |
    Format-Table `
        Timestamp,
        TrackingServer,
        EventId,
        Source,
        Sender,
        Recipients,
        ConnectorId,
        RecipientStatus `
        -AutoSize
```

Pour un message créé dans une boîte Exchange, les événements suivants sont particulièrement utiles :

- `CLIENTSUBMISSION` : le message a été soumis depuis la boîte d'envoi ;
- `RECEIVE` avec la source `STOREDRIVER` : le message a été récupéré depuis la boîte ;
- `SUBMIT` : le service Mailbox Transport Submission l'a transmis au service Transport ;
- `SEND` : le message a été envoyé en SMTP vers le prochain serveur.

L'événement `SEND` doit être examiné avec les champs suivants :

- `ConnectorId` ;
- `ServerHostname` ;
- `ServerIp` ;
- `RecipientStatus`.

Ils permettent de vérifier que le message a quitté Exchange par le connecteur attendu et qu'il a été transmis au cluster IronPort sortant.

### Continuer la recherche sur IronPort

Récupérer le `MessageId` dans les résultats Exchange :

```powershell
$MessageId = $Tracking |
    Where-Object { $_.MessageId } |
    Select-Object -First 1 -ExpandProperty MessageId

$MessageId
```

Dans le Message Tracking du cluster IronPort sortant, rechercher ensuite cette valeur dans le champ `Message ID Header`.

À défaut, utiliser :

- l'expéditeur d'enveloppe ;
- le destinataire d'enveloppe ;
- la plage horaire correspondant à l'événement `SEND` Exchange.

Ouvrir les détails du résultat et vérifier :

- l'appliance ayant traité le message ;
- le MID IronPort ;
- l'acceptation du message depuis Exchange ;
- les traitements antispam, antivirus, DLP ou filtres de contenu ;
- les éventuelles transformations ou divisions du message ;
- la tentative de livraison vers le serveur distant ;
- la dernière réponse SMTP reçue.

### Interpréter la réponse distante

| Réponse ou état | Interprétation |
|---|---|
| Code `250` | Le serveur distant a accepté le message |
| Code temporaire `4xx` | IronPort doit normalement conserver le message et réessayer |
| Code permanent `5xx` | Le serveur distant a refusé le message |
| Hard bounce | Échec permanent ayant généralement entraîné la génération d'un NDR |
| Quarantaine | Le message n'a pas quitté la passerelle |
| Aucun événement de livraison | Examiner le routage, les politiques et les files d'attente IronPort |

Un code SMTP `250` reçu par IronPort signifie que le serveur distant a accepté la responsabilité du message. Il ne garantit pas que celui-ci a été placé dans la boîte de réception de l'utilisateur final. Le système distant peut encore appliquer des règles, une quarantaine ou un classement en courrier indésirable.

## Vérifier les files d'attente Exchange

Les journaux de suivi décrivent l'historique du message. Les files d'attente permettent de vérifier son état actuel s'il est encore bloqué sur Exchange.

Pour afficher les files contenant des messages sur l'ensemble des serveurs :

```powershell
$Servers = Get-ExchangeServer |
    Where-Object { $_.ServerRole -match 'Mailbox' }

foreach ($Server in $Servers) {
    Get-Queue `
        -Server $Server.Name `
        -ResultSize Unlimited |
        Where-Object { $_.MessageCount -gt 0 } |
        Select-Object `
            @{Name = 'ExchangeServer'; Expression = { $Server.Name }},
            Identity,
            Status,
            MessageCount,
            NextHopDomain,
            LastError
}
```

Pour examiner les messages actuellement en attente sur un serveur :

```powershell
Get-Message `
    -Server EXCH01 `
    -Filter "FromAddress -eq 'bob@example.net'" `
    -ResultSize Unlimited |
    Format-List `
        Identity,
        FromAddress,
        Recipients,
        Subject,
        Status,
        LastError
```

`Get-Queue` et `Get-Message` ne remplacent pas le Message Tracking. Ils affichent uniquement les messages encore présents dans les files au moment de la commande.

## Principaux événements Exchange

| Événement | Signification |
|---|---|
| `CLIENTSUBMISSION` | Soumission du message depuis la boîte d'envoi |
| `RECEIVE` | Réception par SMTP ou depuis le Store Driver |
| `SUBMIT` | Transmission réussie du service Mailbox Transport Submission au service Transport |
| `SEND` | Envoi SMTP vers un autre service ou serveur |
| `DELIVER` | Remise à une boîte aux lettres locale |
| `DEFER` | Traitement ou remise retardé |
| `FAIL` | Échec de remise |
| `DSN` | Génération d'une notification de remise ou d'un NDR |
| `EXPAND` | Expansion d'un groupe de distribution |
| `RESOLVE` | Résolution du destinataire vers une autre adresse |
| `REDIRECT` | Redirection vers un autre destinataire |
| `HAREDIRECT` | Création d'une copie de redondance d'ombre |
| `HARECEIVE` | Réception d'une copie de redondance d'ombre |
| `HADISCARD` | Suppression de la copie d'ombre après remise de la copie principale |

Les événements `HAREDIRECT`, `HARECEIVE` et `HADISCARD` sont normaux dans une infrastructure Exchange utilisant la redondance d'ombre. Ils ne signalent pas à eux seuls un problème de transport.

## Pièges fréquents

### Rechercher uniquement sur un serveur Exchange

Dans une infrastructure composée de plusieurs serveurs, le message peut avoir traversé plusieurs services Transport. Les journaux doivent être interrogés sur tous les serveurs susceptibles d'avoir participé au flux.

### Confondre le MID IronPort et le Message-ID

Le MID IronPort est propre à une appliance. Le `Message-ID` provient de l'en-tête du message et constitue l'identifiant commun utilisable pour passer d'IronPort à Exchange.

### Utiliser l'InternalMessageId entre plusieurs serveurs

L'`InternalMessageId` change lorsqu'un message passe sur un autre serveur Exchange. Pour une corrélation à l'échelle de l'organisation, utiliser le `MessageId` ou le `NetworkMessageId`.

### Se fier uniquement à l'objet

Plusieurs messages peuvent avoir le même objet. Celui-ci peut également être modifié par une règle, un préfixe de réponse ou un système de sécurité.

### Négliger les fuseaux horaires

Les interfaces peuvent afficher des heures locales différentes. Cisco stocke les dates en GMT puis les affiche selon l'heure locale de l'appliance. Il faut relever le fuseau de chaque système et élargir la plage de quelques minutes en cas de doute.

### Considérer un code 250 comme une remise finale

Un code `250` confirme uniquement que le prochain serveur SMTP a accepté la responsabilité du message. Il ne confirme pas nécessairement son arrivée dans la boîte de réception finale.

### Oublier la rétention des journaux

Les journaux Exchange utilisent une rétention circulaire. Le Message Tracking IronPort dépend également de la période de conservation configurée. Une recherche ancienne peut donc ne plus retourner de résultat.

## Méthode de diagnostic recommandée

Pour un message entrant :

1. Rechercher le message sur le cluster IronPort entrant.
2. Vérifier le traitement de sécurité et la remise vers Exchange.
3. Relever le nom de l'appliance, le MID, le `Message-ID`, l'heure et la réponse SMTP.
4. Rechercher le `Message-ID` sur tous les serveurs Exchange.
5. Reconstruire les événements jusqu'à `DELIVER`, `DEFER` ou `FAIL`.
6. Examiner les files d'attente si le message semble toujours en cours de traitement.

Pour un message sortant :

1. Rechercher la soumission sur tous les serveurs Exchange.
2. Identifier l'événement `SEND`, le connecteur utilisé et le serveur IronPort cible.
3. Récupérer le `Message-ID`.
4. Rechercher ce `Message-ID` sur le cluster IronPort sortant.
5. Vérifier la dernière tentative de livraison et la réponse SMTP distante.
6. En cas de réponse `4xx`, contrôler si le message est toujours en attente.
7. En cas de réponse `5xx`, analyser le motif du refus et le NDR associé.

Cette méthode permet de découper le chemin du message en frontières SMTP successives. À chaque frontière, le dernier composant ayant obtenu une réponse positive devient responsable de l'étape suivante du diagnostic.

## Références

- [Microsoft Learn - Message tracking dans Exchange Server](https://learn.microsoft.com/en-us/exchange/mail-flow/transport-logs/message-tracking)
- [Microsoft Learn - Get-MessageTrackingLog](https://learn.microsoft.com/en-us/powershell/module/exchangepowershell/get-messagetrackinglog?view=exchange-ps)
- [Microsoft Learn - Get-Queue](https://learn.microsoft.com/en-us/powershell/module/exchangepowershell/get-queue?view=exchange-ps)
- [Microsoft Learn - Get-Message](https://learn.microsoft.com/en-us/powershell/module/exchangepowershell/get-message?view=exchange-ps)
- [Cisco - Tracking Messages avec AsyncOS 15.0](https://www.cisco.com/c/en/us/td/docs/security/esa/esa15-0/user_guide/b_ESA_Admin_Guide_15-0/b_ESA_Admin_Guide_12_1_chapter_011110.html)
