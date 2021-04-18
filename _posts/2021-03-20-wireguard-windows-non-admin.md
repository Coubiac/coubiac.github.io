---
title: "Autoriser des utilisateurs non-admin à gérer les tunnels Wireguard"
author: Benoit
date: 2021-04-018 15:30:30 +0100
categories: [it]
tags: [wireguard, windows, vpn]
math: true
image: /images/wireguard.svg
---

Vous avez sans doute déja entendu parler du VPN Wireguard ? Si ce n'est pas le cas, voici un certain nombre d'articles le présentant:

[Wireguard, principes de base]

[Comment installer Wireguard facilement]

[VeeamPN - Pour déployer facilement une infra VPN comme un pro]

[Des interfaces graphiques pour Wireguard Server]

Ce VPN est très facile à configurer, sécurisé et est maintenant intégré directement dans le noyeau Linux (depuis Mars 2020 et le kernel 5.6).

Des clients existent sur toutes les plateformes (PC, MAC, iOS, Android, Linux etc...).

Cependant, j'ai été confronté à un petit souci avec le client Windows. En effet, seuls les utilisateurs Windows ayant des droits Admin sont authorisés à gérér les tunnels (activer ou désactiver). C'est un fonctionnement normal lié au mode de fonctionnement de Wireguard. En effet, à chaque fois que le VPN est activé, une interface est créée. Elle est supprimés quand le VPN est désactivé.

Cependant, cela est problématique dans certaines situations. En effet, en fonctionnement normal, le tunnel VPN est monté automatiquement au démarrage du PC. Cela est une bonne chose car ça permet de sécuriser les flux en permanence. Mais dans certains cas, le tunnel ne se monte pas. Je n'ai pas encore trouvé la cause mais j'ai quelques idées quand même: Dans le cas ou le PC n'est pas connecté directement au réseau (par exemple, pas de wifi connu au démarrage...), le tunnel ne peut pas se monter et il n'y a pas de nouvelles tentatives quand le réseau est à nouveau disponible.

Voici donc une méthode de contournement:

# Ajouter une clé de registre:

```
HKEY_LOCAL_MACHINE\SOFTWARE\Wireguard
```

inserer ensuite une valeur DWORD:
```
LimitedOperatorUI
```
et lui attribuer la valeur 1.

Si vous voulez le configurer à l'aide d'une GPO, voici la configuration:

![GPO clé de registre wireguard](/images/gpo1-Wireguard.png)

# Donner des droits à l'utilisateur

L'utilisateur doit faire partie du groupe local "Opérateurs de configuration réseau".

Dans le cadre d'un fonctionnement avec l'active directory, vous pouvez utiliser les groupes restreints: L'idée est de créer un groupe dans votre AD qu'on pourrait par exemple appeler "utilisateurs Wireguard" et faire en sorte que ce groupe soit membre du groupe local des PC clients "Opérateurs de configuration réseau".

Vous pouvez regarder ce tuto sur l'excellent site [It Connect] 




[Wireguard, principes de base]: https://www.ionos.fr/digitalguide/serveur/outils/wireguard-vpn-principes-de-base/
[Comment installer Wireguard facilement]: https://korben.info/comment-installer-le-vpn-wireguard-facilement.html
[VeeamPN - Pour déployer facilement une infra VPN comme un pro]: https://korben.info/veeampn-pour-deployer-facilement-une-infra-vpn-comme-un-pro.html
[Des interfaces graphiques pour Wireguard Server]: https://korben.info/subspace-une-gui-pour-wireguard-server.html
[It Connect]: https://www.it-connect.fr/gpo-definir-un-utilisateur-administrateur-local-de-tous-les-pcs/