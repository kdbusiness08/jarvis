import { json, isAuthed, locked } from './_lib.js';

// Streams the AI reply back to the page. Uses Gemini (free tier) if GEMINI_API_KEY is set,
// otherwise Claude via ANTHROPIC_API_KEY. Keys never leave the server.
export const config = { maxDuration: 60 };

const enc = new TextEncoder();
const delta = text => enc.encode('data: ' + JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text } }) + '\n\n');

const tired = globalThis.__jarvisTired || (globalThis.__jarvisTired = new Map()); // model -> retry-after time
const noThink = globalThis.__jarvisNoThink || (globalThis.__jarvisNoThink = new Set()); // models that reject the thinking setting
async function gemini(key, b, messages, signal) {
  // Several free models, each with its own daily allowance. If one is used up, fall through to the next.
  const quick = ['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite', 'gemini-3.5-flash', 'gemini-3-flash-preview'];
  const deep = ['gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3-flash-preview'];
  const pref = b.tier === 'quick' ? process.env.GEMINI_FAST_MODEL : process.env.GEMINI_MODEL;
  const all = [...new Set([...quick, ...deep])];
  const chain = [...new Set([all.includes(b.model) ? b.model : null, pref, ...(b.tier === 'quick' ? quick : deep)].filter(Boolean))];
  const contents = [];
  for (const m of messages) {
    const role = m.role === 'assistant' ? 'model' : 'user';
    const last = contents[contents.length - 1];
    if (last && last.role === role) last.parts[0].text += '\n\n' + m.content; else contents.push({ role, parts: [{ text: m.content }] });
  }
  // Minimal "thinking" so replies start fast. If a model doesn't accept that setting, it's remembered and left off.
  const body = model => JSON.stringify({ systemInstruction: { parts: [{ text: String(b.system || '').slice(0, 200000) }] }, contents, generationConfig: { maxOutputTokens: b.tier === 'quick' ? 1200 : 3000, temperature: 0.8, ...(noThink.has(model) ? {} : { thinkingConfig: { thinkingLevel: 'minimal' } }) } });
  let r = null, lastMsg = '', limited = false, busy = false;
  // Race: start the best model; if it hasn't started answering within ~2 seconds, start the next one too.
  // Whichever answers first wins and the others are cancelled, so one slow model never holds you up.
  const HEDGE = b.tier === 'quick' ? 1800 : 2500, STALL = 15000;
  const attempt = pass => new Promise(resolve => {
    const list = chain.filter(m => pass ? (tired.get(m) || 0) <= Date.now() + 60e3 : (tired.get(m) || 0) <= Date.now());
    if (list.length < chain.length && !pass) limited = true;
    let next = 0, inflight = 0, done = false;
    const ctrls = new Set();
    const finish = v => { if (done) return; done = true; for (const c of ctrls) c.abort(); resolve(v) };
    const launch = () => { if (done || signal?.aborted || next >= list.length) return false; start(list[next++]); return true };
    const start = model => {
      inflight++;
      const ac = new AbortController(); ctrls.add(ac);
      const onAbort = () => ac.abort(); signal?.addEventListener('abort', onAbort);
      const hedge = setTimeout(launch, HEDGE), stall = setTimeout(() => ac.abort(), STALL);
      fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, {
        method: 'POST', signal: ac.signal, headers: { 'content-type': 'application/json', 'x-goog-api-key': key }, body: body(model)
      }).then(async res => {
        clearTimeout(stall);
        if (done) { try { res.body?.cancel() } catch {} return }
        if (res.ok) { ctrls.delete(ac); clearTimeout(hedge); finish({ res, model }); return }
        clearTimeout(hedge);
        try { lastMsg = (await res.json()).error.message } catch { lastMsg = 'Gemini answered ' + res.status }
        if (res.status === 400 && /think/i.test(lastMsg) && !noThink.has(model)) { noThink.add(model); list.splice(next, 0, model) }
        else if (res.status === 429) { limited = true; tired.set(model, Date.now() + (/per.?day|daily|PerDay/i.test(lastMsg) ? 3600e3 : 60e3)) }
        else if (res.status === 404 || res.status === 400) tired.set(model, Date.now() + 6 * 3600e3);
        else if (res.status >= 500) { busy = true; tired.set(model, Date.now() + 30e3) }
        else { lastMsg = lastMsg || 'error ' + res.status }
        launch();
      }).catch(() => { clearTimeout(stall); clearTimeout(hedge); if (!signal?.aborted && !done) { busy = true; lastMsg = 'timed out'; launch() } })
        .finally(() => { signal?.removeEventListener('abort', onAbort); inflight--; if (!done && inflight === 0 && !launch()) finish(null) });
    };
    if (!launch()) finish(null);
  });
  for (let pass = 0; pass < 2 && !r; pass++) {
    if (pass) { if (!busy) break; await new Promise(res => setTimeout(res, 1200)) }
    if (signal?.aborted) return json({ error: 'cancelled' }, 499);
    const got = await attempt(pass);
    if (got) r = got.res;
  }
  if (!r) return json({ error: busy ? "Google's AI is swamped at the moment, sir. Give me a few seconds and ask again." : limited ? "I've used up today's free AI allowance, sir. Music, pause and skip still work, and the rest resets within the day." : lastMsg }, limited && !busy ? 429 : 503);
  // Re-shape Gemini's stream into the same events the page already understands.
  const reader = r.body.getReader(), dec = new TextDecoder();
  let buf = '';
  const out = new ReadableStream({
    async pull(ctrl) {
      // Keep reading until we have something to send, and close as soon as Gemini says it's finished.
      for (;;) {
        const { value, done } = await reader.read();
        if (done) { ctrl.close(); return }
        buf += dec.decode(value, { stream: true });
        let i, sent = false, finished = false;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
          if (!line.startsWith('data:')) continue;
          try {
            const d = JSON.parse(line.slice(5));
            const c = d.candidates?.[0];
            const text = (c?.content?.parts || []).filter(p => !p.thought).map(p => p.text || '').join('');
            if (text) { ctrl.enqueue(delta(text)); sent = true }
            if (c?.finishReason) finished = true;
          } catch {}
        }
        if (finished) { ctrl.close(); reader.cancel().catch(() => {}); return }
        if (sent) return;
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

// The page pings this every few minutes so the server is already awake when you speak.
export async function GET() { return json({ ok: true }) }

export async function POST(req) {
  if (!isAuthed(req)) return locked();
  const gKey = process.env.GEMINI_API_KEY, aKey = process.env.ANTHROPIC_API_KEY;
  if (!gKey && !aKey) return json({ error: 'No AI key yet. Add GEMINI_API_KEY (free) in Vercel.' }, 501);
  let b; try { b = await req.json() } catch { return json({ error: 'Bad request' }, 400) }
  const messages = (Array.isArray(b.messages) ? b.messages : []).filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim()).slice(-24);
  if (!messages.length || messages[0].role !== 'user') return json({ error: 'Bad request' }, 400);
  return gKey ? gemini(gKey, b, messages, req.signal) : claude(aKey, b, messages, req.signal);
}
