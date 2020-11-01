---
title: "Itil: Différence entre Incident et Problème"
author: Benoit
date: 2020-11-01 13:45:30 +0100
categories: [it]
tags: [itsm, itil]
math: true
image: /images/itil-logo.png
---

# Incidents / Problème

## Incidents
Itil définit un incident comme étant: 
> Tout événement qui ne fait pas partie du fonctionnement standard d'un service et qui cause, ou peut causer, une interruption ou une diminution de la qualité de ce service

### Exemple 1:

__Problématique:__
Pierre vous contacte pour vous signaler qu'il n'arrive plus à imprimer car l'imprimante lui signale un bourrage papier. Il a pourtant retiré la feuille coincé dans l'imprimante.

__Résolution:__
Un technicien se déplace pour verifier que Pierre n'a pas déchiré la feuille coincé en la retirant et qu'un petit morceau de papier n'est pas resté coincé dans l'imprimante. Il remet l'imprimante en marche.

### Exemple 2:

__Problématique:__
Jeanne de l'agence de Brest, vous appelle pour vous signaler que l'utilisation de l'ERP est extremment lente en ce moment et qu'elle n'arrive pas à travailler.

__Contexte:__
L'agence de Brest est un site distant, relié au site principal à l'aide d'un VPN. L'ERP fonctionne en mode Bureau à Distance (RDP)

__Résolution:__
Après enquète, vous vous rendez compte que la totalité de la bande passante est consommée par le téléchargement de mise à jour Windows. Vous demmandez à Jeanne de mettre les mises à jour en pause jusqu'a la pause déjeuner afin de rétablir une connexio

## Problèmes

Itil définit un problème de cette manière:

> Un problème est la cause inconnue d'un incident significatif ou de plusieurs incidents présentant les mêmes symptômes affectant le bon fonctionnement du système d'information ou du "métier" de l'entreprise.

### Exemple 1:

__Problématique:__

Jacques vous signale le disfonctionnement de l'imprimante que Pierre quelques heure après le passage du technicien. Vous résolvez l'incident de la même manière mais le lendemain, c'est au tour de Marie de vous signaler un soucis similaire.

__Résolution:__

A chaque signalement, vous allez créer un ticket d'incident et essayer de faire en sorte que l'utilisateur puisse continuer à travailler. Cependant, compte tenu de la récurence des incidents vous allez créer un ticket de problème. Ce ticket sera attribué au technicien spécialisé dans la réparation des imprimantes. Il va résoudre le problème en remplaçant les rouleaux de prise de papier qui sont usés et qui provoquent des bourrages à répétition.

On voit bien dans cet exemple qu'on continue de traiter les incidents même si ceux-ci sont liés à un problème. Itil étant orienté business, le plus important est de dépanner le plus rapidement possible les utilisateurs.

### Exemple 2:

__Problématique:__
Vous vous rendez compte en analysant les statistiques de votre système de ticketing, que l'incident signalé par Jeanne à l'agence de Brest est vraiment récurent: Plusieurs appels par mois à cause de problématiques similaires.

__Résolution:__

Vous allez créer un ticket de problème et attribuer ce ticket à l'administrateur réseau afin qu'il puisse mettre en place une priorisation des flux (QoS) pour prioriser les flux RDP (flux de communication de l'ERP).

## Conclusion

La gestion des incidents s’occupe de résoudre les inconforts liés à une situation dégradée.
La gestion des problèmes travaille pour s’assurer que les incidents ne se reproduiront pas.
