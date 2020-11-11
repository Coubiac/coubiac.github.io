---
title: "Supprimer les logiciales pré-installés avec Windows 10"
author: Benoit
date: 2020-11-01 13:45:30 +0100
categories: [it]
tags: [it, windows]
math: true
---
Quand on installe windows 10 pour la première fois, celui-ci installe tout un tas d'applications dont nous n'avons la plupart du temps pas besoin, surtout dans le cas d'une utilisation professionnelle.

![Menu démarrer](/images/uninstall-windows-preinstall-packages/startmenu.png)

## Lister les applications installées avec Powershell

Powershell permet de désinstaller facilement une application. Pour cela il faut lancer powershell en mode administrateur.
Une fois que vous vous trouver dans powershell, vous pouvez lister les packages installés à l'aide de la commande:

{% highlight powershell %}
Get-AppxPackage | ft Name, PackageFullName
{% endhighlight %}

![gatappxpackage](/images/uninstall-windows-preinstall-packages/gatappxpackage.png)

Si vous voulez la liste pour tous les utilisateurs:

{% highlight powershell %}
Get-AppxPackage -AllUsers | ft Name, PackageFullName
{% endhighlight %}

## Désinstaller une application

Admettons que nous voulions désinstaller l'application Skype:

![skype](/images/uninstall-windows-preinstall-packages/skype.png)

Nous allons la désinstaller à l'aide de cette commande:

{% highlight powershell %}
Get-AppxPackage *skypeapp* | Remove-AppxPackage
{% endhighlight %}


## Désinstaller toutes les applications préinstallées

Pour désinstaller l'ensemble des applications, il faut utiliser cette commande:

{% highlight powershell %}
Get-AppxPackage --AllUsers | Remove-AppxPackage
{% endhighlight %}

![supprimer toutes les applications](/images/uninstall-windows-preinstall-packages/remove-all-packages.gif)

__NB: Quelques applications vont rester. Il vous faudra les désinstaller à la main...__

## Desactiver la reinstallation pour les nouveaux utilisateurs

Quand les applications ont été supprimées, on peut empecher la réinstallation pour les nouveaux utilisateurs:

{% highlight powershell %}
Get-AppxProvisionedPackage -online | Remove-AppxProvisionedPackage -online
{% endhighlight %}