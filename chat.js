(function(){
// Shared Twitch + YouTube chat for StreamElements
// Twitch: anonymous read-only IRC (no login needed)
// YouTube: YouTube Data API v3 (needs an API key in the widget settings)

const TW_ICON = '<svg class="plat" viewBox="0 0 24 24"><path fill="#9146FF" d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z"/></svg>';
const YT_ICON = '<svg class="plat" viewBox="0 0 24 24"><path fill="#FF0000" d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2 31.6 31.6 0 0 0 0 12a31.6 31.6 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1A31.6 31.6 0 0 0 24 12a31.6 31.6 0 0 0-.5-5.8z"/><path fill="#fff" d="M9.6 15.6 15.8 12 9.6 8.4z"/></svg>';

let cfg = {};
const list = document.getElementById('list');
const DEFAULT_COLORS = ['#FF4A4A','#4AA8FF','#4CD964','#FFB84A','#C27BFF','#4AE0E0','#FF7AC6','#FFE14A'];

window.addEventListener('chatLoad', (obj) => {
  cfg = obj.detail.fieldData || {};
  const tw = (cfg.twitchChannel || '').trim().toLowerCase().replace(/^#/, '');
  if (tw) connectTwitch(tw);
  if ((cfg.youtubeApiKey || '').trim() && ((cfg.youtubeChannelId || '').trim() || (cfg.youtubeVideoId || '').trim())) startYouTube();
  if (cfg.testMessages) demo();
});

/* ---------- helpers ---------- */
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function nameColor(name, given) {
  if (given) return given;
  let h = 0; for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return DEFAULT_COLORS[h % DEFAULT_COLORS.length];
}
function ignored(user, text) {
  const ig = (cfg.ignoredUsers || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
  if (ig.includes(String(user).toLowerCase())) return true;
  if (cfg.hideCommands !== false && /^\s*!/.test(text)) return true;
  return false;
}

function addMessage({ platform, id, user, color, html }) {
  const el = document.createElement('div');
  el.className = 'msg ' + platform;
  if (id) el.dataset.id = id;
  el.dataset.user = String(user).toLowerCase();
  el.innerHTML = (platform === 'twitch' ? TW_ICON : YT_ICON) +
    `<div class="body"><span class="name" style="color:${esc(color)}">${esc(user)}</span><span class="text">${html}</span></div>`;
  list.appendChild(el);
  const max = Math.max(5, Number(cfg.maxMessages) || 25);
  while (list.children.length > max) list.firstElementChild.remove();
  const hide = Number(cfg.hideAfter) || 0;
  if (hide > 0) setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 450); }, hide * 1000);
}
function removeWhere(fn) { [...list.children].forEach(el => { if (fn(el)) el.remove(); }); }

/* ---------- Twitch (anonymous IRC) ---------- */
function connectTwitch(channel) {
  const ws = new WebSocket('wss://irc-ws.chat.twitch.tv:443');
  ws.onopen = () => {
    ws.send('CAP REQ :twitch.tv/tags twitch.tv/commands');
    ws.send('PASS SCHMOOPIIE');
    ws.send('NICK justinfan' + Math.floor(10000 + Math.random() * 80000));
    ws.send('JOIN #' + channel);
  };
  ws.onmessage = (ev) => String(ev.data).split('\r\n').forEach(line => line && handleIrc(line, ws));
  ws.onclose = () => setTimeout(() => connectTwitch(channel), 3000);
  ws.onerror = () => { try { ws.close(); } catch (e) {} };
}

function parseTags(raw) {
  const tags = {};
  raw.slice(1).split(';').forEach(p => { const i = p.indexOf('='); tags[p.slice(0, i)] = p.slice(i + 1).replace(/\\s/g, ' ').replace(/\\:/g, ';').replace(/\\\\/g, '\\'); });
  return tags;
}

function handleIrc(line, ws) {
  if (line.startsWith('PING')) { ws.send('PONG' + line.slice(4)); return; }
  let tags = {}, rest = line;
  if (rest[0] === '@') { const sp = rest.indexOf(' '); tags = parseTags(rest.slice(0, sp)); rest = rest.slice(sp + 1); }
  const m = rest.match(/^:(\S+) (\S+) (\S+)(?: :(.*))?$/);
  if (!m) return;
  const [, prefix, cmd, , trailing = ''] = m;

  if (cmd === 'PRIVMSG') {
    const login = prefix.split('!')[0];
    const user = tags['display-name'] || login;
    let text = trailing;
    if (/^\u0001ACTION /.test(text)) text = text.replace(/^\u0001ACTION /, '').replace(/\u0001$/, '');
    if (ignored(login, text) || ignored(user, text)) return;
    addMessage({ platform: 'twitch', id: tags.id, user, color: nameColor(user, tags.color), html: twitchHtml(text, tags.emotes) });
  } else if (cmd === 'CLEARMSG') {
    const id = tags['target-msg-id']; if (id) removeWhere(el => el.dataset.id === id);
  } else if (cmd === 'CLEARCHAT') {
    if (trailing) removeWhere(el => el.classList.contains('twitch') && el.dataset.user === trailing.toLowerCase());
    else removeWhere(el => el.classList.contains('twitch'));
  }
}

function twitchHtml(text, emotesTag) {
  const chars = Array.from(text);
  const ranges = [];
  if (emotesTag) emotesTag.split('/').forEach(e => {
    const [id, pos] = e.split(':'); if (!pos) return;
    pos.split(',').forEach(r => { const [a, b] = r.split('-').map(Number); ranges.push({ a, b, id }); });
  });
  ranges.sort((x, y) => x.a - y.a);
  let out = '', i = 0;
  for (const r of ranges) {
    if (r.a < i) continue;
    out += esc(chars.slice(i, r.a).join(''));
    const name = chars.slice(r.a, r.b + 1).join('');
    out += `<img class="emote" alt="${esc(name)}" src="https://static-cdn.jtvnw.net/emoticons/v2/${encodeURIComponent(r.id)}/default/dark/2.0">`;
    i = r.b + 1;
  }
  return out + esc(chars.slice(i).join(''));
}

/* ---------- YouTube (Data API v3) ---------- */
const YT = 'https://www.googleapis.com/youtube/v3/';
async function ytGet(path, params) {
  const q = new URLSearchParams({ ...params, key: cfg.youtubeApiKey.trim() });
  const r = await fetch(YT + path + '?' + q);
  if (!r.ok) throw new Error('YT ' + r.status);
  return r.json();
}

async function findLiveVideo() {
  if ((cfg.youtubeVideoId || '').trim()) return cfg.youtubeVideoId.trim();
  const j = await ytGet('search', { part: 'id', channelId: cfg.youtubeChannelId.trim(), eventType: 'live', type: 'video', maxResults: 1 });
  return j.items && j.items[0] && j.items[0].id.videoId;
}

async function startYouTube() {
  const retryMin = Math.max(5, Number(cfg.youtubeRetryMinutes) || 10);
  try {
    const vid = await findLiveVideo();
    if (!vid) return setTimeout(startYouTube, retryMin * 60000);
    const v = await ytGet('videos', { part: 'liveStreamingDetails', id: vid });
    const chatId = v.items && v.items[0] && v.items[0].liveStreamingDetails && v.items[0].liveStreamingDetails.activeLiveChatId;
    if (!chatId) return setTimeout(startYouTube, retryMin * 60000);
    pollYouTube(chatId, null, true);
  } catch (e) {
    setTimeout(startYouTube, retryMin * 60000);
  }
}

async function pollYouTube(chatId, pageToken, first) {
  const minPoll = Math.max(5, Number(cfg.youtubePollSeconds) || 10) * 1000;
  try {
    const params = { liveChatId: chatId, part: 'snippet,authorDetails', maxResults: 200 };
    if (pageToken) params.pageToken = pageToken;
    const j = await ytGet('liveChat/messages', params);
    if (!first) (j.items || []).forEach(it => {
      const s = it.snippet, a = it.authorDetails;
      if (s.type === 'messageDeletedEvent') { removeWhere(el => el.dataset.id === s.messageDeletedDetails.deletedMessageId); return; }
      const text = s.displayMessage || (s.textMessageDetails && s.textMessageDetails.messageText) || '';
      if (!text || ignored(a.displayName, text)) return;
      addMessage({ platform: 'youtube', id: it.id, user: a.displayName, color: nameColor(a.displayName), html: esc(text) });
    });
    setTimeout(() => pollYouTube(chatId, j.nextPageToken, false), Math.max(minPoll, j.pollingIntervalMillis || 0));
  } catch (e) {
    // chat ended or quota hit: go back to looking for a live stream
    setTimeout(startYouTube, Math.max(5, Number(cfg.youtubeRetryMinutes) || 10) * 60000);
  }
}

/* ---------- demo (for testing the look) ---------- */
function demo() {
  const samples = [
    ['twitch', 'ReignFan22', '#9146FF', 'Lets gooo M&S! 🔥'],
    ['youtube', 'Bulldog Dave', null, 'Watching from Starkville 🐶'],
    ['twitch', 'HailState_Hank', '#4CD964', 'That play call was wild'],
    ['youtube', 'Mary B.', null, 'Great show tonight fellas'],
    ['twitch', 'SiskeyNation', '#FFB84A', 'Tyler cooking today']
  ];
  let i = 0;
  setInterval(() => { const s = samples[i++ % samples.length]; addMessage({ platform: s[0], user: s[1], color: nameColor(s[1], s[2]), html: esc(s[3]) }); }, 2500);
}

})();
