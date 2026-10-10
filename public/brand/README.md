# Identité visuelle — MAFIA WARS : Dadou vs Even

Logo, icônes, emblèmes de faction et fond de menu du jeu (Londres victorien, 1888).
**Tous les fichiers sont générés par code** : ne pas les retoucher à la main, modifier
`scripts/build-logo.mjs` puis régénérer.

```bash
node scripts/build-logo.mjs     # ou : npm run logo   (≈ 8 s, depuis la racine du dépôt)
```

Le script n'utilise que des devDependencies déjà présentes : `opentype.js` (texte → tracés),
`@resvg/resvg-js` (SVG → PNG) et les polices `@fontsource/cinzel*`. Le JPEG du fond est
encodé par un petit encodeur JPEG intégré au script (aucun outil externe).

## Fichiers

| Fichier | Taille | Usage |
|---|---|---|
| `brand/logo.svg` / `.png` | 2000 × 1120, transparent | Logo principal : skyline de 1888, titre doré, bannière Dadou/Even, revolvers |
| `brand/logo-compact.svg` / `.png` | 1200 × 380, transparent | En-tête HUD / menu pause (titre + bannière, sans décor) |
| `brand/icon.svg`, `icon-512.png`, `icon-192.png` | 512 × 512 (coins arrondis) | Icône d'application / PWA (`manifest`) |
| `../favicon.svg`, `../favicon-32.png`, `../favicon-16.png` | 64 × 64 (vectoriel) | Onglet du navigateur — « M » doré sur fond rouge/bleu, lisible en 16 px |
| `../apple-touch-icon.png` | 180 × 180, plein cadre | iOS (qui arrondit lui-même les coins) |
| `brand/emblem-dadou.svg` / `.png` | 512 × 512, transparent | Emblème « La Mafia de Dadou » : D couronné, lauriers, cramoisi/noir/or |
| `brand/emblem-even.svg` / `.png` | 512 × 512, transparent | Emblème « La Mafia d'Even » : ancre (L'Ancre Bleue) et E, marine/noir/argent |
| `brand/menu-backdrop.svg` / `.jpg` | 1920 × 1080, opaque | Fond du menu principal (sans texte) : Westminster et la Tamise la nuit |

Tous les SVG sont autonomes : texte vectorisé (aucune police requise), aucune image
externe, `viewBox` défini. Les fonds sont transparents sauf icône, favicon et fond de menu.

## Intégration (Vite sert `public/` à la racine)

```html
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png">
<link rel="icon" href="/favicon-16.png" sizes="16x16" type="image/png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
```

```css
.menu { background: #07080c url('/brand/menu-backdrop.jpg') center / cover no-repeat; }
.menu__logo { width: min(60vw, 1000px); }        /* /brand/logo.svg */
.hud__title { height: 56px; }                     /* /brand/logo-compact.svg */
```

Le centre et le haut du fond de menu sont volontairement calmes pour accueillir le logo
et les boutons ; la Clock Tower (côté rouge, Dadou) et la lune (côté bleu, Even) cadrent
l'ensemble.

## Palette

| Rôle | Dadou | Even |
|---|---|---|
| Couleur principale | cramoisi `#9e1b22` | marine `#1d3461` |
| Couleur profonde | rouge profond `#5c0d12` | marine profond `#0f1c38` |
| Noir | `#120607` | `#05080f` |
| Métal / liseré | or `#d4a640` | argent `#c9d1dc` |

Contours : encre chaude `#0d0906` (or) et froide `#070b12` (argent). Le titre utilise un
dégradé « laiton/dorure » (reflet clair, bande d'horizon sombre, remontée chaude) défini
dans `METAL.goldFace`.

## Typographie

- **Cinzel Decorative Black** (capitales ornées) : « MAFIA WARS » — M et W en
  capitales à paraphe, le reste en capitales simples ; « VS » ; monogrammes D, E, M, MW.
- **Cinzel Black** : noms des factions et lettrage des emblèmes.

Polices de Natanael Gama, licence SIL Open Font License 1.1 (paquets `@fontsource`).
Le texte étant converti en tracés, aucun fichier de police n'est distribué avec les assets.

## Notes de conception

- Bannière scindée rouge | bleu : la rivalité se lit d'un coup d'œil ; le médaillon « VS »
  en laiton fait la jonction, les revolvers des deux camps (Webley à crosse « bec d'oiseau »,
  doré pour Dadou, nickelé pour Even) se rejoignent canon contre canon derrière lui.
- Skyline fidèle à 1888 : Clock Tower (cadran éclairé à minuit moins cinq), Victoria Tower,
  tour centrale du Parlement, dôme de St Paul's, clochers de Wren, cheminées fumantes.
  Pas de Tower Bridge (achevé en 1894). Le fond de menu ajoute Westminster Bridge (1862),
  le Victoria Embankment (1870) et ses becs de gaz, et des voiliers aux docks côté Even.
- Lisibilité : contours sombres + ombres portées pour les fonds clairs, métal clair et
  liseré lumineux pour les fonds sombres. Vérifié sur fond sombre et sur fond parchemin.
