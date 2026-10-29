---
layout: post
title: "PowerShell : conserver et réutiliser des identifiants avec PSCredential et DPAPI"
description: "Comprendre Get-Credential, Export-Clixml et Import-Clixml, puis réutiliser un compte pour administrer Exchange et interroger les API HPE OneView et iLO."
tags:
  - PowerShell
  - Sécurité
  - API
  - Exchange Server
  - HPE OneView
  - iLO
permalink: /articles/powershell-pscredential-dpapi-exchange-oneview-ilo/
---

Lorsqu'on automatise l'administration d'une infrastructure, le problème des identifiants revient régulièrement : ouvrir une session distante sur **Exchange**, interroger **HPE OneView** ou récupérer les informations matérielles d'un serveur par l'API **Redfish d'iLO**.

Une solution consiste à demander le mot de passe à chaque lancement. Une autre, à éviter, est de l'écrire directement dans le script. Sous Windows, PowerShell propose une approche intermédiaire : **enregistrer un objet `PSCredential` dans un fichier CLIXML protégé par DPAPI, puis le réutiliser**.

Mais attention à une distinction essentielle : **stocker des identifiants n'est pas la même chose que s'authentifier**. Selon le service, on utilisera Kerberos, HTTP Basic, un jeton de session ou l'authentification Windows intégrée.

## 1. Comprendre PSCredential, SecureString et DPAPI

La commande :

```powershell
$Cred = Get-Credential
```

affiche une fenêtre de saisie et retourne un objet `System.Management.Automation.PSCredential`. Il contient principalement :

- `$Cred.UserName` : le nom du compte, sous forme de chaîne de caractères ;
- `$Cred.Password` : le mot de passe, sous forme de `SecureString`.

Le `SecureString` représente un secret en mémoire ; **ce n'est ni un ticket Kerberos, ni un jeton SSO, ni une garantie contre un logiciel malveillant exécuté avec vos privilèges**.

Sous Windows, `Export-Clixml` utilise **DPAPI** (*Data Protection API*) pour chiffrer les données sensibles de cet objet. Selon le fonctionnement documenté par Microsoft, seul **le même utilisateur Windows, sur le même ordinateur**, peut normalement déchiffrer le mot de passe exporté.

> **Point de sécurité important :** sous Linux et macOS, `Export-Clixml` ne chiffre pas les identifiants comme sous Windows. Ils sont exportés sous une représentation Unicode récupérable. Les exemples de stockage de cet article concernent **Windows**.

## 2. Enregistrer puis recharger les identifiants

Créons d'abord un répertoire, puis un fichier pour les identifiants :

```powershell
$CredentialDir = Join-Path $env:APPDATA 'Credentials'
New-Item -Path $CredentialDir -ItemType Directory -Force | Out-Null

$CredentialFile = Join-Path $CredentialDir 'admin.xml'

Get-Credential | Export-Clixml -Path $CredentialFile
```

Le nom d'utilisateur peut être saisi sous la forme `DOMAINE\utilisateur` ou `utilisateur@domaine.local`, selon le service à administrer.

Le fichier XML conserve le nom du compte en clair et le mot de passe chiffré sur Windows. Il reste lisible dans un éditeur de texte, mais cela ne signifie pas que le mot de passe y est lisible.

**`Get-Credential` ne vérifie pas que le mot de passe est correct** : l'authentification ne sera testée qu'au moment de se connecter à un service.

Dans un autre script, il suffit de recharger le fichier :

```powershell
$Cred = Import-Clixml (Join-Path $env:APPDATA 'Credentials\admin.xml')

$Cred.GetType().FullName
# System.Management.Automation.PSCredential
```

Le même objet `$Cred` peut maintenant servir à plusieurs protocoles. Il ne pourra toutefois pas authentifier un compte auprès d'un service qui ne reconnaît pas cette identité.

## 3. Exemple Exchange : Kerberos et Remote PowerShell

Une session PowerShell distante classique vers Exchange Server on-premises peut être créée à partir de cet objet :

```powershell
$Cred = Import-Clixml (Join-Path $env:APPDATA 'Credentials\admin.xml')
$Session = $null

try {
    $Params = @{
        ConfigurationName = 'Microsoft.Exchange'
        ConnectionUri     = 'http://exch01.domaine.local/PowerShell/'
        Authentication    = 'Kerberos'
        Credential        = $Cred
    }

    $Session = New-PSSession @Params
    Import-PSSession $Session -DisableNameChecking | Out-Null

    Get-Mailbox -ResultSize 10
    Get-MailboxDatabase
}
finally {
    if ($Session) {
        Remove-PSSession $Session
    }
}
```

Que se passe-t-il ?

1. `New-PSSession` ouvre une session persistante vers le point de terminaison `Microsoft.Exchange`.
2. Kerberos authentifie la connexion avec les identifiants transmis par `-Credential`.
3. `Import-PSSession` crée localement des **fonctions proxy** : `Get-Mailbox` semble exécuté sur le poste, mais son traitement s'effectue sur Exchange.
4. `-DisableNameChecking` masque les avertissements sur les noms des commandes importées. Il ne désactive **aucune vérification de sécurité**.
5. `Remove-PSSession` ferme la session distante.

Les droits restent déterminés par le **RBAC Exchange**. Et les objets retournés par l'*Implicit Remoting* sont généralement **désérialisés** : leurs propriétés sont exploitables, mais leurs méthodes .NET d'origine ne sont pas nécessairement disponibles.

### Pourquoi HTTP et non HTTPS ?

La documentation Microsoft utilise bien `http://.../PowerShell/` dans ce scénario : les messages de la session distante sont protégés par le chiffrement associé à Kerberos. **Cela ne signifie absolument pas qu'il serait acceptable d'envoyer un mot de passe en JSON via HTTP dans une API REST.** Les exemples REST ci-dessous utilisent HTTPS.

### Et avec le compte Windows actuel ?

Si votre session Windows est déjà ouverte avec un compte autorisé sur Exchange, vous pouvez essayer de ne pas fournir de `PSCredential` :

```powershell
$Session = New-PSSession @{'ConfigurationName'='Microsoft.Exchange'; 'ConnectionUri'='http://exch01.domaine.local/PowerShell/'; 'Authentication'='Kerberos'}
```

Cette authentification intégrée est préférable au stockage d'un mot de passe chaque fois qu'elle est possible.

## 4. Exemple HPE OneView : identifiants et jeton de session

OneView expose une API REST. Ici, on ne transmet pas directement un `PSCredential` à `New-PSSession` : on ouvre une session API avec un **POST** vers `/rest/login-sessions`.

Le serveur retourne un **`sessionID`**, à transmettre ensuite dans l'en-tête HTTP **`Auth`**. Le script termine par un **DELETE** de la session.

```powershell
$Cred = Import-Clixml (Join-Path $env:APPDATA 'Credentials\admin.xml')
$OneView = 'https://oneview.domaine.local'

# Identifier la version d'API exposée
$Version = (Invoke-RestMethod -Uri "$OneView/rest/version").currentVersion

$Headers = @{
    'X-API-Version' = [string]$Version
    'Accept'        = 'application/json'
}

# Le protocole attend un mot de passe dans le corps JSON
$LoginBody = @{
    userName = $Cred.UserName
    password = $Cred.GetNetworkCredential().Password
} | ConvertTo-Json

$SessionId = $null

try {
    $Login = Invoke-RestMethod -Method Post -Uri "$OneView/rest/login-sessions" -Headers $Headers -ContentType 'application/json' -Body $LoginBody

    $SessionId = $Login.sessionID
    if (-not $SessionId) {
        throw "OneView n'a pas retourné de sessionID."
    }

    $ApiHeaders = @{
        'X-API-Version' = [string]$Version
        'Accept'        = 'application/json'
        'Auth'          = $SessionId
    }

    $Inventory = Invoke-RestMethod -Method Get -Uri "$OneView/rest/server-hardware" -Headers $ApiHeaders

    $Inventory.members | Select-Object name, model, state
}
finally {
    if ($SessionId) {
        Invoke-RestMethod -Method Delete -Uri "$OneView/rest/login-sessions" -Headers $ApiHeaders | Out-Null
    }
}
```

On remarque une différence importante :

```powershell
$Cred.GetNetworkCredential().Password
```

Cette expression **restitue le mot de passe en clair dans une chaîne `System.String` en mémoire**. C'est nécessaire ici pour construire la requête JSON attendue par OneView. Il ne faut ni afficher cette chaîne, ni la journaliser, ni la conserver volontairement.

Le jeton `sessionID` est lui aussi un **secret d'authentification** : tant qu'il est valide, il peut autoriser des requêtes.

Le `try/finally` demande la fermeture de session, même lorsqu'une requête échoue. Si l'appliance est indisponible, la fermeture ne pourra évidemment pas être garantie.

### Utiliser un compte AD dans OneView

Un compte Active Directory ne fonctionne que si **OneView est configuré pour l'authentification sur le répertoire concerné** et si ce compte y dispose des droits nécessaires.

Selon la version et la configuration, les formats `DOMAINE\utilisateur` ou `utilisateur@domaine.local` permettent de sélectionner le répertoire sans champ de domaine séparé. Il faut vérifier ce comportement dans l'aide API de l'appliance déployée.

Pour approfondir les appels REST et la manipulation du JSON, voir [Interroger une API REST en PowerShell sans module](/articles/interroger-api-rest-powershell-sans-module/).

## 5. Exemple HPE iLO : une session Redfish

Avec iLO 5 et iLO 6, l'API Redfish utilise un mécanisme proche de celui de OneView, mais avec des noms différents :

- `POST /redfish/v1/SessionService/Sessions/` ouvre la session ;
- le corps JSON contient `UserName` et `Password`, avec cette casse ;
- le jeton se trouve dans l'en-tête de réponse **`X-Auth-Token`** ;
- la réponse indique dans **`Location`** l'URI de la session à supprimer.

```powershell
$Cred = Import-Clixml (Join-Path $env:APPDATA 'Credentials\admin.xml')
$iLO = 'https://ilo01.domaine.local'

$LoginBody = @{
    UserName = $Cred.UserName
    Password = $Cred.GetNetworkCredential().Password
} | ConvertTo-Json

$Token = $null
$SessionLocation = $null

try {
    $Response = Invoke-WebRequest -Method Post -Uri "$iLO/redfish/v1/SessionService/Sessions/" -ContentType 'application/json' -Body $LoginBody -UseBasicParsing

    $Token = [string]$Response.Headers['X-Auth-Token']
    $SessionLocation = [string]$Response.Headers['Location']

    if (-not $Token -or -not $SessionLocation) {
        throw "L'iLO n'a pas renvoyé le jeton ou l'URI de session."
    }

    $ApiHeaders = @{ 'X-Auth-Token' = $Token }
    $Systems = Invoke-RestMethod -Method Get -Uri "$iLO/redfish/v1/Systems/" -Headers $ApiHeaders

    foreach ($Member in $Systems.Members) {
        $DetailUri = [uri]::new([uri]$iLO, [string]$Member.'@odata.id').AbsoluteUri

        Invoke-RestMethod -Method Get -Uri $DetailUri -Headers $ApiHeaders |
            Select-Object Model, SerialNumber, PowerState
    }
}
finally {
    if ($Token -and $SessionLocation) {
        $LogoutUri = [uri]::new([uri]$iLO, $SessionLocation).AbsoluteUri
        Invoke-RestMethod -Method Delete -Uri $LogoutUri -Headers @{ 'X-Auth-Token' = $Token } | Out-Null
    }
}
```

Ici, `Invoke-WebRequest` est pratique pour accéder aux en-têtes de réponse. `-UseBasicParsing` sert notamment à conserver la compatibilité avec Windows PowerShell 5.1 ; ce paramètre n'est plus nécessaire sous PowerShell 7.

L'URI `Location` peut être absolue ou relative : `[uri]::new(...)` permet de la résoudre à partir de l'adresse de l'iLO. **La suppression de session est importante**, car les iLO disposent d'un nombre limité de sessions concurrentes.

Pour approfondir Redfish, voir [Mise à jour iLO 5 / iLO 6 avec Redfish et PowerShell](/articles/mise-a-jour-ilo5-ilo6-redfish-powershell/).

## 6. Et si l'API accepte directement PSCredential ?

Certaines API utilisent l'authentification HTTP **Basic**. Avec **PowerShell 7**, on peut alors fournir le `PSCredential` directement :

```powershell
$Cred = Import-Clixml (Join-Path $env:APPDATA 'Credentials\admin.xml')

$Result = Invoke-RestMethod -Uri 'https://api.domaine.local/resources' -Authentication Basic -Credential $Cred
```

PowerShell construit l'en-tête HTTP `Authorization`. Cette méthode suppose que l'API accepte Basic et que **HTTPS** est correctement configuré. Basic encode les identifiants, il ne les chiffre pas.

Autre cas : une application interne accepte **l'authentification Windows intégrée** (Kerberos ou NTLM, selon la négociation). On peut alors utiliser l'identité de la session Windows sans stocker de secret :

```powershell
Invoke-RestMethod -Uri 'https://api.domaine.local/resources' -UseDefaultCredentials
```

Voir également [Interroger une API XML avec authentification Windows en PowerShell](/articles/interroger-api-xml-authentification-windows-powershell/).

## 7. Comparaison des méthodes d'authentification

| Service | Méthode | Utilisation du PSCredential |
| --- | --- | --- |
| Exchange on-premises | Kerberos / Remote PowerShell | Passé directement à `New-PSSession` |
| HPE OneView | Identifiants puis `sessionID` | Converti en données JSON au moment du login |
| HPE iLO / Redfish | Identifiants puis `X-Auth-Token` | Converti en données JSON au moment du login |
| API compatible Basic | HTTP Basic sur HTTPS | Passé directement à `Invoke-RestMethod` en PowerShell 7 |
| API avec authentification Windows intégrée | Kerberos / NTLM selon configuration | Inutile si `-UseDefaultCredentials` suffit |

**Un `PSCredential` ne fournit pas de SSO.** Le même compte AD n'est utilisable dans OneView ou iLO que si ces équipements sont configurés pour l'authentifier et lui attribuer des droits.

## 8. Limites et précautions de sécurité

Le fichier CLIXML protégé par DPAPI est utile pour éviter un mot de passe inscrit en dur dans un script, mais **ce n'est pas un coffre-fort de secrets**.

- **Contexte lié à Windows :** le fichier exporté ne se réutilise normalement ni avec un autre compte Windows ni sur un autre ordinateur. Une tâche planifiée doit fonctionner dans le contexte utilisateur approprié.
- **Compte compromis :** un programme lancé avec les mêmes droits que l'utilisateur peut potentiellement récupérer le mot de passe en utilisant DPAPI. Le chiffrement ne protège pas contre la compromission de la session.
- **Mot de passe en mémoire :** `GetNetworkCredential().Password` expose une chaîne en clair en mémoire. Ne l'envoyez pas dans les traces, la console ou les fichiers journaux.
- **Jetons sensibles :** les valeurs `sessionID` et `X-Auth-Token` doivent être traitées comme des secrets.
- **Pas de Git :** n'ajoutez pas les fichiers XML de credentials dans un dépôt, même privé.
- **HTTPS :** ne contournez pas la validation des certificats TLS avec `-SkipCertificateCheck` ou un contournement global.
- **Rotation :** après un changement de mot de passe, recréez le fichier d'identifiants.
- **Principe du moindre privilège :** évitez si possible de réutiliser un compte extrêmement privilégié sur tous les équipements.

En production, une identité de service dédiée, l'authentification intégrée, une identité gérée ou un gestionnaire de secrets centralisé peuvent être préférables, selon les capacités du produit et le contexte d'exécution.

## 9. Quelques erreurs fréquentes

| Symptôme | Vérifications utiles |
| --- | --- |
| `Import-Clixml` ne permet plus de récupérer le compte | Même utilisateur Windows et même ordinateur ? |
| Exchange refuse la session | Kerberos, DNS, SPN, connectivité, accès Remote PowerShell, RBAC |
| OneView ou iLO renvoie HTTP 401 | Identifiants, annuaire, jeton ou en-têtes manquants |
| L'API renvoie HTTP 403 | Vérifier les autorisations, indépendamment de l'authentification |
| Erreur TLS | Nom DNS, chaîne de confiance, expiration et configuration du certificat |
| Le script fonctionne en console mais pas en tâche planifiée | Identité d'exécution, profil Windows, DPAPI, réseau |
| Trop de sessions Redfish ouvertes | Utiliser `DELETE` sur l'URI renvoyée dans `Location` |

## Conclusion

**`PSCredential` est un conteneur d'identifiants générique, pas une méthode d'authentification.** Sous Windows, `Get-Credential`, `Export-Clixml` et `Import-Clixml` permettent de conserver localement un compte sans écrire son mot de passe dans les scripts.

Ensuite, chaque service impose son protocole : Kerberos pour Exchange, session REST pour OneView, session Redfish pour iLO, éventuellement HTTP Basic ou authentification Windows intégrée pour d'autres API.

Le bon réflexe reste de **ne pas stocker un secret quand le service sait déjà authentifier l'identité courante**, et de protéger autant les jetons obtenus que les mots de passe d'origine.

## Références

- [Microsoft Learn — Export-Clixml](https://learn.microsoft.com/fr-fr/powershell/module/microsoft.powershell.utility/export-clixml)
- [Microsoft Learn — Connexion à Exchange avec Remote PowerShell](https://learn.microsoft.com/fr-fr/powershell/exchange/connect-to-exchange-servers-using-remote-powershell)
- [Microsoft Learn — Invoke-RestMethod](https://learn.microsoft.com/fr-fr/powershell/module/microsoft.powershell.utility/invoke-restmethod)
- [HPE Developer — Authenticating against the Composable API](https://developer.hpe.com/blog/authenticating-against-the-composable-api/)
- [HPE — iLO 5 Redfish API Reference](https://hewlettpackard.github.io/ilo-rest-api-docs/ilo5/)
- [HPE — OneView Directory Service Authentication](https://support.hpe.com/hpesc/public/docDisplay?docId=sd00003904en_us&page=GUID-D7147C7F-2016-0901-066E-0000000032EE.html)
