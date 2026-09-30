import { json, checkPassword, newSession, sessionCookie, isAuthed } from './_lib.js';

// GET: is this browser signed in?  POST {password}: unlock.  DELETE: lock.
export function GET(req) { return json({ authed: isAuthed(req) }) }
export async function POST(req) {
  let body = {}; try { body = await req.json() } catch {}
  if (!checkPassword(body.password)) { await new Promise(r => setTimeout(r, 700)); return json({ ok: false }, 401) }
  return json({ ok: true }, 200, { 'set-cookie': sessionCookie(newSession()) });
}
export function DELETE() { return json({ ok: true }, 200, { 'set-cookie': sessionCookie('') }) }
