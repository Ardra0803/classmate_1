const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const stars = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);
const api = async (url, opts) => { const r = await fetch(url, opts); const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || 'Something went wrong.'); return d; };
const post = (url, body) => api(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;
const root = document.documentElement;

const RATINGS = [['overall', 'Overall experience'], ['clarity', 'Clarity of teaching'], ['personalisation', 'Plan tailored to me'], ['doubts', 'Doubt solving'], ['assessments', 'Assignments and exams']];

// Split a heading into words so each one can slide in
function split(el) {
  if (!el || el.dataset.split) return;
  el.dataset.split = 1;
  el.innerHTML = el.textContent.trim().split(/\s+/).map((w, i) => `<span class="wd"><i style="--i:${i}">${esc(w)}</i></span>`).join(' ');
}

function greet() {
  const h = new Date().getHours();
  const g = h < 5 ? 'Up late?' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : h < 22 ? 'Good evening' : 'Up late?';
  const el = $('#greet'); if (!el) return;
  el.textContent = g + ' · free intro calls are open';
}

async function init() {
  $('#year').textContent = '© ' + new Date().getFullYear() + ' classmate';
  const site = await api('/api/site');
  $('#tagline').textContent = site.tagline; split($('#tagline'));
  $('#intro').textContent = site.intro;
  greet();
  setupMotion(site);

  // Level tabs: auto-rotate with a progress bar until the visitor picks one
  const tabs = $('#trackTabs'), prog = $('#tprog') || document.createElement('div'), bar = prog.firstElementChild || document.createElement('i');
  let cur = 0;
  const showTrack = (i) => {
    cur = i;
    [...tabs.children].forEach((b, j) => b.setAttribute('aria-selected', i === j));
    $('#trackHead').textContent = site.tracks[i].headline;
    $('#trackPoints').innerHTML = site.tracks[i].points.map((p, n) => `<li style="--n:${n}">${esc(p)}</li>`).join('');
    [$('#trackHead'), ...$$('#trackPoints li')].forEach((el) => { el.classList.remove('swapin'); void el.offsetWidth; el.classList.add('swapin'); });
    bar.style.animation = 'none'; void bar.offsetWidth; bar.style.animation = '';
  };
  (site.tracks = site.tracks || []).forEach((t, i) => { const b = document.createElement('button'); b.textContent = t.label; b.role = 'tab'; b.onclick = () => { prog.classList.add('off'); showTrack(i); }; tabs.append(b); });
  if (site.tracks.length) showTrack(0);
  if (site.tracks.length < 2) prog.hidden = true;
  bar.addEventListener('animationend', (e) => { if (e.animationName === 'tfill' && !prog.classList.contains('off')) showTrack((cur + 1) % site.tracks.length); });

  $('#steps').innerHTML = (site.steps || []).map((s) => `<li class="reveal"><b>${esc(s.title)}</b><span>${esc(s.text)}</span></li>`).join('');

  $('#tutorList').innerHTML = (site.tutors = site.tutors || []).map((t) => `
    <article class="tutor tilt reveal"><div class="avatar" aria-hidden="true">${esc(t.name[0])}</div><div>
      <h3>${esc(t.name)}</h3><p class="role">${esc(t.role)}</p><p>${esc(t.bio)}</p>
      <dl><dt>Qualification:</dt><dd>${esc(t.qualification)}</dd><dt>Experience:</dt><dd>${esc(t.experience)}</dd><dt>Teaches:</dt><dd>${esc(t.subjects)}</dd></dl>
    </div></article>`).join('');
  $('#fbTutor').innerHTML = '<option value="">Choose tutor</option>' + site.tutors.map((t) => `<option>${esc(t.name)}</option>`).join('') + '<option>Both</option>';

  const c = site.contact || {};
  const link = (k, v) => /@/.test(v) && k === 'Email' ? `<a href="mailto:${esc(v)}">${esc(v)}</a>` : (k === 'Phone' || k === 'WhatsApp') && /^[+\d][\d\s()-]{6,}$/.test(v) ? `<a href="tel:${esc(v.replace(/[^\d+]/g, ''))}">${esc(v)}</a>` : esc(v);
  const rows = [['Email', c.email], ['Phone', c.phone], ['WhatsApp', c.whatsapp], ['Location', c.location], ['Class timings', c.hours], ['Instagram', c.instagram]].filter(([, v]) => v && String(v).trim());
  $('#contactDetails').hidden = !rows.length;
  if (!rows.length) $('.contact-grid').style.gridTemplateColumns = '1fr';
  $('#contactDetails').innerHTML = rows
    .map(([k, v]) => `<div class="dcard reveal"><dt>${k}</dt><dd>${link(k, v)}</dd></div>`).join('');

  loadFeedback(); buildRatings();
  setInterval(() => { if (!document.hidden) loadFeedback().catch(() => {}); }, 45000); // keeps itself fresh
}

let sigF = null, fbFilter = 'All';
async function loadFeedback() {
  const list = await api('/api/feedback');
  const sig = JSON.stringify(list); if (sig === sigF) return; sigF = sig;
  renderStats(list);
  const fil = $('#fbFilters') || document.createElement('div'); fil.innerHTML = '';
  if (!list.length) { $('#fbSummary').innerHTML = ''; $('#fbList').innerHTML = '<p class="empty">No feedback yet. Past students, be the first to share yours.</p>'; return; }
  const avg = list.reduce((a, f) => a + f.ratings.overall, 0) / list.length;
  const rec = Math.round(100 * list.filter((f) => f.recommend === 'yes').length / list.length);
  $('#fbSummary').innerHTML = `<span><b>${avg.toFixed(1)}</b> <span class="stars">${stars(Math.round(avg))}</span></span><span>${list.length} review${list.length > 1 ? 's' : ''}</span><span>${rec}% recommend us</span>`;

  const level = (g) => { const m = String(g || '').match(/\d+/); return m ? 'Class ' + parseInt(m[0], 10) : (g || 'Student'); };
  const num = (l) => parseInt((l.match(/\d+/) || [99])[0], 10);
  const levels = ['All', ...[...new Set(list.map((f) => level(f.grade)))].sort((a, b) => num(a) - num(b))];
  if (!levels.includes(fbFilter)) fbFilter = 'All';
  const draw = (flt) => {
    const box = $('#fbList');
    box.innerHTML = list.filter((f) => flt === 'All' || level(f.grade) === flt).map((f) => `
    <article class="fb work">
      <span class="stars" aria-label="${f.ratings.overall} out of 5">${stars(f.ratings.overall)}</span><br>
      <small>${esc(level(f.grade))} · ${esc(f.subject)}</small>
      <h3>${f.showName ? esc(f.name) + ', ' : 'Student, '}${esc(level(f.grade))}</h3>
      ${f.before && f.after ? `<p><span class="ba">${esc(f.before)} → ${esc(f.after)}</span></p>` : ''}
      ${f.liked ? `<p class="lbl">What they liked most</p><p>${esc(f.liked)}</p>` : ''}
      ${f.message ? `<p class="lbl">In their own words</p><p>${esc(f.message)}</p>` : ''}
      <small>${f.tutor ? 'Taught by ' + esc(f.tutor) : ''}${f.duration ? ' · ' + esc(f.duration) : ''}</small>
    </article>`).join('');
    box.scrollTo({ left: 0 });
  };
  levels.forEach((l) => { const b = document.createElement('button'); b.textContent = l; b.setAttribute('aria-pressed', l === fbFilter);
    b.onclick = () => { fbFilter = l; [...fil.children].forEach((x) => x.setAttribute('aria-pressed', x === b)); draw(l); }; fil.append(b); });
  draw(fbFilter);
}

function buildRatings() {
  $('#rateBox').innerHTML = RATINGS.map(([k, label]) => `<div class="rate" data-k="${k}"><span>${label}</span><span class="st">${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-v="${n}" aria-label="${n} star">★</button>`).join('')}</span></div>`).join('');
  $$('.rate').forEach((r) => r.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    r.dataset.val = b.dataset.v;
    r.querySelectorAll('button').forEach((x) => x.classList.toggle('on', +x.dataset.v <= +b.dataset.v));
  }));
}

function msg(el, text, ok) { el.textContent = text; el.className = 'msg ' + (ok ? 'ok' : 'err'); }

// A little confetti when a form goes through
function burst(el) {
  if (reduce) return;
  const r = el.getBoundingClientRect(), cols = ['#e5484d', '#ffe066', '#4f7cff', '#1a8f4d'];
  for (let i = 0; i < 28; i++) {
    const p = document.createElement('i'), a = Math.random() * Math.PI * 2, d = 60 + Math.random() * 120;
    p.className = 'confetti';
    p.style.cssText = `left:${r.left + r.width / 2}px;top:${r.top + r.height / 2}px;background:${cols[i % 4]};--dx:${Math.cos(a) * d}px;--dy:${Math.sin(a) * d - 50}px;--rot:${Math.random() * 720}deg`;
    document.body.append(p); setTimeout(() => p.remove(), 1000);
  }
}

$('#fbForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target, body = Object.fromEntries(new FormData(f));
  body.showName = f.showName.checked;
  $$('.rate').forEach((r) => (body[r.dataset.k] = r.dataset.val || 0));
  try {
    const r = await post('/api/feedback', body);
    f.reset(); $$('.rate').forEach((x) => { delete x.dataset.val; x.querySelectorAll('button').forEach((b) => b.classList.remove('on')); });
    msg($('#fbMsg'), r.approved ? 'Thank you! Your feedback is now live.' : 'Thank you! Your feedback will appear after review.', true);
    burst(f.querySelector('button[type=submit]'));
    loadFeedback();
  } catch (err) { msg($('#fbMsg'), err.message, false); }
});

$('#ctForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try { await post('/api/contact', Object.fromEntries(new FormData(e.target))); burst(e.target.querySelector('button[type=submit]')); e.target.reset(); msg($('#ctMsg'), 'Thanks! We will get back to you soon.', true); }
  catch (err) { msg($('#ctMsg'), err.message, false); }
});

init().catch((e) => { console.error(e); document.body.insertAdjacentHTML('afterbegin', '<p class="msg err" style="padding:12px">Could not load site data. Start the server with "python app.py" and open http://localhost:5000 (do not open index.html directly).<br><small>Details: ' + esc(e && e.message || e) + '</small></p>'); });

// Light / dark theme toggle (choice is remembered in the browser)
(function () {
  const btn = $('#themeBtn'), label = $('#themeLabel');
  const current = () => root.getAttribute('data-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const sync = () => { const dark = current() === 'dark'; label.textContent = dark ? 'Light' : 'Dark'; btn.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode'); };
  btn.addEventListener('click', () => {
    const next = current() === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    try { localStorage.setItem('theme', next); } catch (e) {}
    sync();
  });
  sync();
})();

// ===== Reveal on scroll =====
// 'reveal' is removed afterwards so hover/tilt effects stay snappy; 'drawn' stays (timeline lines, heading underline)
const io = new IntersectionObserver((es) => es.forEach((e) => {
  if (!e.isIntersecting) return;
  e.target.classList.add('in', 'drawn'); io.unobserve(e.target);
  setTimeout(() => e.target.classList.remove('reveal', 'in'), 1900);
}), { threshold: .12, rootMargin: '0px 0px -40px 0px' });
function watch() {
  let i = 0;
  $$('.reveal:not(.w)').forEach((el) => { el.classList.add('w'); el.style.setProperty('--d', (i++ % 6) * 70 + 'ms'); io.observe(el); });
}
$$('.sec').forEach(split);
$$('.sec,.sub,.filters,.summary,.formbox,.contact-grid > form,.carousel').forEach((el) => el.classList.add('reveal'));
let wt; watch();
new MutationObserver(() => { clearTimeout(wt); wt = setTimeout(watch, 30); }).observe(document.body, { childList: true, subtree: true });

// ===== Scroll: progress bar, hide/show header, hero parallax, back-to-top =====
const nav = $('#nav'), bar = $('#progress'), toTop = $('#toTop'), hero = $('#hero') || document.body;
let ticking = false, lastY = scrollY;
function onScroll() {
  const y = scrollY, h = root.scrollHeight - innerHeight;
  bar.style.transform = `scaleX(${h > 0 ? y / h : 0})`;
  nav.classList.toggle('small', y > 40);
  if (Math.abs(y - lastY) > 6) { nav.classList.toggle('hide', y > lastY && y > 320); lastY = y; }
  toTop.hidden = y < 600;
  if (!reduce && y < hero.offsetHeight * 1.3) hero.style.setProperty('--sy', y);
  ticking = false;
}
addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(onScroll); } }, { passive: true });
toTop.addEventListener('click', () => scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' }));
onScroll();

// Section dots + header link highlight
const SECTIONS = [['hero', 'Home'], ['subjects', 'Plan'], ['tutors', 'Tutors'], ['feedback', 'Reviews'], ['contact', 'Contact']];
const dots = document.createElement('nav'); dots.className = 'dots'; dots.setAttribute('aria-label', 'Page sections');
dots.innerHTML = SECTIONS.map(([id, l]) => `<a href="#${id}" data-l="${l}" aria-label="${l}"></a>`).join('');
document.body.append(dots);
const links = $$('.nav nav a[href^="#"]');
const spy = new IntersectionObserver((es) => es.forEach((e) => {
  if (!e.isIntersecting) return;
  links.forEach((a) => a.toggleAttribute('aria-current', a.getAttribute('href') === '#' + e.target.id));
  $$('a', dots).forEach((a) => a.toggleAttribute('aria-current', a.getAttribute('href') === '#' + e.target.id));
}), { rootMargin: '-40% 0px -55% 0px' });
SECTIONS.forEach(([id]) => { const el = $('#' + id); if (el) spy.observe(el); });

// ===== Tickers: drift constantly, speed up while you scroll =====
const marquees = [];
function buildMarquee(el, items) {
  el.textContent = '';
  const set = document.createElement('div'); set.className = 'set';
  set.innerHTML = items.map((t) => `<span>${esc(t)}</span>`).join('');
  el.append(set);
  const w = set.offsetWidth || 1;
  for (let i = 1; i < Math.ceil(innerWidth / w) + 2; i++) el.append(set.cloneNode(true)); // always wider than the screen: no gaps
  let m = marquees.find((o) => o.el === el);
  if (!m) {
    m = { el, items, dir: el.dataset.dir === 'r' ? 1 : -1, x: 0, hover: false }; marquees.push(m);
    const p = el.parentElement; p.addEventListener('pointerenter', () => (m.hover = true)); p.addEventListener('pointerleave', () => (m.hover = false));
  }
  m.w = w; m.x = m.dir > 0 ? -w : 0;
  el.style.transform = `translate3d(${m.x}px,0,0)`;
}
(function () {
  let last = performance.now(), ly = scrollY, vel = 0;
  function tick(t) {
    const dt = Math.min(64, t - last); last = t;
    vel += (Math.abs(scrollY - ly) - vel) * .1; ly = scrollY;
    for (const m of marquees) {
      if (!m.w) continue;
      if (!m.hover) m.x += m.dir * (55 * dt / 1000 + vel * .35);
      if (m.x <= -m.w) m.x += m.w; if (m.x > 0) m.x -= m.w;
      m.el.style.transform = `translate3d(${m.x}px,0,0)`;
    }
    requestAnimationFrame(tick);
  }
  if (!reduce) requestAnimationFrame(tick);
  let rt; const redo = () => { clearTimeout(rt); rt = setTimeout(() => marquees.forEach((m) => buildMarquee(m.el, m.items)), 200); };
  addEventListener('resize', redo);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(redo);
})();

// Ticker strips + typing line (words come from data/site.json: "ticker" and "rotator")
function setupMotion(site) {
  const items = site.ticker || [], alt = site.rotator || items;
  const m1 = $('#marquee'); if (m1) { if (items.length) buildMarquee(m1, items); else m1.parentElement.hidden = true; }
  const m2 = $('#marquee2'); if (m2) { if (alt.length) buildMarquee(m2, alt); else m2.closest('.tilted').hidden = true; }
  const words = site.rotator || items, el = $('#typer');
  if (!words.length) return;
  if (reduce) { el.textContent = words[0]; return; }
  let w = 0, n = 0, del = false;
  (function step() {
    const word = words[w];
    el.textContent = word.slice(0, n);
    if (!del && n === word.length) { del = true; return setTimeout(step, 1400); }
    if (del && n === 0) { del = false; w = (w + 1) % words.length; }
    n += del ? -1 : 1;
    setTimeout(step, del ? 35 : 70);
  })();
}

// Live numbers in the hero (counted from real feedback in the database)
function renderStats(list) {
  const tiles = [['1-on-1', 'every single class', false]];
  if (list.length) {
    const avg = list.reduce((a, f) => a + f.ratings.overall, 0) / list.length;
    const rec = Math.round(100 * list.filter((f) => f.recommend === 'yes').length / list.length);
    tiles.push([list.length, 'student reviews', true], [avg.toFixed(1), 'average rating', true], [rec + '%', 'would recommend', true]);
  } else tiles.push(['Class 11-12', 'Computer Science', false], ['Up to 10', 'all subjects', false]);
  $('#liveStats').innerHTML = tiles.map(([v, l, n]) => `<div><b ${n ? 'data-count' : ''} data-to="${esc(v)}">${esc(v)}</b><span>${l}</span></div>`).join('');
  if (!reduce) $$('#liveStats b[data-count]').forEach((el) => {
    const m = el.dataset.to.match(/^(\d+(?:\.\d+)?)(.*)$/); if (!m) return;
    const end = parseFloat(m[1]), dec = m[1].includes('.') ? 1 : 0, t0 = performance.now();
    (function f(t) { const p = Math.min(1, (t - t0) / 1100); el.textContent = (end * (1 - Math.pow(1 - p, 3))).toFixed(dec) + m[2]; if (p < 1) requestAnimationFrame(f); })(t0);
  });
}

// ===== Pointer effects (mouse devices only): glow, hero parallax, card tilt, magnetic buttons =====
if (fine && !reduce) {
  const glow = document.createElement('div'); glow.className = 'glow'; document.body.append(glow);
  let gx = 0, gy = 0, tx = 0, ty = 0;
  addEventListener('pointermove', (e) => { tx = e.clientX; ty = e.clientY; glow.classList.add('on'); }, { passive: true });
  document.addEventListener('pointerleave', () => glow.classList.remove('on'));
  (function f() { gx += (tx - gx) * .14; gy += (ty - gy) * .14; glow.style.transform = `translate3d(${gx}px,${gy}px,0)`; requestAnimationFrame(f); })();

  hero.addEventListener('pointermove', (e) => { hero.style.setProperty('--px', (e.clientX / innerWidth - .5).toFixed(3)); hero.style.setProperty('--py', ((e.clientY - hero.getBoundingClientRect().top) / hero.offsetHeight - .5).toFixed(3)); }, { passive: true });

  let cur = null;
  const flat = (t) => { t.style.setProperty('--rx', '0deg'); t.style.setProperty('--ry', '0deg'); };
  document.addEventListener('pointermove', (e) => {
    const t = e.target.closest && e.target.closest('.tilt');
    if (cur && cur !== t) flat(cur);
    cur = t;
    if (!t || t.classList.contains('reveal')) return;
    const r = t.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    t.style.setProperty('--rx', ((.5 - y) * 7).toFixed(2) + 'deg'); t.style.setProperty('--ry', ((x - .5) * 9).toFixed(2) + 'deg');
    t.style.setProperty('--gx', (x * 100).toFixed(1) + '%'); t.style.setProperty('--gy', (y * 100).toFixed(1) + '%');
  }, { passive: true });

  document.addEventListener('pointermove', (e) => {
    const b = e.target.closest && e.target.closest('.cta .btn, .nav .btn');
    if (!b) return;
    const r = b.getBoundingClientRect();
    b.style.setProperty('--bx', (e.clientX - r.left - r.width / 2) * .18 + 'px'); b.style.setProperty('--by', (e.clientY - r.top - r.height / 2) * .25 + 'px');
    if (!b._m) { b._m = 1; b.addEventListener('pointerleave', () => { b.style.removeProperty('--bx'); b.style.removeProperty('--by'); }); }
  }, { passive: true });
}

// ===== Reviews carousel: arrows, dots, mouse drag, swipe, gentle auto-advance =====
(function () {
  const list = $('#fbList'), box = list.parentElement, prev = $('#fbPrev'), next = $('#fbNext');
  const dotsEl = document.createElement('div'); dotsEl.className = 'cdots'; box.after(dotsEl);
  let paused = false;
  const go = (d) => {
    const max = list.scrollWidth - list.clientWidth;
    if (d > 0 && list.scrollLeft >= max - 4) list.scrollTo({ left: 0, behavior: 'smooth' });
    else list.scrollBy({ left: d * list.clientWidth * .85, behavior: 'smooth' });
  };
  const kids = () => [...list.children].filter((k) => k.classList.contains('fb'));
  const mark = () => {
    const ks = kids(); if (!ks.length) return;
    let best = 0, bd = 1e9;
    ks.forEach((k, i) => { const d = Math.abs(k.offsetLeft - list.offsetLeft - list.scrollLeft); if (d < bd) { bd = d; best = i; } });
    [...dotsEl.children].forEach((b, i) => b.setAttribute('aria-current', i === best));
  };
  const build = () => {
    const ks = kids(), scrollable = list.scrollWidth > list.clientWidth + 4;
    prev.hidden = next.hidden = !scrollable; dotsEl.hidden = !scrollable || ks.length < 2;
    dotsEl.innerHTML = ks.map((_, i) => `<button type="button" aria-label="Review ${i + 1}"></button>`).join('');
    [...dotsEl.children].forEach((b, i) => b.addEventListener('click', () => list.scrollTo({ left: ks[i].offsetLeft - list.offsetLeft - 4, behavior: 'smooth' })));
    mark();
  };
  let bt; const rebuild = () => { cancelAnimationFrame(bt); bt = requestAnimationFrame(build); };
  new MutationObserver(rebuild).observe(list, { childList: true }); addEventListener('resize', rebuild);
  let st; list.addEventListener('scroll', () => { cancelAnimationFrame(st); st = requestAnimationFrame(mark); }, { passive: true });
  prev.addEventListener('click', () => go(-1)); next.addEventListener('click', () => go(1));

  let down = false, sx = 0, sl = 0;
  list.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse') return; down = true; sx = e.clientX; sl = list.scrollLeft; });
  addEventListener('pointermove', (e) => { if (!down) return; const dx = e.clientX - sx; if (Math.abs(dx) > 3) list.classList.add('dragging'); list.scrollLeft = sl - dx; });
  addEventListener('pointerup', () => { down = false; list.classList.remove('dragging'); });

  ['mouseenter', 'focusin', 'touchstart'].forEach((e) => box.addEventListener(e, () => (paused = true), { passive: true }));
  ['mouseleave', 'focusout'].forEach((e) => box.addEventListener(e, () => (paused = false)));
  if (!reduce) setInterval(() => { if (!paused && !document.hidden && list.children.length > 1 && list.scrollWidth > list.clientWidth + 4) go(1); }, 5000);
})();