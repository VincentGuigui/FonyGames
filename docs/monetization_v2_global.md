# FonyGames — rapport de recommandations sur la stratégie de monétisation

**Version :** 1.0  
**Date :** 3 septembre 2026  
**Horizon :** 12 mois  
**Contexte :** produit Web multijoueur ultra-casual, parties courtes, sans application ni compte, audience actuellement quasi nulle, développement assuré en solo quelques heures par semaine.

## 1. Résumé exécutif

FonyGames ne doit pas choisir immédiatement entre publicité, Party Pass et B2B. Ces modèles correspondent à des stades différents du produit.

La stratégie recommandée est :

1. **Conserver un accès gratuit et sans friction** pour créer les premiers usages.
2. **Chercher le premier revenu avec un événement pilote vendu manuellement.**
3. **Améliorer le parcours Party**, plutôt que multiplier les nouveaux jeux.
4. **Préparer l’interstitiel derrière un feature flag**, sans l’activer tant que le trafic est insuffisant.
5. **Tester AdSense H5 Games Ads** lorsque les seuils de trafic et de qualité sont franchis.
6. **Tester un Party Pass ponctuel** seulement lorsque des hôtes récurrents demandent des fonctions identifiables.
7. **Reporter les jeux sponsorisés, la licence technologique et la distribution multiportails** jusqu’à validation du produit et d’un canal commercial.

Le modèle économique cible est hybride :

> **B2B pour obtenir les premiers revenus sans audience ; produit gratuit pour croître ; publicité légère et Party Pass pour monétiser une audience devenue active.**

## 2. Recommandation globale

### Court terme : revenu par service

Vendre une expérience événementielle simple construite avec les jeux existants :

**FonyGames Party — pilote bêta à 149 €**

- 6 à 8 participants ;
- 30 à 45 minutes ;
- 3 jeux existants ;
- QR codes et déroulement préparés ;
- animation ou supervision du premier pilote ;
- aucune personnalisation technique ;
- aucune garantie de service avancée ;
- collecte structurée des retours.

Le client ne paie pas pour accéder à un site gratuit. Il paie pour une activité sélectionnée, préparée et sécurisée par l’organisateur.

### Moyen terme : revenu lié à l’usage

Lorsque FonyGames dispose d’un volume réel de sessions engagées :

- interstitiel collectif entre les manches ;
- jamais avant la première manche ;
- jamais plus d’une fois toutes les 7 minutes de jeu actif ;
- maximum deux coupures par session ;
- AdSense H5 Games Ads comme première régie ;
- test A/B obligatoire avant généralisation.

### Plus long terme : offres premium et B2B productisées

- Party Pass ponctuel pour l’hôte ;
- événements autonomes ou récurrents ;
- branding léger ;
- jeu sponsorisé sur mesure ;
- licence ou moteur seulement si la technologie est réellement réutilisée par plusieurs clients.

## 3. Positionnement économique

FonyGames n’est pas un simple portail de mini-jeux. Sa différence tient à la combinaison suivante :

- plusieurs personnes jouent ensemble ;
- chacune utilise son propre téléphone ;
- aucune application n’est installée ;
- aucun compte n’est créé ;
- la partie démarre depuis un lien ou un code ;
- les interactions tactiles et les capteurs des téléphones participent au jeu.

La promesse commerciale recommandée est :

> **Lancez une partie multijoueur instantanée avec les téléphones déjà présents dans la pièce.**

Cette promesse doit guider chaque décision de monétisation. Un modèle qui ralentit fortement le démarrage, exige un compte ou isole les joueurs sur leurs écrans détruit une partie de la valeur qu’il cherche à monétiser.

## 4. Diagnostic de la situation actuelle

### Atouts

- Produit accessible immédiatement depuis le Web.
- Invitation et code de room déjà au cœur du fonctionnement.
- Moment de synchronisation clair : tous les joueurs cliquent sur `Prêt`.
- Catalogue suffisamment fourni pour organiser plusieurs sessions sans créer immédiatement de nouveaux jeux.
- Coûts d’infrastructure encore faibles.
- Différenciation vis-à-vis des jeux HTML5 purement solo.

### Faiblesses

- Audience quasi nulle : aucun modèle publicitaire ne peut encore générer un revenu significatif.
- Absence de preuve de volonté de payer.
- Catalogue présenté jeu par jeu, alors que le besoin de l’hôte est d’organiser une Party.
- Mélange de jeux jouables et de jeux à venir, qui disperse l’attention.
- Aucune référence client B2B.
- Disponibilité limitée du fondateur pour la vente, le support et le développement.
- Questions de consentement et de confidentialité à résoudre avant toute publicité.

### Incertitudes critiques

1. Les groupes parviennent-ils à lancer une partie sans assistance ?
2. Après une première manche, souhaitent-ils continuer ?
3. Quels jeux provoquent réellement des revanches ?
4. Un organisateur accepte-t-il de payer pour une session préparée ?
5. Les événements génèrent-ils ensuite de nouveaux hôtes grand public ?
6. La publicité réduit-elle davantage l’engagement qu’elle ne crée de revenu ?

La stratégie doit produire des réponses à ces questions avant de financer des fonctionnalités plus ambitieuses.

## 5. Évaluation des modèles de monétisation

| Modèle | Potentiel | Délai avant revenu | Effort | Dépendance au trafic | Priorité |
|---|---:|---:|---:|---:|---:|
| Événement pilote manuel | Moyen | Court | Faible à moyen | Faible | **1** |
| Interstitiels H5 | Moyen à grande échelle | Moyen | Moyen à élevé | Très forte | **2 après seuils** |
| Party Pass ponctuel | Moyen | Moyen | Moyen à élevé | Forte | **3 après validation** |
| Offre B2B standardisée | Élevé | Moyen | Élevé | Faible | **3 après 3 pilotes** |
| Sponsor direct | Moyen | Moyen | Commercial | Moyenne | **4** |
| Jeu sponsorisé sur mesure | Élevé par contrat | Long | Très élevé | Faible | **5** |
| Jeu solo sur portail | Incertain | Long | Élevé | Dépend du portail | **5** |
| Pourboire | Très faible | Court | Très faible | Forte | Optionnel |
| Abonnement individuel | Faible au départ | Long | Très élevé | Forte | À écarter |
| Boutique cosmétique | Faible au départ | Long | Très élevé | Très forte | À écarter |
| Licence FonyGames Engine | Potentiellement élevé | Très long | Très élevé | Faible | À reporter |

## 6. Axe 1 — premier revenu avec FonyGames Party

### Cible initiale

Ne pas viser simultanément entreprises, bars, mariages, festivals et agences. Choisir un seul segment accessible par le réseau personnel du fondateur.

À défaut d’information supplémentaire, la cible de départ recommandée est :

> **Petites équipes, associations ou groupes éducatifs de 6 à 8 personnes recherchant une animation de 30 à 45 minutes.**

Le petit effectif limite les risques de charge, de compatibilité et d’animation.

### Offre expérimentale

| Élément | Engagement ferme |
|---|---|
| Prix | 149 € pour le premier format bêta |
| Participants | 6 à 8 maximum |
| Durée | 30 à 45 minutes |
| Contenu | 3 jeux existants |
| Personnalisation | Aucune |
| Support | Présence ou supervision du fondateur pour le premier pilote |
| Livrables | QR codes, déroulement, consignes, questionnaire final |
| Développement client | Aucun |

Le prix est une hypothèse de validation, pas un tarif définitif. Il doit être réévalué après trois événements à partir du nombre d’heures réellement consommées.

### Objectif à 60 jours

- 15 contacts qualifiés ;
- 5 conversations ou démonstrations ;
- 2 propositions concrètes ;
- 1 événement payé.

### Critère d’arrêt

Après 40 prospects qualifiés ou 8 démonstrations, si personne n’accepte de payer au moins 149 € pour une session utilisant les jeux existants, suspendre la piste B2B.

Ne pas répondre automatiquement par du développement ou de la personnalisation.

## 7. Axe 2 — renforcer le produit Party

La croissance dépend moins du nombre de jeux que de la qualité du parcours collectif.

### Priorités produit

1. Réduire le délai entre ouverture du lien et première manche.
2. Sélectionner 3 à 5 jeux principaux plutôt que présenter tout le catalogue au même niveau.
3. Faciliter le partage par lien et QR code.
4. Permettre d’enchaîner plusieurs jeux sans recréer entièrement le groupe.
5. Proposer quelques playlists prédéfinies.
6. Ajouter un classement global seulement si les utilisateurs le demandent.

### MVP Party recommandé

- bouton `Lancer une Party` ;
- playlists `Duel`, `Ambiance` et `Mouvement` ;
- 3 jeux par playlist ;
- lien et QR code uniques ;
- continuité de la room ;
- aucun compte ;
- aucune boutique ;
- aucune personnalisation complexe.

### Ce qui ne doit pas être développé maintenant

- éditeur de tournoi complet ;
- matchmaking public ;
- profils permanents ;
- monnaie virtuelle ;
- progression persistante ;
- nouveau jeu sans hypothèse précise ;
- tableau de bord B2B avancé.

## 8. Axe 3 — publicité interstitielle

### Format retenu

Le seul placement publicitaire recommandé sur le produit principal est :

> **Un interstitiel collectif sur les téléphones éligibles, après que tous les joueurs ont cliqué sur Prêt et avant le compte à rebours d’une manche ultérieure.**

La rewarded ad obligatoire est écartée : elle doit normalement rester volontaire et associée à une récompense non essentielle.

### Seuils fermes de fonctionnement

| Paramètre | Valeur |
|---|---:|
| Manches gratuites avant la première publicité | 3 |
| Temps de jeu actif avant la première publicité | 7 minutes |
| Cooldown par room | 7 minutes de jeu actif |
| Cooldown par téléphone | 7 minutes réelles |
| Publicités maximum par session | 2 |
| Délai de grâce après déconnexion | 5 secondes |
| Timeout maximum de la barrière | 60 secondes |
| Compte à rebours après résolution | 3 secondes |

Le fonctionnement technique complet est défini dans `FonyGames_Spec_Interstitiel_2026.md`.

### Seuil d’activation du test publicitaire

L’interstitiel reste désactivé tant que toutes les conditions suivantes ne sont pas satisfaites :

| Gate | Seuil obligatoire |
|---|---:|
| Rooms terminées sur 30 jours | ≥ 1 000 |
| Requêtes individuelles potentiellement éligibles sur 30 jours | ≥ 5 000 |
| Rooms lançant une première manche | ≥ 80 % |
| Rooms lançant une quatrième manche | ≥ 25 % |
| Erreurs bloquantes de synchronisation | < 1 % |
| CMP et politique de confidentialité | validées |
| Compte publicitaire | approuvé |

Ces seuils autorisent un test, pas une généralisation.

### Test A/B obligatoire

- 50 % des rooms éligibles sans publicité ;
- 50 % avec interstitiel ;
- durée minimale de 30 jours ;
- au moins 500 rooms par groupe.

La publicité est maintenue seulement si :

- la baisse relative du lancement de la manche suivante est inférieure ou égale à 5 % ;
- la baisse relative du nombre de manches par session est inférieure ou égale à 5 % ;
- l’abandon pendant la barrière reste inférieur ou égal à 5 % ;
- la durée médiane de la barrière reste inférieure ou égale à 20 secondes ;
- le 95e percentile reste inférieur ou égal à 45 secondes ;
- moins de 1 % des barrières atteignent le timeout de 60 secondes ;
- le fill rate atteint au moins 50 % ;
- le revenu atteint au moins 20 € pour 1 000 opportunités de room.

### Économie indicative

Hypothèse purement illustrative : cinq joueurs, 80 % de fill rate et eCPM de 10 €.

| Rooms exposées | Impressions estimées | Revenu indicatif |
|---:|---:|---:|
| 1 000 | 4 000 | 40 € |
| 10 000 | 40 000 | 400 € |
| 50 000 | 200 000 | 2 000 € |

La publicité ne peut donc devenir un revenu significatif qu’avec plusieurs milliers de rooms engagées.

## 9. Recommandation sur la régie publicitaire

### Premier choix : Google AdSense H5 Games Ads

AdSense H5 Games Ads est recommandé comme première régie, sous réserve d’acceptation :

- API conçue pour les jeux HTML5 ;
- formats interstitiel et rewarded ;
- placement `next` adapté au passage vers une nouvelle manche ;
- callback final même lorsqu’aucune annonce n’est affichée ;
- statuts de timeout, no-fill et frequency cap documentés ;
- intégration possible avec une CMP certifiée.

Le produit est toutefois accessible sur candidature. Un compte AdSense approuvé est nécessaire et l’acceptation H5 n’est pas garantie.

### Architecture obligatoire

L’implémentation doit passer par une interface `AdProvider` indépendante. Le moteur des rooms ne doit pas appeler directement les fonctions Google.

Cela permet :

- de tester sans publicité réelle ;
- de désactiver immédiatement le fournisseur ;
- de changer de régie ultérieurement ;
- d’éviter qu’un incident publicitaire bloque le jeu.

### Concurrents

| Régie | Situation | Recommandation |
|---|---|---|
| AppLixir | SDK HTML5 et rewarded video ; exige au moins 5 000 impressions quotidiennes ou utilisateurs actifs selon sa FAQ | Candidater seulement après 5 000 opportunités/jour |
| AdinPlay / Venatus | Interstitiel, rewarded, vidéo et accompagnement commercial ; conditions publiques limitées | Demander une offre à partir de 100 000 sessions-joueurs/mois |
| Playwire | Solution gérée pour sites à fort trafic ; recommande environ 100 000 pages vues et valorise une part significative de trafic américain | Non pertinent actuellement |
| Portails de jeux | Publicité intégrée à leur environnement | Les traiter comme distribution, pas comme régie du site principal |

### Décision en cas de refus par Google

Ne pas intégrer immédiatement une solution moins adaptée.

- conserver la publicité désactivée ;
- continuer le mode fantôme ;
- mesurer les opportunités ;
- attendre les seuils d’AppLixir ou d’AdinPlay ;
- recandidater après croissance du trafic.

## 10. Axe 4 — Party Pass

### Rôle

Le Party Pass peut monétiser l’hôte sans faire payer les invités.

Hypothèse de produit :

**Party Pass — 4,99 € pour 24 heures**

- aucune publicité dans la room ;
- playlist personnalisée ;
- nom de room ;
- QR code dédié ;
- continuité entre les jeux ;
- classement final ;
- aucun compte requis ;
- droit temporaire lié à un code ou jeton signé.

### Gate de développement

Ne pas construire le Party Pass tant que toutes les conditions suivantes ne sont pas atteintes :

| Condition | Seuil |
|---|---:|
| Rooms terminées par mois | ≥ 2 000 |
| Rooms comportant au moins 4 joueurs | ≥ 30 % |
| Hôtes revenant sous 60 jours | ≥ 15 % |
| Hôtes qualifiés demandant une même fonction premium | ≥ 20 |
| Précommandes ou engagements payants | ≥ 20 |

Les déclarations d’intention seules ne suffisent pas. La meilleure validation est une précommande remboursable ou une bêta réellement achetée et livrable.

### Pourquoi 4,99 €

Le paiement reste ponctuel et cohérent avec une soirée occasionnelle. Le coût fixe des paiements par carte pénalise fortement un prix de 0,99 € ou 1,99 €. Stripe publie notamment un tarif standard de 1,5 % + 0,25 € pour les cartes standard de l’EEE, avant les autres coûts éventuels.

## 11. Axe 5 — B2B standardisé et sponsoring

### Productisation B2B

Après trois pilotes payés et réussis :

| Offre | Hypothèse de prix | Contenu |
|---|---:|---|
| Party autonome | 290 € | Playlist, QR code, guide, date dédiée |
| Event accompagné | 490 à 790 € | Préparation, briefing et assistance définie |
| Branded | à partir de 1 500 € | Branding ou adaptation légère, sans nouveau moteur |

Ces prix doivent être corrigés par le temps passé et les entretiens commerciaux.

### Gate de productisation

- 3 événements payés ;
- moins de 3 heures de préparation pour l’offre standard ;
- aucun incident bloquant sur les 2 derniers événements ;
- au moins un rachat ou une recommandation qualifiée ;
- revenu brut par heure supérieur ou égal à 75 € avant les charges du fondateur.

### Sponsor direct

Un sponsor statique servi depuis FonyGames peut être testé avant un réseau programmatique complexe si :

- au moins 20 000 sessions-joueurs sont enregistrées chaque mois ; ou
- au moins 5 événements sont vendus chaque mois à une audience identifiable.

Le sponsor achète alors un contexte et une audience démontrables. Sans cela, le temps commercial coûtera probablement plus que le revenu obtenu.

### Jeu sponsorisé

N’accepter un jeu sur mesure qu’après :

- 3 références B2B ;
- un périmètre réutilisant au moins 80 % de composants existants ;
- un acompte de 50 % ;
- un prix couvrant les heures de conception, développement, test et support ;
- une marge de sécurité de 30 % sur l’estimation du temps.

## 12. Distribution sur les portails

Les portails peuvent apporter une audience et un revenu à un jeu autonome, mais ils ne constituent pas nécessairement un canal d’acquisition vers FonyGames.

### Recommandation

- ne pas adapter tout le catalogue ;
- choisir un seul jeu solo ;
- plafonner le premier test à 20 heures ;
- commencer par un seul portail ;
- traiter cette version comme un produit distinct ;
- arrêter si l’intégration nécessite une reconstruction du backend multijoueur.

`100 Taps` ou `Squash Mosquitoes` sont les candidats les plus naturels à une boucle solo courte.

### Gate

Le test portail ne commence qu’après :

- 3 événements pilotes livrés ;
- parcours Party stable ;
- disponibilité réelle d’un budget de 20 heures ;
- absence de chantier de fiabilité prioritaire.

## 13. Plan d’action sur 90 jours

### Jours 1 à 14 — preuve produit

- organiser 10 sessions réelles ;
- utiliser au moins 2 téléphones par session ;
- mesurer le délai d’entrée ;
- retenir 3 jeux principaux ;
- corriger uniquement les incidents bloquants ;
- préparer les compteurs nécessaires au mode publicitaire fantôme.

Critères de sortie :

- 80 % des groupes lancent sans assistance technique individuelle ;
- délai médian avant la première manche inférieur à 2 minutes ;
- taux de fin de manche supérieur ou égal à 95 % ;
- au moins 25 % des groupes lancent une quatrième manche.

### Jours 15 à 30 — offre pilote

- produire une vidéo de démonstration de 20 à 30 secondes ;
- préparer trois QR codes ou une playlist manuelle ;
- rédiger une fiche d’une page ;
- fixer le prix à 149 € ;
- identifier 15 contacts qualifiés.

### Jours 31 à 60 — vente

- effectuer les 15 prises de contact ;
- réaliser jusqu’à 5 démonstrations ;
- envoyer 2 propositions concrètes ;
- obtenir 1 événement payé.

### Jours 61 à 90 — livraison et décision

- livrer le pilote ;
- mesurer préparation, assistance et incidents ;
- recueillir la satisfaction de l’organisateur ;
- proposer une deuxième date ou demander une recommandation ;
- décider de répéter, modifier ou abandonner l’offre.

### Répartition du temps

| Activité | Part hebdomadaire |
|---|---:|
| Fiabilité et parcours Party | 40 % |
| Prospection et démonstrations | 30 % |
| Tests et livraison | 20 % |
| Mesure et administration | 10 % |

Pendant ces 90 jours, ne pas créer de nouveau jeu sauf nécessité directe pour corriger une session vendue.

## 14. Roadmap sur douze mois

| Période | Priorité | Livrable | Gate |
|---|---|---|---|
| Mois 1 | Validation terrain | 10 sessions, top 3 jeux | Activation ≥ 80 % |
| Mois 2 | Vente pilote | Offre à 149 €, 15 contacts | 1 réservation payée |
| Mois 3 | Livraison | Premier événement et bilan | Satisfaction ≥ 8/10 |
| Mois 4–5 | Répétition | Deux autres pilotes | 3 événements payés |
| Mois 5–6 | Parcours Party | Playlist, QR, continuité | 4e manche ≥ 25 % |
| Mois 6–8 | Offre B2B standard | Prix et processus stabilisés | ≥ 75 €/h brut |
| Mois 7–10 | Mode publicité fantôme | Mesure sans annonce | 1 000 rooms et 5 000 opportunités |
| Mois 9–12 | A/B test AdSense | Interstitiel conditionnel | Tous les seuils UX respectés |
| Mois 10–12 | Test Party Pass | Précommandes | 20 engagements payants |

Les dates ne débloquent jamais seules une fonctionnalité. Si un gate n’est pas atteint, l’étape reste en attente.

## 15. KPI

### North star

**Sessions collectives terminées par mois**

Définition : room ayant accueilli au moins deux appareils distincts et terminé au moins une manche.

### Produit

| KPI | Cible initiale |
|---|---:|
| Room créée → deuxième joueur sous 3 minutes | ≥ 70 % |
| Room avec 2 joueurs → première manche | ≥ 80 % |
| Manches lancées → manches terminées | ≥ 95 % |
| Rooms lançant une quatrième manche | ≥ 25 % |
| Erreurs bloquantes | < 1 % |
| Délai médian avant première manche | < 2 minutes |

### Publicité

| KPI | Seuil |
|---|---:|
| Fill rate | ≥ 50 % |
| Abandon pendant la coupure | ≤ 5 % |
| P50 de barrière | ≤ 20 secondes |
| P95 de barrière | ≤ 45 secondes |
| Timeout à 60 secondes | < 1 % |
| Perte relative de manches/session | ≤ 5 % |
| Revenu pour 1 000 opportunités de room | ≥ 20 € |

### Commercial

| KPI | Cible |
|---|---:|
| Contacts → conversation | ≥ 25 % |
| Conversation → proposition | ≥ 40 % |
| Proposition → vente | ≥ 25 % |
| Événements payés à 6 mois | ≥ 3 |
| Satisfaction organisateur | ≥ 8/10 |
| Temps de préparation standard | < 3 heures |
| Revenu brut par heure après productisation | ≥ 75 € |

## 16. Scénarios financiers indicatifs

Ces scénarios ne sont pas des prévisions. Ils excluent fiscalité, charges, remboursements, coûts de support et valorisation du temps du fondateur.

| Scénario année 1 | Hypothèses | Chiffre d’affaires brut |
|---|---|---:|
| Validation minimale | 3 pilotes à 149 € | 447 € |
| Central | 3 pilotes à 149 €, 4 événements à 390 €, 1 branded à 790 €, 100 Party Pass à 4,99 € | 3 296 € |
| Traction forte | 3 pilotes à 149 €, 8 événements à 390 €, 3 branded à 790 €, 300 Party Pass à 4,99 € | 7 434 € |

Les revenus publicitaires restent hors scénario central. Ils doivent être ajoutés uniquement après observation réelle du fill rate, de l’eCPM et de l’impact sur la rétention.

Le succès de la première année n’est pas un salaire complet. C’est :

> **Un premier revenu, un canal répétable et la preuve qu’une partie du produit peut être monétisée sans casser l’expérience.**

## 17. Principaux risques et réponses

| Risque | Réponse |
|---|---|
| Publicité sur tous les téléphones désynchronisée | Barrière serveur, timeout, roster figé, compte à rebours commun |
| Publicité avant que le produit ait démontré sa valeur | Trois manches et sept minutes gratuites |
| Revenu publicitaire trop faible | Gate de trafic et seuil de revenu par opportunité |
| Dépendance à Google | Interface `AdProvider`, feature flag, aucun couplage avec les rooms |
| Consentement dégradant l’entrée | Aucune requête sans consentement valide ; test UX avant activation |
| B2B trop chronophage | Limite de participants, aucun sur-mesure, mesure du revenu horaire |
| Prix trop faible | Révision après trois pilotes |
| Dispersion du fondateur | Un seul segment, trois jeux, une régie, un portail maximum |
| Événements non reproductibles | Critère de rachat ou recommandation avant productisation |
| Confusion activité rentable / trésorerie positive | Valoriser toutes les heures de travail |

## 18. Décisions à conserver

### À faire maintenant

- fiabiliser les trois meilleurs jeux ;
- mesurer les sessions collectives ;
- préparer l’offre événementielle à 149 € ;
- prospecter un segment unique ;
- préparer la couche publicitaire abstraite et le mode fantôme si le coût reste faible ;
- candidater à AdSense H5 Games Ads, sans présumer de l’acceptation.

### À faire après les premiers revenus

- améliorer le parcours Party ;
- répéter l’offre B2B ;
- augmenter le prix ;
- mesurer les opportunités publicitaires ;
- exécuter le test A/B lorsque les seuils sont atteints.

### À reporter

- abonnement ;
- comptes utilisateurs ;
- boutique ;
- publicité avant la première manche ;
- rewarded ad obligatoire ;
- plusieurs régies publicitaires simultanées ;
- adaptation de plusieurs jeux aux portails ;
- jeu sponsorisé sans acompte ;
- licence technologique.

## 19. Conclusion

La monétisation de FonyGames ne doit pas commencer par l’installation d’une régie. Elle doit commencer par la preuve que l’expérience collective a une valeur.

Le chemin recommandé est :

```text
Sessions gratuites fiables
        ↓
Premier événement payé
        ↓
Parcours Party amélioré
        ↓
Répétition B2B et croissance
        ↓
Test contrôlé des interstitiels
        ↓
Party Pass et offres productisées
```

La recommandation finale est donc :

> **Vendre manuellement une Party à court terme, conserver le produit gratuit pour apprendre et croître, puis activer une monétisation publicitaire strictement mesurée lorsque le trafic justifie réellement son coût.**

## 20. Sources et documents associés

### Documents FonyGames

- `FonyGames_Spec_Interstitiel_2026.md`
- `FonyGames_Strategie_Monetisation_2026.md`
- `monetization(1).md`

### Sources officielles

- [Google — inscription à AdSense H5 Games Ads](https://support.google.com/adsense/answer/1705831?hl=en)
- [Google — H5 Games Ads](https://support.google.com/adsense/answer/9959170?hl=en)
- [Google Developers — API `adBreak()`](https://developers.google.com/ad-placement/apis/adbreak)
- [Google — règles des publicités avec récompense](https://support.google.com/adsense/answer/9121589?hl=en-EN)
- [Google — exigences de consentement pour l’EEE, le Royaume-Uni et la Suisse](https://support.google.com/adsense/answer/13554116?hl=en)
- [CNIL — recommandation cookies consolidée, janvier 2026](https://www.cnil.fr/sites/default/files/2026-01/recommandation_cookies_consolidee.pdf)
- [AppLixir — FAQ éditeurs](https://support.applixir.com/frequently-asked-questions)
- [AdinPlay — solutions éditeurs](https://adinplay.com/publishers)
- [Playwire — critères de qualification](https://www.playwire.com/qualification-criteria)
- [CrazyGames — exigences générales](https://docs.crazygames.com/requirements/intro/)
- [CrazyGames — exigences multijoueur](https://docs.crazygames.com/requirements/multiplayer/)
- [Poki — exigences de publication](https://developers.poki.com/guide/requirements-quality)
- [Stripe France — tarifs](https://stripe.com/fr/pricing)

Les chiffres de revenu sont des hypothèses de travail. Les questions fiscales, contractuelles et de protection des données doivent être validées en fonction de l’implémentation et du statut réel de l’activité.
