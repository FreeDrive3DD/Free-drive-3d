
import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x91cbed);
scene.fog = new THREE.Fog(0x91cbed, 170, 850);

const camera = new THREE.PerspectiveCamera(
  68, innerWidth / innerHeight, 0.1, 1400
);

camera.position.set(0, 7, 14);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.8));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

scene.add(new THREE.HemisphereLight(0xdaf3ff, 0x557044, 1.7));

const sun = new THREE.DirectionalLight(0xfff1d2, 2.2);
sun.position.set(-100, 160, 80);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -180;
sun.shadow.camera.right = 180;
sun.shadow.camera.top = 180;
sun.shadow.camera.bottom = -180;
scene.add(sun);

const mat = (color, roughness = 1) =>
  new THREE.MeshStandardMaterial({ color, roughness });

const grassMat = mat(0x5da64b);
const roadMat = mat(0x343b40);
const lineMat = mat(0xf5e7a1);
const whiteMat = mat(0xffffff);
const darkMat = mat(0x20252a);

function terrainHeight(x, z) {
  return (
    2.7 * Math.sin(x * 0.012 + z * 0.006) +
    2.1 * Math.cos(z * 0.018 - x * 0.008) +
    1.25 * Math.sin((x + z) * 0.035) +
    0.55 * Math.cos(x * 0.075) * Math.sin(z * 0.06)
  );
}

// Hilly terrain
const size = 1100;
const segments = 180;

const geo = new THREE.PlaneGeometry(
  size, size, segments, segments
);

geo.rotateX(-Math.PI / 2);

const p = geo.attributes.position;

for (let i = 0; i < p.count; i++) {
  const x = p.getX(i);
  const z = p.getZ(i);
  p.setY(i, terrainHeight(x, z));
}

geo.computeVertexNormals();

const ground = new THREE.Mesh(geo, grassMat);
ground.receiveShadow = true;
scene.add(ground);

// Winding road
function roadPath(t) {
  const a = t * Math.PI * 2;

  return new THREE.Vector3(
    185 * Math.cos(a) + 35 * Math.sin(3 * a),
    0,
    145 * Math.sin(a) + 22 * Math.sin(2 * a)
  );
}

const roadPoints = [];
const roadCount = 700;

for (let i = 0; i <= roadCount; i++) {
  roadPoints.push(roadPath(i / roadCount));
}

const curve = new THREE.CatmullRomCurve3(roadPoints);

const roadVerts = [];
const roadIndices = [];
const roadWidth = 13;

for (let i = 0; i <= roadCount; i++) {
  const t = i / roadCount;
  const c = curve.getPointAt(t);
  const tangent = curve.getTangentAt(t);

  const side = new THREE.Vector3(
    -tangent.z, 0, tangent.x
  ).normalize();

  const l = c.clone().addScaledVector(side, -roadWidth / 2);
  const r = c.clone().addScaledVector(side, roadWidth / 2);

  l.y = terrainHeight(l.x, l.z) + 0.22;
  r.y = terrainHeight(r.x, r.z) + 0.22;

  roadVerts.push(l.x, l.y, l.z, r.x, r.y, r.z);

  if (i < roadCount) {
    const n = i * 2;
    roadIndices.push(n, n + 2, n + 1, n + 1, n + 2, n + 3);
  }
}

const roadGeo = new THREE.BufferGeometry();

roadGeo.setAttribute(
  'position',
  new THREE.Float32BufferAttribute(roadVerts, 3)
);

roadGeo.setIndex(roadIndices);
roadGeo.computeVertexNormals();

const road = new THREE.Mesh(roadGeo, roadMat);
road.receiveShadow = true;
scene.add(road);

// Road markings
const dashGeo = new THREE.BoxGeometry(0.22, 0.045, 3.4);

for (let i = 0; i < roadCount; i += 5) {
  const c = curve.getPointAt(i / roadCount);
  const tangent = curve.getTangentAt(i / roadCount);

  const dash = new THREE.Mesh(dashGeo, lineMat);

  dash.position.set(
    c.x,
    terrainHeight(c.x, c.z) + 0.31,
    c.z
  );

  dash.rotation.y = Math.atan2(tangent.x, tangent.z);
  scene.add(dash);
}

// Trees and forests
const trunkMat = mat(0x765034);

const leafMats = [
  mat(0x236b37),
  mat(0x2e813e),
  mat(0x3d9148)
];

const trunkGeo = new THREE.CylinderGeometry(0.22, 0.34, 2.4, 7);
const coneGeo1 = new THREE.ConeGeometry(1.65, 3.3, 7);
const coneGeo2 = new THREE.ConeGeometry(1.25, 2.8, 7);
const coneGeo3 = new THREE.ConeGeometry(0.85, 2.2, 7);

function nearRoad(x, z) {
  const v = new THREE.Vector2(x, z);

  for (let j = 0; j < roadCount; j += 8) {
    const q = curve.getPointAt(j / roadCount);

    if (
      v.distanceTo(new THREE.Vector2(q.x, q.z)) < 11
    ) return true;
  }

  return false;
}

for (let i = 0; i < 1250; i++) {
  const x = (Math.random() - 0.5) * 780;
  const z = (Math.random() - 0.5) * 650;

  if (nearRoad(x, z)) continue;

  const group = new THREE.Group();

  const trunk = new THREE.Mesh(trunkGeo, trunkMat);
  trunk.position.y = 1.2;
  trunk.castShadow = true;
  group.add(trunk);

  const trees = [
    [coneGeo1, 2.7, leafMats[i % 3]],
    [coneGeo2, 4.1, leafMats[(i + 1) % 3]],
    [coneGeo3, 5.35, leafMats[(i + 2) % 3]]
  ];

  for (const [g, h, m] of trees) {
    const crown = new THREE.Mesh(g, m);
    crown.position.y = h;
    crown.castShadow = true;
    group.add(crown);
  }

  group.position.set(x, terrainHeight(x, z), z);

  const scale = 0.7 + Math.random() * 0.8;
  group.scale.setScalar(scale);
  group.rotation.y = Math.random() * Math.PI * 2;

  scene.add(group);
}

// Bushes
for (let i = 0; i < 450; i++) {
  const x = (Math.random() - 0.5) * 760;
  const z = (Math.random() - 0.5) * 620;

  if (nearRoad(x, z)) continue;

  const bush = new THREE.Mesh(
    new THREE.DodecahedronGeometry(
      0.45 + Math.random() * 0.65, 0
    ),
    leafMats[i % 3]
  );

  bush.position.set(x, terrainHeight(x, z) + 0.35, z);
  bush.scale.y = 0.65;
  scene.add(bush);
}

// Rocks
for (let i = 0; i < 150; i++) {
  const x = (Math.random() - 0.5) * 700;
  const z = (Math.random() - 0.5) * 580;

  const rock = new THREE.Mesh(
    new THREE.DodecahedronGeometry(
      0.5 + Math.random() * 1.1, 0
    ),
    mat(0x858d82)
  );

  rock.position.set(x, terrainHeight(x, z) + 0.25, z);
  rock.rotation.set(Math.random(), Math.random(), Math.random());
  scene.add(rock);
}

// Player car
const car = new THREE.Group();
scene.add(car);

const bodyMat = mat(0xd62828, 0.35);
const glassMat = new THREE.MeshStandardMaterial({
  color: 0x172b3b,
  metalness: 0.25,
  roughness: 0.2
});

const body = new THREE.Mesh(
  new THREE.BoxGeometry(2.25, 0.62, 4.5),
  bodyMat
);

body.position.y = 0.9;
car.add(body);

const cabin = new THREE.Mesh(
  new THREE.BoxGeometry(1.65, 0.85, 2.05),
  glassMat
);

cabin.position.set(0, 1.58, 0.15);
car.add(cabin);

const roof = new THREE.Mesh(
  new THREE.BoxGeometry(1.58, 0.12, 1.7),
  darkMat
);

roof.position.set(0, 2.03, 0.15);
car.add(roof);

// Wheels
const wheelGeo = new THREE.CylinderGeometry(
  0.48, 0.48, 0.32, 18
);

const wheels = [];

for (const x of [-1.12, 1.12]) {
  for (const z of [-1.45, 1.45]) {
    const wheel = new THREE.Mesh(wheelGeo, darkMat);

    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(x, 0.52, z);

    car.add(wheel);
    wheels.push(wheel);
  }
}

// Starting position
const start = curve.getPointAt(0.02);
const startTan = curve.getTangentAt(0.02);

car.position.set(
  start.x,
  terrainHeight(start.x, start.z) + 0.12,
  start.z
);

car.rotation.y = Math.atan2(startTan.x, startTan.z) + Math.PI;

// Driving controls
let speed = 0;
let steer = 0;
let heading = car.rotation.y;

const keys = {};

addEventListener('keydown', e => {
  keys[e.key.toLowerCase()] = true;

  if ([
    ' ', 'arrowup', 'arrowdown',
    'arrowleft', 'arrowright'
  ].includes(e.key.toLowerCase())) {
    e.preventDefault();
  }
});

addEventListener('keyup', e => {
  keys[e.key.toLowerCase()] = false;
});

// Mobile controls
function bindHold(id, key) {
  const el = document.getElementById(id);

  const on = e => {
    e.preventDefault();
    keys[key] = true;
    el.setPointerCapture?.(e.pointerId);
  };

  const off = e => {
    e.preventDefault();
    keys[key] = false;
  };

  el.addEventListener('pointerdown', on);
  el.addEventListener('pointerup', off);
  el.addEventListener('pointercancel', off);
  el.addEventListener('lostpointercapture', off);
}

bindHold('left', 'a');
bindHold('right', 'd');
bindHold('accelerate', 'w');
bindHold('brake', 's');

const speedEl = document.getElementById('speed');

const clock = new THREE.Clock();
const forward = new THREE.Vector3();
const desiredCam = new THREE.Vector3();
const lookTarget = new THREE.Vector3();

// Main game loop
function animate() {
  requestAnimationFrame(animate);

  const dt = Math.min(clock.getDelta(), 0.04);

  const accelerating = keys.w || keys.arrowup;
  const braking = keys.s || keys.arrowdown;

  const left = keys.a || keys.arrowleft;
  const right = keys.d || keys.arrowright;

  if (accelerating) speed += 75 * dt;
  else speed -= 13 * dt;

  if (braking) speed -= 115 * dt;
  if (keys[' ']) speed -= 175 * dt;

  speed = THREE.MathUtils.clamp(speed, 0, 250);

  speedEl.textContent = Math.round(speed);

  const steerInput =
    (right ? 1 : 0) - (left ? 1 : 0);

  steer = THREE.MathUtils.lerp(steer, steerInput, 0.12);

  const speedFactor = 0.18 + speed / 250;

  heading += steer * 1.45 * speedFactor * dt *
    (speed > 1 ? 1 : 0);

  car.rotation.y = heading;

  forward.set(
    Math.sin(heading),
    0,
    Math.cos(heading)
  );

  car.position.addScaledVector(
    forward, -speed * 0.105 * dt
  );

  const groundY = terrainHeight(
    car.position.x,
    car.position.z
  );

  car.position.y = groundY + 0.12;

  car.rotation.z = THREE.MathUtils.lerp(
    car.rotation.z,
    -steer * 0.08 * speedFactor,
    0.08
  );

  wheels.forEach(w => {
    w.rotation.x -= speed * 0.025 * dt;
  });

  // Follow camera
  desiredCam.copy(car.position)
    .add(new THREE.Vector3(0, 6.4, 0))
    .addScaledVector(forward, 11);

  camera.position.lerp(desiredCam, 0.075);

  lookTarget.copy(car.position)
    .addScaledVector(forward, -7);

  lookTarget.y += 2.1;

  camera.lookAt(lookTarget);

  renderer.render(scene, camera);
}

animate();

// Screen resizing
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

document.getElementById('loading').style.opacity = '0';

setTimeout(() => {
  document.getElementById('loading').remove();
}, 550);
