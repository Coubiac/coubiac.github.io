---
layout: post
title: "Cisco Secure Email (IronPort) : comprendre le parcours d'un mail entrant"
description: "Listener, HAT, Sender Groups, Mail Flow Policies, RAT, LDAP, SPF, DKIM, DMARC et Work Queue : suivre pas à pas le traitement d'un mail entrant dans Cisco Secure Email Gateway."
tags:
  - Cisco Secure Email
  - Messagerie
---

Cisco Secure Email Gateway, historiquement connu sous les noms Cisco ESA ou IronPort, ne se contente pas de recevoir un message puis de lancer un antivirus et un antispam.

Lorsqu'un serveur distant tente de remettre un courrier, plusieurs décisions sont prises successivement : faut-il accepter la connexion ? Quelle politique appliquer à cet émetteur ? Le destinataire est-il valide ? Le message est-il correctement authentifié ? Contient-il du spam, un malware ou une URL suspecte ?

Cisco découpe le traitement d'un message en trois grandes phases :

- **Receipt** : réception SMTP ;
- **Work Queue** : analyse et traitement du message ;
- **Delivery** : routage et livraison vers le serveur suivant.

Cette séparation est importante pour comprendre le rôle du HAT, du RAT, des Sender Groups et des Mail Flow Policies, mais aussi la position parfois déroutante de SPF, DKIM et DMARC dans le pipeline.

## Vue générale du traitement d'un mail entrant

![Parcours d'un mail entrant dans Cisco Secure Email Gateway](/assets/diagrams/ironport-mail-entrant-pipeline.svg)

Le schéma est volontairement pédagogique. Le pipeline réel d'AsyncOS comporte davantage d'étapes et certaines fonctions peuvent varier selon la configuration de la passerelle.

## Le Listener : le point d'entrée SMTP

Tout commence par un **Listener**.

Un Listener correspond au service SMTP exposé par Cisco Secure Email Gateway sur une interface et un port donnés. Pour recevoir du courrier venant d'Internet, on utilise typiquement un **Public Listener**.

Dès qu'un serveur SMTP distant établit une connexion TCP, la passerelle connaît notamment son adresse IP source.

Elle peut donc commencer à prendre des décisions alors qu'aucun message n'a encore été transmis.

## HAT : qui se connecte ?

HAT signifie **Host Access Table**.

Son rôle est de déterminer comment traiter les machines qui établissent une connexion avec le Listener.

Il faut faire attention au mot "sender". À ce stade, on ne parle pas principalement de l'adresse visible dans :

```text
From: alice@example.org
```

On parle du serveur SMTP qui établit réellement la connexion avec l'IronPort.

La passerelle connaît par exemple :

```text
Adresse IP source : 203.0.113.25
```

Lorsqu'un Listener reçoit une connexion TCP, AsyncOS compare cette adresse aux Sender Groups configurés dans son HAT. Les Sender Groups sont évalués dans l'ordre jusqu'à trouver une correspondance.

## Les Sender Groups

Un **Sender Group** permet de ranger plusieurs hôtes SMTP dans une même catégorie afin de leur appliquer le même comportement.

La classification peut notamment utiliser :

- une adresse IP ou une plage réseau ;
- un hostname ou un domaine ;
- une DNS List ;
- une organisation identifiée par le service de réputation ;
- la réputation de l'adresse IP fournie par Cisco Talos.

Le terme **SBRS** (SenderBase Reputation Score) reste souvent employé dans les environnements et documentations historiques IronPort. Les versions récentes parlent plus généralement de réputation IP.

Le Sender Group répond donc à la question :

> "Dans quelle catégorie dois-je ranger le serveur qui vient de se connecter ?"

Une machine dont la réputation est très mauvaise pourra par exemple correspondre à un groupe destiné aux sources bloquées, tandis qu'un serveur classique d'Internet pourra correspondre à un groupe accepté ou surveillé.

Le Sender Group ne définit cependant pas à lui seul le comportement SMTP à appliquer.

C'est le rôle de la Mail Flow Policy.

## La Mail Flow Policy

Une **Mail Flow Policy** est associée à un Sender Group.

La distinction entre les deux est fondamentale :

| Élément | Question |
|---|---|
| Sender Group | "Dans quelle catégorie se trouve ce serveur SMTP ?" |
| Mail Flow Policy | "Comment dois-je traiter les connexions de cette catégorie ?" |

La Mail Flow Policy contrôle la conversation SMTP. Elle peut notamment définir :

- l'acceptation ou le rejet d'une connexion ;
- des limites de débit ;
- le nombre maximal de connexions ou de destinataires ;
- les contraintes TLS ;
- différents contrôles de sécurité appliqués au flux.

Il faut retenir une subtilité importante :

> **Activer un contrôle dans une Mail Flow Policy ne signifie pas nécessairement que ce contrôle est exécuté immédiatement.**

La Mail Flow Policy est sélectionnée très tôt dans le traitement. Certaines opérations ne pourront cependant être effectuées que plus tard, lorsque la passerelle disposera des informations nécessaires.

C'est particulièrement important pour comprendre SPF, DKIM et DMARC.

## HAT et RAT : deux rôles complètement différents

HAT et RAT sont faciles à confondre à cause de leurs noms proches.

Ils répondent pourtant à deux questions différentes.

![Différence entre HAT et RAT dans Cisco Secure Email Gateway](/assets/diagrams/ironport-hat-rat.svg)

Le **HAT** s'intéresse principalement au serveur SMTP qui se connecte.

Le **RAT** s'intéresse à la destination pour laquelle ce serveur tente de remettre du courrier.

## RAT : pour qui accepte-t-on du courrier ?

RAT signifie **Recipient Access Table**.

Le RAT intervient au niveau du destinataire de l'enveloppe SMTP, c'est-à-dire lors du `RCPT TO`.

Prenons cette conversation :

```smtp
EHLO mail.example.org
MAIL FROM:<alice@example.org>
RCPT TO:<bob@example.net>
```

Le RAT permet notamment à la passerelle de déterminer si elle est censée accepter du courrier destiné à `example.net`.

Sur une passerelle protégeant plusieurs domaines, le RAT peut par exemple contenir les domaines pour lesquels le Listener doit accepter des messages.

Le RAT n'est donc ni un antispam, ni un antivirus.

Il répond principalement à une question d'acceptation :

> "Est-ce une destination pour laquelle cette passerelle accepte du courrier ?"

Cette vérification est également essentielle pour éviter qu'une passerelle entrante ne se comporte comme un **open relay**.

## RAT et LDAP Recipient Acceptance

Accepter le domaine `example.net` ne signifie pas nécessairement que toutes les adresses possibles de ce domaine existent.

Le RAT peut donc accepter :

```text
@example.net
```

alors qu'une vérification LDAP peut ensuite déterminer si :

```text
bob@example.net
```

correspond réellement à un utilisateur ou à un destinataire valide.

On peut retenir :

- **RAT** : est-ce une destination que j'accepte ?
- **LDAP Recipient Acceptance** : ce destinataire précis existe-t-il ?

Cette validation permet notamment de rejeter un destinataire inexistant pendant la conversation SMTP plutôt que d'accepter le message puis de générer ultérieurement un NDR.

## Le moment charnière : la commande DATA

Jusqu'ici, une grande partie des décisions peut être prise sans avoir reçu le contenu du message.

La conversation SMTP finit cependant par atteindre :

```smtp
DATA
```

Le serveur distant transmet alors les en-têtes, le corps du message et les éventuelles pièces jointes.

Avant cette étape, la passerelle dispose principalement d'informations relatives à la connexion SMTP et à l'enveloppe.

Après cette étape, elle dispose réellement du message à analyser.

Cette frontière aide beaucoup à comprendre le fonctionnement des différents contrôles de sécurité.

## SPF, DKIM et DMARC : configuration et exécution

C'est l'un des points les moins intuitifs du fonctionnement de Cisco Secure Email Gateway.

Les fonctions d'authentification sont activées par la politique appliquée au flux entrant. Cette politique est choisie très tôt dans la réception.

Mais les vérifications ne peuvent être réalisées qu'au moment où les informations nécessaires sont disponibles.

Il faut donc distinguer :

- **la décision d'effectuer le contrôle** ;
- **le moment où le contrôle peut réellement être exécuté**.

![Relations entre SPF, DKIM et DMARC sur un mail entrant](/assets/diagrams/ironport-spf-dkim-dmarc.svg)

## SPF peut être évalué tôt

SPF repose notamment sur l'adresse IP du serveur qui remet le message et sur l'identité d'enveloppe SMTP.

La passerelle connaît déjà l'adresse IP dès l'établissement de la connexion.

Après :

```smtp
MAIL FROM:<bounce@example.org>
```

elle connaît également l'identité d'enveloppe nécessaire à l'évaluation SPF.

SPF peut donc être évalué relativement tôt pendant la réception SMTP.

## DKIM nécessite le message

DKIM fonctionne différemment.

Un message signé contient notamment un en-tête :

```text
DKIM-Signature: ...
```

La signature porte sur des en-têtes et sur le corps du message.

La passerelle doit donc disposer du message pour vérifier correctement cette signature.

Une vérification DKIM ne peut par conséquent pas être effectuée lors de l'établissement initial de la connexion SMTP.

## DMARC dépend de SPF, DKIM et du From

DMARC s'appuie sur les mécanismes SPF et DKIM, mais ajoute la notion d'**alignement** avec le domaine visible dans le champ `From:` du message.

DMARC ne nécessite pas que SPF et DKIM réussissent simultanément.

Un message peut passer DMARC si SPF est valide et correctement aligné même si DKIM échoue. L'inverse est également possible : un DKIM valide et aligné peut permettre à DMARC de réussir malgré un échec SPF.

Cette notion d'alignement est essentielle. Un simple `SPF PASS` ou `DKIM PASS` ne signifie pas automatiquement que DMARC sera lui aussi valide.

## La Work Queue

Une fois le message reçu, il est remis au pipeline de traitement de la **Work Queue**.

C'est ici que Cisco Secure Email Gateway peut effectuer de nombreux traitements portant sur le message lui-même.

On y retrouve notamment :

- les Message Filters ;
- les politiques appliquées aux messages ;
- l'antispam ;
- l'antivirus ;
- l'analyse de réputation et l'analyse des fichiers ;
- les Content Filters ;
- les Outbreak Filters ;
- différentes fonctions de quarantaine ou d'analyse.

Contrairement au HAT ou au RAT, ces traitements ont généralement besoin de connaître réellement le message ou son contenu.

Un antivirus, par exemple, ne peut évidemment pas analyser une pièce jointe qui n'a pas encore été transmise par le serveur SMTP distant.

## Pourquoi l'antispam et l'antivirus sont-ils liés à la Mail Flow Policy ?

Là encore, il faut distinguer **activation** et **exécution**.

La politique appliquée au flux peut décider que les messages reçus depuis un certain Sender Group devront être soumis à l'antispam ou à l'antivirus.

Cette décision est donc prise pendant la phase de réception.

Le scan lui-même est effectué plus tard dans le pipeline, lorsque le message a été accepté et remis à la Work Queue.

Autrement dit, la politique peut dire :

> "Ce message devra être analysé."

La Work Queue réalise ensuite réellement cette analyse.

## Pourquoi Message Tracking peut-il sembler raconter une autre histoire ?

Lorsqu'on consulte Message Tracking, les événements liés à SPF, DKIM, DMARC, antispam ou antivirus peuvent donner l'impression d'être regroupés assez tard dans le traitement.

Ce n'est pas forcément contradictoire avec la configuration du HAT ou de la Mail Flow Policy.

La connexion SMTP et le message sont deux objets différents dans le fonctionnement d'AsyncOS.

Cisco utilise notamment des identifiants différents dans ses logs :

- **ICID** identifie une connexion SMTP entrante ;
- **MID** identifie un message traité par la passerelle ;
- **RID** identifie un destinataire ;
- **DCID** identifie une connexion SMTP utilisée pour la livraison.

La classification HAT et Sender Group peut donc avoir été décidée dès l'établissement de l'ICID alors qu'un résultat DKIM ou DMARC ne peut apparaître qu'une fois que le MID existe et que le contenu correspondant a été reçu.

Message Tracking montre le déroulement du traitement du message. Il ne faut donc pas nécessairement interpréter son ordre visuel comme l'endroit exact où chaque fonction a été configurée.

## Ce qu'il faut retenir

Le traitement entrant devient beaucoup plus simple à comprendre lorsqu'on sépare les rôles.

**Le Listener** reçoit la connexion SMTP.

**Le HAT** détermine comment considérer le serveur qui se connecte.

**Le Sender Group** classe ce serveur.

**La Mail Flow Policy** définit comment traiter cette catégorie de connexion.

**Le RAT** vérifie que la passerelle accepte du courrier pour la destination demandée.

**LDAP Recipient Acceptance** peut vérifier que le destinataire précis existe réellement.

**SPF** peut être évalué relativement tôt grâce à l'adresse IP source et à l'identité d'enveloppe.

**DKIM** nécessite le message lui-même.

**DMARC** exploite notamment SPF, DKIM et le domaine du champ `From:` afin de contrôler leur alignement.

**La Work Queue** effectue ensuite l'essentiel des analyses portant sur le contenu du message : antispam, antivirus, réputation des fichiers, filtres de contenu, Outbreak Filters, etc.

Enfin, **Delivery** se charge de router le message accepté vers le serveur de messagerie suivant.

La distinction essentielle est donc moins "quelle fonction se trouve dans quel menu ?" que :

> **De quelles informations la passerelle dispose-t-elle à cet instant, et quel contrôle peut-elle réellement effectuer avec ces informations ?**

C'est ce raisonnement qui permet de comprendre pourquoi certaines fonctions sont configurées très tôt dans le flux, tout en apparaissant beaucoup plus tard dans Message Tracking.

## Sources

- [Cisco Secure Email Gateway - Understanding the Email Pipeline](https://www.cisco.com/c/en/us/td/docs/security/esa/esa16-5/user_guide/b_ESA_Admin_Guide_16-5/b_ESA_Admin_Guide_12_1_chapter_011.html)
- [Cisco Secure Email Gateway - HAT, Sender Groups and Mail Flow Policies](https://www.cisco.com/c/en/us/td/docs/security/esa/esa16-5/user_guide/b_ESA_Admin_Guide_16-5/b_ESA_Admin_Guide_12_1_chapter_0110.html)
- [Cisco Secure Email Gateway - Recipient Access Table](https://www.cisco.com/c/en/us/td/docs/security/esa/esa16-5/user_guide/b_ESA_Admin_Guide_16-5/b_ESA_Admin_Guide_12_1_chapter_0111.html)
- [Cisco Secure Email Gateway - Email Authentication](https://www.cisco.com/c/en/us/td/docs/security/esa/esa16-5/user_guide/b_ESA_Admin_Guide_16-5/b_ESA_Admin_Guide_12_1_chapter_010110.html)
