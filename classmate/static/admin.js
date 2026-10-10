const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const stars = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);
const when = (iso) => new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

async function api(url, method = 'GET', body) {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json', 'X-Admin': '1' }, body: body ? JSON.stringify(body) : undefined });
  if (r.status === 401) { location.href = '/admin/login'; throw new Error('login'); }
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Request failed');
  return r.json();
}

const S = { tab: 'enq', enq: [], fb: [], sum: null, last: null };

function render() {
  const sum = S.sum || {};
  $('#stats').innerHTML = [
    ['New enquiries', sum.new_enquiries, sum.new_enquiries > 0], ['Total enquiries', sum.total_enquiries],
    ['New feedback', sum.new_feedback, sum.new_feedback > 0], ['Total feedback', sum.total_feedback]
  ].map(([l, v, hot]) => `<div class="stat ${hot ? 'hot' : ''}"><b>${v ?? 0}</b><span>${l}</span></div>`).join('');
  [['#bEnq', sum.new_enquiries], ['#bFb', sum.new_feedback]].forEach(([id, n]) => { $(id).hidden = !n; $(id).textContent = n; });
  document.title = (((sum.new_enquiries || 0) + (sum.new_feedback || 0)) ? `(${(sum.new_enquiries || 0) + (sum.new_feedback || 0)}) ` : '') + 'Admin | classmate';
  document.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-selected', b.dataset.tab === S.tab));
  $('#markAll').textContent = S.tab === 'enq' ? 'Mark all as read' : 'Mark all as seen';

  const onlyNew = $('#onlyNew').checked;
  if (S.tab === 'enq') {
    const rows = S.enq.filter((e) => !onlyNew || !e.is_read);
    $('#list').innerHTML = rows.map((e) => {
      const link = e.contact.includes('@') ? `mailto:${encodeURIComponent(e.contact)}` : `tel:${encodeURIComponent(e.contact.replace(/\s/g, ''))}`;
      return `<article class="item ${e.is_read ? '' : 'new'}">
        <div class="top"><h3>${esc(e.name)}${e.is_read ? '' : '<span class="chip new">New</span>'}</h3><time>${when(e.created_at)}</time></div>
        <p class="meta">Contact: <a href="${link}">${esc(e.contact)}</a>${e.grade ? ' · Class: ' + esc(e.grade) : ''}${e.subject ? ' · ' + esc(e.subject) : ''}</p>
        ${e.message ? `<p>${esc(e.message)}</p>` : ''}
        <div class="acts"><button data-act="enq-read" data-id="${e.id}" data-v="${e.is_read ? 0 : 1}">${e.is_read ? 'Mark as unread' : 'Mark as read'}</button>
        <button class="del" data-act="enq-del" data-id="${e.id}">Delete</button></div></article>`; }).join('') || '<p class="empty">No enquiries to show.</p>';
  } else {
    const rows = S.fb.filter((f) => !onlyNew || !f.is_seen);
    $('#list').innerHTML = rows.map((f) => `
      <article class="item ${f.is_seen ? '' : 'new'}">
        <div class="top"><h3>${esc(f.name)}${f.is_seen ? '' : '<span class="chip new">New</span>'}<span class="chip ${f.approved ? 'live' : 'hid'}">${f.approved ? 'Live on site' : 'Hidden'}</span></h3><time>${when(f.created_at)}</time></div>
        <p class="meta">${esc(f.grade)} · ${esc(f.subject)} · Tutor: ${esc(f.tutor)}${f.duration ? ' · ' + esc(f.duration) : ''}${f.email ? ' · <a href="mailto:' + encodeURIComponent(f.email) + '">' + esc(f.email) + '</a>' : ''}</p>
        <p><span class="stars">${stars(f.r_overall)}</span> overall${f.marks_before && f.marks_after ? ' · Marks ' + esc(f.marks_before) + ' → ' + esc(f.marks_after) : ''} · Recommends: ${f.recommend}${f.show_name ? '' : ' · name hidden publicly'}</p>
        <div class="rates"><span>Clarity ${f.r_clarity}/5</span><span>Personalised ${f.r_personalisation}/5</span><span>Doubts ${f.r_doubts}/5</span><span>Assignments and exams ${f.r_assessments}/5</span></div>
        <p>${esc(f.message)}</p>
        ${f.liked ? `<p class="meta">Liked most: ${esc(f.liked)}</p>` : ''}${f.improve ? `<p class="meta">Could improve: ${esc(f.improve)}</p>` : ''}
        <div class="acts"><button data-act="fb-approve" data-id="${f.id}" data-v="${f.approved ? 0 : 1}">${f.approved ? 'Hide from website' : 'Publish on website'}</button>
        <button data-act="fb-seen" data-id="${f.id}" data-v="${f.is_seen ? 0 : 1}">${f.is_seen ? 'Mark as new' : 'Mark as seen'}</button>
        <button class="del" data-act="fb-del" data-id="${f.id}">Delete</button></div></article>`).join('') || '<p class="empty">No feedback to show.</p>';
  }
}

async function loadAll() {
  [S.sum, S.enq, S.fb] = await Promise.all([api('/admin/api/summary'), api('/admin/api/enquiries'), api('/admin/api/feedback')]);
  S.last = { e: S.sum.new_enquiries, f: S.sum.new_feedback };
  render();
}

// ---- notifications: check for new items every 20 seconds ----
function beep() {
  try { const c = new (window.AudioContext || window.webkitAudioContext)(), o = c.createOscillator(), g = c.createGain();
    o.connect(g); g.connect(c.destination); o.frequency.value = 880; g.gain.setValueAtTime(.15, c.currentTime); g.gain.exponentialRampToValueAtTime(.001, c.currentTime + .5);
    o.start(); o.stop(c.currentTime + .5); } catch (e) {}
}
function toast(text) { const t = $('#toast'); t.textContent = text; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 6000); }

async function poll() {
  try {
    const sum = await api('/admin/api/summary');
    const newE = sum.new_enquiries > S.last.e, newF = sum.new_feedback > S.last.f;
    if (newE || newF) {
      const text = newE ? 'New enquiry received' : 'New student feedback received';
      toast(text); beep();
      if ('Notification' in window && Notification.permission === 'granted') new Notification('Classmate admin', { body: text });
      S.sum = sum; [S.enq, S.fb] = await Promise.all([api('/admin/api/enquiries'), api('/admin/api/feedback')]);
    } else S.sum = sum;
    S.last = { e: sum.new_enquiries, f: sum.new_feedback };
    render();
  } catch (e) {}
}

// ---- actions ----
$('#list').addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-act]'); if (!b) return;
  const id = b.dataset.id, v = b.dataset.v === '1';
  try {
    if (b.dataset.act === 'enq-read') await api(`/admin/api/enquiries/${id}/read`, 'POST', { value: v });
    if (b.dataset.act === 'fb-approve') await api(`/admin/api/feedback/${id}/approve`, 'POST', { value: v });
    if (b.dataset.act === 'fb-seen') await api(`/admin/api/feedback/${id}/seen`, 'POST', { value: v });
    if (b.dataset.act === 'enq-del') { if (!confirm('Delete this enquiry permanently?')) return; await api(`/admin/api/enquiries/${id}`, 'DELETE'); }
    if (b.dataset.act === 'fb-del') { if (!confirm('Delete this feedback permanently? It will also disappear from Past work.')) return; await api(`/admin/api/feedback/${id}`, 'DELETE'); }
    await loadAll();
  } catch (err) { toast(err.message); }
});
document.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { S.tab = b.dataset.tab; render(); }));
$('#onlyNew').addEventListener('change', render);
$('#markAll').addEventListener('click', async () => {
  await api(S.tab === 'enq' ? '/admin/api/enquiries/read-all' : '/admin/api/feedback/seen-all', 'POST', {}); loadAll();
});
$('#alertBtn').addEventListener('click', async () => {
  if (!('Notification' in window)) return toast('This browser does not support notifications.');
  const p = await Notification.requestPermission();
  $('#alertBtn').textContent = p === 'granted' ? 'Alerts on' : 'Alerts blocked';
  beep();
});
if ('Notification' in window && Notification.permission === 'granted') $('#alertBtn').textContent = 'Alerts on';

loadAll(); setInterval(poll, 20000);
