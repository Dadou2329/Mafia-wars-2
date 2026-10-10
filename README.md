<p align="center">
  <img src="public/brand/logo.png" alt="MAFIA WARS II : Dadou vs Even" width="720">
</p>

# MAFIA WARS II : Dadou vs Even

New York, 2085. Néons, pluie, voitures volantes et gratte-ciel à perte de vue : la guerre des gangs
a quitté le Londres de 1888 pour la ville qui ne dort jamais. Deux parrains se disputent New York :
**Dadou**, à la tête de **La Mafia de Dadou** (cramoisi et noir, chapeau melon, moustache en
guidon), et **Even**, à la tête de **La Mafia d’Even** (bleu marine et argent, haut-de-forme,
monocle et barbe grise). Chacun part d’une planque minuscule, recrute ses hommes, engage des
lieutenants, prend des immeubles, conquiert des quartiers… et finit par donner l’assaut au QG de
l’autre.

Jeu **3D voxel multijoueur en ligne pour deux joueurs humains**, dans le navigateur, entièrement
en français. Suite de *MAFIA WARS : Dadou vs Even* (Londres, 1888), dont il reprend le moteur.

- Client : Three.js + TypeScript + Vite
- Serveur : Node.js + Socket.IO, **serveur autoritaire** (IA, combats, captures, économie, convois…)
- Graphismes voxel procéduraux, sons et musiques synthétisés : aucun fichier externe n’est
  téléchargé pendant le jeu.

---

## Démarrage rapide (développement)

Prérequis : **Node.js 20 ou plus récent** (testé avec Node 22) et un navigateur récent avec
WebGL 2 (Chrome, Edge, Firefox, Safari 16+). **Une carte graphique est nécessaire** (voir les
limites connues).

```bash
npm install
npm run dev
```

Puis ouvrez **http://localhost:5173** dans deux navigateurs (ou deux ordinateurs) :

1. Joueur 1 : « Créer une partie » → un code de salon s’affiche, avec un lien d’invitation.
2. Joueur 2 : « Rejoindre une partie » → saisir le code (ou ouvrir le lien d’invitation).
3. Dans le salon « Choisissez votre parrain » : l’un clique sur **Jouer Dadou**, l’autre sur
   **Jouer Even** (un parrain choisi devient indisponible pour l’autre).
4. Les deux joueurs se déclarent prêts : la partie démarre.

`npm run dev` lance le serveur de jeu (port **3000**, simulation à 20 Hz) et le client Vite
(port **5173**, qui relaie Socket.IO vers le port 3000). Séparément : `npm run dev:server` et
`npm run dev:client`.

## Version de production

```bash
npm run build     # compile le client (dist/client) et le serveur (dist/server/main.js)
npm start         # sert le jeu ET le multijoueur sur http://localhost:3000
```

Variables d’environnement : `PORT` (3000 par défaut), `HOST` (0.0.0.0), `CLIENT_DIR` (dossier du
client compilé, `dist/client` par défaut).

`npm run build:exe` fabrique un exécutable autonome (`release/MafiaWars.exe`, ou
`npm run build:exe -- linux`) : le binaire Node.js officiel est téléchargé depuis nodejs.org
puis le jeu y est intégré. Aucun exécutable n’est fourni tout fait dans le dépôt.

## Jouer en réseau local ou par Internet

- **Réseau local** : `npm run build && npm start` sur l’ordinateur hôte ; le serveur affiche son
  adresse locale (par exemple `http://192.168.1.20:3000`) que l’autre joueur ouvre dans son
  navigateur. Autorisez Node.js dans le pare-feu si la page ne s’ouvre pas.
- **Par Internet** : déployez la version de production chez n’importe quel hébergeur Node, ou
  redirigez le port TCP 3000 de votre box. Derrière un proxy inverse, activez les WebSockets pour
  `/socket.io/`. Un client servi ailleurs peut viser un serveur avec `?server=https://…`.
- **Reconnexion** : en cas de coupure ou de rechargement, le joueur retrouve sa place, son
  parrain et son empire ; la partie est mise en pause (jusqu’à 3 minutes) pendant l’absence.

---

## Commandes (par défaut)

Toutes les touches sont modifiables dans **Paramètres → Commandes** (détection des conflits :
échanger, remplacer ou annuler). Elles suivent la position physique des touches : sur AZERTY,
« Avancer » est sur **Z**, « Pas à gauche » sur **Q**…

| Action | QWERTY | AZERTY |
| --- | --- | --- |
| Se déplacer | W A S D | Z Q S D |
| Sprinter | Maj gauche | Maj gauche |
| Sauter / s’accroupir | Espace / C | Espace / C |
| Tirer / frapper | clic gauche | clic gauche |
| Viser (au volant d’une moto ou d’une voiture : tirer par la portière) | clic droit | clic droit |
| Recharger | R | R |
| Lancer une grenade | G | G |
| Armes (mains/lame/matraque, pistolet, pistolet-mitrailleur, fusil à pompe, fusil à rail) | 1 à 5, molette | & é " ' ( , molette |
| Interagir (bureau, rabatteur, armurerie, véhicule, terminal, coffre) | E | E |
| Vue 1re / 3e personne | V | V |
| Roue des ordres rapides | Q (maintenir) | A (maintenir) |
| Carte stratégique | M | , |
| Téléphone | Tab | Tab |
| Bilan de la partie | B | B |
| Discuter | Entrée | Entrée |
| Menu pause | Échap | Échap |

## Comment jouer

- **Objectif** : un quartier appartient à celui qui tient **tous ses bâtiments clés ★**. Il y a
  7 quartiers : Harlem, Central Park, Times Square, Chinatown, Wall Street, le Queens et Brooklyn.
  Avec au moins **4 quartiers**, le **QG actuel** de l’adversaire devient prenable : sa capture
  donne la victoire (« DADOU RÈGNE SUR NEW YORK ! » / « EVEN RÈGNE SUR NEW YORK ! »), puis
  « Revanche ». Une durée de partie peut être fixée dans le salon (victoire aux territoires).
- **Départ** : une planque (Planque de Bushwick pour Dadou à Brooklyn, Planque d’Astoria pour
  Even dans le Queens), 600 $, 4 gangsters, un pistolet et un lieutenant.
- **Le bureau** : chaque logement a son bureau (« Bureau de Dadou » / « Bureau d’Even »).
  Appuyez sur **E** devant la table de commandement pour ouvrir la **carte stratégique** :
  choisissez un bâtiment, un quartier ou un convoi, l’ordre, le lieutenant et le nombre
  d’hommes. Les lieutenants exécutent les ordres physiquement dans la ville : attaquer un
  bâtiment ou un quartier (y compris **par le métro**), défendre, patrouiller, suivre le patron,
  renforcer, tenir une position, **tenir le toit**, se replier, **braquer un coffre**,
  **escorter** ou **intercepter un convoi**. Ils envoient des rapports d’avancement.
- **Combat** : pistolet, pistolet-mitrailleur, fusil à pompe, fusil à rail, lame thermique,
  matraque électrique et poings ; **grenades** (touche G, en vente à l’armurerie du QG) dont le
  souffle blesse vos ennemis et brise les vitres. On se bat dans la rue, à l’intérieur, dans
  les étages, sur les toits et dans le métro.
- **Capturer un bâtiment** : éliminez ses défenseurs et restez à l’intérieur avec vos hommes.
  Les bâtiments neutres sans défenseurs peuvent aussi être achetés.
- **Ordres rapides** : maintenez **Q** près de vos hommes : « Suivez-moi », « Attaquez »,
  « Défendez », « Repliez-vous ».
- **Recrutement** : auprès du rabatteur du QG (« Recruter 1 / 5 / 10 »), lieutenants
  supplémentaires, améliorations (pistolets, pistolets-mitrailleurs, fusils à rail, gilets en
  graphène, implants de visée, hackers, liaison cryptée, armurerie, drones…).
- **Économie** : chaque bâtiment rapporte un revenu par minute, plus un bonus par quartier.
  Le tableau de bord affiche Argent, Revenus, Hommes et Territoires.
- **L’ascension** : on ne décore rien, le jeu meuble tout. Chaque parrain gravit cinq paliers en
  emménageant (téléphone → Immobilier) : planque → garage → loft → penthouse → tour.
  - Dadou : Planque de Bushwick → Garage de Red Hook → Loft de Canal Street → Penthouse de
    Wall Street → Tour Méridien.
  - Even : Planque d’Astoria → Dépôt de Long Island City → Loft de Lenox Avenue → Penthouse de
    Central Park Sud → Tour Zénith.
  - Chaque palier augmente l’effectif et le nombre de lieutenants, les revenus et la garde du
    QG, et débloque des moyens : véhicules (garage), ordres depuis le téléphone et drones (loft),
    aéronef (penthouse), tourelles automatiques (tour). Le QG déménage avec le parrain : c’est lui que
    l’adversaire devra prendre.
- **Véhicules** : moto, berline, bolide, fourgon blindé (une escouade entière) et l’aéronef
  ADAV, rare et prestigieux, qui se pose sur les toits. Achat et livraison depuis le téléphone,
  **E** pour monter ou descendre ; les hommes de l’escorte montent avec vous. On peut voler le
  véhicule de l’adversaire, tirer depuis la voiture, renverser… et exploser.
- **Téléphone (Tab)** : alertes, garage, taxi volant (retour au QG), lieutenants, recrutement,
  immobilier, drones, convois et carte.
- **Sécurité, piratage et braquages** : banques, bourse, galerie, casino… sont protégés par des
  caméras (elles préviennent le NYPD, ou le parrain propriétaire quand son rival entre), des
  tourelles et des coffres verrouillés. Piratez leur terminal (**E**) pour couper la sécurité
  pendant 90 s, puis braquez le coffre : l’alarme sonne et le NYPD arrive.
- **Convois blindés** : la Banque Fédérale fait circuler des camions de valeurs ; chaque parrain
  peut envoyer ses propres convois depuis ses bâtiments logistiques. Escortez les vôtres,
  interceptez ceux de l’adversaire : un camion détruit laisse son butin sur la chaussée.
- **Drones** : un drone survole un quartier et révèle les ennemis sur vos cartes.
- **Police** : coups de feu en public, passants abattus, intrusions filmées et braquages font
  monter le niveau de recherche ; le NYPD envoie ses agents, puis des croiseurs qui foncent dans
  les rues toutes sirènes hurlantes et déposent leurs équipes. Semez-les pour qu’ils perdent
  votre trace (et pourquoi pas, volez un croiseur).
- **Ville vivante** : passants, circulation (voitures à coussin magnétique, taxis jaunes) et
  couloirs aériens de voitures volantes, métro, ponts, écrans géants de Times Square qui
  affichent la propagande du parrain qui tient le quartier, hologrammes, pluie et orages, cycle
  jour/nuit. Les vitrines et baies vitrées se brisent sous les balles et dans les explosions.
- **Événements** : cargaisons de contrebande, descentes de police, orages magnétiques,
  informateurs, convois de la Banque Fédérale ; « Le Flash de New York » commente la guerre.

Les gangsters restent simples : ni loyauté, ni moral, ni fatigue, ni faim, ni trahison. Pas de
système de quêtes ni de relations : la liberté du bac à sable, au service de la conquête.

---

## Organisation du code

```
src/
  shared/              code commun client/serveur
    city/plan.ts       New York : 7 quartiers, 47 bâtiments, logements, rues, ponts, métro
    city/gen/          génération voxel (façades, toits, intérieurs meublés, sécurité)
    city/roadGraph.ts  graphe des chaussées (convois en pilote automatique)
    voxel.ts nav.ts    monde voxel (0,25 m), navigation multi-niveaux (étages, ascenseurs, métro)
    glass.ts           verre destructible
    protocol.ts        messages réseau, instantanés binaires
    constants.ts       règles : économie, paliers, véhicules, améliorations, ordres
  server/
    main.ts room.ts    serveur HTTP + Socket.IO, salons, reconnexion, revanche
    game/              simulation : IA, escouades, police, véhicules, sécurité, convois, victoire
  client/
    ui/screens/        menu, salon, paramètres, commandes, aide, chargement, pause, victoire
    game/              joueur, conduite, armes, HUD, téléphone, cartes, roue des ordres,
                       écrans géants, circulation, passants, portes, enseignes, verre
    render/            maillage voxel, lumière précalculée, ciel, pluie, horizon, hologrammes, eau
    characters/        personnages voxel et animation procédurale
    models/            accessoires (rue, logements, commerces, bureaux), véhicules, armes
    audio/             sons, boucles moteur et musiques synthétisés (Web Audio)
public/brand/          logo, logo compact, icône, favicon, emblèmes (scripts/build-logo.mjs)
tests/                 tests automatiques
```

## Tests

```bash
npm run typecheck      # vérification TypeScript stricte
npm test               # 128 contrôles sans navigateur : génération, navigation, simulation
                       # (ordres → combats → captures), ascension, véhicules, sécurité,
                       # braquages, drones, convois, verre, NYPD, grenades, événements,
                       # victoire, textes
node tests/e2e.mjs     # parcours de bout en bout dans un vrai navigateur (Playwright)
node tests/rematch.mjs # réseau : salon, reconnexion, pause, fin de partie, revanche
node tests/drive.mjs   # conduite et téléphone dans le vrai client
node tests/tour.mjs    # visite photographique de la ville (heures, pluie, tirs)
node tests/audio/smoke.mjs  # moteur audio
```

Les tests dans le navigateur supposent un serveur lancé avec `MW_DEBUG=1` (téléportation de
test, utile sur les machines sans carte graphique) ; voir l’en-tête de chaque script pour les
adresses et options (`URL`, `SERVER`, `BOT=1`, `LOWGFX=1`…).

## État du projet et limites connues

Ce qui fonctionne : salon en ligne à deux joueurs (choix exclusif des parrains, reconnexion,
revanche), New York 2085 générée et visitable (intérieurs meublés, immeubles à plusieurs étages,
toits, métro), 1re et 3e personne, combats (pistolet, pistolet-mitrailleur, fusil à pompe, fusil à
rail, lame thermique, matraque électrique, poings), grenades, IA des gangsters, gangs locaux, policiers,
tourelles et lieutenants, ordres exécutés physiquement, captures, territoires, économie,
améliorations, ascension sur cinq paliers avec déménagement du QG, véhicules terrestres et
aéronef, téléphone, piratage, braquages, convois, drones, police, événements, météo, verre
destructible, journal, victoire et revanche, paramètres graphiques, sonores et touches
modifiables.

Limites actuelles, en toute transparence :

- **Carte graphique indispensable.** Sur une machine sans accélération matérielle (rendu
  logiciel), le jeu tombe à environ une image par seconde. Tout le développement automatisé a été
  vérifié en rendu logiciel (captures d’écran) : les performances sur une vraie carte graphique
  n’ont pas été mesurées ici. Les réglages « Basse »/« Moyenne » et une échelle de rendu réduite
  aident sur les petites configurations.
- **Un New York condensé** : la zone jouable fait environ 290 × 240 m. Les quartiers, les
  monuments (Empire State, Chrysler, One Times Square…) et la statue de la Liberté sont stylisés ;
  la ligne d’horizon au-delà de la zone jouable n’est qu’un décor.
- Les **passants** et la **circulation** sont simulés par chaque navigateur : les deux joueurs ne
  voient pas exactement la même foule ni les mêmes voitures (les gangsters, lieutenants,
  policiers, tourelles, véhicules des parrains et convois sont, eux, synchronisés par le serveur).
- **Destruction limitée** : seuls les vitrages (vitrines, baies, vitres) se brisent, et les
  véhicules explosent ; les murs sont indestructibles.
- Les **croiseurs du NYPD** amènent des agents mais ne poursuivent pas un véhicule en fuite
  (pas de course-poursuite en voiture), et les voitures volantes de la circulation sont
  décoratives ; le seul engin volant pilotable est l’aéronef ADAV.
- Les étages supérieurs des très hautes tours sont des volumes fermés (décor) ; les étages
  accessibles sont meublés.
- La ville est générée par chaque client au démarrage (quelques secondes, dans un *worker*).
- Pas de voix enregistrées : tous les sons et musiques sont synthétisés.
- Une partie oppose exactement deux joueurs humains (pas d’adversaire contrôlé par l’ordinateur).

## Crédits

Jeu créé pour Dadou et Even. Technologies : Three.js, Socket.IO, Vite, TypeScript, Node.js.
Polices : Orbitron et Rajdhani (SIL Open Font License). Graphismes voxel procéduraux et sons
synthétisés réalisés pour le projet.
