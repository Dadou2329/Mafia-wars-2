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
- Une ville de **576 × 480 m** : 13 quartiers, 89 bâtiments au plan, 5 ponts, 4 lignes de métro ;
  personnages voxel fins (voxels de 1/64 m, visages détaillés, animation procédurale) ; matières
  de 2085 calculées sans texture (brique américaine, calcaire, granit, céramique, métaux polis,
  vitrages et murs-rideaux qui reflètent la ville, chaussée mouillée et flaques sous la pluie).

---

## Installation sous Windows (le plus simple)

Téléchargez [`release/MafiaWars.exe`](release/MafiaWars.exe) (environ 90 Mo ; sur GitHub, bouton
« Download raw file »), puis double-cliquez dessus : rien d’autre à installer. Une fenêtre noire
(le serveur du jeu) s’ouvre, puis le jeu s’ouvre dans votre navigateur ; gardez la fenêtre noire
ouverte pendant la partie. Windows peut afficher « Windows a protégé votre ordinateur » (le
programme n’est pas signé) : « Informations complémentaires » puis « Exécuter quand même ».
Pour jouer à deux, le code ne suffit pas : il n’existe que sur l’ordinateur qui a créé la
partie. L’hôte envoie son lien d’invitation (ou le code et l’« Adresse pour votre ami » affichée
dans son salon) ; l’invité ouvre le lien, ou saisit code et adresse dans « Rejoindre une
partie ». Détails, et jeu à distance : [release/LISEZMOI.txt](release/LISEZMOI.txt).

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
puis le jeu y est intégré.

## Jouer en réseau local ou par Internet

- **Un seul serveur par partie** : chaque exécutable (ou `npm start`) fait tourner son propre
  serveur, et un code de salon n’existe que sur l’ordinateur qui l’a créé. L’invité doit donc
  rejoindre **l’ordinateur de l’hôte**, pas le sien.
- **Réseau local** : l’hôte crée la partie ; son salon affiche le code et, dessous, « Adresse pour
  votre ami » (par exemple `192.168.1.20:3000`). L’invité ouvre le lien d’invitation, ou dans son
  propre jeu « Rejoindre une partie » avec le code **et** cette adresse (coller le lien remplit
  les deux) ; le jeu vérifie que l’ordinateur de l’hôte répond et que le code y existe, puis y
  conduit l’invité. Si l’ordinateur ne répond pas : autorisez MafiaWars (ou Node.js) dans le
  pare-feu de l’hôte, sur les réseaux privés.
- **À distance sans configuration** : un réseau local virtuel gratuit (Radmin VPN, ZeroTier,
  Tailscale) relie les deux PC ; le salon de l’hôte affiche cette adresse sous « Autres
  adresses ».
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
| Sauter / s’accroupir (appui bref : bascule, appui long : maintenu) | Espace / C | Espace / C |
| Glisser | C en sprintant | C en sprintant |
| Implant du bras gauche / droit (grappin, arme de bras, bouclier…) | F / X | F / X |
| Esquive (implant des jambes) | Z | W |
| Capacités 1 à 5 (surcharge, scanner, camouflage, réflexes, drone…) | T Y H J U | T Y H J U |
| Mode de vision (thermique, nocturne) | N | N |
| Écran CYBERNÉTIQUE | I | I |
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
  13 quartiers : à Manhattan, Harlem, Upper West Side, Central Park, Upper East Side, Times
  Square, Greenwich Village, Wall Street, Lower East Side et Chinatown ; sur la rive est,
  Astoria, Long Island City, Williamsburg et Bushwick.
  Avec au moins **7 quartiers**, le **QG actuel** de l’adversaire devient prenable : sa capture
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
- **Déplacements** : accélération et freinage francs, sprint, accroupi (appui bref : bascule ;
  appui long : maintenu), **glissade** (C en sprintant ; on peut tirer et sauter en sortie),
  saut avec temps de grâce (relâcher tôt = saut plus court), **escalade des rebords** (sauter
  contre un rebord pour s’y hisser), réceptions amorties (caméra, ralentissement des chutes
  lourdes) et **dégâts de chute**. La caméra vit avec le mouvement : champ de vision selon la
  vitesse, roulis en course murale, creux à la réception. **V** bascule entre la vue subjective
  (bras, armes et implants visibles) et la vue à la 3e personne à tout moment.
- **Implants cybernétiques** (47 implants, 13 emplacements : bras gauche et droit, trois
  modules de jambes, deux de torse, colonne vertébrale, deux d’yeux, peau, deux de système
  neuronal) : ils s’achètent, s’installent et s’améliorent dans une **clinique cybernétique**
  (sept en ville, réparties à égalité) ou à la **station cybernétique du QG** (amélioration).
  Chaque niveau porte le nom de sa gamme : Standard, Avancé, Militaire, Prototype, Légendaire.
  L’écran **CYBERNÉTIQUE** (touche **I**) montre votre parrain en 3D, l’emplacement choisi mis en
  valeur, les implants de chaque catégorie, leurs effets niveau par niveau, la comparaison avec
  l’implant installé, la commande, le prix et vos fonds ; trois configurations enregistrables
  (Combat, Mobilité, Infiltration), à appliquer dans une clinique ou au QG. Quelques exemples :
  - **Bras** (touche F à gauche, X à droite) : **grappin** (le câble vous hisse jusqu’aux toits,
    balancement et élan conservé, enchaînements en l’air aux meilleurs niveaux), **pistolet
    d’avant-bras** (le blindage s’ouvre, le canon sort ; munitions recyclées), **lame**, **poing
    hydraulique** (coups chargés qui projettent), **fouet monofilament**, **bouclier
    d’énergie** (maintenir la touche), **répulseur**, **bras électrique Tesla** (l’arc saute
    d’ennemi en ennemi et grille caméras et tourelles), **micro-roquettes**, **bras tactique**
    (piratage accéléré ou à distance), **grip magnétique** (rebords plus hauts, escalade).
  - **Jambes** : pistons de saut, double saut, bond chargé (accroupi puis saut), sprint
    cybernétique, **esquive** (touche Z), glissade améliorée, amortisseurs (atterrissage
    sismique), **course murale**, saut mural, semelles silencieuses.
  - **Torse, colonne, yeux, peau, système neuronal** : blindage, cœur de secours, surcharge
    défensive, nanobots ; colonne gyroscopique (plané), réflexes moteurs, treuil spinal ;
    **vision thermique** et **nocturne** (touche N), marqueur de cibles, scanner ; derme renforcé,
    **camouflage optique** ; assistance de visée, **accélérateur de réflexes** (effets
    personnels : cadence, vitesse, protection — le monde ne ralentit pas), conscience tactique,
    **drone de combat**, commandement neuronal. Les capacités se déclenchent avec T, Y, H, J, U.
  Les implants installés se voient sur le personnage, en 3e personne comme en vue subjective, et
  l’adversaire les voit aussi. Le serveur valide tout (recharges, portées, vitesses) ; aucune
  combinaison ne rend invincible. Pas d’entretien, de rejet ni de dépendance. Le catalogue
  complet, niveau par niveau, est dans [docs/IMPLANTS.md](docs/IMPLANTS.md).
- **Prendre le contrôle d’un bâtiment** : plus de capture par simple présence. Chaque bâtiment a
  son opération, menée sur place, dont la difficulté suit son importance : un objectif court pour
  une boutique (prendre le comptoir), deux ou trois étapes pour un bâtiment clé, l’assaut le plus
  long pour un QG. La banque : forcer la chambre forte, récupérer l’acte de propriété et le
  porter au bureau du directeur ; le casino : le réseau de contrôle, le bureau de la direction,
  le salon VIP ; la boîte de nuit : le bureau de la direction ; le dépôt : les quais puis la salle
  de contrôle logistique ; la casse : le registre des épaves ; le marché tech, les centres de
  données et les usines : le serveur, avec un court piratage interactif ; les tours de bureaux :
  un assaut vertical, du hall jusqu’au toit. Des repères holographiques montrent les objectifs
  (à travers les murs) ; vos lieutenants vident le bâtiment puis mènent chaque étape pendant que
  leurs hommes les couvrent, et vous pouvez les rejoindre (**E** à l’objectif) pour aller plus
  vite. Un ennemi près de l’objectif le conteste, abattre l’opérateur l’interrompt, et le
  propriétaire peut reprendre une étape volée. Les bâtiments neutres sans défenseurs peuvent
  aussi être achetés. Un **braquage** ne rapporte que de l’argent : le bâtiment ne change pas
  de mains.
- **Ordres rapides** : maintenez **Q** près de vos hommes : « Suivez-moi », « Attaquez »,
  « Défendez », « Repliez-vous ».
- **Recrutement** : auprès du rabatteur du QG (« Recruter 1 / 5 / 10 »), lieutenants
  supplémentaires, améliorations (pistolets, pistolets-mitrailleurs, fusils à rail, gilets en
  graphène, implants de visée, hackers, liaison cryptée, armurerie, drones…).
- **Améliorations du QG** (carte stratégique) : carte holographique avancée, surveillance
  tactique, terminal de recrutement automatique, sécurité renforcée, communications avancées,
  station cybernétique, armurerie avancée, module de transport personnel, salle des trophées,
  gardes d’élite, module de commande de drones, centre d’opérations stratégiques. Chacune agit
  vraiment (alertes et révélations, recrutement, tourelles, installation d’implants au QG, prix
  de l’armurerie, taxi gratuit, revenus de prestige, gardes blindés, drone de patrouille,
  opérations plus rapides…) et **change le bureau en 3D** : table holographique, mur d’écrans,
  fauteuil chirurgical, râtelier d’armes, piste d’atterrissage, vitrine de trophées qui se
  remplit… Elles suivent le parrain quand il déménage ; le rival les découvre s’il s’introduit
  dans le QG.
- **Économie** : chaque bâtiment rapporte un revenu par minute, plus un bonus par quartier.
  Le tableau de bord affiche Argent, Revenus, Hommes et Territoires.
- **L’ascension** : on ne décore rien, le jeu meuble tout. Chaque parrain gravit cinq paliers en
  emménageant (téléphone → Immobilier) : planque → garage → loft → penthouse → tour.
  - Dadou : Planque de Bushwick → Garage de Williamsburg → Loft de Canal Street → Penthouse de
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
  votre trace : vos propres bâtiments sont autant de **planques sûres** où l’on se fait oublier
  bien plus vite (et pourquoi pas, volez un croiseur).
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
    city/plan.ts       New York : 13 quartiers, 89 bâtiments, logements, rues, ponts, métro
    city/gen/          génération voxel (façades, toits, intérieurs meublés, sécurité)
    city/roadGraph.ts  graphe des chaussées (convois en pilote automatique)
    voxel.ts nav.ts    monde voxel (0,25 m, tronçons compressés), navigation multi-niveaux
                       (étages, ascenseurs, métro)
    glass.ts           verre destructible
    protocol.ts        messages réseau, instantanés binaires
    constants.ts       règles : économie, paliers, véhicules, améliorations, ordres
    implants.ts        catalogue des 47 implants (emplacements, gammes, paramètres de jeu)
    moveMods.ts        déplacements selon les implants (client et validation du serveur)
    conquest.ts        opérations de prise de contrôle par type de bâtiment
  server/
    main.ts room.ts    serveur HTTP + Socket.IO, salons, reconnexion, revanche
    game/              simulation : IA, escouades, police, véhicules, sécurité, convois, victoire
      cyber.ts         implants : achat, amélioration, installation, configurations
      abilities.ts     capacités, armes de bras, protections, chutes, allure tolérée
      conquest.ts      opérations sur les bâtiments (étapes, lieutenants, défense)
      hq.ts            améliorations du QG, cliniques cybernétiques
      modules.ts       systèmes greffés à la simulation
  client/
    ui/screens/        menu, salon, paramètres, commandes, aide, chargement, pause, victoire
    game/              joueur (déplacements), conduite, armes, HUD, téléphone, cartes, roue des
                       ordres, écrans géants, circulation, passants, portes, enseignes, verre ;
                       implants du joueur (cyberClient), effets et surimpressions (cyberFx,
                       cyberOverlay), écran CYBERNÉTIQUE (cyberUi), HUD des capacités,
                       conquête (conquestClient), bureau du QG (hqVisuals)
    render/            maillage voxel, éclairage en tuiles, ciel, pluie, horizon, hologrammes, eau
    world/             chargement : workers de génération, de maillage et d’éclairage
    characters/        personnages voxel fins (squelette, sculpture, visages, tenues), animation
                       procédurale, niveaux de détail
    models/            accessoires (rue, logements, commerces, bureaux), véhicules, armes
    audio/             sons, boucles moteur et musiques synthétisés (Web Audio)
public/brand/          logo, logo compact, icône, favicon, emblèmes (scripts/build-logo.mjs)
tests/                 tests automatiques
```

## Tests

```bash
npm run typecheck      # vérification TypeScript stricte
npm test               # sans navigateur : moteur (compression des voxels, maillage,
                       # navigation et éclairage en tuiles comparés aux versions de référence),
                       # génération, simulation (ordres → combats → opérations), ascension,
                       # véhicules, sécurité, braquages, drones, convois, verre, NYPD, grenades,
                       # événements, victoire, textes ; déplacements (glissade, rebords, double
                       # saut, esquive, course murale, escalade, bond, grappin jusqu'au toit,
                       # enchaînements) et capacités côté serveur (achats, installation,
                       # grappin, esquive, protections, bouclier, cœur de secours, répulseur, arc
                       # électrique, roquettes, camouflage, chutes, armes de bras, drone)
npx tsx tests/conquest.ts    # prise de contrôle : étapes, lieutenants, défense, piratage, QG
npx tsx tests/hq.ts          # améliorations du QG et cliniques
node tests/cyber-moves.mjs   # implants en partie (grappin, esquive, glissade, armes, visions,
                             # implants et lame de l’adversaire vus chez soi)
node tests/cyber-ui.mjs      # écran CYBERNÉTIQUE : achat, amélioration, installation
npx tsx tests/plan-check.ts  # cohérence et symétrie du plan de la ville
node tests/e2e.mjs     # parcours de bout en bout dans un vrai navigateur (Playwright)
node tests/rematch.mjs # réseau : salon, reconnexion (implants compris), pause, fin, revanche
node tests/join-lan.mjs # deux serveurs (deux exécutables) : rejoindre l’hôte avec code + adresse
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
tourelles et lieutenants, ordres exécutés physiquement, prise de contrôle des bâtiments par
opérations, territoires, économie, améliorations, ascension sur cinq paliers avec déménagement
du QG, véhicules terrestres et aéronef, téléphone, piratage, braquages, convois, drones, police,
événements, météo, verre destructible, journal, victoire et revanche, paramètres graphiques,
sonores et touches modifiables ; depuis la mise à jour cybernétique : 47 implants visibles et
fonctionnels, déplacements avancés, écran CYBERNÉTIQUE, cliniques, douze améliorations du QG
visibles dans le bureau.

Limites actuelles, en toute transparence :

- **Implants et nouveaux déplacements vérifiés surtout sans navigateur.** Les déplacements,
  les capacités, les opérations et le QG ont leurs tests automatiques ; dans le vrai client,
  le grappin, l’esquive, la glissade, le pistolet d’avant-bras, le camouflage, les visions,
  l’écran CYBERNÉTIQUE et les implants de l’adversaire vus chez soi (apparence, lame sortie,
  câble du grappin) ont été vérifiés en rendu logiciel, à très faible cadence (quelques images
  par seconde), face à un robot de test qui n’affiche rien : jamais avec deux joueurs humains
  sur deux écrans. La sensation de jeu (accélérations, caméra, rythme des enchaînements) n’a
  pas pu être jugée à 60 images par seconde sur une vraie carte graphique. Les sons n’ont pas
  été écoutés (contrôlés par mesure). Le mini-jeu de piratage n’a pas été joué à la main.
- Les implants sont réservés aux deux parrains : les PNJ n’en portent pas (les gardes d’élite
  sont blindés, sans implants). Le drone de combat peut être abattu par l’autre joueur ; les PNJ
  l’ignorent.
- Les « portes à badge » du bras tactique et les « portes renforcées » du poing hydraulique
  agissent sur les étapes des opérations (chambres fortes, portes, barricades) : la ville n’a
  pas d’autres portes verrouillées.
- Le camouflage optique et le bouclier sont des effets lumineux (pas de véritable réfraction) ;
  le filament du fouet est une traînée, pas une corde simulée. Sous les longs manteaux, les
  implants des cuisses sont cachés (ceux des tibias et des pieds restent visibles).
- Les meubles ajoutés au bureau par les améliorations ne bloquent que le joueur (les PNJ et les
  balles les traversent) ; la moto volante de la piste d’atterrissage est décorative.

- **Carte graphique indispensable.** Sur une machine sans accélération matérielle (rendu
  logiciel), le jeu tombe à environ une image par seconde. Tout le développement automatisé a été
  vérifié en rendu logiciel (captures d’écran) : les performances sur une vraie carte graphique
  n’ont pas été mesurées ici. Les réglages « Basse »/« Moyenne » et une échelle de rendu réduite
  aident sur les petites configurations.
- **Un New York stylisé** : la zone jouable fait 576 × 480 m (13 quartiers). Les quartiers, les
  monuments (Empire State, Chrysler, One Times Square, Grand Central…) et la statue de la Liberté
  sont stylisés ; la ligne d’horizon au-delà de la zone jouable n’est qu’un décor. Il n’y a pas
  de Broadway en diagonale (les rues suivent la grille). Traverser la ville à pied est long :
  véhicules, taxi volant et métro sont là pour ça.
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
- La ville est générée par chaque client au démarrage, en arrière-plan pendant le menu : une
  dizaine de secondes (génération et navigation dans un *worker*, maillage réparti sur plusieurs
  *workers*). Le serveur met autant de temps à démarrer.
- **Éclairage** : précis (cellules de 0,5 m) dans un rayon de 50 à 60 m autour de la caméra,
  plus grossier (1 m) au-delà ; le reste de la ville s’éclaire en tâche de fond pendant la
  première minute. Au-dessus de 48 m, tout est considéré à l’air libre (seules les couronnes des
  tours y montent).
- Pas de voix enregistrées : tous les sons et musiques sont synthétisés.
- Une partie oppose exactement deux joueurs humains (pas d’adversaire contrôlé par l’ordinateur).

## Crédits

Jeu créé pour Dadou et Even. Technologies : Three.js, Socket.IO, Vite, TypeScript, Node.js.
Polices : Orbitron et Rajdhani (SIL Open Font License). Graphismes voxel procéduraux et sons
synthétisés réalisés pour le projet.
