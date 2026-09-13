/* Rigged character panel.
   Idle loop from the clip, head tracking driven by the pointer (not baked),
   and a reach on click.

   The renderer is built the first time the panel comes near the viewport, not
   at page load. This page already runs a WebGL context for the hero and one
   more for the portfolio viewers, and a browser that is asked for too many at
   once reclaims the oldest — which is the hero, whose chair then silently
   disappears. Holding this context back until it is needed keeps the count
   down for everyone who never scrolls this far. */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const canvas = document.querySelector('#charcanvas');
const stage = document.querySelector('.char-stage');
const hint = document.querySelector('#charhint');

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarse = matchMedia('(pointer: coarse)').matches;

let visible = false, started = false, ctx = null;

if (canvas && stage) {
  // There is no cursor to follow on a touch screen, so ask for the thing that
  // does work there rather than for something the device cannot do.
  if (coarse && hint) hint.firstElementChild.textContent = 'Tap him';

  new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      visible = e.isIntersecting;
      if (!visible) return;
      if (!started) { started = true; ctx = init(); }
      if (ctx) ctx.resume();
    });
  }, { rootMargin: '200px 0px', threshold: 0.01 }).observe(stage);
}

function init() {
  let gl = null;
  try { gl = canvas.getContext('webgl2', { antialias: true, alpha: true, powerPreference: 'low-power' }); } catch (_) {}
  if (!gl) { stage.style.display = 'none'; return null; }

  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); stage.classList.add('lost'); }, false);
  canvas.addEventListener('webglcontextrestored', () => { stage.classList.remove('lost'); clock.getDelta(); loop(); }, false);

  const renderer = new THREE.WebGLRenderer({ canvas, context: gl, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, coarse ? 1.5 : 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.05).texture;
  pmrem.dispose();

  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 60);
  camera.position.set(0, 0.3, 5.9);
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
  stage.addEventListener('pointerleave', () => { ptr.inside = false; }, { passive: true });

  /* ---- model ---- */
  let mixer = null, head = null, rig = null, headMesh = null;
  let actions = {}, current = null, reaching = 0, running = false;
  const clock = new THREE.Clock();

  new GLTFLoader().load('models/robot.glb', (res) => {
    rig = res.scene;
    // Normalise rather than trusting the asset's own units, so swapping the
    // character for a client's own model needs no hand-tuned numbers.
    const size = new THREE.Box3().setFromObject(rig).getSize(new THREE.Vector3());
    rig.scale.setScalar(2.5 / (size.y || 1));
    const b2 = new THREE.Box3().setFromObject(rig);
    rig.position.y -= b2.min.y + 1.25;               // stand him on the floor plane
    rig.position.x -= (b2.max.x + b2.min.x) / 2;
    scene.add(rig);

    // This model names a bone AND a mesh "Head", so the loader has to rename one
    // of them and matching on the name is a coin toss. Picking the mesh means
    // the animation never rewrites what we rotate, the offset accumulates every
    // frame, and the head spins. Take the bone from the skeleton, and find the
    // face by the morph target it carries.
    rig.traverse((o) => {
      if (o.isMesh) o.frustumCulled = false;
      if (o.isSkinnedMesh && !head) {
        const bone = o.skeleton.bones.find((x) => /^head/i.test(x.name));
        if (bone) head = bone;
      }
      if (o.morphTargetDictionary && 'Surprised' in o.morphTargetDictionary) headMesh = o;
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
    if (visible) { clock.getDelta(); loop(); }
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

  /* ---- the reach: he lunges at the pointer, misses, resets ---- */
  let lastReach = 0;
  stage.addEventListener('pointerdown', () => {
    if (!mixer || reduce) return;
    const now = performance.now();
    if (now - lastReach < 450) return;             // no stacking on fast clicks
    lastReach = now;
    reaching = 1;
    // mostly the lunge; sometimes a wave or a thumbs-up, so repeat presses
    // don't feel like one canned response
    const r = Math.random();
    play(r < 0.72 ? 'Punch' : r < 0.88 ? 'Wave' : 'ThumbsUp', 0.12, true);
    if (headMesh && headMesh.morphTargetInfluences) surprise();
  });

  function surprise() {
    const infl = headMesh.morphTargetInfluences;
    const i = (headMesh.morphTargetDictionary || {}).Surprised ?? 1;
    const t0 = performance.now();
    const tick = () => {
      const k = (performance.now() - t0) / 620;
      if (k >= 1) { infl[i] = 0; return; }
      infl[i] = Math.sin(k * Math.PI);              // in and back out
      requestAnimationFrame(tick);
    };
    tick();
  }

  /* ---- head tracking, composed onto the pose the clip just wrote ---- */
  const MAX_YAW = 0.46, MAX_PITCH = 0.26;
  const offE = new THREE.Euler(0, 0, 0, 'YXZ');
  const offQ = new THREE.Quaternion();
  function trackHead() {
    if (!head) return;
    const w = reaching ? 0.25 : 1;                  // the clip leads during the reach
    offE.set(-ptr.y * MAX_PITCH * w, ptr.x * MAX_YAW * w, 0, 'YXZ');
    offQ.setFromEuler(offE);
    head.quaternion.multiply(offQ);
    if (rig) rig.rotation.y += (ptr.x * 0.34 - rig.rotation.y) * 0.08;
  }

  function loop() {
    if (!visible || !mixer) { running = false; return; }
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
    mixer.update(Math.min(clock.getDelta(), 0.05));
    trackHead();
    renderer.render(scene, camera);
  }

  return { resume() { if (!running && mixer && !reduce) { clock.getDelta(); loop(); } }, resize };
}
