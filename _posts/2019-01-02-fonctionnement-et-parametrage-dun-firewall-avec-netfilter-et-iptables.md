---
title: "Fonctionnement et paramétrage d'un firewall avec Netfilter et IPTABLES"
author: Benoit
date: 2018-08-05 19:32:33 +0100
categories: [sysadmin, linux]
tags: [firewall,securite]
math: true
image: /images/firewall.svg
---

## Principe de fonctionnement

### Netfilter vs Iptables

Netfilter est une architecture de filtrage des paquets. Le filtrage se fait au sein du noyeau au niveau des couches basses du modèle OSI (Liaison de donnée, Réseau et Transport).
  
Netfilter est [stateless][1], il n'inspecte que les entêtes des paquets. Il n'entraine pas de latence.

Netfilter est un firewall qui agit au niveau du protocole. Il fonctionne un peu comme une API: pour pouvoir interagir avec Netfilter, nous aurons donc besoin d'un « logiciel client ». Il y en a plusieurs mais IPTables est le plus connu et le plus utilisé.Vous l'aurez donc compris, **IPTABLES n'est pas un firewall**. C'est un programme permettant d'interagir et paramétrer le firewall netfilter.

### Cheminement d'un paquet

Voici un schéma materialisant le chemin que peut prendre un paquet:

![cheminement d'un paquet](/images/packet-life.svg)

Chaque état (rectangle rouge) représente un point de filtrage possible avec IPTABLES.

**_PREROUTING_**: Traite les paquets à leur arrivée. Si un paquet est à destination du système local, il sera traité par un processus local (INPUT et/ou OUTPUT). Par exemple, si le paquet est destiné au serveur apache (port 80 ou 443) installé sur notre même serveur, il sera traité par le chemin de gauche. Sinon, si nous avons activé le forwarding, le paquet empruntera le chemin de droite, c'est à dire que les règles FORWARD et POSTROUTING  seront appliquées.

_**FORWARD**_ : Traite les paquets qui traversent le système local

_**INPUT**_: Traite les paquets destinés au système local (par exemple pour accéder à un service hébergé sur le même serveur que notre pare-feu)

_**OUTPUT**_: Traite les paquets qui quittent le système local

_**POSTROUTING**_: Traite les paquets juste avant qu'ils sortent.

&nbsp;

### Les Règles

Pour décider ce que va devenir un paquet, netfilter va appliquer des règles qu'on lui aura fourni. Ces règles ont un ordre et les paquets seront testés avec chacunes des règles les unes après les autres. Si une règle correspond, le paquet sera traité et les autres règles ne seront pas utilisées. D'où l'importance de l'ordonnancement de ces règles !

![traitement des règles](/images/regles-netfilter.svg)

#### Les cibles

Les cibles sont les actions à effectuer lorsqu'un paquet correspond au critères d'une règle. Les deux actions de base sont DROP et ACCEPT mais il existe aussi REJECT et LOG.

  * DROP: On rejète le paquet sans envoyer de notification à la source.
  * REJECT: On rejète le paquet et on retourne une erreur.
  * ACCEPT: Le paquet est accepté
  * LOG: Une info est écrite dans les logs.

Voici un exemple de règle:

{% highlight bash %}
iptables -A INPUT -s 216.58.209.227 -j DROP
{% endhighlight %}

décomposons cette règle:

-A: on ajoute la règle (les options sont A=Ajouter, I=Insérer, D=supprimer, L=lister)

INPUT: le [point de filtrage][3]

-s 216.58.209.227: l'adresse IP source

-j DROP: l'action à effectuer sur le paquet (la cible)

#### Les opérations

Comme expliqué sur le schéma précédent, les règles sont ordonnées. Elles sont numérotées à partir de 1.

On utilise -A pour ajouter une règle:
{% highlight bash %}
iptables -A INPUT -s 216.58.209.227 -j DROP
{% endhighlight %}
On insère une règle avec -I à la position souhaitée (position 2):
{% highlight bash %}
iptables -I OUTPUT -d 216.58.209.227 -j DROP 2
{% endhighlight %}
On supprime une règle avec -D
{% highlight bash %}
iptables -D OUTPUT 2
{% endhighlight %}
On liste les règles avec -L

{% highlight bash %}
# iptables -L
Chain INPUT (policy ACCEPT)
target    prot opt source     destination

Chain FORWARD (policy ACCEPT)
target    prot opt source     destination

Chain OUTPUT (policy ACCEPT)
target    prot opt source     destination
{% endhighlight %}

On supprime toutes les règles avec -F (flush)
{% highlight bash %}
iptables -F
{% endhighlight %}
#### Les critères

Les critères servent à spécifier une règle. Pour qu'une règle s'applique, tous les critères doivent être vérifiés. Voici les principaux critères:

-i : interface entrante
  
-o : interface sortante
  
-p : protocole de couche 4.
  
-s : adresse IP source
  
-d : adresse IP destination

##### Voici quelques exemples:

On interdit les entrées par eth0:
{% highlight bash %}
iptables -A INPUT -i eth0 -j DROP
{% endhighlight %}
On interdit le forward entre eth0 et eth1:
{% highlight bash %}
iptables -A FORWARD -i eth0 -o eth1 -j DROP
{% endhighlight %}
On interdit le ping (protocole ICMP):
{% highlight bash %}
iptables -A input -p icmp -j DROP
{% endhighlight %}
##### Les arguments des critères

###### Pour les adresses:

-s signifie « source » et -d signifie « destination ». On peut indiquer l'adresse IP, le nom d'hôte ou même un réseau entier (192.168.1.0/24 ou 192.168.1.0/255.255.255.0)

###### Pour les ports:

`--sport` signifie « port source », `--dport` signifie « port destination ». On peut indiquer un numéro, un nom, une étendue de ports ( 81:1024).

Sur cet exemple, on interdit les connexions au serveur httpd sur le port 80:
{% highlight bash %}
 iptables -A input -p tcp --dport 80 -j DROP
{% endhighlight %}
Le point d'exclamation (!) permet de dire « tout sauf ». Dans cet exemple on interdit toutes les connexions entrantes sauf celles venant de l'adresse ip 192.168.1.10:
{% highlight bash %}
iptables -A INPUT -s ! 192.168.1.10 -j DROP
{% endhighlight %}

#### Les Tables

En plus des points de filtrage (INPUT, OUTPUT, etc..) Netfilter utilise des tables particulières qui peuvent contenir des règles spécifiques. Les tables principales tables existantes sont: FILTER, NET et MANGLE. Si on ne précise pas de nom de table, la table FILTER sera utilisée par défaut:
{% highlight bash %}
iptables -L #affiche la liste des règles de la table FILTER

iptables -t nat -L #affiche la liste des règles de la table NAT
{% endhighlight %}
Exemple d'utilisation, le masquage d'IP:
{% highlight bash %}
iptables -t nat -A POSTROUTING -o eth0 -j MASQUERADE
{% endhighlight %}
Dans cet exemple, on ajoute une règle (`-A`) sur la table « nat » (`-t nat`), sur le point de filtrage « postrouting », c'est à dire juste avant que le paquet sorte, et on applique la règle « MASQUERADE ». C'est à dire qu'on remplace l'adresse IP source dans l'entête du paquet par l'adresse IP publique du firewall pour faire croire à la machine qui doit recevoir ce paquet qu'il a été envoyé par notre firewall.

### Le routage

Nous allons considérer le réseau suivant:



Pour créer un routeur sous linux, il y a plusieurs étapes à suivre.

#### Activer la fonctionnalité de routage

Le routage est une fonctionnalité du noyau linux. Par défaut cette fonctionnalité est désactivée, il faut donc l'activer.

on édite le fichier `sysctl.conf` situé dans le répertoire « etc »:
{% highlight bash %}
vi /etc/sysctl.conf
{% endhighlight %}
ensuite on repère cette ligne:
{% highlight bash %}
net.ipv4.ip_forward=0
{% endhighlight %}
et on remplace le « 0 » par un « 1 » (on la décommente si elle est commentée):
{% highlight bash %}
net.ipv4.ip_forward=1
{% endhighlight %}
Pour activer les changements, vous pouvez rebooter votre machine ou utiliser cette commende:
{% highlight bash %}
sysctl -p /etc/sysctl.conf
{% endhighlight %}
#### Créer les règles IPTABLES

Dans ces exemples, nous allons considérer que l'interface connectée à internet est eth0 et l'interface connectée au réseau local est eth1.

Tout ce qui provient de notre réseau local (LAN) est autorisé à traverser le routeur:
{% highlight bash %}
iptables -A FORWARD -i eth1 -j ACCEPT
{% endhighlight %}
On autorise les « paquets de réponse », autrement dit, tout ce qui vient de l'extérieur (WAN) et qui veut rentrer vers l'intérieur (LAN) et qui correspond à une réponse est autorisé:
{% highlight bash %}
iptables -A FORWARD -i eth0 -m state --state ESTABLISHED,RELATED -j ACCEPT
{% endhighlight %}
#### Le masquage d'adresse IP source

Comme vous le savez, une entête de paquet IP comporte, entre autres, l'adresse IP source et l'adresse IP destination.
  
L'adresse IP source est importante. En effet, sans elle, la machine qui reçoit le paquet ne sait pas à qui envoyer la réponse.
  
Dans notre exemple, imaginons que le PC1 envoie des paquets vers internet (pour affichier un site internet par exemple...), l'entête des paquets qu'il va envoyer vont logiquement comporter l'adresse IP source. C'est à dire, dans cet exemple l'adresse 192.168.1.20. 

Le problème qui se pose ici est que cette adresse n'est pas une adresse « routable » sur internet. Le site internet qui reçoit les paquets ne pourra donc pas répondre à une adresse locale.

Voici la solution:

Nous allons remplacer l'adresse IP source du paquet par l'adresse ip publique de notre routeur/firewall. De cette manière le site internet saura à qui envoyer la réponse.

Nous pouvons le faire de deux façon différentes. En utilisant la règle « MASQUERADE » ou en utilisant « SNAT ».

##### MASQUERADE

cette solution est surtout adaptée quand l'adresse IP de l'interface WAN (eth0 dans notre exemple) n'est pas une adresse IP fixe. Pour chaque paquet, iptables va rechercher l'IP de l'interface eth0 et remplacer l'IP source du paquet par celle-ci:
{% highlight bash %}
iptables -A POSTROUTING -t nat -o eth0 -j MASQUERADE
{% endhighlight %}
##### SNAT

Cette solution est à utiliser quand l'adresse ip publique est fixe. Même si la solution « masquerade » fonctionne avec une adresse ip fixe, la solution SNAT est plus optimisée car iptables n'a pas à rechercher l'adresse ip de l'interface WAN à chaque paquet (oui oui, il le fait à chaque paquet, n'oubliez pas que netfilter est « stateless »)
{% highlight bash %}
iptables -A POSTROUTING -t nat -o eth0 -j SNAT --to-source 89.63.83.128 
{% endhighlight %}
### Sauvegarder la configuration

Quand vous ajoutez des règles iptables, celles-ci sont stockées en mémoire. Elles ne seront donc actives que jusqu'au prochain reboot. C'est pour cette raison qu'il faut penser à sauvegarder votre configuration. Pour le faire, il y a plusieurs solutions en fonction de la distribution linux que vous utilisez.

#### RedHat / CentOS

en root:

/sbin/service iptables save

Cette commande lance le script d'initialisation d'iptables qui va lancer le programme `/sbin/iptables-save` . Ce programme va écrire la configuration iptables active dans le fichier `/etc/sysconfig/iptables` . L'ancien fichier est sauvegardé dans `/etc/sysconfig/iptables.save` . Bien qu'il soit toujours une bonne idée de tester une nouvelle règle iptables avant de l'écrire dans le fichier `/etc/sysconfig/iptables`, il est possible d'écrire directement dans ce fichier. Cela permet de distribuer rapidement un ensemble de règles iptables sur plusieurs machines. Dans ce cas, à chaque modification du fichier, il faut réappliquer les règles en utilisant la commande `/sbin/service iptables restart` .

#### Debian / Ubuntu

##### méthode traditionelle

Pour sauvegarder la configuration iptables active dans un fichier:
{% highlight bash %}
iptables-save > /etc/iptables.up.rules
{% endhighlight %}
ensuite pour que la configuration soit chargée au prochaine reboot, vous pouvez créer un script:
{% highlight bash %}
vi /etc/network/if-pre-up.d/iptables
{% endhighlight %}
En plaçant ce script dans ce dossier, il sera lancé juste avant l'activation du réseau. Ainsi votre machine est tout le temps protégée.
{% highlight bash %}
 #!/bin/sh
 /sbin/iptables-restore < /etc/iptables.up.rules
{% endhighlight %}
il faut ensuite rendre ce script exécutable:
{% highlight bash %}
chmod +x /etc/network/if-pre-up.d/iptables
{% endhighlight %}
##### méthode simple

Vous pouvez utiliser le paquet « iptables-persistent »

ce paquet vous propose deux commandes:
{% highlight bash %}
netfilter-persistent save
netfilter-persistent reload
{% endhighlight %}
Ce programme va créer deux fichiers: `/etc/iptables/rules.v4` et `/etc/iptables/rules.v6` . Il vous suffit d'éditer ces fichiers pour modifier la configuration.

##### méthode alternative

Cette méthode alternative a pour avantage de pouvoir facilement activer et désactiver le firewall. On crée un script et on le lance directement au démarrage du réseau. Voici un exemple de fichier de configuration de vos interfaces qui va prendre ce script en compte:

{% highlight bash %}
# This file describes the network interfaces available on your system
# and how to activate them. For more information, see interfaces(5).

source /etc/network/interfaces.d/*

# The loopback network interface
auto lo
iface lo inet loopback

# The WAN Interface
allow-hotplug eno1
iface eno1 inet dhcp
        post-up /usr/local/bin/firewall.sh start
        pre-down /usr/local/bin/firewall.sh stop
# The LAN  network interface
allow-hotplug eno2
iface eno2 inet static
	address 192.168.1.250
	netmask 255.255.255.0
{% endhighlight %}

Les exemples suivants sont des exemples de scripts comme expliqué ici.

## Exemples de configurations

### Exemple de configuration basique pour un serveur web

{% highlight bash %}
#!/bin/sh
IPTBLES=/sbin/iptables
WAN=eth0 #Nom de l'interface qui sera relié à internet
LAN=eth1 #Nom de l'interface qui sera reliée au réseau local

firewall_start() { #Exécuter lors du routeur.sh start
	
#-------------------- INPUT -------------------
#Ces règles s'appliquent aux paquets entrants

#Tout ce qui sort peut rentrer à nouveau 
$IPTABLES -A INPUT -i $WAN -m state --state ESTABLISHED,RELATED -j ACCEPT 

#On autorise le PING sur l'interface WAN (facultatif)
$IPTABLES -A INPUT -i $WAN -p icmp -j ACCEPT

#On laisse passer tout ce qui rentre dans l'interface lan afin de permettre à nos utilisateurs d'utiliser le DHCP, le DNS...etc.
#Mais on aurait aussi pu n'autoriser que certains services.
$IPTABLES -A INPUT -i $LAN -j ACCEPT

#On ouvre les ports 80 et 443 pour notre serveur web
$IPTABLES -A INPUT -p tcp -m tcp --dport 80 -j ACCEPT
$IPTABLES -A INPUT -p tcp -m tcp --dport 443 -j ACCEPT

#Tout ce qui ne MATCH pas avec les règles précédente > ON jette !
$IPTABLES -P INPUT DROP

#-------------------- FORWARD -------------------
#Ces règles s'appliquent au paquets traversant le routeur
# Par defaut, on refuse tout
$IPTABLES -P FORWARD DROP

}

firewall_stop() { #exécuté lors du routeur.sh stop

#Clear des différentes tables d'iptables et remise à zéro de la configuration.
$IPTABLES -F
$IPTABLES -t nat -F
$IPTABLES -P INPUT ACCEPT
$IPTABLES -P FORWARD ACCEPT
}

firewall_restart() { #exécuté lors du routeur.sh restart
firewall_stop
sleep 2
firewall_start
}

case $1 in 'start' )
firewall_start
;;
'stop' )
firewall_stop
;;
'restart' )
firewall_restart
;;
*)
echo "usage: -bash {start|stop|restart}"
;;
esac
{% endhighlight %}

### Exemple de mise en place d'un routeur

{% highlight bash %}
#!/bin/sh
IPTBLES-/sbin/iptables
WAN=eth0 #Nom de l'interface qui sera relié à internet
LAN=eth1 #Nom de l'interface qui sera reliée au réseau local

firewall_start() { #Exécuter lors du routeur.sh start
	
#-------------------- INPUT -------------------
#Ces règles s'appliquent aux paquets entrants

#Tout ce qui sort peut rentrer à nouveau 
$IPTABLES -A INPUT -i $WAN -m state --state ESTABLISHED,RELATED -j ACCEPT 

#On autorise le PING sur l'interface WAN (facultatif)
$IPTABLES -A INPUT -i $WAN -p icmp -j ACCEPT

#On laisse passer tout ce qui rentre dans l'interface lan afin de permettre à nos utilisateurs d'utiliser le DHCP, le DNS...etc.
#Mais on aurait aussi pu n'autoriser que certains services.
$IPTABLES -A INPUT -i $LAN -j ACCEPT

#Tout ce qui ne MATCH pas avec les règles précédente > ON jette !
$IPTABLES -P INPUT DROP


#-------------------- NAT -------------------
#Ces règles effectuent la réécriture d'adresses du NAT

#Tout ce qui a fini de traverser le routeur (postrouting) et qui sort par le WAN sera NATté
$IPTABLES -A POSTROUTING -t nat -o $WAN -j MASQUERADE

#Routage du port 80
#Tout se qui rentre sur le WAN (input donc) et qui rentre dans le TCP:80 sera rediriger vers 192.168.1.100:80 
$IPTABLES -A PREROUTING -t nat -j DNAT -i $WAN -p tcp --dport 80 --to-destination 192.168.1.100:80 



#-------------------- FORWARD -------------------
#Ces règles s'appliquent au paquets traversant le routeur

#Tout ce qui vient du WAN et sort par le LAN et qui correspond à une réponse est autorisé à passer.
$IPTABLES -A FORWARD -i $WAN -m state --state ESTABLISHED,RELATED -j ACCEPT

#Tout ce qui part du LAN est autorisé à traverser le routeur.
$IPTABLES -A FORWARD -i $LAN -j ACCEPT

#On autorise les paquets à traverser vers notre pc local uniquement pour le service. Cette règle est complémentaire de la règle NAT de routage du port 80
$IPTABLES -A FORWARD -i $WAN -p tcp --dport 80 -d 192.168.1.100 -j ACCEPT 


#Tout ce qui ne MATCH pas avec les règles précédente > ON jette !
$IPTABLES -P FORWARD DROP




}

firewall_stop() { #exécuté lors du routeur.sh stop

#Clear des différentes tables d'iptables et remise à zéro de la configuration.
$IPTABLES -F
$IPTABLES -t nat -F
$IPTABLES -P INPUT ACCEPT
$IPTABLES -P FORWARD ACCEPT
}

firewall_restart() { #exécuté lors du routeur.sh restart
firewall_stop
sleep 2
firewall_start
}

case $1 in 'start' )
firewall_start
;;
'stop' )
firewall_stop
;;
'restart' )
firewall_restart
;;
*)
echo "usage: -bash {start|stop|restart}"
;;
esac
{% endhighlight %}

 [1]: https://fr.wikipedia.org/wiki/Protocole_sans_état

