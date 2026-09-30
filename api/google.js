import { json, redirect, isAuthed, locked, origin, rand, setCookie, accessToken, form, fail, TZ } from './_lib.js';

const SCOPE = 'https://www.googleapis.com/auth/calendar.events';
const configured = () => !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
const token = () => accessToken('google', refresh => form('https://oauth2.googleapis.com/token', { grant_type: 'refresh_token', refresh_token: refresh, client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET }));

async function cal(path, opts = {}) {
  const t = await token();
  const r = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary' + path, { ...opts, headers: { authorization: 'Bearer ' + t, 'content-type': 'application/json' } });
  if (r.status === 204) return null;
  const body = await r.json().catch(() => null);
  if (!r.ok) { const e = new Error(body?.error?.message || ('Google answered ' + r.status)); e.status = r.status; throw e }
  return body;
}

// "2026-10-02T14:00" local wall time + minutes -> same format
function addMinutes(local, mins) {
  const d = new Date(local.slice(0, 16) + ':00Z'); d.setUTCMinutes(d.getUTCMinutes() + mins);
  return d.toISOString().slice(0, 16);
}
const isLocal = s => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(String(s || ''));

async function list(days = 7) {
  const start = new Date(Date.now() - 12 * 3600 * 1000), end = new Date(Date.now() + Math.min(60, Math.max(1, days)) * 86400000);
  const q = new URLSearchParams({ timeMin: start.toISOString(), timeMax: end.toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: '60', timeZone: TZ() });
  const r = await cal('/events?' + q);
  return (r?.items || []).filter(e => e.status !== 'cancelled').map(e => ({
    id: e.id, title: e.summary || '(No title)', allDay: !e.start?.dateTime,
    start: e.start?.dateTime || e.start?.date, end: e.end?.dateTime || e.end?.date, location: e.location || '', link: e.hangoutLink || ''
  }));
}

export async function GET(req) {
  if (!isAuthed(req)) return locked();
  const url = new URL(req.url);
  if (url.searchParams.get('action') === 'login') {
    if (!configured()) return json({ error: 'Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in Vercel first.' }, 501);
    const state = rand();
    const q = new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID, redirect_uri: origin(req) + '/api/google-callback', response_type: 'code', scope: SCOPE, access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state });
    return redirect('https://accounts.google.com/o/oauth2/v2/auth?' + q, { 'set-cookie': setCookie('g_state', state, 600) });
  }
  if (!configured()) return json({ configured: false });
  try { return json({ configured: true, linked: true, events: await list(Number(url.searchParams.get('days')) || 7) }) }
  catch (e) { if (e.code === 'not_linked') return json({ configured: true, linked: false }); return fail(e) }
}

export async function POST(req) {
  if (!isAuthed(req)) return locked();
  if (!configured()) return fail(Object.assign(new Error('Google Calendar is not set up yet.'), { code: 'not_configured' }));
  let b = {}; try { b = await req.json() } catch {}
  try {
    if (b.do === 'create') {
      if (!b.title || !isLocal(b.start)) return json({ ok: false, error: 'Need a title and a start time.' }, 400);
      const tz = TZ(), mins = Math.max(5, Math.min(600, Number(b.minutes) || 30));
      const ev = await cal('/events', { method: 'POST', body: JSON.stringify({
        summary: String(b.title).slice(0, 200), description: b.description ? String(b.description).slice(0, 2000) : undefined,
        location: b.location || undefined,
        start: { dateTime: b.start.slice(0, 16) + ':00', timeZone: tz }, end: { dateTime: addMinutes(b.start, mins) + ':00', timeZone: tz }
      }) });
      return json({ ok: true, id: ev.id, said: 'Booked ' + ev.summary });
    }
    if (b.do === 'delete' && b.id) { await cal('/events/' + encodeURIComponent(b.id), { method: 'DELETE' }); return json({ ok: true, said: 'Removed from calendar' }) }
    if (b.do === 'move' && b.id && isLocal(b.start)) {
      const mins = Math.max(5, Math.min(600, Number(b.minutes) || 30)), tz = TZ();
      await cal('/events/' + encodeURIComponent(b.id), { method: 'PATCH', body: JSON.stringify({ start: { dateTime: b.start.slice(0, 16) + ':00', timeZone: tz }, end: { dateTime: addMinutes(b.start, mins) + ':00', timeZone: tz } }) });
      return json({ ok: true, said: 'Moved' });
    }
    return json({ ok: false, error: 'Unknown calendar action' }, 400);
  } catch (e) { return fail(e) }
}
