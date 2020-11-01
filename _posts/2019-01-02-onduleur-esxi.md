---
layout: post
title: >
    Gestion de l’alimentation de serveurs ESXi avec un
    onduleur APC
published: true
author: admin
comments: true
date: 2018-06-25 06:06:54
tags:
    - Linux
    - Vmware
categories:
    - it
---
Nous utilisons ici une machine DEBIAN 8 fraichement installée (un petit CPU et 256Mo de RAM suffisent)

## Installation

### Connexion de l’onduleur au serveur en USB

La connexion se fait à l’aide du câble **USB-RJ45** fourni avec l’onduleur.

  * Allumez l'UPS.
  * Connectez d'abord le côté RJ45 dans l'UPS (à l'arrière) dans la fiche notée `USB`.
  * Connectez ensuite le côté USB dans un port libre USB de la machine linux
  * Vérifiez la connexion en tapant la commande `lsusb`
  * Vous devriez obtenir la liste des périphériques USB branchés sur la machine linux et notamment une ligne ressemblant à `Bus 001 Device 002: ID 051d:0002 American Power Conversion Back-UPS Pro 500/1000/1500`

### Connexion de l’onduleur au réseau ethernet de l’entreprise en utilisant une carte AP9630

Le paramétrage de la carte n’est pas traité ici. Pour plus d’informations, se référer au manuel de l’utilisateur de la carte: [UPS Network Management Card 2][1]
  
Toutefois, pensez à déclarer l’IP de la machine de gestion linux dans l’interface web de la carte sous le menu `Configuration -> PowerChute Clients`

### Installation des paquets nécessaires
{% highlight bash %}
apt-get update && apt-get install apcupsd sendemail putty-tools
{% endhighlight %}
### Configuration du daemon de gestion de l’onduleur APCUPSD

Le démon place ses fichiers de configuration à deux endroits:
{% highlight bash %}
/etc/apcupsd/
{% endhighlight %}
{% highlight bash %}
root@debian:/etc/apcupsd$ ls -l
total 60
-rwxr-xr-x 1 user user 4488 févr. 15 12:14 apccontrol
-rw-r--r-- 1 root root 12623 févr. 15 12:15 apcupsd.conf
-rwxr-xr-x 1 user user 424 févr. 15 10:39 changeme
-rwxr-xr-x 1 user user 413 févr. 15 10:39 commfailure
-rwxr-xr-x 1 user user 452 févr. 15 10:39 commok
-rw-r--r-- 1 user user 662 févr. 15 10:39 hosts.conf
-rwxr-xr-x 1 user user 617 févr. 15 10:39 killpower
-rw-r--r-- 1 user user 2344 févr. 15 10:39 multimon.conf
-rwxr-xr-x 1 user user 752 févr. 15 10:39 offbattery
-rwxr-xr-x 1 user user 741 févr. 15 10:39 onbattery
-rwxr-xr-x 1 user user 944 févr. 15 10:39 ups-monitor
{% endhighlight %}
ainsi que le fichier
{% highlight bash %}
/etc/default/apcupsd
{% endhighlight %}
Attention, dans ce fichier la propriété ISCONFIGURED doit être YES car vous n’arriverez pas à démarrer le service.

### Configuration du démon pour utilisation de la carte AP9630

Un fichier de configuration ainsi que 3 scripts vont nous intéresser:

Fichier de configuration:

`/etc/apcupsd/apcupsd.conf` -> Configuration générale

Trois scripts:

`/etc/apcupsd/onbattery` -> Envoie d’un mail pour notifier la coupure d’électricité

`/etc/apcupsd/offbattery` -> Envoie d’un mail pour notifier le rétablissement de l’électricité.

`/etc/apcupsd/apccontrol` -> Procédure d'extinction

Le fichier `apcupsd.conf` doit avoir ce genre de configuration:
{% highlight bash %}
## apcupsd.conf v1.1 ##
UPSNAME UPS01 #Nom de l'UPS
UPSCABLE ether #Type de cable
UPSTYPE pcnet #On utilise le driver PowerChute
LOCKFILE /var/lock
DEVICE ipaddr:user:passphrase # Cette propriété peut être laissée vide mais c'est un tout petit peu moins sécurisé
UPSCLASS standalone
UPSMODE disable
ONBATTERYDELAY 20 #Au bout de 20 seconde lance le script "onbattery" qui va notifier par mail

#ATTENTION ! Les trois propriétés suivantes fonctionnent en simultané. La survenue de l'un de ces évènements lance le script apccontrol et donc la procédure d'arret
BATTERYLEVEL 20 #L'onduleur n'a plus que 20% de battery
MINUTES 20 #L'onduleur n'a plus que 20 minutes de batterie
TIMEOUT 600 #L'onduleur est sur batterie depuis 600 secondes. Si on le configure à 0, ce timer est désactivé.
{% endhighlight %}
**Attention !** dans la propriété DEVICE, user et passphrase ne correspondent pas au nom d’utilisateur utilisé pour se connecter à l’interface web. Ce nom d’utilisateur et cette passphrase se configurent dans l’interface web de la carte sous:

`Configuration -> Shutdown`

voici un exemple de script onbattery qui va envoyer un mail de notification (on utilise un smtp ouvert)
{% highlight bash %}
# this shell script if placed in /etc/apcupsd
# will be called by /etc/apcupsd/apccontrol when the UPS
# goes on batteries.
#
SYSADMIN=administrateur@exemple.com
APCUPSD_MAIL="/usr/bin/sendemail"
HOSTNAME=`hostname`
MSG="COUPURE ELECTRIQUE DANS SALLE SERVEUR"
#
(
echo " "
echo " =================================================="
echo " COUPURE ELECTRIQUE EN COURS DANS LA SALLE SERVEUR"
echo " =================================================="
echo " "
echo " L'onduleur a detecté un probleme et sa batterie a pris le relais"
echo " "
echo "Ne paniquez pas ! Restez calme ..."
echo " "
echo "Status de l'onduleur:"
echo " "
/sbin/apcaccess status
) | $APCUPSD_MAIL -u "$MSG" -f onduleur@exemple.com -t $SYSADMIN -s smtp-relay.exemple.com:25
exit 0
offbattery qui va notifier du retour à la normale
# this shell script if placed in /etc/apcupsd
# will be called by /etc/apcupsd/apccontrol when the UPS
# goes on batteries.
#
SYSADMIN=administrateur@exemple.com
APCUPSD_MAIL="/usr/bin/sendemail"
HOSTNAME=`hostname`
MSG="ALIMENTATION ELECTRIQUE RETABLIE DANS SALLE SERVEUR"
#
(
echo " "
echo " =================================================="
echo " ALIMENTATION ELECTRIQUE RETABLIE DANS LA SALLE SERVEUR"
echo " =================================================="
echo " "
echo " La salle serveur est à nouveau alimentée electriquement"
echo " "
echo " Tout est revenu à la normale... nous sommes sauvés..."
echo " "
echo "Status de l'onduleur:"
echo " "
/sbin/apcaccess status
) | $APCUPSD_MAIL -u "$MSG" -f onduleur@exemple.com -t $SYSADMIN -s smtp-relay.gmail.com:25
exit 0
{% endhighlight %}
Ensuite on modifie le fichier apccontrol afin de se logguer en SSH sur les ESXi et lancer une procédure d’extinction. On peut aussi éteindre des serveurs windows physiques. Pensez à bien paramétrer VSPHERE pour bien établir l’ordre d’extinction des VM's
{% highlight bash %}
#!/bin/sh
#
# Copyright (C) 1999-2002 Riccardo Facchetti <riccardo@master.oasi.gpa.it>
#
# for apcupsd release 3.14.12 (29 March 2014) - debian
#
# platforms/apccontrol. Generated from apccontrol.in by configure.
#
# Note, this is a generic file that can be used by most
# systems. If a particular system needs to have something
# special, start with this file, and put a copy in the
# platform subdirectory.
#

#
# These variables are needed for set up the autoconf other variables.
#
prefix=/usr
exec_prefix=${prefix}

APCPID=/var/run/apcupsd.pid
APCUPSD=/sbin/apcupsd
SHUTDOWN=/sbin/shutdown
SCRIPTSHELL=/bin/sh
SCRIPTDIR=/etc/apcupsd
WALL=wall

export SYSADMIN=root
export APCUPSD_MAIL="mail"
if [ -f $SCRIPTDIR/config ]; then . $SCRIPTDIR/config ; fi

#
# Concatenate all output from this script to the events file
# Note, the following kills the script in a power fail situation
# where the disks are mounted read-only.
# exec >>/var/log/apcupsd.events 2>&1

#
# This piece is to substitute the default behaviour with your own script,
# perl, or C program.
# You can customize every single command creating an executable file (may be a
# script or a compiled program) and calling it the same as the $1 parameter
# passed by apcupsd to this script.
#
# After executing your script, apccontrol continues with the default action.
# If you do not want apccontrol to continue, exit your script with exit
# code 99. E.g. "exit 99".
#
# WARNING: the apccontrol file will be overwritten every time you update your
# apcupsd, doing `make install'. Your own customized scripts will _not_ be
# overwritten. If you wish to make changes to this file (discouraged), you
# should change apccontrol.sh.in and then rerun the configure process.
#
if [ -f ${SCRIPTDIR}/${1} -a -x ${SCRIPTDIR}/${1} ]
then
${SCRIPTDIR}/${1} ${2} ${3} ${4}
# exit code 99 means he does not want us to do default action
if [ $? = 99 ] ; then
exit 0
fi
fi

case "$1" in
killpower)
echo "Apccontrol doing: ${APCUPSD} --killpower on UPS ${2}" | ${WALL}
sleep 30
${APCUPSD} --killpower
echo "Apccontrol has done: ${APCUPSD} --killpower on UPS ${2}" | ${WALL}
;;
commfailure)
echo "Warning communications lost with UPS ${2}" | ${WALL}
;;
commok)
echo "Communications restored with UPS ${2}" | ${WALL}
;;
#
# powerout, onbattery, offbattery, mainsback events occur
# in that order.
#
powerout)
;;
onbattery)
echo "Power failure on UPS ${2}. Running on batteries." | ${WALL}
;;
offbattery)
echo "Power has returned on UPS ${2}..." | ${WALL}
;;
mainsback)
if [ -f /etc/apcupsd/powerfail ] ; then
printf "Continuing with shutdown." | ${WALL}
fi
;;
failing)
echo "Battery power exhausted on UPS ${2}. Doing shutdown." | ${WALL}
;;
timeout)
echo "Battery time limit exceeded on UPS ${2}. Doing shutdown." | ${WALL}
;;
loadlimit)
echo "Remaining battery charge below limit on UPS ${2}. Doing shutdown." | ${WALL}
;;
runlimit)
echo "Remaining battery runtime below limit on UPS ${2}. Doing shutdown." | ${WALL}
;;
doreboot)
echo "UPS ${2} initiating Reboot Sequence" | ${WALL}
${SHUTDOWN} -r now "apcupsd UPS ${2} initiated reboot"
;;
doshutdown)
##############################################################################################
#-----------------------------------PERSONNALISATION------------------------------------------
##############################################################################################
echo "****** Executing ESXi(s) and Windows Servers Shutdown Command ******" | ${WALL}

echo "****** Arret de ESXi 1 ******" | ${WALL}

/usr/bin/plink -ssh -2 -pw monsuperpassword root@192.168.1.1 "/sbin/shutdown.sh && /sbin/poweroff"
echo "***** Arret de ESXi 2 *****" | ${WALL}
/usr/bin/plink -ssh -2 -pw monsuperpassword root@192.168.1.2 "/sbin/shutdown.sh && /sbin/poweroff"

echo "**** Arret du Serveur Windows Physique"
net rpc shutdown -f -t 0 -C 'Panne Electrique' -U administrateur%monsuperpassword -I 192.168.1.3

echo "UPS ${2} initiated Shutdown Sequence" | ${WALL}
${SHUTDOWN} -h now "apcupsd UPS ${2} initiated shutdown"
###############################################################################################

;;
annoyme)
echo "Power problems with UPS ${2}. Please logoff." | ${WALL}
;;
emergency)
echo "Emergency Shutdown. Possible battery failure on UPS ${2}." | ${WALL}
;;
changeme)
echo "Emergency! Batteries have failed on UPS ${2}. Change them NOW" | ${WALL}
;;
remotedown)
echo "Remote Shutdown. Beginning Shutdown Sequence." | ${WALL}
;;
startselftest)
;;
endselftest)
;;
battdetach)
;;
battattach)
;;
*) echo "Usage: ${0##*/} command"
echo " warning: this script is intended to be launched by"
echo " apcupsd and should never be launched by users."
exit 1
;;
esac
{% endhighlight %}
Voila. Il ne reste plus qu’a réinitialiser le service apcupsd
  
`/etc/init.d/apcupsd force-reload`
  
### Mise en place des scripts CGI

Un certain nombre de scripts CGI existent afin de contrôler l’état de l’onduleur à distance.
  
Sur DEBIAN, il faut installer le paquet apcupsd-cgi et un serveur Web pour pouvoir les consulter à distance

{% highlight bash %}
# On install apache et apcupsd-cgi
apt-get update && apt-get install apache2
#on active CGI avec apache
a2enmod cgi
#on installe le l'add-on de apcupsd
apt-get install apcupsd-cgi
# on vérifie que les scripts sont bien présents
ls -l /usr/lib/cgi-bin/apcupsd/
total 112
-rwxr-xr-x 1 root root 27040 avril 14  2015 multimon.cgi
-rwxr-xr-x 1 root root 23104 avril 14  2015 upsfstats.cgi
-rwxr-xr-x 1 root root 27040 avril 14  2015 upsimage.cgi
-rwxr-xr-x 1 root root 31296 avril 14  2015 upsstats.cgi
{% endhighlight %}
On peut donc maintenant accéder à l’interface Web par l’adresse:

`http://ip-de-la-machine-debian/cgi-bin/apcupsd/multimon.cgi`

![liste des onduleur](/images/cgifig1.jpg)

Et en cliquant sur le lien:

![etat de l'onduleur](/images/cgifig2.jpg)

 [1]: /images/UPS-Network-Management-Card-2.pdf