import { json, isAuthed, locked } from './_lib.js';

// Streams Claude's reply back to the page. The API key never leaves the server.
export async function POST(req) {
  if (!isAuthed(req)) return locked();
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return json({ error: 'ANTHROPIC_API_KEY is not set in Vercel yet.' }, 501);
  let b; try { b = await req.json() } catch { return json({ error: 'Bad request' }, 400) }
  const messages = (Array.isArray(b.messages) ? b.messages : []).filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim()).slice(-24);
  if (!messages.length || messages[0].role !== 'user') return json({ error: 'Bad request' }, 400);
  const model = b.tier === 'quick'
    ? (process.env.JARVIS_FAST_MODEL || 'claude-haiku-4-5-20251001')
    : (process.env.JARVIS_MODEL || 'claude-sonnet-5-5');
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', signal: req.signal,
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens: b.tier === 'quick' ? 900 : 2500, stream: true, system: String(b.system || '').slice(0, 200000), messages })
  });
  if (!r.ok) {
    let msg = r.status + ''; try { msg = (await r.json()).error.message } catch {}
    return json({ error: msg }, r.status === 401 ? 502 : r.status);
  }
  return new Response(r.body, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store' } });
}
