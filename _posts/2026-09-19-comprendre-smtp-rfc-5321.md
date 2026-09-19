---
layout: post
title: "Comprendre SMTP : les bases de la RFC 5321"
description: "Comprendre le fonctionnement réel de SMTP, la différence entre enveloppe et contenu, la transaction `MAIL`/`RCPT`/`DATA`, les codes de réponse, le routage DNS et les principales extensions ESMTP."
tags:
  - SMTP
  - RFC 5321
  - messagerie
  - DNS
  - TLS
---

La RFC 5321 décrit le fonctionnement de SMTP, le protocole utilisé pour transporter les messages électroniques.

Sa lecture n'est pas particulièrement accessible. Le document est conçu pour définir précisément le comportement attendu des implémentations, pas pour enseigner le protocole.

Il est plus simple de commencer par observer une transaction SMTP, puis de rattacher chaque étape aux notions décrites dans la RFC.

## SMTP transporte un message, mais ne définit pas tout le message

Une première distinction est indispensable :

| Élément | RFC principale | Exemples |
|---|---|---|
| Transport SMTP | RFC 5321 | `MAIL FROM`, `RCPT TO`, `DATA` |
| Format du message | RFC 5322 | `From:`, `To:`, `Subject:`, corps |
| Chiffrement avec STARTTLS | RFC 3207 | `STARTTLS` |
| Authentification SMTP | RFC 4954 | `AUTH` |
| Adresses internationalisées | RFC 6531 | `SMTPUTF8` |

La RFC 5321 décrit principalement le transport du message et son enveloppe.

La RFC 5322 décrit son contenu : les en-têtes, la date, le sujet, les adresses affichées et le corps du message.

Ces deux couches sont liées, mais elles ne doivent pas être confondues.

## L'enveloppe SMTP et le contenu du message

Un courrier postal possède une enveloppe et une lettre. SMTP fonctionne de manière comparable.

L'enveloppe SMTP contient notamment :

```text
MAIL FROM:<alice@example.com>
RCPT TO:<bob@example.net>
```

Le contenu transporté peut contenir :

```text
From: Alice <alice@example.com>
To: Bob <bob@example.net>
Subject: Test SMTP

Bonjour Bob,
Ceci est un test.
```

Les informations de l'enveloppe et celles du message peuvent être différentes :

```text
MAIL FROM:<bounce@newsletter.example>
RCPT TO:<benoit@example.net>

From: commercial@company.example
To: benoit@example.net
Subject: Promotion
```

`MAIL FROM` indique le `reverse-path`. Cette adresse sert notamment à recevoir les notifications d'échec de livraison.

`RCPT TO` indique le ou les destinataires de l'enveloppe. La RFC utilise le terme `forward-path`.

Les champs `From:` et `To:` appartiennent au message. Ils sont destinés à être interprétés et affichés par les clients de messagerie.

Il faut donc retenir :

```text
MAIL FROM != From:
RCPT TO   != To:
```

Cette distinction explique une grande partie des comportements qui peuvent sembler étranges dans les journaux Exchange, Postfix ou les passerelles de messagerie.

## Établissement de la session SMTP

SMTP est un protocole texte fonctionnant généralement au-dessus de TCP.

Lorsqu'un client se connecte à un serveur SMTP, le serveur parle en premier :

```text
S: 220 mx.example.net ESMTP ready
```

Le code `220` signifie que le service est prêt.

Le client se présente ensuite avec `EHLO` :

```text
C: EHLO mail.example.com
```

Le serveur répond avec son nom et les extensions qu'il prend en charge :

```text
S: 250-mx.example.net
S: 250-SIZE 52428800
S: 250-PIPELINING
S: 250-STARTTLS
S: 250-8BITMIME
S: 250-ENHANCEDSTATUSCODES
S: 250 SMTPUTF8
```

Le tiret après `250` indique que la réponse continue. La dernière ligne utilise une espace :

```text
250 SMTPUTF8
```

`EHLO` ne sert donc pas uniquement à dire bonjour. Il permet au client de découvrir les capacités du serveur.

`HELO` correspond au fonctionnement SMTP historique. `EHLO` active le modèle ESMTP et ses extensions. Un client moderne essaie normalement `EHLO` en premier.

## La transaction SMTP

Une transaction SMTP repose principalement sur trois commandes, utilisées dans cet ordre :

```text
MAIL
RCPT
DATA
```

### MAIL FROM

Le client commence par annoncer l'expéditeur de l'enveloppe :

```text
C: MAIL FROM:<alice@example.com>
S: 250 2.1.0 Sender OK
```

Le serveur a accepté l'adresse de l'expéditeur pour cette transaction. Il n'a pas encore accepté le message.

La commande peut également contenir des paramètres liés aux extensions annoncées précédemment :

```text
C: MAIL FROM:<alice@example.com> SIZE=24576
```

### RCPT TO

Le client annonce ensuite chaque destinataire :

```text
C: RCPT TO:<bob@example.net>
S: 250 2.1.5 Recipient OK
```

La commande peut être répétée :

```text
C: RCPT TO:<charlie@example.net>
S: 250 2.1.5 Recipient OK

C: RCPT TO:<dave@example.net>
S: 550 5.1.1 User unknown
```

Dans cette transaction, Bob et Charlie sont acceptés, tandis que Dave est refusé.

SMTP permet donc d'accepter certains destinataires et d'en refuser d'autres pour un même message. Le client doit mémoriser le résultat obtenu pour chaque commande `RCPT TO`.

### DATA

Lorsqu'au moins un destinataire a été accepté, le client peut demander l'envoi du contenu :

```text
C: DATA
S: 354 Start mail input; end with <CRLF>.<CRLF>
```

Le code `354` indique que le serveur attend maintenant le message :

```text
C: From: Alice <alice@example.com>
C: To: Bob <bob@example.net>
C: Subject: Test SMTP
C: Date: Sat, 19 Sep 2026 10:00:00 +0200
C: Message-ID: <12345@example.com>
C:
C: Bonjour Bob,
C: Ceci est un test.
C: .
```

La fin des données est représentée sur le réseau par :

```text
<CRLF>.<CRLF>
```

Il s'agit d'une ligne contenant uniquement un point.

Si une ligne du message commence elle-même par un point, le client en ajoute un second lors du transport. Le serveur le retire à la réception. Ce mécanisme est appelé `dot-stuffing` ou transparence SMTP.

Le serveur donne ensuite le résultat définitif de la transaction :

```text
S: 250 2.0.0 Message accepted for delivery
```

Ce dernier `250` est particulièrement important. Le serveur vient d'accepter la responsabilité du message.

S'il ne peut finalement pas le livrer, il devra normalement générer une notification d'échec à destination du `reverse-path`. Il ne peut pas simplement oublier le message après avoir annoncé son acceptation.

Le serveur peut également refuser le message après sa réception :

```text
S: 554 5.7.1 Message rejected
```

Le rejet peut notamment intervenir après l'analyse du contenu par un antispam ou un antivirus.

## Une session SMTP complète

Une transaction simple ressemble donc à ceci :

```text
S: 220 mx.example.net ESMTP ready

C: EHLO mail.example.com
S: 250-mx.example.net
S: 250-SIZE 52428800
S: 250-STARTTLS
S: 250-8BITMIME
S: 250 SMTPUTF8

C: MAIL FROM:<alice@example.com>
S: 250 2.1.0 Sender OK

C: RCPT TO:<bob@example.net>
S: 250 2.1.5 Recipient OK

C: DATA
S: 354 Start mail input; end with <CRLF>.<CRLF>

C: From: Alice <alice@example.com>
C: To: Bob <bob@example.net>
C: Subject: Test SMTP
C:
C: Bonjour Bob.
C: .
S: 250 2.0.0 Message accepted for delivery

C: QUIT
S: 221 2.0.0 Closing connection
```

La même connexion TCP peut servir à transmettre plusieurs messages. Après la réponse finale à `DATA`, le client peut commencer une nouvelle transaction avec une nouvelle commande `MAIL FROM`.

## Les autres commandes utiles

La RFC 5321 définit d'autres commandes, dont plusieurs apparaissent régulièrement dans les traces SMTP.

### RSET

`RSET` abandonne la transaction en cours sans fermer la connexion :

```text
C: RSET
S: 250 2.0.0 Reset state
```

Les informations reçues avec `MAIL FROM` et `RCPT TO` sont supprimées. Le client peut ensuite commencer une nouvelle transaction.

### NOOP

`NOOP` ne modifie aucun état :

```text
C: NOOP
S: 250 2.0.0 OK
```

Cette commande peut servir à vérifier que la session est toujours active.

### QUIT

`QUIT` termine proprement la session :

```text
C: QUIT
S: 221 2.0.0 Bye
```

### Ordre des commandes

SMTP fonctionne comme une machine à états. Les commandes ne peuvent pas être envoyées dans n'importe quel ordre.

Par exemple, une commande `RCPT TO` envoyée avant `MAIL FROM` doit normalement provoquer une erreur :

```text
C: RCPT TO:<bob@example.net>
S: 503 5.5.1 Bad sequence of commands
```

Le serveur ne signale pas que l'adresse est invalide. Il signale que la commande n'arrive pas au bon moment.

## Comprendre les codes SMTP

Il n'est pas nécessaire de mémoriser tous les codes. Le premier chiffre indique déjà la catégorie générale de la réponse.

| Classe | Signification |
|---:|---|
| `2xx` | Commande acceptée |
| `3xx` | Étape intermédiaire, des données supplémentaires sont attendues |
| `4xx` | Échec temporaire |
| `5xx` | Échec permanent |

Quelques exemples :

```text
250 2.0.0 Message accepted
```

La commande ou le message a été accepté.

```text
354 Start mail input
```

Le serveur attend la suite des données.

```text
451 4.4.0 Temporary server error
```

Le problème est temporaire. Le serveur émetteur conserve normalement le message dans sa file d'attente et réessaie plus tard.

```text
550 5.1.1 User unknown
```

Le problème est considéré comme permanent. Refaire exactement la même tentative ne devrait pas résoudre l'erreur.

La différence entre `4xx` et `5xx` est donc essentielle pour comprendre les files d'attente et les NDR.

## Les codes d'état étendus

Une réponse peut contenir deux codes :

```text
550 5.1.1 User unknown
```

`550` est le code SMTP classique.

`5.1.1` est un code d'état étendu défini par la RFC 3463 et les registres associés.

Sa structure est la suivante :

```text
classe.sujet.détail
```

La première valeur reprend la catégorie générale :

| Classe | Signification |
|---:|---|
| `2.x.x` | Succès |
| `4.x.x` | Échec temporaire |
| `5.x.x` | Échec permanent |

La deuxième valeur précise la famille du problème :

| Famille | Domaine |
|---:|---|
| `X.1.X` | Adresse |
| `X.2.X` | Boîte aux lettres |
| `X.3.X` | Système de messagerie |
| `X.4.X` | Réseau ou routage |
| `X.5.X` | Protocole |
| `X.6.X` | Contenu ou média |
| `X.7.X` | Sécurité ou politique |

Ces codes apportent davantage de précision qu'un simple `550`.

## Le cas particulier de MAIL FROM:<>

Il est possible de rencontrer :

```text
MAIL FROM:<>
```

Il ne s'agit pas d'une adresse manquante par erreur, mais du `null reverse-path`.

Il est notamment utilisé pour les notifications d'échec de livraison :

```text
MAIL FROM:<>
RCPT TO:<alice@example.com>
```

Le principe évite de créer une boucle de notifications.

Si ce NDR ne peut lui-même pas être livré, aucun nouveau NDR ne doit être envoyé à son expéditeur, puisque le `reverse-path` est vide.

## STARTTLS

Un serveur peut annoncer la prise en charge de TLS dans sa réponse à `EHLO` :

```text
S: 250-STARTTLS
```

Le client peut alors demander l'activation du chiffrement :

```text
C: STARTTLS
S: 220 2.0.0 Ready to start TLS
```

Le handshake TLS commence après cette réponse.

Une subtilité importante est définie par la RFC 3207 : après l'établissement de TLS, le client doit envoyer un nouvel `EHLO`.

```text
S: 220 mx.example.net ESMTP ready

C: EHLO mail.example.com
S: 250-mx.example.net
S: 250-STARTTLS
S: 250 SIZE 52428800

C: STARTTLS
S: 220 Ready to start TLS

<handshake TLS>

C: EHLO mail.example.com
S: 250-mx.example.net
S: 250-AUTH LOGIN PLAIN
S: 250 SIZE 52428800
```

Les capacités obtenues avant TLS doivent être oubliées. Le serveur peut annoncer des extensions différentes une fois la connexion chiffrée.

Il est fréquent, par exemple, que `AUTH` ne soit proposé qu'après l'activation de TLS.

## Transport entre serveurs et soumission par un utilisateur

Deux usages différents de SMTP doivent être distingués.

### Transport entre serveurs

Les serveurs de messagerie échangent normalement les messages sur le port TCP 25 :

```text
MTA émetteur -> TCP/25 -> MTA destinataire
```

Cette communication ne nécessite généralement pas d'authentification utilisateur. Le serveur destinataire accepte les messages correspondant aux domaines dont il assure la réception.

### Soumission d'un message

Un client comme Outlook ou Thunderbird soumet un message à son propre serveur de messagerie.

Cette soumission utilise généralement :

- le port 587 avec `STARTTLS` ;
- le port 465 avec TLS implicite.

La soumission est habituellement authentifiée et soumise aux règles de l'organisation : autorisation d'émettre, réécriture éventuelle des adresses, taille maximale ou contrôle du contenu.

Le port 465 n'est pas le port utilisé par les serveurs MX pour s'échanger les messages sur Internet.

## Routage avec DNS

Pour envoyer un message à :

```text
bob@example.net
```

le serveur émetteur extrait le domaine :

```text
example.net
```

Il recherche ensuite les enregistrements MX correspondants :

```text
example.net.  MX 10 mx1.example.net.
example.net.  MX 20 mx2.example.net.
```

La valeur la plus faible représente la priorité la plus élevée :

```text
10 mx1.example.net  <- essayé en premier
20 mx2.example.net
```

Le serveur résout ensuite le nom du MX en adresse IPv4 ou IPv6 et tente une connexion sur le port TCP 25.

Le cheminement est donc :

```text
Adresse du destinataire
        |
        v
Domaine du destinataire
        |
        v
Recherche DNS MX
        |
        v
Résolution A ou AAAA du MX
        |
        v
Connexion TCP/25
```

Si le premier MX est temporairement indisponible, le serveur peut tenter les autres MX selon leur priorité.

SMTP repose également sur une file d'attente. Si aucune destination ne peut être jointe, le message est conservé puis retransmis ultérieurement. Après expiration du délai configuré, un NDR est normalement généré.

## Les en-têtes Received

Un message peut traverser plusieurs serveurs :

```text
Client
  -> serveur de soumission
  -> passerelle antispam
  -> serveur destinataire
  -> boîte aux lettres
```

Chaque serveur SMTP qui accepte le message pour le relayer ou le livrer ajoute normalement un champ `Received:`.

Par exemple :

```text
Received: from gateway.example.net
        by mailbox.example.net
        with ESMTP
        for <bob@example.net>;

Received: from mail.example.com
        by gateway.example.net
        with ESMTP;
```

Chaque nouvelle ligne est ajoutée au-dessus des précédentes.

Le trajet doit donc généralement être reconstitué en lisant les champs `Received:` du bas vers le haut.

Ces en-têtes permettent notamment d'identifier :

- les serveurs traversés ;
- les dates et heures de chaque passage ;
- les délais entre deux étapes ;
- le protocole employé ;
- l'utilisation éventuelle de TLS ;
- l'adresse à laquelle le serveur destinait le message.

Les lignes `Received:` fournies par les serveurs de confiance sont utiles pour le diagnostic. En revanche, les lignes déjà présentes dans un message avant son entrée dans l'infrastructure peuvent avoir été falsifiées.

## Pourquoi le champ From: peut être usurpé

SMTP de base n'impose pas que le champ `From:` corresponde à l'identité réelle du serveur émetteur.

La transaction suivante est techniquement possible :

```text
MAIL FROM:<attacker@evil.example>
RCPT TO:<bob@example.net>

DATA

From: president@example.com
To: bob@example.net
Subject: Message important
```

Le champ `From:` appartient au contenu RFC 5322. SMTP le transporte sans garantir à lui seul son authenticité.

SPF, DKIM et DMARC ont été ajoutés pour traiter une partie de ce problème :

- SPF contrôle les serveurs autorisés à utiliser un domaine dans l'enveloppe ;
- DKIM ajoute une signature cryptographique au message ;
- DMARC vérifie notamment l'alignement entre le domaine visible dans `From:` et les résultats SPF ou DKIM.

Ces mécanismes complètent SMTP. Ils ne remplacent pas la transaction SMTP elle-même.

## Comment fonctionne le Bcc

Le routage repose sur les commandes `RCPT TO`, pas sur les champs `To:` ou `Cc:`.

Une transaction peut contenir :

```text
MAIL FROM:<alice@example.com>
RCPT TO:<bob@example.net>
RCPT TO:<charlie@example.net>
```

alors que le message contient uniquement :

```text
From: alice@example.com
To: bob@example.net
Subject: Message
```

Charlie reçoit quand même le message, car son adresse figurait dans l'enveloppe SMTP.

Le champ `Bcc:` n'a donc pas besoin d'être transmis aux destinataires. Le serveur ou le client ajoute le destinataire dans l'enveloppe, puis retire généralement le champ `Bcc:` du contenu distribué.

## Lire les mots normatifs d'une RFC

Les mots suivants ont une signification précise lorsqu'ils sont employés sous leur forme normative :

| Mot | Signification |
|---|---|
| `MUST` | Exigence obligatoire |
| `MUST NOT` | Interdiction |
| `SHOULD` | Comportement normalement attendu, sauf raison valable de déroger |
| `SHOULD NOT` | Comportement normalement déconseillé |
| `MAY` | Fonctionnement facultatif |

Une phrase contenant `MUST` ne présente pas une simple recommandation. Elle décrit une condition nécessaire à la conformité de l'implémentation.

Cette convention est définie par le BCP 14, composé notamment des RFC 2119 et 8174.

## Le modèle à retenir

Une transaction SMTP standard suit ce déroulement :

```text
Connexion TCP
    |
    v
220 Service ready
    |
    v
EHLO
    |
    v
250 + extensions
    |
    v
MAIL FROM
    |
    v
RCPT TO, une ou plusieurs fois
    |
    v
DATA
    |
    v
354 Envoi du contenu
    |
    v
<CRLF>.<CRLF>
    |
    v
250 Message accepté
    |
    v
QUIT
```

Les points essentiels sont les suivants :

- SMTP transporte une enveloppe et un message ;
- `MAIL FROM` est différent de `From:` ;
- `RCPT TO` est différent de `To:` ;
- chaque destinataire peut être accepté ou refusé séparément ;
- un code `4xx` représente un échec temporaire ;
- un code `5xx` représente un échec permanent ;
- le `250` reçu après `DATA` marque l'acceptation du message ;
- après `STARTTLS`, un nouvel `EHLO` est nécessaire ;
- le transport entre serveurs utilise normalement le port 25 ;
- le routage des destinataires dépend de l'enveloppe SMTP et du DNS.

Avec ce modèle mental, la lecture des journaux SMTP et des files d'attente devient beaucoup plus simple. La RFC 5321 peut ensuite être consultée par sujet : transaction, codes de réponse, ordre des commandes, routage, délais ou gestion des erreurs.

## Références

- [RFC 5321 - Simple Mail Transfer Protocol](https://www.rfc-editor.org/rfc/rfc5321.html)
- [RFC 5322 - Internet Message Format](https://www.rfc-editor.org/rfc/rfc5322.html)
- [RFC 3207 - SMTP Service Extension for Secure SMTP over TLS](https://www.rfc-editor.org/rfc/rfc3207.html)
- [RFC 3463 - Enhanced Mail System Status Codes](https://www.rfc-editor.org/rfc/rfc3463.html)
- [RFC 4954 - SMTP Service Extension for Authentication](https://www.rfc-editor.org/rfc/rfc4954.html)
- [RFC 6409 - Message Submission for Mail](https://www.rfc-editor.org/rfc/rfc6409.html)
- [RFC 6531 - SMTP Extension for Internationalized Email](https://www.rfc-editor.org/rfc/rfc6531.html)
- [RFC 8314 - Use of TLS for Email Submission and Access](https://www.rfc-editor.org/rfc/rfc8314.html)
- [RFC 8174 - Ambiguity of Uppercase vs Lowercase in RFC 2119 Key Words](https://www.rfc-editor.org/rfc/rfc8174.html)
