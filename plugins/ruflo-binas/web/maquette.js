// The maquette: what is being built, as an architectural model on its own plate. One block per file, grouped
// into districts by top folder in the order they first appeared (so nothing already standing ever moves),
// height from the lines written. A print-head gantry rides to the file being written and drops a flare line
// onto it. Overprint: card, one ink, three spot inks, linear motion, no springs. app.js calls render().
const CELL = 3.4, COLS = 4, GAP = 3.2, MAX_ROW = 58, FOOT = 2.5;

export const districtOf = (file) => { const s = String(file || '').replace(/\\/g, '/').replace(/^\.\//, ''); const i = s.indexOf('/'); return i > 0 ? s.slice(0, i) : 'root'; };
export function kindOf(file) {
  const f = String(file || '').toLowerCase();
  if (/(^|\/)(tests?|__tests__|spec)\/|\.(test|spec)\.[a-z]+$/.test(f)) return 'test';
  if (/\.(md|mdx|txt)$/.test(f)) return 'doc';
  if (/\.(html?|svg|vue|svelte|jsx|tsx)$/.test(f)) return 'markup';
  if (/\.(css|scss|sass|less)$/.test(f)) return 'style';
  if (/\.(png|jpe?g|gif|webp|ico|mp3|wav|ogg|woff2?)$/.test(f)) return 'asset';
  if (/\.(json|ya?ml|toml|lock|ini)$|(^|\/)\.[a-z]/.test(f)) return 'config';
  return 'code';
}
export const heightFor = (lines) => 0.5 + Math.log2(1 + Math.max(0, Number(lines) || 0)) * 0.95;

/** Stable layout: districts left to right in first-seen order, wrapping into rows; cells fill 4 across. */
export function layoutFiles(files) {
  const groups = new Map();
  for (const f of [...files].sort((a, b) => a.t0 - b.t0 || String(a.file).localeCompare(String(b.file)))) { const d = districtOf(f.file); if (!groups.has(d)) groups.set(d, []); groups.get(d).push(f); }
  const districts = []; let x = 0, z = 0, rowDepth = 0;
  for (const [name, list] of groups) {
    const cols = list.length > 24 ? 8 : list.length > 12 ? 6 : COLS; // widens twice as a folder grows; blocks glide to their new spots
    const rows = Math.ceil(list.length / cols), w = cols * CELL, d = Math.max(1, rows) * CELL;
    if (x > 0 && x + w > MAX_ROW) { x = 0; z += rowDepth + GAP + 2; rowDepth = 0; }
    districts.push({ name, x, z, w, d, count: list.length, cells: list.map((f, i) => ({ file: f.file, cx: x + (i % cols) * CELL + CELL / 2, cz: z + Math.floor(i / cols) * CELL + CELL / 2 })) });
    x += w + GAP; rowDepth = Math.max(rowDepth, d);
  }
  const width = districts.length ? Math.max(...districts.map((d) => d.x + d.w)) : COLS * CELL;
  const depth = districts.length ? Math.max(...districts.map((d) => d.z + d.d)) : CELL * 2;
  return { districts, width, depth };
}

const TINT = { code: 0xF7F6F3, markup: 0xDCE2F2, style: 0xF5E2D9, test: 0xF7F6F3, doc: 0xE9E7E1, config: 0xE3E1DA, asset: 0xEDE9E0 };

export function createMaquette(THREE, canvas, stage, labelsEl) {
  const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2)); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.outputEncoding = THREE.sRGBEncoding;
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0xF7F6F3); scene.fog = new THREE.Fog(0xF7F6F3, 120, 260);
  const camera = new THREE.PerspectiveCamera(34, 1, 0.5, 900);
  scene.add(new THREE.HemisphereLight(0xF7F6F3, 0x8A8A93, 0.55));
  const sun = new THREE.DirectionalLight(0xFFF4E2, 1.15); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 5, far: 260 }); sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.02; scene.add(sun, sun.target);
  const std = (o) => new THREE.MeshStandardMaterial({ roughness: 0.9, ...o });
  const INK = 0x14141A, FLARE = 0xFF4A17, GREEN = 0x00A95C, BLUE = 0x22356F;
  const M = { plate: std({ color: 0xF4F2EC }), ink: std({ color: INK, roughness: 0.6 }), flare: std({ color: FLARE, roughness: 0.6, emissive: FLARE, emissiveIntensity: 0.35 }), laser: new THREE.MeshBasicMaterial({ color: FLARE, transparent: true, opacity: 0.9 }) };
  const EDGE = { ink: new THREE.LineBasicMaterial({ color: INK }), flare: new THREE.LineBasicMaterial({ color: FLARE }), green: new THREE.LineBasicMaterial({ color: GREEN }), blue: new THREE.LineBasicMaterial({ color: BLUE }) };
  const boxGeo = new THREE.BoxGeometry(FOOT, 1, FOOT); boxGeo.translate(0, 0.5, 0); const edgeGeo = new THREE.EdgesGeometry(boxGeo);

  /* ---- the plate, drawn like a plotter sheet ---- */
  const pcan = document.createElement('canvas'); pcan.width = 2048; pcan.height = 2048; const ptex = new THREE.CanvasTexture(pcan); ptex.encoding = THREE.sRGBEncoding; ptex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const PLATE = 160; const plate = new THREE.Mesh(new THREE.BoxGeometry(PLATE, 0.6, PLATE), [M.plate, M.plate, std({ map: ptex, roughness: 1 }), M.plate, M.plate, M.plate]);
  plate.position.y = -0.3; plate.receiveShadow = true; scene.add(plate);
  const toPx = (v) => ((v + PLATE / 2) / PLATE) * 2048;
  let sheetSig = '';
  function drawSheet(lay, info) {
    const sig = JSON.stringify([lay.districts.map((d) => [d.name, d.count, d.x, d.z]), info.title, info.files, info.lines, info.live]); if (sig === sheetSig) return; sheetSig = sig;
    const c = pcan.getContext('2d'); c.fillStyle = '#F7F6F3'; c.fillRect(0, 0, 2048, 2048);
    const step = 2048 / PLATE; c.lineWidth = 1; for (let i = 0; i <= PLATE; i++) { c.strokeStyle = i % 5 ? '#E3E0D8' : '#CFCBC1'; c.beginPath(); c.moveTo(i * step, 0); c.lineTo(i * step, 2048); c.stroke(); c.beginPath(); c.moveTo(0, i * step); c.lineTo(2048, i * step); c.stroke(); }
    const ox = -lay.width / 2, oz = -lay.depth / 2;
    if (!lay.districts.length) { c.setLineDash([14, 10]); c.strokeStyle = '#6B6B75'; c.lineWidth = 3; c.strokeRect(toPx(-14), toPx(-8), 28 * step, 16 * step); c.setLineDash([]); c.fillStyle = '#57575F'; c.font = '600 20px Archivo'; c.textAlign = 'center'; c.fillText('SITE · WAITING FOR THE FIRST PIECE', 1024, toPx(0) + 7); c.textAlign = 'left'; }
    for (const d of lay.districts) {
      const x = toPx(ox + d.x - 0.6), z = toPx(oz + d.z - 0.6), w = (d.w + 1.2) * step, h = (d.d + 1.2) * step;
      c.strokeStyle = '#14141A'; c.lineWidth = 2.5; c.strokeRect(x, z, w, h); c.setLineDash([10, 8]); c.strokeStyle = '#8A8A93'; c.lineWidth = 1.5; c.strokeRect(x + 8, z + 8, w - 16, h - 16); c.setLineDash([]);
      c.fillStyle = '#14141A'; c.font = '700 34px Archivo'; c.fillText((d.name === 'root' ? 'MAIN' : d.name).toUpperCase() + '/', x, z - 50); c.fillStyle = '#57575F'; c.font = '26px "Fragment Mono"'; c.fillText(`${d.count} piece${d.count === 1 ? '' : 's'}`, x, z - 18);
    }
    const tx = 1360, ty = 1720; c.fillStyle = '#F7F6F3'; c.fillRect(tx, ty, 640, 280); c.strokeStyle = '#14141A'; c.lineWidth = 3; c.strokeRect(tx, ty, 640, 280);
    [['PROJECT', info.title || '—'], ['PIECES', String(info.files)], ['LINES', info.lines.toLocaleString()], ['DRAWN BY', 'BINAS']].forEach((r, i) => { const y = ty + 20 + i * 56; c.strokeStyle = '#C6C2B8'; c.lineWidth = 1.5; if (i) { c.beginPath(); c.moveTo(tx, y - 10); c.lineTo(tx + 640, y - 10); c.stroke(); } c.fillStyle = '#6B6B75'; c.font = '600 20px Archivo'; c.fillText(r[0], tx + 20, y + 24); c.fillStyle = '#14141A'; c.font = '30px "Fragment Mono"'; c.fillText(String(r[1]).slice(0, 26).toUpperCase(), tx + 190, y + 28); });
    if (info.live) { c.save(); c.translate(tx + 470, ty + 150); c.rotate(-0.12); c.strokeStyle = '#00A95C'; c.lineWidth = 7; c.strokeRect(-130, -48, 260, 96); c.fillStyle = '#00A95C'; c.font = '800 64px Archivo'; c.textAlign = 'center'; c.fillText('LIVE', 0, 22); c.restore(); }
    ptex.needsUpdate = true;
  }

  /* ---- the gantry: rails, bridge, carriage, laser ---- */
  const G = new THREE.Group(); scene.add(G);
  const railA = new THREE.Mesh(new THREE.BoxGeometry(1, 0.22, 0.22), M.ink), railB = railA.clone(); G.add(railA, railB);
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 1), M.ink); G.add(bridge);
  const carriage = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.8, 1.1), M.flare); carriage.castShadow = true; G.add(carriage);
  const laser = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1, 8), M.laser); G.add(laser);
  const posts = [0, 1, 2, 3].map(() => { const p = new THREE.Mesh(new THREE.BoxGeometry(0.22, 1, 0.22), M.ink); G.add(p); return p; });
  let GANTRY_Y = 9; const car = { x: 0, z: 0 };

  /* ---- blocks ---- */
  const B = new Map(); const LAB = {};
  function blockFor(file) {
    let b = B.get(file); if (b) return b;
    const kind = kindOf(file); const mat = std({ color: TINT[kind] });
    const mesh = new THREE.Mesh(boxGeo, mat); mesh.castShadow = true; mesh.receiveShadow = true; mesh.scale.y = 0.001;
    const edges = new THREE.LineSegments(edgeGeo, kind === 'doc' ? EDGE.blue : EDGE.ink); mesh.add(edges);
    scene.add(mesh); b = { file, kind, mesh, edges, mat, h: 0.001, x: null, z: null }; B.set(file, b); return b;
  }

  /* ---- camera: orbit, zoom, auto-fit ---- */
  const cam = { tx: 0, tz: 0, r: 70, phi: 54, theta: -26 }, camTo = { ...cam }; let userZoom = false;
  let drag = null; const ptr = new THREE.Vector2(-9, -9); let hover = null;
  canvas.addEventListener('pointerdown', (e) => { canvas.setPointerCapture(e.pointerId); drag = { x: e.clientX, y: e.clientY }; });
  canvas.addEventListener('pointermove', (e) => { const r = canvas.getBoundingClientRect(); ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); if (!drag) return; camTo.theta -= (e.clientX - drag.x) * 0.25; camTo.phi = Math.max(18, Math.min(82, camTo.phi + (e.clientY - drag.y) * 0.2)); drag = { x: e.clientX, y: e.clientY }; });
  canvas.addEventListener('pointerup', () => { drag = null; }); canvas.addEventListener('pointerleave', () => { ptr.set(-9, -9); });
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); userZoom = true; camTo.r = Math.max(18, Math.min(220, camTo.r * (1 + Math.sign(e.deltaY) * 0.09))); }, { passive: false });
  const ray = new THREE.Raycaster();
  function resize() { const w = stage.clientWidth || 1, h = stage.clientHeight || 1; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
  new ResizeObserver(resize).observe(stage); resize();

  function label(id, text, x, y, z, cls) {
    let d = LAB[id]; if (!d) { d = document.createElement('div'); d.className = 'mlab'; labelsEl.appendChild(d); LAB[id] = d; }
    const v = new THREE.Vector3(x, y, z).project(camera); if (v.z > 1) { d.style.display = 'none'; return; }
    d.style.display = ''; d.className = 'mlab ' + (cls || ''); if (d.textContent !== text) d.textContent = text;
    d.style.left = ((v.x + 1) / 2 * canvas.clientWidth) + 'px'; d.style.top = ((1 - v.y) / 2 * canvas.clientHeight) + 'px';
  }

  /**
   * One frame. files: [{ file, lines, t0 }]; active: { file, writer } or null; testsOk, live: booleans;
   * title: project name; who(id) -> display name for a writer.
   */
  function render({ files = [], active = null, dt = 0.016, testsOk = false, live = false, title = '', who = (id) => id } = {}) {
    const lay = layoutFiles(files); const ox = -lay.width / 2, oz = -lay.depth / 2;
    const totalLines = files.reduce((n, f) => n + (Number(f.lines) || 0), 0);
    drawSheet(lay, { title, files: files.length, lines: totalLines, live });
    const want = new Map(files.map((f) => [f.file, f])); const seen = new Set();
    for (const d of lay.districts) for (const c of d.cells) {
      const f = want.get(c.file); const b = blockFor(c.file); seen.add(c.file);
      const tx = ox + c.cx, tz = oz + c.cz; if (b.x === null) { b.x = tx; b.z = tz; }
      const k = RM ? 1 : Math.min(1, dt * 4); b.x += (tx - b.x) * k; b.z += (tz - b.z) * k; b.mesh.position.set(b.x, 0, b.z);
      const target = heightFor(f.lines); const step = (RM ? 999 : 7) * dt; b.h = b.h < target ? Math.min(target, b.h + step) : Math.max(target, b.h - step); b.mesh.scale.y = b.h;
      const isActive = active && active.file === c.file; const passed = testsOk && b.kind === 'test';
      b.edges.material = isActive ? EDGE.flare : passed ? EDGE.green : b.kind === 'doc' ? EDGE.blue : EDGE.ink;
      b.mat.color.setHex(passed ? 0xCDEBD9 : TINT[b.kind]);
    }
    for (const [file, b] of B) if (!seen.has(file)) { scene.remove(b.mesh); b.mat.dispose(); B.delete(file); if (LAB['f:' + file]) { LAB['f:' + file].remove(); delete LAB['f:' + file]; } }

    /* gantry spans the content just above the tallest piece; carriage rides to the active block at constant speed */
    const x0 = ox - 2, x1 = ox + lay.width + 2, z0 = oz - 2, z1 = oz + lay.depth + 2;
    let tallest = 0; for (const b of B.values()) tallest = Math.max(tallest, b.h); const gy = Math.max(7, tallest + 3.5); GANTRY_Y += (gy - GANTRY_Y) * Math.min(1, dt * 2);
    railA.scale.x = railB.scale.x = x1 - x0; railA.position.set((x0 + x1) / 2, GANTRY_Y, z0); railB.position.set((x0 + x1) / 2, GANTRY_Y, z1);
    [[x0, z0], [x1, z0], [x0, z1], [x1, z1]].forEach(([px, pz], i) => { posts[i].scale.y = GANTRY_Y; posts[i].position.set(px, GANTRY_Y / 2, pz); });
    const ab = active && B.get(active.file); const goal = ab ? { x: ab.x, z: ab.z } : { x: x0 + 1.5, z: z0 + 1.5 };
    const sp = (RM ? 9999 : 34) * dt; const dx = goal.x - car.x, dz = goal.z - car.z; const dist = Math.hypot(dx, dz);
    if (dist <= sp) { car.x = goal.x; car.z = goal.z; } else { car.x += dx / dist * sp; car.z += dz / dist * sp; }
    bridge.scale.z = z1 - z0; bridge.position.set(car.x, GANTRY_Y, (z0 + z1) / 2); carriage.position.set(car.x, GANTRY_Y - 0.5, car.z);
    const on = !!ab && dist < 0.5; laser.visible = on;
    if (on) { const top = ab.h; const len = Math.max(0.1, GANTRY_Y - 0.9 - top); laser.scale.y = len; laser.position.set(car.x, top + len / 2, car.z); M.laser.opacity = RM ? 0.9 : 0.55 + 0.4 * (Math.floor(performance.now() / 120) % 2); }

    /* camera fits the content unless the viewer zoomed */
    const span = Math.max(lay.width, lay.depth, 24);
    if (!userZoom) { const fit = span * 1.7 + 22; camTo.r = camera.aspect < 1 ? fit * Math.min(2.2, 0.85 / Math.max(0.4, camera.aspect)) : fit; }
    const k = RM ? 1 : Math.min(1, dt * 2.5); cam.r += (camTo.r - cam.r) * k; cam.phi += (camTo.phi - cam.phi) * k; cam.theta += (camTo.theta - cam.theta) * k;
    const drift = RM ? 0 : Math.sin(performance.now() / 16000) * 6; const ph = cam.phi * Math.PI / 180, th = (cam.theta + drift) * Math.PI / 180;
    camera.position.set(cam.r * Math.cos(ph) * Math.sin(th), cam.r * Math.sin(ph), cam.r * Math.cos(ph) * Math.cos(th)); camera.lookAt(0, 1, 0); scene.fog.near = cam.r * 1.1; scene.fog.far = cam.r * 2.6;
    sun.position.set(span * 0.6, span * 1.6 + 40, span * 0.9); sun.target.position.set(0, 0, 0);

    /* labels: the piece being written, and the one under the pointer */
    ray.setFromCamera(ptr, camera); const hit = ray.intersectObjects([...B.values()].map((b) => b.mesh), false)[0];
    hover = hit ? [...B.values()].find((b) => b.mesh === hit.object) : null;
    for (const id in LAB) LAB[id].style.display = 'none';
    if (ab) { const f = want.get(ab.file); label('active', `${ab.file.split('/').pop()} · ${f.lines} lines · ${who(active.writer)}`, ab.x, ab.h + 1.2, ab.z, 'on'); }
    if (hover && (!ab || hover !== ab)) { const f = want.get(hover.file); label('hover', `${hover.file} · ${f.lines} lines`, hover.x, hover.h + 1.2, hover.z, ''); }
    renderer.render(scene, camera);
    stage.dataset.pieces = String(files.length);
  }
  return { render, resize };
}
