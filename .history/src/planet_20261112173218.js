import * as THREE from 'three';

// Hologram planet with a ring (Saturn-like). Everything is procedural: no texture files.
// Units are the same as the figure's: the group is scaled by the figure radius.
const R = 0.5; // planet radius
const RING_IN = 0.68;
const RING_OUT = 1.3;
const LIGHT = new THREE.Vector3(-0.55, 0.5, 0.67).normalize(); // direction towards the "sun" (world space)
const TINT = new THREE.Color(0.45, 0.85, 1.0); // hologram tint

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smooth = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const mix = (a, b, t) => a + (b - a) * t;

// --- tiny value noise -------------------------------------------------------
function hash(x, y, z) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1597334677);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function noise(x, y, z) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  let fx = x - xi;
  let fy = y - yi;
  let fz = z - zi;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  fz = fz * fz * (3 - 2 * fz);
  const x00 = mix(hash(xi, yi, zi), hash(xi + 1, yi, zi), fx);
  const x10 = mix(hash(xi, yi + 1, zi), hash(xi + 1, yi + 1, zi), fx);
  const x01 = mix(hash(xi, yi, zi + 1), hash(xi + 1, yi, zi + 1), fx);
  const x11 = mix(hash(xi, yi + 1, zi + 1), hash(xi + 1, yi + 1, zi + 1), fx);
  return mix(mix(x00, x10, fy), mix(x01, x11, fy), fz);
}

function fbm(x, y, z, octaves) {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise(x * freq, y * freq, z * freq);
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum / norm;
}

// --- procedural textures ----------------------------------------------------
const STOPS = [
  [0, [112, 80, 54]],
  [0.3, [170, 134, 92]],
  [0.55, [212, 182, 134]],
  [0.8, [237, 217, 172]],
  [1, [250, 238, 206]],
];

function ramp(t) {
  for (let i = 1; i < STOPS.length; i++) {
    if (t <= STOPS[i][0]) {
      const [t0, c0] = STOPS[i - 1];
      const [t1, c1] = STOPS[i];
      const k = (t - t0) / (t1 - t0);
      return [mix(c0[0], c1[0], k), mix(c0[1], c1[1], k), mix(c0[2], c1[2], k)];
    }
  }
  return STOPS[STOPS.length - 1][1];
}

// Equirectangular gas-giant surface: turbulent latitude bands, fine grain, bluish-grey poles.
function makePlanetTexture() {
  const W = 1024;
  const H = 512;
  const data = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    const lat = ((y + 0.5) / H - 0.5) * Math.PI;
    const sl = Math.sin(lat);
    const cl = Math.cos(lat);
    for (let x = 0; x < W; x++) {
      const lon = ((x + 0.5) / W) * Math.PI * 2;
      const px = cl * Math.cos(lon);
      const pz = cl * Math.sin(lon);
      const warp = fbm(px * 2.5, sl * 6, pz * 2.5, 3);
      const band =
        0.6 * (0.5 + 0.5 * Math.sin(sl * 14 + (warp - 0.5) * 3.2)) +
        0.4 * (0.5 + 0.5 * Math.sin(sl * 34 + (warp - 0.5) * 5));
      const grain = noise(px * 18, sl * 60, pz * 18) - 0.5;
      const t = clamp01(band * 0.9 + grain * 0.12 + (warp - 0.5) * 0.25 + 0.05);
      const c = ramp(t);
      const pole = smooth(0.72, 1.0, Math.abs(sl)) * 0.5;
      const o = (y * W + x) * 4;
      data[o] = mix(c[0], 120, pole);
      data[o + 1] = mix(c[1], 134, pole);
      data[o + 2] = mix(c[2], 142, pole);
      data[o + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

function ringDensity(u) {
  const c = 0.2 * smooth(0, 0.06, u) * (1 - smooth(0.2, 0.25, u)); // C ring: faint
  const b = 0.96 * smooth(0.2, 0.27, u) * (1 - smooth(0.52, 0.56, u)); // B ring: dense
  const a = 0.72 * smooth(0.62, 0.66, u) * (1 - smooth(0.96, 1, u)); // A ring
  const cassini = 0.05 * smooth(0.54, 0.58, u) * (1 - smooth(0.6, 0.64, u));
  let d = Math.max(c, b, a) + cassini;
  d *= 1 - 0.9 * Math.exp(-(((u - 0.885) / 0.012) ** 2)); // Encke gap
  d *= 0.7 + 0.3 * noise(u * 140, 3.1, 7.7) * (0.6 + 0.8 * noise(u * 520, 1.7, 4.2));
  return d;
}

// 1D radial ring profile: rgb colour + alpha.
function makeRingTexture() {
  const W = 1024;
  const H = 4;
  const data = new Uint8Array(W * H * 4);
  for (let x = 0; x < W; x++) {
    const u = (x + 0.5) / W;
    const d = ringDensity(u);
    const t = clamp01(d * 0.8 + (noise(u * 60, 1.3, 2.1) - 0.5) * 0.5);
    for (let y = 0; y < H; y++) {
      const o = (y * W + x) * 4;
      data[o] = mix(176, 238, t);
      data[o + 1] = mix(148, 218, t);
      data[o + 2] = mix(112, 178, t);
      data[o + 3] = clamp01(d * 1.05) * 255;
    }
  }
  const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

function makeGlowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, 'rgba(150,215,255,0.30)');
  grad.addColorStop(0.3, 'rgba(150,215,255,0.32)');
  grad.addColorStop(0.55, 'rgba(120,190,255,0.10)');
  grad.addColorStop(1, 'rgba(120,190,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(c);
}

// --- shaders ----------------------------------------------------------------
const BODY_VERT = /* glsl */ `
  varying vec3 vN;
  varying vec3 vW;
  varying vec2 vUv;
  varying vec3 vC;
  varying float vS;
  varying vec3 vRN;
  void main() {
    vUv = uv;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    vN = mat3(modelMatrix) * normal;
    vC = modelMatrix[3].xyz;
    vS = length(modelMatrix[0].xyz);
    vRN = normalize(modelMatrix[1].xyz); // ring plane normal
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const BODY_FRAG = /* glsl */ `
  uniform sampler2D uMap;
  uniform sampler2D uRingMap;
  uniform vec3 uLight;
  uniform vec3 uTint;
  uniform vec2 uRing;
  uniform float uTime;
  uniform float uOpacity;
  uniform float uRot;
  varying vec3 vN;
  varying vec3 vW;
  varying vec2 vUv;
  varying vec3 vC;
  varying float vS;
  varying vec3 vRN;
  void main() {
    vec3 N = normalize(vN);
    vec3 V = normalize(cameraPosition - vW);
    vec3 L = normalize(uLight);
    vec3 tex = texture2D(uMap, vec2(vUv.x + uRot, vUv.y)).rgb;
    float diff = smoothstep(-0.15, 0.85, dot(N, L));

    // Shadow cast by the ring: trace towards the light and see if we cross the ring plane inside the ring.
    float denom = dot(L, vRN);
    float rr = 0.0;
    float hit = 0.0;
    if (abs(denom) > 1e-3) {
      float t = dot(vC - vW, vRN) / denom;
      if (t > 0.0) {
        vec3 H = vW + L * t;
        rr = length(H - vC) / vS;
        hit = 1.0;
      }
    }
    float u = (rr - uRing.x) / (uRing.y - uRing.x);
    float ringA = texture2D(uRingMap, vec2(clamp(u, 0.0, 1.0), 0.5)).a;
    float inside = hit * step(0.0, u) * step(u, 1.0);
    diff *= 1.0 - 0.8 * ringA * inside;

    vec3 col = tex * (0.1 + 1.05 * diff);
    col += uTint * 0.12 * (1.0 - diff);
    float fres = pow(1.0 - max(dot(N, V), 0.0), 2.6);
    col += uTint * fres * 0.9;
    float scan = 0.9 + 0.1 * sin(gl_FragCoord.y * 1.6 + uTime * 3.0);
    float flick = 0.97 + 0.03 * sin(uTime * 37.0);
    col *= scan * flick;
    gl_FragColor = vec4(col, uOpacity * (0.86 + 0.14 * fres) * scan);
  }
`;

const RING_VERT = /* glsl */ `
  varying vec3 vW;
  varying vec2 vP;
  varying vec3 vC;
  varying float vS;
  void main() {
    vP = position.xy;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    vC = modelMatrix[3].xyz;
    vS = length(modelMatrix[0].xyz);
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const RING_FRAG = /* glsl */ `
  const float PR = ${R.toFixed(3)};
  uniform sampler2D uRingMap;
  uniform vec3 uLight;
  uniform vec3 uTint;
  uniform vec2 uRing;
  uniform float uTime;
  uniform float uOpacity;
  varying vec3 vW;
  varying vec2 vP;
  varying vec3 vC;
  varying float vS;
  void main() {
    float u = (length(vP) - uRing.x) / (uRing.y - uRing.x);
    vec4 rt = texture2D(uRingMap, vec2(clamp(u, 0.0, 1.0), 0.5));
    vec3 L = normalize(uLight);
    // Shadow of the planet on the ring.
    vec3 oc = vW - vC;
    float rad = PR * vS;
    float b = dot(oc, L);
    float disc = b * b - (dot(oc, oc) - rad * rad);
    float sh = b < 0.0 ? smoothstep(0.0, 0.25 * rad * rad, disc) : 0.0;
    float lit = 0.45 + 0.75 * (1.0 - 0.9 * sh);
    vec3 col = rt.rgb * lit + uTint * 0.12;
    float scan = 0.9 + 0.1 * sin(gl_FragCoord.y * 1.6 + uTime * 3.0);
    gl_FragColor = vec4(col * scan, rt.a * uOpacity * 0.92 * scan);
  }
`;

export function createPlanet(scene) {
  const group = new THREE.Group();
  group.visible = false;
  scene.add(group);

  const shared = {
    uLight: { value: LIGHT },
    uTint: { value: TINT },
    uRing: { value: new THREE.Vector2(RING_IN, RING_OUT) },
    uRingMap: { value: makeRingTexture() },
    uTime: { value: 0 },
    uOpacity: { value: 0 },
  };

  const glowMat = new THREE.SpriteMaterial({
    map: makeGlowTexture(),
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
  });
  const glow = new THREE.Sprite(glowMat);
  glow.scale.set(3.4, 3.4, 1);
  glow.renderOrder = 11;
  group.add(glow);

  const bodyUniforms = { ...shared, uMap: { value: makePlanetTexture() }, uRot: { value: 0 } };
  const body = new THREE.Mesh(
    new THREE.SphereGeometry(R, 64, 48),
    new THREE.ShaderMaterial({
      uniforms: bodyUniforms,
      vertexShader: BODY_VERT,
      fragmentShader: BODY_FRAG,
      transparent: true,
      depthTest: true,
      depthWrite: true,
    }),
  );
  body.renderOrder = 12;
  body.frustumCulled = false;
  group.add(body);

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(RING_IN, RING_OUT, 160, 1),
    new THREE.ShaderMaterial({
      uniforms: { ...shared },
      vertexShader: RING_VERT,
      fragmentShader: RING_FRAG,
      transparent: true,
      side: THREE.DoubleSide,
      depthTest: true,
      depthWrite: false,
    }),
  );
  ring.rotation.x = -Math.PI / 2; // lie in the planet's equatorial plane (normal = group +Y)
  ring.renderOrder = 13;
  ring.frustumCulled = false;
  group.add(ring);

  /** x, y: world position (y up); r: scale in px; q: orientation; opacity 0..1; t: seconds. */
  function place(x, y, r, q, opacity, t) {
    const on = opacity > 0.01;
    group.visible = on;
    if (!on) return;
    group.position.set(x, y, 0);
    group.quaternion.copy(q);
    group.scale.setScalar(r);
    shared.uOpacity.value = opacity;
    shared.uTime.value = t;
    bodyUniforms.uRot.value = t * 0.03; // slow self-rotation of the surface
    glowMat.opacity = opacity * 0.85;
  }

  return { place };
}