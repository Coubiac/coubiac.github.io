---
layout: post
title: Interroger une API REST en PowerShell sans module
description: Une base simple pour s'authentifier, appeler une API, filtrer le résultat et gérer les erreurs avec Invoke-RestMethod.
tags:
  - PowerShell
  - API REST
---

Il n'existe pas toujours de module PowerShell adapté à l'API que l'on veut interroger. Ce n'est pas bloquant : `Invoke-RestMethod` permet d'appeler directement la plupart des API REST.

Dans les exemples ci-dessous, l'URL, le jeton et les données retournées sont fictifs.

## Préparer l'URL et les en-têtes

On commence par regrouper les paramètres qui seront réutilisés :

```powershell
$BaseUri = 'https://api.example.net/rest'
$Token = '<JETON_API>'

$Headers = @{
    Authorization = "Bearer $Token"
    Accept        = 'application/json'
}
```

Évite d'écrire un vrai jeton directement dans un script conservé dans Git. Ici, la valeur entre chevrons est seulement un emplacement à remplacer au moment de l'exécution.

## Envoyer une requête GET

Pour récupérer une collection de ressources :

```powershell
$Uri = "$BaseUri/resources"

$Response = Invoke-RestMethod `
    -Method Get `
    -Uri $Uri `
    -Headers $Headers

$Response
```

`Invoke-RestMethod` convertit automatiquement le JSON reçu en objets PowerShell. On peut donc utiliser les commandes habituelles pour filtrer ou sélectionner des propriétés :

```powershell
$Response.members |
    Where-Object status -eq 'OK' |
    Select-Object name, model, serialNumber
```

La propriété contenant la collection ne s'appelle pas toujours `members`. Selon l'API, il peut s'agir de `items`, `value`, `results`, ou directement de la réponse elle-même. Le premier réflexe est donc d'observer la structure retournée :

```powershell
$Response | Get-Member
$Response | ConvertTo-Json -Depth 10
```

## Appeler une ressource précise

Si l'API fournit un identifiant ou une URI pour chaque objet, réutilise cette valeur au lieu de reconstruire l'adresse à la main :

```powershell
foreach ($Resource in $Response.members) {
    $Detail = Invoke-RestMethod `
        -Method Get `
        -Uri "$BaseUri/resources/$($Resource.id)" `
        -Headers $Headers

    [PSCustomObject]@{
        Name         = $Detail.name
        Model        = $Detail.model
        SerialNumber = $Detail.serialNumber
    }
}
```

Cette boucle renvoie des objets structurés. Ils pourront ensuite être affichés, filtrés ou exportés :

```powershell
$Inventory = foreach ($Resource in $Response.members) {
    $Detail = Invoke-RestMethod `
        -Method Get `
        -Uri "$BaseUri/resources/$($Resource.id)" `
        -Headers $Headers

    [PSCustomObject]@{
        Name         = $Detail.name
        Model        = $Detail.model
        SerialNumber = $Detail.serialNumber
    }
}

$Inventory | Export-Csv -Path '.\inventory.csv' -NoTypeInformation -Encoding UTF8
```

## Gérer proprement les erreurs

Sans gestion d'erreur, une réponse HTTP 401, 404 ou 500 peut rendre le diagnostic assez pénible. Un bloc `try/catch` permet d'afficher un message plus utile :

```powershell
try {
    $Response = Invoke-RestMethod `
        -Method Get `
        -Uri "$BaseUri/resources" `
        -Headers $Headers `
        -ErrorAction Stop
}
catch {
    $StatusCode = $_.Exception.Response.StatusCode.value__
    throw "Échec de l'appel API. Code HTTP : $StatusCode. Message : $($_.Exception.Message)"
}
```

Selon la version de PowerShell et le type d'erreur, `Response` peut être absent. Pour un script destiné à plusieurs environnements, vérifie son existence avant de lire le code HTTP.

## Les points à vérifier avant d'aller plus loin

- le mécanisme d'authentification attendu par l'API ;
- la version de l'API et les en-têtes obligatoires ;
- la présence d'une pagination ;
- les limites de débit ;
- la profondeur du JSON retourné ;
- les droits associés au compte ou au jeton utilisé.

Cette base suffit pour explorer une API et construire un premier inventaire sans dépendre d'un module PowerShell spécifique.

