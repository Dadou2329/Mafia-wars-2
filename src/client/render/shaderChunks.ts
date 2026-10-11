// Morceaux de GLSL partagés par les matériaux du monde, des accessoires et des personnages.

export const COMMON_UNIFORMS_GLSL = /* glsl */ `
uniform highp sampler3D uLightTex;
uniform highp sampler3D uLightCoarse;
uniform highp sampler3D uTintTex;
uniform vec3 uLightOrigin;
uniform vec3 uLightSize;
uniform vec3 uLightCoarseSize;
uniform vec4 uLightWin;
uniform vec3 uTintOrigin;
uniform vec3 uTintSize;
uniform vec3 uSkyAmb;
uniform vec3 uLampCol;
uniform float uLampPower;
uniform float uNight;
uniform float uTime;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uFogHeightK;
uniform float uLampBoost;
uniform float uWet;
`;

export const NOISE_GLSL = /* glsl */ `
float h12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float h13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h12(i), h12(i + vec2(1.0, 0.0)), f.x), mix(h12(i + vec2(0.0, 1.0)), h12(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * vnoise(p);
    p = p * 2.03 + 17.1;
    a *= 0.5;
  }
  return v;
}
`;

export const LIGHT_GLSL = /* glsl */ `
// Lumière (ciel, lampes) : fenêtre fine (0,5 m) autour de la caméra, texture torique (répétée en x
// et z) valable dans le rectangle uLightWin ; au-delà, volume grossier (1 m) de toute la ville.
vec2 sampleLightVol(vec3 p) {
  vec3 q = p - uLightOrigin;
  if (q.y >= uLightSize.y) return vec2(1.0, 0.0);
  vec2 e = min(q.xz - uLightWin.xy, uLightWin.zw - q.xz);
  float f = clamp(min(e.x, e.y) * 0.25, 0.0, 1.0);
  vec2 L = vec2(1.0, 0.0);
  if (f < 1.0) L = texture(uLightCoarse, clamp(q / uLightCoarseSize, vec3(0.0005), vec3(0.9995))).rg;
  if (f > 0.0) {
    vec3 uvw = q / uLightSize;
    uvw.y = clamp(uvw.y, 0.0005, 0.9995);
    L = mix(L, texture(uLightTex, uvw).rg, f);
  }
  return L;
}
// Couleur des lampes à cet endroit (néons roses, cyan, réverbères…), intensité comprise.
vec3 lampColorAt(vec3 p) {
  vec3 t = texture(uTintTex, clamp((p - uTintOrigin) / uTintSize, vec3(0.0005), vec3(0.9995))).rgb;
  float tw = max(t.r, max(t.g, t.b));
  vec3 c = tw > 0.004 ? t / tw : uLampCol;
  return c * uLampPower;
}
// Éclairage ambiant : ciel + lampes. n = normale monde, p = position monde.
vec3 ambientLight(vec2 L, vec3 n, vec3 p) {
  float sky = L.x * L.x;
  float lamp = L.y * (0.55 + 0.45 * L.y);
  return uSkyAmb * sky * (0.72 + 0.28 * n.y) + lampColorAt(p) * lamp * uLampBoost;
}
vec3 applyHeightFog(vec3 col, vec3 wpos) {
  vec3 d = wpos - cameraPosition;
  float dist = length(d);
  float h = clamp(wpos.y, 0.0, 80.0);
  float dens = uFogDensity * (0.4 + 0.6 * exp(-h * uFogHeightK));
  float f = 1.0 - exp(-dist * dens);
  return mix(col, uFogColor, clamp(f, 0.0, 1.0));
}
`;

/**
 * Reflets sans texture (monde et objets) : ciel en dégradé horizon → zénith au-dessus d'une « ligne »
 * de façades d'en face (brk = hauteur de cette ligne dans le reflet, en sinus d'élévation).
 */
export const REFLECT_GLSL = /* glsl */ `
vec3 skyReflect(vec3 R, float brk) {
  vec3 hor = uFogColor * 1.12 + uSkyAmb * 0.1;
  vec3 zen = uSkyAmb * 1.3;
  vec3 sky = mix(hor, zen, smoothstep(0.02, 0.8, R.y));
  vec3 city = mix(vec3(dot(uFogColor, vec3(0.3, 0.5, 0.2))), uFogColor, 0.4) * 0.4 + uSkyAmb * 0.16;
  return mix(city, sky, smoothstep(brk - 0.03, brk + 0.09, R.y));
}
`;

/**
 * Motifs procéduraux des matériaux voxel (New York 2085). Tout est calculé à partir de la position
 * monde ; pw = taille d'un pixel en mètres : les joints sont anticrénelés et les détails plus fins
 * qu'un pixel s'effacent vers leur teinte moyenne (pas de moirage au loin).
 */
export const PATTERN_GLSL = /* glsl */ `
// ----------------------------------------------------------------- outils
// Joint (ligne) anticrénelé : e = distance au joint (m), w = demi-largeur (m). Au loin, la ligne
// s'élargit à un pixel en pâlissant d'autant (énergie conservée).
float jl(float e, float w, float pw) {
  float ww = max(w, pw * 0.75);
  return (1.0 - smoothstep(ww - pw * 0.5, ww + pw * 0.5, e)) * (w / ww);
}
// Joints d'une grille de pas p : quand le pas tombe sous deux pixels, couverture moyenne m.
float jg(float e, float w, float pw, float p, float m) {
  return mix(jl(e, w, pw), m, smoothstep(p * 0.2, p * 0.55, pw));
}
// Visibilité d'un détail de taille s (m) : 1 de près, 0 quand il devient plus fin qu'un pixel.
float lodf(float s, float pw) { return 1.0 - smoothstep(s * 0.25, s, pw); }
// Grille de panneaux cs, rangées décalées de off : distance au joint (m), indice et position locale.
float panelGrid(vec2 uv, vec2 cs, float off, out vec2 id, out vec2 f) {
  float row = floor(uv.y / cs.y);
  vec2 c = vec2(uv.x / cs.x + row * off, uv.y / cs.y);
  id = floor(c);
  f = fract(c);
  vec2 e = min(f, 1.0 - f) * cs;
  return min(e.x, e.y);
}
// Mouchetage poivre et sel (granit, granulats) : facteur de luminosité, sa moyenne au loin.
float pepper(vec2 uv, float s, float dk, float lt, float pw) {
  float g = h12(floor(uv / s));
  float k = 1.0 - step(g, 0.18) * dk + step(0.86, g) * lt;
  return mix(1.0 - 0.18 * dk + 0.14 * lt, k, lodf(s * 1.5, pw));
}
// Distance signée à un rectangle arrondi (demi-taille b, rayon r).
float sdRound(vec2 p, vec2 b, float r) {
  vec2 d = abs(p) - b + r;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - r;
}

// ----------------------------------------------------------------- façades
// Brique : sc 0 appareil américain (assise de boutisses toutes les 6), 1 brique peinte écaillée
// (c2 = brique dessous), 2 brique romaine longue et fine, 3 brique émaillée (brillante).
vec3 patBrick(vec2 uv, vec3 c1, vec3 c2, float sc, float pw, inout float spec) {
  bool roman = sc == 2.0;
  float ch = roman ? 0.0625 : 0.083333;
  float bl = roman ? 0.375 : 0.25;
  float row = floor(uv.y / ch);
  bool header = !roman && mod(row, 6.0) == 5.0;
  float L = header ? bl * 0.5 : bl;
  float x = uv.x / L + (header ? 0.25 : mod(row, 2.0) * 0.5);
  vec2 id = vec2(floor(x), row);
  float fx = fract(x);
  float fy = fract(uv.y / ch);
  float e = min(min(fx, 1.0 - fx) * L, min(fy, 1.0 - fy) * ch);
  float j = jg(e, 0.0048, pw, ch, roman ? 0.18 : 0.16);
  float dl = lodf(ch, pw);
  float r = h12(id);
  float r2 = h12(id + 17.31);
  if (sc == 1.0) {
    // peinture sur brique : seuls les joints marquent, écailles qui laissent voir la brique
    vec3 p = c1 * (1.0 + (r - 0.5) * 0.05 * dl);
    vec3 col = mix(p, p * 0.72, j);
    float peel = smoothstep(0.74, 0.76, vnoise(uv * 2.3 + 7.0) * 0.7 + vnoise(uv * 11.0) * 0.3);
    vec3 raw = mix(c2 * (0.85 + 0.3 * r * dl), vec3(0.64, 0.62, 0.58), j);
    spec = mix(spec, 0.02, peel);
    return mix(col, raw, peel);
  }
  vec3 b = c1 * (1.0 + (r - 0.5) * (sc == 3.0 ? 0.1 : 0.2) * dl);
  b *= 1.0 + (r2 - 0.5) * vec3(0.07, 0.0, -0.07) * dl;
  b = mix(b, b * 0.8, step(0.93, r2) * dl);
  float sl = lodf(0.03, pw);
  if (sl > 0.01) b *= 1.0 + (vnoise(uv * 70.0) - 0.5) * 0.09 * sl;
  // arête haute de chaque brique légèrement éclairée
  b *= 1.0 + 0.06 * smoothstep(0.7, 0.9, fy) * lodf(0.03, pw);
  vec3 m = c2 * (sl > 0.01 ? 0.95 + 0.07 * vnoise(uv * 33.0) : 0.985);
  if (sc == 3.0) spec *= 1.0 - j;
  else spec *= 1.0 - 0.5 * j;
  return mix(b, m, j);
}
vec3 sprayCol(float h) {
  return h < 0.17 ? vec3(1.0, 0.22, 0.62) : h < 0.34 ? vec3(0.12, 0.8, 0.98) : h < 0.5 ? vec3(1.0, 0.8, 0.12)
       : h < 0.67 ? vec3(0.42, 0.92, 0.26) : h < 0.84 ? vec3(1.0, 0.46, 0.12) : vec3(0.6, 0.32, 1.0);
}
// Lettre « bulle » (graffiti) : distance signée, lettre de 0,5 × 1 m en italique ; h choisit la forme.
float letterSD(vec2 p, float h) {
  p.x -= p.y * 0.22;
  float d = sdRound(p, vec2(0.22, 0.48), 0.14);
  if (h < 0.3) d = max(d, -sdRound(p - vec2(0.0, 0.08), vec2(0.05, 0.16), 0.05));
  else if (h < 0.55) d = max(d, -sdRound(p - vec2(0.16, 0.0), vec2(0.12, 0.07), 0.03));
  else if (h < 0.75) {
    d = max(d, -sdRound(p - vec2(0.0, 0.22), vec2(0.06, 0.1), 0.04));
    d = max(d, -sdRound(p - vec2(0.0, -0.2), vec2(0.06, 0.1), 0.04));
  } else d = min(sdRound(p - vec2(-0.1, 0.0), vec2(0.1, 0.48), 0.08), sdRound(p - vec2(0.06, 0.3), vec2(0.18, 0.12), 0.08));
  return d;
}
// Brique taguée : fresques en lettres « bulles », signatures avec coulures, affiches collées.
vec3 patGraffiti(vec2 uv, vec3 c1, vec3 c2, float wy, float pw, inout float spec) {
  vec3 col = patBrick(uv, c1, c2, 0.0, pw, spec);
  if (wy > 3.3 || wy < 0.05) return col;
  float seg = floor(uv.x / 5.0);
  float hs = h12(vec2(seg, 7.7));
  float sx = uv.x - seg * 5.0;
  if (hs < 0.55) {
    // fresque : lettres « bulles » en italique (panses, encoches), ombre portée en relief,
    // contour noir, dégradé de deux couleurs et reflet blanc
    vec3 a = sprayCol(h12(vec2(seg, 1.3))) * 0.88;
    vec3 b = sprayCol(h12(vec2(seg, 2.9))) * 0.88;
    float lw = 0.58;
    float lx = (sx - 0.45) / lw;
    float li = floor(lx);
    float hl = h12(vec2(li + seg * 13.0, 3.1));
    vec2 p = vec2((fract(lx) - 0.5) * lw, wy - 1.45 - 0.12 * sin(li * 1.9 + hs * 11.0));
    bool valid = li >= 0.0 && li <= 5.0;
    float sd = valid ? letterSD(p, hl) : 1.0;
    float sdS = valid ? letterSD(p + vec2(-0.06, 0.06), hl) : 1.0;
    float outl = 1.0 - smoothstep(-pw, pw, min(sd - 0.04, sdS - 0.02));
    float fill = 1.0 - smoothstep(-pw, pw, sd);
    float shade = (1.0 - smoothstep(-pw, pw, sdS)) * (1.0 - fill);
    vec3 fc = mix(b, a, smoothstep(-0.45, 0.45, p.y));
    fc = mix(fc, vec3(1.0), jl(abs(sd + 0.06), 0.01, pw) * step(0.05, p.y + 0.3 * p.x) * 0.75);
    col = mix(col, vec3(0.03, 0.03, 0.04), outl);
    col = mix(col, b * 0.35, shade);
    col = mix(col, fc, fill);
    spec = mix(spec, 0.22, outl);
  } else if (hs < 0.8) {
    float base = 1.25 + 0.5 * h12(vec2(seg, 5.0));
    float x0 = 0.6 + 1.5 * h12(vec2(seg, 6.0));
    float inX = step(x0, sx) * step(sx, x0 + 1.6 + 0.8 * hs);
    float y1 = base + 0.13 * sin(sx * 11.0 + hs * 40.0) + 0.06 * sin(sx * 29.0);
    float y2 = base - 0.32 + 0.09 * sin(sx * 17.0 + 3.0);
    float t = max(jl(abs(wy - y1), 0.014, pw), jl(abs(wy - y2), 0.01, pw) * step(fract(sx * 1.7), 0.8)) * inX;
    vec3 tc = h12(vec2(seg, 8.0)) < 0.5 ? vec3(0.03) : sprayCol(h12(vec2(seg, 9.0))) * 0.8;
    float dc = floor(sx / 0.09);
    float drip = step(0.7, h12(vec2(dc, seg))) * inX * jl(abs(fract(sx / 0.09) - 0.5) * 0.09, 0.004, pw)
               * step(wy, y1) * step(y1 - 0.1 - 0.35 * h12(vec2(dc, seg + 3.0)), wy);
    col = mix(col, tc, max(t, drip));
  } else {
    vec2 pc = vec2(floor(sx / 0.7), floor((wy - 0.5) / 0.95));
    vec2 pf = vec2(fract(sx / 0.7), fract((wy - 0.5) / 0.95));
    float inP = step(0.5, wy) * step(wy, 2.4) * step(0.06, pf.x) * step(pf.x, 0.94) * step(0.05, pf.y) * step(pf.y, 0.95);
    float hp = h12(pc + seg * 3.0);
    vec3 paper = mix(vec3(0.92, 0.9, 0.84), sprayCol(hp) * 0.9, step(0.4, hp));
    float block = step(0.55, pf.y) * step(pf.y, 0.85) * step(0.5, h12(pc + 2.0));
    vec3 pcol = mix(paper, vec3(0.08), block);
    float torn = smoothstep(0.62, 0.66, vnoise(vec2(sx, wy) * 6.0 + hp * 9.0));
    col = mix(col, pcol, inP * (1.0 - torn) * step(0.3, hp));
  }
  return col;
}
// Pierre : sc 0 calcaire en grands panneaux (joints filants), 1 baguettes de terre cuite émaillée,
// 2 moellons de granit bouchardé (quais), 3 granit gris moucheté, 4 granit noir poli pailleté,
// 5 schiste de Manhattan (rochers), 6 grès brun, 7 céramique de façade grand format.
vec3 patStone(vec2 uv, vec3 c1, vec3 c2, float sc, float pw, inout float spec) {
  if (sc == 1.0) {
    float p = 0.125;
    float row = floor(uv.y / p);
    float fy = fract(uv.y / p);
    float x = uv.x / 1.2 + h12(vec2(row, 4.0));
    float fx = fract(x);
    float gap = jg(min(fy, 1.0 - fy) * p, 0.011, pw, p, 0.18);
    float vj = jl(min(fx, 1.0 - fx) * 1.2, 0.003, pw);
    float l = lodf(p, pw);
    float prof = sin(clamp((fy - 0.09) / 0.82, 0.0, 1.0) * 3.14159);
    vec3 col = c1 * (1.0 + (h12(vec2(floor(x), row)) - 0.5) * 0.12 * l);
    col *= mix(0.94, 0.74 + 0.36 * prof + 0.12 * smoothstep(0.6, 0.8, fy), l);
    spec *= mix(1.0, 0.5 + 0.8 * prof, l);
    return mix(col, c2, max(gap * 0.92, vj * 0.6));
  }
  if (sc == 5.0) {
    float v = uv.y * 5.0 + uv.x * 0.7 + vnoise(uv * 0.7) * 3.5;
    vec3 col = mix(c2, c1, (0.5 + 0.5 * sin(v)) * 0.7 + 0.3 * vnoise(uv * 3.0));
    col += step(0.965, h12(floor(uv / 0.012))) * 0.16 * lodf(0.02, pw);
    float lich = smoothstep(0.7, 0.76, vnoise(uv * 2.2 + 9.0));
    return mix(col, vec3(0.46, 0.5, 0.38), lich * 0.22);
  }
  vec2 cs = sc == 2.0 ? vec2(1.0, 0.5) : sc == 4.0 ? vec2(1.0, 1.0) : sc == 6.0 ? vec2(0.75, 0.375) : sc == 7.0 ? vec2(1.2, 0.6) : vec2(1.0, 0.5);
  float off = (sc == 2.0 || sc == 6.0) ? 0.5 : 0.0;
  vec2 id, f;
  float e = panelGrid(uv, cs, off, id, f);
  float jw = sc == 2.0 ? 0.009 : sc == 6.0 ? 0.004 : sc == 7.0 ? 0.004 : 0.003;
  float j = jg(e, jw, pw, cs.y, 4.0 * jw / cs.y);
  float r = h12(id);
  float dl = lodf(cs.y, pw);
  float cloud = vnoise(uv * 1.6 + r * 7.0);
  vec3 col = c1 * (1.0 + (r - 0.5) * (sc == 7.0 ? 0.03 : 0.08) * dl);
  if (sc == 0.0) {
    col *= 0.93 + 0.12 * cloud + 0.04 * vnoise(uv * 7.0);
    col *= 1.0 - step(0.93, h12(floor(uv / 0.014))) * 0.12 * lodf(0.02, pw);
  } else if (sc == 2.0 || sc == 3.0) {
    col *= pepper(uv, 0.011, 0.42, 0.3, pw) * (0.95 + 0.08 * cloud);
    if (sc == 2.0) col *= 0.94 + 0.1 * vnoise(uv * 6.0);
  } else if (sc == 4.0) {
    col *= 0.88 + 0.22 * cloud;
    col += step(0.975, h12(floor(uv / 0.007))) * 0.1 * lodf(0.012, pw);
  } else if (sc == 6.0) {
    col *= 0.94 + 0.08 * sin(uv.y * 38.0 + vnoise(uv * 2.0) * 3.0) * lodf(0.05, pw) + 0.06 * cloud;
  } else {
    col *= 0.98 + 0.03 * cloud;
  }
  spec *= 1.0 - j;
  return mix(col, c2, j);
}
// Béton : dalles lissées et cirées (sols), banches à cônes de tirants (murs, sc 0), planches (sc 2).
vec3 patConcrete(vec2 uv, vec3 c1, vec3 c2, float sc, float pw, bool wall, inout float spec) {
  float m = vnoise(uv * 0.8) * 0.6 + vnoise(uv * 3.1 + 7.0) * 0.4;
  if (!wall) {
    vec2 f = fract(uv / 3.0);
    float e = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y)) * 3.0;
    vec3 col = c1 * (0.91 + 0.16 * m) * pepper(uv, 0.012, 0.16, 0.12, pw);
    spec = max(spec, 0.2);
    return mix(col, c2 * 0.75, jg(e, 0.003, pw, 3.0, 0.004));
  }
  if (sc == 2.0) {
    float row = floor(uv.y / 0.15);
    float fy = fract(uv.y / 0.15);
    float r = h12(vec2(row, 1.7));
    vec3 col = c1 * (0.93 + 0.1 * (r - 0.5) * lodf(0.15, pw) + 0.08 * m);
    col *= 1.0 + (vnoise(vec2(uv.x * 1.3 + r * 9.0, uv.y * 48.0)) - 0.5) * 0.12 * lodf(0.03, pw);
    return mix(col, c2 * 0.8, jg(min(fy, 1.0 - fy) * 0.15, 0.003, pw, 0.15, 0.04) * 0.8);
  }
  vec2 id, f;
  float e = panelGrid(uv, vec2(1.5, 0.75), 0.0, id, f);
  vec3 col = c1 * (1.0 + (h12(id) - 0.5) * 0.07 * lodf(0.75, pw)) * (0.93 + 0.12 * m);
  float gl = lodf(0.05, pw);
  if (gl > 0.01) col *= 1.0 + (vnoise(vec2(uv.x * 0.9, uv.y * 26.0)) - 0.5) * 0.05 * gl;
  vec2 q = (fract(f * 2.0) - 0.5) * vec2(0.75, 0.375);
  float hole = (1.0 - smoothstep(0.011, 0.011 + pw, length(q))) * lodf(0.03, pw);
  col = mix(col, c2 * 0.5, hole * 0.9);
  return mix(col, c2 * 0.82, jg(e, 0.0035, pw, 0.75, 0.015));
}
// Enduits et peintures : sc 0 peinture intérieure, 1 plâtre sale (planque), 2 enduit de façade.
vec3 patPlaster(vec2 uv, vec3 c1, float sc, float pw, float wy, bool wall) {
  float m = vnoise(uv * 1.3) * 0.6 + vnoise(uv * 5.0 + 3.0) * 0.4;
  vec3 col = c1 * (0.965 + 0.055 * m);
  float rl = lodf(0.025, pw);
  if (rl > 0.01) col *= 1.0 + (vnoise(uv * 60.0) - 0.5) * 0.035 * rl;
  if (sc == 1.0) {
    float leak = smoothstep(0.55, 0.9, vnoise(vec2(uv.x * 2.2, uv.y * 0.3 + 5.0)));
    float ring = smoothstep(0.62, 0.68, vnoise(uv * 0.8 + 11.0));
    col *= 1.0 - 0.1 * leak - 0.05 * ring;
    col = mix(col, col * vec3(0.94, 0.88, 0.76), ring * 0.5);
  } else if (sc == 2.0 && wall) {
    col *= 0.95 + 0.07 * vnoise(uv * 3.0 + 4.0);
    float fy = fract(wy / 0.5);
    col *= 1.0 - 0.28 * jl(min(fy, 1.0 - fy) * 0.5, 0.006, pw) * step(wy, 4.2);
  }
  return col;
}
// Bardages métalliques : sc 0 cassettes composites à fixations, 1 cassettes graphite (certaines
// perforées), 2 émail blanc, 3 tôle perforée, 4 composite carbone. Au sol : tôle larmée.
vec3 patMetalPanel(vec2 uv, vec3 c1, vec3 c2, float sc, float pw, bool wall, inout float spec) {
  if (sc == 4.0) {
    vec2 q = uv / 0.011;
    vec2 id = floor(q);
    vec2 f = fract(q);
    bool horiz = mod(id.x + id.y, 4.0) < 2.0;
    float tow = horiz ? sin(f.y * 3.14159) : sin(f.x * 3.14159);
    float l = lodf(0.016, pw);
    spec *= mix(1.0, horiz ? 1.3 : 0.7, l);
    return c1 * mix(1.0, 0.72 + 0.5 * tow, l) * (0.95 + 0.08 * vnoise(uv * 1.5));
  }
  if (!wall && sc < 2.5) {
    vec2 q = uv / 0.065;
    vec2 id = floor(q);
    vec2 f = fract(q) - 0.5;
    vec2 r = mod(id.x + id.y, 2.0) > 0.5 ? vec2(f.x + f.y, f.x - f.y) : vec2(f.x - f.y, f.x + f.y);
    float bump = 1.0 - smoothstep(0.28, 0.36, length(r * vec2(0.42, 1.7)));
    vec3 col = c1 * (0.9 + 0.12 * vnoise(uv * 1.7));
    col *= mix(1.02, 0.94 + 0.3 * bump, lodf(0.065, pw));
    spec = max(spec, 0.35);
    vec2 pf = fract(uv / 1.25);
    float e = min(min(pf.x, 1.0 - pf.x), min(pf.y, 1.0 - pf.y)) * 1.25;
    return mix(col, c2, jg(e, 0.003, pw, 1.25, 0.01));
  }
  vec2 cs = sc == 1.0 ? vec2(1.0, 0.5) : sc == 3.0 ? vec2(1.0, 2.0) : vec2(1.5, 0.75);
  vec2 id, f;
  float e = panelGrid(uv, cs, 0.0, id, f);
  float r = h12(id);
  vec3 col = c1 * (1.0 + (r - 0.5) * 0.07 * lodf(cs.y, pw));
  float bg = lodf(0.02, pw);
  if (bg > 0.01) col *= 1.0 + (vnoise(vec2(uv.x * 1.5, uv.y * 90.0)) - 0.5) * 0.07 * bg;
  col *= 0.97 + 0.06 * (1.0 - abs(f.y - 0.5) * 2.0);
  if (sc == 0.0) {
    vec2 cq = min(f, 1.0 - f) * cs - 0.05;
    col = mix(col, c2 * 1.6, (1.0 - smoothstep(0.007, 0.011, length(cq))) * lodf(0.03, pw));
  }
  if ((sc == 1.0 && r > 0.72) || sc == 3.0) {
    vec2 pq = uv / 0.035;
    pq.x += mod(floor(pq.y), 2.0) * 0.5;
    float hole = 1.0 - smoothstep(0.24, 0.32, length(fract(pq) - 0.5));
    col *= 1.0 - mix(0.14, hole * 0.68, lodf(0.035, pw));
  }
  spec *= 1.0 - 0.6 * jl(e, 0.006, pw);
  return mix(col, c2 * 0.55, jg(e, 0.006, pw, cs.y, 0.03));
}
// Tôle ondulée : profil sinusoïdal, recouvrements, coulures de rouille (c2).
vec3 patCorrugated(vec2 uv, vec3 c1, vec3 c2, float pw, inout float spec) {
  float l = lodf(0.076, pw);
  float s = sin(uv.x / 0.076 * 6.2832);
  vec3 col = c1 * (1.0 + s * 0.16 * l);
  spec *= 1.0 + 0.5 * s * l;
  float fx = fract(uv.x / 0.912);
  float fy = fract(uv.y / 3.0);
  col *= 1.0 - 0.3 * max(jl(min(fx, 1.0 - fx) * 0.912, 0.004, pw), jl(fy * 3.0, 0.006, pw));
  float st = smoothstep(0.55, 0.95, vnoise(vec2(uv.x * 3.5, uv.y * 0.35))) * (0.4 + 0.6 * vnoise(vec2(uv.x * 14.0, uv.y * 2.0)));
  float foot = (1.0 - smoothstep(0.0, 0.9, fy * 3.0)) * vnoise(uv * 4.0);
  return mix(col, c2, clamp(st * 0.5 + foot * 0.3, 0.0, 1.0) * 0.7);
}
// Métaux : sc 0 brossé ou laqué, 1 vert-de-gris (c2 = cuivre), 2 acier rivé (ponts), 3 poli,
// 4 zinc à joints debout.
vec3 patMetal(vec2 uv, vec3 c1, vec3 c2, float sc, float pw, inout float spec) {
  vec3 col = c1 * (0.94 + 0.09 * vnoise(uv * 0.8));
  if (sc == 1.0) {
    float st = vnoise(vec2(uv.x * 4.0, uv.y * 0.5)) * 0.6 + vnoise(uv * 9.0) * 0.4;
    return mix(c1 * (0.86 + 0.24 * st), c2, smoothstep(0.72, 0.86, st) * 0.35);
  }
  if (sc == 4.0) {
    float fx = fract(uv.x / 0.5);
    float rib = jl(min(fx, 1.0 - fx) * 0.5, 0.012, pw);
    return col * (1.0 + 0.22 * rib - 0.12 * jl(abs(fx - 0.06) * 0.5, 0.008, pw));
  }
  float ml = lodf(0.012, pw);
  if (ml > 0.01) col *= 1.0 + (vnoise(vec2(uv.x * 0.6, uv.y * 140.0)) - 0.5) * (0.05 + 0.12 * spec) * ml;
  if (sc == 3.0) col *= 0.3;
  if (sc == 2.0) {
    vec2 rq = vec2(fract(uv.x / 0.1) - 0.5, fract(uv.y / 0.25) - 0.5) * vec2(0.1, 0.25);
    col *= 1.0 + 0.25 * (1.0 - smoothstep(0.009, 0.013, length(rq))) * lodf(0.03, pw);
  }
  return col;
}
// Peinture laquée (menuiseries, bandeaux, garde-corps).
vec3 patPaint(vec2 uv, vec3 c1, float pw) {
  return c1 * (0.965 + 0.05 * vnoise(uv * vec2(3.0, 0.6))) * (1.0 + (vnoise(uv * 45.0) - 0.5) * 0.03 * lodf(0.03, pw));
}

// ----------------------------------------------------------------- sol, rue
// Trottoirs : sc 0 dalles new-yorkaises de 1,5 m, 1 pavés anthracite 60 × 30, 2 granit rouge poli
// (Times Square, pastilles d'acier), 3 bordure de granit, 4 bande podotactile.
vec3 patSidewalk(vec2 uv, vec3 c1, vec3 c2, float sc, float pw, bool wall, float wy, inout float spec) {
  if (sc == 3.0) {
    vec2 f = fract(uv / 1.8);
    float e = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y)) * 1.8;
    vec3 col = c1 * pepper(uv, 0.01, 0.22, 0.14, pw) * (0.95 + 0.08 * vnoise(uv * 2.0));
    if (wall) {
      float h = fract(wy * 4.0);
      col *= 1.0 + 0.1 * smoothstep(0.8, 0.95, h) * lodf(0.02, pw);
      col *= 1.0 - 0.32 * (1.0 - smoothstep(0.0, 0.25, h)) * smoothstep(0.4, 0.75, vnoise(uv * vec2(1.5, 1.0)));
    }
    return mix(col, c2, jg(e, 0.004, pw, 1.8, 0.004));
  }
  if (sc == 4.0) {
    vec2 q = fract(uv / 0.06) - 0.5;
    float dome = 1.0 - smoothstep(0.2, 0.3, length(q));
    float l = lodf(0.06, pw);
    vec3 col = c1 * mix(1.0, 0.86 + 0.24 * dome, l);
    vec2 f = fract(uv / 0.6);
    float e = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y)) * 0.6;
    return mix(col, c2, jg(e, 0.003, pw, 0.6, 0.02));
  }
  if (sc == 1.0 || sc == 2.0) {
    bool red = sc == 2.0;
    vec2 cs = red ? vec2(1.0, 0.5) : vec2(1.0, 0.5);
    vec2 id, f;
    float e = panelGrid(uv + vec2(red ? 0.0 : h12(vec2(floor(uv.y / 0.5), 6.1)), 0.0), cs, 0.0, id, f);
    float r = h12(id);
    vec3 col = c1 * (1.0 + (r - 0.5) * (red ? 0.1 : 0.24) * lodf(cs.y, pw));
    col *= red ? pepper(uv, 0.009, 0.45, 0.3, pw) : pepper(uv, 0.008, 0.2, 0.15, pw);
    col *= 0.95 + 0.08 * vnoise(uv * 1.3 + r);
    if (red) {
      vec2 dq = floor(uv / 1.5);
      vec2 dp = (dq + 0.25 + 0.5 * vec2(h12(dq + 3.1), h12(dq + 8.3))) * 1.5;
      float disc = (1.0 - smoothstep(0.045, 0.045 + pw, length(uv - dp))) * step(0.45, h12(dq));
      col = mix(col, vec3(0.6, 0.62, 0.66), disc);
      spec = max(spec, disc * 0.8);
    }
    float bev = red ? 0.0025 : 0.006;
    spec *= 1.0 - jl(e, bev, pw);
    return mix(col, c2, jg(e, bev, pw, cs.y, 4.0 * bev / cs.y));
  }
  vec2 id, f;
  float e = panelGrid(uv, vec2(1.5), 0.0, id, f);
  float r = h12(id);
  vec3 col = c1 * (1.0 + (r - 0.5) * 0.09 * lodf(1.5, pw));
  col *= 0.95 + 0.07 * vnoise(uv * 1.7 + r * 13.0);
  float bl = lodf(0.02, pw);
  if (bl > 0.01) {
    vec2 bu = mod(id.x + id.y, 2.0) > 0.5 ? uv.yx : uv;
    col *= 1.0 + (vnoise(vec2(bu.x * 2.0, bu.y * 110.0)) - 0.5) * 0.07 * bl;
  }
  col *= 1.0 + 0.05 * (1.0 - smoothstep(0.03, 0.05, e)) * lodf(0.05, pw);
  if (r > 0.9) {
    float cr = abs((f.y - 0.5) - (f.x - 0.5) * (r - 0.95) * 18.0 - 0.06 * sin(f.x * 19.0 + r * 50.0)) * 1.5;
    col = mix(col, c2 * 0.6, jl(cr, 0.0025, pw) * 0.8);
  }
  col *= 1.0 - 0.1 * smoothstep(0.65, 0.85, vnoise(uv * 0.6 + 5.0));
  vec2 gq = floor(uv / 0.11);
  vec2 gp = (gq + 0.3 + 0.4 * vec2(h12(gq + 1.1), h12(gq + 2.3))) * 0.11;
  float gum = step(0.955, h12(gq + 3.7)) * (1.0 - smoothstep(0.009, 0.013, length(uv - gp)));
  col = mix(col, c2 * 0.55, gum * 0.75 * lodf(0.03, pw));
  return mix(col, c2, jg(e, 0.005, pw, 1.5, 0.013));
}
// Asphalte : granulats, rapiéçages d'enrobé neuf, fissures colmatées au bitume, taches d'huile,
// plaques d'égout en fonte (sc 0).
vec3 patAsphalt(vec2 uv, vec3 c1, vec3 c2, float sc, float pw, inout float spec) {
  float big = vnoise(uv * 0.09 + 3.0);
  float mid = vnoise(uv * 0.7 + 11.0);
  vec3 col = mix(c2, c1, 0.55 + 0.4 * (big - 0.5) + 0.3 * (mid - 0.5));
  float ag = h12(floor(uv / 0.017));
  float al = lodf(0.025, pw);
  col *= 1.0 + (step(0.83, ag) * 0.38 - step(ag, 0.12) * 0.22) * al + 0.035 * (1.0 - al);
  vec2 pc = floor(uv / 7.0);
  if (h12(pc + 9.1) > 0.68) {
    vec2 o = (pc + 0.08 + 0.35 * vec2(h12(pc + 1.3), h12(pc + 2.7))) * 7.0;
    vec2 sz = (0.18 + 0.38 * vec2(h12(pc + 4.1), h12(pc + 5.9))) * 7.0;
    vec2 d = abs(uv - o - sz * 0.5) - sz * 0.5;
    float sd = max(d.x, d.y);
    col = mix(col, c2 * (0.95 + 0.1 * mid), (1.0 - smoothstep(-pw * 0.5, pw * 0.5, sd)) * 0.55);
    float seam = jl(abs(sd), 0.008, pw);
    col = mix(col, vec3(0.012), seam * 0.8);
    spec = max(spec, seam * 0.25);
  }
  float tmask = smoothstep(0.58, 0.68, vnoise(uv * 0.13 + 2.0));
  if (tmask > 0.0) {
    float cn = vnoise(uv * 0.42 + 21.0) * 0.75 + vnoise(uv * 1.9 + 4.0) * 0.25;
    float tar = jl(abs(cn - 0.5) * 2.4, 0.007, pw) * tmask;
    col = mix(col, vec3(0.012), tar * 0.8);
    spec = max(spec, tar * 0.25);
  }
  col *= 1.0 - 0.22 * smoothstep(0.74, 0.9, vnoise(uv * 0.55 + 17.0));
  if (sc < 0.5) {
    vec2 mc = floor(uv / 13.0);
    if (h12(mc + 0.5) > 0.45) {
      vec2 q = uv - (mc + 0.2 + 0.6 * vec2(h12(mc + 3.3), h12(mc + 7.7))) * 13.0;
      float d = length(q);
      if (d < 0.48) {
        float cover = 1.0 - smoothstep(0.43, 0.43 + pw, d);
        float ring = jl(abs(d - 0.39), 0.012, pw);
        vec2 g = fract(vec2(q.x + q.y, q.x - q.y) / 0.07) - 0.5;
        float stud = (1.0 - smoothstep(0.18, 0.3, length(g))) * lodf(0.05, pw);
        col = mix(col, vec3(0.075, 0.072, 0.07) * (0.85 + 0.6 * stud) * (1.0 - 0.4 * ring), cover);
        spec = mix(spec, 0.5, cover);
      }
    }
  }
  return col;
}
// Marquage thermoplastique : net, granulats qui affleurent à peine, rares éclats.
vec3 patRoadPaint(vec2 uv, vec3 c1, vec3 c2, float pw, inout float spec) {
  vec3 col = c1 * (0.95 + 0.07 * vnoise(uv * 9.0));
  float ag = h12(floor(uv / 0.016));
  col = mix(col, c2 * 2.0, step(ag, 0.05) * 0.35 * lodf(0.024, pw));
  float w = smoothstep(0.78, 0.86, vnoise(uv * 6.0 + 2.0) * 0.55 + vnoise(uv * 23.0) * 0.45);
  spec = max(spec * (1.0 - w), 0.05);
  return mix(col, c2 * 1.3, w * 0.6);
}
// Toit-terrasse : membrane claire (toit frais) en lés de 2 m soudés, fixations, auréoles d'eau.
vec3 patRoof(vec2 uv, vec3 c1, vec3 c2, float pw) {
  float lx = uv.x / 2.0;
  float lane = floor(lx);
  float s = fract(lx) * 2.0;
  float fe = fract(uv.y / 6.0 + h12(vec2(lane, 2.0)));
  vec3 col = c1 * (0.96 + 0.06 * vnoise(uv * 0.45) + 0.05 * (h12(vec2(lane, 0.0)) - 0.5));
  col *= 1.0 + (vnoise(uv * 9.0) - 0.5) * 0.04 * lodf(0.08, pw);
  float pn = vnoise(uv * 0.28 + 13.0);
  col = mix(col, c2, smoothstep(0.6, 0.7, pn) * 0.45);
  col = mix(col, c2 * 0.85, jl(abs(pn - 0.6) * 3.0, 0.006, pw) * 0.5);
  vec2 fq = vec2(s - 0.06, fract(uv.y / 0.3) * 0.3 - 0.15);
  col = mix(col, c1 * 0.75, (1.0 - smoothstep(0.012, 0.018, length(fq))) * lodf(0.04, pw) * 0.6);
  col = mix(col, c1 * 1.06, jl(abs(s - 0.06), 0.06, pw) * 0.6);
  return mix(col, c2 * 0.7, max(jl(s, 0.004, pw), jl(min(fe, 1.0 - fe) * 6.0, 0.004, pw)) * 0.8);
}
// Terre, gravier, rouille, roche : sc 0 terre et paillis, 1 gravillons, 2 rouille, 3 roche.
vec3 patDirt(vec2 uv, vec3 c1, vec3 c2, float sc, float pw) {
  if (sc == 1.0) {
    vec2 q = uv / 0.035;
    vec2 id = floor(q);
    vec2 f = fract(q) - 0.5 + (vec2(h12(id + 3.3), h12(id + 5.1)) - 0.5) * 0.3;
    float peb = 1.0 - smoothstep(0.3, 0.45, length(f));
    float l = lodf(0.035, pw);
    vec3 col = mix(c1, c2, 0.3 + 0.3 * vnoise(uv * 3.0));
    vec3 stone = mix(c1 * (0.8 + 0.45 * h12(id)), c2 * (0.8 + 0.4 * h12(id + 1.0)), step(0.6, h12(id + 2.0)));
    return mix(col, mix(stone, c2 * 0.55, 1.0 - peb), l);
  }
  float n = vnoise(uv * 6.0) * 0.6 + vnoise(uv * 23.0) * 0.4;
  vec3 col = mix(c2, c1, n);
  if (sc == 0.0) col = mix(col, vec3(0.42, 0.3, 0.16), step(0.93, h12(floor(uv / 0.03))) * 0.5 * lodf(0.04, pw));
  else if (sc == 2.0) col = mix(col, c1 * 1.25, smoothstep(0.6, 0.7, vnoise(uv * 9.0)) * 0.5);
  return col;
}
// Pelouse : brins, tondeuse en bandes (Central Park), trèfles ; sc 1 toiture végétalisée (sedum).
vec3 patGrass(vec2 uv, vec3 c1, vec3 c2, float sc, float pw) {
  if (sc == 1.0) {
    vec2 id = floor(uv / 0.05);
    float h = h12(id);
    vec3 col = mix(c1, c2, step(0.72, h)) * (0.85 + 0.3 * h12(id + 3.0) * lodf(0.05, pw));
    return mix(col, mix(c1, c2, 0.28), 1.0 - lodf(0.05, pw));
  }
  vec3 col = mix(c2, c1, vnoise(uv * 14.0) * 0.7 + 0.3 * vnoise(uv * 41.0)) * (0.86 + 0.22 * vnoise(uv * 2.5));
  col *= 1.0 + 0.06 * (step(0.5, fract(uv.x / 3.0)) - 0.5);
  float fl = step(0.992, h12(floor(uv / 0.05))) * lodf(0.06, pw);
  return mix(col, vec3(0.9, 0.88, 0.7), fl * 0.5);
}

// ----------------------------------------------------------------- intérieurs
// Revêtements muraux : sc 0 panneaux tendus à joints métalliques (c2), 1 soie champagne à
// éventails art déco, 2 papier peint des années 1970 passé (planque), 3 capitons noirs (club).
vec3 patWallPanel(vec2 uv, vec3 c1, vec3 c2, float sc, float pw, inout float spec) {
  if (sc == 1.0) {
    vec2 c = uv / vec2(0.36, 0.2);
    c.x += mod(floor(c.y), 2.0) * 0.5;
    vec2 f = fract(c) - vec2(0.5, 0.0);
    float rr = length(f * vec2(0.36, 0.2)) / 0.2;
    float arcs = jl(abs(fract(rr * 3.0) - 0.5) * 0.067, 0.006, pw) * step(rr, 1.0);
    float rim = jl(abs(rr - 1.0) * 0.2, 0.007, pw);
    vec3 col = c1 * (0.96 + 0.06 * vnoise(vec2(uv.x * 30.0, uv.y * 1.5)) * lodf(0.03, pw));
    spec = max(spec, 0.16);
    return mix(col, c2, max(arcs * 0.75, rim));
  }
  if (sc == 2.0) {
    vec2 f = fract(uv / 0.32) - 0.5;
    float motif = max(jl(abs(length(f) - 0.3) * 0.32, 0.016, pw), (1.0 - smoothstep(0.08, 0.1, length(f))) * 0.8);
    vec3 col = mix(c1, c2, motif * lodf(0.1, pw) + 0.25 * (1.0 - lodf(0.1, pw)));
    col *= 0.88 + 0.16 * vnoise(uv * 0.9 + 3.0);
    col = mix(col, col * vec3(0.9, 0.8, 0.6), smoothstep(0.55, 0.8, vnoise(vec2(uv.x * 1.5, uv.y * 0.4))) * 0.6);
    float strip = fract(uv.x / 0.53);
    return col * (1.0 - 0.3 * jl(min(strip, 1.0 - strip) * 0.53, 0.0025, pw));
  }
  if (sc == 3.0) {
    vec2 q = vec2(uv.x + uv.y, uv.x - uv.y) / 0.3;
    vec2 f = fract(q) - 0.5;
    float puff = 1.0 - max(abs(f.x), abs(f.y)) * 2.0;
    float l = lodf(0.2, pw);
    vec3 col = c1 * mix(1.0, 0.72 + 0.6 * puff, l);
    float btn = (1.0 - smoothstep(0.05, 0.08, length(abs(f) - 0.5))) * l;
    spec = max(spec, 0.28 * puff * l);
    return mix(col, c2 * 1.6, btn);
  }
  float fx = fract(uv.x / 1.2);
  vec3 col = c1 * (0.94 + 0.08 * vnoise(uv * vec2(0.8, 3.0)));
  col *= 1.0 + (vnoise(uv * 160.0) - 0.5) * 0.06 * lodf(0.012, pw);
  col *= 0.95 + 0.1 * (1.0 - abs(fx - 0.5) * 2.0);
  spec = max(spec, 0.12);
  return mix(col, c2, jl(min(fx, 1.0 - fx) * 1.2, 0.006, pw) * 0.9);
}
// Moquettes : sc 0 luxe (treillis art déco à fils d'or ou d'argent), 1 dalles de bureau posées à
// quart de tour, 2 velours VIP à chevrons néon.
vec3 patCarpet(vec2 uv, vec3 c1, vec3 c2, float sc, float pw) {
  vec3 base = c1 * (0.93 + 0.1 * vnoise(uv * 3.0)) * (1.0 + (vnoise(uv * 90.0) - 0.5) * 0.12 * lodf(0.015, pw));
  if (sc == 1.0) {
    vec2 id = floor(uv / 0.5);
    bool alt = mod(id.x + id.y, 2.0) > 0.5;
    float stri = vnoise(alt ? vec2(uv.x * 2.0, uv.y * 70.0) : vec2(uv.x * 70.0, uv.y * 2.0));
    vec3 col = mix(base, c2 * (0.93 + 0.1 * vnoise(uv * 3.0)), alt ? 0.28 : 0.0);
    col *= 1.0 + (stri - 0.5) * 0.12 * lodf(0.02, pw);
    vec2 f = fract(uv / 0.5);
    float e = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y)) * 0.5;
    return col * (1.0 - 0.15 * jg(e, 0.002, pw, 0.5, 0.016));
  }
  if (sc == 2.0) {
    float z = abs(fract(uv.x / 0.6) - 0.5) * 0.6;
    float v = fract((uv.y + z) / 0.3);
    return mix(base, c2, jl(min(v, 1.0 - v) * 0.3, 0.006, pw) * 0.85);
  }
  vec2 c = uv / 0.6;
  float r1 = abs(length(fract(c) - 0.5) - 0.5);
  float r2 = abs(length(fract(c + 0.5) - 0.5) - 0.5);
  float lines = jl(min(r1, r2) * 0.6, 0.007, pw);
  float inner = jl(abs(length(fract(c) - 0.5) - 0.13) * 0.6, 0.005, pw);
  return mix(base, c2, max(lines, inner * 0.7) * 0.85);
}
// Damiers : sc 0 carrelage de diner (25 cm), 1 dalles vinyle mouchetées (30 cm).
vec3 patChecker(vec2 uv, vec3 c1, vec3 c2, float sc, float pw) {
  float s = sc == 1.0 ? 0.3 : 0.25;
  vec2 id = floor(uv / s);
  vec2 f = fract(uv / s);
  float k = mod(id.x + id.y, 2.0);
  vec3 col = mix(c1, c2, k) * (1.0 + (h12(id) - 0.5) * 0.04);
  if (sc == 1.0) col = mix(c1, c2, k * (0.5 + 0.5 * h12(id))) * pepper(uv, 0.008, 0.25, 0.2, pw) * (0.94 + 0.1 * vnoise(uv * 1.1));
  col = mix(mix(c1, c2, 0.5), col, lodf(s * 2.0, pw));
  float e = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y)) * s;
  return mix(col, vec3(0.4), jg(e, 0.0015, pw, s, 0.02));
}
// Bois en lames : sc 0 parquet large, 1 platelage extérieur, 2 poutre, 3 bardage à clin, 4 placage
// (meubles), 5 caisse, 6 douelles verticales (châteaux d'eau), 7 plancher usé (planque).
vec3 patPlank(vec2 uv, vec3 c1, vec3 c2, float sc, float pw, inout float spec) {
  if (sc == 6.0) uv = uv.yx;
  float width = sc == 1.0 ? 0.145 : sc == 2.0 ? 0.25 : sc == 3.0 ? 0.1875 : sc == 4.0 ? 0.0625 : sc == 5.0 ? 0.125 : sc == 6.0 ? 0.083333 : sc == 7.0 ? 0.125 : 0.2;
  float row = floor(uv.y / width);
  float along = uv.x + h12(vec2(row, 5.1)) * 7.0;
  float segLen = (sc == 2.0 || sc == 4.0 || sc == 6.0) ? 50.0 : sc == 5.0 ? 1.0 : 1.85;
  float seg = floor(along / segLen);
  float fseg = fract(along / segLen);
  float fy = fract(uv.y / width);
  float sw = sc == 1.0 ? 0.004 : sc == 3.0 ? 0.003 : 0.0018;
  float seam = jg(min(fy, 1.0 - fy) * width, sw, pw, width, 2.0 * sw / width);
  float endSeam = jl(min(fseg, 1.0 - fseg) * segLen, 0.0015, pw);
  float r = h12(vec2(row, seg));
  float grain = vnoise(vec2(along * 3.0, uv.y * 60.0 + r * 30.0));
  float rings = 0.5 + 0.5 * sin(along * 9.0 + grain * 6.0 + r * 20.0);
  vec3 col = c1 * (1.0 + (r - 0.5) * 0.2 * lodf(width, pw));
  col *= 1.0 + (rings - 0.5) * 0.16 * lodf(0.01, pw);
  if (sc == 7.0) {
    col = mix(col, col * vec3(1.18, 1.12, 1.02), smoothstep(0.6, 0.85, vnoise(vec2(along * 0.6, uv.y * 3.0))) * 0.5);
    col *= 1.0 - 0.18 * smoothstep(0.66, 0.84, vnoise(uv * 0.9 + 3.0));
  } else if (sc == 1.0) {
    col = mix(col, vec3(dot(col, vec3(0.333))) * 1.05, 0.25);
  }
  spec *= 1.0 - seam;
  vec3 gap = c2 * (sc == 1.0 ? 0.35 : 0.8);
  return mix(col, gap, max(seam * (sc == 4.0 ? 0.25 : 0.9), endSeam * 0.8));
}
// Parquet à chevrons (point de Hongrie) : sc 0 chêne miel, sc 1 grandes lames de noyer.
vec3 patParquet(vec2 uv, vec3 c1, vec3 c2, float sc, float pw, inout float spec) {
  float cw = sc == 1.0 ? 0.42 : 0.32;
  float pitch = sc == 1.0 ? 0.13 : 0.1;
  float c = floor(uv.x / cw);
  float s = mod(c, 2.0) > 0.5 ? -1.0 : 1.0;
  float lx = fract(uv.x / cw) * cw;
  float t = uv.y + s * lx;
  float k = floor(t / pitch);
  float ft = fract(t / pitch);
  float seam = jg(min(ft, 1.0 - ft) * pitch * 0.707, 0.0015, pw, pitch * 0.7, 0.03);
  float endS = jl(min(lx, cw - lx), 0.0015, pw);
  float r = h12(vec2(c, k));
  float along = (lx - s * uv.y) * 0.707;
  float rings = 0.5 + 0.5 * sin(along * 26.0 + vnoise(vec2(along * 4.0, k * 7.0)) * 5.0 + r * 9.0);
  vec3 col = c1 * (1.0 + (r - 0.5) * 0.22 * lodf(pitch, pw)) * (1.0 + (rings - 0.5) * 0.14 * lodf(0.01, pw));
  spec *= 1.0 - seam * 0.7;
  return mix(col, c2 * 0.7, max(seam, endS) * 0.85);
}
// Lambris contemporain : panneaux de placage affleurants (60 cm) à joints creux.
vec3 patPanel(vec2 uv, vec3 c1, vec3 c2, float pw) {
  float fx = fract(uv.x / 0.6);
  float r = h12(vec2(floor(uv.x / 0.6), 3.0));
  float grain = 0.5 + 0.5 * sin(uv.x * 40.0 + vnoise(vec2(uv.x * 8.0, uv.y * 0.6)) * 5.0 + r * 9.0);
  vec3 col = c1 * (1.0 + (r - 0.5) * 0.1) * (1.0 + (grain - 0.5) * 0.12 * lodf(0.015, pw));
  return mix(col, c2, jl(min(fx, 1.0 - fx) * 0.6, 0.004, pw) * 0.9);
}
// Carrelages : sc 0 carreaux de métro biseautés, 1 grès 30 × 30, 2 dalles de faux plafond 60 × 60.
vec3 patTile(vec2 uv, vec3 c1, vec3 c2, float sc, float pw, inout float spec) {
  vec2 ts = sc == 0.0 ? vec2(0.15, 0.075) : sc == 1.0 ? vec2(0.3, 0.3) : vec2(0.6, 0.6);
  vec2 id, f;
  float e = panelGrid(uv, ts, sc == 0.0 ? 0.5 : 0.0, id, f);
  float gw = sc == 2.0 ? 0.004 : 0.0022;
  float g = jg(e, gw, pw, ts.y, 4.0 * gw / ts.y);
  vec3 col = c1 * (1.0 + (h12(id) - 0.5) * 0.06 * lodf(ts.y, pw));
  if (sc == 0.0) {
    float l = lodf(0.04, pw);
    col *= mix(1.0, 0.93 + 0.1 * (1.0 - abs(f.y - 0.5) * 2.0), l);
    col *= 1.0 + 0.08 * smoothstep(0.75, 0.92, f.y) * l;
  } else if (sc == 2.0) {
    col *= 1.0 + (vnoise(uv * 50.0) - 0.5) * 0.08 * lodf(0.02, pw);
  }
  spec *= 1.0 - g;
  return mix(col, c2 * (0.92 + 0.12 * vnoise(uv * 20.0)), g);
}
// Terrazzo coulé : éclats de marbre colorés, joints de dilatation en laiton tous les 1,2 m.
vec3 patTerrazzo(vec2 uv, vec3 c1, vec3 c2, float pw) {
  vec2 q = floor(uv * 26.0);
  float r = h12(q);
  vec2 cp = fract(uv * 26.0) - 0.5 + (vec2(h12(q + 1.7), h12(q + 4.3)) - 0.5) * 0.4;
  float inChip = 1.0 - smoothstep(0.18, 0.3, length(cp * vec2(1.0, 1.0 + r)));
  vec3 chip = r < 0.3 ? c2 : r < 0.36 ? vec3(0.66, 0.45, 0.3) : r < 0.42 ? vec3(0.38, 0.5, 0.58) : r < 0.47 ? vec3(0.86, 0.83, 0.77) : c1 * 0.9;
  float l = lodf(0.04, pw);
  vec3 col = mix(mix(c1, c2, 0.08), mix(c1, chip, inChip), l);
  vec2 f = fract(uv / 1.2);
  float e = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y)) * 1.2;
  return mix(col, vec3(0.62, 0.5, 0.28), jg(e, 0.003, pw, 1.2, 0.01) * 0.8);
}
// Marbre en dalles de 1,2 m : veines principales, veinules, voile ; sc 0 joints en laiton (luxe).
vec3 patMarble(vec2 uv, vec3 c1, vec3 c2, float sc, float pw, inout float spec) {
  vec2 id = floor(uv / 1.2);
  vec2 p = uv + vec2(h12(id), h12(id + 3.0)) * 9.0;
  float w = vnoise(p * 0.9) * 0.6 + vnoise(p * 2.3) * 0.3 + vnoise(p * 6.1) * 0.1;
  float vein = 1.0 - smoothstep(0.0, 0.07, abs(sin((p.x * 0.8 + p.y * 0.55 + w * 4.0) * 3.14159)));
  float fine = 1.0 - smoothstep(0.0, 0.03, abs(sin((p.x * 1.9 - p.y * 1.2 + w * 7.0) * 3.14159)));
  vec3 col = mix(c1, c2, w * 0.2);
  col = mix(col, c2, vein * 0.7 * lodf(0.07, pw) + 0.1 * (1.0 - lodf(0.07, pw)));
  col = mix(col, c2, fine * 0.35 * lodf(0.03, pw));
  vec2 f = fract(uv / 1.2);
  float e = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y)) * 1.2;
  if (sc == 0.0) {
    float j = jg(e, 0.004, pw, 1.2, 0.013);
    spec = mix(spec, 0.8, j);
    return mix(col, vec3(0.8, 0.62, 0.3), j);
  }
  return mix(col, c2 * 0.5, jg(e, 0.0015, pw, 1.2, 0.005) * 0.6);
}

// ----------------------------------------------------------------- divers
// Caillebotis : barres porteuses (3 cm), entretoises (10 cm) ; sc 1 grille d'arbre en fonte.
vec3 patGrate(vec2 uv, vec3 c1, vec3 c2, float sc, float pw) {
  if (sc == 1.0) {
    vec2 cc = (floor(uv / 1.2) + 0.5) * 1.2;
    vec2 d = uv - cc;
    float r = length(d);
    float a = atan(d.y, d.x);
    float rings = jl(abs(fract(r / 0.08) - 0.5) * 0.08, 0.012, pw);
    float spokes = jl(abs(fract(a * 3.8197) - 0.5) * r * 0.26, 0.008, pw);
    float m = max(rings, spokes) * step(0.18, r) + step(r, 0.18) * 0.0;
    vec2 f = fract(uv / 1.2);
    float frame = jl(min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y)) * 1.2, 0.03, pw);
    m = max(m, frame);
    m = mix(0.45, m, lodf(0.06, pw));
    return mix(c2, c1 * (0.9 + 0.2 * vnoise(uv * 3.0)), m);
  }
  float fx = fract(uv.x / 0.03);
  float fy = fract(uv.y / 0.1);
  float m = max(jl(min(fx, 1.0 - fx) * 0.03, 0.0035, pw), jl(min(fy, 1.0 - fy) * 0.1, 0.003, pw));
  m = mix(0.42, m, lodf(0.03, pw));
  return mix(c2, c1 * (0.9 + 0.2 * vnoise(uv * 3.0)), m);
}
// Panneaux solaires : modules de 1 × 1,7 m, cellules de 15,6 cm, rubans d'argent, cadre alu.
vec3 patSolar(vec2 uv, vec3 c1, vec3 c2, float pw) {
  vec2 m = fract(uv / vec2(1.0, 1.7));
  float frame = jl(min(min(m.x, 1.0 - m.x), min(m.y, 1.0 - m.y) * 1.7), 0.015, pw);
  vec2 c = fract(uv / 0.156);
  float gap = jg(min(min(c.x, 1.0 - c.x), min(c.y, 1.0 - c.y)) * 0.156, 0.003, pw, 0.156, 0.04);
  float bus = max(jl(abs(c.x - 0.33) * 0.156, 0.0012, pw), jl(abs(c.x - 0.66) * 0.156, 0.0012, pw));
  vec3 col = c1 * (0.92 + 0.12 * vnoise(uv * 0.7));
  col = mix(col, c2 * 0.8, bus * 0.6);
  col = mix(col, c1 * 1.8, gap * 0.5);
  return mix(col, c2, frame);
}
// Grille hexagonale : renvoie la distance au bord de l'alvéole (0 = bord).
float hexEdge(vec2 p) {
  p *= 2.2;
  vec2 r = vec2(1.0, 1.732);
  vec2 h = r * 0.5;
  vec2 a = mod(p, r) - h;
  vec2 b = mod(p - h, r) - h;
  vec2 g = dot(a, a) < dot(b, b) ? a : b;
  vec2 q = abs(g);
  return 0.5 - max(dot(q, normalize(vec2(1.0, 1.732))), q.x);
}
vec3 patHex(vec2 uv, vec3 c1, vec3 c2, float pw, out float edge) {
  float e = hexEdge(uv) / 2.2;
  edge = jg(e, 0.012, pw, 0.4, 0.12);
  vec3 col = c1 * (0.94 + 0.1 * vnoise(uv * 3.0)) * (1.0 + 0.06 * smoothstep(0.03, 0.1, e) * lodf(0.05, pw));
  return mix(col, c2, edge * 0.85);
}
vec3 patSlats(vec2 uv, vec3 c1, vec3 c2, float pw) {
  float f = fract(uv.x * 10.0);
  float gap = jg(min(f, 1.0 - f) * 0.1, 0.012, pw, 0.1, 0.24);
  float r = h12(vec2(floor(uv.x * 10.0), 2.0));
  return mix(c1 * (0.92 + 0.14 * r) * (1.0 + 0.1 * (1.0 - abs(f - 0.5) * 2.0)), c2, gap);
}
// Affiches collées (2085) : collage de rectangles vifs, titres et aplats, bords déchirés.
vec3 patPoster(vec2 uv, vec3 c1, vec3 c2, float pw) {
  vec2 c = uv / vec2(0.6, 0.85);
  c.x += h12(vec2(floor(c.y), 2.0));
  vec2 id = floor(c);
  vec2 f = fract(c);
  float h = h12(id);
  vec3 paper = h < 0.35 ? c1 : sprayCol(h12(id + 4.0)) * 0.88;
  float title = step(0.7, f.y) * step(f.y, 0.86) * step(0.1, f.x) * step(f.x, 0.9);
  float block = step(0.15, f.y) * step(f.y, 0.6) * step(0.18, f.x) * step(f.x, 0.82) * step(0.5, h12(id + 1.0));
  vec3 col = mix(paper, c2, max(title * 0.9, block * 0.8));
  float torn = smoothstep(0.66, 0.7, vnoise(uv * 5.0 + h * 9.0));
  col = mix(col, paper * 0.75, torn * 0.6);
  return col * (1.0 - 0.35 * jl(min(min(f.x, 1.0 - f.x) * 0.6, min(f.y, 1.0 - f.y) * 0.85), 0.004, pw));
}
vec3 patBooks(vec2 uv, vec3 c1) {
  float ci = floor(uv.x * 16.0);
  float shelf = floor(uv.y * 4.0);
  float r = h12(vec2(ci, shelf));
  vec3 b = r < 0.2 ? vec3(0.42, 0.08, 0.08) : r < 0.4 ? vec3(0.08, 0.22, 0.12) : r < 0.6 ? vec3(0.28, 0.17, 0.08) : r < 0.8 ? vec3(0.09, 0.12, 0.28) : vec3(0.48, 0.36, 0.16);
  float fy = fract(uv.y * 4.0);
  float band = step(0.72, fy) * step(fy, 0.76) + step(0.2, fy) * step(fy, 0.23);
  b = mix(b, vec3(0.75, 0.58, 0.22), band);
  b = mix(b, b * 0.35, step(fract(uv.x * 16.0), 0.07));
  float h = 0.68 + 0.27 * h12(vec2(ci, shelf + 0.5));
  return mix(b, c1 * 0.25, step(h, fy));
}
// Écran LED : 0 = vidéo, 1 = publicités, 2 = bandeau défilant (grille de pixels effacée au loin).
vec3 ledScreen(vec2 uv, float sc, vec3 seed, float pw) {
  float t = uTime;
  vec2 px = floor(uv * 20.0) / 20.0;
  vec3 col;
  float id = h13(floor(seed / 6.0));
  if (sc == 2.0) {
    float x = px.x * 4.0 + t * 3.0;
    float ch = floor(x);
    float fy = fract(px.y * 1.2);
    float on = step(0.35, h12(vec2(ch, floor(fy * 5.0)))) * step(0.15, fy) * step(fy, 0.85) * step(0.12, fract(x));
    vec3 hue = mix(vec3(1.0, 0.75, 0.15), vec3(1.0, 0.2, 0.25), step(0.5, h12(vec2(floor(x / 12.0), 3.0))));
    col = hue * on;
  } else if (sc == 1.0) {
    float slot = floor(t / 6.0 + id * 9.0);
    float r = h12(vec2(slot, id));
    vec3 a = 0.5 + 0.5 * cos(6.2832 * (r + vec3(0.0, 0.33, 0.67)));
    vec3 b = 0.5 + 0.5 * cos(6.2832 * (r + 0.4 + vec3(0.0, 0.33, 0.67)));
    vec2 q = fract(uv / vec2(6.0, 4.0));
    float band = step(0.62, q.y) * step(q.y, 0.8);
    float circle = 1.0 - smoothstep(0.18, 0.2, length((q - vec2(0.3, 0.38)) * vec2(1.5, 1.0)));
    float bars = step(0.5, fract(q.x * 14.0 + t * 0.6)) * step(q.y, 0.25);
    col = mix(a * 0.55, b, band);
    col = mix(col, vec3(1.0), circle * 0.85);
    col = mix(col, b * 1.2, bars * 0.6);
  } else {
    vec2 q = px * 0.35 + vec2(t * 0.07, -t * 0.05) + id * 5.0;
    float n1 = fbm(q * 1.7);
    float n2 = fbm(q * 2.3 + 4.0 + t * 0.1);
    col = 0.5 + 0.5 * cos(6.2832 * (n1 * 1.4 + n2 * 0.6 + vec3(0.0, 0.25, 0.55) + t * 0.03));
    col *= 0.55 + 0.6 * n2;
  }
  vec2 f = fract(uv * 20.0);
  float pix = smoothstep(0.0, 0.18, min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y)));
  return col * mix(0.8, 0.35 + 0.65 * pix, lodf(0.05, pw));
}
`;

/** Couleur d'un matériau voxel : renvoie l'albédo (linéaire) et remplit émission/spéculaire. */
export const MATERIAL_GLSL = /* glsl */ `
uniform sampler2D uMatTex;
// Sorties secondaires de voxelMaterial, lues par le matériau du monde.
float gGlint; // éclat du soleil ou de la lune (0..1)
float gMetal; // reflets teintés par la couleur (métaux polis)
float gWetR;  // eau en surface : reflets de la chaussée mouillée (0..1)
vec3 srgb2lin(vec3 c) { return pow(c, vec3(2.2)); }
// Vitrage : pièce éclairée derrière une fenêtre (parallaxe), rideaux et stores. Les étages des
// immeubles n'ont pas tous la même hauteur : au-dessus du rez-de-chaussée, les choix par fenêtre
// ne dépendent que de la colonne (pas de coupure au milieu d'une fenêtre).
vec3 windowRoom(vec3 wpos, vec3 n, vec3 V, vec2 uv, vec3 lc, float sc, float pw) {
  vec3 an = abs(n);
  vec3 Vin = -V;
  vec3 tX = an.x > 0.5 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);
  float dz = max(dot(Vin, -n), 0.08);
  float col = floor(uv.x / 2.25);
  float h1 = h12(vec2(col, 0.37));
  float h2 = h12(vec2(col, 5.1));
  float h3 = h12(vec2(col, 9.7));
  vec3 room;
  bool shop = sc == 2.0;
  if (shop || wpos.y < 4.2) {
    // rez-de-chaussée : vraie boîte (sol à 0,25 m, plafond à 3,9 m, fond à 5 m)
    float dy = Vin.y;
    float tC = dy > 0.001 ? (3.9 - wpos.y) / dy : 1e4;
    float tF = dy < -0.001 ? (0.25 - wpos.y) / dy : 1e4;
    float tB = 5.0 / dz;
    float t = min(min(tC, tF), tB);
    vec3 h = vec3(dot(wpos, tX) + dot(Vin, tX) * t, wpos.y + dy * t, dz * t);
    if (t == tC) {
      float panel = step(abs(fract(h.z / 1.4) - 0.5), 0.12) * step(abs(fract(h.x / 2.0) - 0.5), 0.35);
      room = lc * (0.32 + 1.6 * panel);
    } else if (t == tF) {
      room = lc * (0.2 + 0.08 * step(0.5, fract((h.x + h.z) * 1.25)));
    } else {
      room = lc * 0.42;
      if (shop) {
        float sy = (h.y - 0.35) / 0.42;
        float shelf = floor(sy);
        if (shelf >= 0.0 && shelf < 5.0) {
          float pc = floor(h.x * 7.0);
          float hp = h12(vec2(pc, shelf));
          vec3 prod = 0.5 + 0.5 * cos(6.2832 * (hp + vec3(0.0, 0.33, 0.67)));
          float fy = fract(sy);
          float item = step(fy, 0.5 + 0.35 * h12(vec2(pc, shelf + 9.0))) * step(0.14, fract(h.x * 7.0));
          room = mix(room, lc * prod * 0.85, item * 0.85);
          room *= 1.0 - 0.6 * step(fy, 0.07);
        }
      } else {
        room *= 0.75 + 0.5 * smoothstep(0.4, 2.6, h.y);
      }
    }
    room *= 1.0 - 0.35 * smoothstep(1.0, 5.0, h.z);
  } else {
    // étages : mur du fond en parallaxe, halos des lampes les plus proches, télévision parfois
    float D = 3.0 + 1.5 * h2;
    vec3 P = wpos + Vin * (D / dz);
    vec2 bw = vec2(dot(P, tX), P.y);
    vec2 lp = vec2((floor(bw.x / 2.25) + 0.25 + 0.5 * h3) * 2.25, (floor(bw.y / 3.5 + 0.35) + 0.15) * 3.5);
    vec2 dd = (bw - lp) * vec2(0.5, 0.7);
    room = lc * (0.17 + 0.95 * exp(-dot(dd, dd)));
    room *= 0.75 + 0.5 * vnoise(vec2(col * 1.7, wpos.y * 0.3));
    float tv = smoothstep(0.78, 0.86, vnoise(vec2(col * 2.3 + 4.0, wpos.y * 0.29)));
    room = mix(room, vec3(0.2, 0.4, 1.0) * (0.55 + 0.35 * sin(uTime * 7.0 + h1 * 20.0) * sin(uTime * 2.3)), tv * 0.6);
  }
  if (!shop) {
    // rideaux tirés sur les côtés, ou store vénitien entrouvert (par colonne de fenêtres)
    float kind = h12(vec2(col, 2.2));
    float cx = fract(uv.x / 2.25);
    if (kind < 0.3) {
      float cw = 0.12 + 0.2 * h1;
      float cur = min(step(cx, cw) + step(1.0 - cw, cx), 1.0);
      vec3 fab = lc * mix(vec3(0.95, 0.55, 0.4), vec3(0.6, 0.7, 0.95), step(0.5, h2)) * (0.5 + 0.2 * sin(cx * 90.0));
      room = mix(room, fab, cur * 0.9);
    } else if (kind < 0.5) {
      room *= mix(0.55, 0.3 + 0.7 * step(0.45, fract(wpos.y * 14.0)), lodf(0.07, pw)) * 0.85;
    }
  }
  return room;
}
// Branches : VX_IF(c) est une boucle de 0 ou 1 tour. Sur GPU c'est un « if » ordinaire ; les rendus
// logiciels (SwiftShader : captures automatiques) n'exécutent ainsi que le motif du voxel au lieu de
// tous les motifs. Jamais d'échantillonnage de texture dans un VX_IF (compilateur HLSL de Direct3D).
#define VX_IF(c) for (int vx_k = 0; vx_k < int(c); vx_k++)
vec3 voxelMaterial(int mat, vec3 wpos, vec3 n, vec2 L, vec3 lampC, out vec3 emissive, out float spec) {
  vec4 t0 = texelFetch(uMatTex, ivec2(mat, 0), 0);
  vec4 t1 = texelFetch(uMatTex, ivec2(mat, 1), 0);
  vec4 t2 = texelFetch(uMatTex, ivec2(mat, 2), 0);
  vec4 t3 = texelFetch(uMatTex, ivec2(mat, 3), 0);
  vec3 c1 = t0.rgb;
  vec3 c2 = t1.rgb;
  int pat = int(t0.a * 255.0 + 0.5);
  float sc = floor(t1.a * 255.0 + 0.5);
  int emode = int(t2.a * 255.0 + 0.5);
  spec = t3.r;
  float grime = t3.g;
  float noiseAmt = t3.b;
  vec3 an = abs(n);
  bool wall = an.y < 0.5;
  vec2 uv = an.y > 0.5 ? wpos.xz : (an.x > 0.5 ? vec2(wpos.z, wpos.y) : vec2(wpos.x, wpos.y));
  vec3 vox = floor(wpos * 4.0 - n * 0.5);
  // taille d'un pixel (m) : anticrénelage des joints, effacement des détails au loin
  float pw = max(length(dFdx(wpos)), length(dFdy(wpos)));
  // abscisse orientée vers la droite de qui regarde la façade (textes, graffitis)
  float uRight = uv.x * (an.x > 0.5 ? -sign(n.x) : sign(n.z));
  vec3 col = c1;
  emissive = vec3(0.0);
  gMetal = 0.0;
  gWetR = 0.0;
  gGlint = spec;
  if (pat == 12) {
    // vitrage moderne : reflets du ciel et des façades d'en face, pièce éclairée la nuit
    vec3 V = normalize(cameraPosition - wpos);
    vec2 Lback = sampleLightVol(wpos - n * 0.8);
    bool outside = (L.x > 0.35 && L.x > Lback.x + 0.04) || wpos.y > uLightOrigin.y + uLightSize.y - 0.6;
    gGlint = 0.85;
    spec = 0.0;
    if (!outside) {
      // vu de l'intérieur : la ville (jour ou nuit) à travers la vitre
      col = mix(vec3(0.05, 0.06, 0.09), vec3(0.58, 0.63, 0.7), 1.0 - uNight);
      emissive = srgb2lin(col) * 0.6;
      gGlint = 0.3;
      return srgb2lin(col) * 0.2;
    }
    vec3 R = reflect(-V, n);
    float fr = pow(1.0 - max(dot(V, n), 0.0), 5.0);
    float brk = 0.03 + 0.2 * h12(vec2(floor(uv.x / 2.25), 0.37)) + 0.06 * vnoise(vec2(uv.x * 0.5, wpos.y * 0.3));
    vec3 refl = skyReflect(R, brk) * (0.3 + 0.7 * L.x) + lampC * L.y * 0.25;
    emissive = refl * ((sc == 1.0 ? 0.07 : 0.1) + 0.9 * fr);
    col = c1 * 0.55;
    VX_IF(emode == 2) emissive += windowRoom(wpos, n, V, uv, srgb2lin(t2.rgb), sc, pw) * (0.1 + 1.2 * uNight) * (1.0 - 0.6 * fr);
    return srgb2lin(col);
  }
  VX_IF(pat == 1) col = patBrick(uv, c1, c2, sc, pw, spec);
  VX_IF(pat == 2) col = patSidewalk(uv, c1, c2, 1.0, pw, wall, wpos.y, spec);
  VX_IF(pat == 3) col = patPlank(wall ? uv : (mod(floor(vox.x / 64.0) + floor(vox.z / 64.0), 2.0) > 0.5 ? uv.yx : uv), c1, c2, sc, pw, spec);
  VX_IF(pat == 4 || pat == 15 || pat == 48) col = patRoof(uv, c1, c2, pw);
  VX_IF(pat == 5) col = patStone(uv, c1, c2, sc, pw, spec);
  VX_IF(pat == 6) {
    float s = fract(uv.x * 8.0);
    col = mix(mix(c1, c2, step(0.5, s)), c2 * 1.2, jl(abs(s - 0.5) * 0.125, 0.004, pw) * 0.5);
  }
  VX_IF(pat == 7) col = patWallPanel(uv, c1, c2, sc, pw, spec);
  VX_IF(pat == 8) col = patCarpet(uv, c1, c2, sc, pw);
  VX_IF(pat == 9) col = patChecker(uv, c1, c2, sc, pw);
  VX_IF(pat == 10) col = patPlaster(uv, c1, sc, pw, wpos.y, wall);
  VX_IF(pat == 11) {
    col = patMetal(uv, c1, c2, sc, pw, spec);
    if (t3.r > 0.7) gMetal = 1.0;
  }
  VX_IF(pat == 13) {
    float fn = vnoise(uv * 7.0 + vox.xz * 0.37) * 0.65 + vnoise(uv * 19.0) * 0.35;
    col = mix(c2, c1, smoothstep(0.25, 0.75, fn)) * (0.9 + 0.2 * h13(vox));
  }
  VX_IF(pat == 14) col = patPanel(uv, c1, c2, pw);
  VX_IF(pat == 16) col = patCorrugated(uv, c1, c2, pw, spec);
  VX_IF(pat == 17) col = patPaint(uv, c1, pw);
  VX_IF(pat == 18) col = patDirt(uv, c1, c2, sc, pw);
  VX_IF(pat == 19) col = wall ? patBooks(uv, c1) : vec3(0.3, 0.2, 0.12);
  VX_IF(pat == 20) col = patMarble(uv, c1, c2, sc, pw, spec);
  VX_IF(pat == 21) col = patParquet(uv, c1, c2, sc, pw, spec);
  VX_IF(pat == 22) col = patStone(uv, c1, c2, 3.0, pw, spec);
  VX_IF(pat == 23) col = patGrass(uv, c1, c2, sc, pw);
  VX_IF(pat == 24) {
    float tt = uTime * 5.0;
    float nn = vnoise(uv * 7.0 + vec2(0.0, -tt)) * 0.7 + vnoise(uv * 15.0 + vec2(tt, -tt * 1.3)) * 0.3;
    col = mix(vec3(1.0, 0.32, 0.04), vec3(1.0, 0.85, 0.4), nn);
    emissive = srgb2lin(col) * (1.4 + 1.2 * nn);
    gGlint = 0.0;
    return srgb2lin(col) * 0.4;
  }
  VX_IF(pat == 25) col = c1 * (0.72 + 0.4 * vnoise(vec2(uv.x * 22.0, uv.y * 3.0)));
  VX_IF(pat == 26) col = c1 * (0.92 + 0.1 * vnoise(uv * 9.0)) * (1.0 + (vnoise(uv * 200.0) - 0.5) * 0.08 * lodf(0.01, pw));
  VX_IF(pat == 27) col = patPoster(wall ? vec2(uRight, uv.y) : uv, c1, c2, pw);
  VX_IF(pat == 28) {
    vec2 f = fract(uv * 6.0);
    float r = h12(floor(uv * 6.0));
    col = r < 0.25 ? vec3(0.62, 0.08, 0.12) : r < 0.5 ? vec3(0.08, 0.18, 0.62) : r < 0.75 ? vec3(0.75, 0.55, 0.08) : vec3(0.08, 0.45, 0.22);
    float lead = 1.0 - step(0.08, min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y)));
    col = mix(col, vec3(0.04), lead);
    emissive = srgb2lin(col) * (1.0 - lead) * (0.35 + 1.4 * uNight);
    return srgb2lin(col) * 0.5;
  }
  VX_IF(pat == 29) {
    float s = fract((an.x > 0.5 ? wpos.z : wpos.x) * 2.0);
    float st = smoothstep(0.5 - pw * 2.0, 0.5 + pw * 2.0, s) * (1.0 - smoothstep(1.0 - pw * 2.0, 1.0, s));
    col = mix(c1, c2, st) * (0.95 + 0.06 * vnoise(uv * vec2(3.0, 1.0))) * (1.0 + (vnoise(uv * 160.0) - 0.5) * 0.06 * lodf(0.012, pw));
  }
  VX_IF(pat == 30) col = patAsphalt(uv, c1, c2, sc, pw, spec);
  VX_IF(pat == 31) col = patConcrete(uv, c1, c2, sc, pw, wall, spec);
  VX_IF(pat == 32) col = patTile(uv, c1, c2, sc, pw, spec);
  VX_IF(pat == 33) col = patMetalPanel(uv, c1, c2, sc, pw, wall, spec);
  VX_IF(pat == 34) {
    // mur-rideau : meneaux, allèges émaillées, verre réfléchissant irisé, bureaux éclairés la nuit
    // (plancher des tours à y = 3,5 k, nez de dalle posé par le générateur sous chaque plancher)
    if (!wall) {
      spec = 0.25;
      gGlint = 0.25;
      return srgb2lin(c2 * 0.8);
    }
    vec3 V = normalize(cameraPosition - wpos);
    float mw = sc == 2.0 ? 1.0 : 1.5;
    float cxx = uv.x / mw;
    vec2 cid = vec2(floor(cxx), floor(wpos.y / 3.5));
    float fx = fract(cxx);
    float ey = wpos.y - cid.y * 3.5;
    float mull = jl(min(fx, 1.0 - fx) * mw, sc == 1.0 ? 0.016 : sc == 2.0 ? 0.04 : 0.028, pw);
    float spand = 1.0 - smoothstep(sc == 1.0 ? 0.25 : 0.55, (sc == 1.0 ? 0.25 : 0.55) + pw, ey);
    float frame = max(mull, jl(abs(ey - 2.9), 0.018, pw) * 0.6);
    vec3 R = reflect(-V, n);
    float ndv = max(dot(V, n), 0.0);
    float fr = pow(1.0 - ndv, 5.0);
    float brk = 0.04 + 0.16 * vnoise(vec2(cid.x * 0.37, cid.y * 0.7)) + 0.04 * vnoise(uv * 0.4);
    vec3 refl = skyReflect(R, brk) * (0.35 + 0.65 * L.x) + lampC * L.y * 0.3;
    // couche irisée (verre « holographique ») : plus marquée en incidence rasante
    vec3 irid = 0.5 + 0.5 * cos(6.2832 * (fr * 1.6 + uv.x * 0.013 + wpos.y * 0.009 + vec3(0.0, 0.33, 0.67)));
    refl *= mix(vec3(1.0), irid * 1.5, (sc == 3.0 ? 0.5 : 0.2) * smoothstep(0.0, 0.6, 1.0 - ndv));
    vec3 gl = srgb2lin(c1);
    refl *= mix(vec3(1.0), gl / max(max(gl.r, gl.g), max(gl.b, 1e-3)), 0.45);
    emissive = refl * (0.12 + 0.88 * fr) * (1.0 - frame) * (1.0 - spand * 0.6);
    float lit = step(0.42, h12(vec2(floor(cid.x / 3.0), cid.y) + floor(wpos.xz * 0.05) * 7.3));
    VX_IF(emode == 2 && spand < 0.5 && lit > 0.5) {
      // bureau : rayon dans une boîte (plafond lumineux, sol et bureaux, cloisons du fond)
      vec3 Vin = -V;
      vec3 tX = an.x > 0.5 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);
      float dz = max(dot(Vin, -n), 0.06);
      float dy = Vin.y;
      float tC = dy > 0.001 ? (3.2 - ey) / dy : 1e4;
      float tF = dy < -0.001 ? -ey / dy : 1e4;
      float tB = 6.0 / dz;
      float t = min(min(tC, tF), tB);
      vec3 h = vec3(uv.x + dot(Vin, tX) * t, ey + dy * t, dz * t);
      // teinte par plateau : blanc froid, chaud, parfois une salle aux couleurs de 2085
      float hz = h12(vec2(floor(cid.x / 3.0), cid.y) + 7.7);
      vec3 lc = srgb2lin(t2.rgb) * (0.7 + 0.5 * h12(cid + 1.1));
      lc = mix(lc, vec3(1.0, 0.68, 0.36) * (0.8 + 0.3 * hz), step(0.72, hz) * 0.7);
      lc = mix(lc, mix(vec3(0.85, 0.2, 1.0), vec3(0.15, 0.85, 1.0), step(0.975, hz)), step(0.95, hz) * 0.8);
      vec3 room;
      if (t == tC) {
        float panel = step(abs(fract(h.z / 1.2) - 0.5), 0.17) * step(abs(fract(h.x / 1.5) - 0.5), 0.3);
        room = lc * (0.22 + 1.5 * panel);
      } else if (t == tF) {
        float desk = step(abs(fract(h.z / 2.4 + 0.25) - 0.5), 0.2) * step(abs(fract(h.x / 1.6) - 0.5), 0.38);
        room = lc * mix(0.18, 0.06, desk);
      } else {
        room = lc * (0.22 + 0.22 * smoothstep(3.2, 1.0, h.y));
        room *= 1.0 - 0.7 * step(abs(fract(h.x / 4.5) - 0.5), 0.05);
        room *= 1.0 - 0.35 * step(abs(fract(h.x / 2.25 + 0.3) - 0.5), 0.12) * step(h.y, 2.1);
      }
      room *= 1.0 - 0.35 * smoothstep(1.0, 6.0, h.z);
      if (h12(cid + 3.3) > 0.78) room *= mix(0.72, 0.45 + 0.55 * step(0.5, fract(wpos.y * 12.0)), lodf(0.08, pw));
      emissive += room * (0.06 + 1.15 * uNight) * (1.0 - frame) * (1.0 - 0.5 * fr);
    }
    col = mix(c1 * 0.5, c2, max(frame, spand * 0.85));
    spec = 0.0;
    gGlint = 0.9 * (1.0 - frame);
    return srgb2lin(col);
  }
  VX_IF(pat == 35) {
    // néon : tube saturé, scintillement discret, rares clignotements
    float cluster = h13(floor(wpos * 1.5));
    float blink = step(0.996, h13(vec3(floor(uTime * 7.0), cluster * 91.0, 3.0)));
    float fl = 0.92 + 0.08 * sin(uTime * 52.0 + cluster * 40.0);
    emissive = srgb2lin(t2.rgb) * (2.4 + 1.6 * uNight) * fl * (1.0 - blink * 0.85);
    gGlint = 0.0;
    return srgb2lin(c1) * 0.6;
  }
  VX_IF(pat == 36) {
    vec3 sc3 = ledScreen(uv, sc, vox, pw);
    emissive = srgb2lin(sc3) * (1.1 + 1.3 * uNight);
    gGlint = 0.3;
    return srgb2lin(c1);
  }
  VX_IF(pat == 37) col = patGrate(uv, c1, c2, sc, pw);
  VX_IF(pat == 38) col = patRoadPaint(uv, c1, c2, pw, spec);
  VX_IF(pat == 39) {
    // bandeau LED : diffuseur au cœur plus lumineux, points visibles de près
    float ph = h13(floor(wpos * 0.5)) * 6.28;
    float pulse = emode == 6 ? 0.75 + 0.35 * sin(uTime * 1.6 + ph) : 1.0;
    float prof = 1.0;
    if (wall) {
      prof = 0.72 + 0.45 * (1.0 - abs(fract(wpos.y * 4.0) - 0.5) * 2.0);
      prof *= mix(1.0, 0.86 + 0.28 * (1.0 - smoothstep(0.15, 0.35, abs(fract(uv.x * 40.0) - 0.5))), lodf(0.025, pw));
    }
    emissive = srgb2lin(t2.rgb) * (1.4 + 1.2 * uNight) * pulse * prof;
    gGlint = 0.0;
    return srgb2lin(c1) * 0.7;
  }
  VX_IF(pat == 40) col = patTerrazzo(uv, c1, c2, pw);
  VX_IF(pat == 41) col = c1 * (0.88 + 0.2 * h12(floor(uv * 60.0)) * lodf(0.017, pw)) + c2 * 0.1 * step(0.94, h12(floor(uv * 40.0))) * lodf(0.025, pw);
  VX_IF(pat == 42) col = patGraffiti(vec2(uRight, uv.y), c1, c2, wpos.y, pw, spec);
  VX_IF(pat == 43) col = patSlats(wall ? uv : uv.yx, c1, c2, pw);
  VX_IF(pat == 44) {
    float edge;
    col = patHex(uv, c1, c2, pw, edge);
    if (emode == 6) {
      float ph = h12(floor(uv * 0.5)) * 6.28;
      emissive = srgb2lin(t2.rgb) * edge * (0.35 + 0.3 * sin(uTime * 1.3 + ph)) * (0.4 + 0.8 * uNight);
      emode = 0;
    }
  }
  VX_IF(pat == 45) col = patSolar(uv, c1, c2, pw);
  VX_IF(pat == 46) col = patSidewalk(uv, c1, c2, sc, pw, wall, wpos.y, spec);
  // variation par voxel (discrète, effacée au loin)
  col *= 1.0 + (h13(vox) - 0.5) * noiseAmt * 0.38 * lodf(0.25, pw);
  // salissures extérieures : coulures de pluie, éclaboussures en pied de mur, voile de suie froid
  VX_IF(grime > 0.0) {
    float exposure = clamp(L.x * 1.6, 0.0, 1.0);
    if (wall) {
      float st = smoothstep(0.5, 0.95, vnoise(vec2(uv.x * 2.6, wpos.y * 0.12 + 3.0))) * (0.55 + 0.45 * vnoise(vec2(uv.x * 9.0, wpos.y * 0.7)));
      float foot = 1.0 - smoothstep(0.05, 0.9, wpos.y);
      float veil = vnoise(uv * 0.21 + 5.0);
      float g = (st * 0.55 + foot * 0.5 + (veil - 0.4) * 0.35) * grime * exposure;
      col = mix(col, col * vec3(0.66, 0.68, 0.72), clamp(g, 0.0, 0.85));
    } else {
      col *= 1.0 - (vnoise(uv * 0.5 + 9.0) - 0.3) * grime * 0.22 * exposure;
    }
  }
  if (emode == 1) emissive += srgb2lin(t2.rgb) * 1.6;
  else if (emode == 6) emissive += srgb2lin(t2.rgb) * (0.9 + 0.4 * sin(uTime * 1.6 + h13(floor(wpos)) * 6.28));
  gGlint = spec;
  // pluie : surfaces mouillées (plus sombres, brillantes), flaques nettes
  VX_IF(t3.a > 0.5 && uWet > 0.0 && n.y > 0.5 && L.x > 0.3) {
    float pn = vnoise(uv * 0.32 + 31.0) * 0.65 + vnoise(uv * 1.1 + 5.0) * 0.35;
    float puddle = smoothstep(0.56, 0.6, pn) * smoothstep(0.15, 0.6, uWet);
    float wet = uWet * smoothstep(0.3, 0.5, L.x);
    col *= mix(1.0, 0.6, wet) * (1.0 - 0.3 * puddle);
    spec = max(spec, 0.22 * wet + 0.72 * puddle);
    gGlint = max(gGlint, 0.3 * wet + 0.7 * puddle);
    gWetR = max(wet * 0.45, puddle);
  }
  return srgb2lin(clamp(col, 0.0, 1.0));
}
`;
