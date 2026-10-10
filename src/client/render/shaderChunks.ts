// Morceaux de GLSL partagés par les matériaux du monde, des accessoires et des personnages.

export const COMMON_UNIFORMS_GLSL = /* glsl */ `
uniform highp sampler3D uLightTex;
uniform vec3 uLightOrigin;
uniform vec3 uLightSize;
uniform vec3 uSkyAmb;
uniform vec3 uLampCol;
uniform float uNight;
uniform float uTime;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uFogHeightK;
uniform float uLampBoost;
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
vec2 sampleLightVol(vec3 p) {
  vec3 uvw = (p - uLightOrigin) / uLightSize;
  if (uvw.y >= 1.0) return vec2(1.0, 0.0);
  return texture(uLightTex, clamp(uvw, vec3(0.0005), vec3(0.9995))).rg;
}
// Éclairage ambiant : ciel + lampes. n = normale monde.
vec3 ambientLight(vec2 L, vec3 n) {
  float sky = L.x * L.x;
  float lamp = L.y * (0.55 + 0.45 * L.y);
  return uSkyAmb * sky * (0.72 + 0.28 * n.y) + uLampCol * lamp * uLampBoost;
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

/** Motifs procéduraux des matériaux voxel. */
export const PATTERN_GLSL = /* glsl */ `
vec3 patBrick(vec2 uv, vec3 c1, vec3 c2) {
  vec2 b = uv * vec2(4.0, 8.0);
  float row = floor(b.y);
  b.x += mod(row, 2.0) * 0.5;
  vec2 id = floor(b);
  vec2 f = fract(b);
  float mx = min(f.x, 1.0 - f.x) * 0.25;
  float my = min(f.y, 1.0 - f.y) * 0.125;
  float mortar = 1.0 - smoothstep(0.006, 0.014, min(mx, my));
  float r = h12(id);
  vec3 bc = c1 * (0.8 + 0.4 * r);
  bc = mix(bc, bc * vec3(0.72, 0.68, 0.66), step(0.86, h12(id + 7.31)));
  bc *= 0.92 + 0.16 * vnoise(uv * 28.0);
  return mix(bc, c2, mortar);
}
vec3 patCobble(vec2 uv, vec3 c1, vec3 c2) {
  vec2 c = uv * vec2(5.0, 6.5);
  float row = floor(c.y);
  c.x += h12(vec2(row, 3.7)) * 0.9;
  vec2 id = floor(c);
  vec2 f = fract(c) - 0.5;
  float d = mix(max(abs(f.x), abs(f.y) * 1.05), length(f) * 0.88, 0.55);
  float stone = 1.0 - smoothstep(0.36, 0.47, d);
  float r = h12(id);
  vec3 sc = c1 * (0.72 + 0.56 * r) * (0.88 + 0.35 * (0.45 - d));
  return mix(c2, sc, stone);
}
vec3 patFlag(vec2 uv, vec3 c1, vec3 c2) {
  vec2 c = uv * vec2(1.4, 1.75);
  float row = floor(c.y);
  c.x += mod(row, 2.0) * 0.5 + h12(vec2(row, 1.0)) * 0.3;
  vec2 id = floor(c);
  vec2 f = fract(c);
  float e = min(min(f.x, 1.0 - f.x) / 1.4, min(f.y, 1.0 - f.y) / 1.75);
  float joint = 1.0 - smoothstep(0.005, 0.013, e);
  vec3 sc = c1 * (0.84 + 0.3 * h12(id)) * (0.9 + 0.2 * vnoise(uv * 7.0));
  return mix(sc, c2, joint);
}
vec3 patPlank(vec2 uv, vec3 c1, vec3 c2, float sc) {
  float width = sc == 1.0 ? 0.25 : sc == 3.0 ? 0.1875 : sc == 2.0 ? 0.25 : sc >= 4.0 ? 0.0625 : 0.125;
  float row = floor(uv.y / width);
  float along = uv.x + h12(vec2(row, 5.1)) * 4.0;
  float segLen = sc >= 4.0 ? 50.0 : 1.6;
  float seg = floor(along / segLen);
  float fseg = fract(along / segLen);
  float fy = fract(uv.y / width);
  float seam = 1.0 - smoothstep(0.0, 0.07, min(fy, 1.0 - fy));
  float endSeam = 1.0 - smoothstep(0.0, 0.012, min(fseg, 1.0 - fseg) * segLen);
  float grain = 0.5 + 0.5 * sin(along * 7.0 + vnoise(vec2(along * 1.5, row * 3.0)) * 7.0);
  vec3 col = c1 * (0.84 + 0.32 * h12(vec2(row, seg))) * (0.9 + 0.14 * grain);
  return mix(col, c2, max(seam * (sc >= 4.0 ? 0.25 : 0.85), endSeam * 0.8));
}
vec3 patSlate(vec2 uv, vec3 c1, vec3 c2) {
  vec2 c = uv * vec2(5.0, 6.0);
  float row = floor(c.y);
  c.x += mod(row, 2.0) * 0.5;
  vec2 id = floor(c);
  vec2 f = fract(c);
  float gap = 1.0 - smoothstep(0.0, 0.05, min(f.x, 1.0 - f.x));
  vec3 col = c1 * (0.8 + 0.35 * h12(id)) * (0.78 + 0.25 * f.y);
  return mix(col, c2, max(gap * 0.7, (1.0 - smoothstep(0.0, 0.08, f.y)) * 0.6));
}
vec3 patAshlar(vec2 uv, vec3 c1, vec3 c2, float sc) {
  vec2 bs = sc == 1.0 ? vec2(0.25, 0.25) : sc == 2.0 ? vec2(1.0, 0.5) : vec2(0.5, 0.25);
  vec2 c = uv / bs;
  float row = floor(c.y);
  c.x += mod(row, 2.0) * 0.5;
  vec2 id = floor(c);
  vec2 f = fract(c);
  float e = min(min(f.x, 1.0 - f.x) * bs.x, min(f.y, 1.0 - f.y) * bs.y);
  float joint = 1.0 - smoothstep(0.004, 0.011, e);
  vec3 col = c1 * (0.9 + 0.2 * h12(id)) * (0.92 + 0.14 * vnoise(uv * 9.0));
  return mix(col, c2, joint);
}
vec3 patDamask(vec2 uv, vec3 c1, vec3 c2) {
  vec2 c = uv * vec2(6.0, 4.0);
  c.x += mod(floor(c.y), 2.0) * 0.5;
  vec2 f = fract(c) - 0.5;
  float d = abs(f.x) * 1.25 + abs(f.y);
  float motif = smoothstep(0.42, 0.37, d) * (1.0 - smoothstep(0.26, 0.2, d)) + smoothstep(0.11, 0.06, length(f));
  return mix(c1, c2, clamp(motif, 0.0, 1.0));
}
vec3 patStripes(vec2 uv, vec3 c1, vec3 c2) {
  float s = step(0.5, fract(uv.x * 8.0));
  float pin = 1.0 - smoothstep(0.0, 0.04, abs(fract(uv.x * 8.0) - 0.5));
  return mix(mix(c1, c2, s), c2 * 1.25, pin * 0.5);
}
vec3 patCarpet(vec2 uv, vec3 c1, vec3 c2) {
  vec2 f = fract(uv * 1.5) - 0.5;
  float diamond = abs(f.x) + abs(f.y);
  float ring = 1.0 - smoothstep(0.0, 0.04, abs(diamond - 0.33));
  float center = 1.0 - smoothstep(0.08, 0.13, diamond);
  float border = 1.0 - smoothstep(0.0, 0.03, abs(max(abs(f.x), abs(f.y)) - 0.47));
  float dots = 1.0 - smoothstep(0.03, 0.05, length(abs(f) - vec2(0.33)));
  float m = max(max(ring, center), max(border, dots));
  vec3 col = c1 * (0.88 + 0.14 * vnoise(uv * 40.0));
  return mix(col, c2, m * 0.85);
}
vec3 patChecker(vec2 uv, vec3 c1, vec3 c2) {
  vec2 c = uv * 4.0;
  float k = mod(floor(c.x) + floor(c.y), 2.0);
  vec2 f = fract(c);
  float grout = 1.0 - smoothstep(0.0, 0.04, min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y)));
  return mix(mix(c1, c2, k), vec3(0.45), grout * 0.5);
}
vec3 patPanel(vec2 uv, vec3 c1, vec3 c2) {
  vec2 f = fract(uv / vec2(0.5, 0.5));
  float e = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y));
  float frame = 1.0 - smoothstep(0.1, 0.13, e);
  float bevel = smoothstep(0.13, 0.17, e) * (1.0 - smoothstep(0.17, 0.21, e));
  vec3 col = mix(c1, c2, frame * 0.75);
  return col * (1.0 + bevel * 0.22);
}
vec3 patRoofTile(vec2 uv, vec3 c1, vec3 c2) {
  vec2 c = uv * vec2(6.0, 5.0);
  float row = floor(c.y);
  c.x += mod(row, 2.0) * 0.5;
  vec2 id = floor(c);
  vec2 f = fract(c);
  float round_ = sin(f.x * 3.14159);
  vec3 col = c1 * (0.75 + 0.3 * h12(id)) * (0.7 + 0.35 * round_) * (0.8 + 0.2 * f.y);
  return mix(col, c2, 1.0 - smoothstep(0.0, 0.08, f.y));
}
vec3 patBooks(vec2 uv, vec3 c1) {
  float ci = floor(uv.x * 16.0);
  float shelf = floor(uv.y * 4.0);
  float r = h12(vec2(ci, shelf));
  vec3 b = r < 0.2 ? vec3(0.42, 0.08, 0.08) : r < 0.4 ? vec3(0.08, 0.22, 0.12) : r < 0.6 ? vec3(0.28, 0.17, 0.08) : r < 0.8 ? vec3(0.09, 0.12, 0.28) : vec3(0.48, 0.36, 0.16);
  float fy = fract(uv.y * 4.0);
  float band = step(0.72, fy) * step(fy, 0.76) + step(0.2, fy) * step(fy, 0.23);
  b = mix(b, vec3(0.75, 0.58, 0.22), band);
  float gap = step(fract(uv.x * 16.0), 0.07);
  b = mix(b, b * 0.35, gap);
  float h = 0.68 + 0.27 * h12(vec2(ci, shelf + 0.5));
  return mix(b, c1 * 0.25, step(h, fy));
}
vec3 patMarble(vec2 uv, vec3 c1, vec3 c2) {
  float v = fbm(uv * 1.3 + vec2(fbm(uv * 2.7) * 2.0));
  float vein = 1.0 - smoothstep(0.0, 0.06, abs(sin((uv.x + uv.y * 0.6 + v * 3.0) * 3.14159)));
  vec3 col = mix(c1, c2, vein * 0.55 + v * 0.18);
  vec2 f = fract(uv * 2.0);
  float joint = 1.0 - smoothstep(0.0, 0.015, min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y)));
  return mix(col, c2 * 0.7, joint * 0.5);
}
vec3 patParquet(vec2 uv, vec3 c1, vec3 c2) {
  vec2 c = uv * 4.0;
  vec2 id = floor(c);
  vec2 f = fract(c);
  bool alt = mod(id.x + id.y, 2.0) > 0.5;
  float s = alt ? f.x * 3.0 : f.y * 3.0;
  float pid = floor(s);
  float st = fract(s);
  float seam = 1.0 - smoothstep(0.0, 0.1, min(st, 1.0 - st));
  vec3 col = mix(c1, c2, h12(id * 3.0 + pid) * 0.6);
  col *= 0.92 + 0.12 * sin((alt ? f.y : f.x) * 30.0 + pid);
  return mix(col, c2 * 0.55, seam * 0.6);
}
vec3 patPoster(vec2 uv, vec3 c1, vec3 c2) {
  vec2 c = uv / vec2(0.6, 0.8);
  vec2 id = floor(c);
  vec2 f = fract(c);
  vec3 paper = mix(c1, vec3(0.85, 0.72, 0.5), h12(id)) * (0.82 + 0.18 * h12(id + 1.0));
  float border = 1.0 - step(0.04, min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y)));
  float lines = step(0.45, fract(f.y * 7.0)) * step(0.12, f.x) * step(f.x, 0.88) * step(0.12, f.y) * step(f.y, 0.72);
  lines *= step(0.35, vnoise(vec2(f.x * 26.0, floor(f.y * 7.0) * 3.1 + id.x)));
  float title = step(0.78, f.y) * step(f.y, 0.92) * step(0.1, f.x) * step(f.x, 0.9);
  vec3 ink = mix(c2, vec3(0.5, 0.08, 0.08), step(0.5, h12(id + 3.0)));
  vec3 col = mix(paper, ink, max(lines * 0.55, title * 0.85));
  return mix(col, paper * 0.5, border);
}
vec3 patStained(vec2 uv) {
  vec2 c = uv * 6.0;
  vec2 id = floor(c);
  vec2 f = fract(c);
  float r = h12(id);
  vec3 g = r < 0.25 ? vec3(0.62, 0.08, 0.12) : r < 0.5 ? vec3(0.08, 0.18, 0.62) : r < 0.75 ? vec3(0.75, 0.55, 0.08) : vec3(0.08, 0.45, 0.22);
  return g;
}
float stainedLead(vec2 uv) {
  vec2 f = fract(uv * 6.0);
  return 1.0 - step(0.08, min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y)));
}
`;

/** Couleur d'un matériau voxel : renvoie l'albédo (linéaire) et remplit émission/spéculaire. */
export const MATERIAL_GLSL = /* glsl */ `
uniform sampler2D uMatTex;
vec3 srgb2lin(vec3 c) { return pow(c, vec3(2.2)); }
vec3 voxelMaterial(int mat, vec3 wpos, vec3 n, vec2 L, out vec3 emissive, out float spec) {
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
  vec3 col = c1;
  emissive = vec3(0.0);
  if (pat == 1) col = patBrick(uv, c1, c2);
  else if (pat == 2) col = patCobble(uv, c1, c2);
  else if (pat == 3) col = patPlank(wall ? uv : (mod(floor(vox.x / 64.0) + floor(vox.z / 64.0), 2.0) > 0.5 ? uv.yx : uv), c1, c2, sc);
  else if (pat == 4) col = patSlate(uv, c1, c2);
  else if (pat == 5) col = patAshlar(uv, c1, c2, sc);
  else if (pat == 6) col = patStripes(uv, c1, c2);
  else if (pat == 7) col = patDamask(uv, c1, c2);
  else if (pat == 8) col = patCarpet(uv, c1, c2);
  else if (pat == 9) col = patChecker(uv, c1, c2);
  else if (pat == 10) col = c1 * (0.92 + 0.12 * fbm(uv * 2.5));
  else if (pat == 11) col = c1 * (0.84 + 0.22 * vnoise(uv * 11.0));
  else if (pat == 12) {
    // vitre : petits bois, reflets, fenêtres éclairées la nuit
    vec2 f = fract(uv * vec2(4.0, 3.0));
    float bar = 1.0 - step(0.075, min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y)));
    vec2 pane = floor(uv * vec2(4.0, 3.0));
    // côté rue ou côté pièce ? on compare le ciel visible devant la vitre et derrière le mur
    vec2 Lback = sampleLightVol(wpos - n * 0.8);
    bool outside = L.x > 0.35 && L.x > Lback.x + 0.04;
    if (outside) {
      col = c1 * (0.75 + 0.3 * h12(pane));
      if (emode == 2) {
        float lit = (0.55 + 0.45 * h12(pane + 3.1)) * (1.0 - bar);
        float curtain = step(0.82, h12(floor(uv * 0.5) + 1.7));
        emissive = srgb2lin(t2.rgb) * lit * (0.1 + 1.2 * uNight) * (1.0 - curtain * 0.7);
      }
    } else {
      // vu de l'intérieur : la lumière du jour à travers la vitre
      col = mix(vec3(0.05, 0.06, 0.08), vec3(0.55, 0.6, 0.65), 1.0 - uNight);
      emissive = srgb2lin(col) * 0.6 * (1.0 - bar);
    }
    col = mix(col, vec3(0.08, 0.07, 0.06), bar);
    emissive *= 1.0 - bar;
    return srgb2lin(col);
  }
  else if (pat == 13) col = mix(c2, c1, smoothstep(0.25, 0.75, fbm(uv * 7.0 + vox.xz * 0.37)));
  else if (pat == 14) col = patPanel(uv, c1, c2);
  else if (pat == 15) col = patRoofTile(uv, c1, c2);
  else if (pat == 16) col = c1 * (0.78 + 0.32 * (0.5 + 0.5 * sin(uv.x * 62.83)));
  else if (pat == 17) col = c1 * (0.94 + 0.06 * vnoise(vec2(uv.x * 40.0, uv.y * 2.0))) * (0.95 + 0.08 * fbm(uv * 3.0));
  else if (pat == 18) col = mix(c1, c2, fbm(uv * 4.0));
  else if (pat == 19) col = wall ? patBooks(uv, c1) : vec3(0.3, 0.2, 0.12);
  else if (pat == 20) col = patMarble(uv, c1, c2);
  else if (pat == 21) col = patParquet(uv, c1, c2);
  else if (pat == 22) col = patFlag(uv, c1, c2);
  else if (pat == 23) col = mix(c2, c1, vnoise(uv * 14.0)) * (0.85 + 0.25 * vnoise(uv * 3.0));
  else if (pat == 24) {
    float tt = uTime * 5.0;
    float nn = vnoise(uv * 7.0 + vec2(0.0, -tt)) * 0.7 + vnoise(uv * 15.0 + vec2(tt, -tt * 1.3)) * 0.3;
    col = mix(vec3(1.0, 0.32, 0.04), vec3(1.0, 0.85, 0.4), nn);
    emissive = srgb2lin(col) * (1.4 + 1.2 * nn);
    return srgb2lin(col) * 0.4;
  }
  else if (pat == 25) col = c1 * (0.72 + 0.4 * vnoise(vec2(uv.x * 22.0, uv.y * 3.0)));
  else if (pat == 26) col = c1 * (0.9 + 0.08 * sin(uv.x * 300.0) * sin(uv.y * 300.0) + 0.1 * vnoise(uv * 9.0));
  else if (pat == 27) col = patPoster(uv, c1, c2);
  else if (pat == 28) {
    col = patStained(uv);
    float lead = stainedLead(uv);
    col = mix(col, vec3(0.04), lead);
    emissive = srgb2lin(col) * (1.0 - lead) * (0.35 + 1.4 * uNight);
    return srgb2lin(col) * 0.5;
  }
  else if (pat == 29) col = mix(c1, c2, step(0.5, fract((an.x > 0.5 ? wpos.z : wpos.x) * 2.0)));
  // variation par voxel
  col *= 1.0 + (h13(vox) - 0.5) * noiseAmt * 0.38;
  // salissures extérieures (suie, éclaboussures)
  if (grime > 0.0 && wall) {
    float exposure = clamp(L.x * 1.6, 0.0, 1.0);
    float gN = fbm(uv * vec2(1.2, 0.45));
    float streak = vnoise(vec2(uv.x * 5.0, uv.y * 0.35));
    float bottom = 1.0 - smoothstep(0.0, 1.0, wpos.y);
    float top = smoothstep(6.0, 14.0, wpos.y) * 0.4;
    float g = (gN * 0.55 + streak * 0.3 + bottom * 0.6 + top) * grime * exposure;
    col *= 1.0 - clamp(g, 0.0, 1.0) * 0.42;
  } else if (grime > 0.0) {
    col *= 1.0 - fbm(uv * 0.9) * grime * 0.25;
  }
  if (emode == 1) emissive += srgb2lin(t2.rgb) * 1.6;
  return srgb2lin(clamp(col, 0.0, 1.0));
}
`;
