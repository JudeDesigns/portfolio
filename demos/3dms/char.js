/* Rigged character panel.
   Idle clip underneath; the head and the reach are solved at runtime against
   the pointer, not baked.

   The renderer is built the first time the panel comes near the viewport, not
   at page load. This page already runs a WebGL context for the hero and one
   more for the portfolio viewers, and a browser asked for too many at once
   reclaims the oldest — which is the hero, whose chair then silently
   disappears. */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const canvas = document.querySelector('#charcanvas');
const stage = document.querySelector('.char-stage');
const hint = document.querySelector('#charhint');

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarse = matchMedia('(pointer: coarse)').matches;

let visible = false, started = false, ctx = null;

if (canvas && stage) {
  if (coarse && hint) hint.firstElementChild.textContent = 'Tap her';
  new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      visible = e.isIntersecting;
      if (!visible) return;
      if (!started) { started = true; ctx = init(); }
      if (ctx) ctx.resume();
    });
  }, { rootMargin: '200px 0px', threshold: 0.01 }).observe(stage);
}

/* A bone the animation owns and we also want to steer.

   The mixer does not write a bone every frame: PropertyMixer skips the write
   when the clip's value has not changed since the last one, which is most
   frames for a near-static idle. So composing an offset onto whatever is
   currently in the bone compounds it, frame after frame, and the joint winds
   up spinning. Track the clip's pose separately: if the value differs from
   what we last wrote, the mixer has been here and that is the new base;
   otherwise the base still stands. Either way we write an absolute value. */
function Override(bone) {
  this.bone = bone;
  this.base = bone.quaternion.clone();
  this.last = bone.quaternion.clone();
}
Override.prototype.refresh = function () {
  if (!this.bone.quaternion.equals(this.last)) this.base.copy(this.bone.quaternion);
};
Override.prototype.write = function (q) {
  this.bone.quaternion.copy(q);
  this.last.copy(this.bone.quaternion);
};

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
  renderer.toneMappingExposure = 1.1;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.05).texture;
  pmrem.dispose();

  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 60);
  camera.position.set(0, 0.12, 5.6);
  camera.lookAt(0, -0.05, 0);

  const key = new THREE.DirectionalLight(0xffffff, 2.0); key.position.set(2.5, 4, 3); scene.add(key);
  const rim = new THREE.DirectionalLight(0x86a6ff, 1.6); rim.position.set(-3, 2, -3); scene.add(rim);
  scene.add(new THREE.HemisphereLight(0x9fb4ff, 0x070910, 0.5));

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
  let mixer = null, rig = null, running = false;
  let neck = null, head = null, chest = null;
  let arms = null;            // { L, R } each { arm, fore, restDir }
  let side = 'L';
  let actions = {}, current = null;
  let reach = 0, reachTarget = 0;
  const clock = new THREE.Clock();

  // three.js strips characters it reserves for animation paths, so a Mixamo
  // bone called "mixamorig:Head" arrives as "mixamorigHead". Match on the part
  // that survives rather than on the name in the source file.
  const B = (suffix) => {
    let found = null;
    const want = suffix.toLowerCase();
    rig.traverse((o) => {
      if (found || !o.isBone) return;
      const n = o.name.toLowerCase().replace(/[^a-z]/g, '');
      if (n.endsWith(want)) found = o;
    });
    return found;
  };

  new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).load('models/human.glb', (res) => {
    rig = res.scene;
    const size = new THREE.Box3().setFromObject(rig).getSize(new THREE.Vector3());
    rig.scale.setScalar(2.6 / (size.y || 1));
    const b2 = new THREE.Box3().setFromObject(rig);
    rig.position.y -= b2.min.y + 1.35;
    rig.position.x -= (b2.max.x + b2.min.x) / 2;
    scene.add(rig);
    rig.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });

    const headB = B('head');
    const mk = (a, f) => {
      const A = new Override(a), F = new Override(f);
      // the direction the upper arm points at rest, in its parent's space
      const dir = f.position.clone().applyQuaternion(A.base).normalize();
      return { arm: A, fore: F, restDir: dir };
    };
    const rA = B('rightarm'), rF = B('rightforearm');
    const lA = B('leftarm'), lF = B('leftforearm');
    if (!headB || !rA || !rF || !lA || !lF) { stage.style.display = 'none'; return; }
    head = new Override(headB);
    const nB = B('neck'); neck = nB && new Override(nB);
    const cB = B('spine2'); chest = cB && new Override(cB);
    arms = { R: mk(rA, rF), L: mk(lA, lF) };

    mixer = new THREE.AnimationMixer(rig);
    res.animations.forEach((c) => { actions[c.name] = mixer.clipAction(c); });
    ['agree', 'headShake'].forEach((n) => {
      const a = actions[n];
      if (a) { a.setLoop(THREE.LoopOnce); a.clampWhenFinished = true; }
    });
    play('idle');
    mixer.addEventListener('finished', () => play('idle', 0.35));
    if (reduce) { renderer.render(scene, camera); return; }
    if (visible) { clock.getDelta(); loop(); }
  }, undefined, () => { stage.style.display = 'none'; });

  function play(name, fade = 0.35, restart = false) {
    const next = actions[name];
    if (!next || (next === current && !restart)) return;
    const prev = current;
    if (prev && prev !== next) prev.fadeOut(fade);
    if (prev === next) next.stop();
    next.reset().setEffectiveWeight(1).fadeIn(fade).play();
    current = next;
  }

  /* ---- press: she reaches for the pointer, doesn't quite get it ---- */
  let busy = 0;
  stage.addEventListener('pointerdown', () => {
    if (!mixer || reduce) return;
    const now = performance.now();
    if (now - busy < 900) return;
    busy = now;
    // her left hand is on the viewer's right, so the near arm is the one that
    // looks like it is going for the cursor
    side = ptr.x >= 0 ? 'L' : 'R';
    reachTarget = 1;
    setTimeout(() => { reachTarget = 0; }, 900);          // reach out, then give up
    if (Math.random() < 0.3) play(Math.random() < 0.6 ? 'agree' : 'headShake', 0.2, true);
  });

  /* ---- where the pointer is, in the scene ---- */
  const aim = new THREE.Vector3();
  const tmpV = new THREE.Vector3(), tmpQ = new THREE.Quaternion(), tmpQ2 = new THREE.Quaternion();
  const vShoulder = new THREE.Vector3(), vElbow = new THREE.Vector3();
  const vRest = new THREE.Vector3(), vWant = new THREE.Vector3();
  const qParent = new THREE.Quaternion();
  const qAim = new THREE.Quaternion(), qFull = new THREE.Quaternion();
  const qOut = new THREE.Quaternion(), qSpare = new THREE.Quaternion();
  const offE = new THREE.Euler(0, 0, 0, 'YXZ');
  function updateAim() {
    // unproject the pointer onto a plane just in front of her
    tmpV.set(ptr.x, ptr.y, 0.5).unproject(camera).sub(camera.position).normalize();
    const t = (0.9 - camera.position.z) / tmpV.z;
    aim.copy(camera.position).addScaledVector(tmpV, t);
  }

  const MAX_YAW = 0.55, MAX_PITCH = 0.34;
  function solve() {
    // --- head and neck: split the turn so the spine reads, not just the skull
    const yaw = ptr.x * MAX_YAW, pitch = -ptr.y * MAX_PITCH;
    if (neck) {
      neck.refresh();
      offE.set(pitch * 0.4, yaw * 0.4, 0);
      neck.write(tmpQ.copy(neck.base).multiply(tmpQ2.setFromEuler(offE)));
    }
    head.refresh();
    offE.set(pitch * 0.7, yaw * 0.7, 0);
    head.write(tmpQ.copy(head.base).multiply(tmpQ2.setFromEuler(offE)));

    if (chest) {
      chest.refresh();
      offE.set(0, yaw * 0.18, 0);
      chest.write(tmpQ.copy(chest.base).multiply(tmpQ2.setFromEuler(offE)));
    }

    // --- arm: point the upper arm at the pointer, by however much of the reach
    // is currently in play. Not a full IK solver — one bone aimed at a target,
    // with a forearm that straightens as it extends — but it is solved every
    // frame against the live cursor, which is the part that cannot be faked.
    //
    // Work in world space. The bone's parent is a shoulder with its own
    // arbitrary orientation, so a direction expressed in that parent's axes is
    // not something you can reason about; measuring where the elbow actually
    // is, and where the target actually is, avoids the question entirely.
    for (const k of ['L', 'R']) {
      const a = arms[k];
      a.arm.refresh(); a.fore.refresh();
      const amount = k === side ? reach : 0;
      if (amount < 0.002) { a.arm.write(a.arm.base); a.fore.write(a.fore.base); continue; }

      // rest pose first, so the measurement is of the clip and not of our own
      // previous frame
      a.arm.bone.quaternion.copy(a.arm.base);
      a.arm.bone.updateMatrixWorld(true);
      a.arm.bone.getWorldPosition(vShoulder);
      a.fore.bone.getWorldPosition(vElbow);
      a.arm.bone.parent.getWorldQuaternion(qParent);

      vRest.copy(vElbow).sub(vShoulder).normalize();
      vWant.copy(aim).sub(vShoulder).normalize();
      qAim.setFromUnitVectors(vRest, vWant);

      // a world rotation R on a bone under parent P is P⁻¹ · R · P in local space
      qFull.copy(qParent).invert().multiply(qAim).multiply(qParent).multiply(a.arm.base);
      qOut.copy(a.arm.base).slerp(qFull, amount);
      a.arm.write(qOut);

      // the forearm gets a share of the same aim, which straightens the elbow
      // toward the target instead of folding it across the body — no per-side
      // sign to get wrong
      a.fore.bone.parent.getWorldQuaternion(qParent);
      qFull.copy(qParent).invert().multiply(qAim).multiply(qParent).multiply(a.fore.base);
      qOut.copy(a.fore.base).slerp(qFull, amount * 0.5);
      a.fore.write(qOut);
    }
  }

  function loop() {
    if (!visible || !mixer) { running = false; return; }
    running = true;
    requestAnimationFrame(loop);
    // Before anyone has engaged — and on touch, where there is no cursor at
    // all — she looks around on her own rather than standing frozen.
    if (!ptr.inside) {
      const t = performance.now() / 1000;
      ptr.tx = Math.sin(t * 0.37) * 0.45;
      ptr.ty = Math.sin(t * 0.26 + 1.2) * 0.22;
    }
    ptr.x += (ptr.tx - ptr.x) * 0.08;
    ptr.y += (ptr.ty - ptr.y) * 0.08;
    reach += (reachTarget - reach) * (reachTarget > reach ? 0.16 : 0.07);
    // Clamp the step. A backgrounded tab, a scroll away and back, or a slow
    // GPU hands back a delta of whole seconds, and an unclamped mixer swallows
    // a whole clip in one frame.
    mixer.update(Math.min(clock.getDelta(), 0.05));
    updateAim();
    solve();
    renderer.render(scene, camera);
  }

  return { resume() { if (!running && mixer && !reduce) { clock.getDelta(); loop(); } }, resize };
}
