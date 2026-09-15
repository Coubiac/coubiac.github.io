---
layout: post
title: Récupérer le Part Number des disques HPE avec PowerShell, OneView et Redfish
description: Utiliser l'API HPE OneView puis Redfish pour inventorier les disques physiques et récupérer leur Part Number sans module PowerShell HPE.
tags:
  - PowerShell
  - HPE OneView
  - Redfish
  - HPE iLO
---

Lorsqu'un parc de serveurs HPE est géré par OneView, l'API permet de récupérer une grande partie de l'inventaire matériel. Pour le stockage local, l'endpoint `localStorageV2` fournit notamment les contrôleurs, les disques et les volumes.

Il peut cependant manquer une information utile pour réaliser un inventaire matériel précis : le `PartNumber` des disques physiques.

L'information peut être disponible directement dans l'iLO via l'API Redfish. Il est alors possible d'utiliser OneView pour obtenir une session SSO vers l'iLO, puis d'interroger Redfish en PowerShell, sans installer de module HPE.

Les exemples ci-dessous sont compatibles avec Windows PowerShell 5.1. Ils tiennent également compte d'un cas fréquent : OneView possède un certificat signé par une PKI de confiance, alors que les interfaces iLO utilisent encore des certificats autosignés.

## Principe

Le chemin utilisé est le suivant :

```text
PowerShell
    |
    +-- API HPE OneView
            |
            +-- Inventaire des serveurs
            |
            +-- Session SSO iLO
                    |
                    +-- API Redfish de l'iLO
                            |
                            +-- Systems
                            +-- Storage
                            +-- Drives
                                    |
                                    +-- PartNumber
```

OneView reste donc le point d'entrée. Il permet de retrouver les serveurs et de créer la session iLO. L'inventaire détaillé des disques est ensuite lu directement depuis Redfish.

Aucun module PowerShell HPE n'est nécessaire. Les appels sont réalisés avec `Invoke-RestMethod`.

## Connexion à l'API OneView

Avec Windows PowerShell 5.1, il est utile de forcer l'utilisation de TLS 1.2 avant les appels HTTPS :

```powershell
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
```

On commence ensuite par récupérer la version courante de l'API :

```powershell
$OneView = 'https://oneview.example.net'

$ApiVersion = (
    Invoke-RestMethod `
        -Method Get `
        -Uri "$OneView/rest/version" `
        -UseBasicParsing `
        -ErrorAction Stop
).currentVersion
```

Dans cet exemple, le certificat présenté par OneView est signé par une autorité de certification approuvée par le poste. Il n'est donc pas nécessaire de désactiver sa validation.

Puis on ouvre une session :

```powershell
$Credential = Get-Credential

$LoginBody = @{
    userName = $Credential.UserName
    password = $Credential.GetNetworkCredential().Password
} | ConvertTo-Json

$Session = Invoke-RestMethod `
    -Method Post `
    -Uri "$OneView/rest/login-sessions" `
    -Headers @{
        'X-API-Version' = $ApiVersion
    } `
    -ContentType 'application/json' `
    -Body $LoginBody `
    -UseBasicParsing `
    -ErrorAction Stop

$OneViewHeaders = @{
    'X-API-Version' = $ApiVersion
    'Auth'          = $Session.sessionID
    'Accept'        = 'application/json'
}
```

Dans la suite du script, une petite fonction permet de simplifier les appels GET vers OneView :

```powershell
function Invoke-OneViewGet {
    param(
        [Parameter(Mandatory)]
        [string]$Uri
    )

    if ($Uri -notmatch '^https?://') {
        $Uri = "$OneView$Uri"
    }

    Invoke-RestMethod `
        -Method Get `
        -Uri $Uri `
        -Headers $OneViewHeaders `
        -UseBasicParsing `
        -ErrorAction Stop
}
```

## Récupérer l'inventaire des serveurs une seule fois

Lorsqu'il faut traiter plusieurs dizaines ou plusieurs centaines de serveurs, il n'est pas nécessaire d'interroger à nouveau la collection `server-hardware` pour chaque machine.

Une fonction peut parcourir les différentes pages retournées par OneView :

```powershell
function Get-OneViewCollection {
    param(
        [Parameter(Mandatory)]
        [string]$Uri
    )

    $Members = @()

    do {
        $Page = Invoke-OneViewGet -Uri $Uri

        $Members += @($Page.members)
        $Uri = $Page.nextPageUri

    } while ($Uri)

    return $Members
}
```

L'inventaire complet est alors récupéré une seule fois :

```powershell
$AllServers = Get-OneViewCollection `
    -Uri '/rest/server-hardware?count=500'
```

Il est ensuite possible de sélectionner les serveurs à traiter :

```powershell
$ServerNames = @(
    'apollo-01',
    'apollo-02',
    'apollo-03'
)

$Servers = $AllServers |
    Where-Object {
        $_.name -in $ServerNames
    }
```

Le filtre peut naturellement être basé sur d'autres propriétés de l'inventaire OneView.

## Vérifier d'abord ce que retourne OneView

Avant d'interroger l'iLO, il peut être intéressant de regarder le stockage remonté directement par OneView :

```powershell
$Server = $Servers[0]

$LocalStorage = Invoke-OneViewGet `
    -Uri "$($Server.uri)/localStorageV2"

$LocalStorage |
    ConvertTo-Json -Depth 20
```

Suivant la génération du serveur, du contrôleur et les versions de firmware, différentes informations peuvent apparaître.

Le problème est que le `PartNumber` du disque n'est pas systématiquement présent dans cet inventaire.

C'est dans ce cas que Redfish devient intéressant.

## Obtenir une session SSO vers l'iLO

OneView dispose de l'endpoint :

```text
/rest/server-hardware/{id}/remoteConsoleUrl
```

Il génère une session SSO vers l'iLO du serveur concerné.

La réponse contient typiquement une URL de ce type :

```text
hplocons://addr=ilo.example.net&sessionkey=<SESSION_KEY>
```

On peut en extraire l'adresse de l'iLO et la clé de session :

```powershell
function Get-IloSsoSession {
    param(
        [Parameter(Mandatory)]
        $Server
    )

    $Response = Invoke-OneViewGet `
        -Uri "$($Server.uri)/remoteConsoleUrl"

    $RemoteConsoleUrl = $Response.remoteConsoleUrl

    if (
        $RemoteConsoleUrl -notmatch
        'addr=([^&]+).*sessionkey=([^&]+)'
    ) {
        throw "Impossible de récupérer la session iLO pour $($Server.name)"
    }

    [PSCustomObject]@{
        Address = [uri]::UnescapeDataString($Matches[1])
        Token   = [uri]::UnescapeDataString($Matches[2])
    }
}
```

Le `sessionkey` peut ensuite être présenté à l'iLO dans l'en-tête HTTP `X-Auth-Token`.

Cela évite de conserver un compte et un mot de passe iLO dans le script. Le poste qui exécute le script doit en revanche pouvoir joindre directement les interfaces iLO en HTTPS.

## Interroger Redfish avec des certificats iLO autosignés

Windows PowerShell 5.1 ne possède pas le paramètre `-SkipCertificateCheck` disponible dans les versions modernes de PowerShell.

Si les iLO utilisent encore des certificats autosignés, un appel direct avec `Invoke-RestMethod` peut donc échouer avec un message de ce type :

```text
Could not establish trust relationship for the SSL/TLS secure channel
```

Dans ce cas, la validation du certificat peut être désactivée uniquement pendant l'appel Redfish, puis restaurée immédiatement après.

```powershell
function Invoke-RedfishGet {
    param(
        [Parameter(Mandatory)]
        [string]$BaseUri,

        [Parameter(Mandatory)]
        [string]$Uri,

        [Parameter(Mandatory)]
        [string]$Token
    )

    if ($Uri -notmatch '^https?://') {
        $Uri = "$BaseUri$Uri"
    }

    $OldCallback = [System.Net.ServicePointManager]::ServerCertificateValidationCallback

    try {
        [System.Net.ServicePointManager]::ServerCertificateValidationCallback = {
            $true
        }

        Invoke-RestMethod `
            -Method Get `
            -Uri $Uri `
            -Headers @{
                'X-Auth-Token' = $Token
                'Accept'       = 'application/json'
            } `
            -UseBasicParsing `
            -ErrorAction Stop
    }
    finally {
        [System.Net.ServicePointManager]::ServerCertificateValidationCallback = $OldCallback
    }
}
```

Le `finally` est important : la validation TLS normale est restaurée même si l'appel vers l'iLO échoue.

Cette méthode désactive toutefois toute validation du certificat pendant la durée de l'appel concerné. Elle convient comme solution transitoire dans un script séquentiel lorsque les interfaces iLO utilisent des certificats autosignés, mais elle ne doit pas être considérée comme l'état cible.

La solution propre à terme consiste à déployer sur les iLO des certificats signés par une PKI approuvée par les postes d'administration. La fonction peut alors être simplifiée et le contournement supprimé.

Il faut également éviter d'utiliser cette technique telle quelle dans un traitement parallèle : `ServerCertificateValidationCallback` est une propriété statique du processus .NET et n'est donc pas limitée à une seule requête concurrente.

## Récupérer les disques physiques

Il ne faut pas partir du principe que le serveur Redfish est obligatoirement accessible sous :

```text
/redfish/v1/Systems/1
```

Il est préférable de commencer par la collection `Systems` et de suivre les URI retournées par Redfish.

La fonction suivante parcourt les systèmes, les sous-systèmes de stockage puis les disques :

```powershell
function Get-HpeDriveInventory {
    param(
        [Parameter(Mandatory)]
        $Server,

        [Parameter(Mandatory)]
        $IloSession
    )

    $BaseUri = "https://$($IloSession.Address)"

    $Systems = Invoke-RedfishGet `
        -BaseUri $BaseUri `
        -Uri '/redfish/v1/Systems' `
        -Token $IloSession.Token

    foreach ($SystemRef in $Systems.Members) {

        $SystemUri = $SystemRef.'@odata.id'

        $System = Invoke-RedfishGet `
            -BaseUri $BaseUri `
            -Uri $SystemUri `
            -Token $IloSession.Token

        $StorageUri = $System.Storage.'@odata.id'

        if (-not $StorageUri) {
            $StorageUri = "$SystemUri/Storage"
        }

        $StorageCollection = Invoke-RedfishGet `
            -BaseUri $BaseUri `
            -Uri $StorageUri `
            -Token $IloSession.Token

        foreach ($StorageRef in $StorageCollection.Members) {

            $Storage = Invoke-RedfishGet `
                -BaseUri $BaseUri `
                -Uri $StorageRef.'@odata.id' `
                -Token $IloSession.Token

            foreach ($DriveRef in @($Storage.Drives)) {

                $Drive = Invoke-RedfishGet `
                    -BaseUri $BaseUri `
                    -Uri $DriveRef.'@odata.id' `
                    -Token $IloSession.Token

                [PSCustomObject]@{
                    Server       = $Server.name
                    ILO          = $IloSession.Address
                    Storage      = $Storage.Name
                    DriveId      = $Drive.Id
                    Location     = $Drive.PhysicalLocation.PartLocation.ServiceLabel
                    Manufacturer = $Drive.Manufacturer
                    Model        = $Drive.Model
                    PartNumber   = $Drive.PartNumber
                    SerialNumber = $Drive.SerialNumber
                    MediaType    = $Drive.MediaType
                    Protocol     = $Drive.Protocol
                    CapacityGB   = if ($Drive.CapacityBytes) {
                        [math]::Round(
                            $Drive.CapacityBytes / 1GB,
                            1
                        )
                    }
                    else {
                        $null
                    }
                }
            }
        }
    }
}
```

La propriété recherchée se trouve simplement dans :

```powershell
$Drive.PartNumber
```

Le modèle Redfish standard `Drive` prévoit notamment les propriétés `Manufacturer`, `Model`, `PartNumber`, `SerialNumber`, `CapacityBytes`, `MediaType`, `Protocol` et `FirmwareVersion`.

## Traiter plusieurs serveurs

Une fois les fonctions en place, le traitement de plusieurs serveurs devient assez simple :

```powershell
$Results = foreach ($Server in $Servers) {

    Write-Host "Traitement de $($Server.name)"

    try {
        $IloSession = Get-IloSsoSession `
            -Server $Server

        Get-HpeDriveInventory `
            -Server $Server `
            -IloSession $IloSession
    }
    catch {
        Write-Warning (
            'Erreur sur {0} : {1}' -f
            $Server.name,
            $_.Exception.Message
        )
    }
}
```

L'inventaire peut ensuite être affiché :

```powershell
$Results |
    Sort-Object Server, Location |
    Format-Table -AutoSize
```

ou exporté dans un fichier CSV :

```powershell
$Results |
    Sort-Object Server, Location |
    Export-Csv `
        -Path '.\hpe-disks.csv' `
        -NoTypeInformation `
        -Encoding UTF8
```

## Attention aux anciennes générations de stockage HPE

Les anciennes implémentations HPE peuvent également exposer un modèle propriétaire Smart Storage sous une arborescence de ce type :

```text
/redfish/v1/Systems/{id}/SmartStorage
```

Les disques y sont représentés par des objets `HpeSmartStorageDiskDrive`.

Ce modèle fournit de nombreuses informations sur les disques, mais ne définit pas la même propriété `PartNumber` que la ressource Redfish standard `Drive`.

Le modèle Redfish standard utilise une arborescence de ce type :

```text
/redfish/v1/Systems/{id}/Storage/{id}/Drives/{id}
```

La ressource `Drive` possède bien une propriété `PartNumber`.

Il faut donc tenir compte de la génération du serveur, de l'iLO, du contrôleur de stockage et de son firmware. La présence de `/Storage` ne garantit pas nécessairement que tous les contrôleurs et tous les disques d'une ancienne plateforme seront représentés de la même manière.

## En résumé

L'API OneView reste pratique pour obtenir la liste des serveurs et accéder à leurs contrôleurs de management, mais elle ne fournit pas nécessairement tout l'inventaire matériel disponible dans l'iLO.

Pour récupérer le `PartNumber` des disques, l'enchaînement est le suivant :

```text
OneView
  -> server-hardware
  -> remoteConsoleUrl
  -> session SSO iLO
  -> Redfish
  -> Systems
  -> Storage
  -> Drives
  -> PartNumber
```

Avec Windows PowerShell 5.1, il faut également tenir compte de la gestion des certificats. Si OneView possède un certificat approuvé mais que les iLO utilisent encore des certificats autosignés, la validation peut être contournée uniquement pendant les appels Redfish puis immédiatement restaurée.

Cette méthode fonctionne avec plusieurs serveurs : l'inventaire OneView est récupéré une seule fois, puis chaque serveur est interrogé successivement. Le résultat peut ensuite être utilisé directement en PowerShell ou exporté en CSV pour constituer un inventaire matériel.

## Références

- Documentation HPE OneView SDK : [Server Hardware](https://hewlettpackard.github.io/oneview-python/hpeOneView.resources.servers.html)
- Documentation HPE iLO 5 Redfish : [Storage resource definitions](https://servermanagementportal.ext.hpe.com/docs/redfishservices/ilos/ilo5/ilo5_304/ilo5_storage_resourcedefns304)
- Documentation HPE Redfish : [Storage data models](https://servermanagementportal.ext.hpe.com/docs/redfishservices/ilos/supplementdocuments/storage)
