import { redirect, isAuthed, getCookie, setCookie, origin, form, kset } from './_lib.js';

// Google sends you back here after you approve Jarvis.
export async function GET(req) {
  const url = new URL(req.url);
  const back = msg => redirect('/?linked=google&result=' + encodeURIComponent(msg), { 'set-cookie': setCookie('g_state', '', 0) });
  if (!isAuthed(req)) return redirect('/');
  if (url.searchParams.get('error')) return back('Google connection was cancelled.');
  if (!url.searchParams.get('state') || url.searchParams.get('state') !== getCookie(req, 'g_state')) return back('Google connection expired. Try again.');
  const t = await form('https://oauth2.googleapis.com/token', { grant_type: 'authorization_code', code: url.searchParams.get('code'), redirect_uri: origin(req) + '/api/google-callback', client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET });
  if (!t.refresh_token) return back('Google said: ' + (t.error_description || t.error || 'no long-term access was granted. Remove Jarvis at myaccount.google.com/permissions and connect again.'));
  await kset('google:refresh', t.refresh_token);
  await kset('google:token', { access: t.access_token, exp: Date.now() + (t.expires_in || 3600) * 1000 });
  return back('ok');
}
