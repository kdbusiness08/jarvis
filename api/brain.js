import { json, isAuthed, locked } from './_lib.js';

// Streams the AI reply back to the page. Uses Gemini (free tier) if GEMINI_API_KEY is set,
// otherwise Claude via ANTHROPIC_API_KEY. Keys never leave the server.
export const config = { maxDuration: 60 };

const enc = new TextEncoder();
const delta = text => enc.encode('data: ' + JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text } }) + '\n\n');

async function gemini(key, b, messages, signal) {
  const model = b.tier === 'quick' ? (process.env.GEMINI_FAST_MODEL || 'gemini-3.5-flash') : (process.env.GEMINI_MODEL || 'gemini-3.5-flash');
  const contents = [];
  for (const m of messages) {
    const role = m.role === 'assistant' ? 'model' : 'user';
    const last = contents[contents.length - 1];
    if (last && last.role === role) last.parts[0].text += '\n\n' + m.content; else contents.push({ role, parts: [{ text: m.content }] });
  }
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, {
    method: 'POST', signal,
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({ systemInstruction: { parts: [{ text: String(b.system || '').slice(0, 200000) }] }, contents, generationConfig: { maxOutputTokens: b.tier === 'quick' ? 1200 : 3000, temperature: 0.8 } })
  });
  if (!r.ok) {
    let msg = 'Gemini answered ' + r.status; try { msg = (await r.json()).error.message } catch {}
    return json({ error: msg }, r.status === 429 ? 429 : 502);
  }
  // Re-shape Gemini's stream into the same events the page already understands.
  const reader = r.body.getReader(), dec = new TextDecoder();
  let buf = '';
  const out = new ReadableStream({
    async pull(ctrl) {
      const { value, done } = await reader.read();
      if (done) { ctrl.close(); return }
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line.startsWith('data:')) continue;
        try {
          const d = JSON.parse(line.slice(5));
          const text = (d.candidates?.[0]?.content?.parts || []).filter(p => !p.thought).map(p => p.text || '').join('');
          if (text) ctrl.enqueue(delta(text));
        } catch {}
      }
    },
    cancel() { reader.cancel() }
  });
  return new Response(out, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store' } });
}

async function claude(key, b, messages, signal) {
  const model = b.tier === 'quick'
    ? (process.env.JARVIS_FAST_MODEL || 'claude-haiku-4-5-20251001')
    : (process.env.JARVIS_MODEL || 'claude-sonnet-5-5');
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', signal,
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens: b.tier === 'quick' ? 900 : 2500, stream: true, system: String(b.system || '').slice(0, 200000), messages })
  });
  if (!r.ok) {
    let msg = r.status + ''; try { msg = (await r.json()).error.message } catch {}
    return json({ error: msg }, r.status === 401 ? 502 : r.status);
  }
  return new Response(r.body, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store' } });
}

export async function POST(req) {
  if (!isAuthed(req)) return locked();
  const gKey = process.env.GEMINI_API_KEY, aKey = process.env.ANTHROPIC_API_KEY;
  if (!gKey && !aKey) return json({ error: 'No AI key yet. Add GEMINI_API_KEY (free) in Vercel.' }, 501);
  let b; try { b = await req.json() } catch { return json({ error: 'Bad request' }, 400) }
  const messages = (Array.isArray(b.messages) ? b.messages : []).filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim()).slice(-24);
  if (!messages.length || messages[0].role !== 'user') return json({ error: 'Bad request' }, 400);
  return gKey ? gemini(gKey, b, messages, req.signal) : claude(aKey, b, messages, req.signal);
}
