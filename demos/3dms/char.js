/* Rigged character panel.
   Idle loop from the clip, head tracking driven by the pointer (not baked),
   and a reach on click. Own renderer, paused whenever the panel is off screen. */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const canvas = document.querySelector('#charcanvas');
const stage = document.querySelector('.char-stage');
const hint = document.querySelector('#charhint');
if (canvas && stage) start();

function start() {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const coarse = matchMedia('(pointer: coarse)').matches;

  let gl = null;
  try { gl = canvas.getContext('webgl2', { antialias: true, alpha: true }); } catch (_) {}
  if (!gl) { stage.style.display = 'none'; return; }

  // There is no cursor to follow on a touch screen, so ask for the thing that
  // does work there rather than for something the device cannot do.
  if (coarse && hint) hint.firstElementChild.textContent = 'Tap him';

  const renderer = new THREE.WebGLRenderer({ canvas, context: gl, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, coarse ? 1.5 : 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.05).texture;

  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 60);
  camera.position.set(0, 0.35, 6.3);
  camera.lookAt(0, 0.05, 0);

  const key = new THREE.DirectionalLight(0xffffff, 1.5);
  key.position.set(2.5, 4, 3); scene.add(key);
  scene.add(new THREE.HemisphereLight(0x9fb4ff, 0x0a0c12, 0.6));

  function resize() {
    const r = stage.getBoundingClientRect();
    if (!r.width || !r.height) return;
    renderer.setSize(r.width, r.height, false);
    camera.aspect = r.width / r.height;
    camera.updateProjectionMatrix();
  }
  resize();
  addEventListener('resize', resize, { passive: true });

  /* ---- pointer, in the panel's own coordinates ---- */
  const ptr = { x: 0, y: 0, tx: 0, ty: 0, inside: false };
  stage.addEventListener('pointermove', (e) => {
    const r = stage.getBoundingClientRect();
    ptr.tx = ((e.clientX - r.left) / r.width) * 2 - 1;
    ptr.ty = -(((e.clientY - r.top) / r.height) * 2 - 1);
    ptr.inside = true;
    if (hint) hint.classList.add('gone');
  }, { passive: true });
  stage.addEventListener('pointerleave', () => { ptr.inside = false; ptr.tx = 0; ptr.ty = 0; }, { passive: true });

  /* ---- model ---- */
  let mixer = null, head = null, rig = null, actions = {}, current = null, headMesh = null;
  let reaching = 0;                      // 1 while the reach clip owns the head
  const clock = new THREE.Clock();

  new GLTFLoader().load('models/robot.glb', (res) => {
    rig = res.scene;
    // Normalise rather than trusting the asset's own units, so swapping the
    // character for a client's own model needs no hand-tuned numbers.
    const box = new THREE.Box3().setFromObject(rig);
    const size = box.getSize(new THREE.Vector3());
    rig.scale.setScalar(2.5 / (size.y || 1));
    const box2 = new THREE.Box3().setFromObject(rig);
    rig.position.y -= box2.min.y + 1.25;          // stand him on the floor plane
    rig.position.x -= (box2.max.x + box2.min.x) / 2;
    scene.add(rig);

    rig.traverse((o) => {
      if (o.isMesh) { o.frustumCulled = false; if (o.name === 'Head') headMesh = o; }
      if (o.isBone && o.name === 'Head') head = o;
    });

    mixer = new THREE.AnimationMixer(rig);
    res.animations.forEach((clip) => { actions[clip.name] = mixer.clipAction(clip); });

    ['Jump', 'Punch', 'ThumbsUp', 'Wave', 'Yes', 'No'].forEach((n) => {
      const a = actions[n];
      if (a) { a.setLoop(THREE.LoopOnce); a.clampWhenFinished = true; }
    });

    play('Idle');
    mixer.addEventListener('finished', () => { reaching = 0; play('Idle', 0.35); });
    if (reduce) { renderer.render(scene, camera); return; }
    if (visible) loop();
  }, undefined, () => { stage.style.display = 'none'; });

  function play(name, fade = 0.3, restart = false) {
    const next = actions[name];
    if (!next) return;
    if (next === current && !restart) return;
    const prev = current;
    // Fade the outgoing clip out explicitly. Dropping the reference instead
    // leaves it playing at full weight and the two clips average each other
    // out, which reads on screen as the new clip never firing at all.
    if (prev && prev !== next) prev.fadeOut(fade);
    if (prev === next) next.stop();
    next.reset().setEffectiveWeight(1).fadeIn(fade).play();
    current = next;
  }

  /* ---- the reach: he lunges at the cursor, misses, resets ---- */
  const reachClips = ['Punch', 'Wave', 'ThumbsUp'];
  let lastReach = 0;
  stage.addEventListener('pointerdown', () => {
    if (!mixer || reduce) return;
    const now = performance.now();
    if (now - lastReach < 450) return;          // no animation stacking on fast clicks
    lastReach = now;
    reaching = 1;
    // mostly the lunge; occasionally he waves or approves instead, so repeat
    // clicking doesn't feel like a single canned response
    const pick = Math.random() < 0.72 ? 'Punch' : reachClips[1 + Math.floor(Math.random() * 2)];
    play(pick, 0.12, true);                      // restart even if it is the same clip
    if (headMesh && headMesh.morphTargetInfluences) surprise();
  });

  function surprise() {
    const infl = headMesh.morphTargetInfluences;
    const dict = headMesh.morphTargetDictionary || {};
    const i = dict.Surprised ?? 1;
    const t0 = performance.now();
    const tick = () => {
      const k = (performance.now() - t0) / 620;
      if (k >= 1) { infl[i] = 0; return; }
      infl[i] = Math.sin(k * Math.PI);          // in and back out
      requestAnimationFrame(tick);
    };
    tick();
  }

  /* ---- head tracking, applied after the clip has written the bones ---- */
  const MAX_YAW = 0.46, MAX_PITCH = 0.26;
  function trackHead() {
    if (!head) return;
    const w = reaching ? 0.25 : 1;              // the clip leads during the reach
    head.rotation.y += ptr.x * MAX_YAW * w;
    head.rotation.x += -ptr.y * MAX_PITCH * w;
    if (rig) rig.rotation.y += (ptr.x * 0.34 - rig.rotation.y) * 0.08;  // body follows, lazily
  }

  /* ---- render only while the panel is on screen ---- */
  let visible = false, running = false;
  new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      visible = e.isIntersecting;
      if (visible && mixer && !running && !reduce) { clock.getDelta(); loop(); }
    });
  }, { threshold: 0.05 }).observe(stage);

  function loop() {
    if (!visible) { running = false; return; }
    running = true;
    requestAnimationFrame(loop);
    // Before anyone has engaged — and on touch, where there is no cursor at
    // all — he looks around on his own rather than standing frozen.
    if (!ptr.inside) {
      const t = performance.now() / 1000;
      ptr.tx = Math.sin(t * 0.42) * 0.5;
      ptr.ty = Math.sin(t * 0.29 + 1.2) * 0.28;
    }
    ptr.x += (ptr.tx - ptr.x) * 0.09;
    ptr.y += (ptr.ty - ptr.y) * 0.09;
    // Clamp the step. A backgrounded tab, a scroll away and back, or simply a
    // slow GPU hands back a delta of whole seconds, and an unclamped mixer
    // swallows a one-second clip in a single frame — the reach fires and is
    // over before anything has been drawn.
    if (mixer) mixer.update(Math.min(clock.getDelta(), 0.05));
    trackHead();
    renderer.render(scene, camera);
  }
}
