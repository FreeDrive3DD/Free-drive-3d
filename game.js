(() => {
const MPH = 2.23694;
let MAXMPH = 250, MAX = MAXMPH / MPH; // top speed of the chosen car (set when you pick one)
const G = 16;   // gravity (m/s²). Lower = floatier, higher = heavier
const WL = 0;   // water level
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const sm = (a, b, x) => { x = clamp((x - a) / (b - a), 0, 1); return x * x * (3 - 2 * x); };
const hs = (a, b) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };
const soft = (h, floor, k) => h > floor ? h : floor + (h - floor) * k;

// ---------- Biomes: starter fields -> snowy peaks -> lake district, repeating ----------
let bS = 0, bL = 0; // snow and lake weights from the most recent biome() call
const biome = (x, z) => {
  const s = z / 2200 + x / 4000 + 0.25 * Math.sin(x / 1000) + 0.2;
  const p = ((s % 3) + 3) % 3;
  bS = sm(0.85, 1.15, p) * (1 - sm(1.85, 2.15, p));
  bL = sm(1.85, 2.15, p) * (1 - sm(2.85, 3, p));
};

// ---------- World shape ----------
const roadX = z => Math.sin(z * 0.004) * 140 + Math.sin(z * 0.0113) * 45;
const roadBase = z => Math.sin(z * 0.0031) * 14 + Math.sin(z * 0.009) * 5 + Math.sin(z * 0.045) * 1.1; // last term = bumps
const roadH = z => { // in the lake district the road becomes a low causeway just above the water
  biome(roadX(z), z);
  return roadBase(z) * (1 - bL) + (2.4 + Math.sin(z * 0.045) * 0.25) * bL;
};
const hills = (x, z) =>
  Math.sin(x * 0.0057 + 1) * Math.sin(z * 0.0049) * 34 +
  Math.sin(x * 0.013 + z * 0.009) * 9 +
  Math.sin(x * 0.031) * Math.cos(z * 0.027) * 3 + 8;
const height = (x, z) => {
  const r = roadH(z), d = Math.abs(x - roadX(z));
  biome(x, z); // leaves bS / bL set for this exact point
  const wS = bS, wL = bL, wG = 1 - wS - wL;
  const hl = hills(x, z);
  const grassH = soft(hl, 3, 0.1);                                                    // rolling green hills
  const snowH = soft(hl * 1.5 + 14 + Math.abs(Math.sin(x * 0.011) * Math.sin(z * 0.013)) * 30, 4, 0.1); // taller mountains
  const n = Math.sin(x * 0.021 + 1) * Math.sin(z * 0.019) + Math.sin(x * 0.047) * Math.sin(z * 0.041) * 0.6 + Math.sin(x * 0.09 + z * 0.07) * 0.3;
  const lakeH = -7 + sm(0.3, 0.55, n) * (8 + 2 * n);                                  // deep basin with lots of small islands
  const t = grassH * wG + snowH * wS + lakeH * wL;
  return r + (t - r) * sm(12, 70, d); // flat near the road, natural terrain away from it
};
const groundAt = (x, z) => Math.max(height(x, z), WL); // what the car's body "sees" (water counts as ground)

// ---------- Renderer, scene, sky ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
document.getElementById('game').appendChild(renderer.domElement);
const scene = new THREE.Scene();
const horizon = new THREE.Color(0xdceff7);
scene.fog = new THREE.Fog(0xdceff7, 250, 1100);
const camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.5, 2600);

const sky = new THREE.Mesh(new THREE.SphereGeometry(1900, 24, 16),
  new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false }));
{
  const p = sky.geometry.attributes.position, cols = [], top = new THREE.Color(0x3f8fe0), c = new THREE.Color();
  for (let i = 0; i < p.count; i++) { c.copy(horizon).lerp(top, clamp(p.getY(i) / 1500, 0, 1)); cols.push(c.r, c.g, c.b); }
  sky.geometry.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
}
scene.add(sky);
const sun = new THREE.Mesh(new THREE.SphereGeometry(70, 16, 12), new THREE.MeshBasicMaterial({ color: 0xfff6d5, fog: false }));
scene.add(sun);
const clouds = new THREE.Group();
for (let i = 0; i < 28; i++) {
  const cl = new THREE.Group(), m = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false, transparent: true, opacity: 0.92 });
  for (let j = 0; j < 4; j++) {
    const s = new THREE.Mesh(new THREE.SphereGeometry(40 + Math.random() * 40, 10, 8), m);
    s.position.set(j * 55 - 80, Math.random() * 15, Math.random() * 30); s.scale.y = 0.45; cl.add(s);
  }
  const a = Math.random() * 6.28, r = 700 + Math.random() * 900;
  cl.position.set(Math.cos(a) * r, 380 + Math.random() * 250, Math.sin(a) * r);
  clouds.add(cl);
}
scene.add(clouds);

scene.add(new THREE.HemisphereLight(0xbfe3ff, 0x3a5a2a, 0.85));
const sunLight = new THREE.DirectionalLight(0xfff1d0, 1.0);
sunLight.position.set(-0.5, 0.8, 0.45);
scene.add(sunLight);

// ---------- Terrain (re-centred on the car, snapped to a grid) ----------
const CELL = 10, SEG = 140, SIZE = CELL * SEG;
const tg = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG); tg.rotateX(-Math.PI / 2);
const tp = tg.attributes.position, tcol = new Float32Array(tp.count * 3);
tg.setAttribute('color', new THREE.BufferAttribute(tcol, 3));
const lx = new Float32Array(tp.count), lz = new Float32Array(tp.count);
for (let i = 0; i < tp.count; i++) { lx[i] = tp.getX(i); lz[i] = tp.getZ(i); }
const terrain = new THREE.Mesh(tg, new THREE.MeshLambertMaterial({ vertexColors: true }));
terrain.frustumCulled = false; scene.add(terrain);
const col = new THREE.Color(), cg = new THREE.Color(), cs = new THREE.Color(), cl = new THREE.Color();
const rock = new THREE.Color(0x8a8a80), mud = new THREE.Color(0.55, 0.62, 0.58), peak = new THREE.Color(0x77777a);
const sand = new THREE.Color(0.86, 0.8, 0.58), isl = new THREE.Color(0.2, 0.48, 0.16);
function buildTerrain(cx, cz) {
  terrain.position.set(cx, 0, cz);
  for (let i = 0; i < tp.count; i++) {
    const x = cx + lx[i], z = cz + lz[i], h = height(x, z), wS = bS, wL = bL, wG = 1 - wS - wL;
    const n = hs(Math.round(x / CELL), Math.round(z / CELL)), meadow = sm(-5, 22, h);
    cg.setRGB(0.13 + 0.07 * n + 0.12 * meadow, 0.36 + 0.14 * n + 0.1 * meadow, 0.1 + 0.05 * n).lerp(rock, sm(30, 48, h + n * 6));
    const k = 0.92 + 0.08 * n;
    cs.setRGB(0.93 * k, 0.96 * k, k).lerp(mud, 1 - sm(2, 9, h)).lerp(peak, sm(55, 75, h + n * 8));
    cl.setRGB(0.1, 0.3, 0.36).lerp(sand, sm(-0.5, 0.1, h)).lerp(isl, sm(1, 2.2, h));
    col.setRGB(cg.r * wG + cs.r * wS + cl.r * wL, cg.g * wG + cs.g * wS + cl.g * wL, cg.b * wG + cs.b * wS + cl.b * wL);
    tp.setY(i, h); tcol[i * 3] = col.r; tcol[i * 3 + 1] = col.g; tcol[i * 3 + 2] = col.b;
  }
  tp.needsUpdate = true; tg.attributes.color.needsUpdate = true; tg.computeVertexNormals();
}

// ---------- Water ----------
const wcv = document.createElement('canvas'); wcv.width = wcv.height = 128;
{
  const g = wcv.getContext('2d');
  g.fillStyle = '#3a86b8'; g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 160; i++) {
    g.strokeStyle = `rgba(255,255,255,${0.05 + Math.random() * 0.12})`; g.lineWidth = 1 + Math.random() * 1.5;
    const x = Math.random() * 128, y = Math.random() * 128, w = 6 + Math.random() * 16;
    g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + w / 2, y - 3, x + w, y); g.stroke();
  }
}
const wtex = new THREE.CanvasTexture(wcv);
wtex.wrapS = wtex.wrapT = THREE.RepeatWrapping; wtex.repeat.set(85, 85); // 40 m per tile
const water = new THREE.Mesh(new THREE.PlaneGeometry(3400, 3400).rotateX(-Math.PI / 2),
  new THREE.MeshPhongMaterial({ map: wtex, transparent: true, opacity: 0.8, shininess: 90, specular: 0x99bbdd, depthWrite: false }));
water.frustumCulled = false; scene.add(water);

// ---------- Road ribbon with painted texture ----------
const cv = document.createElement('canvas'); cv.width = 128; cv.height = 256;
{
  const g = cv.getContext('2d');
  g.fillStyle = '#2b2c30'; g.fillRect(0, 0, 128, 256);
  for (let i = 0; i < 3000; i++) { const v = 30 + Math.random() * 30 | 0; g.fillStyle = `rgb(${v},${v},${v + 3})`; g.fillRect(Math.random() * 128, Math.random() * 256, 2, 2); }
  g.fillStyle = '#e8e8e8'; g.fillRect(6, 0, 4, 256); g.fillRect(118, 0, 4, 256);
  g.fillStyle = '#e8b923'; g.fillRect(62, 0, 4, 128);
}
const roadTex = new THREE.CanvasTexture(cv);
roadTex.wrapT = THREE.RepeatWrapping; roadTex.anisotropy = 8;
const ROWS = 180, RSTEP = 8, HW = 6.4;
const rg = new THREE.BufferGeometry(), rpos = new Float32Array(ROWS * 6), ruv = new Float32Array(ROWS * 4), ridx = [];
for (let r = 0; r < ROWS - 1; r++) { const a = r * 2; ridx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
rg.setAttribute('position', new THREE.BufferAttribute(rpos, 3));
rg.setAttribute('uv', new THREE.BufferAttribute(ruv, 2)); rg.setIndex(ridx);
const road = new THREE.Mesh(rg, new THREE.MeshLambertMaterial({ map: roadTex, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
road.frustumCulled = false; scene.add(road);
function buildRoad(cz) {
  const z0 = Math.floor((cz - ROWS * RSTEP / 2) / RSTEP) * RSTEP;
  for (let r = 0; r < ROWS; r++) {
    const z = z0 + r * RSTEP, x = roadX(z), dx = roadX(z + 1) - x, len = Math.hypot(dx, 1), nx = 1 / len, nz = -dx / len, y = roadH(z) + 0.12;
    rpos.set([x - HW * nx, y, z - HW * nz, x + HW * nx, y, z + HW * nz], r * 6);
    ruv.set([0, z / 12, 1, z / 12], r * 4);
  }
  rg.attributes.position.needsUpdate = true; rg.attributes.uv.needsUpdate = true; rg.computeVertexNormals();
}

// ---------- Trees (green, snow-covered, or sparse island trees) ----------
const TC = 30, TR = 22, MAXT = (2 * TR + 1) ** 2;
const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.35, 0.5, 3, 6), new THREE.MeshLambertMaterial({ color: 0x5b3d24 }), MAXT);
const crown = new THREE.InstancedMesh(new THREE.ConeGeometry(2.6, 7, 7), new THREE.MeshLambertMaterial({ color: 0xffffff }), MAXT);
trunk.frustumCulled = crown.frustumCulled = false; scene.add(trunk, crown);
const dummy = new THREE.Object3D(), tc = new THREE.Color();
function buildTrees(cx, cz) {
  const ix = Math.round(cx / TC), iz = Math.round(cz / TC); let n = 0;
  for (let a = -TR; a <= TR; a++) for (let b = -TR; b <= TR; b++) {
    const gx = ix + a, gz = iz + b, r = hs(gx, gz);
    if (r < 0.35) continue;
    const x = gx * TC + (hs(gz, gx) - 0.5) * TC * 0.9, z = gz * TC + (hs(gx + 7, gz + 3) - 0.5) * TC * 0.9;
    if (Math.abs(x - roadX(z)) < 20) continue;
    const h = height(x, z), wS = bS, wL = bL;
    if (h < WL + 0.9 || h > 40 + wS * 20) continue;
    if (wL > 0.5 && r < 0.75) continue; // fewer trees on the islands
    const s = 0.8 + hs(gx + 1, gz + 9) * 1.1 + wS * 0.3;
    dummy.rotation.y = r * 6; dummy.scale.setScalar(s);
    dummy.position.set(x, h + 1.5 * s, z); dummy.updateMatrix(); trunk.setMatrixAt(n, dummy.matrix);
    dummy.position.y = h + 6 * s; dummy.updateMatrix(); crown.setMatrixAt(n, dummy.matrix);
    crown.setColorAt(n, tc.setHSL(0.25 + 0.08 * hs(gz, gx + 5), 0.55 * (1 - wS) + 0.1 * wS, 0.16 + 0.1 * r + wS * 0.6)); n++;
  }
  trunk.count = crown.count = n;
  trunk.instanceMatrix.needsUpdate = crown.instanceMatrix.needsUpdate = true;
  if (crown.instanceColor) crown.instanceColor.needsUpdate = true;
}

// ---------- Falling snow ----------
const SN = 900, SR = 70, snowPos = new Float32Array(SN * 3);
for (let i = 0; i < SN; i++) { snowPos[i * 3] = (Math.random() * 2 - 1) * SR; snowPos[i * 3 + 1] = Math.random() * 40; snowPos[i * 3 + 2] = (Math.random() * 2 - 1) * SR; }
const snowGeo = new THREE.BufferGeometry(); snowGeo.setAttribute('position', new THREE.BufferAttribute(snowPos, 3));
const snow = new THREE.Points(snowGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.5, transparent: true, opacity: 0, depthWrite: false }));
snow.frustumCulled = false; snow.visible = false; scene.add(snow);
const wrap = (v, c, R) => ((v - c + R) % (2 * R) + 2 * R) % (2 * R) - R + c;

// ---------- Tyre smoke (puffs from the rear wheels while drifting) ----------
const SMOKE_N = 36, smoke = [];
{
  const geo = new THREE.SphereGeometry(0.5, 6, 5);
  for (let i = 0; i < SMOKE_N; i++) {
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xe6e6e6, transparent: true, opacity: 0, depthWrite: false }));
    m.visible = false; m.userData = { life: 0, max: 1 }; scene.add(m); smoke.push(m);
  }
}
let smokeT = 0, smokeI = 0;
function puff(x, y, z) {
  const m = smoke[smokeI++ % SMOKE_N], u = m.userData;
  m.position.set(x, y, z); u.life = u.max = 0.8 + Math.random() * 0.5; m.scale.setScalar(0.5); m.visible = true;
}
function updateSmoke(dt) {
  for (const m of smoke) {
    const u = m.userData; if (u.life <= 0) continue;
    u.life -= dt;
    if (u.life <= 0) { m.visible = false; continue; }
    const k = 1 - u.life / u.max;
    m.scale.setScalar(0.6 + k * 2.8); m.position.y += dt * 1.2; m.material.opacity = 0.45 * (1 - k);
  }
}

// ---------- Car models: three different looks ----------
const part = (g, w, h, d, color, x, y, z, rx = 0, em = 0, ry = 0, rz = 0) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color, emissive: em }));
  m.position.set(x, y, z); m.rotation.set(rx, ry, rz); g.add(m); return m;
};
function addWheels(g, r, w, x, zf, zr, spokes, rimColor) {
  const out = [], tire = new THREE.MeshLambertMaterial({ color: 0x151515 }), rim = new THREE.MeshLambertMaterial({ color: rimColor });
  [[-1, zf], [1, zf], [-1, zr], [1, zr]].forEach(([sx, z]) => {
    const pivot = new THREE.Group(); pivot.position.set(sx * x, r, z);
    const wh = new THREE.Group();
    wh.add(new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 16), tire));
    if (spokes) {
      wh.add(new THREE.Mesh(new THREE.CylinderGeometry(r * 0.66, r * 0.66, w + 0.02, 16), rim));
      for (let k = 0; k < 5; k++) {
        const s = new THREE.Mesh(new THREE.BoxGeometry(r * 1.2, w + 0.04, 0.05), tire);
        s.rotation.y = k * Math.PI / 5; wh.add(s);
      }
    }
    wh.rotation.z = Math.PI / 2; pivot.add(wh); g.add(pivot);
    out.push({ pivot, w: wh, front: z > 0 });
  });
  return out;
}

function buildClassic() { // the original red sports car
  const g = new THREE.Group(), red = 0xd7261e;
  part(g, 1.9, 0.55, 4.3, red, 0, 0.65, 0);
  part(g, 1.6, 0.5, 2.0, red, 0, 1.15, -0.2);
  part(g, 1.62, 0.4, 0.05, 0x1b2a38, 0, 1.16, 0.82, -0.5);
  part(g, 1.62, 0.38, 0.05, 0x1b2a38, 0, 1.16, -1.22);
  part(g, 1.4, 0.05, 0.8, 0x151515, 0, 1.0, 2.0); // hood scoop strip
  [-1, 1].forEach(s => {
    part(g, 0.4, 0.18, 0.06, 0xfff6c0, s * 0.65, 0.7, 2.16, 0, 0xfff0a0);
    part(g, 0.4, 0.16, 0.06, 0xff2020, s * 0.65, 0.72, -2.16, 0, 0xaa0000);
  });
  part(g, 1.7, 0.08, 0.4, 0x151515, 0, 1.4, -2.0); // spoiler
  return { group: g, wheels: addWheels(g, 0.38, 0.3, 1.0, 1.3, -1.3, false, 0), hood: [1.45, 0.4], wingY: 1.05 };
}

function buildSport() { // silver sporty coupe with a star badge
  const g = new THREE.Group(), paint = 0xc9cdd2, glass = 0x14202b, dark = 0x101010, chrome = 0xe6e6e6;
  part(g, 1.92, 0.5, 4.5, paint, 0, 0.62, 0);                // lower body
  part(g, 1.8, 0.22, 1.7, paint, 0, 0.9, 1.25, 0.06);        // long hood
  part(g, 1.56, 0.42, 1.55, paint, 0, 1.08, -0.55);          // cabin
  part(g, 1.4, 0.05, 1.3, paint, 0, 1.32, -0.58);            // roof
  part(g, 1.58, 0.24, 1.2, glass, 0, 1.1, -0.55);            // side windows
  part(g, 1.5, 0.45, 0.05, glass, 0, 1.07, 0.3, -0.62);      // windscreen
  part(g, 1.5, 0.42, 0.05, glass, 0, 1.06, -1.35, 0.7);      // rear window
  part(g, 1.8, 0.2, 1.0, paint, 0, 0.88, -1.75, -0.08);      // fastback deck
  part(g, 1.6, 0.05, 0.3, paint, 0, 0.99, -2.1);             // ducktail
  part(g, 1.1, 0.22, 0.06, dark, 0, 0.62, 2.27);             // grille
  part(g, 1.3, 0.1, 0.05, dark, 0, 0.44, 2.26);              // lower intake
  part(g, 1.5, 0.1, 0.05, 0xff2020, 0, 0.82, -2.27, 0, 0xaa0000); // tail light bar
  part(g, 1.5, 0.12, 0.3, dark, 0, 0.36, -2.15);             // diffuser
  [-1, 1].forEach(s => {
    part(g, 0.5, 0.09, 0.06, 0xffffff, s * 0.7, 0.8, 2.27, 0, 0xcfe8ff, s * 0.25); // headlight strips
    part(g, 0.06, 0.12, 2.6, dark, s * 0.97, 0.4, 0);        // side skirts
    part(g, 0.2, 0.1, 0.12, paint, s * 1.0, 1.0, 0.2);       // mirrors
    part(g, 0.3, 0.12, 0.95, paint, s * 1.0, 0.76, 1.4);     // front fender flares
    part(g, 0.3, 0.12, 0.95, paint, s * 1.0, 0.76, -1.4);    // rear fender flares
  });
  const chromeMat = new THREE.MeshLambertMaterial({ color: chrome, emissive: 0x222222 });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.125, 0.016, 8, 24), chromeMat);
  ring.position.set(0, 0.64, 2.31); g.add(ring);
  for (let k = 0; k < 3; k++) { // three-pointed star
    const a = Math.PI / 2 + k * 2 * Math.PI / 3;
    part(g, 0.016, 0.12, 0.012, chrome, Math.cos(a) * 0.06, 0.64 + Math.sin(a) * 0.06, 2.315, 0, 0x222222, 0, a - Math.PI / 2);
  }
  [-0.62, -0.4, 0.4, 0.62].forEach(x => { // quad exhausts
    const e = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.25, 10), new THREE.MeshLambertMaterial({ color: 0x5a5a5a }));
    e.rotation.x = Math.PI / 2; e.position.set(x, 0.4, -2.3); g.add(e);
  });
  return { group: g, wheels: addWheels(g, 0.4, 0.3, 1.0, 1.4, -1.4, true, 0xd0d4d8), hood: [1.12, 0.05], wingY: 1.05 };
}

function buildHyper() { // low yellow wedge supercar
  const g = new THREE.Group(), paint = 0xf5c400, glass = 0x101a24, dark = 0x0d0d0d;
  part(g, 2.0, 0.34, 4.3, paint, 0, 0.5, 0);                 // tub
  part(g, 1.9, 0.1, 1.5, paint, 0, 0.64, 1.55, 0.1);         // nose wedge
  part(g, 1.5, 0.3, 1.9, paint, 0, 0.88, -0.25);             // cabin
  part(g, 1.3, 0.04, 1.0, paint, 0, 1.05, -0.1);             // roof
  part(g, 1.52, 0.18, 1.2, glass, 0, 0.92, -0.2);            // side windows
  part(g, 1.4, 0.55, 0.05, glass, 0, 0.88, 0.65, -1.15);     // raked windscreen
  part(g, 1.8, 0.14, 1.6, paint, 0, 0.8, -1.4, -0.12);       // engine cover
  [-0.95, -1.25, -1.55, -1.85].forEach(z => part(g, 1.2, 0.025, 0.1, dark, 0, 0.89 + 0.12 * (z + 1.4), z, -0.12)); // vents
  part(g, 1.9, 0.05, 0.4, dark, 0, 0.33, 2.25);              // front splitter
  part(g, 1.1, 0.12, 0.06, dark, 0, 0.45, 2.17);             // front intake
  part(g, 1.5, 0.15, 0.4, dark, 0, 0.36, -2.1);              // diffuser
  part(g, 1.9, 0.05, 0.5, dark, 0, 1.1, -2.05, 0.08);        // rear wing
  [-1, 1].forEach(s => {
    part(g, 0.06, 0.2, 0.9, dark, s * 1.0, 0.6, -0.9);       // side intakes
    part(g, 0.7, 0.1, 0.07, dark, s * 0.62, 0.6, 2.29);      // headlight housings
    part(g, 0.6, 0.05, 0.06, 0xffffff, s * 0.62, 0.6, 2.33, 0, 0xffffff); // headlights
    part(g, 0.7, 0.08, 0.05, 0xff2020, s * 0.55, 0.6, -2.17, 0, 0xaa0000); // tail lights
    part(g, 0.26, 0.08, 0.14, paint, s * 0.9, 0.85, 0.5);    // mirrors
    part(g, 0.34, 0.14, 0.95, paint, s * 1.0, 0.72, 1.4);    // front flares
    part(g, 0.34, 0.14, 0.95, paint, s * 1.0, 0.72, -1.35);  // rear flares
    part(g, 0.06, 0.4, 0.2, dark, s * 0.7, 0.88, -1.95);     // wing posts
    part(g, 0.05, 0.22, 0.5, dark, s * 0.95, 1.1, -2.05);    // wing end plates
  });
  [-0.3, 0.3].forEach(x => { // twin exhausts
    const e = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.25, 10), new THREE.MeshLambertMaterial({ color: 0x666666 }));
    e.rotation.x = Math.PI / 2; e.position.set(x, 0.5, -2.22); g.add(e);
  });
  return { group: g, wheels: addWheels(g, 0.37, 0.32, 1.0, 1.4, -1.35, true, 0x9aa0a8), hood: [0.97, 0.3], wingY: 0.9 };
}
// max = top speed in MPH. The yellow supercar is the only one that goes past 250.
const CARS = [{ build: buildClassic, max: 250 }, { build: buildSport, max: 250 }, { build: buildHyper, max: 400 }];

// The car you drive: a group that holds the chosen model, plus buoys and wings
const car3d = new THREE.Group(), body = new THREE.Group(); car3d.add(body);
let model = null, wheels = [], hood = [1.45, 0.4];
car3d.visible = false; // hidden until a car is picked

// Buoys: two pontoons on arms that grow out of the car when it hits water
const buoys = new THREE.Group(); body.add(buoys);
{
  const orange = new THREE.MeshLambertMaterial({ color: 0xff7a1a }), white = new THREE.MeshLambertMaterial({ color: 0xf4f4f4 });
  [-1, 1].forEach(s => {
    const pont = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 3.2, 12), orange);
    pont.rotation.x = Math.PI / 2; pont.position.set(s * 2.0, 0.08, 0); buoys.add(pont);
    [1.6, -1.6].forEach(z => { const cap = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 8), orange); cap.position.set(s * 2.0, 0.08, z); buoys.add(cap); });
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.315, 0.315, 0.5, 12), white);
    band.rotation.x = Math.PI / 2; band.position.set(s * 2.0, 0.08, 0.6); buoys.add(band);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.09, 0.14), new THREE.MeshLambertMaterial({ color: 0x2a2a2a }));
    arm.position.set(s * 1.45, 0.45, 0.6); buoys.add(arm);
    const arm2 = arm.clone(); arm2.position.z = -0.9; buoys.add(arm2);
  });
}
buoys.scale.setScalar(0.001); buoys.visible = false;

// Wings: grow out of the car's sides when it is more than 100 ft above the ground
let wingG = 0, wingsOut = false;
const wings = [];
{
  const white = new THREE.MeshLambertMaterial({ color: 0xf2f2f2 }), red = new THREE.MeshLambertMaterial({ color: 0xd7261e });
  [-1, 1].forEach(s => {
    const w = new THREE.Group();
    w.position.set(s * 0.95, 1.05, -0.2);
    w.rotation.set(0, s * 0.3, s * 0.06); // swept back, with a slight upward angle
    const panel = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.08, 1.5), white);
    panel.position.set(s * 2.2, 0, 0); w.add(panel);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.09, 0.2), red);
    stripe.position.set(s * 2.2, 0, 0.65); w.add(stripe);
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.6, 0.7), red);
    tip.position.set(s * 4.4, 0.3, -0.2); w.add(tip);
    w.scale.set(0.001, 0.3, 0.3); w.visible = false;
    body.add(w); wings.push(w);
  });
}
scene.add(car3d);

// ---------- HUD: biome label (built here so index.html stays unchanged) ----------
const hudEl = document.getElementById('hud');
hudEl.style.visibility = 'hidden'; // shown once a car is picked
const biomeEl = document.createElement('div');
biomeEl.style.cssText = 'position:absolute;left:24px;top:24px;padding:8px 14px;border-radius:10px;font-size:15px;background:rgba(18,32,22,.55);backdrop-filter:blur(6px)';
hudEl.appendChild(biomeEl);
let biomeName = '';

// ---------- Map: minimap at the bottom, press M for the big map ----------
// North (up on the map) is the way you face at the start; east is to the right.
const OFF_N = 192, OFF_CELL = 100, OFF_R = OFF_N * OFF_CELL / 2; // baked biome picture covers +/-9.6 km
const offc = document.createElement('canvas'); offc.width = offc.height = OFF_N;
const offx = offc.getContext('2d'), offImg = offx.createImageData(OFF_N, OFF_N);
const MAP_G = [96, 168, 76], MAP_S = [236, 243, 250], MAP_L = [64, 150, 200];
let mcx = 1e9, mcz = 1e9, bigMap = false, mapPx = 0, mapDpr = 1;
const mapEl = document.createElement('canvas'), mctx = mapEl.getContext('2d');
mapEl.style.cssText = 'position:absolute;border-radius:12px;border:2px solid rgba(255,255,255,.9);box-shadow:0 4px 18px rgba(0,0,0,.35);background:#5a9e4c';
hudEl.appendChild(mapEl);
const hintEl = document.getElementById('hint');
if (hintEl) { // move the key hints to the top right and add the map and drift keys
  hintEl.innerHTML = 'C camera &nbsp; R reset &nbsp; M map &nbsp; Space handbrake &nbsp; Space + A/D drift';
  hintEl.style.top = '24px'; hintEl.style.bottom = 'auto'; hintEl.style.left = 'auto'; hintEl.style.right = '24px';
}
function sizeMap() {
  mapDpr = Math.min(window.devicePixelRatio || 1, 2);
  const small = innerWidth < 600;
  const css = bigMap ? Math.round(Math.min(innerWidth, innerHeight) * 0.82) : (innerWidth < 700 ? 130 : 200);
  mapPx = Math.round(css * mapDpr); mapEl.width = mapEl.height = mapPx;
  mapEl.style.width = mapEl.style.height = css + 'px';
  mapEl.style.left = (bigMap || !small) ? '50%' : '12px';
  mapEl.style.top = bigMap ? '50%' : 'auto';
  mapEl.style.bottom = bigMap ? 'auto' : (small ? '12px' : '24px');
  mapEl.style.transform = bigMap ? 'translate(-50%,-50%)' : small ? 'none' : 'translateX(-50%)';
  mapEl.style.opacity = bigMap ? '0.96' : '1';
}
sizeMap();
function bakeMap(cx, cz) { // paints the biome colours for the area around (cx, cz)
  mcx = cx; mcz = cz; const d = offImg.data;
  for (let j = 0; j < OFF_N; j++) for (let i = 0; i < OFF_N; i++) {
    const x = cx + OFF_R - (i + 0.5) * OFF_CELL, z = cz + OFF_R - (j + 0.5) * OFF_CELL;
    biome(x, z);
    const wS = bS, wL = bL, wG = 1 - wS - wL, k = 0.95 + 0.05 * hs(Math.floor(x / OFF_CELL), Math.floor(z / OFF_CELL)), p = (j * OFF_N + i) * 4;
    d[p] = (MAP_G[0] * wG + MAP_S[0] * wS + MAP_L[0] * wL) * k;
    d[p + 1] = (MAP_G[1] * wG + MAP_S[1] * wS + MAP_L[1] * wL) * k;
    d[p + 2] = (MAP_G[2] * wG + MAP_S[2] * wS + MAP_L[2] * wL) * k;
    d[p + 3] = 255;
  }
  offx.putImageData(offImg, 0, 0);
}
const MAP_FONT = '"Bahnschrift", "Segoe UI", system-ui, sans-serif';
function drawMap() {
  const W = mapPx, R = bigMap ? 9000 : 3300, sc = W / (2 * R), u = mapDpr, g = mctx;
  if (Math.hypot(car.x - mcx, car.z - mcz) > 500)
    bakeMap(Math.round(car.x / OFF_CELL) * OFF_CELL, Math.round(car.z / OFF_CELL) * OFF_CELL);
  const X = x => W / 2 - (x - car.x) * sc, Z = z => W / 2 - (z - car.z) * sc; // +z is up, -x is right

  g.clearRect(0, 0, W, W);
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
  const sw = 2 * R / OFF_CELL;
  g.drawImage(offc, (mcx + OFF_R - car.x - R) / OFF_CELL, (mcz + OFF_R - car.z - R) / OFF_CELL, sw, sw, 0, 0, W, W);

  // 1 km grid
  g.strokeStyle = 'rgba(255,255,255,.22)'; g.lineWidth = u; g.beginPath();
  for (let x = Math.ceil((car.x - R) / 1000) * 1000; x <= car.x + R; x += 1000) { g.moveTo(X(x), 0); g.lineTo(X(x), W); }
  for (let z = Math.ceil((car.z - R) / 1000) * 1000; z <= car.z + R; z += 1000) { g.moveTo(0, Z(z)); g.lineTo(W, Z(z)); }
  g.stroke();

  // the road
  const rp = new Path2D(), step = R / 120; let first = true;
  for (let z = car.z - R; z <= car.z + R + step; z += step) {
    const px = X(roadX(z)), py = Z(z);
    if (first) { rp.moveTo(px, py); first = false; } else rp.lineTo(px, py);
  }
  g.lineJoin = 'round'; g.lineCap = 'round';
  g.strokeStyle = 'rgba(255,255,255,.65)'; g.lineWidth = 4.5 * u; g.stroke(rp);
  g.strokeStyle = '#2a2a30'; g.lineWidth = 2.2 * u; g.stroke(rp);

  g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineWidth = 3 * u; g.strokeStyle = 'rgba(0,0,0,.55)'; g.fillStyle = '#fff';
  if (bigMap) { // name each biome band
    const x0 = car.x + R * 0.5, C = x0 / 4000 + 0.25 * Math.sin(x0 / 1000) + 0.2;
    g.font = `bold ${14 * u}px ${MAP_FONT}`;
    [['Starter fields', 0.46], ['Snowy peaks', 1.5], ['Lake district', 2.46]].forEach(([name, pc]) => {
      const k0 = Math.floor(((car.z - R) / 2200 + C - pc) / 3), k1 = Math.ceil(((car.z + R) / 2200 + C - pc) / 3);
      for (let k = k0; k <= k1; k++) {
        const my = Z(2200 * (pc + 3 * k - C));
        if (my > 24 * u && my < W - 24 * u) { g.strokeText(name, X(x0), my); g.fillText(name, X(x0), my); }
      }
    });
    g.font = `${12 * u}px ${MAP_FONT}`;
    g.strokeText('Press M to close', W / 2, W - 14 * u); g.fillText('Press M to close', W / 2, W - 14 * u);
  }
  g.font = `bold ${(bigMap ? 14 : 11) * u}px ${MAP_FONT}`; // north marker
  g.strokeText('N', W / 2, 13 * u); g.fillText('N', W / 2, 13 * u);

  // you: an arrow pointing the way the car faces
  g.save(); g.translate(W / 2, W / 2); g.rotate(-car.yaw);
  const a = (bigMap ? 9 : 8) * u;
  g.beginPath(); g.moveTo(0, -a); g.lineTo(a * 0.75, a * 0.85); g.lineTo(0, a * 0.4); g.lineTo(-a * 0.75, a * 0.85); g.closePath();
  g.fillStyle = '#ffd34d'; g.strokeStyle = '#1a1a1a'; g.lineWidth = 1.6 * u; g.fill(); g.stroke();
  g.restore();
}

// ---------- Input: title -> car selection -> play ----------
const keys = {}; let phase = 'title', camMode = 0;
const startEl = document.getElementById('start');
const goEl = startEl.querySelector('.go'); if (goEl) goEl.textContent = 'Press any key to start';
addEventListener('keydown', e => {
  if (phase === 'title') { // first key press opens the car selection
    phase = 'select'; startEl.classList.add('hidden'); pickEl.style.display = 'flex'; return;
  }
  if (phase !== 'play') return; // while choosing, buttons work normally
  keys[e.code] = true;
  if (e.code === 'KeyC') camMode = (camMode + 1) % 3;
  if (e.code === 'KeyR') resetCar();
  if (e.code === 'KeyM' && !e.repeat) { bigMap = !bigMap; sizeMap(); }
  if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
});
addEventListener('keyup', e => keys[e.code] = false);
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); sizeMap(); });

// ---------- Car selection screen (3D previews drawn by a small second renderer) ----------
const pickStyle = document.createElement('style');
pickStyle.textContent = `
#pick{position:fixed;inset:0;z-index:10;display:none;flex-direction:column;align-items:center;padding:24px;overflow:auto;
  background:linear-gradient(rgba(14,38,24,.55),rgba(14,38,24,.82));backdrop-filter:blur(3px);color:var(--ink)}
#pick h2{margin:auto 0 18px;font-size:clamp(28px,5vw,44px);text-align:center}
#pick .row{display:flex;flex-wrap:wrap;gap:20px;justify-content:center;margin-bottom:auto}
#pick .card{display:flex;flex-direction:column;align-items:center;gap:12px;padding:14px;border-radius:16px;background:var(--glass);border:2px solid transparent}
#pick .card:hover,#pick .card:focus-within{border-color:var(--accent)}
#pick canvas{width:min(84vw,340px);height:auto;aspect-ratio:11/7;display:block}
#pick button{font:inherit;font-weight:700;font-size:18px;padding:10px 38px;border:0;border-radius:10px;background:var(--accent);color:#1b2a14;cursor:pointer}
#pick button:hover{filter:brightness(1.08)}
#pick button:focus-visible{outline:3px solid #fff;outline-offset:2px}`;
document.head.appendChild(pickStyle);
const pickEl = document.createElement('div'); pickEl.id = 'pick';
pickEl.innerHTML = '<h2>Choose your car</h2><div class="row"></div>';
document.body.appendChild(pickEl);
const rowEl = pickEl.querySelector('.row'), PW = 440, PH = 280;
CARS.forEach((c, i) => {
  const card = document.createElement('div'); card.className = 'card';
  const cvs = document.createElement('canvas'); cvs.width = PW; cvs.height = PH;
  cvs.setAttribute('role', 'img'); cvs.setAttribute('aria-label', 'Car option ' + (i + 1));
  c.ctx = cvs.getContext('2d');
  const btn = document.createElement('button'); btn.textContent = 'Pick'; btn.setAttribute('aria-label', 'Pick car ' + (i + 1));
  btn.addEventListener('click', () => pickCar(i));
  card.append(cvs, btn); rowEl.appendChild(card);
});
const pr = new THREE.WebGLRenderer({ antialias: true, alpha: true });
pr.setSize(PW, PH); pr.setClearColor(0x000000, 0);
const pScene = new THREE.Scene(), pCam = new THREE.PerspectiveCamera(30, PW / PH, 0.5, 50);
pCam.position.set(4.6, 2.3, 6.8); pCam.lookAt(0, 0.65, 0);
pScene.add(new THREE.HemisphereLight(0xdfefff, 0x445544, 0.95));
const pLight = new THREE.DirectionalLight(0xffffff, 0.9); pLight.position.set(3, 6, 4); pScene.add(pLight);
const pGround = new THREE.Mesh(new THREE.CircleGeometry(3, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25 }));
pGround.position.y = 0.01; pScene.add(pGround);
const pModels = CARS.map(c => { const m = c.build(); m.group.visible = false; pScene.add(m.group); return m; });
function renderPreviews(t) {
  CARS.forEach((c, i) => {
    pModels.forEach((m, j) => m.group.visible = j === i);
    pModels[i].group.rotation.y = t * 0.6 + 0.6;
    pr.render(pScene, pCam);
    c.ctx.clearRect(0, 0, PW, PH); c.ctx.drawImage(pr.domElement, 0, 0);
  });
}
const limitEl = document.getElementById('limit');
function pickCar(i) {
  const m = CARS[i].build();
  if (model) body.remove(model.group);
  model = m; body.add(m.group); wheels = m.wheels; hood = m.hood;
  wings.forEach(w => w.position.y = m.wingY);
  MAXMPH = CARS[i].max; MAX = MAXMPH / MPH; // this car's top speed
  if (limitEl) limitEl.textContent = 'Limit ' + MAXMPH + ' mph';
  car3d.visible = true; pickEl.style.display = 'none'; hudEl.style.visibility = 'visible';
  if (document.activeElement) document.activeElement.blur();
  for (const k in keys) keys[k] = false;
  phase = 'play';
}

// ---------- Car physics ----------
const car = { x: 0, z: 0, yaw: 0, vx: 0, vz: 0, vy: 0, steer: 0, pitch: 0, roll: 0, y: 0, air: false, wet: false, drift: 0 };
function resetCar() {
  car.x = roadX(car.z); car.yaw = Math.atan2(roadX(car.z + 1) - car.x, 1);
  car.vx = car.vz = car.vy = 0; car.steer = 0; car.air = false; car.wet = false; car.drift = 0;
  car.y = Math.max(height(car.x, car.z) + 0.05, WL + 0.22);
}
resetCar();

let lastCx = 1e9, lastCz = 1e9, camYaw = 0, camPos = new THREE.Vector3(0, 10, -15), wheelRot = 0, time = 0, buoyG = 0;
const speedEl = document.getElementById('speed'), fillEl = document.getElementById('fill');
const tint = new THREE.Color(), tintSnow = new THREE.Color(0.82, 0.86, 0.95), tintLake = new THREE.Color(0.88, 0.98, 1);
const clock = new THREE.Clock(), smokeV = new THREE.Vector3();

function update(dt) {
  time += dt;
  biome(car.x, car.z); const cS = bS, cL = bL; // biome weights at the car

  const gas = keys.KeyW || keys.ArrowUp, brake = keys.KeyS || keys.ArrowDown, hb = keys.Space;
  const steerIn = ((keys.KeyA || keys.ArrowLeft) ? 1 : 0) - ((keys.KeyD || keys.ArrowRight) ? 1 : 0);
  const offRoad = Math.abs(car.x - roadX(car.z)) > HW + 0.5;

  // ---- steering and drift state (uses the velocity from the start of the frame) ----
  // vf = speed along the car's nose, vl = sideways speed (positive = towards the car's left)
  const fx = Math.sin(car.yaw), fz = Math.cos(car.yaw);
  let vf = car.vx * fx + car.vz * fz, vl = car.vx * fz - car.vz * fx;
  const sp0 = Math.hypot(vf, vl);
  car.steer += (steerIn - car.steer) * Math.min(1, 7 * dt);

  // drifting: handbrake + turning, at speed, on the ground (not on water)
  const wantDrift = hb && Math.abs(car.steer) > 0.25 && sp0 > 12 && vf > 6 && !car.air && !car.wet;
  car.drift += ((wantDrift ? 1 : 0) - car.drift) * Math.min(1, (wantDrift ? 8 : 4) * dt);
  const dr = car.drift;

  const steerBite = clamp(Math.abs(vf) / 8, 0, 1) * Math.sign(vf);
  const authority = car.air ? 0.25 : 1;
  const normalRate = 1.8 / (1 + sp0 * 0.04);   // ordinary turning gets weaker as you go faster
  const driftRate = 1.7 / (1 + sp0 * 0.006);   // a drift keeps turning hard at any speed
  let yawRate = car.steer * (normalRate * (1 - dr) + driftRate * dr);
  // don't let the slide angle run away: turning further into a big slide gets less effective
  if (dr > 0.01 && car.steer * vl < 0) yawRate *= 1 - dr * sm(0.5, 0.95, Math.atan2(Math.abs(vl), Math.max(vf, 1)));
  car.yaw += yawRate * steerBite * authority * dt;

  // the car has turned but its momentum hasn't: work out the new forward and sideways speeds
  const nfx = Math.sin(car.yaw), nfz = Math.cos(car.yaw);
  vf = car.vx * nfx + car.vz * nfz; vl = car.vx * nfz - car.vz * nfx;

  // ---- engine, brakes, grip ----
  if (!car.air) {
    const eng = car.wet ? 0.85 : 1; // a bit less engine power on water
    const sp = Math.hypot(vf, vl);
    if (gas && vf >= -0.5) vf += (8 + 34 * (1 - Math.pow(sp / MAX, 3))) * eng * dt;
    if (brake) vf -= (vf > 1 ? 45 : 14) * dt;
    if (hb) vf -= Math.sign(vf) * Math.min(Math.abs(vf), 30 * (1 - dr) * dt); // handbrake brakes, unless you're drifting
    vf -= vf * 0.012 * dt + Math.sign(vf) * 0.6 * dt;
    vf -= vf * 0.12 * dr * dt;                                                  // drifting scrubs a little speed
    if (car.wet) {
      vf -= vf * Math.abs(vf) * 0.004 * dt;     // water drag
      vl *= Math.exp(-3 * dt);                  // slidey, boat-like handling
    } else {
      if (offRoad) { const k = Math.exp(-(0.4 + 0.3 * cS) * dt); vf *= k; vl *= k; } // grass and deep snow slow you down
      const gripK = (hb ? 1.5 : 7 - 3 * cS) * (1 - dr) + 0.9 * dr;                   // tyre grip: less in snow, very little in a drift
      vl *= Math.exp(-gripK * dt);
    }
  } else {
    vf -= vf * 0.004 * dt;          // in the air: no engine, no grip, almost no drag
    vl *= Math.exp(-0.4 * dt);
  }
  const spTot = Math.hypot(vf, vl);
  if (spTot > MAX) { const k = MAX / spTot; vf *= k; vl *= k; } // this car's speed limit
  vf = Math.max(vf, -14);

  car.vx = nfx * vf + nfz * vl; car.vz = nfz * vf - nfx * vl;
  car.x += car.vx * dt; car.z += car.vz * dt;

  // ---- vertical physics (water surface counts as ground) ----
  const terr = height(car.x, car.z), wetNow = terr < WL - 0.05;
  const bob = wetNow ? Math.sin(time * 2.2 + car.x * 0.04) * 0.06 : 0;
  const gY = Math.max(terr + 0.05, WL + 0.22 + bob);
  if (!car.air) {
    const yFree = car.y + car.vy * dt - 0.5 * G * dt * dt;
    if (yFree > gY + 0.001) { // ground dropped away faster than gravity: take off
      car.air = true; car.vy -= G * dt; car.y += car.vy * dt;
    } else {
      car.vy = clamp((gY - car.y) / dt, -80, 80);
      car.y = gY;
    }
  } else {
    car.vy -= G * dt;
    car.y += car.vy * dt;
    if (car.y <= gY) { // landing
      const hit = -car.vy;
      vf *= 1 - clamp((hit - 10) / 100, 0, 0.25) * (wetNow ? 0.4 : 1); // water is softer than ground
      car.vx = nfx * vf + nfz * vl; car.vz = nfz * vf - nfx * vl;
      car.y = gY; car.vy = 0; car.air = false;
    }
  }
  car.wet = wetNow;

  // ---- tilt: follow the slope on land, bob gently on water, follow the flight path in the air ----
  const hF = groundAt(car.x + nfx * 2, car.z + nfz * 2), hB = groundAt(car.x - nfx * 2, car.z - nfz * 2);
  const hR = groundAt(car.x + nfz * 1.5, car.z - nfx * 1.5), hL = groundAt(car.x - nfz * 1.5, car.z + nfx * 1.5);
  let targetPitch, targetRoll, rate;
  if (car.air) { targetPitch = -Math.atan2(car.vy, Math.max(Math.abs(vf), 8)); targetRoll = 0; rate = 3; }
  else {
    targetPitch = Math.atan2(hB - hF, 4) + (car.wet ? Math.sin(time * 1.3) * 0.025 : 0);
    targetRoll = Math.atan2(hR - hL, 3) + (car.wet ? Math.sin(time * 1.7 + 1) * 0.03 : 0);
    rate = 10;
  }
  car.pitch += (targetPitch - car.pitch) * Math.min(1, rate * dt);
  car.roll += (targetRoll - car.roll) * Math.min(1, rate * dt);

  car3d.position.set(car.x, car.y, car.z);
  car3d.rotation.set(car.pitch, car.yaw, car.roll, 'YXZ');
  body.rotation.z = -car.steer * Math.min(1, Math.max(vf, 0) / MAX) * 0.06 - car.steer * dr * 0.05; // the body leans into a drift

  // buoys grow out when over water, shrink back on land
  buoyG += ((car.wet ? 1 : 0) - buoyG) * Math.min(1, 4 * dt);
  buoys.scale.setScalar(Math.max(buoyG, 0.001)); buoys.visible = buoyG > 0.02;

  // wings grow out above 100 ft (30.48 m), and fold away below about 65 ft
  const alt = car.y - groundAt(car.x, car.z);
  if (alt > 30.48) wingsOut = true; else if (alt < 20) wingsOut = false;
  wingG += ((wingsOut ? 1 : 0) - wingG) * Math.min(1, 5 * dt);
  wings.forEach(w => { w.scale.set(Math.max(wingG, 0.001), 0.3 + 0.7 * wingG, 0.3 + 0.7 * wingG); w.visible = wingG > 0.02; });

  wheelRot += vf * dt / 0.38;
  wheels.forEach(o => { o.w.rotation.x = wheelRot; if (o.front) o.pivot.rotation.y = car.steer * 0.4; });

  // tyre smoke from the rear wheels while drifting
  if (phase === 'play' && dr > 0.5 && !car.air) {
    smokeT += dt; car3d.updateMatrixWorld(true);
    while (smokeT > 0.035) {
      smokeT -= 0.035;
      smokeV.set(Math.random() < 0.5 ? -1 : 1, 0.25, -1.35); car3d.localToWorld(smokeV);
      puff(smokeV.x, smokeV.y, smokeV.z);
    }
  } else smokeT = 0;
  updateSmoke(dt);

  // keep the world around the car
  if (Math.hypot(car.x - lastCx, car.z - lastCz) > 45) {
    lastCx = car.x; lastCz = car.z;
    buildTerrain(Math.round(car.x / CELL) * CELL, Math.round(car.z / CELL) * CELL);
    buildRoad(car.z); buildTrees(car.x, car.z);
  }
  water.position.set(Math.round(car.x / 40) * 40, WL, Math.round(car.z / 40) * 40);
  wtex.offset.set(time * 0.012, time * 0.007);

  // snow falls in the snowy biome
  snow.visible = cS > 0.05; snow.material.opacity = cS * 0.9;
  if (snow.visible) {
    for (let i = 0; i < SN; i++) {
      const i3 = i * 3;
      let x = snowPos[i3] + 1.5 * dt, y = snowPos[i3 + 1] - 7 * dt, z = snowPos[i3 + 2];
      snowPos[i3] = wrap(x, car.x, SR); snowPos[i3 + 2] = wrap(z, car.z, SR);
      snowPos[i3 + 1] = ((y - car.y + 8) % 44 + 44) % 44 - 8 + car.y;
    }
    snowGeo.attributes.position.needsUpdate = true;
  }

  // sky and fog take on the biome's mood
  tint.set(0xffffff).lerp(tintSnow, cS).lerp(tintLake, cL);
  sky.material.color.copy(tint); scene.fog.color.copy(horizon).multiply(tint);
  scene.fog.near = 250 - 120 * cS; scene.fog.far = 1100 - 400 * cS;

  const name = cL > 0.5 ? 'Lake district' : cS > 0.5 ? 'Snowy peaks' : 'Starter fields';
  if (name !== biomeName) { biomeName = name; biomeEl.textContent = name; }

  // camera
  const speedNow = Math.hypot(car.vx, car.vz);
  camYaw += Math.atan2(Math.sin(car.yaw - camYaw), Math.cos(car.yaw - camYaw)) * Math.min(1, 4 * dt);
  const spd = clamp(speedNow / MAX, 0, 1);
  if (camMode === 2) { // hood (position depends on the chosen car)
    car3d.updateMatrixWorld();
    const p = new THREE.Vector3(0, hood[0], hood[1]).applyMatrix4(car3d.matrixWorld);
    camera.position.copy(p); camera.lookAt(p.x + nfx * 20, p.y + 0.3, p.z + nfz * 20);
  } else {
    const dist = camMode === 0 ? 11 + spd * 4 : 7, hgt = camMode === 0 ? 4.2 : 2.6;
    const camRate = 9 + 6 * Math.min(speedNow / 111, 2); // follow faster when you go faster, so 400 mph doesn't leave the camera behind
    const target = new THREE.Vector3(car.x - Math.sin(camYaw) * dist, car.y + hgt, car.z - Math.cos(camYaw) * dist);
    camPos.lerp(target, Math.min(1, camRate * dt)); camera.position.copy(camPos);
    camera.position.y = Math.max(camera.position.y, groundAt(camPos.x, camPos.z) + 1.5);
    camera.lookAt(car.x + nfx * 6, car.y + 1.4, car.z + nfz * 6);
  }
  camera.fov = 62 + spd * 26; camera.updateProjectionMatrix();

  sky.position.set(car.x, 0, car.z); clouds.position.set(car.x, 0, car.z);
  sun.position.set(car.x - 900, 1100, car.z + 700);
  sunLight.position.set(car.x - 50, 80, car.z + 40); sunLight.target.position.set(car.x, 0, car.z);

  const mph = Math.round(speedNow * MPH);
  speedEl.textContent = mph; fillEl.style.width = Math.min(100, mph / MAXMPH * 100) + '%';

  if (phase === 'play') drawMap();
}

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  update(phase === 'play' ? dt : 0.0001);
  renderer.render(scene, camera);
  if (phase === 'select') renderPreviews(performance.now() / 1000);
});
})();
