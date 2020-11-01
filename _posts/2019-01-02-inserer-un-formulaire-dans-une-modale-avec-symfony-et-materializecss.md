---
title: "Insérer un formulaire dans une modale avec Symfony et MaterializeCSS"
author: Benoit
date: 2019-01-02 09:07:30 +0100
categories: [developpement]
tags: [PHP, Symfony, Javascript]
math: true
image: /images/symfony_white_03.svg
---
Quand on débute le développement Web, une des choses assez difficile à comprendre est le fonctionnement des fenêtres modales. Cette question m'a été posé plusieurs fois, c'est pour cette raison que j'ai décidé de faire un article.

## Principe de fonctionnement

Principe de fonctionnement des fenêtres modales 
![fonctionnement modale](/images/modale.png)
la fenêtre modale est déjà intégrée dans la page Web mais n'est simplement pas encore affichée. Voici un exemple de code html avec materializecss :
{% highlight html %}
<!-- Bouton servant à activer la modale -->
<a class="waves-effect waves-light btn modal-trigger" href="#modal1">Modal</a>

<!-- Structure de la modale -->
<div id="modal1" class="modal">
<div class="modal-content">
<h4>Modal Header</h4>
A bunch of text

</div>
<div class="modal-footer"><a class="modal-close waves-effect waves-green btn-flat" href="#!">Agree</a></div>
</div>
{% endhighlight %}

On peut donc voir qu'une fenêtre modale est composée de deux parties: la structure et le lien permettant de l'activer.

Quand on clique sur le lien elle s'affiche mais est vide. Il faut donc à ce moment là effectuer un appel AJAX pour la remplir. (afficher le formulaire).

## Exemple avec Symfony


Dans cet exemple, nous avons une entité « compétition » et une entité « inscrit » . Il y a une relation one to many: 1 compétition peut avoir plusieurs inscrits.


Voici la vue twig:

Le lien d'activation:


{% highlight html %}
{% raw %}
  <a data-target="{{ path('competition-inscription', {'id': competition.id}) }}" data-tooltip="voir"
   class="tooltipped modal-trigger btn right-align"
   href="#modal1">inscription</a>
{% endraw %}
{% endhighlight %}


Et la modale correspondante:


{% highlight html %}
  <div id="modal1" class="modal">
    <div class="modal-content">


    </div>
    <div class="modal-footer">

    </div>
</div>
{% endhighlight %}


Quand on clique sur le bouton d’inscription, on appelle ce script javascript:


{% highlight javascript %}
  $(document).ready(function() {
//On écoute le "click" sur le bouton ayant la classe "modal-trigger"
$('.modal-trigger').click(function () {
//On initialise les modales materialize
        $('.modal').modal();
        //On récupère l'url depuis la propriété "Data-target" de la balise html a
        url = $(this).attr('data-target');
        //on fait un appel ajax vers l'action symfony qui nous renvoie la vue
        $.get(url, function (data) {
            //on injecte le html dans la modale
            $('.modal-content').html(data);
            //on ouvre la modale
            $('#modal1').modal('open');
        });
    })
});
{% endhighlight %}


Le contrôleur est donc appelé par un appel ajax. C'est la même action qui va servir à afficher le formulaire ou à traiter la soumission. Voici l’action du contrôleur:


{% highlight php %}
  /**
 * @Method({"GET", "POST"})
 * @Route("/competition/{id}/inscription", name="competition-inscription")
 * @param Request $request
 */
public function inscriptionAction(Competition $competition, Request $request)
{
    $inscrit = new Inscrit();
    $form = $this->createForm(InscritType::class, $inscrit);
    $form->handleRequest($request);
    if ($form->isSubmitted() && $form->isValid()) {
        $em = $this->getDoctrine()->getManager();
        $inscrit->setDateInscription(new \DateTime());
        $inscrit->setCompetition($competition);

        $em->persist($inscrit);
        $em->flush();
        $request->getSession()->getFlashbag()->add('success', 'Votre inscription a été enregistré.');
        return $this->redirectToRoute('competitions');
    }
    return $this->render(
        //On affiche  une vue twig simple (pas de head ni rien, donc aucun héritage de template...) qui sera intégrée dans la modale.
        'competitions/competitionModale.html.twig', array('form' => $form->createView(), 'competition' => $competition
        )
    );
}
{% endhighlight %}

La vue twig est une vue très simple qui ne doit hériter de rien:


{% highlight html %}
{% raw %}
  {{ competition.titre }}
    <!-- Il faut préciser l'action dans le formulaire -->
    {{ form_start(form, {'action': path('competition-inscription', { 'id': competition.id })}) }}
    {{ form_widget(form) }}
    {{ form_end(form) }}
{% endraw %}
{% endhighlight %}

Conclusion

Comme vous le voyez, il n'y a rien de très compliqué, l'important est de bien comprendre le principe d'appel ajax pour afficher le formulaire à l'intérieur de la modale. Cette action peu être un peu longue, je vous conseille d'utiliser une icône de chargement, d'assombrir la page etc&#8230; vous trouverez plein de ressources sur le web pour ça.
