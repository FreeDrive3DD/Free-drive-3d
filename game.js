(() => {
const MPH = 2.23694, MAX = 250 / MPH; // top speed capped at 250 mph (in m/s)
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const sm = (a, b, x) => { x = clamp((x - a) / (b - a), 0, 1); return x * x * (3 - 2 * x); };
const hs = (a, b) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };

// ---------- World shape: winding road, rolling hills ----------
const roadX = z => Math.sin(z * 0.004) * 140 + Math.sin(z * 0.0113) * 45;
const roadH = z => Math.sin(z * 0.0031) * 14 + Math.sin(z * 0.009) * 5;
const hills = (x, z) =>
  Math.sin(x * 0.0057 + 1) * Math.sin(z * 0.0049) * 34 +
  Math.sin(x * 0.013 + z * 0.009) * 9 +
  Math.sin(x * 0.031) * Math.cos(z * 0.027) * 3 + 8;
const height = (x, z) => {
  const r = roadH(z), d = Math.abs(x - roadX(z));
  return r + (hills(x, z) - r) * sm(12, 70, d); // flat near the road, hilly away from it
};

// ---------- Renderer, scene, sky ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
document.getElementById('game').appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xcfe6f2, 250, 1100);
const camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.5, 2600);

const sky = new THREE.Mesh(new THREE.SphereGeometry(1900, 24, 16),
  new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false }));
{
  const p = sky.geometry.attributes.position, cols = [], top = new THREE.Color(0x3f8fe0), hor = new THREE.Color(0xdceff7), c = new THREE.Color();
  for (let i = 0; i < p.count; i++) { c.copy(hor).lerp(top, clamp(p.getY(i) / 1500, 0, 1)); cols.push(c.r, c.g, c.b); }
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
const col = new THREE.Color(), rock = new THREE.Color(0x8a8a80);
function buildTerrain(cx, cz) {
  terrain.position.set(cx, 0, cz);
  for (let i = 0; i < tp.count; i++) {
    const x = cx + lx[i], z = cz + lz[i], h = height(x, z);
    const n = hs(Math.round(x / CELL), Math.round(z / CELL)), meadow = sm(-5, 22, h);
    col.setRGB(0.13 + 0.07 * n + 0.12 * meadow, 0.36 + 0.14 * n + 0.1 * meadow, 0.1 + 0.05 * n);
    col.lerp(rock, sm(30, 48, h + n * 6));
    tp.setY(i, h); tcol[i * 3] = col.r; tcol[i * 3 + 1] = col.g; tcol[i * 3 + 2] = col.b;
  }
  tp.needsUpdate = true; tg.attributes.color.needsUpdate = true; tg.computeVertexNormals();
}

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

// ---------- Trees ----------
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
    const h = height(x, z); if (h > 38) continue;
    const s = 0.8 + hs(gx + 1, gz + 9) * 1.1;
    dummy.rotation.y = r * 6; dummy.scale.setScalar(s);
    dummy.position.set(x, h + 1.5 * s, z); dummy.updateMatrix(); trunk.setMatrixAt(n, dummy.matrix);
    dummy.position.y = h + 6 * s; dummy.updateMatrix(); crown.setMatrixAt(n, dummy.matrix);
    crown.setColorAt(n, tc.setHSL(0.25 + 0.08 * hs(gz, gx + 5), 0.55, 0.16 + 0.1 * r)); n++;
  }
  trunk.count = crown.count = n;
  trunk.instanceMatrix.needsUpdate = crown.instanceMatrix.needsUpdate = true;
  if (crown.instanceColor) crown.instanceColor.needsUpdate = true;
}

// ---------- Car model ----------
const car3d = new THREE.Group(), body = new THREE.Group(); car3d.add(body);
const box = (w, h, d, color, x, y, z, emissive) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color, emissive: emissive || 0x000000 }));
  m.position.set(x, y, z); body.add(m); return m;
};
box(1.9, 0.55, 4.3, 0xd7261e, 0, 0.65, 0);
box(1.6, 0.5, 2.0, 0xd7261e, 0, 1.15, -0.2);
box(1.62, 0.4, 0.05, 0x1b2a38, 0, 1.16, 0.82).rotation.x = -0.5;
box(1.62, 0.38, 0.05, 0x1b2a38, 0, 1.16, -1.22);
box(1.4, 0.05, 0.8, 0x151515, 0, 1.0, 2.0); // hood scoop strip
box(0.4, 0.18, 0.06, 0xfff6c0, 0.65, 0.7, 2.16, 0xfff0a0); box(0.4, 0.18, 0.06, 0xfff6c0, -0.65, 0.7, 2.16, 0xfff0a0);
box(0.4, 0.16, 0.06, 0xff2020, 0.65, 0.72, -2.16, 0xaa0000); box(0.4, 0.16, 0.06, 0xff2020, -0.65, 0.72, -2.16, 0xaa0000);
box(1.7, 0.08, 0.4, 0x151515, 0, 1.4, -2.0); // spoiler
const wheels = [];
[[-1, 1.3], [1, 1.3], [-1, -1.3], [1, -1.3]].forEach(([sx, z], i) => {
  const pivot = new THREE.Group(); pivot.position.set(sx * 1.0, 0.38, z);
  const w = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.3, 14), new THREE.MeshLambertMaterial({ color: 0x151515 }));
  w.rotation.z = Math.PI / 2; pivot.add(w); body.add(pivot); wheels.push({ pivot, w, front: z > 0 });
});
scene.add(car3d);

// ---------- Input ----------
const keys = {}; let started = false, camMode = 0;
addEventListener('keydown', e => {
  if (!started) { started = true; document.getElementById('start').classList.add('hidden'); }
  keys[e.code] = true;
  if (e.code === 'KeyC') camMode = (camMode + 1) % 3;
  if (e.code === 'KeyR') resetCar();
  if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
});
addEventListener('keyup', e => keys[e.code] = false);
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });

// ---------- Car physics ----------
const car = { x: 0, z: 0, yaw: 0, vx: 0, vz: 0, steer: 0, pitch: 0, roll: 0, y: 0 };
function resetCar() {
  car.x = roadX(car.z); car.yaw = Math.atan2(roadX(car.z + 1) - car.x, 1);
  car.vx = car.vz = 0; car.steer = 0;
}
resetCar();

let lastCx = 1e9, lastCz = 1e9, camYaw = 0, camPos = new THREE.Vector3(0, 10, -15), wheelRot = 0;
const speedEl = document.getElementById('speed'), fillEl = document.getElementById('fill');
const clock = new THREE.Clock(), up = new THREE.Vector3(0, 1, 0);

function update(dt) {
  const fx = Math.sin(car.yaw), fz = Math.cos(car.yaw), rx = fz, rz = -fx;
  let vf = car.vx * fx + car.vz * fz, vl = car.vx * rx + car.vz * rz;
  const gas = keys.KeyW || keys.ArrowUp, brake = keys.KeyS || keys.ArrowDown, hb = keys.Space;
  const steerIn = ((keys.KeyA || keys.ArrowLeft) ? 1 : 0) - ((keys.KeyD || keys.ArrowRight) ? 1 : 0);
  const offRoad = Math.abs(car.x - roadX(car.z)) > HW + 0.5;

  if (gas && vf >= -0.5) vf += (8 + 34 * (1 - Math.pow(Math.max(vf, 0) / MAX, 3))) * dt;
  if (brake) vf -= (vf > 1 ? 45 : 14) * dt;
  if (hb) vf -= Math.sign(vf) * Math.min(Math.abs(vf), 30 * dt);
  vf -= vf * 0.012 * dt + Math.sign(vf) * 0.6 * dt;                 // drag + rolling resistance
  if (offRoad) vf *= Math.exp(-0.4 * dt);                            // grass slows you down
  vf = clamp(vf, -14, MAX);                                          // 250 mph speed limit
  vl *= Math.exp(-(hb ? 1.5 : 7) * dt);                              // tyre grip

  car.steer += (steerIn - car.steer) * Math.min(1, 7 * dt);
  car.yaw += car.steer * clamp(Math.abs(vf) / 8, 0, 1) * Math.sign(vf) * (1.8 / (1 + Math.abs(vf) * 0.04)) * dt;

  const nfx = Math.sin(car.yaw), nfz = Math.cos(car.yaw);
  car.vx = nfx * vf + nfz * vl; car.vz = nfz * vf - nfx * vl;
  car.x += car.vx * dt; car.z += car.vz * dt;

  // follow the ground, tilt with slope
  const h = height(car.x, car.z), hF = height(car.x + nfx * 2, car.z + nfz * 2), hB = height(car.x - nfx * 2, car.z - nfz * 2);
  const hR = height(car.x + nfz * 1.5, car.z - nfx * 1.5), hL = height(car.x - nfz * 1.5, car.z + nfx * 1.5);
  car.y = h + 0.05;
  car.pitch += (Math.atan2(hB - hF, 4) - car.pitch) * Math.min(1, 10 * dt);
  car.roll += (Math.atan2(hR - hL, 3) - car.roll) * Math.min(1, 10 * dt);
  car3d.position.set(car.x, car.y, car.z);
  car3d.rotation.set(car.pitch, car.yaw, car.roll, 'YXZ');
  body.rotation.z = -car.steer * Math.min(1, vf / MAX) * 0.06;

  wheelRot += vf * dt / 0.38;
  wheels.forEach(o => { o.w.rotation.x = wheelRot; if (o.front) o.pivot.rotation.y = car.steer * 0.4; });

  // keep the world around the car
  if (Math.hypot(car.x - lastCx, car.z - lastCz) > 30) {
    lastCx = car.x; lastCz = car.z;
    buildTerrain(Math.round(car.x / CELL) * CELL, Math.round(car.z / CELL) * CELL);
    buildRoad(car.z); buildTrees(car.x, car.z);
  }

  // camera
  camYaw += Math.atan2(Math.sin(car.yaw - camYaw), Math.cos(car.yaw - camYaw)) * Math.min(1, 4 * dt);
  const spd = Math.abs(vf) / MAX;
  if (camMode === 2) { // hood
    const p = new THREE.Vector3(0, 1.45, 0.4).applyMatrix4(car3d.matrixWorld);
    camera.position.copy(p); camera.lookAt(p.x + nfx * 20, p.y + 0.3, p.z + nfz * 20);
  } else {
    const dist = camMode === 0 ? 11 + spd * 4 : 7, hgt = camMode === 0 ? 4.2 : 2.6;
    const target = new THREE.Vector3(car.x - Math.sin(camYaw) * dist, car.y + hgt, car.z - Math.cos(camYaw) * dist);
    camPos.lerp(target, Math.min(1, 9 * dt)); camera.position.copy(camPos);
    camera.position.y = Math.max(camera.position.y, height(camPos.x, camPos.z) + 1.5);
    camera.lookAt(car.x + nfx * 6, car.y + 1.4, car.z + nfz * 6);
  }
  camera.fov = 62 + spd * 26; camera.updateProjectionMatrix();

  sky.position.set(car.x, 0, car.z); clouds.position.set(car.x, 0, car.z);
  sun.position.set(car.x - 900, 1100, car.z + 700);
  sunLight.position.set(car.x - 50, 80, car.z + 40); sunLight.target.position.set(car.x, 0, car.z);

  const mph = Math.round(Math.abs(vf) * MPH);
  speedEl.textContent = mph; fillEl.style.width = (mph / 250 * 100) + '%';
}

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  update(started ? dt : 0.0001);
  renderer.render(scene, camera);
});
})();
