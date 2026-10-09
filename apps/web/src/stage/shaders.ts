/**
 * Node shaders (CP6 Gate 1), fitted to the approved PNGs (references/cp6, measured profiles in
 * docs/CP6_GATE1_NODE.md). Two instanced draws per scene, whatever the number of nodes:
 *
 * 1. BODY: a real sphere mesh (shared geometry). Smoked graphite glass: near-black body, a soft
 *    reflection of a large light at the upper left, a Fresnel glow just inside the rim, and
 *    faint cellular veins (procedural, in object space, so there are no UV seams or textures).
 * 2. AURA: a camera-facing quad per node, drawn after the bodies with premultiplied "light"
 *    blending. It draws what sits ON and AROUND the silhouette analytically, in pixels: the thin
 *    luminous rim, the halo, the top spark, link ports, and the state rings (selection,
 *    partition fence, recovery arc). Analytic lines stay crisp at every size and DPR.
 *
 * Colours are written in display (sRGB) values, because the references are 2D images composited
 * in display space; the canvas is created with `linear` + `flat` so three.js does not convert.
 */

/** Shared GLSL: the angular brightness profile of the rim (measured on the Investigate hero). */
const PROFILE = /* glsl */ `
  // Measured relative to the upper left (1.0): lower left 0.81, lower right 0.73, upper right 0.52.
  float rimProfile(float phi) {
    return 0.85 + 0.15 * max(cos(phi - 2.0), 0.0) - 0.42 * pow(max(cos(phi - 0.70), 0.0), 2.0) - 0.12 * pow(max(cos(phi + 0.785), 0.0), 2.0);
  }
`;

export const bodyVertex = /* glsl */ `
  attribute vec4 aLight;   // rim, inner, sheen, fault
  attribute vec4 aTone;    // recovery, warmth, radiusPx, broken
  varying vec3 vN;
  varying vec3 vObj;
  varying vec4 vLight;
  varying vec4 vTone;
  void main() {
    vObj = position;
    vN = normalize(normalMatrix * mat3(instanceMatrix) * normal);
    vLight = aLight;
    vTone = aTone;
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  }
`;

export const bodyFragment = /* glsl */ `
  uniform float uMicro;        // 1 = full tier (veins and grain), 0 = reduced tier
  uniform vec3 uSoftbox;       // view-space direction of the large reflected light
  varying vec3 vN;
  varying vec3 vObj;
  varying vec4 vLight;
  varying vec4 vTone;
  ${PROFILE}

  vec3 hash3(vec3 p) {
    p = vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6)));
    return fract(sin(p) * 43758.5453123);
  }
  // Smooth value noise and two-octave fbm, for the smoky, uneven reflection.
  float noise3(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = mix(mix(hash3(i).x, hash3(i + vec3(1, 0, 0)).x, f.x), mix(hash3(i + vec3(0, 1, 0)).x, hash3(i + vec3(1, 1, 0)).x, f.x), f.y);
    float b = mix(mix(hash3(i + vec3(0, 0, 1)).x, hash3(i + vec3(1, 0, 1)).x, f.x), mix(hash3(i + vec3(0, 1, 1)).x, hash3(i + vec3(1, 1, 1)).x, f.x), f.y);
    return mix(a, b, f.z);
  }
  float smoke(vec3 p) {
    return 0.65 * noise3(p) + 0.35 * noise3(p * 2.3 + 4.1);
  }
  /**
   * Nearest cell border (F2 - F1) plus the gradient of that field, from the two nearest feature
   * points. The gradient lets the veins perturb the surface normal, so ridges catch the light
   * instead of being painted on as brightness.
   */
  vec4 cellEdge(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    float d1 = 8.0;
    float d2 = 8.0;
    vec3 r1 = vec3(0.0);
    vec3 r2 = vec3(0.0);
    for (int z = -1; z <= 1; z++)
      for (int y = -1; y <= 1; y++)
        for (int x = -1; x <= 1; x++) {
          vec3 g = vec3(float(x), float(y), float(z));
          vec3 r = g + hash3(i + g) - f;
          float d = dot(r, r);
          if (d < d1) { d2 = d1; r2 = r1; d1 = d; r1 = r; }
          else if (d < d2) { d2 = d; r2 = r; }
        }
    d1 = sqrt(d1); d2 = sqrt(d2);
    // ∇(|p−c2| − |p−c1|); r = c − p, so the derivative with respect to p is −r/|r|.
    return vec4(d2 - d1, normalize(r1) / max(d1, 1e-3) - normalize(r2) / max(d2, 1e-3));
  }

  void main() {
    vec3 n = normalize(vN);
    float rim = vLight.x, inner = vLight.y, sheen = vLight.z, fault = vLight.w;
    float recovery = vTone.x, warmth = vTone.y, R = vTone.z;

    // ── surface ────────────────────────────────────────────────────────────────────────────
    // Cellular veins in object space (no textures, no UV seams). Only on spheres large enough
    // to show them; on small ones the references show none and they would read as noise.
    float micro = uMicro * smoothstep(26.0, 60.0, R);
    float veins = 0.0;
    if (micro > 0.0) {
      // Domain warp: bending the lattice before looking it up turns the regular honeycomb into
      // irregular cells of varying size, like the references.
      vec3 q = vObj * 10.2 + 1.7;
      q += 0.85 * vec3(smoke(vObj * 2.1), smoke(vObj * 2.1 + 17.0), smoke(vObj * 2.1 + 31.0)) - 0.425;
      vec4 cell = cellEdge(q);
      // A continuous web of rounded seams along the cell borders. The width never falls below
      // a couple of pixels (fwidth), so thin veins fade instead of aliasing into sparkles.
      float width = max(0.024, 1.7 * fwidth(cell.x));
      float t = cell.x / width;
      // Not every seam is equally pronounced.
      float strength = 0.35 + 0.95 * smoke(vObj * 3.4 + 23.0);
      float seam = exp(-5.5 * t * t) * micro * strength;
      // Tilt the normal down the seam's flanks (zero on the crest, steepest halfway down), so
      // the ridge catches the light by itself instead of being painted on.
      vec3 tangential = cell.yzw - n * dot(cell.yzw, n);
      n = normalize(n + tangential * (11.0 * t * seam) * 0.0105);
      veins = seam;
    }

    float ndv = clamp(n.z, 0.0, 1.0);    // orthographic camera: V = (0, 0, 1)
    float e = 1.0 - ndv;
    float phi = atan(n.y, n.x);

    // ── the broad upper-left reflection ────────────────────────────────────────────────────
    // A large soft light behind, above and to the left. Fitted to all six reference nodes
    // (least squares over their interiors): brightness = A·exp(k·(n·L − 1))·(1 + F·(1 − n·V)^p).
    // The angle is measured on the NORMAL, not the reflection vector: that is what makes the
    // highlight a broad wash across the upper-left surface instead of a crescent at the rim.
    float d = dot(n, normalize(uSoftbox));
    // The grazing-angle boost is stronger on small spheres: a 29 px rail node is bright in a
    // band near its rim and almost black at half radius (measured 179 at 0.8 R, 59 at 0.55 R),
    // while the 95 px hero falls off gently. Fitted exponent 0.33 small, 0.6 large.
    float big = smoothstep(31.0, 44.0, R);
    float fresnel = 1.0 + mix(3.4, 2.7, big) * pow(e, mix(0.47, 0.6, big));
    // Smoky and uneven, not a clean gradient (two octaves of value noise, static).
    float haze = smoke(vObj * 3.0 + 3.0);
    float highlight = 1.42 * exp(3.15 * (d - 1.0)) * fresnel * sheen * mix(0.62, 1.3, haze);
    // Veins are shallow GROOVES: the surface darkens slightly along the seam, while the bent
    // normal above catches the light. Never bright speckles painted onto the surface.
    highlight *= 1.0 - 0.04 * veins;
    // Soft clip: linear through the mid-tones (so the ramp can be matched directly) and then
    // rolling off to a ceiling of 0.95, because the reference's brightest surface measures
    // ≈ 242/255 and never clips to white.
    float knee = 0.64, ceil = 0.92;
    highlight = highlight < knee ? highlight : knee + (ceil - knee) * (1.0 - exp(-(highlight - knee) / (ceil - knee)));

    vec3 col = vec3(0.043, 0.043, 0.045);
    // The web stays faintly visible in the dark half too, as it does in the references.
    col += vec3(0.0105, 0.0102, 0.0099) * veins;
    // Measured on the references' lit surfaces: Simulate and Configure are faintly cool, the
    // Investigate hero faintly warm. A few percent either way — not a tan or blue cast.
    vec3 sheenTint = mix(vec3(0.968, 1.011, 1.021), vec3(1.021, 0.998, 0.980), warmth);
    col += sheenTint * highlight;

    // ── glow just inside the rim ───────────────────────────────────────────────────────────
    vec3 innerWarm = vec3(1.0, 0.80, 0.65);
    vec3 innerNeutral = vec3(0.86, 0.92, 0.93);
    vec3 innerCol = mix(innerNeutral, innerWarm, warmth);
    innerCol = mix(innerCol, vec3(0.97, 0.78, 0.51), fault);
    innerCol = mix(innerCol, vec3(0.62, 0.74, 1.0), recovery);
    // This fills in the edge on the UNLIT side; where the reflection above is already strong it
    // would double-count, because the fitted model covers the lit side completely.
    float glow = smoothstep(0.22, 1.0, e) * mix(1.0, rimProfile(phi), 0.7);
    col += innerCol * glow * mix(0.26, 0.38, warmth) * inner * min(rim, 1.6) * (1.0 - smoothstep(0.05, 0.45, highlight));

    // ── warm spill from the rim ────────────────────────────────────────────────────────────
    // The luminous rim lights the surface next to it. Measured as red-minus-blue at 0.85 R:
    // hero +39 at the top, Configure +14, Simulate +5, while the reflection itself is faintly
    // COOL (−9 … −11 at 135°). So the spill is gated away from the reflection's direction.
    // It shifts hue without adding much luminance, so it is a tint, not an extra light.
    // Gated by the angle to the light, not by brightness, so it does not depend on exposure:
    // the reflection's own direction stays faintly cool, the surface beside it turns warm.
    // Concentrated near the top, where the reference is warmest (+36 red-minus-blue), over a
    // small uniform bias that keeps the rest of the dark half at the measured +4 … +11.
    float topward = 0.18 + 0.82 * pow(max(cos(phi - 1.5708), 0.0), 2.0);
    float spill = smoothstep(0.05, 0.9, e) * topward * warmth * sheen * 0.60 * big;
    spill *= 1.0 - smoothstep(0.32, 0.60, d);
    col *= mix(vec3(1.0), vec3(1.35, 0.76, 0.28), clamp(spill, 0.0, 0.45));

    // Fine grain so large dark areas do not band.
    if (uMicro > 0.5) col += (hash3(floor(gl_FragCoord.xyz)).x - 0.5) * 0.006;
    gl_FragColor = vec4(col, 1.0);
  }
`;

export const auraVertex = /* glsl */ `
  attribute vec4 aA;      // rim, broken, segmented, halo
  attribute vec4 aB;      // fault, recovery, selection, fence
  attribute vec4 aC;      // warmth, radiusPx, spark, (unused)
  attribute vec4 aPorts;  // up to four port angles (radians); < -9 = none
  varying vec2 vP;        // pixels from the node centre
  varying vec4 vA;
  varying vec4 vB;
  varying vec4 vC;
  varying vec4 vPorts;
  uniform float uExtent;  // quad half-size in node radii
  void main() {
    vA = aA; vB = aB; vC = aC; vPorts = aPorts;
    vP = position.xy * uExtent * aC.y;
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position.xy * uExtent, 0.0, 1.0);
  }
`;

export const auraFragment = /* glsl */ `
  #define TAU 6.28318530718
  varying vec2 vP;
  varying vec4 vA;
  varying vec4 vB;
  varying vec4 vC;
  varying vec4 vPorts;
  uniform float uDpr;
  ${PROFILE}

  vec3 hash3(vec3 p) {
    p = vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6)));
    return fract(sin(p) * 43758.5453123);
  }
  /** Smooth 1-D value noise around the circle (static; no flicker, no animation). */
  float ring1d(float t) {
    float i = floor(t);
    float f = fract(t);
    f = f * f * (3.0 - 2.0 * f);
    return mix(hash3(vec3(i, 7.0, 3.0)).x, mix(hash3(vec3(i + 1.0, 7.0, 3.0)).x, hash3(vec3(i - 15.0, 7.0, 3.0)).x, step(15.5, i)), f);
  }

  /** A crisp line of half-width w (px) at signed distance x (px), with a one-pixel AA edge. */
  float line(float x, float w) {
    float aa = 0.75 / uDpr;
    return 1.0 - smoothstep(w - aa, w + aa, abs(x));
  }
  float port(vec2 p, float a, float R, float size) {
    if (a < -9.0) return 0.0;
    float d = length(p - R * vec2(cos(a), sin(a)));
    return line(d, size) + 0.55 * exp(-d / (size * 1.6));
  }

  void main() {
    float R = vC.y;
    float d = length(vP);
    float x = d - R;                         // px outside the silhouette (negative inside)
    float phi = atan(vP.y, vP.x);
    float prof = rimProfile(phi);
    float rimI = vA.x, broken = vA.y, segmented = vA.z, haloI = vA.w;
    float fault = vB.x, recovery = vB.y, selection = vB.z, fence = vB.w;
    float warmth = vC.x, spark = vC.z;

    vec3 rimCol = mix(vec3(0.93, 0.95, 0.97), vec3(1.0, 0.95, 0.90), warmth);
    vec3 haloCol = mix(vec3(0.93, 1.0, 1.0), vec3(1.0, 0.80, 0.65), warmth);
    vec3 amber = vec3(0.973, 0.780, 0.506);  // #F8C781: faults (not violations)
    vec3 blue = vec3(0.678, 0.784, 0.996);   // #ADC8FE: selection, recovery, healing
    rimCol = mix(mix(rimCol, amber, fault), blue, recovery * 0.55);
    haloCol = mix(mix(haloCol, amber, fault), blue, recovery * 0.5);

    // Thin luminous rim, straddling the silhouette (it also anti-aliases the mesh edge).
    // Small nodes carry a relatively wider rim in the references than large ones.
    float w = max(1.15, R * 0.019);
    // The reference rim is painted, not drawn: its thickness and brightness vary slowly around
    // the circle (static low-frequency variation, 16 periods, wrapping seamlessly), and it falls
    // off faster toward the inside than toward the halo.
    float vary = 0.82 + 0.36 * ring1d(phi * 16.0 / TAU + 16.0);
    float wv = w * (0.8 + 0.45 * vary);
    // Measured on the hero: the peak sits just inside the silhouette and the outer shoulder is
    // short (0.95 R → 112, 0.98 R → 161, 1.02 R → 113, 1.04 R → 61).
    float wx = x < 0.0 ? 0.70 * wv : 0.62 * wv;
    float rim = 0.53 * vary * exp(-((x + 0.35 * w) * (x + 0.35 * w)) / (wx * wx)) + 0.07 * exp(-max(-x, 0.0) / (R * 0.022)) * step(x, 0.0);
    // Crash: the rim breaks into dashes. Candidate: segments with shallow dips.
    float dashes = smoothstep(0.38, 0.62, 0.5 + 0.5 * cos(phi * 14.0));
    rim *= mix(1.0, 0.12 + 0.88 * dashes, broken);
    // Candidate: a continuous rim with 32 short gaps (crash uses 14 long dashes instead).
    float seg = abs(fract(phi * 32.0 / TAU) - 0.5) * 2.0;
    rim *= mix(1.0, 0.08 + 0.92 * smoothstep(0.18, 0.32, seg), segmented);

    // Halo outside the silhouette: a tight and a wide exponential, fitted to the measured
    // falloff (0.28 at 0.02 R, 0.13 at 0.08 R, 0.05 at 0.25 R above the background).
    float xo = max(x, 0.0) / R;
    float halo = (0.3 * exp(-xo / 0.05) + 0.16 * exp(-xo / 0.24)) * smoothstep(-w, w, x);

    // Spark: the key light catching the very top of the rim.
    float da = phi - 1.5708;
    float sparkI = spark * (exp(-da * da / 0.003) * exp(-(x * x) / (6.0 * w * w)) + 0.35 * exp(-da * da / 0.02) * exp(-abs(x) / (0.06 * R))) * (1.0 - broken);

    // A selected node's warm halo gives way to the blue atmosphere added below.
    vec3 col = rimCol * (rim * rimI * prof + sparkI * 1.4) + haloCol * halo * haloI * prof * mix(1.45, 1.2, warmth) * (1.0 - 0.45 * selection);

    // Selection: a thin ring at 1.4 R inside a soft blue atmosphere. Measured on the selected
    // rail node: the field rises from the silhouette, peaks around the ring (≈ +49 luminance
    // over the background) and fades by ≈ 1.9 R. The atmosphere is deeper and more saturated
    // than the ring's own colour, which is why the two read as one glowing volume.
    float rel = d / R;
    float xs = d - 1.4 * R;
    // Asymmetric: the field reaches further inward (toward the sphere) than outward.
    float spread = rel < 1.40 ? 0.105 : 0.055;
    float field = 0.26 * exp(-(rel - 1.40) * (rel - 1.40) / spread) * smoothstep(0.98, 1.06, rel);
    // The ring's own light is pale, close to white; the saturated blue is in the atmosphere.
    // A: the crisp core. B: the soft bloom around it, deliberately weaker so the total
    // brightness of the selection is unchanged and only its definition improves.
    float ring = line(xs, max(0.7, R * 0.012)) * 0.62 + 0.055 * exp(-abs(xs) / max(2.2, 0.06 * R));
    col += (vec3(0.38, 0.62, 1.0) * field + mix(blue, vec3(1.0), 0.45) * ring) * selection;

    // Partition fence: a dotted amber ring at 1.22 R (shape + colour).
    float rf = 1.22 * R;
    float count = max(12.0, floor(TAU * rf / 9.0));
    float cell = (fract(phi / TAU * count) - 0.5) * TAU * rf / count;   // px along the ring
    float dot1 = line(length(vec2(d - rf, cell)), max(0.9, R * 0.016));
    col += amber * dot1 * fence;

    // Recovery: an open blue arc (300 degrees, gap at the upper right) just outside the fence.
    float ra = (fence > 0.01 ? 1.31 : 1.22) * R;
    float open = smoothstep(0.0, 0.08, abs(mod(phi - 0.52 + TAU * 0.5, TAU) - TAU * 0.5) - 0.5);
    col += blue * line(d - ra, max(0.7, R * 0.014)) * open * recovery * 0.9;

    // Link ports (junction dots where links meet the rim).
    float ps = clamp(R * 0.045, 2.6, 5.0);
    float ports = port(vP, vPorts.x, R, ps) + port(vP, vPorts.y, R, ps) + port(vP, vPorts.z, R, ps) + port(vP, vPorts.w, R, ps);
    col += vec3(0.96, 0.97, 1.0) * ports;

    float a = clamp(max(col.r, max(col.g, col.b)), 0.0, 1.0);
    gl_FragColor = vec4(min(col, vec3(1.0)), a);   // premultiplied: light added over the page
  }
`;
