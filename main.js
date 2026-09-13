/* Jude Oba — portfolio motion. GSAP ScrollTrigger + Lenis. Everything degrades: no JS = a readable page. */
(function () {
  'use strict';
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fine = window.matchMedia('(pointer: fine)').matches;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const hasGsap = typeof gsap !== 'undefined' && typeof ScrollTrigger !== 'undefined';
  if (hasGsap) gsap.registerPlugin(ScrollTrigger);

  /* ---------- smooth scroll ---------- */
  let lenis = null;
  if (!reduce && typeof Lenis !== 'undefined' && hasGsap) {
    lenis = new Lenis({ lerp: 0.09, wheelMultiplier: 1, smoothWheel: true });
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add((t) => lenis.raf(t * 1000));
    gsap.ticker.lagSmoothing(0);
  }
  const scrollTo = (target) => {
    if (lenis) lenis.scrollTo(target, { offset: 0, duration: 1.4 });
    else target.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth' });
  };
  $$('a[href^="#"]').forEach((a) => {
    a.addEventListener('click', (e) => {
      const id = a.getAttribute('href');
      if (id.length < 2) return;
      const t = $(id);
      if (!t) return;
      e.preventDefault();
      scrollTo(t);
      history.replaceState(null, '', id);
    });
  });

  /* ---------- intro + hero reveal ---------- */
  const intro = $('#intro');
  const heroLines = $$('[data-reveal-line] > *');
  function revealHero() {
    if (!hasGsap || reduce) {
      heroLines.forEach((l) => { l.style.opacity = 1; l.style.transform = 'none'; });
      $$('.hero [data-reveal]').forEach((el) => el.classList.add('is-in'));
      return;
    }
    const tl = gsap.timeline({ defaults: { ease: 'expo.out' } });
    tl.to(heroLines, { y: 0, opacity: 1, duration: 1.2, stagger: 0.12 }, 0)
      .add(() => $$('.hero [data-reveal]').forEach((el) => el.classList.add('is-in')), 0.35);
  }
  if (intro) {
    if (reduce || !hasGsap) { intro.remove(); revealHero(); }
    else {
      gsap.set(intro.firstElementChild, { y: 20, opacity: 0 });
      gsap.timeline()
        .to(intro.firstElementChild, { y: 0, opacity: 1, duration: 0.7, ease: 'expo.out' })
        .to(intro.firstElementChild, { y: -20, opacity: 0, duration: 0.5, ease: 'power2.in' }, '+=0.35')
        .to(intro, { yPercent: -100, duration: 0.9, ease: 'expo.inOut' }, '-=0.25')
        .add(revealHero, '-=0.55')
        .add(() => intro.remove());
    }
  } else revealHero();

  /* ---------- rotating word ---------- */
  const rot = $('#rot');
  if (rot && !reduce) {
    const words = $$('span', rot);
    let i = 0;
    setInterval(() => {
      words[i].classList.remove('on');
      i = (i + 1) % words.length;
      words[i].classList.add('on');
    }, 2600);
  }

  /* ---------- cursor glow ---------- */
  if (fine && !reduce) {
    const root = document.documentElement;
    let tx = innerWidth / 2, ty = innerHeight * 0.3, cx = tx, cy = ty;
    addEventListener('pointermove', (e) => { tx = e.clientX; ty = e.clientY; }, { passive: true });
    (function loop() {
      cx += (tx - cx) * 0.08; cy += (ty - cy) * 0.08;
      root.style.setProperty('--mx', cx + 'px'); root.style.setProperty('--my', cy + 'px');
      requestAnimationFrame(loop);
    })();
  }

  /* ---------- hero field (canvas constellation) ---------- */
  const canvas = $('#field');
  if (canvas && canvas.getContext) {
    const ctx = canvas.getContext('2d');
    let w, h, dpr, pts = [], mouse = { x: -9999, y: -9999 };
    const N = () => Math.min(90, Math.floor((w * h) / 16000));
    function resize() {
      dpr = Math.min(devicePixelRatio || 1, 2);
      w = canvas.clientWidth; h = canvas.clientHeight;
      canvas.width = w * dpr; canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = N();
      pts = Array.from({ length: n }, () => ({
        x: Math.random() * w, y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.25, vy: (Math.random() - 0.5) * 0.25,
        r: Math.random() * 1.4 + 0.6, hot: Math.random() < 0.18
      }));
    }
    resize();
    addEventListener('resize', resize, { passive: true });
    canvas.parentElement.addEventListener('pointermove', (e) => {
      const b = canvas.getBoundingClientRect(); mouse.x = e.clientX - b.left; mouse.y = e.clientY - b.top;
    }, { passive: true });
    canvas.parentElement.addEventListener('pointerleave', () => { mouse.x = mouse.y = -9999; });
    let running = true;
    function draw() {
      if (!running) return;
      ctx.clearRect(0, 0, w, h);
      const LINK = 130;
      for (const p of pts) {
        if (!reduce) {
          p.x += p.vx; p.y += p.vy;
          const dx = p.x - mouse.x, dy = p.y - mouse.y, d = Math.hypot(dx, dy);
          if (d < 160) { p.x += dx / d * 0.6; p.y += dy / d * 0.6; }
          if (p.x < -20) p.x = w + 20; if (p.x > w + 20) p.x = -20;
          if (p.y < -20) p.y = h + 20; if (p.y > h + 20) p.y = -20;
        }
      }
      ctx.lineWidth = 1;
      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
          const a = pts[i], b = pts[j];
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          if (d < LINK) {
            const o = (1 - d / LINK) * 0.22;
            ctx.strokeStyle = (a.hot || b.hot) ? `rgba(139,108,255,${o*1.2})` : `rgba(243,241,250,${o * 0.5})`;
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
          }
        }
      }
      for (const p of pts) {
        ctx.fillStyle = p.hot ? 'rgba(185,166,255,.95)' : 'rgba(243,241,250,.5)';
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
      }
      if (!reduce) requestAnimationFrame(draw);
    }
    draw();
    // pause when hero is off-screen
    if ('IntersectionObserver' in window && !reduce) {
      new IntersectionObserver((en) => {
        const vis = en[0].isIntersecting;
        if (vis && !running) { running = true; draw(); }
        else if (!vis) running = false;
      }).observe(canvas);
    }
  }

  /* ---------- marquee ---------- */
  const mq = $('#marquee');
  if (mq) {
    mq.innerHTML += mq.innerHTML;
    if (hasGsap && !reduce) gsap.to(mq, { xPercent: -50, duration: 40, ease: 'none', repeat: -1 });
  }

  /* ---------- generic reveals ---------- */
  const revealEls = $$('[data-reveal]:not(.hero [data-reveal])');
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('is-in'); io.unobserve(en.target); } });
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0.05 });
    revealEls.forEach((el) => io.observe(el));
    // stagger siblings a touch
    $$('.chapter-head, .numbers .grid, .about .bio, .contact .wrap').forEach((group) => {
      $$('[data-reveal]', group).forEach((el, i) => { el.style.transitionDelay = (i * 90) + 'ms'; });
    });
  } else revealEls.forEach((el) => el.classList.add('is-in'));

  /* ---------- nav on scroll ---------- */
  const nav = $('header.nav');
  if (nav) { const t = () => nav.classList.toggle('scrolled', scrollY > 40); addEventListener('scroll', t, { passive: true }); t(); }

  /* ---------- progress bar ---------- */
  const prog = $('#progress');
  if (prog) {
    const upd = () => {
      const max = document.documentElement.scrollHeight - innerHeight;
      prog.style.transform = `scaleX(${max > 0 ? Math.min(1, scrollY / max) : 0})`;
    };
    addEventListener('scroll', upd, { passive: true }); upd();
  }

  /* ---------- estate: light the diagram as steps pass ---------- */
  const diagram = $('#diagram');
  const steps = $$('#steps .step');
  if (diagram && steps.length) {
    const nodes = $$('.node[data-app]', diagram);
    const links = $$('.link[data-app]', diagram);
    const platform = $('#platform');
    const ring = $('#ring');
    const seen = new Set();
    function activate(app) {
      steps.forEach((s) => s.classList.toggle('is-active', s.dataset.app === app));
      seen.add(app);
      const isPlatform = app === 'platform';
      nodes.forEach((n) => {
        const on = n.dataset.app === app || (isPlatform && seen.has(n.dataset.app));
        n.classList.toggle('on', on);
        n.classList.toggle('dim', !on && !seen.has(n.dataset.app));
      });
      links.forEach((l) => l.classList.toggle('on', l.dataset.app === app || (isPlatform && seen.has(l.dataset.app))));
      platform.classList.toggle('on', isPlatform);
      ring.classList.toggle('on', isPlatform);
    }
    if (hasGsap) {
      steps.forEach((s) => {
        ScrollTrigger.create({
          trigger: s, start: 'top 60%', end: 'bottom 40%',
          onEnter: () => activate(s.dataset.app), onEnterBack: () => activate(s.dataset.app)
        });
      });
    } else {
      const io = new IntersectionObserver((en) => en.forEach((e) => e.isIntersecting && activate(e.target.dataset.app)), { rootMargin: '-40% 0px -40% 0px' });
      steps.forEach((s) => io.observe(s));
    }
  }

  /* ---------- work rail: horizontal on desktop ---------- */
  const rail = $('#rail'), pin = $('#workPin'), railbar = $('#railbar'), railcount = $('#railcount');
  if (rail && pin && hasGsap) {
    const cards = $$('.card', rail);
    ScrollTrigger.matchMedia({
      '(min-width: 901px)': function () {
        if (reduce) return;
        const dist = () => rail.scrollWidth - innerWidth;
        const tween = gsap.to(rail, {
          x: () => -dist(), ease: 'none',
          scrollTrigger: {
            trigger: pin, start: 'top 12%', end: () => '+=' + (dist() + innerHeight * 0.3),
            pin: true, scrub: 0.6, anticipatePin: 1, invalidateOnRefresh: true,
            onUpdate: (st) => {
              const p = st.progress;
              if (railbar) railbar.style.transform = `translateX(${p * 400}%)`;
              if (railcount) railcount.textContent = String(Math.min(cards.length, Math.floor(p * cards.length) + 1)).padStart(2, '0') + ' / ' + String(cards.length).padStart(2, '0');
            }
          }
        });
        return () => tween.scrollTrigger && tween.scrollTrigger.kill();
      },
      '(max-width: 900px)': function () {
        gsap.set(rail, { clearProps: 'transform' });
        if (railcount) railcount.textContent = String(cards.length).padStart(2, '0') + ' projects';
      }
    });
  }

  /* ---------- process steps ---------- */
  const procSteps = $$('[data-step]');
  if (procSteps.length && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver((en) => {
      en.forEach((e, i) => { if (e.isIntersecting) { setTimeout(() => e.target.classList.add('is-in'), 120 * procSteps.indexOf(e.target)); io.unobserve(e.target); } });
    }, { threshold: 0.3 });
    procSteps.forEach((s) => io.observe(s));
  }

  /* ---------- count-up ---------- */
  const counters = $$('[data-count]');
  if (counters.length) {
    const run = (el) => {
      const end = +el.dataset.count;
      if (reduce || !hasGsap) { el.textContent = end; return; }
      const o = { v: 0 };
      gsap.to(o, { v: end, duration: 1.6, ease: 'expo.out', onUpdate: () => { el.textContent = Math.round(o.v); } });
    };
    const io = new IntersectionObserver((en) => en.forEach((e) => { if (e.isIntersecting) { run(e.target); io.unobserve(e.target); } }), { threshold: 0.6 });
    counters.forEach((c) => io.observe(c));
  }

  /* ---------- contact: copy ---------- */
  const copy = $('#copy'), toast = $('#toast');
  if (copy) copy.addEventListener('click', () => {
    navigator.clipboard.writeText('judeoba111@gmail.com').then(() => {
      toast.classList.add('show'); setTimeout(() => toast.classList.remove('show'), 1600);
    }).catch(() => { location.href = 'mailto:judeoba111@gmail.com'; });
  });

  /* ---------- big background word parallax ---------- */
  const bgword = $('.bgword');
  if (bgword && hasGsap && !reduce) {
    gsap.to(bgword, { xPercent: -8, ease: 'none', scrollTrigger: { trigger: '#contact', start: 'top bottom', end: 'bottom top', scrub: true } });
  }

  /* ---------- year ---------- */
  const y = $('#year'); if (y) y.textContent = new Date().getFullYear();

  /* ---------- refresh on load (fonts change layout) ---------- */
  if (hasGsap) {
    addEventListener('load', () => ScrollTrigger.refresh());
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => ScrollTrigger.refresh());
  }
})();
