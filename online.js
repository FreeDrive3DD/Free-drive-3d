/* Open Road online: names, shared free roam and map markers.
   Uses Supabase over plain web requests (no extra libraries). */
(() => {
'use strict';
const URL_BASE = 'https://etresgxxkcdjncuyeyza.supabase.co';
const KEY = 'sb_publishable_VpE_TZBd4_6FWzZJjwIHCA_YlrNXaxc';
const SYNC_MS = 500;      // how often your position is sent and everyone else's is fetched
const LOBBY_MS = 4000;    // keep-alive while you choose your car
const TAG_DIST = 500;     // name tags show on cars closer than this (metres)
const LOBBY_Y = -99999;   // marks "chosen a name, not in the world yet"
const NAME_RE = /^[A-Za-z0-9]{3,12}$/;
const $ = id => document.getElementById(id);

let A = null, session = null, sessionP = null;
let want = null, me = null, lostName = '';
let inWorld = false, busy = false, fails = 0, syncT = 0, lobbyT = 0, toastT = 0;
const remotes = {};       // lower-case name -> other player

// ---------- sign-in (anonymous, no account needed) ----------
const loadSession = () => {
  try { const s = JSON.parse(localStorage.getItem('oro_session') || 'null'); if (s && s.access_token && s.refresh_token) return s; } catch (e) {}
  return null;
};
const saveSession = j => {
  session = { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: j.expires_at || Math.floor(Date.now() / 1000) + (j.expires_in || 3600) };
  try { localStorage.setItem('oro_session', JSON.stringify(session)); } catch (e) {}
  return session;
};
const userError = msg => { const e = new Error(msg); e.user = true; return e; };
function authCall(path, body) {
  return fetch(URL_BASE + '/auth/v1/' + path, { method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then(r => r.json().catch(() => ({})).then(j => {
      if (!r.ok) throw new Error(j.msg || j.error_description || j.message || ('Sign-in failed (' + r.status + ')'));
      return j;
    }));
}
function ensureSession() {
  const now = Math.floor(Date.now() / 1000);
  if (!session) session = loadSession();
  if (session && session.expires_at - now > 120) return Promise.resolve(session);
  if (sessionP) return sessionP;
  const fresh = () => authCall('signup', { data: {} }).then(saveSession);
  const p = session
    ? authCall('token?grant_type=refresh_token', { refresh_token: session.refresh_token }).then(saveSession)
        .catch(() => { session = null; try { localStorage.removeItem('oro_session'); } catch (e) {} return fresh(); })
    : fresh();
  sessionP = p.then(s => { sessionP = null; return s; }, e => { sessionP = null; throw e; });
  return sessionP;
}
function rpc(name, args) {
  return ensureSession().then(s => fetch(URL_BASE + '/rest/v1/rpc/' + name, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: 'Bearer ' + s.access_token, 'Content-Type': 'application/json' },
    body: JSON.stringify(args || {})
  })).then(r => r.text().then(t => {
    let j = null; try { j = t ? JSON.parse(t) : null; } catch (e) {}
    if (!r.ok) throw new Error((j && (j.message || j.hint)) || ('Server error ' + r.status));
    return j;
  }));
}

// ---------- what we send about you ----------
const fin = (v, m, d) => { v = +v; return isFinite(v) ? Math.max(-m, Math.min(m, Math.round(v * d) / d)) : 0; };
function myState() {
  const c = A.getCar();
  return {
    p_x: fin(c.x, 1e8, 100), p_y: fin(c.y, 9e4, 100), p_z: fin(c.z, 1e8, 100),
    p_yaw: fin(Math.atan2(Math.sin(c.yaw), Math.cos(c.yaw)), 10, 1000),
    p_vx: fin(c.vx, 900, 10), p_vz: fin(c.vz, 900, 10)
  };
}
const LOBBY_STATE = { p_x: 0, p_y: LOBBY_Y, p_z: 0, p_yaw: 0, p_vx: 0, p_vz: 0 };
const claimRaw = (name, car, col, st) => rpc('claim_name', { p_name: name, p_car: car, p_col: col, p_x: st.p_x, p_y: st.p_y, p_z: st.p_z, p_yaw: st.p_yaw });
const claimMsg = r => r === 'taken' ? 'That name is taken. Try another one.'
  : r === 'full' ? 'The server is full (20 players). Try again later.'
  : r === 'bad' ? 'Names need 3 to 12 letters or numbers.'
  : 'Sign-in problem. Reload the page and try again.';

// ---------- joining and leaving ----------
function stopTimers() { clearInterval(syncT); clearInterval(lobbyT); syncT = lobbyT = 0; }
function claim(name) { // the name screen: reserve the name straight away
  return claimRaw(name, 0, 0, LOBBY_STATE).then(r => {
    if (r !== 'ok') throw userError(claimMsg(r));
    want = name; lostName = '';
    stopTimers(); lobbyT = setInterval(lobbyBeat, LOBBY_MS);
  });
}
function lobbyBeat() { // keeps your name reserved while you choose a car
  if (!want || inWorld) return;
  const name = want;
  rpc('sync', LOBBY_STATE).then(res => {
    if (res && res.me === false && want === name) {
      claimRaw(name, 0, 0, LOBBY_STATE).then(r => { if (r !== 'ok' && want === name) { lostName = name; want = null; } });
    }
  }).catch(() => {});
}
function enter(car, col) { // called when free roam starts
  stopTimers();
  if (!want) {
    if (lostName) toast('Your name "' + lostName + '" was taken while you were choosing. You are playing offline. Press Back to pick a new name.');
    return;
  }
  const name = want;
  claimRaw(name, car, col, myState()).then(r => {
    if (want !== name) return;
    if (r !== 'ok') { want = null; toast(claimMsg(r) + ' Playing offline. Press Back to try again.'); return; }
    me = { name, car, col }; inWorld = true; fails = 0; showChip();
    syncT = setInterval(syncOnce, SYNC_MS);
  }).catch(e => { want = null; toast('Could not join the online players (' + e.message + '). Playing offline.'); });
}
function leave() {
  const had = want || inWorld;
  stopTimers(); clearRemotes(); hideChip();
  want = null; me = null; inWorld = false; lostName = '';
  if (had && session) {
    try {
      fetch(URL_BASE + '/rest/v1/rpc/leave', { method: 'POST', keepalive: true,
        headers: { apikey: KEY, Authorization: 'Bearer ' + session.access_token, 'Content-Type': 'application/json' }, body: '{}' }).catch(() => {});
    } catch (e) {}
  }
}
addEventListener('pagehide', () => { if (want || inWorld) leave(); });

// ---------- the live loop: send yourself, get everyone else ----------
function syncOnce() {
  if (!inWorld || busy) return;
  busy = true;
  rpc('sync', myState()).then(res => {
    busy = false; fails = 0;
    if (!inWorld) return;
    if (res && res.me === false) { reclaim(); return; }
    applyPlayers((res && res.players) || []);
  }).catch(() => { busy = false; fails++; updateChip(); });
}
function reclaim() { // your row expired (for example the tab was asleep): take it back
  if (!want || !me) return;
  claimRaw(want, me.car, me.col, myState()).then(r => {
    if (r !== 'ok') { toast('You were disconnected and your name was taken. Press Back to choose a new name.'); leave(); }
  }).catch(() => {});
}
function applyPlayers(list) {
  const now = performance.now(), keep = {};
  for (const p of list) {
    if (!p || typeof p.name !== 'string' || !NAME_RE.test(p.name)) continue;       // ignore anything odd
    if (![p.x, p.y, p.z, p.yaw].every(Number.isFinite) || p.y < -50000) continue;  // still choosing a car
    const k = p.name.toLowerCase(); keep[k] = 1;
    let r = remotes[k];
    if (r && (r.car !== p.car || r.col !== p.col)) { removeRemote(k); r = null; }
    if (!r) r = remotes[k] = makeRemote(p);
    r.tx = p.x; r.ty = p.y; r.tz = p.z; r.tyaw = p.yaw; r.vx = +p.vx || 0; r.vz = +p.vz || 0; r.at = now;
  }
  Object.keys(remotes).forEach(k => { if (!keep[k]) removeRemote(k); });
  updateChip();
}

// ---------- other players' cars and name tags ----------
function rr(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
function makeTag(name) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(10,20,16,0.72)'; rr(g, 4, 6, 248, 52, 14); g.fill();
  g.fillStyle = '#fff'; g.font = 'bold 34px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(name, 128, 33);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, fog: false }));
  sp.renderOrder = 999; return sp;
}
function makeRemote(p) {
  const def = A.CARS[p.car] || A.CARS[0], pal = A.PALETTE[p.col] || A.PALETTE[0];
  const m = def.build(pal.hex);
  m.group.traverse(o => { if (o.isMesh) o.castShadow = false; }); // keeps the game fast with many cars
  A.scene.add(m.group);
  const tag = makeTag(p.name); A.scene.add(tag);
  const r = { name: p.name, car: p.car, col: p.col, m, g: m.group, tag, x: p.x, y: p.y, z: p.z, yaw: p.yaw, tx: p.x, ty: p.y, tz: p.z, tyaw: p.yaw, vx: 0, vz: 0, at: performance.now(), wr: 0 };
  r.g.position.set(r.x, r.y, r.z); r.g.rotation.y = r.yaw;
  return r;
}
function removeRemote(k) {
  const r = remotes[k]; if (!r) return;
  A.scene.remove(r.g); A.dispose(r.g);
  A.scene.remove(r.tag); if (r.tag.material.map) r.tag.material.map.dispose(); r.tag.material.dispose();
  delete remotes[k];
}
function clearRemotes() { Object.keys(remotes).forEach(removeRemote); }
function tick(dt) { // every frame: glide the other cars smoothly towards where they are heading
  if (!A || !inWorld) return;
  const now = performance.now(), cam = A.camera, f = Math.min(1, dt * 8);
  for (const k in remotes) {
    const r = remotes[k], age = (now - r.at) / 1000;
    if (age > 6) { r.g.visible = false; r.tag.visible = false; continue; }
    const a = Math.min(age, 1.2);
    r.x += (r.tx + r.vx * a - r.x) * f; r.z += (r.tz + r.vz * a - r.z) * f; r.y += (r.ty - r.y) * f;
    r.yaw += Math.atan2(Math.sin(r.tyaw - r.yaw), Math.cos(r.tyaw - r.yaw)) * f;
    r.g.position.set(r.x, r.y, r.z); r.g.rotation.y = r.yaw;
    r.wr += Math.hypot(r.vx, r.vz) * dt / 0.38;
    for (let i = 0; i < r.m.wheels.length; i++) r.m.wheels[i].w.rotation.x = r.wr;
    const d = cam.position.distanceTo(r.g.position), tagOn = d < TAG_DIST && d > 4;
    r.g.visible = d < 650; r.tag.visible = tagOn;
    if (tagOn) { const s = d * 0.045; r.tag.position.set(r.x, r.y + 3.6, r.z); r.tag.scale.set(s * 4, s, 1); }
  }
}

// ---------- minimap: everybody's dot with their name underneath ----------
function drawMap(g, X, Z, u, big, W) {
  if (!inWorld || !me) return;
  const now = performance.now(), pad = 9 * u, rad = (big ? 6 : 5) * u;
  g.save(); g.textAlign = 'center'; g.textBaseline = 'top'; g.lineJoin = 'round';
  g.font = 'bold ' + (big ? 13 : 10) * u + 'px sans-serif';
  for (const k in remotes) {
    const r = remotes[k]; if (now - r.at > 6000) continue;
    let px = X(r.x), py = Z(r.z);
    const edge = px < pad || px > W - pad || py < pad || py > W - pad;
    px = Math.max(pad, Math.min(W - pad, px)); py = Math.max(pad, Math.min(W - pad, py));
    g.globalAlpha = edge ? 0.8 : 1;
    g.beginPath(); g.arc(px, py, edge ? rad * 0.8 : rad, 0, 6.2832);
    g.fillStyle = '#' + ((A.PALETTE[r.col] || A.PALETTE[0]).hex >>> 0).toString(16).padStart(6, '0'); g.fill();
    g.lineWidth = 2 * u; g.strokeStyle = '#fff'; g.stroke();
    const tw = g.measureText(r.name).width / 2 + 3 * u, tx = Math.max(tw, Math.min(W - tw, px)), ty = Math.min(W - 14 * u, py + rad + 2 * u);
    g.lineWidth = 3 * u; g.strokeStyle = 'rgba(0,0,0,.7)'; g.strokeText(r.name, tx, ty);
    g.fillStyle = '#fff'; g.fillText(r.name, tx, ty);
  }
  g.globalAlpha = 1; // your own name under your arrow
  g.lineWidth = 3 * u; g.strokeStyle = 'rgba(0,0,0,.7)'; g.strokeText(me.name, W / 2, W / 2 + 11 * u);
  g.fillStyle = '#ffd34d'; g.fillText(me.name, W / 2, W / 2 + 11 * u);
  g.restore();
}

// ---------- small on-screen helpers ----------
function showChip() { let c = $('online'); if (!c) { c = document.createElement('div'); c.id = 'online'; $('hud').appendChild(c); } c.style.display = 'block'; updateChip(); }
function hideChip() { const c = $('online'); if (c) c.style.display = 'none'; }
function updateChip() {
  const c = $('online'); if (!c || !inWorld) return;
  c.textContent = fails >= 3 ? 'Online: reconnecting…' : 'Online: ' + (Object.keys(remotes).length + 1) + ' · you are ' + (me ? me.name : '');
}
function toast(t) {
  let e = $('toast'); if (!e) { e = document.createElement('div'); e.id = 'toast'; $('hud').appendChild(e); }
  e.textContent = t; e.style.display = 'block'; clearTimeout(toastT); toastT = setTimeout(() => { e.style.display = 'none'; }, 8000);
}

// ---------- the name screen ----------
function setMsg(t, err) { const m = $('nameMsg'); if (m) { m.textContent = t; m.className = err ? 'err' : ''; } }
function openNameScreen() { setMsg('', false); const i = $('nameInput'); if (i) setTimeout(() => i.focus(), 60); }
function submitName() {
  const input = $('nameInput'), go = $('nameGo'), name = input.value.trim();
  if (!NAME_RE.test(name)) { setMsg('Names need 3 to 12 letters or numbers.', true); return; }
  go.disabled = true; setMsg('Checking name…', false);
  claim(name).then(() => {
    go.disabled = false; setMsg('', false);
    try { localStorage.setItem('oro_name', name); } catch (e) {}
    A.toPick();
  }).catch(e => {
    go.disabled = false;
    setMsg(e.user ? e.message : 'Could not reach the online server: ' + e.message + '. You can tap Play offline.', true);
  });
}
function initUI() {
  const form = $('nameForm'), input = $('nameInput');
  if (!form || !input) return;
  try { input.value = (localStorage.getItem('oro_name') || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 12); } catch (e) {}
  input.addEventListener('input', () => { // only letters and numbers can be typed
    const clean = input.value.replace(/[^A-Za-z0-9]/g, '').slice(0, 12);
    if (clean !== input.value) { input.value = clean; setMsg('Only letters and numbers are allowed.', true); } else setMsg('', false);
  });
  form.addEventListener('submit', e => { e.preventDefault(); submitName(); });
  $('nameSkip').addEventListener('click', () => { leave(); if (A) A.toPick(); });
  $('nameBack').addEventListener('click', () => { if (A) A.toModes(); });
}

window.ORO = { attach: h => { A = h; }, ready: () => !!A, openNameScreen, enter, leave, tick, drawMap };
initUI();
})();
