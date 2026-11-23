const menuButton = document.querySelector('#menu-toggle');
const nav = document.querySelector('#navigation');
menuButton.addEventListener('click', () => {
  const open = nav.classList.toggle('open');
  menuButton.setAttribute('aria-expanded', String(open));
  menuButton.setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню');
});
nav.querySelectorAll('a').forEach(link => link.addEventListener('click', () => {
  nav.classList.remove('open');
  menuButton.setAttribute('aria-expanded', 'false');
}));

document.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => {
  const category = button.dataset.filter;
  document.querySelectorAll('[data-filter]').forEach(other => {
    const active = other === button;
    other.classList.toggle('active', active);
    other.setAttribute('aria-pressed', String(active));
  });
  document.querySelectorAll('.service-card').forEach(card => {
    card.hidden = category !== 'all' && card.dataset.category !== category;
  });
}));

const dialog = document.querySelector('#book-dialog');
const serviceSelect = document.querySelector('#service-select');
const dateSelect = document.querySelector('#date-select');
const result = document.querySelector('#demo-result');
const today = new Date();
const localDate = new Date(today.getTime() - today.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
dateSelect.min = localDate;
document.querySelectorAll('[data-book]').forEach(button => button.addEventListener('click', () => {
  if (button.dataset.service) serviceSelect.value = button.dataset.service;
  result.hidden = true;
  dialog.showModal();
}));
document.querySelector('#demo-submit').addEventListener('click', () => {
  const day = dateSelect.value ? new Date(`${dateSelect.value}T12:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }) : 'день пока не выбран';
  result.textContent = `Пример заявки: ${serviceSelect.value}, ${day}. Для настоящей записи понадобится подключить расписание салона.`;
  result.hidden = false;
});
dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });

// A real, interactive WebGL still life. The CSS object beneath it remains usable if WebGL is unavailable.
function initScene() {
  if (!window.THREE) return;
  const canvas = document.querySelector('#hero-canvas');
  const host = document.querySelector('#hero-art');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const THREE = window.THREE;
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' }); }
  catch { return; }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.5;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, .1, 100);
  camera.position.set(0, 1.2, 10.7);
  camera.lookAt(0, 0, 0);
  scene.add(new THREE.HemisphereLight(0xfff4ff, 0x695476, 2.1));
  const key = new THREE.DirectionalLight(0xfff4ee, 3.1);
  key.position.set(-3, 7, 6); key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024); key.shadow.camera.left = -6; key.shadow.camera.right = 6;
  key.shadow.camera.top = 6; key.shadow.camera.bottom = -6; key.shadow.bias = -.0002;
  scene.add(key);
  const rim = new THREE.PointLight(0x966fff, 2.4, 11); rim.position.set(3, 2, -2); scene.add(rim);
  const warm = new THREE.PointLight(0xffded1, 1.8, 9); warm.position.set(-3, -1, 4); scene.add(warm);

  const floorMaterial = new THREE.MeshPhysicalMaterial({ color: 0xe8dbe9, roughness: .72 });
  const floor = new THREE.Mesh(new THREE.CylinderGeometry(2.55, 2.65, .18, 96), floorMaterial);
  floor.position.y = -2.15; floor.receiveShadow = true; scene.add(floor);
  const plinth = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.75, .16, 80), new THREE.MeshPhysicalMaterial({ color: 0xf4ebf5, metalness: .18, roughness: .25 }));
  plinth.position.y = -2.02; plinth.receiveShadow = true; scene.add(plinth);

  const group = new THREE.Group(); scene.add(group);
  group.rotation.y = -.25;
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x8a52b0, metalness: .04, roughness: .08, transmission: .35, transparent: true, opacity: .94, thickness: 1.5, clearcoat: 1, clearcoatRoughness: .07, side: THREE.DoubleSide });
  const deep = new THREE.MeshPhysicalMaterial({ color: 0x5e2f83, metalness: .12, roughness: .18, clearcoat: 1 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xf1e7f4, metalness: .95, roughness: .15 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xe2c29e, metalness: .86, roughness: .2 });
  const bottle = new THREE.Group(); bottle.rotation.z = -.13; bottle.position.set(-.23, -.05, .15); group.add(bottle);
  const body = new THREE.Mesh(new THREE.CylinderGeometry(.78, .84, 2.55, 64, 1), glass);
  body.position.y = -.36; body.castShadow = true; body.receiveShadow = true; bottle.add(body);
  const shoulder = new THREE.Mesh(new THREE.SphereGeometry(.78, 48, 32, 0, Math.PI * 2, 0, Math.PI / 2), glass);
  shoulder.position.y = .91; shoulder.scale.y = .48; shoulder.castShadow = true; bottle.add(shoulder);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(.81, .81, .2, 64), deep);
  base.position.y = -1.68; base.castShadow = true; bottle.add(base);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(.29, .33, .38, 48), gold);
  neck.position.y = 1.31; neck.castShadow = true; bottle.add(neck);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(.43, .42, .53, 64), chrome);
  cap.position.y = 1.72; cap.castShadow = true; bottle.add(cap);
  const capTop = new THREE.Mesh(new THREE.CylinderGeometry(.43, .43, .04, 64), gold);
  capTop.position.y = 2.005; bottle.add(capTop);
  const capBand = new THREE.Mesh(new THREE.TorusGeometry(.425, .025, 10, 64), gold);
  capBand.rotation.x = Math.PI / 2; capBand.position.y = 1.48; bottle.add(capBand);

  const labelCanvas = document.createElement('canvas'); labelCanvas.width = 512; labelCanvas.height = 512;
  const c = labelCanvas.getContext('2d');
  c.fillStyle = '#f8edf5'; c.fillRect(0, 0, 512, 512);
  c.strokeStyle = '#bfa9c9'; c.lineWidth = 3; c.strokeRect(18, 18, 476, 476);
  c.fillStyle = '#3c254d'; c.textAlign = 'center';
  c.font = 'bold 107px Georgia'; c.fillText('MIRA', 256, 235);
  c.font = '23px Arial'; c.letterSpacing = '8px'; c.fillText('BEAUTY RITUAL', 256, 287);
  c.fillStyle = '#8a6f9b'; c.font = '18px Arial'; c.fillText('your moment', 256, 404);
  const labelTexture = new THREE.CanvasTexture(labelCanvas);
  labelTexture.encoding = THREE.sRGBEncoding;
  const label = new THREE.Mesh(new THREE.PlaneGeometry(1.29, 1.2), new THREE.MeshBasicMaterial({ map: labelTexture, transparent: true, side: THREE.DoubleSide }));
  label.position.set(0, -.35, .847); bottle.add(label);

  const orbitMaterial = new THREE.MeshPhysicalMaterial({ color: 0xf5e9f8, metalness: .75, roughness: .12, clearcoat: 1 });
  const orbit = new THREE.Mesh(new THREE.TorusGeometry(2.25, .12, 18, 128), orbitMaterial);
  orbit.rotation.set(.52, .42, -.42); orbit.position.set(.1, -.03, -.3); orbit.castShadow = true; group.add(orbit);
  const thinOrbit = new THREE.Mesh(new THREE.TorusGeometry(2.55, .023, 8, 128), gold);
  thinOrbit.rotation.set(.63, .18, .45); thinOrbit.position.set(.1, -.12, -.5); group.add(thinOrbit);

  const pearlMaterial = new THREE.MeshPhysicalMaterial({ color: 0xf7e9ff, metalness: .25, roughness: .06, clearcoat: 1, transmission: .18 });
  const pearl = new THREE.Mesh(new THREE.SphereGeometry(.55, 48, 32), pearlMaterial);
  pearl.position.set(1.68, -.94, 1.1); pearl.castShadow = true; group.add(pearl);
  const violetPearl = new THREE.Mesh(new THREE.SphereGeometry(.22, 40, 24), new THREE.MeshPhysicalMaterial({ color: 0x7041a4, metalness: .43, roughness: .1 }));
  violetPearl.position.set(-1.75, 1.25, .7); group.add(violetPearl);
  const tinyPearl = new THREE.Mesh(new THREE.SphereGeometry(.12, 24, 16), gold);
  tinyPearl.position.set(2.2, 1.3, -.2); group.add(tinyPearl);

  const petals = new THREE.Group(); petals.position.set(1.45, 1.26, -.75); group.add(petals);
  const petalMat = new THREE.MeshPhysicalMaterial({ color: 0xf3d5ee, side: THREE.DoubleSide, metalness: .05, roughness: .22, clearcoat: .7 });
  for (let i = 0; i < 6; i++) {
    const petal = new THREE.Mesh(new THREE.SphereGeometry(.43, 24, 16), petalMat);
    const angle = i * Math.PI / 3;
    petal.position.set(Math.cos(angle) * .39, Math.sin(angle) * .39, 0);
    petal.scale.set(.78, 1.26, .25); petal.rotation.z = angle - Math.PI / 2;
    petals.add(petal);
  }
  const center = new THREE.Mesh(new THREE.SphereGeometry(.22, 32, 20), gold); center.position.z = .14; petals.add(center);

  let width = 0, height = 0, active = true, dragging = false, pointerX = 0, targetY = -.25, targetX = 0, frame = 0;
  function resize() {
    const rect = host.getBoundingClientRect();
    width = Math.max(1, rect.width); height = Math.max(1, rect.height);
    renderer.setSize(width, height, false); camera.aspect = width / height;
    camera.position.z = width < 500 ? 12.1 : 10.7;
    camera.updateProjectionMatrix();
    if (reducedMotion) renderer.render(scene, camera);
  }
  new ResizeObserver(resize).observe(host); resize();
  canvas.addEventListener('pointerdown', event => { dragging = true; pointerX = event.clientX; canvas.setPointerCapture(event.pointerId); });
  canvas.addEventListener('pointermove', event => {
    if (dragging) { targetY += (event.clientX - pointerX) * .008; pointerX = event.clientX; }
    else { const rect = canvas.getBoundingClientRect(); targetY = -.25 + ((event.clientX - rect.left) / rect.width - .5) * .35; targetX = ((event.clientY - rect.top) / rect.height - .5) * -.12; }
  });
  canvas.addEventListener('pointerup', () => { dragging = false; });
  canvas.addEventListener('pointercancel', () => { dragging = false; });
  const observer = new IntersectionObserver(entries => { active = entries[0].isIntersecting; if (active && !reducedMotion && !frame) animate(); });
  observer.observe(host);
  const clock = new THREE.Clock();
  function animate() {
    frame = requestAnimationFrame(animate);
    if (!active || document.hidden) return;
    const t = clock.getElapsedTime();
    group.rotation.y += (targetY - group.rotation.y) * .045;
    group.rotation.x += (targetX - group.rotation.x) * .04;
    group.position.y = Math.sin(t * .75) * .07;
    petals.rotation.z = Math.sin(t * .5) * .14;
    pearl.position.y = -.94 + Math.sin(t * 1.1) * .08;
    renderer.render(scene, camera);
  }
  if (reducedMotion) renderer.render(scene, camera); else animate();
  host.classList.add('webgl-ready');
}
initScene();
