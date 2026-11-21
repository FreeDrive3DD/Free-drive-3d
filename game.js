(() => {
'use strict';
const $ = id => document.getElementById(id);
const MPH = 2.23694, MI = 1609.344, G = 16, WL = 0, GO = 0.1;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const sm = (a, b, x) => { x = clamp((x - a) / (b - a), 0, 1); return x * x * (3 - 2 * x); };
const hs = (a, b) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };
const soft = (h, f, k) => (h > f ? h : f + (h - f) * k);
const rnd = (a, b) => a + Math.random() * (b - a);
const fmt = t => { const m = Math.floor(t / 60), s = t - m * 60; return m + ':' + (s < 10 ? '0' : '') + s.toFixed(2); };
const fmt3 = t => { const m = Math.floor(t / 60), s = t - m * 60; return m + ':' + (s < 10 ? '0' : '') + s.toFixed(3); };
const LANE = [3.8, 7.4, 11.0]; // heist motorway: lane centres, fast lane first
const MODES = ['free', 'race', 'heist'];
const PALETTE = [
  { name: 'Red', hex: 0xd7261e }, { name: 'Orange', hex: 0xff7a1a }, { name: 'Yellow', hex: 0xf5c400 },
  { name: 'Green', hex: 0x2aa84a }, { name: 'Light blue', hex: 0x5bbcf0 }, { name: 'Dark blue', hex: 0x14378c },
  { name: 'Purple', hex: 0x8a3fd0 }, { name: 'Pink', hex: 0xff6fb5 }, { name: 'Grey', hex: 0x7d838a },
  { name: 'White', hex: 0xf4f4f4 }, { name: 'Black', hex: 0x141414 }
];

// ---------- game state ----------
let MODE = 'free', WLV = WL, MAXMPH = 250, MAX = MAXMPH / MPH, HW = 6.4, RP = 12;
let phase = 'title', state = 'run', carIdx = 0, pendingMode = 'free', paint = null, placeLocked = 0;
let runT = 0, rt = 0, countT = 0, timeLeft = 180, endT = 0, endFn = null, bigT = -1, time = 0, raceTime = 0, shake = 0;
let TH = null, bS = 0, bL = 0; // bS / bL: snow and lake weights from the most recent biome() call
const keys = {};

// ---------- world shape (depends on the mode) ----------
const biome = (x, z) => {
  const s = z / 2200 + x / 4000 + 0.25 * Math.sin(x / 1000) + 0.2, p = ((s % 3) + 3) % 3;
  bS = sm(0.85, 1.15, p) * (1 - sm(1.85, 2.15, p));
  bL = sm(1.85, 2.15, p) * (1 - sm(2.85, 3, p));
};
const roadX = z => MODE === 'free' ? Math.sin(z * 0.004) * 140 + Math.sin(z * 0.0113) * 45
  : MODE === 'race' ? 0 : Math.sin(z * 0.0012) * 180 + Math.sin(z * 0.0031) * 40;
const roadBase = z => MODE === 'free' ? Math.sin(z * 0.0031) * 14 + Math.sin(z * 0.009) * 5 + Math.sin(z * 0.045) * 1.1
  : MODE === 'race' ? 0 : Math.sin(z * 0.0017) * 9 + Math.sin(z * 0.0041) * 3;
const roadH = z => {
  if (MODE !== 'free') return roadBase(z);
  biome(roadX(z), z); // in the lake district the road becomes a low causeway
  return roadBase(z) * (1 - bL) + (2.4 + Math.sin(z * 0.045) * 0.25) * bL;
};
const roadLen = z => Math.hypot(roadX(z + 1) - roadX(z), 1);
const roadYaw = z => Math.atan2(roadX(z + 1) - roadX(z), 1);
const hills = (x, z) => Math.sin(x * 0.0057 + 1) * Math.sin(z * 0.0049) * 34 + Math.sin(x * 0.013 + z * 0.009) * 9 + Math.sin(x * 0.031) * Math.cos(z * 0.027) * 3 + 8;
const height = (x, z) => {
  const r = roadH(z), d = Math.abs(x - roadX(z));
  if (MODE !== 'free') { bS = 0; bL = 0; return r + (soft(hills(x, z), 3, 0.1) - r) * sm(MODE === 'race' ? 24 : 30, 120, d); }
  biome(x, z);
  const wS = bS, wL = bL, wG = 1 - wS - wL, hl = hills(x, z);
  const grassH = soft(hl, 3, 0.1);
  const snowH = soft(hl * 1.5 + 14 + Math.abs(Math.sin(x * 0.011) * Math.sin(z * 0.013)) * 30, 4, 0.1);
  const n = Math.sin(x * 0.021 + 1) * Math.sin(z * 0.019) + Math.sin(x * 0.047) * Math.sin(z * 0.041) * 0.6 + Math.sin(x * 0.09 + z * 0.07) * 0.3;
  const lakeH = -7 + sm(0.3, 0.55, n) * (8 + 2 * n);
  return r + (grassH * wG + snowH * wS + lakeH * wL - r) * sm(12, 70, d);
};
const groundAt = (x, z) => Math.max(height(x, z), WLV);

// ---------- renderer, scene, camera ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
$('game').appendChild(renderer.domElement);
const scene = new THREE.Scene();
const horizon = new THREE.Color(0xdceff7);
scene.fog = new THREE.Fog(0xdceff7, 220, 780);
const camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.5, 2600);

const gcache = {}, mcache = {};
const GB = (w, h, d) => gcache[w + '_' + h + '_' + d] || (gcache[w + '_' + h + '_' + d] = new THREE.BoxGeometry(w, h, d));
const MP = (c, em = 0) => mcache[c + '_' + em] || (mcache[c + '_' + em] = new THREE.MeshPhongMaterial({ color: c, emissive: em, shininess: 60, specular: 0x333333 }));
const tb = (g, w, h, d, c, x, y, z, em) => { const m = new THREE.Mesh(GB(w, h, d), MP(c, em || 0)); m.position.set(x, y, z); m.castShadow = true; g.add(m); return m; };
const disposeGroup = g => g.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose()); });
const textTex = (w, h, draw) => { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.anisotropy = 4; return t; };

// ---------- themes: each mode has its own sky and light ----------
const THEMES = {
  free:  { top: 0x3f8fe0, mid: 0x8fc4ea, hor: 0xdceff7, sun: 0xfff1d0, disc: 0xfff6d5, sunI: 1.0, hemS: 0xbfe3ff, hemG: 0x3a5a2a, hemI: 0.85, sd: [-0.5, 0.8, 0.45], fogN: 220, fogF: 780, cloud: 0xffffff },
  race:  { top: 0x2e82e4, mid: 0x86c3f0, hor: 0xe3f2fa, sun: 0xfff6e0, disc: 0xfffbe8, sunI: 1.1, hemS: 0xcde8ff, hemG: 0x3f6a2e, hemI: 0.9, sd: [-0.35, 0.85, 0.4], fogN: 300, fogF: 800, cloud: 0xffffff },
  heist: { top: 0x23366f, mid: 0xc4785a, hor: 0xffc58b, sun: 0xffa95a, disc: 0xffd9a0, sunI: 1.0, hemS: 0xffcfa0, hemG: 0x4a3a30, hemI: 0.75, sd: [0.35, 0.42, 0.85], fogN: 240, fogF: 800, cloud: 0xffcaa0 }
};
const skyGeo = new THREE.SphereGeometry(1900, 32, 20);
skyGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(skyGeo.attributes.position.count * 3), 3));
const sky = new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false }));
scene.add(sky);
function bakeSky(t) {
  const p = skyGeo.attributes.position, a = skyGeo.attributes.color.array;
  const top = new THREE.Color(t.top), mid = new THREE.Color(t.mid), hor = new THREE.Color(t.hor), c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const k = clamp(p.getY(i) / 1500, 0, 1);
    if (k < 0.3) c.copy(hor).lerp(mid, k / 0.3); else c.copy(mid).lerp(top, (k - 0.3) / 0.7);
    a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b;
  }
  skyGeo.attributes.color.needsUpdate = true;
}
const sunMesh = new THREE.Mesh(new THREE.SphereGeometry(60, 16, 12), new THREE.MeshBasicMaterial({ color: 0xfff6d5, fog: false }));
scene.add(sunMesh);
const glowCv = document.createElement('canvas'); glowCv.width = glowCv.height = 128;
{
  const g = glowCv.getContext('2d'), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.2, 'rgba(255,255,255,.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
}
const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(glowCv), blending: THREE.AdditiveBlending, depthWrite: false, fog: false, transparent: true, opacity: 0.85 }));
glow.scale.set(1000, 1000, 1); scene.add(glow);
const cloudMat = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false, transparent: true, opacity: 0.92 });
const clouds = new THREE.Group();
for (let i = 0; i < 28; i++) {
  const cl = new THREE.Group();
  for (let j = 0; j < 4; j++) { const s = new THREE.Mesh(new THREE.SphereGeometry(rnd(40, 80), 10, 8), cloudMat); s.position.set(j * 55 - 80, Math.random() * 15, Math.random() * 30); s.scale.y = 0.45; cl.add(s); }
  const a = Math.random() * 6.28, r = rnd(700, 1600);
  cl.position.set(Math.cos(a) * r, rnd(380, 630), Math.sin(a) * r); clouds.add(cl);
}
scene.add(clouds);
const hemi = new THREE.HemisphereLight(0xbfe3ff, 0x3a5a2a, 0.85); scene.add(hemi);
const sunLight = new THREE.DirectionalLight(0xfff1d0, 1); sunLight.castShadow = true;
sunLight.shadow.mapSize.set(2048, 2048);
Object.assign(sunLight.shadow.camera, { left: -70, right: 70, top: 70, bottom: -70, near: 20, far: 520 });
sunLight.shadow.camera.updateProjectionMatrix();
sunLight.shadow.bias = -0.0004; sunLight.shadow.normalBias = 0.5;
scene.add(sunLight, sunLight.target);
const sunDir = new THREE.Vector3();
function applyTheme(t) {
  TH = t; sunDir.set(t.sd[0], t.sd[1], t.sd[2]).normalize(); bakeSky(t); horizon.setHex(t.hor);
  hemi.color.setHex(t.hemS); hemi.groundColor.setHex(t.hemG); hemi.intensity = t.hemI;
  sunLight.color.setHex(t.sun); sunLight.intensity = t.sunI;
  glow.material.color.setHex(t.sun); sunMesh.material.color.setHex(t.disc); cloudMat.color.setHex(t.cloud);
}

// ---------- terrain (re-centred on the car, snapped to a grid) ----------
const CELL = 10, SEG = 140, SIZE = CELL * SEG;
const tg = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG); tg.rotateX(-Math.PI / 2);
const tp = tg.attributes.position, tcol = new Float32Array(tp.count * 3);
tg.setAttribute('color', new THREE.BufferAttribute(tcol, 3));
const lx = new Float32Array(tp.count), lz = new Float32Array(tp.count);
for (let i = 0; i < tp.count; i++) { lx[i] = tp.getX(i); lz[i] = tp.getZ(i); }
const dc = document.createElement('canvas'); dc.width = dc.height = 256;
{
  const g = dc.getContext('2d'); g.fillStyle = '#e6e6e6'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 5000; i++) { const v = 190 + Math.random() * 65 | 0; g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(Math.random() * 256, Math.random() * 256, 2 + Math.random() * 3, 2 + Math.random() * 3); }
}
const detail = new THREE.CanvasTexture(dc); detail.wrapS = detail.wrapT = THREE.RepeatWrapping; detail.repeat.set(SEG, SEG); detail.anisotropy = 4;
const terrain = new THREE.Mesh(tg, new THREE.MeshLambertMaterial({ vertexColors: true, map: detail }));
terrain.frustumCulled = false; terrain.receiveShadow = true; scene.add(terrain);
const col = new THREE.Color(), cg = new THREE.Color(), cs = new THREE.Color(), cl = new THREE.Color();
const rock = new THREE.Color(0x8a8a80), mud = new THREE.Color(0.55, 0.62, 0.58), peak = new THREE.Color(0x77777a);
const sand = new THREE.Color(0.86, 0.8, 0.58), isl = new THREE.Color(0.2, 0.48, 0.16);
function buildTerrain(cx, cz) {
  terrain.position.set(cx, 0, cz);
  for (let i = 0; i < tp.count; i++) {
    const x = cx + lx[i], z = cz + lz[i], h = height(x, z), wS = bS, wL = bL, wG = 1 - wS - wL;
    const n = hs(Math.round(x / CELL), Math.round(z / CELL)), meadow = sm(-5, 22, h), patch = Math.sin(x * 0.011 + 1) * Math.sin(z * 0.009) * 0.5 + 0.5;
    cg.setRGB(0.13 + 0.07 * n + 0.12 * meadow + 0.05 * patch, 0.36 + 0.14 * n + 0.1 * meadow + 0.07 * patch, 0.1 + 0.05 * n).lerp(rock, sm(30, 48, h + n * 6));
    const k = 0.92 + 0.08 * n;
    cs.setRGB(0.93 * k, 0.96 * k, k).lerp(mud, 1 - sm(2, 9, h)).lerp(peak, sm(55, 75, h + n * 8));
    cl.setRGB(0.1, 0.3, 0.36).lerp(sand, sm(-0.5, 0.1, h)).lerp(isl, sm(1, 2.2, h));
    col.setRGB(cg.r * wG + cs.r * wS + cl.r * wL, cg.g * wG + cs.g * wS + cl.g * wL, cg.b * wG + cs.b * wS + cl.b * wL);
    tp.setY(i, h); tcol[i * 3] = col.r; tcol[i * 3 + 1] = col.g; tcol[i * 3 + 2] = col.b;
  }
  tp.needsUpdate = true; tg.attributes.color.needsUpdate = true; tg.computeVertexNormals();
}

// ---------- water (free roam only) ----------
const wcv = document.createElement('canvas'); wcv.width = wcv.height = 128;
{
  const g = wcv.getContext('2d'); g.fillStyle = '#3a86b8'; g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 160; i++) {
    g.strokeStyle = `rgba(255,255,255,${0.05 + Math.random() * 0.12})`; g.lineWidth = 1 + Math.random() * 1.5;
    const x = Math.random() * 128, y = Math.random() * 128, w = 6 + Math.random() * 16;
    g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + w / 2, y - 3, x + w, y); g.stroke();
  }
}
const wtex = new THREE.CanvasTexture(wcv); wtex.wrapS = wtex.wrapT = THREE.RepeatWrapping; wtex.repeat.set(85, 85);
const water = new THREE.Mesh(new THREE.PlaneGeometry(3400, 3400).rotateX(-Math.PI / 2),
  new THREE.MeshPhongMaterial({ map: wtex, transparent: true, opacity: 0.8, shininess: 90, specular: 0x99bbdd, depthWrite: false }));
water.frustumCulled = false; scene.add(water);

// ---------- road ribbon: a painted texture for each mode ----------
function roadTexture(kind) {
  const W = kind === 'free' ? 128 : kind === 'race' ? 256 : 512, H = 256, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = kind === 'free' ? '#2b2c30' : '#303136'; g.fillRect(0, 0, W, H);
  for (let i = 0; i < W * 14; i++) { const v = 28 + Math.random() * 34 | 0; g.fillStyle = `rgb(${v},${v},${v + 3})`; g.fillRect(Math.random() * W, Math.random() * H, 2, 2); }
  const line = (x, w, color, frac) => { g.fillStyle = color; g.fillRect(x - w / 2, 0, w, H * frac); };
  const wear = (x, w) => { g.fillStyle = 'rgba(0,0,0,.14)'; g.fillRect(x - w / 2, 0, w, H); };
  if (kind === 'free') { line(8, 4, '#e8e8e8', 1); line(W - 8, 4, '#e8e8e8', 1); line(W / 2, 4, '#e8b923', 0.5); }
  else if (kind === 'race') {
    line(6, 4, '#e8e8e8', 1); line(W - 6, 4, '#e8e8e8', 1);
    [64, 128, 192].forEach(x => line(x, 4, '#e8e8e8', 0.34));
    [32, 96, 160, 224].forEach(x => { wear(x - 11, 9); wear(x + 11, 9); });
  } else {
    const px = m => (m + 15.8) * 16.2;
    g.fillStyle = '#8f9296'; g.fillRect(px(-2), 0, px(2) - px(-2), H);
    [-2.3, 2.3, -12.8, 12.8].forEach(m => line(px(m), 4, '#e8e8e8', 1));
    [-5.6, 5.6, -9.2, 9.2].forEach(m => line(px(m), 4, '#e8e8e8', 0.34));
    [-3.8, 3.8, -7.4, 7.4, -11, 11].forEach(m => { wear(px(m) - 13, 12); wear(px(m) + 13, 12); });
  }
  const t = new THREE.CanvasTexture(c); t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t;
}
const roadTex = { free: roadTexture('free'), race: roadTexture('race'), heist: roadTexture('heist') };
const ROWS = 180, RSTEP = 8;
const rg = new THREE.BufferGeometry(), rpos = new Float32Array(ROWS * 6), ruv = new Float32Array(ROWS * 4), ridx = [];
for (let r = 0; r < ROWS - 1; r++) { const a = r * 2; ridx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
rg.setAttribute('position', new THREE.BufferAttribute(rpos, 3));
rg.setAttribute('uv', new THREE.BufferAttribute(ruv, 2)); rg.setIndex(ridx);
const road = new THREE.Mesh(rg, new THREE.MeshLambertMaterial({ map: roadTex.free, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
road.frustumCulled = false; road.receiveShadow = true; scene.add(road);
function buildRoad(cz) {
  const z0 = Math.floor((cz - ROWS * RSTEP / 2) / RSTEP) * RSTEP;
  for (let r = 0; r < ROWS; r++) {
    const z = z0 + r * RSTEP, x = roadX(z), dx = roadX(z + 1) - x, len = Math.hypot(dx, 1), nx = 1 / len, nz = -dx / len, y = roadH(z) + 0.12;
    rpos.set([x - HW * nx, y, z - HW * nz, x + HW * nx, y, z + HW * nz], r * 6);
    ruv.set([0, z / RP, 1, z / RP], r * 4);
  }
  rg.attributes.position.needsUpdate = true; rg.attributes.uv.needsUpdate = true; rg.computeVertexNormals();
}

// ---------- trees: pines and leafy trees ----------
const TC = 30, TR = 22, MAXT = (2 * TR + 1) ** 2;
const mkTrees = (geo, color) => { const m = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color }), MAXT); m.frustumCulled = false; m.castShadow = true; scene.add(m); return m; };
const trunkM = mkTrees(new THREE.CylinderGeometry(0.35, 0.5, 3, 6), 0x5b3d24);
const pineM = mkTrees(new THREE.ConeGeometry(2.6, 7, 7), 0xffffff);
const leafM = mkTrees(new THREE.IcosahedronGeometry(2.8, 1), 0xffffff);
leafM.material.flatShading = true;
const dummy = new THREE.Object3D(), tc = new THREE.Color();
function buildTrees(cx, cz) {
  const ix = Math.round(cx / TC), iz = Math.round(cz / TC), clear = MODE === 'free' ? 20 : 36; let nt = 0, np = 0, nb = 0;
  for (let a = -TR; a <= TR; a++) for (let b = -TR; b <= TR; b++) {
    const gx = ix + a, gz = iz + b, r = hs(gx, gz);
    if (r < 0.35) continue;
    const x = gx * TC + (hs(gz, gx) - 0.5) * TC * 0.9, z = gz * TC + (hs(gx + 7, gz + 3) - 0.5) * TC * 0.9;
    if (Math.abs(x - roadX(z)) < clear) continue;
    if (MODE === 'race' && z > -150 && z < MI + 150 && Math.abs(x) < 70) continue;
    const h = height(x, z), wS = bS, wL = bL;
    if (h < WLV + 0.9 || h > 40 + wS * 20) continue;
    if (wL > 0.5 && r < 0.75) continue;
    const s = 0.8 + hs(gx + 1, gz + 9) * 1.1 + wS * 0.3, broad = wS < 0.3 && wL < 0.3 && hs(gx + 3, gz + 5) < 0.45;
    dummy.rotation.set(0, r * 6, 0); dummy.scale.setScalar(s);
    dummy.position.set(x, h + 1.5 * s, z); dummy.updateMatrix(); trunkM.setMatrixAt(nt++, dummy.matrix);
    if (broad) { dummy.position.y = h + 4.4 * s; dummy.updateMatrix(); leafM.setMatrixAt(nb, dummy.matrix); leafM.setColorAt(nb++, tc.setHSL(0.22 + 0.06 * hs(gz, gx + 5), 0.5, 0.26 + 0.12 * r)); }
    else { dummy.position.y = h + 6 * s; dummy.updateMatrix(); pineM.setMatrixAt(np, dummy.matrix); pineM.setColorAt(np++, tc.setHSL(0.27 + 0.07 * hs(gz, gx + 5), 0.55 * (1 - wS) + 0.1 * wS, 0.16 + 0.1 * r + wS * 0.6)); }
  }
  trunkM.count = nt; pineM.count = np; leafM.count = nb;
  [trunkM, pineM, leafM].forEach(m => { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; });
}

// ---------- motorway furniture: barriers, rails, lamps and gantries ----------
const steelMat = new THREE.MeshPhongMaterial({ color: 0xaab0b6, shininess: 60, specular: 0x444444 });
const mkInst = (geo, mat, n) => { const m = new THREE.InstancedMesh(geo, mat, n); m.frustumCulled = false; m.castShadow = true; m.receiveShadow = true; m.count = 0; scene.add(m); return m; };
const barrierM = mkInst(new THREE.BoxGeometry(0.6, 0.85, 8.2), new THREE.MeshPhongMaterial({ color: 0xb9bbb8, shininess: 20 }), ROWS);
const railM = mkInst(new THREE.BoxGeometry(0.16, 0.5, 8.2), steelMat, ROWS * 2);
const postM = mkInst(new THREE.BoxGeometry(0.12, 0.8, 0.12), steelMat, ROWS * 2);
const poleM = mkInst(new THREE.CylinderGeometry(0.1, 0.14, 9, 6), steelMat, 40);
const headM = mkInst(new THREE.BoxGeometry(0.7, 0.18, 1.3), new THREE.MeshBasicMaterial({ color: 0xfff2c0 }), 80);
const d2 = new THREE.Object3D(); d2.rotation.order = 'YXZ';
function buildFurniture(cz) {
  const all = [barrierM, railM, postM, poleM, headM];
  if (MODE !== 'heist') { all.forEach(m => m.count = 0); return; }
  const z0 = Math.floor((cz - ROWS * RSTEP / 2) / RSTEP) * RSTEP; let nb = 0, nr = 0, np = 0, nl = 0, nh = 0;
  for (let r = 0; r < ROWS; r++) {
    const z = z0 + r * RSTEP, zm = z + RSTEP / 2, cx = roadX(zm), len = roadLen(zm), yaw = roadYaw(zm), y = roadH(zm), pitch = -Math.atan2(roadH(z + RSTEP) - roadH(z), RSTEP);
    const put = (mesh, idx, off, dy) => { d2.position.set(cx + off * len, y + dy, zm); d2.rotation.set(pitch, yaw, 0); d2.updateMatrix(); mesh.setMatrixAt(idx, d2.matrix); };
    put(barrierM, nb++, 0, 0.55);
    put(railM, nr++, 16.2, 0.77); put(railM, nr++, -16.2, 0.77);
    put(postM, np++, 16.2, 0.52); put(postM, np++, -16.2, 0.52);
    if (((Math.round(z / RSTEP) % 6) + 6) % 6 === 0) { put(poleM, nl++, 0, 4.6); put(headM, nh++, 1.1, 9); put(headM, nh++, -1.1, 9); }
  }
  barrierM.count = nb; railM.count = nr; postM.count = np; poleM.count = nl; headM.count = nh;
  all.forEach(m => { m.instanceMatrix.needsUpdate = true; });
}
const signTex = lines => textTex(512, 160, (g, w, h) => {
  g.fillStyle = '#0b4ea2'; g.fillRect(0, 0, w, h); g.strokeStyle = '#fff'; g.lineWidth = 6; g.strokeRect(6, 6, w - 12, h - 12);
  g.fillStyle = '#fff'; g.font = 'bold 54px sans-serif'; g.textAlign = 'center';
  lines.forEach((t, i) => g.fillText(t, w / 2, 70 + i * 64));
});
const signTexs = [signTex(['Swindon  3', 'Bristol  42']), signTex(['London  71', 'Services  2'])];
const gantries = [];
for (let i = 0; i < 3; i++) {
  const g = new THREE.Group();
  [-17.2, 17.2].forEach(x => { const p = new THREE.Mesh(GB(0.5, 9, 0.5), steelMat); p.position.set(x, 4.5, 0); p.castShadow = true; g.add(p); });
  const beam = new THREE.Mesh(GB(35, 0.6, 0.6), steelMat); beam.position.set(0, 8.9, 0); beam.castShadow = true; g.add(beam);
  [-8, 8].forEach((x, k) => {
    const s = new THREE.Mesh(new THREE.PlaneGeometry(9, 2.8), new THREE.MeshBasicMaterial({ map: signTexs[(i + k) % 2], side: THREE.DoubleSide }));
    s.position.set(x, 7.2, 0); s.rotation.y = Math.PI; g.add(s);
  });
  g.visible = false; scene.add(g); gantries.push(g);
}

// ---------- race track props: gantries, barriers, stands, mile boards ----------
const raceProps = new THREE.Group(); raceProps.visible = false; scene.add(raceProps);
{
  const white = MP(0xf2f2f2);
  const bannerTex = (text, checker) => textTex(1024, 140, (g, w, h) => {
    g.fillStyle = checker ? '#111' : '#d7261e'; g.fillRect(0, 0, w, h);
    if (checker) for (let i = 0; i < 64; i++) for (let j = 0; j < 9; j++) if ((i + j) % 2 === 0 && (j < 2 || j > 6)) { g.fillStyle = '#fff'; g.fillRect(i * 16, j * 16, 16, 16); }
    g.fillStyle = '#fff'; g.font = 'bold 84px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    if (checker) { g.fillStyle = '#111'; g.fillRect(w / 2 - 190, 28, 380, h - 56); g.fillStyle = '#fff'; }
    g.fillText(text, w / 2, h / 2 + 4);
  });
  const gantry = (z, tex) => {
    const g = new THREE.Group();
    [-10, 10].forEach(x => { const p = new THREE.Mesh(GB(0.7, 8.5, 0.7), white); p.position.set(x, 4.25, 0); p.castShadow = true; g.add(p); });
    const beam = new THREE.Mesh(GB(21, 0.8, 0.8), white); beam.position.set(0, 8.4, 0); g.add(beam);
    const ban = new THREE.Mesh(new THREE.PlaneGeometry(19.4, 2.6), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
    ban.position.set(0, 6.8, 0); ban.rotation.y = Math.PI; g.add(ban);
    g.position.set(0, 0.12, z); raceProps.add(g);
  };
  gantry(0, bannerTex('START', false)); gantry(MI, bannerTex('FINISH', true));
  const line = (z, w, d, tex, color) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ map: tex || null, color, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
    m.rotation.x = -Math.PI / 2; m.position.set(0, 0.14, z); raceProps.add(m);
  };
  const chk = textTex(256, 32, g => { for (let i = 0; i < 16; i++) for (let j = 0; j < 2; j++) { g.fillStyle = (i + j) % 2 ? '#111' : '#fff'; g.fillRect(i * 16, j * 16, 16, 16); } });
  line(0, 16.8, 0.6, null, 0xffffff); line(MI, 16.8, 2, chk, 0xffffff);
  const bcv = document.createElement('canvas'); bcv.width = 64; bcv.height = 16;
  { const g = bcv.getContext('2d'); g.fillStyle = '#d7261e'; g.fillRect(0, 0, 32, 16); g.fillStyle = '#f4f4f4'; g.fillRect(32, 0, 32, 16); }
  const bt = new THREE.CanvasTexture(bcv); bt.wrapS = bt.wrapT = THREE.RepeatWrapping; bt.repeat.set((MI + 600) / 6, 1);
  [-8.9, 8.9].forEach(x => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1, MI + 600), new THREE.MeshPhongMaterial({ map: bt, shininess: 30 }));
    b.position.set(x, 0.62, (MI + 200) / 2); b.castShadow = b.receiveShadow = true; raceProps.add(b);
  });
  const crowd = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.9, 0.4), new THREE.MeshLambertMaterial({ color: 0xffffff }), 360);
  let nc = 0; const pal = [0xe63946, 0xf1c40f, 0x2a9df4, 0xffffff, 0x2ecc71, 0xff8c42, 0x9b59b6];
  [-1, 1].forEach(side => {
    for (let i = 0; i < 4; i++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.2 * (i + 1), 90), MP(0xb9bec6));
      b.position.set(side * (13 + i * 2.4), 0.6 * (i + 1), MI - 20); b.castShadow = b.receiveShadow = true; raceProps.add(b);
      for (let j = 0; j < 44; j++) {
        dummy.rotation.set(0, 0, 0); dummy.scale.setScalar(1);
        dummy.position.set(side * (13 + i * 2.4) + rnd(-0.7, 0.7), 1.2 * (i + 1) + 0.5, MI - 65 + j * 2.05); dummy.updateMatrix();
        crowd.setMatrixAt(nc, dummy.matrix); crowd.setColorAt(nc++, tc.setHex(pal[Math.floor(Math.random() * pal.length)]));
      }
    }
    const roof = new THREE.Mesh(new THREE.BoxGeometry(11, 0.3, 92), MP(0x2c5fa8)); roof.position.set(side * 16.5, 8.2, MI - 20); roof.castShadow = true; raceProps.add(roof);
    for (let j = 0; j < 4; j++) { const p = new THREE.Mesh(GB(0.3, 8, 0.3), white); p.position.set(side * 11.4, 4, MI - 62 + j * 28); raceProps.add(p); }
  });
  crowd.count = nc; crowd.castShadow = true; raceProps.add(crowd);
  [['1/4 MILE', 0.25], ['1/2 MILE', 0.5], ['3/4 MILE', 0.75]].forEach(([label, f]) => {
    const tex = textTex(256, 120, (g, w, h) => { g.fillStyle = '#0b4ea2'; g.fillRect(0, 0, w, h); g.fillStyle = '#fff'; g.font = 'bold 50px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(label, w / 2, h / 2); });
    [-1, 1].forEach(side => {
      const pole = new THREE.Mesh(GB(0.15, 2.8, 0.15), steelMat); pole.position.set(side * 9.8, 1.4, MI * f); raceProps.add(pole);
      const s = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.2), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
      s.position.set(side * 9.8, 3.2, MI * f); s.rotation.y = Math.PI; raceProps.add(s);
    });
  });
}

// ---------- particles: tyre smoke, sparks, impact dust ----------
const SMOKE_N = 60, smoke = [], sg = new THREE.SphereGeometry(0.5, 6, 5);
for (let i = 0; i < SMOKE_N; i++) {
  const m = new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ color: 0xe6e6e6, transparent: true, opacity: 0, depthWrite: false }));
  m.visible = false; m.userData = { life: 0, max: 1, size: 1, op: 0.45 }; scene.add(m); smoke.push(m);
}
let smokeI = 0, smokeT = 0;
function puff(x, y, z, color = 0xe6e6e6, size = 1, op = 0.45, life = 0) {
  const m = smoke[smokeI++ % SMOKE_N], u = m.userData;
  m.position.set(x, y, z); u.life = u.max = life || rnd(0.8, 1.3); u.size = size; u.op = op;
  m.material.color.setHex(color); m.scale.setScalar(0.5 * size); m.visible = true;
}
function updateSmoke(dt) {
  for (const m of smoke) {
    const u = m.userData; if (u.life <= 0) continue;
    u.life -= dt; if (u.life <= 0) { m.visible = false; continue; }
    const k = 1 - u.life / u.max;
    m.scale.setScalar((0.6 + k * 2.8) * u.size); m.position.y += dt * 1.2 * u.size; m.material.opacity = u.op * (1 - k);
  }
}

// ---------- car building helpers and the first three cars (c = paint colour) ----------
const part = (g, w, h, d, color, x, y, z, rx = 0, em = 0, ry = 0, rz = 0) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshPhongMaterial({ color, emissive: em, shininess: 80, specular: 0x555555 }));
  m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.castShadow = true; g.add(m); return m;
};
const glassPart = (...a) => { const m = part(...a); m.material.specular.setHex(0xffffff); m.material.shininess = 170; return m; };
function addWheels(g, r, w, x, zf, zr, spokes, rimColor) {
  const out = [], tire = new THREE.MeshLambertMaterial({ color: 0x151515 }), rim = new THREE.MeshPhongMaterial({ color: rimColor, shininess: 100, specular: 0x888888 });
  [[-1, zf], [1, zf], [-1, zr], [1, zr]].forEach(([sx, z]) => {
    const pivot = new THREE.Group(); pivot.position.set(sx * x, r, z);
    const wh = new THREE.Group(), tyre = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 16), tire); tyre.castShadow = true; wh.add(tyre);
    if (spokes) {
      wh.add(new THREE.Mesh(new THREE.CylinderGeometry(r * 0.66, r * 0.66, w + 0.02, 16), rim));
      for (let k = 0; k < 5; k++) { const s = new THREE.Mesh(new THREE.BoxGeometry(r * 1.2, w + 0.04, 0.05), tire); s.rotation.y = k * Math.PI / 5; wh.add(s); }
    }
    wh.rotation.z = Math.PI / 2; pivot.add(wh); g.add(pivot); out.push({ pivot, w: wh, front: z > 0 });
  });
  return out;
}
function buildClassic(c = 0xd7261e) {
  const g = new THREE.Group(), tails = [];
  part(g, 1.9, 0.55, 4.3, c, 0, 0.65, 0); part(g, 1.6, 0.5, 2.0, c, 0, 1.15, -0.2);
  glassPart(g, 1.62, 0.4, 0.05, 0x1b2a38, 0, 1.16, 0.82, -0.5); glassPart(g, 1.62, 0.38, 0.05, 0x1b2a38, 0, 1.16, -1.22);
  part(g, 1.4, 0.05, 0.8, 0x151515, 0, 1.0, 2.0);
  [-1, 1].forEach(s => { part(g, 0.4, 0.18, 0.06, 0xfff6c0, s * 0.65, 0.7, 2.16, 0, 0xfff0a0); tails.push(part(g, 0.4, 0.16, 0.06, 0xff2020, s * 0.65, 0.72, -2.16, 0, 0x660000)); });
  part(g, 1.7, 0.08, 0.4, 0x151515, 0, 1.4, -2.0);
  return { group: g, tails, wheels: addWheels(g, 0.38, 0.3, 1.0, 1.3, -1.3, false, 0), hood: [1.45, 0.4], wingY: 1.05, roof: 1.45 };
}
function buildSport(c = 0xc9cdd2) {
  const g = new THREE.Group(), glass = 0x14202b, dark = 0x101010, chrome = 0xe6e6e6, tails = [];
  part(g, 1.92, 0.5, 4.5, c, 0, 0.62, 0); part(g, 1.8, 0.22, 1.7, c, 0, 0.9, 1.25, 0.06);
  part(g, 1.56, 0.42, 1.55, c, 0, 1.08, -0.55); part(g, 1.4, 0.05, 1.3, c, 0, 1.32, -0.58);
  glassPart(g, 1.58, 0.24, 1.2, glass, 0, 1.1, -0.55); glassPart(g, 1.5, 0.45, 0.05, glass, 0, 1.07, 0.3, -0.62); glassPart(g, 1.5, 0.42, 0.05, glass, 0, 1.06, -1.35, 0.7);
  part(g, 1.8, 0.2, 1.0, c, 0, 0.88, -1.75, -0.08); part(g, 1.6, 0.05, 0.3, c, 0, 0.99, -2.1);
  part(g, 1.1, 0.22, 0.06, dark, 0, 0.62, 2.27); part(g, 1.3, 0.1, 0.05, dark, 0, 0.44, 2.26);
  tails.push(part(g, 1.5, 0.1, 0.05, 0xff2020, 0, 0.82, -2.27, 0, 0x660000)); part(g, 1.5, 0.12, 0.3, dark, 0, 0.36, -2.15);
  [-1, 1].forEach(s => {
    part(g, 0.5, 0.09, 0.06, 0xffffff, s * 0.7, 0.8, 2.27, 0, 0xcfe8ff, s * 0.25);
    part(g, 0.06, 0.12, 2.6, dark, s * 0.97, 0.4, 0); part(g, 0.2, 0.1, 0.12, c, s * 1.0, 1.0, 0.2);
    part(g, 0.3, 0.12, 0.95, c, s * 1.0, 0.76, 1.4); part(g, 0.3, 0.12, 0.95, c, s * 1.0, 0.76, -1.4);
  });
  const chromeMat = new THREE.MeshPhongMaterial({ color: chrome, emissive: 0x222222, shininess: 120 });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.125, 0.016, 8, 24), chromeMat); ring.position.set(0, 0.64, 2.31); g.add(ring);
  for (let k = 0; k < 3; k++) { const a = Math.PI / 2 + k * 2 * Math.PI / 3; part(g, 0.016, 0.12, 0.012, chrome, Math.cos(a) * 0.06, 0.64 + Math.sin(a) * 0.06, 2.315, 0, 0x222222, 0, a - Math.PI / 2); }
  [-0.62, -0.4, 0.4, 0.62].forEach(x => { const e = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.25, 10), new THREE.MeshPhongMaterial({ color: 0x5a5a5a })); e.rotation.x = Math.PI / 2; e.position.set(x, 0.4, -2.3); g.add(e); });
  return { group: g, tails, wheels: addWheels(g, 0.4, 0.3, 1.0, 1.4, -1.4, true, 0xd0d4d8), hood: [1.12, 0.05], wingY: 1.05, roof: 1.35 };
}
function buildHyper(c = 0xf5c400) {
  const g = new THREE.Group(), glass = 0x101a24, dark = 0x0d0d0d, tails = [];
  part(g, 2.0, 0.34, 4.3, c, 0, 0.5, 0); part(g, 1.9, 0.1, 1.5, c, 0, 0.64, 1.55, 0.1);
  part(g, 1.5, 0.3, 1.9, c, 0, 0.88, -0.25); part(g, 1.3, 0.04, 1.0, c, 0, 1.05, -0.1);
  glassPart(g, 1.52, 0.18, 1.2, glass, 0, 0.92, -0.2); glassPart(g, 1.4, 0.55, 0.05, glass, 0, 0.88, 0.65, -1.15);
  part(g, 1.8, 0.14, 1.6, c, 0, 0.8, -1.4, -0.12);
  [-0.95, -1.25, -1.55, -1.85].forEach(z => part(g, 1.2, 0.025, 0.1, dark, 0, 0.89 + 0.12 * (z + 1.4), z, -0.12));
  part(g, 1.9, 0.05, 0.4, dark, 0, 0.33, 2.25); part(g, 1.1, 0.12, 0.06, dark, 0, 0.45, 2.17);
  part(g, 1.5, 0.15, 0.4, dark, 0, 0.36, -2.1); part(g, 1.9, 0.05, 0.5, dark, 0, 1.1, -2.05, 0.08);
  [-1, 1].forEach(s => {
    part(g, 0.06, 0.2, 0.9, dark, s * 1.0, 0.6, -0.9); part(g, 0.7, 0.1, 0.07, dark, s * 0.62, 0.6, 2.29);
    part(g, 0.6, 0.05, 0.06, 0xffffff, s * 0.62, 0.6, 2.33, 0, 0xffffff);
    tails.push(part(g, 0.7, 0.08, 0.05, 0xff2020, s * 0.55, 0.6, -2.17, 0, 0x660000));
    part(g, 0.26, 0.08, 0.14, c, s * 0.9, 0.85, 0.5); part(g, 0.34, 0.14, 0.95, c, s * 1.0, 0.72, 1.4); part(g, 0.34, 0.14, 0.95, c, s * 1.0, 0.72, -1.35);
    part(g, 0.06, 0.4, 0.2, dark, s * 0.7, 0.88, -1.95); part(g, 0.05, 0.22, 0.5, dark, s * 0.95, 1.1, -2.05);
  });
  [-0.3, 0.3].forEach(x => { const e = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.25, 10), new THREE.MeshPhongMaterial({ color: 0x666666 })); e.rotation.x = Math.PI / 2; e.position.set(x, 0.5, -2.22); g.add(e); });
  return { group: g, tails, wheels: addWheels(g, 0.37, 0.32, 1.0, 1.4, -1.35, true, 0x9aa0a8), hood: [0.97, 0.3], wingY: 0.9, roof: 1.07 };
}
// (the CARS list, with the three new cars, is at the top of Part 2)

// the player's car: chosen model + buoys + wings + police lights
const car3d = new THREE.Group(), body = new THREE.Group(); car3d.add(body); car3d.visible = false;
let model = null, wheels = [], hood = [1.45, 0.4], tails = [];
const buoys = new THREE.Group(); body.add(buoys);
{
  const orange = new THREE.MeshPhongMaterial({ color: 0xff7a1a }), white = new THREE.MeshPhongMaterial({ color: 0xf4f4f4 });
  [-1, 1].forEach(s => {
    const pont = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 3.2, 12), orange); pont.rotation.x = Math.PI / 2; pont.position.set(s * 2.0, 0.08, 0); buoys.add(pont);
    [1.6, -1.6].forEach(z => { const cap = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 8), orange); cap.position.set(s * 2.0, 0.08, z); buoys.add(cap); });
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.315, 0.315, 0.5, 12), white); band.rotation.x = Math.PI / 2; band.position.set(s * 2.0, 0.08, 0.6); buoys.add(band);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.09, 0.14), new THREE.MeshPhongMaterial({ color: 0x2a2a2a })); arm.position.set(s * 1.45, 0.45, 0.6); buoys.add(arm);
    const arm2 = arm.clone(); arm2.position.z = -0.9; buoys.add(arm2);
  });
}
buoys.scale.setScalar(0.001); buoys.visible = false;
let wingG = 0, wingsOut = false, buoyG = 0;
const wings = [];
{
  const white = new THREE.MeshPhongMaterial({ color: 0xf2f2f2 }), red = new THREE.MeshPhongMaterial({ color: 0xd7261e });
  [-1, 1].forEach(s => {
    const w = new THREE.Group(); w.position.set(s * 0.95, 1.05, -0.2); w.rotation.set(0, s * 0.3, s * 0.06);
    const panel = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.08, 1.5), white); panel.position.set(s * 2.2, 0, 0); w.add(panel);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.09, 0.2), red); stripe.position.set(s * 2.2, 0, 0.65); w.add(stripe);
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.6, 0.7), red); tip.position.set(s * 4.4, 0.3, -0.2); w.add(tip);
    w.scale.set(0.001, 0.3, 0.3); w.visible = false; body.add(w); wings.push(w);
  });
}
const bar = new THREE.Group(), barR = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.3), new THREE.MeshPhongMaterial({ color: 0xff2020, emissive: 0x220000 }));
const barB = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.3), new THREE.MeshPhongMaterial({ color: 0x2050ff, emissive: 0x000022 }));
barR.position.set(0.3, 0, -0.2); barB.position.set(-0.3, 0, -0.2); bar.add(barR, barB); bar.visible = false; body.add(bar);
scene.add(car3d);

// ---------- traffic ----------
const TCOL = [0xc0392b, 0x2c6fd8, 0xe8e8e8, 0x2b2b2b, 0x8c9399, 0x1f7a4d, 0xe0b030, 0x6a3fb5, 0xf0f0f0, 0x142a52];
function trafficModel(kind) {
  const g = new THREE.Group(), c = TCOL[Math.floor(Math.random() * TCOL.length)], tire = 0x151515, glass = 0x14202b;
  let len, w;
  if (kind === 'lorry') {
    len = 11.8; w = 2.55;
    tb(g, 2.3, 0.5, 11.8, 0x2a2a2a, 0, 0.75, 0); tb(g, 2.4, 2.5, 2.4, c, 0, 1.95, 4.6); tb(g, 2.2, 1.0, 0.1, glass, 0, 2.4, 5.82);
    tb(g, 2.55, 3.2, 9.2, 0xeeeeee, 0, 2.35, -1.5);
    [[-1, 4.4], [1, 4.4], [-1, -2.2], [1, -2.2], [-1, -4.2], [1, -4.2]].forEach(([s, z]) => tb(g, 0.35, 0.9, 0.9, tire, s * 1.1, 0.45, z));
  } else if (kind === 'van') {
    len = 5.2; w = 2.0;
    tb(g, 2.0, 1.9, 3.5, c, 0, 1.55, -0.8); tb(g, 1.95, 1.2, 1.6, c, 0, 1.1, 1.75); tb(g, 1.8, 0.5, 0.08, glass, 0, 1.45, 2.56);
    [[-1, 1.7], [1, 1.7], [-1, -1.6], [1, -1.6]].forEach(([s, z]) => tb(g, 0.3, 0.76, 0.76, tire, s * 0.95, 0.38, z));
  } else {
    len = 4.3; w = 1.8;
    tb(g, 1.8, 0.6, 4.3, c, 0, 0.65, 0); tb(g, 1.55, 0.5, 2.1, c, 0, 1.15, -0.2); tb(g, 1.57, 0.3, 1.5, glass, 0, 1.17, -0.2);
    [[-1, 1.3], [1, 1.3], [-1, -1.3], [1, -1.3]].forEach(([s, z]) => tb(g, 0.28, 0.66, 0.66, tire, s * 0.92, 0.33, z));
  }
  [-1, 1].forEach(s => { tb(g, 0.4, 0.16, 0.06, 0xff2020, s * (w / 2 - 0.35), 0.95, -len / 2, 0x770000); tb(g, 0.4, 0.16, 0.06, 0xfff6c0, s * (w / 2 - 0.35), 0.8, len / 2, 0xcfc080); });
  return { g, len, w };
}
const TN = 26, KINDS = ['car', 'car', 'car', 'car', 'car', 'car', 'van', 'lorry'], traffic = [];
function initTraffic() {
  if (traffic.length) return;
  for (let i = 0; i < TN; i++) {
    const kind = KINDS[i % KINDS.length], m = trafficModel(kind); m.g.visible = false; scene.add(m.g);
    traffic.push({ g: m.g, len: m.len, w: m.w, kind, dir: 1, lane: 0, z: 0, v: 0, cruise: 0, wx: 0, y: 0, active: false, wob: 0 });
  }
}

// ---------- the criminal's black van ----------
const VAN_BASE = 74; // m/s (about 165 mph). Raise it to make the chase harder.
const van = { g: new THREE.Group(), z: 0, off: LANE[1], lane: 1, v: 0, t: 2, boost: 0, bt: 10, hit: false, spin: 0, slide: 0, yawOff: 0, wx: 0, y: 0, w: 2.1, len: 5.8 };
{
  const g = van.g, black = 0x15161a;
  tb(g, 2.1, 1.9, 3.9, black, 0, 1.55, -0.95); tb(g, 2.0, 1.25, 1.8, black, 0, 1.15, 1.9);
  tb(g, 1.8, 0.55, 0.08, 0x0a1218, 0, 1.4, 2.82); tb(g, 2.02, 0.45, 0.9, 0x0a1218, 0, 1.4, 1.9);
  tb(g, 2.1, 0.35, 0.3, 0x0a0a0a, 0, 0.5, 2.95); tb(g, 0.04, 1.7, 0.04, 0x333333, 0, 1.55, -2.93);
  [-1, 1].forEach(s => { tb(g, 0.4, 0.2, 0.06, 0xff2020, s * 0.8, 0.95, -2.93, 0xaa0000); tb(g, 0.2, 0.12, 0.06, 0xffa000, s * 0.4, 2.4, -2.93, 0x884400); tb(g, 0.4, 0.2, 0.06, 0xfff6c0, s * 0.7, 0.8, 2.98, 0xcfc080); });
  [[-1, 2.0], [1, 2.0], [-1, -1.8], [1, -1.8]].forEach(([s, z]) => tb(g, 0.32, 0.76, 0.76, 0x111111, s * 1.0, 0.38, z));
  g.visible = false; scene.add(g);
}
function placeVan() {
  const z = van.z, len = roadLen(z);
  van.wx = roadX(z) + van.off * len; van.y = roadH(z) + 0.12;
  van.g.position.set(van.wx, van.y, z);
  van.g.rotation.set(-Math.atan2(roadH(z + 2) - roadH(z - 2), 4), roadYaw(z) + van.yawOff + van.spin, 0, 'YXZ');
}
const laneClear = (L, ahead) => !traffic.some(c => c.active && c.dir > 0 && c.lane === L && c.z > van.z - (c.len / 2 + 6) && c.z < van.z + ahead + c.len / 2);
function updateVan(dt) {
  if (van.hit) {
    van.v *= Math.exp(-1.2 * dt); van.spin += dt * 2.4 * Math.sign(van.slide); van.off += van.slide * dt * 0.4; van.slide *= Math.exp(-1.5 * dt);
  } else {
    const pLat = (car.x - roadX(car.z)) / roadLen(car.z), dist = van.z - car.z, here = van.lane;
    van.t -= dt;
    const blocked = !laneClear(here, 25 + van.v * 0.9);
    const pressed = dist < 90 && dist > -20 && Math.abs(pLat - LANE[here]) < 2.6;
    if (blocked || pressed || van.t <= 0) {
      const opts = [here - 1, here + 1].filter(L => L >= 0 && L <= 2 && laneClear(L, 30 + van.v * 0.7));
      if (opts.length && (blocked || pressed || Math.random() < 0.55)) {
        opts.sort((a, b) => Math.abs(LANE[b] - pLat) - Math.abs(LANE[a] - pLat));
        van.lane = (pressed || blocked) ? opts[0] : opts[Math.floor(Math.random() * opts.length)];
      }
      van.t = rnd(1.4, 3.2);
    }
    van.bt -= dt; if (van.bt < 0) { van.boost = rnd(2.5, 4); van.bt = rnd(12, 20); }
    van.boost = Math.max(0, van.boost - dt);
    let target = VAN_BASE + 14 * clamp(1 - dist / 260, 0, 1) + (van.boost > 0 ? 11 : 0), lead = null, lg = 1e9;
    for (const c of traffic) if (c.active && c.dir > 0 && c.lane === van.lane) { const g = c.z - van.z - (c.len + van.len) / 2; if (g > -1 && g < lg) { lg = g; lead = c; } }
    if (lead && lg < 40) target = Math.min(target, lead.v + (lg - 12) * 0.6);
    van.v += clamp(target - van.v, -30 * dt, 22 * dt);
    const prev = van.off; van.off += clamp(LANE[van.lane] - van.off, -4.5 * dt, 4.5 * dt);
    van.yawOff = Math.atan2((van.off - prev) / Math.max(dt, 1e-4), Math.max(van.v, 10));
  }
  van.z += van.v * dt; placeVan();
}

// ---------- race rivals ----------
const aiCars = [];
function makeRivals() {
  aiCars.forEach(a => { scene.remove(a.g); disposeGroup(a.g); }); aiCars.length = 0;
  const lanes = [6.3, 2.1, -6.3], cols = PALETTE.map(p => p.hex).filter(h => h !== paint).sort(() => Math.random() - 0.5);
  lanes.forEach((x, k) => {
    const m = CARS[(carIdx + 1 + k) % CARS.length].build(cols[k]); scene.add(m.group); m.group.position.set(x, 0.12, -8);
    // rivals are a little slower than a clean 250 mph run, so the best driver wins
    aiCars.push({ g: m.group, m, lane: x, z: -8, v: 0, top: rnd(232, 248) / MPH, acc: rnd(0.9, 1.0), delay: rnd(0.15, 0.45), wr: 0, fin: false, time: 0 });
  });
}
function updateRace(dt) {
  if (state === 'count') return;
  // the race clock keeps running after you cross the line (runT stops), so rivals who finish later get the right time
  if (state === 'run') rt = runT; else rt += dt;
  for (const a of aiCars) {
    if (!a.fin && rt > a.delay) {
      const top = Math.min(MAX, a.top * (1 + clamp((car.z - a.z) / 3000, -0.02, 0.02)));
      a.v += (8 + 34 * (1 - Math.pow(Math.min(a.v / top, 1), 3))) * a.acc * dt; a.v = Math.min(a.v, top);
    }
    if (a.fin) a.v = Math.max(0, a.v - 34 * dt);
    a.z += a.v * dt; a.g.position.set(a.lane, 0.12, a.z);
    a.wr += a.v * dt / 0.38; a.m.wheels.forEach(o => { o.w.rotation.x = a.wr; });
    if (!a.fin && a.z + 2.2 >= MI) {
      a.fin = true; a.time = rt - (a.z + 2.2 - MI) / Math.max(a.v, 1);
      if (state === 'end') a.time = Math.max(a.time, raceTime + 0.001); // crossed after you, so it ranks behind you
    }
  }
  if (state === 'run' && car.z + 2.2 >= MI) {
    raceTime = rt - (car.z + 2.2 - MI) / Math.max(car.vz, 1);
    placeLocked = 1 + aiCars.filter(a => a.fin && a.time < raceTime).length; // your place is fixed the moment you cross the line
    big('FINISH!', true);
    finish(raceResults, 3.2);
  }
}
const ordinal = n => n + (['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) ? 0 : Math.min(n % 10, 4) % 4] || 'th');
function raceResults() {
  const rivals = aiCars.map((a, i) => ({ n: 'Rival ' + (i + 1), t: a.fin ? a.time : rt + (MI - 2.2 - a.z) / Math.max(a.v, 20), est: !a.fin }));
  rivals.sort((a, b) => a.t - b.t);
  const rows = rivals.slice(); rows.splice(Math.max(0, placeLocked - 1), 0, { n: 'You', t: raceTime, you: true });
  const place = Math.max(1, placeLocked);
  showResult(place === 1 ? 'You won!' : ordinal(place) + ' place', 'Your time over the mile: ' + fmt3(raceTime),
    rows.map((r, i) => ({ text: (i + 1) + '.  ' + r.n + '   ' + fmt3(r.t) + (r.est ? ' (est.)' : ''), you: r.you })), 'Race again');
}

// ---------- traffic behaviour ----------
function respawn(c, init) {
  c.dir = Math.random() < 0.6 || c.kind === 'lorry' ? 1 : -1;
  c.lane = c.kind === 'lorry' ? 2 : Math.floor(Math.random() * 3);
  c.cruise = c.dir > 0 ? [40, 33, 27][c.lane] + rnd(-3, 3) : -([36, 32, 28][c.lane] + rnd(-1.5, 1.5));
  if (c.kind === 'lorry') c.cruise = 24 + rnd(-1, 1);
  c.v = c.cruise;
  for (let t = 0; t < 10; t++) {
    const z = init ? car.z + rnd(70, 1200) : (c.dir < 0 || c.v < car.vz) ? car.z + rnd(650, 1300) : car.z - rnd(250, 420);
    c.z = z;
    if (!traffic.some(o => o !== c && o.active && o.dir === c.dir && o.lane === c.lane && Math.abs(o.z - z) < (o.len + c.len) / 2 + 40) && !(c.dir > 0 && c.lane === van.lane && Math.abs(z - van.z) < 40)) break;
  }
  c.active = true; c.wob = 0; c.g.visible = true;
}
function updateTraffic(dt) {
  for (const c of traffic) {
    if (!c.active) continue;
    const s = c.dir; let lead = null, gap = 1e9;
    for (const o of traffic) if (o !== c && o.active && o.dir === s && o.lane === c.lane) {
      const g = (o.z - c.z) * s - (o.len + c.len) / 2; if (g > -0.5 && g < gap) { gap = g; lead = o; }
    }
    let sp = c.v * s, tsp = c.cruise * s;
    if (lead && gap < 38) tsp = Math.min(tsp, lead.v * s - Math.max(0, 14 - gap) * 0.5);
    sp += (tsp - sp) * Math.min(1, 2.5 * dt); c.v = sp * s;
    if (lead && gap < 6) c.z = lead.z - s * ((lead.len + c.len) / 2 + 6);
    c.z += c.v * dt;
    const rel = c.z - car.z;
    if (c.dir < 0 ? rel < -450 : ((rel < -460 && c.v <= car.vz + 1) || rel > 1500)) respawn(c, false);
    const len = roadLen(c.z), off = (c.dir > 0 ? 1 : -1) * LANE[c.lane];
    c.wx = roadX(c.z) + off * len; c.y = roadH(c.z) + 0.12;
    c.g.position.set(c.wx, c.y, c.z);
    c.g.rotation.set(-Math.atan2(roadH(c.z + 2) - roadH(c.z - 2), 4) * c.dir, roadYaw(c.z) + (c.dir < 0 ? Math.PI : 0), Math.sin(time * 40) * c.wob * 0.06, 'YXZ');
    c.wob = Math.max(0, c.wob - dt * 1.2);
  }
}
function updateHeist(dt) {
  updateTraffic(dt); updateVan(dt);
  car.hitCd = Math.max(0, car.hitCd - dt);
  if (car.hitCd <= 0) for (const c of traffic) {
    if (!c.active) continue;
    const dz = c.z - car.z, dx = c.wx - car.x;
    if (Math.abs(dz) < (c.len + 4.4) / 2 && Math.abs(dx) < (c.w + 1.9) / 2 && Math.abs(c.y - car.y) < 2) {
      car.hitCd = 0.5; const k = c.dir > 0 ? 0.6 : 0.3;
      car.vx = car.vx * k + (dx > 0 ? -6 : 6); car.vz *= k;
      if (c.dir > 0 && dz > 0 && Math.abs(dx) < 1.6) car.z = c.z - (c.len + 4.4) / 2 - 0.2;
      c.v *= 0.8; c.wob = 1; shake = 1;
      for (let i = 0; i < 6; i++) puff(car.x + dx * 0.5 + rnd(-1, 1), car.y + 0.6, car.z + dz * 0.5, 0xffb347, 0.35, 0.9, 0.35);
      break;
    }
  }
  if (state === 'run' && !van.hit) {
    const dz = van.z - car.z, dx = van.wx - car.x;
    if (Math.abs(dz) < (van.len + 4.4) / 2 && Math.abs(dx) < (van.w + 1.9) / 2 && Math.abs(van.y - car.y) < 2.5) {
      van.hit = true; van.slide = dx > 0 ? 6 : -6; flash(0.85); shake = 1.4;
      for (let i = 0; i < 16; i++) puff(van.wx + rnd(-1, 1), van.y + rnd(0.3, 1.5), van.z + rnd(-2, 2), i % 2 ? 0xffb347 : 0xbbbbbb, i % 2 ? 0.4 : 1.4, 0.8, 0.6);
      const left = timeLeft;
      finish(() => showResult('Got him!', 'You rammed the van with ' + fmt(left) + ' left on the clock.', [], 'Play again'), 1.6);
    }
  }
}
