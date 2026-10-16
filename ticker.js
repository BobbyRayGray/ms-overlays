(function(){
// ESPN-style scrolling sports ticker for StreamElements
// Data: ESPN public scoreboard API (no key needed)

const LEAGUES = [
  { key: 'nfl', label: 'NFL',   path: 'football/nfl' },
  { key: 'cfb', label: 'NCAAF', path: 'football/college-football',        extra: '&groups=80&limit=300' },
  { key: 'nba', label: 'NBA',   path: 'basketball/nba' },
  { key: 'cbb', label: 'NCAAM', path: 'basketball/mens-college-basketball', extra: '&groups=50&limit=300' },
  { key: 'mlb', label: 'MLB',   path: 'baseball/mlb' }
];

let cfg = {};
let pendingHTML = null;
let offset = 0, lastTs = null, loopWidth = 0;
const track = document.getElementById('track');

window.addEventListener('tickerLoad', (obj) => {
  cfg = obj.detail.fieldData || {};
  refresh();
  setInterval(refresh, Math.max(15, Number(cfg.refreshSeconds) || 30) * 1000);
  startAnimation();
});

function todayStr() {
  const d = new Date();
  return d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
}

async function fetchLeague(lg) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/${lg.path}/scoreboard?dates=${todayStr()}${lg.extra || ''}`;
  try {
    const r = await fetch(url, { cache: 'no-store' });
    const j = await r.json();
    return (j.events || []).map(ev => parseGame(ev, lg)).filter(Boolean);
  } catch (e) { return []; }
}

function parseGame(ev, lg) {
  const comp = (ev.competitions || [])[0];
  if (!comp) return null;
  const state = ev.status.type.state; // pre | in | post
  const away = comp.competitors.find(c => c.homeAway === 'away');
  const home = comp.competitors.find(c => c.homeAway === 'home');
  if (!away || !home) return null;

  let sit = '';
  if (state === 'in' && comp.situation) {
    const s = comp.situation;
    if (lg.key === 'mlb') {
      const bases = [s.onFirst && '1st', s.onSecond && '2nd', s.onThird && '3rd'].filter(Boolean);
      sit = `${s.outs || 0} OUT${s.outs === 1 ? '' : 'S'}` + (bases.length ? ` · ON ${bases.join(', ')}` : '');
    } else if (s.downDistanceText) {
      sit = s.downDistanceText + (s.isRedZone ? ' · RED ZONE' : '');
    }
  }
  return { state, away, home, detail: ev.status.type.shortDetail || '', sit, date: ev.date };
}

function team(c, state, showLogos, isCollege) {
  const t = c.team || {};
  const rank = isCollege && c.curatedRank && c.curatedRank.current && c.curatedRank.current <= 25 ? `<span class="rank">${c.curatedRank.current}</span>` : '';
  const logo = showLogos && t.logo ? `<img src="${t.logo}" onerror="this.remove()">` : '';
  const score = state === 'pre' ? '' : `<span class="score">${c.score || 0}</span>`;
  const cls = state === 'post' ? (c.winner ? 'win' : 'lose') : '';
  return `<span class="team ${cls}">${logo}${rank}<span class="abbr">${t.abbreviation || t.shortDisplayName || ''}</span>${score}</span>`;
}

function statusHTML(g) {
  if (g.state === 'in') return `<span class="status live">${g.detail}${g.sit ? `<span class="sit">${g.sit}</span>` : ''}</span>`;
  if (g.state === 'post') return `<span class="status">${g.detail}</span>`;
  const t = new Date(g.date).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return `<span class="status">${t}</span>`;
}

async function refresh() {
  const mode = cfg.showMode || 'all';
  const showLogos = cfg.showLogos !== false;
  const enabled = LEAGUES.filter(lg => cfg['show_' + lg.key] !== false);
  const results = await Promise.all(enabled.map(fetchLeague));
  const order = { in: 0, pre: 1, post: 2 };
  let html = '';

  enabled.forEach((lg, i) => {
    let games = results[i];
    if (mode === 'live') games = games.filter(g => g.state === 'in');
    else if (mode === 'livepre') games = games.filter(g => g.state !== 'post');
    if (!games.length) return;
    games.sort((a, b) => order[a.state] - order[b.state] || new Date(a.date) - new Date(b.date));
    const isCollege = lg.key === 'cfb' || lg.key === 'cbb';
    html += `<span class="league">${lg.label}</span>`;
    games.forEach(g => {
      html += `<span class="game">${team(g.away, g.state, showLogos, isCollege)}<span class="at">@</span>${team(g.home, g.state, showLogos, isCollege)}${statusHTML(g)}</span>`;
    });
  });

  if (!html) html = `<span class="empty">${cfg.emptyText || 'No live games right now — check back soon'}</span>`;

  if (!track.innerHTML) applyHTML(html); else pendingHTML = html;
}

function applyHTML(html) {
  track.innerHTML = `<div class="seg">${html}</div><div class="seg">${html}</div>`;
  [...track.children].forEach(s => s.style.display = 'flex');
  track.style.display = 'flex';
  loopWidth = track.children[0].getBoundingClientRect().width;
  // images change width once loaded
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { loopWidth = track.children[0].getBoundingClientRect().width; });
  track.querySelectorAll('img').forEach(img => img.addEventListener('load', () => { loopWidth = track.children[0].getBoundingClientRect().width; }));
}

// Animation: driven by requestAnimationFrame when available, with a timer
// fallback so it still moves in apps (Ecamm, some OBS docks) that throttle
// or pause animation frames for overlays.
let lastStep = null;
function step() {
  const now = (window.performance && performance.now) ? performance.now() : Date.now();
  if (lastStep == null) lastStep = now;
  const dt = Math.min(0.25, (now - lastStep) / 1000); lastStep = now;
  if (!loopWidth && track.children[0]) loopWidth = track.children[0].getBoundingClientRect().width;
  const speed = Number(cfg.speed) || 90; // px per second
  if (loopWidth > 0 && dt > 0) {
    offset += speed * dt;
    if (offset >= loopWidth) {
      offset -= loopWidth;
      if (pendingHTML) { applyHTML(pendingHTML); pendingHTML = null; offset = 0; }
    }
    track.style.webkitTransform = track.style.transform = 'translate3d(' + (-offset) + 'px,0,0)';
  }
}
function tick() { step(); if (window.requestAnimationFrame) requestAnimationFrame(tick); }
function startAnimation() {
  if (window.requestAnimationFrame) requestAnimationFrame(tick);
  setInterval(() => { // fallback: only steps if animation frames have stalled
    const now = (window.performance && performance.now) ? performance.now() : Date.now();
    if (lastStep == null || now - lastStep > 60) step();
  }, 33);
}

})();
