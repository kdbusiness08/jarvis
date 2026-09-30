// Shared helpers for Jarvis server functions. Files starting with "_" are not deployed as endpoints.
import crypto from 'node:crypto';

export const TZ = () => process.env.JARVIS_TZ || 'Australia/Brisbane';
const PASSWORD = () => process.env.JARVIS_PASSWORD || 'jarvis';
const SECRET = () => process.env.SESSION_SECRET || ('jarvis:' + (process.env.ANTHROPIC_API_KEY || 'local-dev'));
const DAY = 86400;

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers } });
}
export function redirect(to, headers = {}) {
  return new Response(null, { status: 302, headers: { location: to, 'cache-control': 'no-store', ...headers } });
}

/* ---------- lock screen session ---------- */
const sign = v => crypto.createHmac('sha256', SECRET()).update(v).digest('base64url');
function safeEq(a, b) { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y) }
export function checkPassword(p) { return safeEq(String(p || '').trim().toLowerCase(), PASSWORD().toLowerCase()) }
export function newSession() { const v = Date.now().toString(36); return v + '.' + sign(v) }
export function getCookie(req, name) {
  const m = (req.headers.get('cookie') || '').match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : null;
}
export function setCookie(name, value, maxAge) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}
export function sessionCookie(v) { return setCookie('jarvis_session', v, v ? 30 * DAY : 0) }
export function isAuthed(req) {
  const c = getCookie(req, 'jarvis_session'); if (!c) return false;
  const [v, s] = c.split('.'); if (!v || !s || !safeEq(s, sign(v))) return false;
  return Date.now() - parseInt(v, 36) < 30 * DAY * 1000;
}
export const locked = () => json({ error: 'locked' }, 401);

/* ---------- storage (Upstash Redis via Vercel, memory fallback for local testing) ---------- */
const rurl = () => process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const rtok = () => process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const mem = globalThis.__jarvisMem || (globalThis.__jarvisMem = new Map());
export const hasStore = () => !!(rurl() && rtok());
async function redis(cmd) {
  const r = await fetch(rurl(), { method: 'POST', headers: { authorization: 'Bearer ' + rtok() }, body: JSON.stringify(cmd) });
  const j = await r.json().catch(() => ({ error: 'bad storage response' }));
  if (j.error) throw new Error('Storage: ' + j.error);
  return j.result;
}
export async function kget(k) {
  if (!hasStore()) return mem.has(k) ? mem.get(k) : null;
  const v = await redis(['GET', 'jarvis:' + k]); return v == null ? null : JSON.parse(v);
}
export async function kset(k, v) {
  if (!hasStore()) { mem.set(k, v); return }
  await redis(['SET', 'jarvis:' + k, JSON.stringify(v)]);
}
export async function kdel(k) { if (!hasStore()) { mem.delete(k); return } await redis(['DEL', 'jarvis:' + k]) }

export function origin(req) {
  const u = new URL(req.url);
  const proto = req.headers.get('x-forwarded-proto') || u.protocol.replace(':', '');
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || u.host;
  return proto + '://' + host;
}
export const rand = () => crypto.randomBytes(16).toString('hex');

/* ---------- time zone helpers ---------- */
export function tzOffsetMs(date = new Date(), tz = TZ()) {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(date);
  const g = t => +p.find(x => x.type === t).value;
  return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second')) - Math.floor(date.getTime() / 1000) * 1000;
}
// Local wall-clock parts "now" in the configured zone
export function localNow() { const off = tzOffsetMs(); const d = new Date(Date.now() + off); return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), dow: d.getUTCDay(), off } }
// Convert a local wall-clock time to a real Date
export function fromLocal(y, m, d, off) { return new Date(Date.UTC(y, m, d) - off) }

/* ---------- OAuth token store for Spotify / Google ---------- */
export async function accessToken(name, refreshFn) {
  const t = await kget(name + ':token');
  if (t && t.exp > Date.now() + 60000) return t.access;
  const refresh = await kget(name + ':refresh');
  if (!refresh) { const e = new Error('not_linked'); e.code = 'not_linked'; throw e }
  const res = await refreshFn(refresh);
  if (!res.access_token) { const e = new Error('Could not refresh ' + name + ' login: ' + (res.error_description || res.error || 'unknown')); e.code = 'relink'; throw e }
  await kset(name + ':token', { access: res.access_token, exp: Date.now() + (res.expires_in || 3600) * 1000 });
  if (res.refresh_token) await kset(name + ':refresh', res.refresh_token);
  return res.access_token;
}
export async function form(url, params, headers = {}) {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers }, body: new URLSearchParams(params) });
  return r.json().catch(() => ({ error: 'bad_response' }));
}
export function fail(e) {
  const code = e.code || 'error';
  return json({ ok: false, code, error: e.message || String(e) }, code === 'not_linked' ? 409 : code === 'not_configured' ? 501 : 502);
}
