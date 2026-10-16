---
layout: post
title: "Mettre à jour les firmwares HPE iLO 5 et iLO 6 en PowerShell 5.1 avec Redfish"
date: 2026-10-16
categories: [Administration, HPE]
tags: [HPE, iLO, Redfish, PowerShell, firmware]
description: "Mettre à jour une carte HPE iLO 5 ou 6 sans iLOrest ni PowerShell 7 grâce à l'API Redfish HttpPushUri et aux classes .NET."
---

# Mettre à jour les firmwares HPE iLO 5 et iLO 6 en PowerShell 5.1 avec Redfish

L'interface Web des contrôleurs **HPE iLO** permet de mettre à jour leur firmware en quelques clics. C'est pratique pour un serveur, nettement moins quand l'opération doit être répétée sur un parc important.

HPE propose **iLOrest**, un outil en ligne de commande utilisant son API Redfish. Mais sur un poste d'administration verrouillé, il n'est pas toujours possible d'installer iLOrest, ni même PowerShell 7.

Nous allons donc utiliser **Windows PowerShell 5.1**, présent nativement sur de nombreux postes et serveurs Windows, **sans module HPE ni logiciel supplémentaire**. L'inventaire des adresses iLO existe déjà : cet article se concentre sur l'envoi et l'application du firmware.

> **Périmètre :** il s'agit de mettre à jour le firmware du contrôleur **iLO 5 ou iLO 6**, pas celui du BIOS ou des contrôleurs de stockage. Tester sur une carte pilote avant de généraliser. Le script proposé est un exemple technique non validé sur un équipement réel. Cette procédure est publiée avant validation pratique : vérifier soigneusement les résultats sur une carte pilote.

## 1. Les API Redfish et HttpPushUri

Redfish est une API standard de gestion des équipements, exposée en HTTPS et échangeant essentiellement des données JSON.

Sur iLO, la ressource `GET /redfish/v1/UpdateService/` permet notamment de connaître la propriété **`HttpPushUri`** : c'est l'adresse à laquelle il faut transmettre un firmware. Il ne faut pas coder cette destination en dur ; le script la récupère depuis la carte.

Le fonctionnement de `HttpPushUri` diffère de `SimpleUpdate` :

- `SimpleUpdate` : la carte iLO **télécharge** elle-même un fichier disponible sur un serveur HTTP(S).
- `HttpPushUri` : le poste d'administration **envoie** le fichier directement à la carte par une requête `POST`.

```text
Poste Windows / PowerShell 5.1                   Carte iLO 5 ou 6
               |                                      |
               | POST /SessionService/Sessions/       |
               |------------------------------------->|
               |<------- X-Auth-Token ----------------|
               |                                      |
               | GET /Managers/1/                     |
               |------------------------------------->|
               |<---- Modele + version firmware ------|
               |                                      |
               | GET /UpdateService/                  |
               |------------------------------------->|
               |<--------- HttpPushUri ---------------|
               |                                      |
               | POST HttpPushUri                     |
               |  multipart/form-data                 |
               |  - sessionKey                        |
               |  - parameters (JSON)                 |
               |  - file (firmware .bin)              |
               |------------------------------------->|
               |       Validation + flash + reboot iLO|
               |                                      |
               | Nouvelle session puis lecture version|
               |------------------------------------->|
```

## 2. Préparer la mise à jour

Il faut disposer :

- de **Windows PowerShell 5.1**, avec .NET Framework et accès direct en HTTPS à l'iLO ;
- d'un compte iLO disposant des droits nécessaires à la mise à jour ;
- du **fichier firmware HPE `.bin`** prévu pour **iLO 5 ou iLO 6**, provenant du [centre de support HPE](https://support.hpe.com/) ;
- d'une plage d'intervention compatible avec une **indisponibilité temporaire du contrôleur iLO**.

L'image `.bin` n'est pas nécessairement le fichier `.exe` téléchargé depuis HPE : selon le package, il peut falloir en extraire le binaire. Vérifier les notes de version et les éventuels prérequis ou étapes intermédiaires quand l'iLO possède un firmware très ancien.

En général, la mise à jour du seul firmware iLO **ne nécessite pas de redémarrage du système d'exploitation du serveur**. Le contrôleur de gestion redémarre néanmoins, interrompant temporairement la console distante et l'API.

### Pourquoi utiliser les classes .NET ?

Dans PowerShell 7, `Invoke-WebRequest -Form` peut créer une requête `multipart/form-data`.

Dans **Windows PowerShell 5.1**, le paramètre `-Form` **n'existe pas**. On peut cependant obtenir exactement le même résultat avec les classes fournies par .NET Framework :

| Classe .NET | Rôle |
| --- | --- |
| `HttpClient` | Exécute les requêtes HTTPS |
| `HttpRequestMessage` | Configure les méthodes et les en-têtes HTTP |
| `MultipartFormDataContent` | Assemble le formulaire multipart |
| `StringContent` | Transmet le jeton et les paramètres JSON |
| `StreamContent` | Transmet le fichier firmware sans le charger entièrement en mémoire |

Aucune installation supplémentaire n'est donc nécessaire.

## 3. Les champs attendus par HPE

La documentation HPE décrit un `POST` `multipart/form-data` contenant notamment :

| Champ | Contenu |
| --- | --- |
| `sessionKey` | Jeton retourné à l'ouverture de session Redfish |
| `parameters` | Paramètres de mise à jour au format JSON |
| `file` | Fichier binaire `.bin` envoyé avec `application/octet-stream` |

Dans notre exemple, le champ `parameters` contient :

```json
{
  "UpdateRepository": false,
  "UpdateTarget": true,
  "Section": 0
}
```

`UpdateTarget = true` demande le flash immédiat, et `UpdateRepository = false` ne demande pas la conservation du composant dans le dépôt. Cette combinaison vise ici le **firmware propre à la carte iLO**, pas un package Smart Component destiné à un autre équipement.

Le script fournit aussi les en-têtes attendus par HPE, notamment `X-Auth-Token`, `Cookie: sessionKey=...` et `OData-Version`.

## 4. Script de mise à jour compatible PowerShell 5.1

**[Télécharger le script PowerShell complet](/assets/scripts/Update-HPEiLO.ps1)** (exemple à tester sur une carte pilote).

Le script ci-dessous prend une **seule iLO à la fois**, ce qui simplifie sa validation avant intégration éventuelle à une boucle d'automatisation. Il :

1. ouvre une session Redfish avec `Get-Credential` ;
2. lit la génération et la version déjà installées ;
3. refuse un nom de fichier indiquant `ilo5` sur une carte iLO 6 (et inversement) ;
4. récupère dynamiquement `HttpPushUri` et vérifie que l'URL reste sur la carte ciblée ;
5. envoie le fichier `.bin` au format multipart avec les classes .NET ;
6. supprime la session autant que possible, sans prétendre confirmer le flash ;
7. propose un mode `-ReadOnly` pour vérifier la version ensuite.

Par prudence, le nom du binaire doit contenir `ilo5` ou `ilo6`. C'est une **vérification supplémentaire**, pas une preuve d'authenticité : il reste indispensable de télécharger le bon composant HPE et de contrôler sa version cible.

Le script utilise les fonctionnalités `-WhatIf` et `-Confirm` offertes par PowerShell pour aider à préparer l'opération.

```powershell
#requires -Version 5.1
<#
.SYNOPSIS
  Met a jour le firmware d'une carte HPE iLO 5 ou 6 via Redfish HttpPushUri.
.DESCRIPTION
  Compatible Windows PowerShell 5.1, sans iLOrest et sans module HPE.
  Exemple pedagogique a tester sur une iLO pilote avant usage en production.
  N'utilise que des firmwares .bin HPE dont le nom indique ilo5 ou ilo6.
  L'acceptation du POST ne constitue pas une verification du flash final.
.EXAMPLE
  .\Update-HPEiLO.ps1 -Ilo ilo01.exemple.local -Firmware C:\Firmware\ilo5_322.bin -WhatIf
.EXAMPLE
  .\Update-HPEiLO.ps1 -Ilo ilo01.exemple.local -Firmware C:\Firmware\ilo5_322.bin
.EXAMPLE
  .\Update-HPEiLO.ps1 -Ilo ilo01.exemple.local -ReadOnly
#>
[CmdletBinding(DefaultParameterSetName = 'Flash', SupportsShouldProcess = $true)]
param(
    [Parameter(Mandatory = $true)]
    [string]$Ilo,

    [Parameter(Mandatory = $true, ParameterSetName = 'Flash')]
    [string]$Firmware,

    [Parameter(Mandatory = $true, ParameterSetName = 'Read')]
    [switch]$ReadOnly,

    [switch]$SkipCertificateCheck
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Net.Http

# Sur les vieux postes Windows, activer au moins TLS 1.2.
[Net.ServicePointManager]::SecurityProtocol =
    [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$File = $null
$FirmwareGeneration = $null
if (-not $ReadOnly) {
    $File = Get-Item -LiteralPath $Firmware -ErrorAction Stop
    if ($File.PSIsContainer -or $File.Extension -ine '.bin') {
        throw 'Le firmware doit etre un fichier binaire HPE .bin.'
    }
    # Garde-fou conservateur. Adapter si HPE livre une autre convention de nom.
    if ($File.Name -notmatch '(?i)ilo[-_ ]?([56])') {
        throw "Generation absente du nom du firmware : $($File.Name)."
    }
    $FirmwareGeneration = [int]$Matches[1]
}

$BaseUri = [uri]("https://$Ilo/")
$Credential = Get-Credential -Message "Compte de mise a jour de $Ilo"

# Le handler limite l'eventuel bypass TLS a CE client uniquement.
$Handler = [System.Net.Http.WebRequestHandler]::new()
$Handler.UseProxy = $false  # iLO joignable directement sur le reseau d'administration
$Handler.UseCookies = $false
if ($SkipCertificateCheck) {
    Write-Warning 'ATTENTION : verification TLS desactivee pour cette connexion.'
    # Un delegue C# evite un rappel PowerShell depuis un thread HTTP asynchrone.
    if (-not ('IloAcceptAnyCertificate' -as [type])) {
        Add-Type -TypeDefinition @'
using System.Net.Security;
using System.Security.Cryptography.X509Certificates;
public static class IloAcceptAnyCertificate {
    public static bool Validate(object sender, X509Certificate cert,
                                X509Chain chain, SslPolicyErrors errors) {
        return true;
    }
}
'@
    }
    $Method = [IloAcceptAnyCertificate].GetMethod('Validate')
    $Handler.ServerCertificateValidationCallback = [System.Delegate]::CreateDelegate(
        [System.Net.Security.RemoteCertificateValidationCallback], $Method
    )
}

$Client = [System.Net.Http.HttpClient]::new($Handler)
$Client.Timeout = [TimeSpan]::FromMinutes(10)
$Token = $null
$SessionUri = $null
$FlashAttempted = $false

function Get-RedfishJson {
    param(
        [System.Net.Http.HttpClient]$HttpClient,
        [uri]$Uri,
        [string]$AuthToken
    )
    $Request = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::Get, $Uri)
    $Response = $null
    try {
        $Request.Headers.Add('X-Auth-Token', $AuthToken)
        $Request.Headers.Accept.ParseAdd('application/json')
        $Response = $HttpClient.SendAsync($Request).GetAwaiter().GetResult()
        $Json = $Response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
        if (-not $Response.IsSuccessStatusCode) {
            throw "GET $Uri : HTTP $([int]$Response.StatusCode) - $Json"
        }
        return ($Json | ConvertFrom-Json)
    }
    finally {
        if ($Response) { $Response.Dispose() }
        $Request.Dispose()
    }
}

try {
    # 1. Creation de session Redfish.
    $LoginData = @{
        UserName = $Credential.UserName
        Password = $Credential.GetNetworkCredential().Password
    } | ConvertTo-Json -Compress

    $LoginContent = [System.Net.Http.StringContent]::new(
        $LoginData, [Text.Encoding]::UTF8, 'application/json'
    )
    $LoginResponse = $null
    try {
        $LoginResponse = $Client.PostAsync(
            [uri]::new($BaseUri, '/redfish/v1/SessionService/Sessions/'),
            $LoginContent
        ).GetAwaiter().GetResult()
        if (-not $LoginResponse.IsSuccessStatusCode) {
            throw "Authentification refusee : HTTP $([int]$LoginResponse.StatusCode)"
        }
        $Token = [string]($LoginResponse.Headers.GetValues('X-Auth-Token') | Select-Object -First 1)
        $Location = $LoginResponse.Headers.Location
        if (-not $Token -or -not $Location) {
            throw 'Le serveur ne renvoie pas de jeton ou de localisation de session.'
        }
        $SessionUri = [uri]::new($BaseUri, $Location)
    }
    finally {
        if ($LoginResponse) { $LoginResponse.Dispose() }
        $LoginContent.Dispose()
    }

    # 2. Version actuelle et identification de la generation.
    $Manager = Get-RedfishJson -HttpClient $Client `
        -Uri ([uri]::new($BaseUri, '/redfish/v1/Managers/1/')) `
        -AuthToken $Token

    $Identity = "$($Manager.Model) $($Manager.FirmwareVersion)"
    if ($Identity -notmatch '(?i)iLO\s*([56])') {
        throw "Generation iLO non reconnue : $Identity"
    }
    $DetectedGeneration = [int]$Matches[1]
    Write-Host "Carte : $($Manager.Model) | Version : $($Manager.FirmwareVersion)"

    if ($ReadOnly) {
        Write-Host 'Aucune mise a jour demandee (lecture seule).'
        return
    }
    if ($DetectedGeneration -ne $FirmwareGeneration) {
        throw "Firmware incompatible : carte iLO $DetectedGeneration, fichier iLO $FirmwareGeneration."
    }

    # 3. Lire l'URL annoncee par le service de mise a jour.
    $UpdateService = Get-RedfishJson -HttpClient $Client `
        -Uri ([uri]::new($BaseUri, '/redfish/v1/UpdateService/')) `
        -AuthToken $Token
    if (-not $UpdateService.HttpPushUri) {
        throw 'HttpPushUri n est pas expose par cette carte ou cette version.'
    }
    $PushUri = [uri]::new($BaseUri, [string]$UpdateService.HttpPushUri)
    if ($PushUri.Scheme -ne 'https' -or $PushUri.Authority -ne $BaseUri.Authority) {
        throw "Destination d upload inattendue : $PushUri"
    }

    if (-not $PSCmdlet.ShouldProcess($Ilo, "Envoyer et flasher $($File.Name) via HttpPushUri")) {
        return
    }

    # 4. Construire le corps multipart/form-data en .NET (compatible PS 5.1).
    $Parameters = @{
        UpdateRepository = $false
        UpdateTarget = $true
        Section = 0
    } | ConvertTo-Json -Compress

    $Form = [System.Net.Http.MultipartFormDataContent]::new()
    $Request = $null
    $Response = $null
    $Stream = $null
    try {
        $Form.Add(([System.Net.Http.StringContent]::new($Token)), 'sessionKey')
        $Form.Add(([System.Net.Http.StringContent]::new(
            $Parameters, [Text.Encoding]::UTF8, 'application/json'
        )), 'parameters')

        $Stream = [IO.File]::OpenRead($File.FullName)
        $FirmwareContent = [System.Net.Http.StreamContent]::new($Stream)
        $FirmwareContent.Headers.ContentType =
            [System.Net.Http.Headers.MediaTypeHeaderValue]::Parse('application/octet-stream')
        $Form.Add($FirmwareContent, 'file', $File.Name)

        $Request = [System.Net.Http.HttpRequestMessage]::new(
            [System.Net.Http.HttpMethod]::Post, $PushUri
        )
        $Request.Headers.Add('X-Auth-Token', $Token)
        $Request.Headers.Add('Cookie', "sessionKey=$Token")
        $Request.Headers.Accept.ParseAdd('application/json')
        $null = $Request.Headers.TryAddWithoutValidation('OData-Version', '4.0')
        $Request.Headers.ExpectContinue = $false
        $Request.Content = $Form

        Write-Host "Transfert de $($File.Name) vers $Ilo..."
        $FlashAttempted = $true
        $Response = $Client.SendAsync($Request).GetAwaiter().GetResult()
        $Reply = $Response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
        if (-not $Response.IsSuccessStatusCode) {
            throw "POST HttpPushUri : HTTP $([int]$Response.StatusCode) - $Reply"
        }
        Write-Host "Requete acceptee : HTTP $([int]$Response.StatusCode)."
        Write-Warning 'Succes du FLASH non encore confirme : attendre le redemarrage de la carte et verifier la version.'
    }
    finally {
        if ($Response) { $Response.Dispose() }
        if ($Request) { $Request.Dispose() }
        else { $Form.Dispose() }
        if ($Stream) { $Stream.Dispose() }
    }
}
catch {
    if ($FlashAttempted) {
        Write-Warning 'Etat du flash potentiellement indetermine. Verifier la version avant de relancer.'
    }
    throw
}
finally {
    if ($SessionUri -and $Token) {
        $DeleteRequest = $null
        $DeleteResponse = $null
        try {
            $DeleteRequest = [System.Net.Http.HttpRequestMessage]::new(
                [System.Net.Http.HttpMethod]::Delete, $SessionUri
            )
            $DeleteRequest.Headers.Add('X-Auth-Token', $Token)
            $DeleteResponse = $Client.SendAsync($DeleteRequest).GetAwaiter().GetResult()
        }
        catch {
            Write-Verbose 'Session iLO deja fermee ou carte en redemarrage.'
        }
        finally {
            if ($DeleteResponse) { $DeleteResponse.Dispose() }
            if ($DeleteRequest) { $DeleteRequest.Dispose() }
        }
    }
    $Client.Dispose()
    $Handler.Dispose()
}
```

### Utilisation

Tester les contrôles sans effectuer l'envoi :

```powershell
.\Update-HPEiLO.ps1 -Ilo 192.168.1.100 -Firmware 'C:\Firmware\ilo5_XXX.bin' -WhatIf
```

Lancer le flash d'une **iLO 5** :

```powershell
.\Update-HPEiLO.ps1 -Ilo 192.168.1.100 -Firmware 'C:\Firmware\ilo5_XXX.bin'
```

Lancer le flash d'une **iLO 6** :

```powershell
.\Update-HPEiLO.ps1 -Ilo 192.168.1.101 -Firmware 'C:\Firmware\ilo6_XXX.bin'
```

Le nom exact dépend du composant HPE téléchargé. Ces noms de fichiers sont des exemples et ne correspondent pas nécessairement à des fichiers réellement publiés.

> **Certificats HTTPS :** par défaut, la validation TLS est active. Si l'iLO possède un certificat autosigné, il vaut mieux installer ou approuver correctement son certificat sur le poste d'administration, en veillant aussi à la correspondance du nom DNS. Le script possède une option `-SkipCertificateCheck` pour un test isolé, mais celle-ci désactive l'authentification du serveur et ne doit pas être utilisée comme solution standard en production.

## 5. Confirmer la version après le redémarrage

Un code HTTP `200` ou `202` indique que **la requête a été acceptée** ; il ne garantit pas que la nouvelle version est effectivement active. Une déconnexion pendant le POST peut aussi être due au redémarrage de l'iLO.

Après le retour du contrôleur, exécuter :

```powershell
.\Update-HPEiLO.ps1 -Ilo 192.168.1.100 -ReadOnly
```

La commande ouvre une **nouvelle session Redfish**, lit `/redfish/v1/Managers/1/` et affiche la propriété `FirmwareVersion`, **sans envoyer de firmware**.

Comparer cette version à celle attendue, ainsi qu'aux éventuels événements et erreurs consignés par iLO. En cas d'échec ou d'interruption du POST, **ne pas relancer immédiatement** : déterminer d'abord si la mise à jour est en cours, terminée ou rejetée.

Pour industrialiser l'opération sur un parc, il faudra ajouter une vérification automatique de la version cible, un journal d'exécution par adresse, une gestion des erreurs et une limitation des mises à jour simultanées. Le présent script reste volontairement unitaire.

## 6. Points de vigilance

- **Image HPE correspondant à la génération** : ne pas envoyer un firmware iLO 5 à une iLO 6, même si le nom du fichier a été modifié.
- **Anciennes versions** : lire les notes du firmware pour les éventuelles étapes de mise à niveau nécessaires.
- **Réseau d'administration** : l'exemple utilise une connexion HTTPS directe, sans proxy (`UseProxy = false`). Adapter à l'architecture réseau si nécessaire.
- **Validation TLS** : conserver la validation du certificat plutôt que l'ignorer systématiquement.
- **Redémarrage iLO** : l'accès Web, l'API, la console distante et les fonctions de supervision peuvent être temporairement indisponibles ; cela n'implique normalement pas un redémarrage de l'OS.
- **Statut final** : succès de la requête HTTP et réussite de la mise à jour sont deux notions différentes.

## Conclusion

Une installation de **PowerShell 7 n'est pas nécessaire** pour automatiser une mise à jour du firmware HPE iLO 5 ou 6 par l'API Redfish.

Avec **Windows PowerShell 5.1** et les classes .NET, on peut constituer la requête `multipart/form-data` exigée par `HttpPushUri`, envoyer le binaire HPE et demander son application immédiate. L'essentiel n'est pas le choix de l'outil client, mais le contrôle du firmware transmis et la vérification du résultat après le redémarrage du contrôleur.

## Références

- [HPE — iLO Software/Firmware update service](https://servermanagementportal.ext.hpe.com/docs/redfishservices/ilos/supplementdocuments/updateservice)
- [HPE — Redfish update service : HTTP Push](https://servermanagementportal.ext.hpe.com/docs/references_and_material/blogposts/firmware_updates/part3/firmware_update_part3)
- [Microsoft — WebRequestHandler.ServerCertificateValidationCallback](https://learn.microsoft.com/en-us/dotnet/api/system.net.http.webrequesthandler.servercertificatevalidationcallback)
- [Centre de support HPE](https://support.hpe.com/)
