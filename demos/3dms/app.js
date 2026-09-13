/* 3D Modeling Service — concept.
   One hero model, scroll-scrubbed: CAD edges → shaded render → exploded assembly.
   Three.js r186 + GSAP ScrollTrigger + Lenis. No build step. */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarse = matchMedia('(pointer: coarse)').matches;
const BRAND = 0x4d7bff;

/* ---------------- smooth scroll ---------------- */
gsap.registerPlugin(ScrollTrigger);

/* The story is one pinned, scrubbed timeline that is only built once the model
   has downloaded. If the browser restores a scroll position from a previous
   visit, that restore lands before the pin exists and the whole sequence is
   left desynced — the canvas renders a frame that belongs to a different
   scroll offset. Always start this page at the top. */
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
if (!location.hash) {
  scrollTo(0, 0);
  // Some browsers restore the offset after scripts run, so claim it again once
  // the load event has fired. A deep link to #work is left alone.
  addEventListener('load', () => scrollTo(0, 0), { once: true });
}

// Coming back via the back button restores the page from the bfcache with its
// old scroll offset and stale measurements. Re-measure rather than trust them.
addEventListener('pageshow', (e) => { if (e.persisted) ScrollTrigger.refresh(); });

let lenis = null;
if (!reduce && typeof Lenis !== 'undefined') {
  lenis = new Lenis({ lerp: 0.1, smoothWheel: true });
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((t) => lenis.raf(t * 1000));
  gsap.ticker.lagSmoothing(0);
}
$$('a[href^="#"]').forEach((a) => a.addEventListener('click', (e) => {
  const t = document.querySelector(a.getAttribute('href'));
  if (!t) return;
  e.preventDefault();
  lenis ? lenis.scrollTo(t, { duration: 1.3 }) : t.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth' });
}));

/* ---------------- nav + pipeline + filters (work with or without WebGL) ---------------- */
const nav = $('#nav');
const onScroll = () => nav.classList.toggle('scrolled', scrollY > 30);
addEventListener('scroll', onScroll, { passive: true }); onScroll();

const pipe = $('#pipeline');
if (pipe) new IntersectionObserver((en, o) => {
  en.forEach((e) => { if (e.isIntersecting) { pipe.style.setProperty('--w', '100%'); o.disconnect(); } });
}, { threshold: 0.4 }).observe(pipe);

const grid = $('#grid');
$('#filters').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  $$('#filters button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  const f = b.dataset.f;
  const apply = () => $$('#grid .card').forEach((c) => { c.hidden = f !== 'all' && c.dataset.cat !== f; });
  document.startViewTransition && !reduce ? document.startViewTransition(apply) : apply();
});
// only let a card's viewer spin while you're pointing at it
$$('#grid model-viewer').forEach((mv) => {
  mv.addEventListener('mouseenter', () => mv.setAttribute('auto-rotate', ''));
  mv.addEventListener('mouseleave', () => mv.removeAttribute('auto-rotate'));
});

/* ---------------- WebGL support ---------------- */
const canvas = $('#gl');
const loader = $('#loader');
let gl = null;
try { gl = canvas.getContext('webgl2', { antialias: true, alpha: true, powerPreference: 'high-performance' }); } catch (_) {}
// A browser that is juggling several WebGL contexts on one page will reclaim
// the oldest one. Three.js already blocks the default so the context can come
// back; what it cannot know is that this renderer only draws when marked dirty,
// so without this the chair simply never reappears after a restore.
canvas.addEventListener('webglcontextlost', () => {
  document.body.classList.add('gl-lost');
}, false);
canvas.addEventListener('webglcontextrestored', () => {
  document.body.classList.remove('gl-lost');
  window.dispatchEvent(new Event('gl-redraw'));
}, false);

if (!gl) {
  document.body.classList.add('no-webgl');
  loader.classList.add('done');
  setTimeout(() => loader.remove(), 600);
  $('#spec').style.opacity = 1;
  $$('#spec li').forEach((li) => li.classList.add('in'));
} else {
  boot();
}

/* ---------------- the scene ---------------- */
function boot() {
  const renderer = new THREE.WebGLRenderer({ canvas, context: gl, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, coarse ? 1.5 : 2));
  renderer.setSize(innerWidth, innerHeight, false);
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.1, 100);

  // studio lighting with no download
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();

  // a cool rim so the black doesn't go flat
  const rim = new THREE.DirectionalLight(0x86a6ff, 2.2); rim.position.set(-4, 3, -3); scene.add(rim);
  const key = new THREE.DirectionalLight(0xffffff, 1.4); key.position.set(3, 5, 4); scene.add(key);

  // soft contact shadow, drawn into a canvas texture (cheaper than a shadow map)
  const sc = document.createElement('canvas'); sc.width = sc.height = 256;
  const sx = sc.getContext('2d');
  const g = sx.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, 'rgba(0,0,0,.55)'); g.addColorStop(.55, 'rgba(0,0,0,.18)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  sx.fillStyle = g; sx.fillRect(0, 0, 256, 256);
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(3.4, 3.4),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(sc), transparent: true, depthWrite: false, opacity: 0 })
  );
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = -0.62; scene.add(shadow);

  const root = new THREE.Group(); scene.add(root);

  const state = {
    theta: 0.95, phi: 1.26, radius: 4.3, ty: 0, ox: 0,
    edge: 1, shade: 0, explode: 0, focus: -1, spin: 0
  };
  let parts = [];        // { mesh, base, dir, edges, mats }
  let dirty = true;
  const invalidate = () => { dirty = true; };

  /* If the model never arrives — a dropped connection, a stalled CDN — the
     loader must not sit there forever with the page behind it unusable.
     Fall back to the same readable layout used when there is no WebGL. */
  let settled = false;
  function degrade() {
    if (settled) return; settled = true;
    clearTimeout(stall);
    document.body.classList.add('no-webgl');
    loader.classList.add('done');
    setTimeout(() => { if (loader.isConnected) loader.remove(); }, 600);
    const spec = $('#spec'), hint = $('#hint');
    if (spec) { spec.style.opacity = 1; spec.classList.add('on'); }
    $$('#spec li').forEach((li) => { li.classList.add('in'); li.style.opacity = 1; });
    if (hint) hint.style.display = 'none';
    ScrollTrigger.refresh();
  }
  const stall = setTimeout(degrade, 25000);

  /* ----- load ----- */
  const bar = $('#loadbar');
  const gltf = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  gltf.load('models/hero-chair.glb', (res) => {
    const model = res.scene;

    // normalise: centre at origin, longest side = 2
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const centre = box.getCenter(new THREE.Vector3());
    const s = 2 / Math.max(size.x, size.y, size.z);
    model.position.sub(centre); model.scale.setScalar(s);
    const holder = new THREE.Group(); holder.add(model); root.add(holder);

    const world = new THREE.Box3().setFromObject(holder);
    const wc = world.getCenter(new THREE.Vector3());
    holder.position.y -= wc.y;                       // sit it on the origin plane

    const raw = [];
    model.traverse((o) => { if (o.isMesh) raw.push(o); });

    // part centres in the parent's own space, so offsets survive the model's scale
    const centres = raw.map((o) => {
      o.geometry.computeBoundingBox();
      return o.geometry.boundingBox.getCenter(new THREE.Vector3()).applyMatrix4(o.matrix);
    });
    const hub = centres.reduce((a, c) => a.add(c), new THREE.Vector3()).divideScalar(centres.length || 1);

    raw.forEach((o, i) => {
      o.frustumCulled = false;

      const mats = (Array.isArray(o.material) ? o.material : [o.material]).map((m) => {
        m.transparent = true; m.opacity = 0;
        m.envMapIntensity = 1.15;
        m.userData.baseEmissive = m.emissive ? m.emissive.clone() : null;
        return m;
      });
      o.material = Array.isArray(o.material) ? mats : mats[0];

      // CAD edge pass — the blue drawing the render fades in over
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(o.geometry, 26),
        new THREE.LineBasicMaterial({ color: BRAND, transparent: true, opacity: 1, depthWrite: false })
      );
      edges.frustumCulled = false;
      o.add(edges);

      // exploded view: push each part out from the assembly hub, proportionally,
      // with a little extra lift so stacked parts read as layers
      const d = centres[i].clone().sub(hub);
      if (d.length() < 1e-4) d.set(0, 0.05, 0);
      const off = new THREE.Vector3(d.x * 0.85, d.y * 1.35, d.z * 0.85);

      parts.push({ mesh: o, base: o.position.clone(), off, edges, mats, name: (o.name || '').toLowerCase() });
    });

    clearTimeout(stall);
    if (settled) return;               // already degraded; don't fight the fallback
    settled = true;
    loader.classList.add('done');
    setTimeout(() => { if (loader.isConnected) loader.remove(); }, 700);
    build();
    invalidate();
    // The pin spacer changes the document height, so every measurement taken
    // before this point is stale. Refresh once the layout has settled.
    requestAnimationFrame(() => { ScrollTrigger.refresh(); invalidate(); });
  }, (e) => { if (e.total) bar.style.width = Math.round((e.loaded / e.total) * 100) + '%'; },
     () => degrade());

  /* ----- camera ----- */
  const target = new THREE.Vector3(0, 0, 0);
  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  if (!coarse && !reduce) addEventListener('pointermove', (e) => {
    pointer.tx = (e.clientX / innerWidth - 0.5) * 0.18;
    pointer.ty = (e.clientY / innerHeight - 0.5) * 0.12;
  }, { passive: true });

  const wide = () => (innerWidth > 900 ? 1 : 0);

  function placeCamera() {
    const th = state.theta + state.spin + pointer.x;
    const ph = THREE.MathUtils.clamp(state.phi + pointer.y, 0.35, Math.PI - 0.35);
    camera.position.set(
      state.radius * Math.sin(ph) * Math.sin(th),
      state.radius * Math.cos(ph),
      state.radius * Math.sin(ph) * Math.cos(th)
    );
    target.set(0, state.ty, 0);
    camera.lookAt(target);
  }

  /* ----- per-frame apply ----- */
  function apply() {
    const shade = state.shade, edge = state.edge;
    parts.forEach((p, i) => {
      const focused = state.focus === -1 || state.focus === i;
      p.mats.forEach((m) => {
        m.opacity = shade * (focused ? 1 : 0.16);
        if (m.emissive && m.userData.baseEmissive) {
          const k = (state.focus === i) ? 0.35 : 0;
          m.emissive.copy(m.userData.baseEmissive).lerp(new THREE.Color(BRAND), k);
        }
        m.depthWrite = shade > 0.9;
      });
      p.edges.material.opacity = Math.max(edge, state.focus === i ? 0.55 : 0) * (focused ? 1 : 0.12);
      p.edges.visible = p.edges.material.opacity > 0.01;
      p.mesh.position.copy(p.base).addScaledVector(p.off, state.explode);
    });
    shadow.material.opacity = shade * 0.85 * (1 - state.explode * 0.6);
    root.position.x = state.ox * wide();
    placeCamera();
  }

  /* ----- render on demand ----- */
  function frame() {
    requestAnimationFrame(frame);
    const px = pointer.x + (pointer.tx - pointer.x) * 0.06;
    const py = pointer.y + (pointer.ty - pointer.y) * 0.06;
    if (Math.abs(px - pointer.x) > 1e-4 || Math.abs(py - pointer.y) > 1e-4) dirty = true;
    pointer.x = px; pointer.y = py;
    if (!dirty) return;
    dirty = false;
    apply();
    renderer.render(scene, camera);
  }
  frame();

  let rz = 0;
  addEventListener('gl-redraw', () => { ScrollTrigger.refresh(); invalidate(); });

  addEventListener('resize', () => {
    renderer.setSize(innerWidth, innerHeight, false);
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(devicePixelRatio, coarse ? 1.5 : 2));
    invalidate();
    // Mobile browser chrome sliding in and out changes innerHeight, which moves
    // the pin's end point. Re-measure once the resize has stopped.
    clearTimeout(rz);
    rz = setTimeout(() => { ScrollTrigger.refresh(); invalidate(); }, 200);
  }, { passive: true });

  /* ----- the scroll story ----- */
  function build() {
    const hero = $('#hero'), spec = $('#spec'), hint = $('#hint'), prog = $('#progress');
    const dots = $$('#progress i'), rows = $$('#spec li');

    if (reduce) {                       // no pin, no scrub: show the finished frame
      Object.assign(state, { theta: 0.4, phi: 1.2, radius: 4.4, edge: 0, shade: 1, explode: 0.4, ox: -0.4 });
      spec.style.opacity = 1; spec.classList.add('on');
      rows.forEach((r) => r.classList.add('in'));
      hint.style.display = 'none';
      invalidate(); wireRows(rows);
      return;
    }

    const tl = gsap.timeline({
      defaults: { ease: 'none' },
      scrollTrigger: {
        trigger: '#stage', start: 'top top', end: '+=420%',
        pin: true, scrub: 0.55, anticipatePin: 1, invalidateOnRefresh: true,
        onUpdate: (self) => {
          invalidate();
          const i = Math.min(dots.length - 1, Math.floor(self.progress * dots.length));
          dots.forEach((d, k) => d.classList.toggle('on', k <= i));
        }
      }
    });

    // 1 — the drawing becomes the render
    tl.to(state, { edge: 0, shade: 1, theta: 0.40, phi: 1.20, radius: 4.0, ox: 0.60, duration: 1.1 }, 0)
      .to(hint, { opacity: 0, duration: 0.35 }, 0)
    // 2 — orbit: let them see it's real geometry, not a picture
      .to(state, { theta: -1.05, phi: 1.02, radius: 4.2, duration: 1.3 }, 1.1)
      .to(hero, { opacity: 0, y: -30, duration: 0.6 }, 1.3)
    // 3 — the assembly opens, and moves out of the way of the list
      .to(state, { explode: 1, theta: -0.30, phi: 1.05, radius: 4.9, ty: 0.02, ox: -0.66, duration: 1.5 }, 2.2)
      .to(prog, { opacity: 1, duration: 0.3 }, 2.2)
      .to(spec, { opacity: 1, duration: 0.5, onStart: () => spec.classList.add('on') }, 2.35)
      .to(rows, { opacity: 1, x: 0, stagger: 0.18, duration: 0.5, ease: 'power2.out' }, 2.5)
    // 4 — back together, ready to hand over
      .to(state, { explode: 0.04, theta: 0.55, phi: 1.16, radius: 4.1, ty: 0, ox: 0, duration: 1.2 }, 4.1)
      .to(spec, { opacity: 0.25, duration: 0.5 }, 4.5)
      .to(prog, { opacity: 0, duration: 0.4 }, 4.6);

    rows.forEach((r) => r.classList.add('in'));   // GSAP owns opacity from here
    gsap.set(rows, { opacity: 0, x: 18 });
    wireRows(rows);
  }

  function wireRows(rows) {
    const byName = (frag) => parts.findIndex((p) => p.name.includes(frag));
    const map = { body: byName('wood'), fabric: byName('fabric'), metal: byName('metal'), label: byName('label') };
    rows.forEach((row) => {
      const want = row.dataset.part;
      const idx = map[want] ?? -1;
      const on = () => { state.focus = idx; row.classList.add('active'); invalidate(); };
      const off = () => { state.focus = -1; row.classList.remove('active'); invalidate(); };
      row.addEventListener('mouseenter', on);
      row.addEventListener('mouseleave', off);
      row.addEventListener('focusin', on);
      row.addEventListener('focusout', off);
      row.tabIndex = 0;
    });
  }
}
