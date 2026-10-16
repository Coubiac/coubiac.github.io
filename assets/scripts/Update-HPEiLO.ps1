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
