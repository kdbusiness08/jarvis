import { json, isAuthed, locked, hasStore, kget, TZ } from './_lib.js';

// Which connections are set up. Never returns secrets.
export async function GET(req) {
  if (!isAuthed(req)) return locked();
  let spotifyLinked = false, googleLinked = false, storeOk = hasStore(), storeError = null;
  try { spotifyLinked = !!(await kget('spotify:refresh')); googleLinked = !!(await kget('google:refresh')) } catch (e) { storeOk = false; storeError = e.message }
  const env = process.env;
  return json({
    brain: !!(env.GEMINI_API_KEY || env.ANTHROPIC_API_KEY),
    voice: !!env.GEMINI_API_KEY,
    store: storeOk, storeError, tz: TZ(),
    whop: !!env.WHOP_API_KEY,
    spotify: { configured: !!(env.SPOTIFY_CLIENT_ID && env.SPOTIFY_CLIENT_SECRET), linked: spotifyLinked },
    zoom: !!(env.ZOOM_ACCOUNT_ID && env.ZOOM_CLIENT_ID && env.ZOOM_CLIENT_SECRET),
    google: { configured: !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET), linked: googleLinked }
  });
}
