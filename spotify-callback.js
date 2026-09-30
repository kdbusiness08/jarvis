import { redirect, isAuthed, getCookie, setCookie, origin, form, kset } from './_lib.js';

// Spotify sends you back here after you approve Jarvis.
export async function GET(req) {
  const url = new URL(req.url);
  const back = msg => redirect('/?linked=spotify&result=' + encodeURIComponent(msg), { 'set-cookie': setCookie('sp_state', '', 0) });
  if (!isAuthed(req)) return redirect('/');
  if (url.searchParams.get('error')) return back('Spotify connection was cancelled.');
  if (!url.searchParams.get('state') || url.searchParams.get('state') !== getCookie(req, 'sp_state')) return back('Spotify connection expired. Try again.');
  const basic = 'Basic ' + Buffer.from(process.env.SPOTIFY_CLIENT_ID + ':' + process.env.SPOTIFY_CLIENT_SECRET).toString('base64');
  const t = await form('https://accounts.spotify.com/api/token', { grant_type: 'authorization_code', code: url.searchParams.get('code'), redirect_uri: origin(req) + '/api/spotify-callback' }, { authorization: basic });
  if (!t.refresh_token) return back('Spotify said: ' + (t.error_description || t.error || 'unknown error'));
  await kset('spotify:refresh', t.refresh_token);
  await kset('spotify:token', { access: t.access_token, exp: Date.now() + (t.expires_in || 3600) * 1000 });
  return back('ok');
}
