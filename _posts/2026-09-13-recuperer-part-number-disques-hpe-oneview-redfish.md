---
layout: post
title: Inventorier les disques HPE avec PowerShell, OneView et Redfish
description: Utiliser l'API HPE OneView puis Redfish pour récupérer le modèle, la révision du firmware et les heures de fonctionnement des disques physiques.
tags:
  - PowerShell
  - HPE OneView
  - Redfish
  - HPE iLO
---

Lorsqu'un parc de serveurs HPE est géré par OneView, l'API permet de récupérer une grande partie de l'inventaire matériel. Pour le stockage local, l'endpoint `localStorageV2` fournit notamment les contrôleurs, les disques et les volumes.

Certaines informations détaillées ne sont cependant pas toujours présentes dans cet inventaire. C'est notamment le cas du modèle exact, de la révision du firmware, du `PartNumber` ou du nombre d'heures de fonctionnement du disque.

Ces informations peuvent être disponibles directement dans l'iLO via l'API Redfish. Il est alors possible d'utiliser OneView pour obtenir une session SSO vers l'iLO, puis d'interroger Redfish en PowerShell, sans installer de module HPE.

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
                                    +-- Model
                                    +-- Revision
                                    +-- PowerOnHours
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

Le problème est que les propriétés nécessaires à un inventaire détaillé ne sont pas systématiquement présentes dans la réponse de OneView.

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

Une solution souvent utilisée consiste à affecter directement un bloc PowerShell à `ServerCertificateValidationCallback` :

```powershell
[System.Net.ServicePointManager]::ServerCertificateValidationCallback = {
    $true
}
```

Cette méthode peut cependant échouer avec Windows PowerShell 5.1. Le callback peut être exécuté par .NET sur un thread ne disposant pas de runspace PowerShell. L'erreur réellement remontée par `Invoke-RestMethod` est alors peu explicite :

```text
The underlying connection was closed: An unexpected error occurred on a send
```

Pour éviter l'exécution d'un scriptblock PowerShell dans le callback, il est possible de compiler une petite classe .NET qui implémente `ICertificatePolicy`. La classe doit être déclarée une seule fois, avant la fonction `Invoke-RedfishGet` :

```powershell
if (-not ('IloTrustAllCertsPolicy' -as [type])) {
    Add-Type -TypeDefinition @'
using System.Net;
using System.Security.Cryptography.X509Certificates;

public class IloTrustAllCertsPolicy : ICertificatePolicy
{
    public bool CheckValidationResult(
        ServicePoint servicePoint,
        X509Certificate certificate,
        WebRequest request,
        int certificateProblem)
    {
        return true;
    }
}
'@
}
```

La politique est ensuite activée uniquement pendant l'appel Redfish, puis la politique précédente est restaurée :

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

    $OldCertificatePolicy = [System.Net.ServicePointManager]::CertificatePolicy

    try {
        [System.Net.ServicePointManager]::CertificatePolicy =
            New-Object -TypeName IloTrustAllCertsPolicy

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
        [System.Net.ServicePointManager]::CertificatePolicy =
            $OldCertificatePolicy
    }
}
```

Le `finally` est important : la politique précédente est restaurée même si l'appel vers l'iLO échoue.

`ICertificatePolicy` et la propriété `CertificatePolicy` sont obsolètes dans .NET. Leur utilisation se justifie ici uniquement par la contrainte de Windows PowerShell 5.1 et par l'échec du callback écrit sous forme de scriptblock. Cette méthode désactive toute validation du certificat dans le processus pendant la durée de l'appel concerné. Elle convient comme solution transitoire dans un script séquentiel lorsque les interfaces iLO utilisent des certificats autosignés, mais elle ne doit pas être considérée comme l'état cible.

La solution propre à terme consiste à déployer sur les iLO des certificats signés par une PKI approuvée par les postes d'administration. La fonction peut alors être simplifiée et le contournement supprimé.

Il faut éviter d'utiliser cette technique dans un traitement parallèle : `CertificatePolicy` est une propriété statique du processus .NET et n'est donc pas limitée à une seule requête concurrente.

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

                $PowerOnHours = $null

                if ($Drive.Oem -and $Drive.Oem.Hpe) {
                    $PowerOnHours = $Drive.Oem.Hpe.PowerOnHours
                }

                [PSCustomObject]@{
                    Server          = $Server.name
                    ILO             = $IloSession.Address
                    Storage         = $Storage.Name
                    DriveId         = $Drive.Id
                    Location        = $Drive.PhysicalLocation.PartLocation.ServiceLabel
                    Manufacturer    = $Drive.Manufacturer
                    Model           = $Drive.Model
                    PartNumber      = $Drive.PartNumber
                    FirmwareVersion = $Drive.Revision
                    SerialNumber    = $Drive.SerialNumber
                    MediaType       = $Drive.MediaType
                    Protocol        = $Drive.Protocol
                    CapacityGB      = if ($Drive.CapacityBytes) {
                        [math]::Round(
                            $Drive.CapacityBytes / 1GB,
                            1
                        )
                    }
                    else {
                        $null
                    }
                    PowerOnHours    = $PowerOnHours
                    PowerOnDays     = if ($null -ne $PowerOnHours) {
                        [math]::Round($PowerOnHours / 24, 1)
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

Les propriétés les plus utiles pour identifier la référence du disque et vérifier sa version de firmware sont :

```powershell
$Drive.Model
$Drive.Revision
```

La ressource Redfish standard `Drive` prévoit notamment les propriétés `Manufacturer`, `Model`, `PartNumber`, `Revision`, `SerialNumber`, `CapacityBytes`, `MediaType` et `Protocol`.

Il faut toutefois tenir compte du fait que plusieurs de ces propriétés acceptent explicitement la valeur `null`. Un iLO peut donc exposer une ressource `Drive` complète tout en laissant `Manufacturer` ou `PartNumber` vide. Ce n'est pas nécessairement une erreur du script : la donnée peut ne pas être remontée par le disque, le contrôleur ou son firmware.

Pour identifier les disques concernés par une mise à jour de firmware, `Model` fournit le numéro de modèle et `Revision` la révision actuellement installée. Le `PartNumber` peut être conservé dans l'inventaire lorsqu'il est renseigné, mais il ne faut pas en faire une condition indispensable au traitement.

## Récupérer les heures de fonctionnement

HPE ajoute à la ressource `Drive` une extension OEM nommée `Oem.Hpe.PowerOnHours` :

```powershell
$Drive.Oem.Hpe.PowerOnHours
```

Cette propriété contient le nombre total d'heures pendant lesquelles le disque a été alimenté. Elle est en lecture seule et disponible dans la documentation HPE depuis iLO 5 1.20.

Il ne s'agit pas de l'uptime actuel du serveur. La valeur est cumulée par le disque pendant sa durée de vie. Elle peut être égale à `null` lorsque les heures de fonctionnement ne peuvent pas être déterminées ou lorsque cette information n'est pas prise en charge.

Le script convertit également cette valeur en jours pour faciliter la lecture :

```powershell
PowerOnDays = if ($null -ne $PowerOnHours) {
    [math]::Round($PowerOnHours / 24, 1)
}
else {
    $null
}
```

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

Le résultat peut prendre cette forme :

```text
Server     Location Model          FirmwareVersion PowerOnHours PowerOnDays
------     -------- -----          --------------- ------------ -----------
apollo-01  Bay 1    EG001200JWJNK  HPD8                   42817      1784,0
apollo-01  Bay 2    EG001200JWJNK  HPD8                   42106      1754,4
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

Ce modèle fournit de nombreuses informations sur les disques, mais n'expose pas nécessairement les mêmes propriétés que la ressource Redfish standard `Drive`.

Le modèle Redfish standard utilise une arborescence de ce type :

```text
/redfish/v1/Systems/{id}/Storage/{id}/Drives/{id}
```

La ressource `Drive` définit notamment les propriétés `Model`, `PartNumber` et `Revision`, ainsi que plusieurs extensions OEM HPE. Leur présence dans le schéma ne garantit toutefois pas qu'une valeur sera renseignée pour chaque disque.

Il faut donc tenir compte de la génération du serveur, de l'iLO, du contrôleur de stockage et de son firmware. La présence de `/Storage` ne garantit pas nécessairement que tous les contrôleurs et tous les disques d'une ancienne plateforme seront représentés de la même manière.

## En résumé

L'API OneView reste pratique pour obtenir la liste des serveurs et accéder à leurs contrôleurs de management, mais elle ne fournit pas nécessairement tout l'inventaire matériel disponible dans l'iLO.

Pour récupérer l'inventaire détaillé des disques, l'enchaînement est le suivant :

```text
OneView
  -> server-hardware
  -> remoteConsoleUrl
  -> session SSO iLO
  -> Redfish
  -> Systems
  -> Storage
  -> Drives
  -> Model, Revision, PowerOnHours
```

Avec Windows PowerShell 5.1, il faut également tenir compte de la gestion des certificats. Si OneView possède un certificat approuvé mais que les iLO utilisent encore des certificats autosignés, une politique de certificat temporaire peut être appliquée pendant les appels Redfish puis immédiatement restaurée. Le callback PowerShell direct est à éviter, car il peut provoquer une erreur de runspace masquée par le message `An unexpected error occurred on a send`.

Cette méthode fonctionne avec plusieurs serveurs : l'inventaire OneView est récupéré une seule fois, puis chaque serveur est interrogé successivement. Le résultat fournit notamment le modèle, la révision du firmware et, lorsque le matériel le permet, les heures de fonctionnement cumulées. Les propriétés facultatives comme `Manufacturer`, `PartNumber` ou `PowerOnHours` peuvent rester vides sans que cela indique un dysfonctionnement du script.

## Références

- Documentation HPE OneView SDK : [Server Hardware](https://hewlettpackard.github.io/oneview-python/hpeOneView.resources.servers.html)
- Documentation HPE iLO 5 Redfish : [Storage resource definitions](https://servermanagementportal.ext.hpe.com/docs/redfishservices/ilos/ilo5/ilo5_304/ilo5_storage_resourcedefns304)
- Documentation HPE Redfish : [Storage data models](https://servermanagementportal.ext.hpe.com/docs/redfishservices/ilos/supplementdocuments/storage)
- Documentation Microsoft .NET Framework : [ICertificatePolicy](https://learn.microsoft.com/dotnet/api/system.net.icertificatepolicy?view=netframework-4.8.1)
- Documentation Microsoft .NET Framework : [ServicePointManager.CertificatePolicy](https://learn.microsoft.com/dotnet/api/system.net.servicepointmanager.certificatepolicy?view=netframework-4.8.1)
