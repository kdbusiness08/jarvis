import { json, redirect, isAuthed, locked, origin, rand, setCookie, accessToken, form, fail } from './_lib.js';

const SCOPES = 'user-read-playback-state user-modify-playback-state user-read-currently-playing playlist-read-private playlist-read-collaborative';
const basic = () => 'Basic ' + Buffer.from(process.env.SPOTIFY_CLIENT_ID + ':' + process.env.SPOTIFY_CLIENT_SECRET).toString('base64');
const configured = () => !!(process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET);

const token = () => accessToken('spotify', refresh => form('https://accounts.spotify.com/api/token', { grant_type: 'refresh_token', refresh_token: refresh }, { authorization: basic() }));

async function api(path, opts = {}) {
  const t = await token();
  const r = await fetch('https://api.spotify.com/v1' + path, { ...opts, headers: { authorization: 'Bearer ' + t, 'content-type': 'application/json', ...(opts.headers || {}) } });
  if (r.status === 204 || r.status === 202) return null;
  const body = await r.json().catch(() => null);
  if (!r.ok) { const e = new Error(body?.error?.message || ('Spotify answered ' + r.status)); e.status = r.status; e.reason = body?.error?.reason; throw e }
  return body;
}

// Start playback, waking a device if nothing is currently playing.
async function playOn(body) {
  try { await api('/me/player/play', { method: 'PUT', body: body ? JSON.stringify(body) : undefined }); return }
  catch (e) { if (e.status !== 404 && e.reason !== 'NO_ACTIVE_DEVICE') throw e }
  const { devices = [] } = await api('/me/player/devices') || {};
  if (!devices.length) { const e = new Error('Spotify is not open on any device. Open the Spotify app on your computer or phone first.'); e.code = 'no_device'; throw e }
  const dev = devices.find(d => d.type === 'Computer') || devices[0];
  await api('/me/player/play?device_id=' + encodeURIComponent(dev.id), { method: 'PUT', body: JSON.stringify(body || {}) });
}

const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\b(playlist|my|the)\b/g, '').replace(/\s+/g, ' ').trim();

async function myPlaylists() {
  const out = [];
  for (let offset = 0; offset < 150; offset += 50) {
    const p = await api('/me/playlists?limit=50&offset=' + offset);
    out.push(...(p?.items || []).filter(Boolean));
    if (!p?.next) break;
  }
  return out;
}

async function play({ query, kind }) {
  if (!query) { await playOn(null); return 'Resumed' }
  const q = norm(query);
  if (kind !== 'track' && kind !== 'artist') {
    const mine = await myPlaylists();
    const hit = mine.find(p => norm(p.name) === q) || mine.find(p => norm(p.name).includes(q) || q.includes(norm(p.name)));
    if (hit) { await playOn({ context_uri: hit.uri }); return 'Playing your playlist ' + hit.name }
  }
  const types = kind === 'track' ? 'track' : kind === 'artist' ? 'artist' : 'playlist,track,artist';
  const s = await api('/search?limit=5&type=' + types + '&q=' + encodeURIComponent(query));
  const track = s?.tracks?.items?.find(Boolean), artist = s?.artists?.items?.find(Boolean), pl = s?.playlists?.items?.find(Boolean);
  if (kind === 'track' && track) { await playOn({ uris: [track.uri] }); return 'Playing ' + track.name + ' by ' + track.artists.map(a => a.name).join(', ') }
  if (kind === 'artist' && artist) { await playOn({ context_uri: artist.uri }); return 'Playing ' + artist.name }
  if (pl) { await playOn({ context_uri: pl.uri }); return 'Playing the playlist ' + pl.name }
  if (track) { await playOn({ uris: [track.uri] }); return 'Playing ' + track.name }
  const e = new Error('I could not find "' + query + '" on Spotify.'); e.code = 'not_found'; throw e;
}

async function now() {
  const p = await api('/me/player');
  if (!p || !p.item) return { playing: false };
  return { playing: !!p.is_playing, track: p.item.name, artist: (p.item.artists || []).map(a => a.name).join(', '), device: p.device?.name, volume: p.device?.volume_percent, art: p.item.album?.images?.slice(-1)[0]?.url || null };
}

export async function GET(req) {
  if (!isAuthed(req)) return locked();
  const url = new URL(req.url);
  if (url.searchParams.get('action') === 'login') {
    if (!configured()) return json({ error: 'Add SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in Vercel first.' }, 501);
    const state = rand();
    const q = new URLSearchParams({ response_type: 'code', client_id: process.env.SPOTIFY_CLIENT_ID, scope: SCOPES, redirect_uri: origin(req) + '/api/spotify-callback', state });
    return redirect('https://accounts.spotify.com/authorize?' + q, { 'set-cookie': setCookie('sp_state', state, 600) });
  }
  if (!configured()) return json({ configured: false });
  try { return json({ configured: true, linked: true, ...(await now()) }) }
  catch (e) { if (e.code === 'not_linked') return json({ configured: true, linked: false }); return fail(e) }
}

export async function POST(req) {
  if (!isAuthed(req)) return locked();
  if (!configured()) return fail(Object.assign(new Error('Spotify is not set up yet.'), { code: 'not_configured' }));
  let b = {}; try { b = await req.json() } catch {}
  try {
    let said = 'Done';
    switch (b.do) {
      case 'play': said = await play(b); break;
      case 'resume': await playOn(null); said = 'Resumed'; break;
      case 'pause': await api('/me/player/pause', { method: 'PUT' }); said = 'Paused'; break;
      case 'next': await api('/me/player/next', { method: 'POST' }); said = 'Skipped'; break;
      case 'previous': await api('/me/player/previous', { method: 'POST' }); said = 'Went back'; break;
      case 'volume': { const v = Math.max(0, Math.min(100, Math.round(Number(b.value)))); await api('/me/player/volume?volume_percent=' + v, { method: 'PUT' }); said = 'Volume ' + v; break }
      case 'shuffle': await api('/me/player/shuffle?state=' + (b.value === false ? 'false' : 'true'), { method: 'PUT' }); said = 'Shuffle ' + (b.value === false ? 'off' : 'on'); break;
      case 'playlists': return json({ ok: true, playlists: (await myPlaylists()).map(p => p.name) });
      default: return json({ ok: false, error: 'Unknown Spotify action' }, 400);
    }
    return json({ ok: true, said, now: await now().catch(() => null) });
  } catch (e) {
    if (e.status === 403) e.message = 'Spotify refused. Playback control needs Spotify Premium.';
    return fail(e);
  }
}
