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

- Voxel de 0,25 m (inchangé). Monde de **576 m (X, ouest→est) × 480 m (Z, nord→sud)** : quatre
  fois la première version de New York 2085, environ neuf fois le Londres de 1888.
- Hauteur stockée : de −8,5 m (sous-sol, métro) à +63,5 m. Rue à y = 0 (`GROUND_VY = 34`).
- Les intérieurs s’arrêtent sous 48 m (limite du volume d’éclairage) ; au-dessus, seules les
  couronnes et antennes des tours. L’Empire State et le Chrysler sont des monuments voxel de
  63 m (non capturables) ; au-delà de la zone jouable, une ligne d’horizon en 3D et la silhouette
  du ciel.

### Quartiers (13) — symétrie miroir par rapport à l’axe z = 240

```
        x: 0        136        254        390   430            576
 z=0    ┌──────────────────────────────────┐ E ┌───────────────┐
        │ HARLEM                           │ a │ ASTORIA       │
 z=84   ├──────────┬──────────┬────────────┤ s │ (Even)        │
        │ UPPER    │ CENTRAL  │ UPPER      │ t ├───────────────┤ z=116
        │ WEST SIDE│ PARK     │ EAST SIDE  │   │ LONG ISLAND   │
 z=190  ├──────────┴──────────┴────────────┤ R │ CITY          │
        │ MIDTOWN — TIMES SQUARE           │ i ├───────────────┤ z=240
 z=290  ├──────────┬──────────┬────────────┤ v │ WILLIAMSBURG  │
        │ GREENWICH│ WALL     │ LOWER      │ e │               │
        │ VILLAGE  │ STREET   │ EAST SIDE  │ r ├───────────────┤ z=364
 z=396  ├──────────┴──────────┴────────────┤   │ BUSHWICK      │
        │ CHINATOWN                        │   │ (Dadou)       │
 z=480  └──────────────────────────────────┘   └───────────────┘
```

- Paires miroir : Harlem ↔ Chinatown, Upper West Side ↔ Greenwich Village, Central Park ↔ Wall
  Street, Upper East Side ↔ Lower East Side, Astoria ↔ Bushwick, Long Island City ↔
  Williamsburg ; Midtown est seul au centre et vaut le plus.
- Hudson à l’ouest (bord de carte), East River entre Manhattan et la rive est, Newtown Creek
  entre Long Island City et Williamsburg.
- Ponts, tous carrossables : Triborough (Harlem ↔ Astoria), Queensboro (Midtown ↔ Long Island
  City), Williamsburg (Midtown ↔ Williamsburg), Brooklyn (Chinatown ↔ Bushwick) et Pulaski
  au-dessus de Newtown Creek.
- Grille de rues à la new-yorkaise (avenues et rues numérotées), graphe des chaussées d’un seul
  tenant pour les convois et les croiseurs.
- Métro : 12 stations, lignes 1, 6, 7 et L ; Times Square et Grand Central sont les nœuds. Les
  escouades prennent les rames (les tunnels leur sont fermés à pied).
- Monuments : Times Square (One Times Square, marches TKTS, façades couvertes d’écrans), Grand
  Central, Empire State, Chrysler, la Bourse et son taureau, One World Trade Center, Zuccotti
  Park, Central Park (réservoir, lac et Bow Bridge, fontaine), lanternes de Mott Street, High
  Line et Riverside Walk, Gantry Plaza et ses grues, arche de Washington Square et tombeau de
  Grant.
- 89 bâtiments au plan (73 capturables dont 31 clés, 10 logements, 4 commissariats, 2 monuments)
  et 48 immeubles de décor.

### Contrôle

- Un quartier appartient à celui qui tient **tous ses bâtiments clés ★**.
- Le QG actuel du rival n’est prenable qu’avec **au moins 7 quartiers sur 13** : Midtown devient
  décisif. Prendre le QG actuel du rival = victoire.

## 4. Progression : l’ascension du parrain

Chaque parrain a son échelle de logements (symétriques). Un logement de l’échelle du rival est
« réservé » tant qu’il ne l’a pas acheté ; une fois acheté, il peut être pris par la force.
Emménager déplace le QG (apparition, recrutement, bureau, gardes). L’ancien logement reste une
propriété (revenus) mais n’est plus le QG.

| Palier | Dadou | Even | Bonus (indicatifs) |
| --- | --- | --- | --- |
| 1 Planque | Planque de Bushwick (Brooklyn) | Planque d’Astoria (Queens) | 40 hommes, 2 lieutenants |
| 2 Garage | Garage de Williamsburg (Brooklyn) | Dépôt de Long Island City (Queens) | véhicules, 70 hommes, 3 lt |
| 3 Loft | Loft de Canal Street (Chinatown) | Loft de Lenox Avenue (Harlem) | 100 hommes, 4 lt, +10 %, ordres au téléphone, drones |
| 4 Penthouse | Penthouse de Wall Street | Penthouse de Central Park Sud | 140 hommes, 6 lt, +20 %, gardes, ADAV |
| 5 Tour | Tour Méridien (Times Square sud) | Tour Zénith (Times Square nord) | 180 hommes, 8 lt, +35 %, tourelles automatiques |

Conditions : prix + nombre minimal de quartiers contrôlés (2, 4 et 6 pour les paliers 3, 4 et 5).

## 5. Moteur : changements

- `VoxelWorld` : tronçons uniformes (un tronçon plein d’un seul matériau ne coûte rien) pour le
  sous-sol et les volumes pleins, et tronçons **compressés** (tranches uniformes, plages,
  rangées et tranches identiques partagées), lus sans décompression : 9 Mo de voxels pour toute
  la ville au lieu de 323 Mo.
- **Éclairage en tuiles** de 16 m : une fenêtre fine (cellules de 0,5 m, 128 m de côté) suit la
  caméra dans une texture 3D torique, un volume grossier (1 m) couvre le reste de la ville ; un
  worker dédié calcule les tuiles (d’abord autour des QG, puis de la caméra) et les garde en
  cache compressé. Le résultat d’une tuile est identique au calcul de la ville entière.
- **Chargement parallèle** : génération et navigation dans un worker, maillage réparti sur
  plusieurs workers ; maillage glouton qui fusionne aussi les bandes d’occlusion ambiante
  (moitié moins de faces à rendu identique).
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
