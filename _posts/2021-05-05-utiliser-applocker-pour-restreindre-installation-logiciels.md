---
title: "Utiliser Applocker pour restreindre l'installation de logiciels à un groupe d'utilisateurs"
author: Benoit
date: 2021-05-05 19:32:33 +0100
categories: [it]
tags: [applocker, windows, gpo]
math: true
image: /images/applocker/data-security.jpg
---

# Qu'est ce qu'Applocker ?

Applocker est une fonctionnalité qui a fait son apparition avec Windows 7 entreprise et Windows Server 2008R2. il s'agit d'une évolution des "stratégies de restriction logicielles"  (ou SRP) qui avaient à l'époque été introduits avec Windows Server 2000 et Windows XP. 

Selon Microsoft:
> AppLocker fait avancer les fonctionnalités de contrôle d’application et les fonctionnalités des stratégies de restriction logicielle. AppLocker contient de nouvelles fonctionnalités et extensions qui vous permettent de créer des règles pour autoriser ou refuser l’exécution d’applications en fonction des identités uniques des fichiers et pour spécifier les utilisateurs ou groupes qui peuvent exécuter ces applications.

Dans ce tutoriel, nous allons voir comment utiliser Applocker dans un environnement Windows Server 2019 et Active Directory pour restreindre l'execution

# Préparation des groupes

Nous allons dans un premier temps créer les groupes utilisateurs dont nous aurons besoin:


On ouvre la gestion des utilisateurs active directory
![Menu outil du gestionnaire de serveur](/images/applocker/01.png)

On crée un nouveau groupe que nous appellerons "G_RESTRICTION LOGICIELS. Nous pourrons ensuite insérer dans ce groupe d'autres groupes qui n'auront pas l'autorisation d'installer des logiciels (par exemple les Stagiaires  :D )
![Menu Nouveau groupe](/images/applocker/02.png)


![Ajout d'un groupe](/images/applocker/03.png)

Nous allons donc ajouter le groupe "G_Stagiaires" au groupe "G_restrictions_logiciels"
![Utilisateurs et ordinateurs Active Directory](/images/applocker/04.png)

![Ajout d'un groupe à un autre groupe](/images/applocker/05.png)

![Selection des groupes](/images/applocker/06.png)

![Boite de dialogue confirmation](/images/applocker/09.png)

# Création de la stratégie de groupe

Nous allons maintenant créer une stratégie de groupe pour mettre en place Applocker

![Menu outil du gestionnaire de serveur](/images/applocker/10.png)

Il faudra bien évidement lier la GPO à l'OU sur laquelle vous voulez l'appliquer...
![Creation d'une nouvelle GPO](/images/applocker/11.png)

## Activation du Service "Infomations d'Application"

Pour qu'Applocker puisse fonctionne, il faut que le service "Informations d'Application soit démarré sur les PC Windows 10. Par défaut, ce service est désactivé. Il faut donc l'activer.

Nous pouvons bien entendu intégrer ceci dans notre GPO:

Configuration Ordinateur -> Paramètre Windows -> Paramètre de sécurité -> Services Systèmes

![Editeur de Gestion de stratégies de groupe](/images/applocker/12.png)

On sélectionne le démarrage "Automatique" :
![Propriete de information application](/images/applocker/13.png)

## Configuration de la GPO Applocker:

Il faut ensuite configurer la mise en application des règles. Pour cela il faut cliquer sur "Configurer la mise en application des règles"

![Gestion des stratégies de groupe](/images/applocker/14.png)


![Propriétés d'Applocker](/images/applocker/15.png)

Nous allons cocher les 4 cases et sélectionner "Appliquer les règles" dans le menu déroulant.

![Propriétés d'Applocker](/images/applocker/16.png)

## Règles de l'executable

Je vais vous montrer comment créer les "règles de l'éxécutable" mais il faudra faire la même chose pour les autres catégories:

- Règles de l'éxecutable
- Règles Windows Installer
- Règles de script

### Creation de la règle "Tout le monde":

Nous allons dans un premier temps autoriser tout le monde à executer les executables.

![Création d'une règle](/images/applocker/17.png)

![Création d'une règle](/images/applocker/18.png)

![Création d'une règle](/images/applocker/19.png)

![Création d'une règle](/images/applocker/20.png)

![Création d'une règle](/images/applocker/21.png)

![Création d'une règle](/images/applocker/22.png)

![Création d'une règle](/images/applocker/23.png)

On clique maintenant sur "Non"

![Création d'une règle](/images/applocker/24.png)

![Création d'une règle](/images/applocker/25.png)

### Creation de la règle "G_RESTRICTIONS_LOGICIELS"

Nous allons maintenant créer une règles pour empecher les membres du groupe "G_RESTRICTION_LOGICIELS" d'execuer des executables qui ne se trouvent pas dans le dossier "Program Files" ou "Windows":

![Création d'une règle](/images/applocker/26.png)

Nous appliquons cette règle au groupe "G_RESTRICTIONS_LOGICIELS"

![Création d'une règle](/images/applocker/27.png)

![Création d'une règle](/images/applocker/28.png)

![Création d'une règle](/images/applocker/29.png)

![Création d'une règle](/images/applocker/30.png)

Nous allons maintenant créer les Exceptions. Il faut cliquer sur ajouter et insérer ces deux exceptions:

```
%PROGRAMFILES%/*
```
et 

```
%WINDIR%/*
```

![Création d'une règle](/images/applocker/31.png)

![Création d'une règle](/images/applocker/32.png)

Il faut maintenant répéter la même procédure pour:

- Règles Windows Installer
- Règles de Script

Concernant les règles d'application empaquetées, il faut générer les règles par défaut: 

__ATTENTION, Si vous ne générez pas de règles par défaut ici, votre menu démarrer risque de cesser de fonctionner__

![Création d'une règle](/images/applocker/33.png)

# Vidéo de démonstration

[![Mise en place d'APPlocker](https://img.youtube.com/vi/6rS4WepDloA/0.jpg)](https://www.youtube.com/watch?v=6rS4WepDloA "Mise en place d'APPlocker")


Et voila, maintenant, les utilisateurs du groupe "G_Stagiaires" ne devraient plus pouvoir installer d'applications