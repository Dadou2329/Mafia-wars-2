# Identité visuelle — MAFIA WARS II : Dadou vs Even

Logo, icônes, emblèmes de faction et fond de menu de la suite (New York, 2085).
**Tous les fichiers sont générés par code** : ne pas les retoucher à la main, modifier
`scripts/build-logo.mjs` puis régénérer.

```bash
npm run logo                                  # ou : node scripts/build-logo.mjs   (≈ 12 s)
MW_ONLY=logo,compact node scripts/build-logo.mjs   # ne régénère que certains fichiers
```

Clés de `MW_ONLY` : `logo`, `compact`, `icon` (icônes + apple-touch-icon), `favicon`, `emblems`,
`backdrop`.

Le script n'utilise que des devDependencies déjà présentes : `opentype.js` (texte → tracés),
`@resvg/resvg-js` (SVG → PNG) et les polices `@fontsource/orbitron` et `@fontsource/rajdhani`
(opentype.js ne lit pas le woff2 : on charge les `.woff` livrés dans les mêmes paquets). Le JPEG
du fond est encodé par un petit encodeur JPEG intégré au script (aucun outil externe).

## Fichiers

| Fichier | Taille | Usage |
|---|---|---|
| `brand/logo.svg` / `.png` | 2000 × 1160, transparent | Logo principal : anneau holographique et skyline de 2085, titre chromé « MAFIA WARS » + « Ⅱ » doré, plaque « DADOU VS EVEN », chapeaux, pistolets |
| `brand/logo-compact.svg` / `.png` | 1200 × 380, transparent | Version simplifiée (titre + plaque, sans décor) : salon, pause, victoire, crédits |
| `brand/icon.svg`, `icon-512.png`, `icon-192.png` | 512 × 512 (coins arrondis) | Icône d'application / PWA : monogramme « MW Ⅱ » sous l'anneau et la ville |
| `../favicon.svg`, `../favicon-32.png`, `../favicon-16.png` | 64 × 64 (vectoriel) | Onglet du navigateur — « Ⅱ » doré sur tuile cramoisi / marine, lisible en 16 px |
| `../apple-touch-icon.png` | 180 × 180, plein cadre | iOS (qui arrondit lui-même les coins) |
| `brand/emblem-dadou.svg` / `.png` | 512 × 512, transparent | « La Mafia de Dadou » : chapeau melon et moustache en guidon dorée, cramoisi / noir / or |
| `brand/emblem-even.svg` / `.png` | 512 × 512, transparent | « La Mafia d’Even » : haut-de-forme, monocle cybernétique et barbe grise, marine / argent / cyan |
| `brand/menu-backdrop.svg` / `.jpg` | 1920 × 1080, opaque | Fond du menu principal (sans texte) : New York la nuit en 2085 depuis l'East River |

Tous les SVG sont autonomes : texte vectorisé (aucune police requise), aucune image externe,
`viewBox` défini. Les fonds sont transparents sauf icône, favicon et fond de menu.
Côté jeu, on affiche plutôt les **PNG** (les SVG contiennent de nombreux flous que le navigateur
recalculerait à chaque nouveau tramage).

## Intégration (Vite sert `public/` à la racine)

```html
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png">
<link rel="icon" href="/favicon-16.png" sizes="16x16" type="image/png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<meta name="theme-color" content="#05060d">
```

```css
.menu { background: #05060d url('/brand/menu-backdrop.jpg') center / cover no-repeat; }
.menu__logo { width: min(46vw, 79vh); }          /* /brand/logo.png */
.header__logo { height: 56px; }                   /* /brand/logo-compact.png */
```

Le haut et le centre du fond de menu sont volontairement sombres et calmes pour accueillir le
logo et les boutons. Les deux hologrammes géants (melon de Dadou à gauche, vers 12 % / 39 % de
l'image ; haut-de-forme d'Even à droite, vers 88 % / 34 %) servent de repères aux lueurs animées
du menu (`.mw-lamp--l` / `.mw-lamp--r` dans `src/client/ui/screens.css`).

## Palette

| Rôle | Dadou | Even |
|---|---|---|
| Couleur principale | cramoisi `#c8102e` | marine `#15295a` |
| Néon | cramoisi néon `#ff2a4d` | cyan néon `#4fd8ff` |
| Couleur profonde | `#5c0a16` | `#0a1533` |
| Noir | `#0d0507` | `#04070f` |
| Métal | or `#f2b84b` | argent `#cfd8e6` |

Commun : nuit `#05060d`, magenta `#ff3dc8`, violet `#a95cff`. Le dégradé « rivalité »
(`RIVAL` dans le script) va du cramoisi de Dadou au cyan d'Even en passant par le magenta et le
violet : liseré néon du titre, anneau holographique, filet de l'icône.
Métaux (`METAL`) : chrome « nuit de 2085 » (reflet blanc, acier bleuté, horizon sombre, remontée
rosée des néons), or poli, argent.

## Typographie

- **Orbitron Black / Bold** (Matt McInerney) : titre, noms des parrains, « VS », monogramme,
  lettrage des emblèmes. Orbitron n'a ni « · » ni guillemets « » : le script dessine lui-même les
  séparateurs (losanges).
- **Rajdhani** (Indian Type Foundry) : police de texte de l'interface (voir `theme.css`).
- Le « Ⅱ » est dessiné (deux fûts reliés par des barres à empattements chanfreinés).

Polices sous licence SIL Open Font License 1.1 (paquets `@fontsource`). Le texte étant converti
en tracés, aucun fichier de police n'est distribué avec les assets.

## Notes de conception

- La rivalité se lit d'un coup d'œil : plaque scindée cramoisi | marine, liserés or | argent,
  néons cramoisi | cyan, écusson hexagonal « VS » à la jonction, et les deux chapeaux posés sur
  les pointes de la plaque (melon flamboyant de Dadou, haut-de-forme élégant d'Even).
- New York reste reconnaissable sans aucun logo réel : flèche « Empire State » à gradins et mât
  d'amarrage, couronne « Chrysler » en arches à fenêtres triangulaires, châteaux d'eau sur les
  toits, pont suspendu à arcs brisés (Brooklyn) et pont cantilever (Queensboro), taxis jaunes
  devenus volants, vapeur des bouches d'aération. 2085 : mégatours à anneaux, hologrammes,
  traînées du trafic aérien, pluie, smog éclairé de magenta.
- Les pistolets croisés sous l'écusson rappellent les revolvers du premier logo : culasse dorée
  et néon cramoisi pour Dadou, culasse chromée et néon cyan pour Even.
- Lisibilité : contours sombres épais, liseré néon fin et halo discret ; vérifié du plein format
  jusqu'à 200 px de large (logo compact), 16 px (favicon) et 24 px (emblèmes).
