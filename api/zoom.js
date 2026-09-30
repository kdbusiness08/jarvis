import { json, isAuthed, locked, localNow, fromLocal } from './_lib.js';

// Upcoming Zoom meetings (your booked calls), via a Zoom Server-to-Server OAuth app.
const cfg = () => ({ acc: process.env.ZOOM_ACCOUNT_ID, id: process.env.ZOOM_CLIENT_ID, secret: process.env.ZOOM_CLIENT_SECRET, user: process.env.ZOOM_USER || 'me' });
let tok = null, cache = null;

async function token(c) {
  if (tok && tok.exp > Date.now() + 60000) return tok.v;
  const r = await fetch('https://zoom.us/oauth/token?grant_type=account_credentials&account_id=' + encodeURIComponent(c.acc), {
    method: 'POST', headers: { authorization: 'Basic ' + Buffer.from(c.id + ':' + c.secret).toString('base64') }
  });
  const j = await r.json().catch(() => ({}));
  if (!j.access_token) throw new Error('Zoom sign-in failed: ' + (j.reason || j.error_description || j.error || r.status));
  tok = { v: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return tok.v;
}

export async function GET(req) {
  if (!isAuthed(req)) return locked();
  const c = cfg();
  if (!c.acc || !c.id || !c.secret) return json({ configured: false });
  if (cache && Date.now() - cache.at < 60000 && !new URL(req.url).searchParams.has('fresh')) return json(cache.value);
  try {
    const t = await token(c);
    const meetings = []; let next = '';
    for (let i = 0; i < 5; i++) {
      const q = new URLSearchParams({ type: 'upcoming', page_size: '300' }); if (next) q.set('next_page_token', next);
      const r = await fetch(`https://api.zoom.us/v2/users/${encodeURIComponent(c.user)}/meetings?` + q, { headers: { authorization: 'Bearer ' + t } });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.message || ('Zoom answered ' + r.status));
      meetings.push(...(j.meetings || [])); next = j.next_page_token; if (!next) break;
    }
    const now = Date.now();
    const list = meetings.filter(m => m.start_time)
      .map(m => ({ id: String(m.id), topic: m.topic || 'Zoom call', start: m.start_time, duration: m.duration || 30, join: m.join_url || '' }))
      .filter(m => new Date(m.start).getTime() + m.duration * 60000 > now)
      .sort((a, b) => a.start.localeCompare(b.start));
    const { y, m, d, dow, off } = localNow();
    const dayEnd = fromLocal(y, m, d + 1, off), weekEnd = fromLocal(y, m, d - ((dow + 6) % 7) + 7, off);
    const value = { configured: true, meetings: list.slice(0, 60), today: list.filter(x => new Date(x.start) < dayEnd).length, week: list.filter(x => new Date(x.start) < weekEnd).length, total: list.length };
    cache = { at: Date.now(), value };
    return json(value);
  } catch (e) { return json({ configured: true, error: e.message }) }
}
