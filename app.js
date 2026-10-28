'use strict';
/* Pull — app.js. Plain JS, hash routing, Supabase backend. */
const CFG = window.PULL_CONFIG || {};
const ROLES = [['artist','Recording artist'],['musician','Musician'],['producer','Producer'],['engineer','Engineer'],['md','Musical director']];
const ROLE_SHORT = {artist:'Artist', musician:'Musician', producer:'Producer', engineer:'Engineer', md:'MD'};
const BOARD_FILTERS = [['', 'All'],['artist','Artists'],['musician','Musicians'],['producer','Producers'],['engineer','Engineers'],['md','MDs']];
const WORK_TYPES = ['Snippet','Demo','Session','Live','Mix'];
const MAKE_TYPES = ['Session','Track','Reel','Gig','Show'];
const MAX_BYTES = 10 * 1024 * 1024;

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
const app = $('#app');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

let sb = null, session = null, me = null;
const profiles = new Map();   // id -> profile
const works = new Map();      // id -> work

/* ---------- icons (line icons, no emoji) ---------- */
const I = {
  board:'<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  feed:'<path d="M13 2 3 14h8l-1 8 10-12h-8l1-8z"/>',
  asks:'<path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z"/>',
  you:'<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  calls:'<path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1z"/><path d="M15 9a4 4 0 0 1 0 6M18 6a8 8 0 0 1 0 12"/>',
  play:'<path d="M7 4.5v15l12-7.5z" fill="currentColor" stroke="none"/>',
  pause:'<path d="M7 4h4v16H7zM13 4h4v16h-4z" fill="currentColor" stroke="none"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  link:'<path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>',
  back:'<path d="M19 12H5M12 19l-7-7 7-7"/>',
  up:'<path d="M12 19V5M5 12l7-7 7 7"/>',
  x:'<path d="M18 6 6 18M6 6l12 12"/>',
  search:'<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  check:'<path d="M20 6 9 17l-5-5"/>',
  trash:'<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
  eye:'<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/>',
  users:'<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  edit:'<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  out:'<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  music:'<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  camera:'<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
};
const icon = (n, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I[n]}</svg>`;

/* ---------- helpers ---------- */
const initials = n => ((n || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase()) || '?';
function avatar(p, size = 'md') {
  if (!p) return `<span class="av av-${size}">?</span>`;
  if (p.avatar_url) return `<span class="av av-${size}"><img src="${esc(p.avatar_url)}" alt=""></span>`;
  return `<span class="av av-${size}" style="background:${esc(p.color || '#FF6A2B')}">${esc(initials(p.name || p.email))}</span>`;
}
const roleLabel = roles => (roles || []).map(r => ROLE_SHORT[r] || r).join(' · ');
const dispName = p => (p && p.name) ? p.name : (p && p.email ? p.email.split('@')[0] : 'Someone');
function timeAgo(d) {
  if (!d) return '';
  const s = (Date.now() - new Date(d).getTime()) / 1000;
  if (s < 60) return 'now';
  if (s < 3600) return Math.floor(s / 60) + 'm';
  if (s < 86400) return Math.floor(s / 3600) + 'h';
  return Math.floor(s / 86400) + 'd';
}
const fmtDur = s => { s = Math.round(s || 0); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const publicUrl = (bucket, path) => sb.storage.from(bucket).getPublicUrl(path).data.publicUrl;
function toast(msg, ms = 2600) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), ms); }
function fail(e) { console.error(e); toast(niceError(e)); }
function niceError(e) {
  const m = (e && (e.message || e.error_description || e.msg)) || String(e);
  if (/Database error saving new user/i.test(m)) return 'Only @berklee.edu emails can join Pull.';
  if (/already registered/i.test(m)) return 'That email already has an account. Sign in.';
  if (/Invalid login credentials/i.test(m)) return 'Wrong email or password.';
  if (/exceeded the maximum allowed size|Payload too large|too large/i.test(m)) return 'File is bigger than 10 MB.';
  return m.replace(/^.*?exception:\s*/i, '');
}
const route = () => { const h = location.hash.slice(1) || 'board'; const [path, qs] = h.split('?'); return { path, parts: path.split('/'), q: new URLSearchParams(qs || '') }; };
const go = h => { if (location.hash === '#' + h) render(); else location.hash = h; };

async function loadProfiles(ids) {
  const need = [...new Set(ids.filter(Boolean))].filter(id => !profiles.has(id));
  if (need.length) {
    const { data, error } = await sb.from('profiles').select('*').in('id', need);
    if (error) throw error;
    (data || []).forEach(p => profiles.set(p.id, p));
  }
}
async function loadWorks(ids) {
  const need = [...new Set(ids.filter(Boolean))].filter(id => !works.has(id));
  if (need.length) {
    const { data, error } = await sb.from('works').select('*').in('id', need);
    if (error) throw error;
    (data || []).forEach(w => works.set(w.id, w));
  }
}
async function myLimits() { const { data, error } = await sb.rpc('my_limits'); if (error) throw error; return data; }

/* ---------- sheet & toast ---------- */
function openSheet(html) {
  const root = $('#sheet-root');
  root.innerHTML = `<div class="scrim"><div class="sheet" role="dialog"><div class="grab"></div>${html}</div></div>`;
  const scrim = $('.scrim', root);
  scrim.addEventListener('click', e => { if (e.target === scrim) closeSheet(); });
  return $('.sheet', root);
}
function closeSheet() { $('#sheet-root').innerHTML = ''; }

/* ---------- audio player (one shared element) ---------- */
const audio = new Audio();
audio.preload = 'none';
let currentWork = null;
function playerHTML(w, inset = false) {
  if (!w) return '';
  const playing = currentWork === w.id && !audio.paused;
  return `<div class="player ${inset ? 'inset' : ''} ${playing ? 'playing' : ''}" data-work="${w.id}" data-src="${esc(publicUrl('work', w.path))}" oncontextmenu="return false">
    <button class="pbtn" aria-label="Play">${icon(playing ? 'pause' : 'play')}</button>
    <div class="pmeta"><div class="ptitle ellip">${esc(w.title)}</div><div class="psub">${esc(w.type)}${w.duration ? ' · ' + fmtDur(w.duration) : ''}${w._by ? ' · ' + esc(w._by) : ''}</div><div class="pbar"><div class="pfill" style="width:${playing && audio.duration ? (audio.currentTime / audio.duration * 100) : 0}%"></div></div></div>
    <div class="ptime">${playing ? fmtDur(audio.currentTime) : ''}</div></div>`;
}
function syncPlayers() {
  $$('.player').forEach(el => {
    const on = el.dataset.work === currentWork && !audio.paused;
    el.classList.toggle('playing', on);
    $('.pbtn', el).innerHTML = icon(on ? 'pause' : 'play');
    if (el.dataset.work !== currentWork) { $('.pfill', el).style.width = '0%'; $('.ptime', el).textContent = ''; }
  });
}
audio.addEventListener('timeupdate', () => {
  $$(`.player[data-work="${currentWork}"]`).forEach(el => {
    if (audio.duration) $('.pfill', el).style.width = (audio.currentTime / audio.duration * 100) + '%';
    $('.ptime', el).textContent = fmtDur(audio.currentTime);
  });
});
audio.addEventListener('ended', () => { syncPlayers(); });
audio.addEventListener('pause', syncPlayers);
audio.addEventListener('play', syncPlayers);
document.addEventListener('click', e => {
  const btn = e.target.closest('.player .pbtn');
  const bar = e.target.closest('.player .pbar');
  if (btn) {
    const el = btn.closest('.player');
    if (currentWork === el.dataset.work) { audio.paused ? audio.play().catch(fail) : audio.pause(); }
    else { currentWork = el.dataset.work; audio.src = el.dataset.src; audio.play().catch(fail); }
    syncPlayers();
  } else if (bar) {
    const el = bar.closest('.player');
    if (currentWork === el.dataset.work && audio.duration) {
      const r = bar.getBoundingClientRect(); audio.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * audio.duration;
    }
  }
});

/* ---------- shell ---------- */
function tabbar(active) {
  const tabs = [['board','Board','board'],['feed','Feed','feed'],['asks','Asks','asks'],['calls','Calls','calls'],['you','You','you']];
  return `<nav class="tabbar">${tabs.map(([r, l, ic]) => `<a class="tab ${active === r ? 'active' : ''}" href="#${r}">${icon(ic)}<span>${l}</span></a>`).join('')}</nav>`;
}
function shell({ title, back, right = '', body, tab }) {
  app.innerHTML = `<header class="top"><div class="top-inner">${back ? `<a class="iconbtn" href="#${back}" aria-label="Back">${icon('back')}</a>` : ''}<h1>${title}</h1>${right}</div></header><main class="page">${body}</main>${tabbar(tab)}`;
}
const skel = 'Loading…';

/* ---------- auth ---------- */
function renderAuth(mode = 'in') {
  app.innerHTML = `<main class="auth">
    <div class="brand"><div class="logo">Pull</div><p class="tag">Berklee's network for people who make records. Your rank comes from who chooses you.</p></div>
    <form id="authf" class="card form" novalidate>
      ${mode === 'up' ? `<label>Name<input name="name" required autocomplete="name" placeholder="Your name"></label>` : ''}
      <label>Berklee email<input name="email" type="email" required autocomplete="email" inputmode="email" autocapitalize="off" placeholder="you@berklee.edu"></label>
      <label>Password<input name="password" type="password" required minlength="6" autocomplete="${mode === 'up' ? 'new-password' : 'current-password'}" placeholder="${mode === 'up' ? 'At least 6 characters' : 'Password'}"></label>
      <p class="err" id="autherr"></p>
      <button class="btn primary" type="submit">${mode === 'up' ? 'Join Pull' : 'Sign in'}</button>
      <button class="btn ghost" type="button" id="switch">${mode === 'up' ? 'Already in? Sign in' : 'New here? Join with your @berklee.edu email'}</button>
    </form>
    <p class="small muted" style="margin-top:18px">5 asks a week. 3 accepts. Only confirmed collabs count. Passes are private.</p>
  </main>`;
  $('#switch').onclick = () => renderAuth(mode === 'up' ? 'in' : 'up');
  $('#authf').onsubmit = async e => {
    e.preventDefault();
    const f = e.target, err = $('#autherr'); err.textContent = '';
    const email = f.email.value.trim().toLowerCase(), password = f.password.value;
    if (!/^[^@\s]+@berklee\.edu$/.test(email)) { err.textContent = 'Only @berklee.edu emails can join Pull.'; return; }
    if (password.length < 6) { err.textContent = 'Password needs at least 6 characters.'; return; }
    const btn = $('button[type=submit]', f); btn.disabled = true;
    try {
      if (mode === 'up') {
        const name = f.name.value.trim(); if (!name) { err.textContent = 'Tell us your name.'; btn.disabled = false; return; }
        const { data, error } = await sb.auth.signUp({ email, password, options: { data: { name } } });
        if (error) throw error;
        if (!data.session) { err.textContent = 'Check your Berklee inbox to confirm, then sign in.'; btn.disabled = false; return; }
        sessionStorage.setItem('pull_onboard', '1');
      } else {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (ex) { err.textContent = niceError(ex); btn.disabled = false; }
  };
}

/* ---------- Board ---------- */
let boardMode = 'week', boardRole = '';
async function renderBoard() {
  shell({ title: 'Board', tab: 'board', right: `<a class="iconbtn" href="#members" aria-label="Members">${icon('users')}</a>`, body: `<div class="skel">${skel}</div>` });
  try {
    const [{ data: rows, error }, lim] = await Promise.all([sb.from('board').select('*'), myLimits()]);
    if (error) throw error;
    rows.forEach(r => { if (!profiles.has(r.id)) profiles.set(r.id, { ...r, email: '' }); });
    const mine = rows.find(r => r.id === me.id) || {};
    const key = boardMode === 'week' ? 'pull_week' : 'pull_all', rkey = boardMode === 'week' ? 'rank_week' : 'rank_all';
    let list = rows.filter(r => r[key] > 0).sort((a, b) => a[rkey] - b[rkey]);
    if (boardRole) list = list.filter(r => (r.roles || []).includes(boardRole));
    const myRank = mine[rkey];
    const body = `
      <div class="card me-card">
        <div class="row">${avatar(me, 'md')}<div class="grow"><div class="name ellip">${esc(dispName(me))}</div><div class="small muted">${myRank ? `#${myRank} ${boardMode === 'week' ? 'this week' : 'all time'}` : (boardMode === 'week' ? 'Not on the Board yet this week' : 'Unranked')}</div></div>
          <div class="pull">${mine[key] || 0}<small>Pull</small></div></div>
        <div class="limits">
          <div><div class="num ${lim.asks_left ? '' : 'zero'}">${lim.asks_left}</div><div class="small muted">asks left</div></div>
          <div><div class="num ${lim.accepts_left ? '' : 'zero'}">${lim.accepts_left}</div><div class="small muted">accepts left</div></div>
          <div><div class="num">${mine.asks_received_week || 0}</div><div class="small muted">asked you</div></div>
        </div>
      </div>
      <div class="seg"><button data-m="week" class="${boardMode === 'week' ? 'on' : ''}">This week</button><button data-m="all" class="${boardMode === 'all' ? 'on' : ''}">All time</button></div>
      <div class="chips">${BOARD_FILTERS.map(([v, l]) => `<button class="chip ${boardRole === v ? 'on' : ''}" data-r="${v}">${l}</button>`).join('')}</div>
      <div class="list" style="margin-top:10px">
        ${list.length ? list.map(r => `<a class="card tight row" href="#u/${r.id}">
            <div class="rank ${r[rkey] <= 3 ? 'up' : ''}">${r[rkey]}</div>${avatar(r, 'md')}
            <div class="grow"><div class="name ellip">${esc(dispName(r))}</div><div class="small muted ellip">${esc(roleLabel(r.roles))}${r.specialty ? ' · ' + esc(r.specialty) : ''}</div>
              <div class="desire">${icon('asks')}<span>${r.asks_received_week} asked this week · ${r.accepts_left} accept${r.accepts_left === 1 ? '' : 's'} left</span></div></div>
            <div class="pull">${r[key]}<small>Pull</small></div></a>`).join('')
        : `<div class="empty"><b>${boardMode === 'week' ? "Nobody's been chosen yet this week." : 'No confirmed collabs yet.'}</b>${boardMode === 'week' ? 'Be first.' : 'Ask someone to work with you.'}<div style="margin-top:14px"><a class="btn sm primary" href="#members">Browse members</a></div></div>`}
      </div>`;
    $('.page').innerHTML = body;
    $$('.page .seg button').forEach(b => b.onclick = () => { boardMode = b.dataset.m; renderBoard(); });
    $$('.page .chip').forEach(b => b.onclick = () => { boardRole = b.dataset.r; renderBoard(); });
  } catch (e) { $('.page').innerHTML = `<div class="empty">${esc(niceError(e))}</div>`; }
}

/* ---------- Members ---------- */
async function renderMembers() {
  shell({ title: 'Members', back: 'board', tab: 'board', body: `<div class="skel">${skel}</div>` });
  try {
    const { data, error } = await sb.from('board').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    data.forEach(r => { if (!profiles.has(r.id)) profiles.set(r.id, { ...r, email: '' }); });
    let q = '', role = '';
    const draw = () => {
      const list = data.filter(r => r.id !== me.id || true).filter(r => (!role || (r.roles || []).includes(role)) && (!q || (r.name + ' ' + r.specialty + ' ' + roleLabel(r.roles)).toLowerCase().includes(q)));
      $('#mlist').innerHTML = list.length ? list.map(r => `<a class="card tight row" href="#u/${r.id}">${avatar(r, 'md')}
        <div class="grow"><div class="name ellip">${esc(dispName(r))}${r.id === me.id ? ' <span class="pill">you</span>' : ''}</div><div class="small muted ellip">${esc(roleLabel(r.roles)) || 'New member'}${r.specialty ? ' · ' + esc(r.specialty) : ''}</div>
        <div class="desire">${icon('asks')}<span>${r.asks_received_week} asked this week</span></div></div><div class="pull">${r.pull_all}<small>Pull</small></div></a>`).join('')
        : `<div class="empty"><b>No one matches.</b>Try another role or name.</div>`;
    };
    $('.page').innerHTML = `<div class="search">${icon('search')}<input id="q" placeholder="Search name, instrument, role" autocomplete="off"></div>
      <div class="chips">${BOARD_FILTERS.map(([v, l]) => `<button class="chip ${role === v ? 'on' : ''}" data-r="${v}">${l}</button>`).join('')}</div>
      <p class="small muted" style="margin:6px 0 10px">${data.length} member${data.length === 1 ? '' : 's'} on Pull</p><div class="list" id="mlist"></div>`;
    draw();
    $('#q').oninput = e => { q = e.target.value.trim().toLowerCase(); draw(); };
    $$('.page .chip').forEach(b => b.onclick = () => { role = b.dataset.r; $$('.page .chip').forEach(c => c.classList.toggle('on', c === b)); draw(); });
  } catch (e) { $('.page').innerHTML = `<div class="empty">${esc(niceError(e))}</div>`; }
}

/* ---------- Profile ---------- */
async function renderProfile(id, isYou = false) {
  const tab = isYou ? 'you' : 'board';
  shell({ title: isYou ? 'You' : 'Profile', back: isYou ? null : 'board', tab, body: `<div class="skel">${skel}</div>`,
    right: isYou ? `<button class="iconbtn" id="editp" aria-label="Edit profile">${icon('edit')}</button><button class="iconbtn" id="signout" aria-label="Sign out">${icon('out')}</button>` : '' });
  try {
    const [{ data: p, error: e1 }, { data: st }, { data: ws }, { data: acc }, { data: cl }] = await Promise.all([
      sb.from('profiles').select('*').eq('id', id).single(),
      sb.from('board').select('*').eq('id', id).single(),
      sb.from('works').select('*').eq('user_id', id).order('created_at', { ascending: false }),
      sb.from('asks').select('from_id,to_id,decided_at').eq('status', 'accepted').or(`from_id.eq.${id},to_id.eq.${id}`).order('decided_at', { ascending: false }),
      sb.from('collabs').select('*').eq('status', 'confirmed').or(`a_id.eq.${id},b_id.eq.${id}`).order('confirmed_at', { ascending: false }),
    ]);
    if (e1) throw e1;
    profiles.set(p.id, p);
    (ws || []).forEach(w => works.set(w.id, w));
    const chosenBy = [...new Set((acc || []).map(a => a.from_id === id ? a.to_id : a.from_id))];
    await loadProfiles([...chosenBy, ...(cl || []).flatMap(c => [c.a_id, c.b_id])]);
    await loadWorks((cl || []).map(c => c.work_id));
    const s = st || {};
    const links = [['spotify','Spotify'],['soundcloud','SoundCloud'],['instagram','Instagram'],['tiktok','TikTok']].filter(([k]) => p[k]).map(([k, l]) => { let u = p[k].trim(); if (!/^https?:\/\//i.test(u)) u = (k === 'instagram' ? 'https://instagram.com/' : k === 'tiktok' ? 'https://tiktok.com/@' : 'https://') + u.replace(/^@/, ''); return `<a href="${esc(u)}" target="_blank" rel="noopener">${icon('link')}${l}</a>`; }).join('');
    const lim = isYou ? await myLimits() : null;
    const body = `
      <div class="phead">${avatar(p, 'lg')}<div class="grow"><h2>${esc(dispName(p))}</h2><div class="muted">${esc(roleLabel(p.roles)) || 'New member'}${p.specialty ? ' · ' + esc(p.specialty) : ''}${p.semester ? ' · ' + esc(p.semester) : ''}</div></div></div>
      <div class="stats">
        <div class="stat"><div class="num ${s.rank_week ? 'accent' : ''}">${s.rank_week ? '#' + s.rank_week : '—'}</div><small>Rank this week</small></div>
        <div class="stat"><div class="num">${s.pull_all || 0}</div><small>Pull</small></div>
        <div class="stat"><div class="num ${s.asks_received_week ? 'accent' : ''}">${s.asks_received_week || 0}</div><small>Asked this week</small></div>
      </div>
      ${isYou ? `<div class="card tight row" style="margin-bottom:12px"><div class="grow small"><b>${lim.asks_left}</b> asks left · <b>${lim.accepts_left}</b> accepts left this week</div><span class="pill">resets Monday</span></div>`
        : `<button class="btn primary" id="askbtn" ${s.accepts_left === 0 ? 'disabled' : ''}>${icon('asks')} ${s.accepts_left === 0 ? dispName(p) + ' is full this week' : 'Ask to work with ' + esc(dispName(p))}</button>
           <p class="small muted" style="text-align:center;margin:8px 0 4px">${s.accepts_left} accept${s.accepts_left === 1 ? '' : 's'} left this week · ${s.asks_received_week} asked already</p>`}
      ${(p.what_i_do || p.what_i_want) ? `<div class="card bio" style="margin-top:12px">${p.what_i_do ? `<p><span class="k">What I do</span>${esc(p.what_i_do)}</p>` : ''}${p.what_i_want ? `<p style="margin:0"><span class="k">What I want to make</span>${esc(p.what_i_want)}</p>` : ''}</div>` : (isYou ? `<div class="empty" style="margin-top:12px"><b>Say what you make.</b>Add your lines so people know what to ask you for.<div style="margin-top:12px"><button class="btn sm primary" id="editp2">Edit profile</button></div></div>` : '')}
      ${links ? `<div class="links">${links}</div>` : ''}
      <div class="section"><h2>Chosen by</h2><span class="small muted">${chosenBy.length}</span></div>
      ${chosenBy.length ? `<div class="avstack">${chosenBy.slice(0, 12).map(cid => `<a href="#u/${cid}" title="${esc(dispName(profiles.get(cid)))}">${avatar(profiles.get(cid), 'md')}</a>`).join('')}</div>` : `<p class="small muted">${isYou ? 'Nobody yet. Ask someone, or get asked.' : 'Nobody yet. Be the first to work with ' + esc(dispName(p)) + '.'}</p>`}
      <div class="section"><h2>Work</h2>${isYou ? `<button class="btn sm primary" id="postw">${icon('plus')} Post work</button>` : ''}</div>
      <div class="list" id="worklist">${(ws || []).length ? ws.map(w => `<div class="work-row">${playerHTML(w)}${isYou ? `<button class="btn ghost sm del" data-del="${w.id}" style="margin:2px 0 0 auto;display:flex">${icon('trash')} Remove</button>` : ''}</div>`).join('') : `<div class="empty"><b>No work posted yet.</b>${isYou ? 'Post a snippet so people can hear you before they ask.' : 'Nothing to hear yet.'}</div>`}</div>
      <div class="section"><h2>Confirmed collabs</h2><span class="small muted">${(cl || []).length}</span></div>
      <div class="list">${(cl || []).length ? cl.map(c => { const other = profiles.get(c.a_id === id ? c.b_id : c.a_id); const w = works.get(c.work_id); return `<div class="card tight"><div class="row"><a href="#u/${other?.id}">${avatar(other, 'sm')}</a><div class="grow small"><b>${esc(c.make_type)}</b> with <a href="#u/${other?.id}"><b>${esc(dispName(other))}</b></a></div><span class="small muted">${timeAgo(c.confirmed_at)}</span></div>${w ? `<div style="margin-top:8px">${playerHTML(w, true)}</div>` : ''}</div>`; }).join('') : `<p class="small muted">None yet. A collab counts once both people confirm it.</p>`}</div>`;
    $('.page').innerHTML = body;
    if (isYou) {
      $('#editp').onclick = () => editProfileSheet();
      if ($('#editp2')) $('#editp2').onclick = () => editProfileSheet();
      $('#signout').onclick = async () => { await sb.auth.signOut(); };
      $('#postw').onclick = () => postWorkSheet(() => renderProfile(id, true));
      $$('[data-del]').forEach(b => b.onclick = async () => {
        if (!confirm('Remove this work?')) return;
        const w = works.get(b.dataset.del);
        try { const { error } = await sb.from('works').delete().eq('id', w.id); if (error) throw error; await sb.storage.from('work').remove([w.path]); if (currentWork === w.id) audio.pause(); toast('Removed'); renderProfile(id, true); } catch (e) { fail(e); }
      });
    } else if ($('#askbtn')) {
      $('#askbtn').onclick = () => askSheet(p, s);
    }
  } catch (e) { $('.page').innerHTML = `<div class="empty">${esc(niceError(e))}</div>`; }
}

/* ---------- Edit profile ---------- */
function editProfileSheet(onboarding = false) {
  const p = me;
  const sheet = openSheet(`<h2>${onboarding ? 'Set up your profile' : 'Edit profile'}</h2>
    <form class="form" id="pf">
      <div class="row" style="margin-bottom:14px"><span id="avprev">${avatar(p, 'lg')}</span><label class="btn sm outline" style="width:auto;margin:0;cursor:pointer">${icon('camera')} Photo<input type="file" id="avfile" accept="image/*" style="display:none"></label></div>
      <label>Name<input name="name" value="${esc(p.name)}" required placeholder="Your name"></label>
      <label>Role (pick one or more)</label>
      <div class="chips" id="rolechips" style="margin-bottom:12px">${ROLES.map(([v, l]) => `<button type="button" class="chip ${(p.roles || []).includes(v) ? 'on' : ''}" data-v="${v}">${l}</button>`).join('')}</div>
      <label>Instrument or specialty<input name="specialty" value="${esc(p.specialty)}" placeholder="Vocals, bass, mixing, Ableton…"></label>
      <label>Semester<input name="semester" value="${esc(p.semester)}" placeholder="e.g. 5th"></label>
      <label>What I do<input name="what_i_do" value="${esc(p.what_i_do)}" maxlength="120" placeholder="One line"></label>
      <label>What I want to make<input name="what_i_want" value="${esc(p.what_i_want)}" maxlength="120" placeholder="One line"></label>
      <label>Spotify<input name="spotify" value="${esc(p.spotify)}" placeholder="Link" inputmode="url" autocapitalize="off"></label>
      <label>SoundCloud<input name="soundcloud" value="${esc(p.soundcloud)}" placeholder="Link" inputmode="url" autocapitalize="off"></label>
      <label>Instagram<input name="instagram" value="${esc(p.instagram)}" placeholder="@handle" autocapitalize="off"></label>
      <label>TikTok<input name="tiktok" value="${esc(p.tiktok)}" placeholder="@handle" autocapitalize="off"></label>
      <p class="err" id="pferr"></p>
      <button class="btn primary" type="submit">Save</button>
    </form>`);
  let avatarFile = null;
  $$('#rolechips .chip', sheet).forEach(c => c.onclick = () => c.classList.toggle('on'));
  $('#avfile', sheet).onchange = e => { avatarFile = e.target.files[0]; if (avatarFile) $('#avprev', sheet).innerHTML = `<span class="av av-lg"><img src="${URL.createObjectURL(avatarFile)}" alt=""></span>`; };
  $('#pf', sheet).onsubmit = async e => {
    e.preventDefault();
    const f = e.target, err = $('#pferr', sheet); err.textContent = '';
    const roles = $$('#rolechips .chip.on', sheet).map(c => c.dataset.v);
    if (!f.name.value.trim()) { err.textContent = 'Name is required.'; return; }
    if (!roles.length) { err.textContent = 'Pick at least one role.'; return; }
    const btn = $('button[type=submit]', f); btn.disabled = true; btn.textContent = 'Saving…';
    try {
      const upd = { name: f.name.value.trim(), roles, specialty: f.specialty.value.trim(), semester: f.semester.value.trim(), what_i_do: f.what_i_do.value.trim(), what_i_want: f.what_i_want.value.trim(), spotify: f.spotify.value.trim(), soundcloud: f.soundcloud.value.trim(), instagram: f.instagram.value.trim(), tiktok: f.tiktok.value.trim() };
      if (avatarFile) {
        if (avatarFile.size > 5 * 1024 * 1024) throw new Error('Photo must be under 5 MB');
        const ext = (avatarFile.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
        const path = `${me.id}/avatar-${Date.now()}.${ext}`;
        const { error } = await sb.storage.from('avatars').upload(path, avatarFile, { contentType: avatarFile.type || 'image/jpeg', upsert: true });
        if (error) throw error;
        upd.avatar_url = publicUrl('avatars', path);
      }
      const { data, error } = await sb.from('profiles').update(upd).eq('id', me.id).select().single();
      if (error) throw error;
      me = data; profiles.set(me.id, me);
      closeSheet(); toast(onboarding ? "You're on Pull." : 'Saved');
      render();
    } catch (ex) { err.textContent = niceError(ex); btn.disabled = false; btn.textContent = 'Save'; }
  };
}

/* ---------- Post work ---------- */
function readDuration(file) {
  return new Promise(res => { const a = document.createElement('audio'); const u = URL.createObjectURL(file); a.preload = 'metadata'; a.onloadedmetadata = () => { res(isFinite(a.duration) ? a.duration : null); URL.revokeObjectURL(u); }; a.onerror = () => res(null); a.src = u; });
}
function mimeFor(file) {
  if (file.type && file.type !== 'application/octet-stream') return file.type;
  const ext = file.name.split('.').pop().toLowerCase();
  return ({ mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', aac: 'audio/aac', ogg: 'audio/ogg' })[ext] || 'audio/mpeg';
}
async function uploadWork(file, title, type) {
  if (!/\.(mp3|m4a|wav)$/i.test(file.name)) throw new Error('Use an mp3, m4a or wav');
  if (file.size > MAX_BYTES) throw new Error('File is bigger than 10 MB');
  const duration = await readDuration(file);
  const ext = file.name.split('.').pop().toLowerCase();
  const path = `${me.id}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
  const { error } = await sb.storage.from('work').upload(path, file, { contentType: mimeFor(file), upsert: false });
  if (error) throw error;
  const { data, error: e2 } = await sb.from('works').insert({ user_id: me.id, title, type, path, duration }).select().single();
  if (e2) throw e2;
  works.set(data.id, data);
  return data;
}
function postWorkSheet(done) {
  const sheet = openSheet(`<h2>Post work</h2>
    <form class="form" id="wf">
      <label class="dz" id="dz" style="display:block;cursor:pointer">${icon('music')}<div id="dzt">Tap to choose an mp3, m4a or wav · max 10 MB · 90 s suggested</div><input type="file" id="wfile" accept=".mp3,.m4a,.wav,audio/mpeg,audio/mp4,audio/x-m4a,audio/wav,audio/x-wav" style="display:none"></label>
      <label>Title<input name="title" required maxlength="80" placeholder="Name it"></label>
      <label>Type</label><div class="chips" id="wtypes" style="margin-bottom:12px">${WORK_TYPES.map((t, i) => `<button type="button" class="chip ${i === 0 ? 'on' : ''}" data-v="${t}">${t}</button>`).join('')}</div>
      <p class="err" id="wferr"></p>
      <button class="btn primary" type="submit">Post</button>
    </form>`);
  let file = null;
  $$('#wtypes .chip', sheet).forEach(c => c.onclick = () => { $$('#wtypes .chip', sheet).forEach(x => x.classList.remove('on')); c.classList.add('on'); });
  $('#wfile', sheet).onchange = async e => {
    file = e.target.files[0]; if (!file) return;
    const dz = $('#dz', sheet); dz.classList.add('has');
    const d = await readDuration(file);
    $('#dzt', sheet).textContent = `${file.name} · ${(file.size / 1048576).toFixed(1)} MB${d ? ' · ' + fmtDur(d) : ''}${d && d > 90 ? ' · longer than the 90 s we suggest' : ''}`;
    if (!$('[name=title]', sheet).value) $('[name=title]', sheet).value = file.name.replace(/\.[^.]+$/, '').slice(0, 80);
  };
  $('#wf', sheet).onsubmit = async e => {
    e.preventDefault();
    const err = $('#wferr', sheet); err.textContent = '';
    if (!file) { err.textContent = 'Choose a file.'; return; }
    const title = e.target.title.value.trim(); if (!title) { err.textContent = 'Give it a title.'; return; }
    const type = $('#wtypes .chip.on', sheet).dataset.v;
    const btn = $('button[type=submit]', sheet); btn.disabled = true; btn.textContent = 'Uploading…';
    try { const w = await uploadWork(file, title, type); closeSheet(); toast('Posted'); done && done(w); }
    catch (ex) { err.textContent = niceError(ex); btn.disabled = false; btn.textContent = 'Post'; }
  };
}

/* ---------- Ask ---------- */
async function askSheet(p, stats, preset = {}) {
  let lim, myWorks;
  try { [lim, { data: myWorks }] = await Promise.all([myLimits(), sb.from('works').select('*').eq('user_id', me.id).order('created_at', { ascending: false })]); } catch (e) { return fail(e); }
  const s = stats || {};
  const sheet = openSheet(`<h2>Ask ${esc(dispName(p))}</h2>
    <div class="preface"><b>${esc(dispName(p))}</b> has <b>${s.accepts_left ?? 3}</b> accept${s.accepts_left === 1 ? '' : 's'} left this week. <b>${s.asks_received_week || 0}</b> ${s.asks_received_week === 1 ? 'person' : 'people'} asked before you. If they pass, nobody sees it. If they accept, everyone does.</div>
    <form class="form" id="af">
      <label>What do you want to make?</label>
      <div class="chips" id="mtypes" style="margin-bottom:12px">${MAKE_TYPES.map((t, i) => `<button type="button" class="chip ${(preset.make_type ? t === preset.make_type : i === 0) ? 'on' : ''}" data-v="${t}">${t}</button>`).join('')}</div>
      <label>Your pitch<textarea name="pitch" maxlength="400" required placeholder="Why them, what you hear, when.">${esc(preset.pitch || '')}</textarea></label>
      <label>Attach one of your snippets</label>
      ${myWorks.length ? `<div class="chips" id="wpick" style="margin-bottom:12px">${myWorks.map(w => `<button type="button" class="chip" data-v="${w.id}">${esc(w.title)}</button>`).join('')}</div>` : `<p class="hint">You haven't posted work yet. <a class="accent" href="#you" id="gopost">Post a snippet</a> so they can hear you.</p>`}
      <p class="err" id="aferr"></p>
      <button class="btn primary" type="submit" ${lim.asks_left ? '' : 'disabled'}>${lim.asks_left ? `Send ask · ${lim.asks_left} left this week` : 'No asks left this week'}</button>
    </form>`);
  $$('#mtypes .chip', sheet).forEach(c => c.onclick = () => { $$('#mtypes .chip', sheet).forEach(x => x.classList.remove('on')); c.classList.add('on'); });
  $$('#wpick .chip', sheet).forEach(c => c.onclick = () => { const on = c.classList.contains('sel'); $$('#wpick .chip', sheet).forEach(x => x.classList.remove('sel')); if (!on) c.classList.add('sel'); });
  if ($('#gopost', sheet)) $('#gopost', sheet).onclick = () => closeSheet();
  $('#af', sheet).onsubmit = async e => {
    e.preventDefault();
    const err = $('#aferr', sheet); err.textContent = '';
    const pitch = e.target.pitch.value.trim(); if (!pitch) { err.textContent = 'Write a pitch.'; return; }
    const make = $('#mtypes .chip.on', sheet).dataset.v;
    const wsel = $('#wpick .chip.sel', sheet); const work = wsel ? wsel.dataset.v : null;
    const btn = $('button[type=submit]', sheet); btn.disabled = true; btn.textContent = 'Sending…';
    try {
      const { error } = await sb.rpc('send_ask', { p_to: p.id, p_make: make, p_pitch: pitch, p_work: work });
      if (error) throw error;
      closeSheet(); toast(`Asked ${dispName(p)}. Now they know you want them.`); render();
    } catch (ex) { err.textContent = niceError(ex); btn.disabled = false; btn.textContent = 'Send ask'; }
  };
}

/* ---------- Asks screen ---------- */
let asksSeg = 'received';
async function renderAsks() {
  shell({ title: 'Asks', tab: 'asks', body: `<div class="skel">${skel}</div>` });
  try {
    const [{ data: rec, error: e1 }, { data: sent, error: e2 }, { data: cols, error: e3 }, lim, { data: pe }] = await Promise.all([
      sb.from('asks').select('*').eq('to_id', me.id).order('created_at', { ascending: false }),
      sb.from('sent_asks').select('*').order('created_at', { ascending: false }),
      sb.from('collabs').select('*').or(`a_id.eq.${me.id},b_id.eq.${me.id}`).order('created_at', { ascending: false }),
      myLimits(),
      sb.from('pull_events').select('collab_id,points').eq('user_id', me.id),
    ]);
    if (e1) throw e1; if (e2) throw e2; if (e3) throw e3;
    const ptsBy = {}; (pe || []).forEach(x => ptsBy[x.collab_id] = x.points);
    await loadProfiles([...rec.map(a => a.from_id), ...sent.map(a => a.to_id), ...cols.flatMap(c => [c.a_id, c.b_id])]);
    await loadWorks([...rec.map(a => a.work_id), ...sent.map(a => a.work_id), ...cols.map(c => c.work_id)]);
    const pending = rec.filter(a => a.status === 'pending');
    const openCols = cols.filter(c => c.status !== 'confirmed');
    const counts = { received: pending.length, sent: sent.filter(a => a.status === 'pending').length, collabs: openCols.length };
    const askCard = (a, dir) => {
      const other = profiles.get(dir === 'in' ? a.from_id : a.to_id), w = works.get(a.work_id);
      const decided = a.status !== 'pending';
      return `<div class="card ask-card">
        <div class="row"><a href="#u/${other?.id}">${avatar(other, 'md')}</a><div class="grow"><div class="name ellip"><a href="#u/${other?.id}">${esc(dispName(other))}</a></div><div class="ask-meta">${dir === 'in' ? 'wants to make a' : 'you asked for a'} <b>${esc(a.make_type)}</b> · ${timeAgo(a.created_at)}</div></div>
          ${dir === 'out' ? `<span class="status ${a.status === 'accepted' ? 'ok' : 'wait'}">${a.status === 'accepted' ? 'Accepted' : 'Waiting'}</span>` : (decided ? `<span class="status ${a.status === 'accepted' ? 'ok' : 'wait'}">${a.status === 'accepted' ? 'Accepted' : 'Passed'}</span>` : '')}</div>
        <p class="pitch">${esc(a.pitch)}</p>
        ${w ? playerHTML(w, true) : ''}
        ${dir === 'in' && !decided ? `<div class="btnrow" style="margin-top:12px"><button class="btn outline" data-pass="${a.id}">Pass</button><button class="btn primary" data-accept="${a.id}" ${lim.accepts_left ? '' : 'disabled'}>${icon('check')} Accept${lim.accepts_left ? '' : ' · none left'}</button></div>` : ''}
      </div>`;
    };
    const colCard = c => {
      const other = profiles.get(c.a_id === me.id ? c.b_id : c.a_id), w = works.get(c.work_id);
      let line, action = '';
      if (c.status === 'open') { line = 'Open. Mark it done when the work exists.'; action = `<button class="btn primary sm" data-done="${c.id}">${icon('check')} Mark done</button>`; }
      else if (c.status === 'done' && c.done_by === me.id) line = `You marked it done. Waiting for ${esc(dispName(other))} to confirm.`;
      else if (c.status === 'done') { line = `${esc(dispName(other))} marked it done.`; action = `<button class="btn primary sm" data-confirm="${c.id}">${icon('check')} Confirm</button>`; }
      else line = `Confirmed · <span class="accent">+${ptsBy[c.id] || 0} Pull</span>`;
      return `<div class="card"><div class="row"><a href="#u/${other?.id}">${avatar(other, 'md')}</a><div class="grow"><div class="name"><b>${esc(c.make_type)}</b> with ${esc(dispName(other))}</div><div class="small muted">${line}</div></div>${action}</div>${w ? `<div style="margin-top:10px">${playerHTML(w, true)}</div>` : ''}</div>`;
    };
    const draw = () => {
      $$('.page .seg button').forEach(b => b.classList.toggle('on', b.dataset.s === asksSeg));
      let html;
      if (asksSeg === 'received') html = rec.length ? `${pending.length ? '' : `<p class="small muted" style="margin:0 0 10px">${lim.accepts_left} accept${lim.accepts_left === 1 ? '' : 's'} left this week.</p>`}` + [...pending, ...rec.filter(a => a.status !== 'pending')].map(a => askCard(a, 'in')).join('') : `<div class="empty"><b>Nobody has asked you yet.</b>Post work. Get seen. Get asked.</div>`;
      else if (asksSeg === 'sent') html = sent.length ? sent.map(a => askCard(a, 'out')).join('') : `<div class="empty"><b>You haven't asked anyone.</b>You get 5 a week. Use them.<div style="margin-top:12px"><a class="btn sm primary" href="#members">Browse members</a></div></div>`;
      else html = cols.length ? [...openCols, ...cols.filter(c => c.status === 'confirmed')].map(colCard).join('') : `<div class="empty"><b>No collabs yet.</b>An accepted ask becomes a collab. It counts once you both confirm.</div>`;
      $('#asklist').innerHTML = html;
      $$('[data-accept]').forEach(b => b.onclick = () => decide(b.dataset.accept, 'accept'));
      $$('[data-pass]').forEach(b => b.onclick = () => decide(b.dataset.pass, 'pass'));
      $$('[data-done]').forEach(b => b.onclick = () => markDoneSheet(cols.find(c => c.id === b.dataset.done)));
      $$('[data-confirm]').forEach(b => b.onclick = async () => { b.disabled = true; try { const { error } = await sb.rpc('confirm_collab', { p_collab: b.dataset.confirm }); if (error) throw error; toast('Confirmed. Pull added for both of you.'); renderAsks(); } catch (e) { fail(e); b.disabled = false; } });
    };
    const decide = async (id, d) => {
      if (d === 'pass' && !confirm('Pass? They will never know, it just stays "Waiting" for them.')) return;
      try { const { error } = await sb.rpc('decide_ask', { p_ask: id, p_decision: d }); if (error) throw error; toast(d === 'accept' ? 'Accepted. Everyone can see it now.' : 'Passed. Nobody sees it.'); renderAsks(); } catch (e) { fail(e); }
    };
    $('.page').innerHTML = `<div class="card tight row" style="margin-bottom:4px"><div class="grow small"><b>${lim.asks_left}</b> asks left · <b>${lim.accepts_left}</b> accepts left</div><span class="pill">resets Monday</span></div>
      <div class="seg">${[['received','Received'],['sent','Sent'],['collabs','Collabs']].map(([k, l]) => `<button data-s="${k}">${l}${counts[k] ? ` <span class="pill hot">${counts[k]}</span>` : ''}</button>`).join('')}</div><div class="list" id="asklist"></div>`;
    $$('.page .seg button').forEach(b => b.onclick = () => { asksSeg = b.dataset.s; draw(); });
    draw();
  } catch (e) { $('.page').innerHTML = `<div class="empty">${esc(niceError(e))}</div>`; }
}

async function markDoneSheet(c) {
  const other = profiles.get(c.a_id === me.id ? c.b_id : c.a_id);
  const { data: ws } = await sb.from('works').select('*').in('user_id', [c.a_id, c.b_id]).order('created_at', { ascending: false });
  (ws || []).forEach(w => works.set(w.id, w));
  const sheet = openSheet(`<h2>Mark done</h2><p class="muted" style="margin-bottom:12px">Attach the work you made with ${esc(dispName(other))}. They confirm, then it counts.</p>
    <div class="form">
      ${ws.length ? `<label>Pick a posted snippet</label><div class="chips" id="dpick" style="margin-bottom:12px">${ws.map(w => `<button type="button" class="chip" data-v="${w.id}">${esc(w.title)}${w.user_id !== me.id ? ' · ' + esc(dispName(profiles.get(w.user_id))) : ''}</button>`).join('')}</div>` : ''}
      <label>Or upload the result<input type="file" id="dfile" accept=".mp3,.m4a,.wav"></label>
      <label id="dtitlewrap" class="hide">Title<input id="dtitle" maxlength="80" placeholder="Name it"></label>
      <p class="err" id="derr"></p><button class="btn primary" id="dsubmit">Mark done</button></div>`);
  let file = null;
  $$('#dpick .chip', sheet).forEach(ch => ch.onclick = () => { const on = ch.classList.contains('sel'); $$('#dpick .chip', sheet).forEach(x => x.classList.remove('sel')); if (!on) ch.classList.add('sel'); });
  $('#dfile', sheet).onchange = e => { file = e.target.files[0]; $('#dtitlewrap', sheet).classList.toggle('hide', !file); if (file && !$('#dtitle', sheet).value) $('#dtitle', sheet).value = file.name.replace(/\.[^.]+$/, '').slice(0, 80); };
  $('#dsubmit', sheet).onclick = async () => {
    const err = $('#derr', sheet); err.textContent = '';
    const btn = $('#dsubmit', sheet); btn.disabled = true;
    try {
      let workId = $('#dpick .chip.sel', sheet)?.dataset.v || null;
      if (file) { const w = await uploadWork(file, $('#dtitle', sheet).value.trim() || 'Collab', 'Session'); workId = w.id; }
      if (!workId) throw new Error('Pick a snippet or upload the work');
      const { error } = await sb.rpc('mark_done', { p_collab: c.id, p_work: workId }); if (error) throw error;
      closeSheet(); toast(`Marked done. ${dispName(other)} confirms next.`); renderAsks();
    } catch (ex) { err.textContent = niceError(ex); btn.disabled = false; }
  };
}

/* ---------- Feed ---------- */
async function renderFeed() {
  shell({ title: 'Just happened', tab: 'feed', body: `<div class="skel">${skel}</div>` });
  try {
    const { data, error } = await sb.from('feed').select('*').order('at', { ascending: false }).limit(80);
    if (error) throw error;
    await loadProfiles(data.flatMap(f => [f.actor_id, f.target_id]));
    await loadWorks(data.filter(f => f.kind === 'collab').map(f => f.work_id));
    const link = id => { const p = profiles.get(id); return `<a href="#u/${id}"><b>${esc(id === me.id ? 'You' : dispName(p))}</b></a>`; };
    const items = data.map(f => {
      const a = profiles.get(f.actor_id);
      let what;
      if (f.kind === 'member') what = `${link(f.actor_id)} joined Pull${a && a.roles?.length ? ` as ${esc(roleLabel(a.roles))}` : ''}.`;
      else if (f.kind === 'accept') what = `${link(f.actor_id)} accepted ${link(f.target_id)} for a ${esc(f.make_type)}.`;
      else if (f.kind === 'collab') what = `${link(f.actor_id)} and ${link(f.target_id)} confirmed a ${esc(f.make_type)}.`;
      else what = `${f.actor_id === me.id ? `<a href="#you"><b>You're</b></a>` : link(f.actor_id) + ' is'} on the Board this week. ${icon('up', 'accent')}`;
      const w = f.kind === 'collab' ? works.get(f.work_id) : null;
      return `<div class="card feed-item"><a href="#u/${f.actor_id}">${avatar(a, 'md')}</a><div class="what"><div>${what}</div>${w ? playerHTML(w, true) : ''}</div><time>${timeAgo(f.at)}</time></div>`;
    });
    $('.page').innerHTML = items.length ? `<div class="list">${items.join('')}</div>` : `<div class="empty"><b>Quiet so far.</b>Accepts and confirmed collabs show up here.</div>`;
  } catch (e) { $('.page').innerHTML = `<div class="empty">${esc(niceError(e))}</div>`; }
}

/* ---------- Open calls ---------- */
async function renderCalls() {
  shell({ title: 'Open calls', tab: 'calls', right: `<button class="iconbtn" id="newcall" aria-label="Post a call">${icon('plus')}</button>`, body: `<div class="skel">${skel}</div>` });
  try {
    const [{ data: calls, error }, { data: st }] = await Promise.all([sb.from('open_calls').select('*').eq('is_open', true).order('created_at', { ascending: false }), sb.from('board').select('id,accepts_left,asks_received_week')]);
    if (error) throw error;
    const stats = {}; (st || []).forEach(s => stats[s.id] = s);
    await loadProfiles(calls.map(c => c.user_id)); await loadWorks(calls.map(c => c.work_id));
    $('.page').innerHTML = calls.length ? `<div class="list">${calls.map(c => { const p = profiles.get(c.user_id), w = works.get(c.work_id), mine = c.user_id === me.id; return `<div class="card">
      <div class="row"><a href="#u/${c.user_id}">${avatar(p, 'md')}</a><div class="grow"><div class="name ellip">${esc(c.title)}</div><div class="small muted">${esc(dispName(p))} · ${esc(c.make_type)} · ${timeAgo(c.created_at)}</div></div></div>
      <p style="margin:10px 0"><span class="pill hot">needs</span> ${esc(c.need)}</p>
      ${w ? playerHTML(w, true) : ''}
      <div style="margin-top:10px">${mine ? `<button class="btn outline sm" data-close="${c.id}">Close call</button>` : `<button class="btn primary" data-join="${c.id}" ${stats[c.user_id]?.accepts_left === 0 ? 'disabled' : ''}>${icon('asks')} Ask to join</button>`}</div></div>`; }).join('')}</div>`
      : `<div class="empty"><b>No open calls.</b>Post what you're making and who you need.<div style="margin-top:12px"><button class="btn sm primary" id="newcall2">Post a call</button></div></div>`;
    const newCall = () => postCallSheet(renderCalls);
    $('#newcall').onclick = newCall; if ($('#newcall2')) $('#newcall2').onclick = newCall;
    $$('[data-join]').forEach(b => b.onclick = () => { const c = calls.find(x => x.id === b.dataset.join); askSheet(profiles.get(c.user_id), stats[c.user_id], { make_type: c.make_type, pitch: `Re "${c.title}": ` }); });
    $$('[data-close]').forEach(b => b.onclick = async () => { const { error } = await sb.from('open_calls').update({ is_open: false }).eq('id', b.dataset.close); if (error) return fail(error); toast('Closed'); renderCalls(); });
  } catch (e) { $('.page').innerHTML = `<div class="empty">${esc(niceError(e))}</div>`; }
}
async function postCallSheet(done) {
  const { data: myWorks } = await sb.from('works').select('*').eq('user_id', me.id).order('created_at', { ascending: false });
  const sheet = openSheet(`<h2>Post a call</h2><form class="form" id="cf">
    <label>What are you making?<input name="title" required maxlength="80" placeholder="e.g. Neo-soul EP, 4 tracks"></label>
    <label>Who do you need?<input name="need" required maxlength="200" placeholder="a bass player and a second voice"></label>
    <label>Type</label><div class="chips" id="ctypes" style="margin-bottom:12px">${MAKE_TYPES.map((t, i) => `<button type="button" class="chip ${i === 0 ? 'on' : ''}" data-v="${t}">${t}</button>`).join('')}</div>
    <label>Attach a snippet</label>${(myWorks || []).length ? `<div class="chips" id="cpick" style="margin-bottom:12px">${myWorks.map(w => `<button type="button" class="chip" data-v="${w.id}">${esc(w.title)}</button>`).join('')}</div>` : `<p class="hint">Post work first to attach a snippet.</p>`}
    <p class="err" id="cerr"></p><button class="btn primary" type="submit">Post call</button></form>`);
  $$('#ctypes .chip', sheet).forEach(c => c.onclick = () => { $$('#ctypes .chip', sheet).forEach(x => x.classList.remove('on')); c.classList.add('on'); });
  $$('#cpick .chip', sheet).forEach(c => c.onclick = () => { const on = c.classList.contains('sel'); $$('#cpick .chip', sheet).forEach(x => x.classList.remove('sel')); if (!on) c.classList.add('sel'); });
  $('#cf', sheet).onsubmit = async e => {
    e.preventDefault(); const err = $('#cerr', sheet); err.textContent = '';
    const f = e.target; const btn = $('button[type=submit]', f); btn.disabled = true;
    try { const { error } = await sb.from('open_calls').insert({ user_id: me.id, title: f.title.value.trim(), need: f.need.value.trim(), make_type: $('#ctypes .chip.on', sheet).dataset.v, work_id: $('#cpick .chip.sel', sheet)?.dataset.v || null }); if (error) throw error; closeSheet(); toast('Call posted'); done && done(); }
    catch (ex) { err.textContent = niceError(ex); btn.disabled = false; }
  };
}

/* ---------- router ---------- */
function render() {
  if (!sb) return;
  if (!session) { closeSheet(); return renderAuth(sessionStorage.getItem('pull_mode') || 'in'); }
  if (!me) return;
  const r = route();
  window.scrollTo(0, 0);
  if (r.parts[0] === 'u' && r.parts[1]) return r.parts[1] === me.id ? renderProfile(me.id, true) : renderProfile(r.parts[1], false);
  switch (r.parts[0]) {
    case 'feed': return renderFeed();
    case 'asks': return renderAsks();
    case 'calls': return renderCalls();
    case 'you': return renderProfile(me.id, true);
    case 'members': return renderMembers();
    default: return renderBoard();
  }
}
window.addEventListener('hashchange', render);

async function loadMe() {
  for (let i = 0; i < 5; i++) {
    const { data } = await sb.from('profiles').select('*').eq('id', session.user.id).maybeSingle();
    if (data) { me = data; profiles.set(me.id, me); return; }
    await new Promise(r => setTimeout(r, 400)); // profile trigger may lag a beat
  }
  throw new Error('Profile not found');
}

async function boot() {
  if (!CFG.url || !CFG.anonKey || !window.supabase) {
    app.innerHTML = `<main class="auth"><div class="brand"><div class="logo">Pull</div><p class="tag">Not configured yet. Put your Supabase project URL and anon key in <code>config.js</code>.</p></div></main>`;
    return;
  }
  sb = window.supabase.createClient(CFG.url, CFG.anonKey);
  const { data: { session: s } } = await sb.auth.getSession();
  session = s;
  sb.auth.onAuthStateChange(async (event, s2) => {
    const was = session?.user?.id; session = s2;
    if (!s2) { me = null; profiles.clear(); works.clear(); audio.pause(); render(); return; }
    if (s2.user.id !== was || !me) {
      try { await loadMe(); } catch (e) { return fail(e); }
      render();
      if (sessionStorage.getItem('pull_onboard')) { sessionStorage.removeItem('pull_onboard'); editProfileSheet(true); }
      else if (!me.roles?.length) editProfileSheet(true);
    }
  });
  if (session) { try { await loadMe(); } catch (e) { fail(e); } }
  render();
  if (session && me && !me.roles?.length && !$('.sheet')) editProfileSheet(true);
}
boot();
