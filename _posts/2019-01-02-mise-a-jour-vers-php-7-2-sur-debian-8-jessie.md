---
layout: post
title: Mise à jour vers PHP 7.2 sur Debian 8 Jessie
published: true
author: admin
comments: true
date: 2018-07-22 10:07:33
tags:
    - Debian
    - PHP
categories:
    - developpement
    - it
permalink: /mise-a-jour-vers-php-7-2-sur-debian-8-jessie
---
Avec l'arrivée de Symfony 4.1, PHP 7.2 est obligatoire. Si votre serveur est encore avec DEBIAN 8 Jessie, voici comment mettre à jour PHP vers la version 7.2:

Ondřej Surý fournit des paquets PHP 7.2 pour Debian sur son dépot:
{% highlight bash %}
apt-get install apt-transport-https lsb-release ca-certificates
wget -O /etc/apt/trusted.gpg.d/php.gpg https://packages.sury.org/php/apt.gpg
echo "deb https://packages.sury.org/php/ $(lsb_release -sc) main" | tee /etc/apt/sources.list.d/php.list
apt-get update
apt-get install php7.2-cli
apt-get install php7.2 php7.2-opcache libapache2-mod-php7.2 php7.2-mysql php7.2-curl php7.2-json php7.2-gd  php7.2-intl php7.2-mbstring php7.2-xml php7.2-zip php7.2-fpm php7.2-readline
{% endhighlight %}
Ensuite, redémarrez APACHE:
{% highlight bash %}
service apache2 restart
{% endhighlight %}
Si tout s'est bien passé, la commande `php -v` devrait vous retourner:
{% highlight bash %}
PHP 7.2.7-2+0~20180714182401.1+jessie~1.gbp3fcba8 (cli) (built: Jul 15 2018 13:57:20) ( NTS )
Copyright (c) 1997-2018 The PHP Group
Zend Engine v3.2.0, Copyright (c) 1998-2018 Zend Technologies
    with Zend OPcache v7.2.7-2+0~20180714182401.1+jessie~1.gbp3fcba8, Copyright (c) 1999-2018, by Zend Technologies
    with Xdebug v2.6.0, Copyright (c) 2002-2018, by Derick Rethans
{% endhighlight %}