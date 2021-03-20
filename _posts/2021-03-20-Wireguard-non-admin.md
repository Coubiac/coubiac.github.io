---
title: "Envoyer des mails de notification depuis un serveur Debian"
author: Benoit
date: 2020-11-02 20:30:30 +0100
categories: [it]
tags: [linux, postfix, gmail]
math: true
image: /images/postfix.png
---

Dans ce tuto nous allons installer postfix afin d'envoyer des mails depuis notre serveur DEBIAN 10.

# Installation de Postfix

On commence par mettre à jour le système et installer Postfix
{% highlight bash %}
~# apt-get update && apt-get upgrade
~# apt-get install libsasl2-modules postfix
{% endhighlight %}

Postfix va lancer l'assistant d'installation:

![assistant1](/images/postfix/screen1.png)

Ensuite postfix va vous demander de choisir un type d'installation. Vous allez choisir `site internet`

![assistant2](/images/postfix/screen2.png)

Entrez ensuite votre nom de domaine:

![assistant3](/images/postfix/screen3.png)



## Création d'un mot de passe application pour GMAIL

Si vous avez activé l'authentification à deux facteurs (2FA), vous devez créer un mot de passe Application.
Vous pouvez consulter la documentation google à [cette adresse][1]

## Paramétrage de postfix

il faut ensuite modifier le fichier `/etc/postfix/main.cf` afin de modifier la valeur `myhostname` avec notre nom d'hôte pleinement qualifié (fqdn)

{% highlight bash %}
myhostname = mail.exemple.fr
{% endhighlight %}

Nous allons maintenant ajouter le mot de passe du compte gmail (Attention, si vous avez activé l'authentification à deux facteurs de bien utilisé le mot de passe généré plus haut...). Nous allons pour cela modifier le fichier `/etc/postfix/sasl/sasl_passwd`

{% highlight bash %}
~# vi /etc/postfix/sasl/sasl_passwd
{% endhighlight %}

insérez ici l'authentification de cette manière (vous pouvez faire un copier-coller et remplacer le login/mdp avec les bonnes valeurs):
{% highlight bash %}
[smtp.gmail.com]:587 username@gmail.com:password
{% endhighlight %}

On peut maintenant utiliser la commande `postmap`pour générer un fichier de bdd de hash:

{% highlight bash %}
~# postmap /etc/postfix/sasl/sasl_passwd
{% endhighlight %}

Nous allons sécuriser un peu l'accès aux fichiers:
{% highlight bash %}
~# chown root:root /etc/postfix/sasl/sasl_passwd /etc/postfix/sasl/sasl_passwd.db 
~# chmod 0600 /etc/postfix/sasl/sasl_passwd /etc/postfix/sasl/sasl_passwd.db
{% endhighlight %}

## Configurer le relay postfix

Nous allons modifier le fichier `main.cf` afin de relayer le courrier vers le smtp de gmail:

{% highlight bash %}
~# vi /etc/postfix/main.cf
{% endhighlight %}

On modifie la valeur `relayhost`:

{% highlight bash %}
relayhost = [smtp.gmail.com]:587
{% endhighlight %}

Ensuite on ajoute ces lignes pour activer l'authentification:

{% highlight bash %}
smtp_sasl_auth_enable = yes
smtp_sasl_security_options = noanonymous
smtp_sasl_password_maps = hash:/etc/postfix/sasl/sasl_passwd
smtp_tls_security_level = encrypt
smtp_tls_CAfile = /etc/ssl/certs/ca-certificates.crt
{% endhighlight %}

## Configurer l'adresse mail de root

on edite le fichier `/etc/aliases`
{% highlight bash %}
vi /etc/aliases
{% endhighlight %}

le fichier doit ressembler à
{% highlight bash %}
# See man 5 aliases for format
postmaster: root
root: username@domaine.com # On ajoute cette ligne avec l'adresse mail de l'admin du serveur
{% endhighlight %}

On compile les alias:
{% highlight bash %}
newaliases
{% endhighlight %}

on redémarre ensuite postfix
{% highlight bash %}
service postfix restart
{% endhighlight %}
## Test d'envoi de mail

On peut utiliser sendmail pour tester l'envoi d'un mail (attention le point . à la fin est important):

{% highlight bash %}
# sendmail root
From: monserveur
Subject: Mail test
Ceci est un test
.
{% endhighlight %}

Vous pouvez vérifier que tout s'est bien passé en consultant les logs:

{% highlight bash %}
tail -f /var/log/mail.log
{% endhighlight %}

[1]: https://support.google.com/mail/answer/185833?hl=fr

