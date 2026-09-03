# FonyGames — spécification d’implémentation des interstitiels

**Version :** 1.0  
**Date :** 3 septembre 2026  
**Décision :** interstitiel collectif entre les manches ; aucune rewarded ad obligatoire.

## 1. Décision produit

FonyGames peut afficher une publicité sur chaque téléphone pendant que la room est arrêtée entre deux manches. L’emplacement retenu est le moment où tous les joueurs ont cliqué sur **Prêt**, immédiatement avant le compte à rebours commun.

La publicité ne doit toutefois jamais apparaître avant la première manche. Elle devient éligible seulement après plusieurs manches et sept minutes de jeu actif.

### Règles non négociables

1. **Aucune publicité avant la première manche.**
2. **Au moins 3 manches terminées avant la première publicité.**
3. **Au moins 7 minutes de jeu actif avant la première publicité.**
4. **Au maximum une opportunité publicitaire toutes les 7 minutes de jeu actif.**
5. **Au maximum 2 opportunités publicitaires par session de room.**
6. **L’absence de publicité, le refus de consentement, un bloqueur ou une erreur ne bloquent jamais la room.**
7. **Le début de la manche reste synchronisé par le serveur.**
8. **Le format utilisé est un interstitiel, pas une rewarded ad.**

## 2. Valeurs de configuration fermes

```ts
export const AD_POLICY = {
  enabled: false,

  // Éligibilité produit
  minCompletedRounds: 3,
  firstBreakActivePlayMs: 7 * 60 * 1000,
  roomCooldownActivePlayMs: 7 * 60 * 1000,
  deviceCooldownWallClockMs: 7 * 60 * 1000,
  maxBreaksPerRoomSession: 2,

  // Synchronisation
  disconnectGraceMs: 5_000,
  barrierHardTimeoutMs: 60_000,
  countdownMs: 3_000,

  // Préparation
  preloadLeadMs: 30_000,
  sessionIdleResetMs: 30 * 60 * 1000,

  // Déploiement
  productionGateCompletedRooms30d: 1_000,
  productionGateEligiblePlayerRequests30d: 5_000,
  experimentTrafficPercent: 50,
} as const;
```

Ces valeurs constituent la politique de départ. Elles ne doivent pas être modifiées automatiquement par la régie publicitaire.

## 3. Définitions

### Temps de jeu actif

`activePlayMs` est incrémenté uniquement lorsque la room est dans l’état `PLAYING`.

Il exclut :

- le lobby ;
- l’explication des règles ;
- l’écran de résultat ;
- le temps d’attente des joueurs ;
- la publicité ;
- le compte à rebours.

### Session de room

Une session commence lors du lancement de la première manche et se termine lorsque :

- la room est détruite ;
- tous les joueurs sont partis ;
- aucune activité n’a eu lieu pendant 30 minutes.

Changer de jeu sans quitter la Party ne réinitialise ni le cooldown ni le nombre de publicités.

### Opportunité publicitaire

Une opportunité est consommée dès que le serveur déclenche `AD_BREAK_START`, même si aucune publicité n’est finalement affichée.

Cette règle évite de solliciter la régie à chaque manche lorsque l’inventaire est indisponible.

## 4. Condition exacte d’éligibilité

Une room est éligible si toutes les conditions suivantes sont vraies :

```ts
function isRoomAdEligible(room: Room): boolean {
  return AD_POLICY.enabled
    && room.completedRounds >= 3
    && room.activePlayMs >= 420_000
    && room.activePlayMs - room.activePlayMsAtLastAdBreak >= 420_000
    && room.adBreakCount < 2
    && room.connectedReadyPlayers >= room.game.minPlayers
    && room.state === "ALL_READY";
}
```

Pour la première publicité, `activePlayMsAtLastAdBreak` vaut `0`.

L’éligibilité est décidée par le serveur. Aucun téléphone ne peut déclencher seul un ad break.

## 5. Machine d’état

```text
LOBBY
  → ALL_READY
  → AD_ELIGIBILITY_CHECK
      → non éligible → COUNTDOWN
      → éligible     → AD_BARRIER
                          → AD_RESOLVED
                          → COUNTDOWN
  → PLAYING
  → RESULTS
  → LOBBY
```

### Déroulement détaillé

1. Tous les joueurs connectés cliquent sur `Prêt`.
2. Le serveur fige la liste des joueurs prêts dans `barrierRoster`.
3. Le serveur vérifie l’éligibilité de la room.
4. Si la room n’est pas éligible, il programme immédiatement le compte à rebours.
5. Si elle est éligible, il crée un `adBreakId` unique et passe à `AD_BARRIER`.
6. Chaque téléphone évalue localement son droit à demander une publicité.
7. Chaque téléphone renvoie obligatoirement un événement `AD_RESOLVED`.
8. Le serveur attend tous les membres du roster ou l’expiration du délai de 60 secondes.
9. Les joueurs non résolus après 60 secondes sont retirés de la manche, mais pas bannis de la room.
10. Si le nombre de joueurs restants est suffisant, le serveur envoie un `startAt` commun égal à `serverNow + 3 000 ms`.
11. Sinon, la room revient au lobby.

## 6. Éligibilité individuelle

Même lorsque la room déclenche un ad break, certains téléphones ne doivent pas contacter la régie.

```ts
function isPlayerAdEligible(player: Player): boolean {
  return player.consentStatus === "granted"
    && player.isAdSdkReady
    && !player.isKnownChildDirectedUser
    && Date.now() - player.lastAdStartedAt >= 420_000
    && player.pageIsVisible;
}
```

Si cette fonction retourne `false`, le client envoie immédiatement :

```json
{
  "type": "AD_RESOLVED",
  "status": "not_eligible"
}
```

Le joueur voit alors l’écran neutre :

> Les autres joueurs arrivent…

Il ne doit pas voir un message culpabilisant relatif au consentement ou au bloqueur de publicité.

## 7. Intégration côté client

### Interface indépendante de la régie

```ts
type AdResultStatus =
  | "viewed"
  | "dismissed"
  | "not_ready"
  | "no_fill"
  | "frequency_capped"
  | "consent_denied"
  | "provider_timeout"
  | "provider_error"
  | "not_eligible";

interface AdResult {
  status: AdResultStatus;
  provider: "adsense" | "applixir" | "adinplay" | "none";
  durationMs: number;
  providerBreakStatus?: string;
}

interface AdProvider {
  initialize(): Promise<void>;
  prepare(): Promise<boolean>;
  showInterstitial(context: {
    adBreakId: string;
    placement: "between_rounds_7m";
  }): Promise<AdResult>;
}
```

Le code de room ne doit jamais dépendre directement de `adBreak()` ou d’un SDK particulier.

### Adaptateur Google recommandé

Pour Google H5 Games Ads :

- utiliser `type: "next"` ;
- utiliser `name: "between_rounds_7m"` ;
- couper immédiatement le son du jeu dans `beforeAd` ;
- ne jamais lancer la manche dans `afterAd` ;
- résoudre la promesse uniquement dans `adBreakDone` ;
- conserver le `breakStatus` fourni par Google.

Google documente notamment les statuts `notReady`, `timeout`, `error`, `noAdPreloaded`, `frequencyCapped`, `dismissed` et `viewed`. Le callback `adBreakDone` est appelé même lorsqu’aucune publicité n’est affichée.

### Règle de timeout

Le client ne force jamais la fermeture d’une publicité commencée.

Si le serveur atteint 60 secondes sans `AD_RESOLVED` :

- le joueur non résolu est retiré du roster de la prochaine manche ;
- la partie commence sans lui si le minimum de joueurs reste atteint ;
- lorsque sa publicité ou son SDK se termine, il revient au lobby ou devient spectateur jusqu’à la manche suivante ;
- une publicité tardive ne doit jamais provoquer un second démarrage.

## 8. Gestion des joueurs et du roster

La liste des joueurs concernés est figée au début de `AD_BARRIER`.

- Un joueur rejoignant pendant la publicité reste au lobby jusqu’à la manche suivante.
- Un joueur qui se déconnecte bénéficie d’un délai de grâce de 5 secondes.
- Après 5 secondes, il est marqué `disconnected` et considéré comme résolu.
- Un joueur revenant après le début du compte à rebours attend la manche suivante.
- Aucun nouveau joueur n’allonge la barrière en cours.

## 9. Interface utilisateur

### Avant le clic Prêt

Si la room est éligible, afficher au-dessus du bouton :

> Une courte publicité peut apparaître avant cette manche.

Ne pas annoncer une durée de 10 ou 15 secondes : la durée réelle dépend de l’inventaire publicitaire.

### Pendant la coupure

- joueur avec publicité : écran géré par la régie ;
- joueur sans publicité ou déjà terminé : `Les autres joueurs arrivent…` ;
- afficher les avatars ou le nombre de joueurs encore en préparation ;
- ne pas afficher de compte à rebours tant que la barrière n’est pas résolue.

### Après la coupure

Tous les joueurs reçoivent le même compte à rebours de 3 secondes fondé sur une heure serveur commune.

## 10. Consentement et confidentialité

Avant tout chargement ou appel publicitaire dans l’EEE, le Royaume-Uni ou la Suisse :

- utiliser une CMP certifiée compatible avec les exigences de la régie ;
- obtenir un état de consentement exploitable avant l’appel publicitaire ;
- ne demander aucune publicité si le consentement est refusé ou indéterminé dans l’implémentation initiale ;
- ne jamais attendre la réponse de la CMP dans `AD_BARRIER` ;
- documenter les fournisseurs, finalités, durées et moyens de retrait ;
- mettre à jour la politique de confidentialité et la règle interne relative aux scripts tiers.

Pour les 90 premiers jours, utiliser uniquement des annonces non personnalisées après consentement. Ne pas activer la personnalisation avant revue juridique et analyse de son gain réel.

Si FonyGames est considéré comme destiné aux enfants ou collecte un âge, suspendre le déploiement publicitaire jusqu’à une revue spécifique.

## 11. Événements de mesure

### Serveur

```text
ad_room_eligible
ad_break_started
ad_barrier_completed
ad_barrier_timeout
ad_player_excluded
round_started_after_ad
round_abandoned_after_ad
```

### Client

```text
ad_request_sent
ad_display_started
ad_display_finished
ad_display_skipped
ad_no_fill
ad_frequency_capped
ad_provider_error
ad_consent_denied
ad_waiting_screen_shown
```

Chaque événement contient au minimum :

- `adBreakId` ;
- identifiant éphémère de room ;
- identifiant éphémère de connexion ;
- nombre de joueurs ;
- numéro de manche ;
- temps de jeu actif ;
- fournisseur ;
- statut ;
- durée.

Aucune donnée de capteur, position, caméra ou contenu du jeu ne doit être transmise à la régie.

## 12. Gate ferme d’activation en production

Le code peut être intégré derrière un feature flag, mais `enabled` reste `false` tant que toutes les conditions suivantes ne sont pas atteintes :

| Condition | Seuil obligatoire |
|---|---:|
| Rooms terminées sur 30 jours glissants | ≥ 1 000 |
| Requêtes publicitaires individuelles théoriquement éligibles sur 30 jours | ≥ 5 000 |
| Taux de rooms lançant au moins une première manche | ≥ 80 % |
| Taux de rooms lançant une quatrième manche | ≥ 25 % |
| Erreurs bloquantes de synchronisation | < 1 % |
| CMP et politique de confidentialité | validées avant activation |
| Compte/régie | approuvé pour la production |

Sous ces seuils, le revenu attendu ne justifie ni la friction ni la maintenance.

## 13. Protocole A/B ferme

### Phase 0 — mode fantôme

Pendant au moins 14 jours et jusqu’à obtenir 500 opportunités de room :

- calculer l’éligibilité ;
- enregistrer `ad_room_eligible` ;
- ne demander aucune publicité.

### Phase 1 — test contrôlé

Répartir de façon stable les rooms éligibles :

- 50 % contrôle sans publicité ;
- 50 % interstitiel collectif.

Le test dure au minimum 30 jours et jusqu’à obtenir :

- 500 rooms exposées ;
- 500 rooms contrôle.

### Critères obligatoires pour continuer

| KPI | Seuil de validation |
|---|---:|
| Baisse relative du lancement de la manche suivante | ≤ 5 % |
| Baisse relative du nombre de manches par session | ≤ 5 % |
| Abandon pendant la barrière | ≤ 5 % |
| Durée médiane de la barrière | ≤ 20 s |
| Durée au 95e percentile | ≤ 45 s |
| Barrières expirant à 60 s | < 1 % |
| Erreurs techniques fournisseur | < 1 % |
| Fill rate | ≥ 50 % |
| Revenu observé pour 1 000 opportunités de room | ≥ 20 € |

Si un seul des quatre premiers critères d’expérience échoue, remettre immédiatement `enabled` à `false`.

Si seuls le fill rate ou le revenu échouent, terminer les 30 jours puis désactiver la monétisation ou changer de partenaire.

### Critères d’arrêt immédiat

- publicité apparaissant après le début d’une manche ;
- double publicité sur un même téléphone pour un seul `adBreakId` ;
- room bloquée sans sortie automatique ;
- données de capteur ou de position transmises à un tiers ;
- hausse absolue du taux d’erreur de manche supérieure ou égale à 1 point ;
- non-conformité signalée par la régie ou la CMP.

## 14. Choix de la plateforme publicitaire

### Recommandation ferme

> **Choisir Google AdSense H5 Games Ads comme premier fournisseur, avec un adaptateur indépendant et sans médiation multi-régies.**

Cette recommandation est conditionnée à l’approbation du compte et du site par Google. H5 Games Ads est un produit sur candidature ; un compte AdSense approuvé est requis et l’acceptation n’est pas garantie.

### Comparaison

| Solution | Formats utiles | Accès actuel | Avantages | Limites | Décision |
|---|---|---|---|---|---|
| Google AdSense H5 Games Ads | Interstitiel, rewarded | Sur candidature, compte AdSense approuvé | API H5 dédiée, callback final même sans annonce, statuts documentés, CMP Google/certifiée | Approbation non garantie, contrôle limité de la durée, conformité Google stricte | **Premier choix** |
| AppLixir | Surtout rewarded video | Minimum publié de 5 000 impressions quotidiennes ou utilisateurs actifs | SDK HTML5, préchargement, callbacks, TCF annoncé | FonyGames n’atteint pas le seuil ; moins adapté à un interstitiel obligatoire ; paiement à partir de 100 USD | Revoir à 5 000 opportunités/jour |
| AdinPlay / Venatus | Vidéo, rewarded, interstitiel, display | Partenariat commercial | Spécialiste du browser gaming, demande directe et programmatique | Pas de seuil ni conditions publiques claires ; plutôt adapté aux éditeurs déjà établis | Demander une offre à partir de 100 000 sessions-joueurs/mois |
| Playwire | Display, vidéo, gaming | Éditeurs à fort trafic | Médiation et exploitation gérées | Recommande environ 100 000 pages vues ; meilleure économie avec une part significative de trafic américain | Non pertinent actuellement |
| GameDistribution, Poki, CrazyGames | Publicité sur leurs portails | Publication du jeu chez eux | Distribution et monétisation combinées | Ce ne sont pas des remplacements directs d’une régie pour le site propre ; contraintes de plateforme | Traiter comme canal de distribution séparé |

### Pourquoi AdSense en premier

1. Le format interstitiel H5 correspond exactement au placement retenu.
2. `adBreakDone` fournit une résolution pour tous les cas, y compris absence d’annonce, timeout et frequency cap.
3. L’intégration peut rester courte derrière l’interface `AdProvider`.
4. Une seule régie limite le poids JavaScript, les partenaires de données et les risques de synchronisation.
5. Les concurrents les plus accessibles sont principalement orientés rewarded video ou demandent déjà un trafic significatif.

### Si Google refuse la candidature

Ne pas intégrer immédiatement une régie moins adaptée pour contourner le refus.

Décision ferme :

- conserver `enabled: false` ;
- continuer à mesurer les opportunités en mode fantôme ;
- candidater chez AppLixir seulement après avoir atteint **5 000 opportunités publicitaires individuelles par jour** ;
- contacter AdinPlay seulement après **100 000 sessions-joueurs par mois** ;
- réexaminer AdSense après croissance significative et amélioration du dossier éditeur.

## 15. Ordre d’implémentation

1. Créer la politique et le compteur serveur sans SDK publicitaire.
2. Implémenter `AD_BARRIER` avec un faux fournisseur simulant des durées de 0, 10, 30 et 60 secondes.
3. Tester déconnexion, nouveau joueur, no-fill, timeout et double callback.
4. Ajouter les événements de mesure.
5. Activer le mode fantôme.
6. Mettre en place la CMP et la documentation de confidentialité.
7. Candidater à AdSense H5 Games Ads.
8. Implémenter `AdSenseH5Provider` en environnement de test.
9. Attendre le gate de production.
10. Lancer le test A/B.
11. Désactiver, maintenir ou généraliser selon les seuils de la section 13.

## 16. Sources officielles

- [Google — inscription à H5 Games Ads](https://support.google.com/adsense/answer/1705831?hl=en)
- [Google — présentation et règles H5 Games Ads](https://support.google.com/adsense/answer/9959170?hl=en)
- [Google Developers — référence `adBreak()`](https://developers.google.com/ad-placement/apis/adbreak)
- [Google — règles des publicités avec récompense](https://support.google.com/adsense/answer/9121589?hl=en-EN)
- [Google — exigences de consentement EEE, Royaume-Uni et Suisse](https://support.google.com/adsense/answer/13554116?hl=en)
- [AppLixir — documentation](https://www.applixir.com/documentation/)
- [AppLixir — conditions d’approbation et FAQ](https://support.applixir.com/frequently-asked-questions)
- [AdinPlay — solutions pour éditeurs](https://adinplay.com/publishers)
- [Playwire — critères de qualification](https://www.playwire.com/qualification-criteria)

Cette spécification définit une politique produit et technique. La validation juridique finale dépend de l’implémentation réelle, de la CMP, de l’audience et du statut de l’éditeur.
