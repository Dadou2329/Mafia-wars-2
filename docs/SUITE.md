# MAFIA WARS II : Dadou vs Even — document de conception

Ce document fixe les décisions de conception de la suite. Il complète la bible du premier jeu
(`docs/MafiaWars-Bible-Suite.pdf`). En cas de conflit, ce document (et la commande de la suite)
l'emporte.

## 1. Ce qui reste du premier jeu (non négociable)

- Deux parrains, exactement **Dadou** et **Even** ; leurs gangs : « La Mafia de Dadou » et
  « La Mafia d’Even ». Jamais « David », jamais « Evan ».
- Tout le texte visible est en français naturel (grammaire des noms de lieux : `src/shared/french.ts`).
- Deux humains en ligne : salon à code de 4 lettres, choix exclusif du parrain, prêt, reconnexion,
  bouton « Revanche ».
- On joue le parrain en personne (1re / 3e personne, touche V) **et** on commande depuis un bureau
  (« Bureau de Dadou » / « Bureau d’Even ») : les ordres sont exécutés physiquement par des hommes
  visibles qui marchent (ou roulent) dans la ville.
- Serveur autoritaire (Node + Socket.IO, 20 Hz), ville voxel générée de façon déterministe sur le
  client et le serveur, tout est fait en code (modèles, sons, musique, logo).
- Dadou = cramoisi et noir, flamboyant (moustache en guidon, chapeau melon). Even = bleu marine et
  argent, élégant (haut-de-forme, monocle — devenu monocle cybernétique, barbe grise).
- Équilibre : mêmes règles, mêmes prix, positions symétriques sur la carte.

## 2. Ce qui change

- **New York, 2085** : cyberpunk mais toujours New York (Times Square, Wall Street, Brooklyn,
  Chinatown, Queens, Central Park, Harlem, ponts, métro, escaliers de secours, châteaux d’eau,
  taxis jaunes, bouches à vapeur…).
- **Pas de quêtes, pas de missions** : la carte « Première mission » disparaît. Seulement des
  conseils contextuels désactivables. Les braquages, convois et événements sont des activités
  libres.
- **Pas de relations avec les PNJ, pas de décoration manuelle**, pas de loyauté/moral/fatigue.
- **Progression du parrain** : de la planque minable au penthouse puis à la tour, chaque logement
  est un vrai intérieur 3D entièrement meublé par le jeu.
- Véhicules, smartphone, piratage, drones, convois, braquages, métro, combat vertical.

## 3. La carte (monde voxel)

- Voxel de 0,25 m (inchangé). Monde de **288 m (X, ouest→est) × 240 m (Z, nord→sud)**.
- Hauteur stockée : de −8,5 m (sous-sol, métro) à +63,5 m. Rue à y = 0 (`GROUND_VY = 34`).
- Les intérieurs s’arrêtent sous 48 m (limite du volume d’éclairage précalculé) ; au-dessus, seules
  les couronnes et antennes des tours. L’Empire State et le Chrysler sont des monuments voxel de
  63 m (non capturables) ; au-delà de la zone jouable, une ligne d’horizon en 3D (Upper Manhattan,
  Long Island City, Downtown Brooklyn, Jersey City, statue de la Liberté) et la silhouette du ciel.

### Quartiers (7) — symétrie miroir par rapport à l’axe z = 120

```
           x: 0 ───────── 90 ──────────── 190 ── 216 ────── 288
 z=0    │ HARLEM         │ CENTRAL PARK      │ East  │ QUEENS (Even)  │
        │                │ (Upper East Side) │ River │                │
 z=80   ├────────────────┴───────────────────┤       │  pont de       │
        │      MIDTOWN — TIMES SQUARE        │       │  Queensboro    │
 z=120  │      (le joyau, au centre)          │       ├────────────────┤
 z=160  ├────────────────┬───────────────────┤       │  pont de       │
        │ CHINATOWN      │ WALL STREET       │       │  Brooklyn      │
 z=240  │                │ (Financial Dist.) │       │ BROOKLYN(Dadou)│
```

- Paires miroir : Harlem ↔ Chinatown, Central Park ↔ Wall Street, Queens ↔ Brooklyn ; Midtown
  est seul au centre et vaut le plus.
- Hudson à l’ouest (bord de carte), East River entre Manhattan et la rive est.
- Ponts : Queensboro (Central Park ↔ Queens) et Brooklyn Bridge (Wall Street ↔ Brooklyn).
- Métro : ligne 7 (Queens ↔ Times Square) et ligne L (Brooklyn ↔ Times Square) en tunnel sous la
  rivière ; la station Times Square est le nœud central (itinéraires souterrains alternatifs).

### Contrôle

- Un quartier appartient à celui qui tient **tous ses bâtiments clés ★**.
- Le QG actuel du rival n’est prenable qu’avec **au moins 4 quartiers sur 7** : Midtown devient
  décisif. Prendre le QG actuel du rival = victoire.

## 4. Progression : l’ascension du parrain

Chaque parrain a son échelle de logements (symétriques). Un logement de l’échelle du rival est
« réservé » tant qu’il ne l’a pas acheté ; une fois acheté, il peut être pris par la force.
Emménager déplace le QG (apparition, recrutement, bureau, gardes). L’ancien logement reste une
propriété (revenus) mais n’est plus le QG.

| Palier | Dadou | Even | Bonus (indicatifs) |
| --- | --- | --- | --- |
| 1 Planque | Planque de Bushwick (Brooklyn) | Planque d’Astoria (Queens) | 40 hommes, 2 lieutenants |
| 2 Garage | Garage de Red Hook (Brooklyn) | Dépôt de Long Island City (Queens) | véhicules, 70 hommes, 3 lt |
| 3 Loft | Loft de Canal Street (Chinatown) | Loft de Lenox Avenue (Harlem) | 100 hommes, 4 lt, +10 %, ordres au téléphone, drones |
| 4 Penthouse | Penthouse de Wall Street | Penthouse de Central Park Sud | 140 hommes, 6 lt, +20 %, gardes, ADAV |
| 5 Tour | Tour Méridien (Times Square sud) | Tour Zénith (Times Square nord) | 180 hommes, 8 lt, +35 %, tourelles automatiques |

Conditions : prix + nombre minimal de quartiers contrôlés (paliers 3, 4, 5).

## 5. Moteur : changements

- `VoxelWorld` : tronçons uniformes (un tronçon plein d’un seul matériau ne coûte rien) pour le
  sous-sol et les volumes pleins.
- Navigation **multi-niveaux** : plusieurs sols par cellule (métro, rue, étages, toits), A* sur
  (cellule, niveau), portails (ascenseurs) ; les PNJ prennent escaliers et ascenseurs.
- Zones de capture par étage (rectangles + plage de hauteur).
- Véhicules : entités serveur (position envoyée par le conducteur, vérifiée), PNJ en fourgon.

## 6. Identité visuelle

- Logo : « MAFIA WARS II » chromé et néon, ruban « DADOU VS EVEN », skyline de New York 2085,
  deux pistolets croisés. Versions principale, compacte, icône, favicon.
- Palette : nuit bleu-noir, néons magenta/cyan, or pour le luxe ; Dadou cramoisi néon (#ff2a4d),
  Even bleu néon (#4fd8ff).
- Typographies : titres art déco/néon, corps lisible avec tous les accents français.
