---
layout: post
title: "Cisco Secure Email (IronPort) : comprendre le parcours d'un mail entrant"
description: "Comprendre pas à pas le traitement d'un mail entrant dans Cisco Secure Email Gateway : Listener, HAT, Sender Groups, Mail Flow Policies, RAT, LDAP, MAIL FROM, From, SPF, DKIM, DMARC, Work Queue et routage."
tags:
  - Cisco Secure Email
  - Messagerie
---

Cisco Secure Email Gateway, encore souvent appelé **IronPort** ou **Cisco ESA**, ne traite pas un mail entrant comme un simple enchaînement "antispam puis antivirus".

Avant même d'avoir reçu le corps du message, la passerelle a déjà pris plusieurs décisions : quel serveur SMTP se connecte, à quelle catégorie il appartient, quelle politique lui appliquer, et pour quel destinataire il cherche à remettre le message.

Ensuite seulement arrivent les contrôles qui nécessitent le message lui-même : DKIM, DMARC, antispam, antivirus, réputation des fichiers, filtres de contenu, etc.

Le plus simple pour comprendre le produit est donc de suivre un mail **dans l'ordre où les informations deviennent disponibles**.

> Cet article se concentre volontairement sur le **flux entrant depuis Internet**. Il décrit le fonctionnement générique de Cisco Secure Email Gateway et non l'architecture particulière d'une entreprise.

## Le modèle mental : réception, analyse, livraison

Cisco présente le pipeline autour de trois grandes phases :

- **Receipt** : la connexion SMTP et l'acceptation du message ;
- **Work Queue** : les traitements portant sur le message ;
- **Delivery** : le routage vers le serveur suivant.

Le parcours général peut être résumé ainsi :

![Parcours d'un mail entrant dans Cisco Secure Email Gateway](/assets/diagrams/ironport-mail-entrant-pipeline.svg)

Il ne faut cependant pas lire ce schéma comme une trace CPU exacte. Certaines fonctions sont **activées très tôt dans la configuration**, mais ne peuvent être réellement exécutées que plus tard, lorsque les données nécessaires ont été reçues.

C'est particulièrement important pour SPF, DKIM, DMARC, l'antispam et l'antivirus.

## Une analogie : un centre logistique sécurisé

On peut voir l'IronPort comme l'entrée d'un centre logistique.

Un camion arrive avec un colis.

Avant d'ouvrir le colis, le gardien va d'abord se demander :

1. Qui est ce camion ?
2. Dans quelle catégorie de transporteur dois-je le ranger ?
3. Quelles règles dois-je appliquer à cette catégorie ?
4. Pour quelle personne le colis est-il destiné ?
5. Cette personne existe-t-elle vraiment ?
6. Maintenant que j'accepte le colis, que contient-il ?
7. Où dois-je l'acheminer ?

La correspondance avec IronPort est assez directe :

| Centre logistique | Cisco Secure Email |
|---|---|
| Portail | Listener |
| Contrôle du camion | HAT |
| Catégorie du transporteur | Sender Group |
| Règles appliquées | Mail Flow Policy |
| Adresse de livraison autorisée | RAT |
| Vérification de la personne | LDAP Recipient Acceptance |
| Déchargement du colis | DATA |
| Vérification de l'identité | SPF / DKIM / DMARC |
| Scanner le colis | Work Queue |
| Centre de tri | SMTP Routing |
| Destination interne | Exchange ou autre MTA |

Cette analogie permet surtout de comprendre une chose : **le HAT et le RAT ne sont ni un antispam ni un antivirus**.

Ils interviennent alors que la passerelle est encore en train de décider si elle accepte la transaction SMTP.

## 1. Le Listener : la porte d'entrée SMTP

Tout commence avec un **Listener**.

Le Listener est le service SMTP qui reçoit la connexion sur une interface et un port donnés. Pour le courrier venant d'Internet, il s'agit typiquement d'un **Public Listener**.

Lorsqu'un serveur distant ouvre une connexion TCP sur le port 25, l'IronPort connaît déjà une information importante :

~~~text
IP source = 203.0.113.25
~~~

Aucun message n'a encore été reçu, mais cette adresse IP suffit déjà pour commencer à classifier l'émetteur.

## 2. Le HAT : "qui vient me parler ?"

**HAT** signifie **Host Access Table**.

Son rôle est de déterminer comment traiter les hôtes qui se connectent au Listener.

À ce stade, le mot "sender" ne désigne pas nécessairement l'adresse visible dans un mail comme :

~~~text
From: alice@example.net
~~~

Il désigne surtout **le serveur SMTP distant qui vient d'établir la connexion**.

Cisco indique que lorsqu'un Listener reçoit une connexion TCP, il compare l'adresse IP source aux Sender Groups du HAT dans leur ordre de configuration. Dès qu'un groupe correspond, la Mail Flow Policy associée est appliquée.

Le HAT peut donc être vu comme une table de règles :

~~~text
Connexion depuis 203.0.113.25
            |
            v
           HAT
            |
            v
Dans quel Sender Group
classer cette connexion ?
~~~

## 3. Le Sender Group : classer le serveur SMTP

Un **Sender Group** regroupe des hôtes SMTP qui doivent être traités de la même manière.

Cisco permet notamment de faire correspondre un Sender Group à partir de :

- l'adresse IP ;
- une plage réseau ;
- un hostname ou un domaine ;
- une DNS List ;
- une classification d'organisation ;
- la réputation IP Cisco Talos / IPRS.

Le terme historique **SBRS** ou SenderBase Reputation Score est encore très présent dans les environnements IronPort, même si les documentations récentes parlent davantage d'IP Reputation.

La logique est donc :

~~~text
IP du serveur distant
        |
        v
Talos / IP Reputation
        |
        v
       HAT
        |
        v
  Sender Group
~~~

Par exemple, une source connue comme très mauvaise peut être rangée dans un groupe bloqué, alors qu'un serveur Internet classique sera placé dans un groupe accepté ou soumis à davantage de limitations.

La phrase à retenir est :

> **Sender Group = "dans quelle catégorie je range le serveur SMTP qui se connecte ?"**

## 4. Mail Flow Policy : "comment traiter cette catégorie ?"

Le Sender Group ne dit pas directement quoi faire.

Il sélectionne une **Mail Flow Policy**.

On obtient donc :

~~~text
HAT
 |
 v
Sender Group
 |
 v
Mail Flow Policy
~~~

La distinction est fondamentale :

| Élément | Question |
|---|---|
| Sender Group | Dans quelle catégorie se trouve ce serveur SMTP ? |
| Mail Flow Policy | Comment dois-je traiter les connexions de cette catégorie ? |

Une Mail Flow Policy peut notamment définir :

- ACCEPT, REJECT, RELAY ou TCPREFUSE ;
- des limites de connexions et de messages ;
- le nombre de destinataires ;
- la taille maximale d'un message ;
- les contraintes TLS ;
- certaines vérifications de l'expéditeur ;
- l'activation de DKIM et DMARC ;
- l'activation de l'antispam et de l'antivirus.

C'est ici qu'apparaît l'une des subtilités les plus importantes du produit.

### Configurer un contrôle n'est pas l'exécuter

Une Mail Flow Policy peut par exemple dire :

~~~text
DKIM verification : ON
DMARC verification : ON
Anti-Spam         : ON
Anti-Virus        : ON
~~~

La politique est pourtant sélectionnée très tôt, avant que le message complet soit disponible.

Cela ne signifie donc pas que l'antivirus est exécuté dans le HAT.

Cela signifie plutôt :

> "Les messages acceptés avec cette politique devront subir ces contrôles."

Cisco précise d'ailleurs que si l'antispam ou l'antivirus sont activés via le HAT / Mail Flow Policy, le message est marqué pour subir ces scans lorsqu'il passera dans la Work Queue.

## 5. La conversation SMTP

Une fois la connexion acceptée, la conversation SMTP se poursuit.

Exemple simplifié :

~~~smtp
S: 220 mx.example.net ESMTP

C: EHLO mail.example.org
S: 250 mx.example.net

C: MAIL FROM:<alice@example.org>
S: 250 OK

C: RCPT TO:<bob@example.net>
S: 250 OK

C: DATA
S: 354 End data with <CR><LF>.<CR><LF>

C: From: Alice <alice@example.org>
C: To: Bob <bob@example.net>
C: Subject: Bonjour
C:
C: Bonjour Bob...
C: .
~~~

Pour comprendre la suite, il faut absolument distinguer **l'enveloppe SMTP** du **message placé à l'intérieur**.

## 6. MAIL FROM et From: ne sont pas la même chose

Avant DATA, SMTP manipule une enveloppe :

~~~smtp
MAIL FROM:<alice@example.org>
RCPT TO:<bob@example.net>
~~~

Après DATA arrive le message RFC 5322 :

~~~text
From: Alice <alice@example.org>
To: Bob <bob@example.net>
Subject: Bonjour

Bonjour Bob...
~~~

On peut reprendre l'analogie d'une lettre papier :

~~~text
ENVELOPPE SMTP
--------------------------------
Expéditeur de retour :
alice@example.org

Destinataire :
bob@example.net


MESSAGE À L'INTÉRIEUR
--------------------------------
From: Alice <alice@example.org>
To: Bob <bob@example.net>
~~~

Le **MAIL FROM** correspond au reverse-path SMTP. Après livraison, cette information est généralement visible sous la forme d'un header **Return-Path** ajouté par le système de réception.

Le **From:** est, lui, un header du message. C'est l'adresse présentée comme auteur du courrier.

Dans beaucoup de mails "normaux", les deux sont identiques :

~~~text
MAIL FROM:<alice@example.org>

From: Alice <alice@example.org>
~~~

C'est probablement le cas le plus fréquent lorsqu'un utilisateur envoie directement via son infrastructure habituelle.

Mais ils peuvent être différents, notamment avec des plateformes d'envoi, des systèmes de notification ou des mécanismes de gestion des retours.

Exemple :

~~~text
MAIL FROM:<bounce@mailer.example.com>

From: facturation@example.com
~~~

Cette différence ne provoque **pas automatiquement** un échec DMARC. Nous verrons pourquoi plus loin.

## 7. RAT : "pour qui accepte-t-on du courrier ?"

Arrive ensuite le destinataire SMTP :

~~~smtp
RCPT TO:<bob@example.net>
~~~

C'est là qu'intervient le **RAT**, pour **Recipient Access Table**.

Le RAT répond principalement à :

> "Cette passerelle est-elle censée accepter du courrier pour cette destination ?"

Par exemple :

~~~text
example.net        ACCEPT
filiale.example    ACCEPT
autre-domaine.tld  REJECT
~~~

Le RAT est particulièrement important sur un Public Listener.

Sans ce contrôle, une passerelle pourrait accepter un message venant d'un tiers et destiné à un autre tiers, puis le relayer : ce serait un **open relay**.

La différence entre HAT et RAT peut être résumée ainsi :

![Différence entre HAT et RAT dans Cisco Secure Email Gateway](/assets/diagrams/ironport-hat-rat.svg)

> **HAT : qui se connecte ?**

> **RAT : pour quelle destination cherche-t-il à remettre un message ?**

## 8. RAT et LDAP Recipient Acceptance

Le RAT peut accepter le domaine :

~~~text
@example.net
~~~

mais cela ne prouve pas que :

~~~text
personne.inexistante@example.net
~~~

existe.

Une requête **LDAP Recipient Acceptance** peut donc compléter le RAT.

La logique devient :

~~~text
RCPT TO:<bob@example.net>
          |
          v
         RAT
          |
          | domaine accepté
          v
        LDAP
          |
          | destinataire existant ?
       +--+--+
       |     |
      oui   non
       |     |
       v     v
   continue rejet SMTP
~~~

C'est une distinction utile :

> **RAT = "est-ce une destination que je prends en charge ?"**

> **LDAP = "ce destinataire précis existe-t-il réellement ?"**

Cette vérification permet par exemple de rejeter une adresse inexistante directement pendant la session SMTP.

## 9. DATA : le moment où le message arrive réellement

Après MAIL FROM et RCPT TO, le client SMTP envoie :

~~~smtp
DATA
~~~

C'est seulement à partir de là que la passerelle reçoit :

- le header From: ;
- le Subject: ;
- la DKIM-Signature ;
- les autres headers ;
- le corps ;
- les URLs ;
- les pièces jointes.

Cette frontière est essentielle.

Avant DATA, l'IronPort dispose principalement de la connexion SMTP et de l'enveloppe.

Après DATA, il possède le message qu'il pourra analyser.

## 10. SPF : authentifier une identité SMTP

SPF travaille avec l'adresse IP du serveur qui remet le message et une identité SMTP.

Pour un message classique, l'identité la plus importante est celle du **MAIL FROM**.

Exemple :

~~~text
IP source :
192.0.2.25

MAIL FROM:
alice@example.org
~~~

Le serveur récepteur interroge alors les enregistrements SPF du domaine concerné pour déterminer si cette IP est autorisée.

Conceptuellement :

~~~text
192.0.2.25
    +
example.org
    |
    v
   DNS
    |
    v
SPF PASS / FAIL
~~~

La RFC SPF recommande d'effectuer ce contrôle pendant la transaction SMTP. C'est donc un contrôle qui peut intervenir **assez tôt**, sans attendre l'analyse antivirus ou antispam.

La RFC recommande également la vérification de l'identité HELO/EHLO. C'est particulièrement important dans le cas d'un reverse-path nul.

## 11. DKIM : vérifier la signature du message

DKIM fonctionne différemment.

Un message peut contenir :

~~~text
DKIM-Signature:
  v=1;
  d=example.org;
  s=selector1;
  ...
~~~

Le récepteur récupère la clé publique dans le DNS puis vérifie la signature.

Mais la signature DKIM porte sur des headers et sur le corps du message.

L'IronPort doit donc avoir reçu le message pour pouvoir effectuer cette validation.

On peut résumer ainsi :

~~~text
DATA
 |
 +--> headers
 |
 +--> DKIM-Signature
 |
 +--> corps
 |
 v
Vérification cryptographique
 |
 v
DKIM PASS / FAIL
~~~

Il est donc impossible que la validation DKIM complète ait lieu au simple moment où le HAT classe l'adresse IP entrante.

Elle peut être **activée par la Mail Flow Policy**, mais exécutée seulement lorsque le message est disponible.

## 12. DMARC : l'alignement est la notion clé

DMARC utilise le domaine visible dans le header **From:**, appelé Author Domain, puis vérifie si SPF ou DKIM a authentifié une identité **alignée** avec ce domaine.

Le schéma suivant résume les relations :

![SPF, DKIM et DMARC : enveloppe, message et alignement](/assets/diagrams/ironport-spf-dkim-dmarc.svg)

DMARC ne demande pas que SPF **et** DKIM soient tous les deux valides.

Il faut qu'au moins l'un des deux fournisse :

1. un résultat valide ;
2. une identité alignée avec le domaine du From:.

On peut donc avoir :

~~~text
SPF  PASS + aligné
DKIM FAIL

=> DMARC PASS
~~~

ou l'inverse :

~~~text
SPF  FAIL
DKIM PASS + aligné

=> DMARC PASS
~~~

### MAIL FROM différent du From: : est-ce que DMARC casse ?

Pas nécessairement.

Prenons :

~~~text
MAIL FROM:<bounce@mailer.example.com>

From: facturation@example.com
~~~

Les domaines DNS sont bien différents :

~~~text
mailer.example.com
example.com
~~~

Le premier est un sous-domaine du second.

DMARC définit deux modes d'alignement.

### Alignement strict

En mode strict, les domaines doivent être identiques.

~~~text
SPF domain : mailer.example.com
From domain: example.com

=> pas d'alignement strict
~~~

### Alignement relaxed

En mode relaxed, les identités doivent partager le même **Organizational Domain**.

Dans cet exemple :

~~~text
mailer.example.com
        |
        +--> Organizational Domain = example.com

example.com
        |
        +--> Organizational Domain = example.com
~~~

Il y a donc alignement relaxed.

La RFC DMARC 9989 donne d'ailleurs un exemple du même type avec un MAIL FROM sous **child.example.com** et un From sous **example.com**.

Autrement dit :

> Des domaines différents au sens DNS peuvent tout de même être alignés pour DMARC.

C'est volontaire.

## 13. Et si le MAIL FROM appartient à un prestataire ?

Prenons un autre exemple :

~~~text
MAIL FROM:<bounce@prestataire.net>

From: facturation@example.com

DKIM-Signature:
d=example.com
~~~

SPF peut être parfaitement valide pour prestataire.net :

~~~text
SPF PASS
~~~

mais il n'est pas aligné avec example.com :

~~~text
prestataire.net != example.com
=> SPF alignment FAIL
~~~

En revanche, si la signature DKIM est valide avec :

~~~text
d=example.com
~~~

alors DKIM est aligné.

Résultat :

~~~text
SPF : PASS
SPF alignment : FAIL

DKIM : PASS
DKIM alignment : PASS

DMARC : PASS
~~~

C'est l'une des raisons pour lesquelles regarder seulement "SPF PASS" ne suffit pas pour comprendre un résultat DMARC.

## 14. Le cas particulier des bounces

Un véritable message de notification d'échec de livraison utilise un reverse-path nul :

~~~smtp
MAIL FROM:<>
~~~

La RFC SMTP impose ce comportement aux notifications d'échec afin d'éviter les boucles.

Imaginons sinon :

~~~text
message original
      |
      X
échec de livraison
      |
      v
bounce
      |
      X
échec du bounce
      |
      v
bounce du bounce
      |
      X
...
~~~

Avec un reverse-path nul, si le bounce lui-même ne peut pas être livré, le serveur ne génère pas un nouveau DSN SMTP.

Attention à une confusion fréquente :

**MAIL FROM:<> ne signifie pas que le message n'a pas de header From:.**

Un DSN peut très bien contenir :

~~~text
From: Mail Delivery Subsystem <mailer-daemon@example.org>
~~~

Il faut donc toujours distinguer l'enveloppe SMTP et les headers du message.

### SPF lorsque MAIL FROM est vide

SPF prévoit également ce cas.

Lorsque le reverse-path est nul, la RFC SPF construit l'identité MAIL FROM à partir de **postmaster** et de l'identité HELO/EHLO du serveur.

Le HELO devient donc particulièrement important pour ces messages système.

## 15. Alors où sont réellement SPF, DKIM et DMARC dans IronPort ?

C'est probablement le point le plus déroutant lorsqu'on découvre le produit.

Dans l'interface, les contrôles d'authentification sont associés à la **Mail Flow Policy**.

Or cette politique est sélectionnée très tôt :

~~~text
connexion TCP
     |
     v
  Listener
     |
     v
    HAT
     |
     v
Sender Group
     |
     v
Mail Flow Policy
~~~

On pourrait donc croire que SPF, DKIM et DMARC sont exécutés "dans le HAT".

Ce n'est pas la bonne lecture.

La Mail Flow Policy décide **quels contrôles doivent être appliqués**.

Leur exécution réelle dépend ensuite des informations disponibles :

~~~text
Connexion TCP
     |
     v
HAT / Sender Group
     |
     v
Mail Flow Policy
     |
     v
EHLO
     |
     v
MAIL FROM
     |
     +----> SPF peut être évalué
     |
     v
RCPT TO
     |
     +----> RAT / LDAP
     |
     v
DATA
     |
     +----> DKIM devient vérifiable
     |
     +----> From: devient disponible
     |
     +----> DMARC peut évaluer l'alignement
~~~

C'est donc plus juste de dire :

> **SPF, DKIM et DMARC sont activés par la politique sélectionnée très tôt, mais leur vérification effective se déroule lorsque les données nécessaires sont disponibles.**

## 16. La Work Queue : analyser le message accepté

Après réception, le message traverse la **Work Queue**.

Cisco y place notamment des traitements comme :

- Message Filters ;
- Mail Policies ;
- antispam ;
- antivirus ;
- Graymail ;
- réputation et analyse des fichiers ;
- Content Filters ;
- Outbreak Filters ;
- quarantaines selon les politiques.

Cette fois, on travaille réellement sur le contenu du message.

L'analogie du centre logistique fonctionne bien :

~~~text
AVANT DATA
--------------------------------
Qui est le camion ?
Quelles règles lui appliquer ?
Pour qui livre-t-il ?
Cette personne existe-t-elle ?


APRÈS RÉCEPTION DU MESSAGE
--------------------------------
Le colis est-il dangereux ?
Contient-il un malware ?
Ressemble-t-il à du spam ?
Contient-il une URL suspecte ?
Une règle de contenu est-elle déclenchée ?
~~~

L'antivirus ne peut évidemment pas scanner une pièce jointe tant que celle-ci n'a pas été reçue.

## 17. Pourquoi l'antispam et l'antivirus apparaissent-ils dans la Mail Flow Policy ?

Pour la même raison que DKIM ou DMARC : il faut distinguer **la décision** et **l'exécution**.

La Mail Flow Policy peut décider :

~~~text
Anti-Spam  = ON
Anti-Virus = ON
~~~

Ce qui signifie :

> "Si j'accepte ce message, il devra subir ces scans."

Le message sera ensuite réellement analysé dans la Work Queue.

## 18. Pourquoi Message Tracking peut donner une impression différente

Lorsqu'on consulte Message Tracking, l'ordre visuel peut donner l'impression que SPF, DKIM ou DMARC sont exécutés assez tard.

Ce n'est pas nécessairement contradictoire avec le fait que leur activation dépend d'une Mail Flow Policy sélectionnée très tôt.

AsyncOS distingue notamment plusieurs objets dans ses logs :

- **ICID** : connexion SMTP entrante ;
- **MID** : message ;
- **RID** : destinataire ;
- **DCID** : connexion SMTP de livraison.

On peut donc avoir conceptuellement :

~~~text
ICID 100
 |
 +-- IP distante
 +-- Listener
 +-- HAT
 +-- Sender Group
 +-- Mail Flow Policy
 |
 +---- MID 500
        |
        +-- MAIL FROM
        +-- RCPT TO
        +-- DATA
        +-- SPF
        +-- DKIM
        +-- DMARC
        +-- Work Queue
~~~

Le HAT peut avoir classé la connexion dès l'ICID, alors que DKIM et DMARC sont nécessairement liés au message et apparaissent donc au niveau du MID.

Message Tracking raconte surtout **la vie du message**. Il ne faut pas le lire comme une représentation exacte de l'arborescence de configuration de l'appliance.

## 19. Delivery : où envoyer le message ?

Une fois le message accepté et traité, reste à le livrer.

Cisco Secure Email Gateway peut utiliser ses mécanismes de routage SMTP pour associer un domaine à un ou plusieurs next-hops.

Conceptuellement :

~~~text
Work Queue
    |
    v
SMTP Routing
    |
    v
Exchange / autre MTA
~~~

C'est la dernière grande phase du pipeline : **Delivery**.

## La chaîne mentale à retenir

Si je devais résumer tout le fonctionnement entrant en quelques lignes :

~~~text
Listener
   |
   v
HAT                Qui se connecte ?
   |
Sender Group       Dans quelle catégorie ?
   |
Mail Flow Policy   Comment traiter cette catégorie ?
   |
EHLO / MAIL FROM   Identité SMTP
   |
RCPT TO
   |
RAT                Est-ce une destination acceptée ?
   |
LDAP               Le destinataire existe-t-il ?
   |
DATA               Réception du message
   |
SPF / DKIM / DMARC Authentification et alignement
   |
Work Queue         Spam, virus, fichiers, filtres...
   |
SMTP Routing
   |
Exchange / MTA
~~~

Et surtout, quatre distinctions permettent d'éviter la plupart des confusions :

> **HAT regarde principalement le serveur SMTP qui établit la connexion.**

> **RAT regarde la destination SMTP demandée dans RCPT TO.**

> **MAIL FROM appartient à l'enveloppe SMTP, alors que From: appartient au message.**

> **La Mail Flow Policy sélectionne et active des traitements ; cela ne signifie pas que tous sont exécutés immédiatement au moment où le HAT choisit la politique.**

C'est cette dernière idée qui permet de comprendre pourquoi SPF peut être traité relativement tôt, pourquoi DKIM nécessite le message, pourquoi DMARC a besoin de l'Author Domain du From:, et pourquoi Message Tracking peut donner une impression de chronologie différente.

## Sources

- [Cisco Secure Email Gateway - Understanding the Email Pipeline](https://www.cisco.com/c/en/us/td/docs/security/esa/esa16-5/user_guide/b_ESA_Admin_Guide_16-5/b_ESA_Admin_Guide_12_1_chapter_011.html)
- [Cisco Secure Email Gateway - Host Access Table, Sender Groups and Mail Flow Policies](https://www.cisco.com/c/en/us/td/docs/security/esa/esa16-5/user_guide/b_ESA_Admin_Guide_16-5/b_ESA_Admin_Guide_12_1_chapter_0110.html)
- [Cisco Secure Email Gateway - Email Authentication](https://www.cisco.com/c/en/us/td/docs/security/esa/esa16-5/user_guide/b_ESA_Admin_Guide_16-5/b_ESA_Admin_Guide_12_1_chapter_010110.html)
- [Cisco Secure Email Gateway - Routing and Delivery Features](https://www.cisco.com/c/en/us/td/docs/security/esa/esa16-5/user_guide/b_ESA_Admin_Guide_16-5/b_ESA_Admin_Guide_12_1_chapter_011010.html)
- [RFC 5321 - Simple Mail Transfer Protocol](https://www.rfc-editor.org/rfc/rfc5321.html)
- [RFC 5322 - Internet Message Format](https://www.rfc-editor.org/rfc/rfc5322.html)
- [RFC 7208 - Sender Policy Framework](https://www.rfc-editor.org/rfc/rfc7208.html)
- [RFC 6376 - DomainKeys Identified Mail](https://www.rfc-editor.org/rfc/rfc6376.html)
- [RFC 9989 - Domain-Based Message Authentication, Reporting, and Conformance](https://www.rfc-editor.org/rfc/rfc9989.html)
