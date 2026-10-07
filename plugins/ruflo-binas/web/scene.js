// The model: a cutaway office on its own blueprint, in three.js. Static desks for every slot; pegs, lamps,
// flags and labels come alive per agent from the engine's view. No game loop here: app.js calls render().
import { ROOMS, makeSlots, BELT, DOCK_STAMP, TUBE_Y, TRAY_Y, wx, wz } from './engine.js';

export function createScene(THREE, canvas, stage, labelsEl) {
  const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.outputEncoding = THREE.sRGBEncoding;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.5, 600);
  const hemi = new THREE.HemisphereLight(0xF7F6F3, 0x8A8A93, 0.45); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xFFF4E2, 1.25); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -75, right: 75, top: 55, bottom: -55, near: 10, far: 320 }); sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);

  const std = (o) => new THREE.MeshStandardMaterial({ roughness: 0.9, ...o });
  const M = { card: std({ color: 0xF4F2EC }), wall: std({ color: 0xE4E1D9 }), ink: std({ color: 0x14141A, roughness: 0.7 }), deskTop: std({ color: 0xFBFAF6 }), paper: std({ color: 0xFFFFFF }), paperWork: std({ color: 0xC9D3F2 }),
    tube: std({ color: 0xA9B6DB, roughness: 0.15, transparent: true, opacity: 0.34, depthWrite: false }), flare: std({ color: 0xFF4A17, roughness: 0.8, side: THREE.DoubleSide }), plant: std({ color: 0x3E8A5F, roughness: 1 }), shade: std({ color: 0x14141A, roughness: 0.6, side: THREE.DoubleSide }) };
  const COL = { idle: new THREE.Color(0xD9D6CC), working: new THREE.Color(0x22356F), blocked: new THREE.Color(0xFF4A17), done: new THREE.Color(0x00A95C) };
  const G = { box: (w, h, d) => new THREE.BoxGeometry(w, h, d), cyl: (r1, r2, h, n = 16, open = false) => new THREE.CylinderGeometry(r1, r2, h, n, 1, open) };
  function mesh(geo, mat, x, y, z, cast = true, recv = true) { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = cast; m.receiveShadow = recv; scene.add(m); return m; }

  /* ---- ground: the blueprint ---- */
  const gcan = document.createElement('canvas'); gcan.width = 2400; gcan.height = 1500;
  const meta = { shift: '—', date: '', source: 'NO FEED YET', title: 'BINAS WORKS' };
  function drawGround() {
    const c = gcan.getContext('2d'); c.setTransform(1, 0, 0, 1, 0, 0); c.fillStyle = '#E9E7E1'; c.fillRect(0, 0, 2400, 1500);
    c.save(); c.translate(300, 210); c.scale(1.5, 1.5); c.fillStyle = '#F7F6F3'; c.fillRect(0, 0, 1200, 720);
    const grid = (step, col, w) => { c.strokeStyle = col; c.lineWidth = w; for (let x = 0; x <= 1200; x += step) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, 720); c.stroke(); } for (let y = 0; y <= 720; y += step) { c.beginPath(); c.moveTo(0, y); c.lineTo(1200, y); c.stroke(); } };
    grid(8, '#DAD7CF', 0.7); grid(40, '#C2BEB4', 1.1);
    c.fillStyle = 'rgba(34,53,111,.13)'; c.fillRect(24, 332, 1152, 56);
    c.strokeStyle = '#14141A'; c.lineWidth = 1.4; c.strokeRect(16, 16, 1168, 688); c.strokeRect(24, 24, 1152, 672);
    c.save(); c.beginPath(); c.rect(16, 16, 1168, 688); c.rect(24, 24, 1152, 672); c.clip('evenodd'); c.lineWidth = 0.8; for (let i = -720; i < 1300; i += 6) { c.beginPath(); c.moveTo(i, 16); c.lineTo(i + 704, 720); c.stroke(); } c.restore();
    c.lineWidth = 1.6; [200, 440, 680, 960].forEach((x) => { c.beginPath(); c.moveTo(x, 24); c.lineTo(x, 332); c.stroke(); }); [720, 1000].forEach((x) => { c.beginPath(); c.moveTo(x, 388); c.lineTo(x, 696); c.stroke(); }); c.beginPath(); c.moveTo(1000, 548); c.lineTo(1176, 548); c.stroke();
    const wall = (y, doors) => { let x = 24; doors.sort((a, b) => a - b).forEach((d) => { c.beginPath(); c.moveTo(x, y); c.lineTo(d - 14, y); c.stroke(); x = d + 14; }); c.beginPath(); c.moveTo(x, y); c.lineTo(1176, y); c.stroke(); };
    wall(332, ROOMS.filter((r) => r.side === 'top').map((r) => r.door.x)); wall(388, ROOMS.filter((r) => r.side === 'bot').map((r) => r.door.x));
    c.lineWidth = 0.9; c.strokeStyle = '#6B6B75'; ROOMS.forEach((r) => { const d = r.door.x, y = r.door.y; c.beginPath(); if (r.side === 'top') { c.moveTo(d - 14, y); c.lineTo(d - 14, y - 28); c.arc(d - 14, y, 28, -Math.PI / 2, 0); } else { c.moveTo(d - 14, y); c.lineTo(d - 14, y + 28); c.arc(d - 14, y, 28, Math.PI / 2, 0, true); } c.stroke(); });
    c.setLineDash([4, 3]); c.strokeStyle = '#B0B0B8'; c.lineWidth = 1; c.beginPath(); c.moveTo(24, 360); c.lineTo(1176, 360); c.stroke(); c.setLineDash([]);
    ROOMS.forEach((r) => { const y = r.y + (r.side === 'top' ? 24 : 26); c.fillStyle = '#3A3A44'; c.font = '600 12px Archivo'; c.save(); c.translate(r.x + 12, y); c.letterSpacing = '1.8px'; c.fillText(r.name.toUpperCase(), 0, 0); c.restore(); c.fillStyle = '#57575F'; c.font = '12px "Fragment Mono"'; c.fillText(r.id, r.x + 12, y + 16); });
    c.fillStyle = '#14141A'; c.font = '500 10px Archivo'; c.textAlign = 'center'; c.fillText('IN', 30, 144); c.fillText('OUT', 870, 684); c.textAlign = 'left';
    const tx = 1000, ty = 548; const rows = [['PROJECT', meta.title], ['FLOOR', 'A-01 ENGINEERING'], ['SHIFT', meta.shift], ['DATE', meta.date], ['DRAWN BY', 'BINAS'], ['SOURCE', meta.source]];
    rows.forEach((r, i) => { const y = ty + i * 17; c.strokeStyle = '#C6C2B8'; c.lineWidth = 1; c.beginPath(); c.moveTo(tx, y); c.lineTo(1176, y); c.stroke(); c.fillStyle = '#6B6B75'; c.font = '500 8.5px Archivo'; c.fillText(r[0], tx + 8, y + 12); c.fillStyle = '#14141A'; c.font = '11px "Fragment Mono"'; c.fillText(String(r[1]).slice(0, 20), tx + 66, y + 12.5); });
    c.strokeStyle = '#C6C2B8'; c.beginPath(); c.moveTo(tx, ty + 102); c.lineTo(1176, ty + 102); c.stroke(); c.beginPath(); c.moveTo(1100, ty + 102); c.lineTo(1100, 696); c.stroke();
    c.fillStyle = '#6B6B75'; c.font = '500 8.5px Archivo'; c.fillText('SHEET', tx + 8, ty + 116); c.fillText('REV', 1108, ty + 116); c.fillStyle = '#14141A'; c.font = '800 22px Archivo'; c.fillText('A-01', tx + 8, ty + 140); c.fillText('04', 1108, ty + 140);
    c.restore();
    c.fillStyle = 'rgba(20,20,26,.045)'; for (let i = 0; i < 26000; i++) c.fillRect(Math.random() * 2400, Math.random() * 1500, 1.2, 1.2);
    c.fillStyle = 'rgba(255,255,255,.5)'; for (let i = 0; i < 9000; i++) c.fillRect(Math.random() * 2400, Math.random() * 1500, 1, 1);
  }
  drawGround();
  const gtex = new THREE.CanvasTexture(gcan); gtex.encoding = THREE.sRGBEncoding; gtex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { drawGround(); gtex.needsUpdate = true; });
  const ground = mesh(new THREE.PlaneGeometry(160, 100), std({ map: gtex, roughness: 1 }), 0, 0, 0, false, true); ground.rotation.x = -Math.PI / 2;

  /* ---- walls with ink caps ---- */
  const WALL_H = 2.3, WALL_T = 0.36;
  function wallSeg(x1, y1, x2, y2, h = WALL_H, t = WALL_T) {
    const horiz = y1 === y2; const len = (horiz ? Math.abs(x2 - x1) : Math.abs(y2 - y1)) * 0.1 + t;
    mesh(G.box(horiz ? len : t, h, horiz ? t : len), M.wall, wx((x1 + x2) / 2), h / 2, wz((y1 + y2) / 2));
    mesh(G.box(horiz ? len + 0.02 : t + 0.04, 0.07, horiz ? t + 0.04 : len + 0.02), M.ink, wx((x1 + x2) / 2), h + 0.035, wz((y1 + y2) / 2), false, false);
  }
  [[16, 16, 1184, 16], [16, 704, 1184, 704], [16, 16, 16, 704], [1184, 16, 1184, 704]].forEach((s) => wallSeg(...s, 2.6, 0.8));
  [200, 440, 680, 960].forEach((x) => wallSeg(x, 24, x, 332)); [720, 1000].forEach((x) => wallSeg(x, 388, x, 696)); wallSeg(1000, 548, 1176, 548);
  const wallDoors = (y, doors) => { let x = 24; doors.slice().sort((a, b) => a - b).forEach((d) => { wallSeg(x, y, d - 14, y); x = d + 14; }); wallSeg(x, y, 1176, y); };
  wallDoors(332, ROOMS.filter((r) => r.side === 'top').map((r) => r.door.x)); wallDoors(388, ROOMS.filter((r) => r.side === 'bot').map((r) => r.door.x));
  mesh(G.box(0.9, 1.8, 3.2), M.ink, wx(16), 1.4, wz(164));

  /* ---- every desk: furniture, lamp, flag, tube riser ---- */
  const slots = makeSlots(); const SLOT = {};
  slots.forEach((s) => {
    const W = s.W;
    if (W.round) { mesh(G.cyl(4, 4, 0.14, 40), M.deskTop, W.cx, 0.95, W.cz); mesh(G.cyl(0.5, 0.7, 0.9, 12), M.ink, W.cx, 0.45, W.cz); }
    else { mesh(G.box(W.w, 0.14, W.d), M.deskTop, W.cx, 0.95, W.cz); [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => mesh(G.box(0.14, 0.9, 0.14), M.ink, W.cx + sx * (W.w / 2 - 0.25), 0.45, W.cz + sz * (W.d / 2 - 0.25))); mesh(G.box(1.6, 0.12, 1.1), M.card, W.tray.x, 0.98, W.tray.z, false, true); }
    mesh(G.cyl(0.5, 0.5, 0.1, 20), M.ink, W.home.x, 0.52, W.home.z); mesh(G.cyl(0.06, 0.06, 0.5, 8), M.ink, W.home.x, 0.26, W.home.z);
    mesh(G.cyl(0.06, 0.06, 1.3, 8), M.ink, W.lamp.x, 1.67, W.lamp.z, false, false); mesh(G.cyl(0.14, 0.62, 0.5, 16, true), M.shade, W.lamp.x, 2.4, W.lamp.z, false, false);
    const bulb = mesh(new THREE.SphereGeometry(0.17, 12, 10), std({ color: 0xE8E4D8, emissive: 0xFFD89A, emissiveIntensity: 0, roughness: 0.5 }), W.lamp.x, 2.26, W.lamp.z, false, false);
    const fg = new THREE.Group(); fg.position.set(W.flag.x, 1.02, W.flag.z); fg.scale.y = 0.0001;
    const mast = new THREE.Mesh(G.cyl(0.08, 0.08, 3.2, 8), M.ink); mast.position.y = 1.6; const flag = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 1.2), M.flare); flag.position.set(1.04, 2.5, 0); flag.castShadow = true;
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.26, 12, 10), std({ color: 0xFF4A17, emissive: 0xFF4A17, emissiveIntensity: 0.3, roughness: 0.5 })); beacon.position.y = 3.4; fg.add(mast, flag, beacon); scene.add(fg);
    if (s.room !== '202') { const S = W.station; mesh(G.cyl(0.3, 0.3, TUBE_Y - TRAY_Y, 12, true), M.tube, S.x, (TUBE_Y + TRAY_Y) / 2, S.z, false, false); const br = mesh(G.cyl(0.3, 0.3, Math.abs(S.z), 12, true), M.tube, S.x, TUBE_Y, S.z / 2, false, false); br.rotation.x = Math.PI / 2; mesh(new THREE.SphereGeometry(0.42, 12, 10), M.tube, S.x, TUBE_Y, S.z, false, false); mesh(G.cyl(0.5, 0.5, 0.3, 16), M.ink, S.x, TRAY_Y + 0.05, S.z, false, true); }
    SLOT[s.id] = { bulb, flag: fg, beacon };
  });
  mesh(G.cyl(0.3, 0.3, 114, 14, true), M.tube, 0, TUBE_Y, 0, false, false).rotation.z = Math.PI / 2;
  [-40, -14, 14, 40].forEach((x) => mesh(G.cyl(0.08, 0.08, TUBE_Y, 8), M.ink, x, TUBE_Y / 2, 2.6, false, false));
  const LAMPS = []; for (let i = 0; i < 8; i++) { const l = new THREE.PointLight(0xFFD9A0, 0, 9, 2); l.visible = false; scene.add(l); LAMPS.push(l); }

  /* ---- belt, door, records, extras ---- */
  const bcan = document.createElement('canvas'); bcan.width = 64; bcan.height = 64; { const c = bcan.getContext('2d'); c.fillStyle = '#2A2A33'; c.fillRect(0, 0, 64, 64); c.strokeStyle = '#8A8A93'; c.lineWidth = 6; for (let i = -64; i < 128; i += 32) { c.beginPath(); c.moveTo(i, 64); c.lineTo(i + 64, 0); c.stroke(); } }
  const beltMaps = [];
  const beltPlane = (len, x, z, rotZ) => { const t = new THREE.CanvasTexture(bcan); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.encoding = THREE.sRGBEncoding; t.repeat.set(len / 2, 1); const m = mesh(new THREE.PlaneGeometry(len, 1.8), std({ map: t }), x, 1.0, z, false, true); m.rotation.x = -Math.PI / 2; m.rotation.z = rotZ; beltMaps.push(t); };
  beltPlane(BELT[1].x - BELT[0].x, (BELT[1].x + BELT[0].x) / 2, BELT[0].z, 0); beltPlane(wz(696) - BELT[1].z, BELT[1].x, (wz(696) + BELT[1].z) / 2, -Math.PI / 2);
  [[BELT[0].x, BELT[0].z - 1], [BELT[1].x - 1, BELT[1].z - 1], [BELT[2].x - 1, BELT[2].z]].forEach(([x, z]) => mesh(G.box(0.3, 1.0, 0.3), M.ink, x, 0.5, z));
  const door = mesh(G.box(10.2, 2.5, 0.4), std({ color: 0x8A8A93, roughness: 0.6, metalness: 0.3 }), wx(870), 1.25, wz(704)); mesh(G.box(11, 0.5, 1.0), M.ink, wx(870), 2.85, wz(704));
  const shelfY = [0.7, 1.4, 2.1]; shelfY.forEach((y, i) => mesh(G.box(13.6, 0.1, 0.8), M.ink, wx(1088), y, wz([420, 470, 520][i])));
  const filed = []; for (let i = 0; i < 48; i++) { const m = mesh(G.box(0.45, 1.2, 0.16), M.paper, 0, 0, 0); m.visible = false; filed.push(m); }
  mesh(G.cyl(0.6, 0.5, 0.8, 12), M.ink, wx(1150), 0.4, wz(70)); mesh(new THREE.SphereGeometry(1.05, 16, 12), M.plant, wx(1150), 1.75, wz(70)); mesh(G.box(14, 1.4, 0.1), M.deskTop, wx(630), 1.7, wz(392));

  /* ---- stamps ---- */
  const stampTex = (text, color, small) => { const c = document.createElement('canvas'); c.width = 512; c.height = 192; const x = c.getContext('2d'); x.strokeStyle = color; x.lineWidth = 12; x.strokeRect(14, 14, 484, 164); x.fillStyle = color; x.font = `800 ${small ? 120 : 104}px Archivo`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.letterSpacing = '6px'; x.fillText(text, 256, 100); x.fillStyle = 'rgba(251,250,246,.95)'; for (let i = 0; i < 2600; i++) x.fillRect(Math.random() * 512, Math.random() * 192, Math.random() * 4 + 1, Math.random() * 2 + 1); const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; return t; };
  const STAMP_TEX = { done: stampTex('DONE', '#00A95C'), fail: stampTex('FAIL', '#FF4A17'), ship: stampTex('SHIPPED', '#22356F'), yes: stampTex('YES', '#00A95C', true) };
  const rigs = []; for (let i = 0; i < 3; i++) { const g = new THREE.Group(); const block = new THREE.Mesh(G.box(5.6, 1.2, 2.1), M.ink); block.castShadow = true; const handle = new THREE.Mesh(G.cyl(0.26, 0.26, 1.3, 12), M.ink); handle.position.y = 1.25; const knob = new THREE.Mesh(new THREE.SphereGeometry(0.5, 14, 10), M.ink); knob.position.y = 2.0; g.add(block, handle, knob); g.visible = false; scene.add(g); const imp = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 2.1), new THREE.MeshBasicMaterial({ map: STAMP_TEX.done, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })); imp.rotation.x = -Math.PI / 2; imp.visible = false; scene.add(imp); rigs.push({ g, imp }); }

  /* ---- per-agent pegs, labels; per-paper sheet + capsule ---- */
  const PEG = {}, LAB = {}, PAP = {};
  const pegBody = G.cyl(0.56, 0.7, 1.3, 20), pegHead = new THREE.SphereGeometry(0.54, 20, 14), pegRing = new THREE.TorusGeometry(0.76, 0.09, 8, 28);
  function ensurePeg(a) {
    if (PEG[a.id]) return PEG[a.id];
    const W = a.slot.W; const g = new THREE.Group(); g.position.set(W.home.x, 0, W.home.z); const mat = std({ color: 0xD9D6CC, roughness: 0.85 });
    const b = new THREE.Mesh(pegBody, mat); b.position.y = 0.7; b.castShadow = true; const h = new THREE.Mesh(pegHead, mat); h.position.y = 1.68; h.castShadow = true; const r = new THREE.Mesh(pegRing, M.ink); r.rotation.x = Math.PI / 2; r.position.y = 0.06;
    g.add(b, h, r); scene.add(g); b.userData.agent = a.id; h.userData.agent = a.id;
    const d = document.createElement('div'); d.className = 'lab'; d.innerHTML = '<span class="m"></span><span class="r"></span>'; d.firstChild.textContent = String(a.name || a.id).toUpperCase().slice(0, 10); d.lastChild.textContent = a.role; labelsEl.appendChild(d); LAB[a.id] = d;
    return (PEG[a.id] = { g, mat, pick: [b, h] });
  }
  function ensurePaper(id) {
    if (PAP[id]) return PAP[id];
    const sheet = mesh(G.box(1.1, 0.06, 1.5), M.paper, 0, 0, 0, false, true); const cap = mesh(G.cyl(0.19, 0.19, 0.9, 12), M.paper, 0, 0, 0, false, false);
    const cm = new THREE.Mesh(G.cyl(0.21, 0.21, 0.3, 12), M.ink); cm.position.y = 0.3; cap.add(cm); const cm2 = cm.clone(); cm2.position.y = -0.3; cap.add(cm2);
    const light = new THREE.PointLight(0x9FB2E8, 0, 7, 2); scene.add(light); sheet.visible = cap.visible = false; return (PAP[id] = { sheet, cap, light });
  }

  /* ---- camera ---- */
  const cam = { target: new THREE.Vector3(0, 0.5, 1), r: 150, phi: 50, theta: -16 }, camTo = { target: new THREE.Vector3(0, 0.5, 1), r: 150, phi: 50, theta: -16 };
  let view = 'model', followId = null, W = 1, H = 1;
  const fitR = () => { const a = camera.aspect || 1.3, t = Math.tan(camera.fov / 2 * Math.PI / 180); return Math.max(66 / (t * a), 42 / t) * 1.06; };
  function setView(v, followAgent) {
    view = v; if (followAgent !== undefined) followId = followAgent;
    if (v === 'plan') { camTo.r = fitR(); camTo.phi = 88.5; camTo.theta = 0; camTo.target.set(0, 0, 0); }
    else if (v === 'model') { camTo.r = fitR() * 0.98; camTo.phi = 50; camTo.theta = -16; camTo.target.set(0, 0.5, 1); }
    else if (v === 'follow') { camTo.r = 24; camTo.phi = 46; camTo.theta = -28; }
  }
  let drag = null, moved = 0; const ptrs = new Map(); let pinch0 = 0; const clampR = (r) => Math.max(16, Math.min(260, r));
  canvas.addEventListener('pointerdown', (e) => { canvas.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY }); drag = { x: e.clientX, y: e.clientY }; moved = 0; if (ptrs.size === 2) { const [p, q] = [...ptrs.values()]; pinch0 = Math.hypot(p.x - q.x, p.y - q.y); } });
  canvas.addEventListener('pointermove', (e) => { if (!ptrs.has(e.pointerId)) return; ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (ptrs.size === 2) { const [p, q] = [...ptrs.values()]; const d = Math.hypot(p.x - q.x, p.y - q.y); if (pinch0) camTo.r = clampR(camTo.r * (pinch0 / d)); pinch0 = d; moved = 99; return; } if (!drag) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag = { x: e.clientX, y: e.clientY }; moved += Math.abs(dx) + Math.abs(dy); camTo.theta -= dx * 0.28; camTo.phi = Math.max(26, Math.min(89.5, camTo.phi + dy * 0.28)); });
  let onPick = () => {};
  const endPtr = (e) => { ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch0 = 0; if (drag && moved < 5) onPick(pick(e.clientX, e.clientY)); if (!ptrs.size) drag = null; };
  canvas.addEventListener('pointerup', endPtr); canvas.addEventListener('pointercancel', endPtr);
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); camTo.r = clampR(camTo.r * (1 + Math.sign(e.deltaY) * 0.09)); }, { passive: false });
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  function pick(cx, cy) { const b = canvas.getBoundingClientRect(); ndc.set(((cx - b.left) / b.width) * 2 - 1, -((cy - b.top) / b.height) * 2 + 1); ray.setFromCamera(ndc, camera); const objs = []; Object.values(PEG).forEach((p) => objs.push(...p.pick)); const hit = ray.intersectObjects(objs, false)[0]; return hit ? hit.object.userData.agent : null; }
  function updateCam(dt, agentsById) {
    const k = RM ? 1 : 1 - Math.exp(-dt * 5);
    if (view === 'follow' && followId && agentsById[followId]) { const Ws = agentsById[followId].slot.W; camTo.target.set(Ws.cx, 1, Ws.cz); }
    cam.r += (camTo.r - cam.r) * k; cam.phi += (camTo.phi - cam.phi) * k; cam.theta += (camTo.theta - cam.theta) * k; cam.target.lerp(camTo.target, k);
    const drift = RM ? 0 : Math.sin(performance.now() / 14000) * 0.9; const ph = cam.phi * Math.PI / 180, th = (cam.theta + drift) * Math.PI / 180;
    camera.position.set(cam.target.x + cam.r * Math.cos(ph) * Math.sin(th), cam.target.y + cam.r * Math.sin(ph), cam.target.z + cam.r * Math.cos(ph) * Math.cos(th)); camera.lookAt(cam.target);
  }
  function resize() { const b = stage.getBoundingClientRect(); W = Math.max(1, b.width); H = Math.max(1, b.height); renderer.setSize(W, H, false); camera.aspect = W / H; camera.updateProjectionMatrix(); if (view !== 'follow') setView(view); }
  new ResizeObserver(resize).observe(stage); resize(); cam.r = camTo.r;

  let night = false;
  function setTheme(isNight, bg) { night = isNight; scene.background = new THREE.Color(bg); hemi.intensity = night ? 0.12 : 0.45; hemi.color.set(night ? 0x9FB2E8 : 0xF7F6F3); sun.intensity = night ? 0.16 : 1.25; sun.color.set(night ? 0x8B9AC6 : 0xFFF4E2); M.tube.opacity = night ? 0.3 : 0.34; M.tube.color.set(night ? 0xB9C4E4 : 0xA9B6DB); M.tube.emissive = new THREE.Color(night ? 0x1C2D5E : 0x000000); }

  /* ---- one frame from an engine view ---- */
  const v3 = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), dir = new THREE.Vector3();
  function render(vw, now, dt, dayFrac, selected) {
    const az = (-55 + 110 * dayFrac) * Math.PI / 180, el = (38 + 22 * Math.sin(dayFrac * Math.PI)) * Math.PI / 180;
    sun.position.set(160 * Math.cos(el) * Math.sin(az), 160 * Math.sin(el), 160 * Math.cos(el) * Math.cos(az) * 0.6 + 20);
    const byId = {}; const working = []; const litSlots = new Set();
    for (const a of vw.agents) {
      byId[a.id] = a; const P = ensurePeg(a); P.g.visible = !a.gone; const S = SLOT[a.slot.id];
      P.mat.color.lerp(COL[a.state] || COL.idle, RM ? 1 : 0.25);
      if (a.state === 'working' && !a.gone) { const k = Math.round(Math.sin(now / 1000 * 6 + a.slot.W.cx)) * 0.22; P.g.rotation.y += (k - P.g.rotation.y) * 0.5; working.push(a); litSlots.add(a.slot.id); S.bulb.material.emissiveIntensity = 1.6; }
      else { P.g.rotation.y *= 0.8; S.bulb.material.emissiveIntensity = vw.flashes.has(a.id) ? 1.6 : 0; }
      const upF = a.state === 'blocked' && !a.gone; S.flag.scale.y += ((upF ? 1 : 0.0001) - S.flag.scale.y) * (RM ? 1 : 0.22); S.beacon.material.emissiveIntensity = upF ? ((Math.floor(now / 500) % 2) ? 1.8 : 0.2) : 0;
    }
    LAMPS.forEach((l, i) => { const a = working[i]; if (a) { const L = a.slot.W.lamp; l.position.set(L.x, 2.1, L.z); l.intensity = night ? 1.5 : 1.2; l.visible = true; } else l.visible = false; });
    let anyBelt = false;
    for (const p of vw.papers) {
      const o = ensurePaper(p.id); const pos = p.pos;
      if (!pos) { o.sheet.visible = o.cap.visible = false; o.light.intensity = 0; continue; }
      if (pos.moving) { o.sheet.visible = false; o.cap.visible = true; o.cap.position.set(pos.x, pos.y, pos.z); dir.set(pos.dx, pos.dy, pos.dz); if (dir.lengthSq() > 0) { dir.normalize(); o.cap.quaternion.setFromUnitVectors(up, dir); } o.light.position.set(pos.x, pos.y, pos.z); o.light.intensity = pos.y > 2 ? (night ? 1.4 : 0.8) : 0; if (pos.belt) anyBelt = true; }
      else { o.cap.visible = false; o.light.intensity = 0; o.sheet.visible = true; o.sheet.position.set(pos.x, pos.y, pos.z); o.sheet.material = pos.work ? M.paperWork : M.paper; }
    }
    beltMaps.forEach((t) => { t.offset.x -= anyBelt ? dt * 2.2 : 0; });
    door.position.y = 1.25 + vw.door * 2.3;
    rigs.forEach((r, i) => {
      const s = vw.stamps[i]; if (!s) { r.g.visible = r.imp.visible = false; return; }
      const a = s.a && byId[s.a]; const pz = s.dock ? DOCK_STAMP : a ? (a.slot.W.round ? { x: a.slot.W.cx - 2.4, z: a.slot.W.cz + 1.6 } : { x: a.slot.W.cx, z: a.slot.W.cz }) : DOCK_STAMP;
      const sc = s.small ? 0.55 : 1, age = s.age; let y; if (age < 0.14) y = 7 - (7 - 1.65) * (age / 0.14); else if (age < 0.5) y = 1.65; else if (age < 0.95) y = 1.65 + (7 - 1.65) * ((age - 0.5) / 0.45); else y = -1;
      r.g.visible = y > 0; r.g.position.set(pz.x, y, pz.z); r.g.scale.set(sc, sc, sc); r.g.rotation.y = -0.22;
      r.imp.visible = age >= 0.14; r.imp.material.map = STAMP_TEX[s.small ? 'yes' : s.kind]; r.imp.material.opacity = age < 1.3 ? 1 : Math.max(0, 1 - (age - 1.3) / 0.7); r.imp.position.set(pz.x, s.dock ? 1.08 : 1.04, pz.z); r.imp.scale.set(sc, sc, sc); r.imp.rotation.z = -0.22;
    });
    filed.forEach((m, i) => { m.visible = i < vw.shipped; if (m.visible) { const sh = Math.floor(i / 16) % 3, k = i % 16; m.position.set(wx(1024) + k * 0.78, shelfY[sh] + 0.65, wz([420, 470, 520][sh])); } });
    updateCam(dt, byId);
    for (const id in LAB) { const a = byId[id]; const d = LAB[id]; if (!a || a.gone) { d.style.display = 'none'; continue; } v3.set(a.slot.W.home.x, 2.7, a.slot.W.home.z).project(camera); if (v3.z > 1) { d.style.display = 'none'; continue; } d.style.display = ''; d.style.left = ((v3.x + 1) / 2 * W) + 'px'; d.style.top = ((1 - v3.y) / 2 * H) + 'px'; d.className = 'lab' + (selected === id ? ' sel' : ''); d.lastChild.style.display = (cam.r < 70 || selected === id) ? '' : 'none'; }
    renderer.render(scene, camera);
  }

  return { render, setView, setTheme, resize, setMeta(m) { Object.assign(meta, m); drawGround(); gtex.needsUpdate = true; }, onPick(fn) { onPick = fn; }, get view() { return view; }, get followId() { return followId; } };
}
