---
layout: post
title: Interroger une API XML avec authentification Windows en PowerShell
description: Récupérer en PowerShell des données XML accessibles depuis Excel avec l'authentification Windows.
tags:
  - PowerShell
  - XML
  - Authentification Windows
---

Certaines API internes ne renvoient pas du JSON mais du XML et utilisent l'authentification intégrée Windows.

C'est notamment assez courant avec des applications historiques ou des outils d'administration internes.

Dans ce scénario, on dispose d'une URL qui retourne une liste de serveurs au format XML. Cette URL fonctionne déjà depuis Excel via :

**Données → Obtenir des données → Depuis le Web**

avec le mode :

**Authentification Windows**

L'objectif est de récupérer les mêmes informations directement depuis PowerShell.

## 1. Tester l'accès avec le compte Windows courant

Si Excel fonctionne avec l'authentification Windows, le premier test à réaliser en PowerShell consiste à utiliser les identifiants de la session Windows courante.

```powershell
$url = "https://serveur/api/servers"

$response = Invoke-WebRequest `
    -Uri $url `
    -UseDefaultCredentials
```

L'option :

```powershell
-UseDefaultCredentials
```

demande à PowerShell d'utiliser le compte Windows actuellement connecté.

Selon la configuration du serveur, l'authentification pourra notamment utiliser Kerberos ou NTLM via le mécanisme d'authentification Windows intégré.

On peut ensuite vérifier que la requête a fonctionné :

```powershell
$response.StatusCode
```

Un résultat :

```text
200
```

indique que la requête HTTP a réussi.

Pour afficher le contenu renvoyé par l'API :

```powershell
$response.Content
```

## 2. Cas particulier de Windows PowerShell 5.1

Sur Windows PowerShell 5.1, on peut ajouter l'option :

```powershell
-UseBasicParsing
```

Par exemple :

```powershell
$response = Invoke-WebRequest `
    -Uri $url `
    -UseDefaultCredentials `
    -UseBasicParsing
```

Cette option permet d'éviter certaines dépendances historiques d'`Invoke-WebRequest` vis-à-vis d'Internet Explorer.

Elle n'est plus nécessaire avec PowerShell 7.

## 3. Convertir la réponse en XML

`Invoke-WebRequest` retourne principalement une réponse HTTP.

Le document XML est contenu dans :

```powershell
$response.Content
```

On peut demander à PowerShell de l'interpréter comme un document XML :

```powershell
[xml]$xml = $response.Content
```

On dispose maintenant d'un véritable objet XML exploitable depuis PowerShell :

```powershell
$xml
```

## 4. Naviguer dans le XML

Prenons un exemple simplifié :

```xml
<Servers>
    <Server>
        <Name>SRV-EXCH01</Name>
        <Model>ProLiant DL380 Gen10</Model>
        <SerialNumber>CZ123456</SerialNumber>
        <Status>OK</Status>
    </Server>

    <Server>
        <Name>SRV-EXCH02</Name>
        <Model>ProLiant DL380 Gen10</Model>
        <SerialNumber>CZ654321</SerialNumber>
        <Status>Warning</Status>
    </Server>
</Servers>
```

PowerShell permet de parcourir ce document très simplement.

Pour récupérer tous les serveurs :

```powershell
$xml.Servers.Server
```

Pour récupérer uniquement les noms :

```powershell
$xml.Servers.Server.Name
```

Ou encore :

```powershell
foreach ($server in $xml.Servers.Server) {

    Write-Host "Nom    : $($server.Name)"
    Write-Host "Modèle : $($server.Model)"
    Write-Host "S/N    : $($server.SerialNumber)"
    Write-Host "État   : $($server.Status)"
    Write-Host ""
}
```

## 5. Transformer le XML en objets PowerShell

Pour travailler confortablement avec les données, il est généralement préférable de transformer les éléments XML en objets PowerShell.

```powershell
$servers = foreach ($server in $xml.Servers.Server) {

    [PSCustomObject]@{
        Name         = [string]$server.Name
        Model        = [string]$server.Model
        SerialNumber = [string]$server.SerialNumber
        Status       = [string]$server.Status
    }
}
```

On obtient alors une collection PowerShell classique :

```powershell
$servers
```

Par exemple :

```text
Name        Model                  SerialNumber Status
----        -----                  ------------ ------
SRV-EXCH01  ProLiant DL380 Gen10   CZ123456     OK
SRV-EXCH02  ProLiant DL380 Gen10   CZ654321     Warning
```

L'intérêt est qu'on peut maintenant utiliser toute la puissance du pipeline PowerShell.

Rechercher les serveurs qui ne sont pas dans un état normal :

```powershell
$servers | Where-Object Status -ne "OK"
```

Trier les serveurs :

```powershell
$servers | Sort-Object Name
```

Rechercher un modèle particulier :

```powershell
$servers |
    Where-Object Model -like "*DL380*"
```

Ou sélectionner uniquement certaines propriétés :

```powershell
$servers |
    Select-Object Name, Model, Status
```

## 6. Exporter les données vers CSV

Une fois les données transformées en objets PowerShell, l'export vers Excel ou vers un fichier CSV devient trivial :

```powershell
$servers |
    Export-Csv `
        -Path ".\servers.csv" `
        -NoTypeInformation `
        -Encoding UTF8
```

Le fichier pourra ensuite être ouvert directement dans Excel.

## 7. Utiliser Invoke-RestMethod

Pour interroger une API, `Invoke-RestMethod` peut parfois être encore plus pratique :

```powershell
$data = Invoke-RestMethod `
    -Uri $url `
    -UseDefaultCredentials
```

Selon les en-têtes HTTP renvoyés par le serveur, notamment :

```text
Content-Type: application/xml
```

PowerShell peut interpréter directement la réponse XML.

On peut vérifier ce qui a été obtenu :

```powershell
$data.GetType()
```

et examiner les propriétés disponibles :

```powershell
$data | Get-Member
```

`Get-Member` est particulièrement utile lorsque l'on découvre une API et qu'on ne connaît pas encore précisément la structure des données retournées.

## 8. Utiliser un autre compte Windows

Si l'API ne doit pas être interrogée avec l'utilisateur courant, on peut demander explicitement des identifiants :

```powershell
$credential = Get-Credential
```

Puis :

```powershell
$response = Invoke-WebRequest `
    -Uri $url `
    -Credential $credential `
    -UseBasicParsing
```

Cependant, lorsque l'authentification intégrée Windows fonctionne déjà avec le compte connecté, `-UseDefaultCredentials` reste généralement la solution la plus simple :

```powershell
$response = Invoke-WebRequest `
    -Uri $url `
    -UseDefaultCredentials `
    -UseBasicParsing
```

Elle permet notamment de conserver naturellement le contexte d'authentification Windows de la session.

## 9. Script complet

Voici un exemple complet compatible avec Windows PowerShell 5.1 :

```powershell
$url = "https://serveur/api/servers"

$response = Invoke-WebRequest `
    -Uri $url `
    -UseDefaultCredentials `
    -UseBasicParsing

[xml]$xml = $response.Content

$servers = foreach ($server in $xml.Servers.Server) {

    [PSCustomObject]@{
        Name         = [string]$server.Name
        Model        = [string]$server.Model
        SerialNumber = [string]$server.SerialNumber
        Status       = [string]$server.Status
    }
}

$servers |
    Sort-Object Name |
    Format-Table -AutoSize
```

À partir de là, les données peuvent être filtrées, exportées, comparées avec d'autres sources ou utilisées dans des scripts d'inventaire.

## 10. Attention aux namespaces XML

Certains documents XML sont un peu plus complexes et utilisent des namespaces.

Par exemple :

```xml
<ns:Servers xmlns:ns="http://example.local/servers">
```

Dans ce cas, une commande comme :

```powershell
$xml.Servers.Server
```

peut ne plus fonctionner directement.

Il faudra alors utiliser les fonctions XML .NET telles que :

```powershell
SelectNodes()
```

avec un `XmlNamespaceManager`.

Ce cas mérite généralement d'être traité séparément, car la syntaxe dépend directement des namespaces déclarés dans le XML.

## Conclusion

PowerShell gère nativement les documents XML et l'authentification Windows, ce qui permet assez facilement de remplacer une récupération manuelle réalisée depuis Excel.

Le principe est généralement le suivant :

```powershell
Invoke-WebRequest
        ↓
UseDefaultCredentials
        ↓
$response.Content
        ↓
[xml]
        ↓
PSCustomObject
        ↓
Pipeline PowerShell
```

Une fois le XML transformé en objets PowerShell, son origine n'a finalement plus beaucoup d'importance.

On peut alors utiliser les outils habituels :

```powershell
Where-Object
Select-Object
Sort-Object
Export-Csv
ForEach-Object
```

Cette approche est particulièrement pratique pour automatiser des inventaires de serveurs, croiser plusieurs sources de données ou alimenter des scripts d'administration.
