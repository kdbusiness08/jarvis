import { json, isAuthed, locked } from './_lib.js';

// Human-sounding voice for Jarvis using Google's Gemini speech models (same free key as the brain).
// Returns a WAV clip. If every model is busy or out of free allowance, the page falls back to the built-in voice.
export const config = { maxDuration: 30 };

const tired = globalThis.__jarvisVoiceTired || (globalThis.__jarvisVoiceTired = new Map());
const MODELS = ['gemini-3.8-flash-tts', 'gemini-3.8-flash-lite-tts', 'gemini-3.1-flash-tts-preview'];
const VOICES = new Set(['Charon', 'Algieba', 'Iapetus', 'Rasalgethi', 'Sadaltager', 'Schedar', 'Orus', 'Enceladus', 'Alnilam', 'Gacrux', 'Achird', 'Umbriel']);

function wav(pcm, rate = 24000) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

export async function POST(req) {
  if (!isAuthed(req)) return locked();
  const key = process.env.GEMINI_API_KEY;
  if (!key) return json({ error: 'no_key' }, 501);
  let b; try { b = await req.json() } catch { return json({ error: 'Bad request' }, 400) }
  const text = String(b.text || '').trim().slice(0, 1500);
  if (!text) return json({ error: 'Bad request' }, 400);
  const voice = VOICES.has(b.voice) ? b.voice : (process.env.JARVIS_VOICE || 'Charon');
  const style = 'Read this aloud in a calm, warm, refined British accent, like a polished English butler. Natural pace, relaxed and confident, never robotic';
  const body = JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: `${style}:\n${text}` }] }],
    generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } }
  });
  let last = '', limited = false;
  for (const model of [process.env.JARVIS_VOICE_MODEL, ...MODELS].filter(Boolean)) {
    if ((tired.get(model) || 0) > Date.now()) { limited = true; continue }
    const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 12000);
    let r;
    try {
      r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST', signal: ac.signal, headers: { 'content-type': 'application/json', 'x-goog-api-key': key }, body
      });
    } catch { last = 'timed out'; continue }
    finally { clearTimeout(t) }
    if (!r.ok) {
      try { last = (await r.json()).error.message } catch { last = 'status ' + r.status }
      if (r.status === 429) { limited = true; tired.set(model, Date.now() + (/per.?day|daily|PerDay/i.test(last) ? 3600e3 : 60e3)) }
      else if (r.status === 404 || r.status === 400 || r.status === 403) tired.set(model, Date.now() + 6 * 3600e3);
      else tired.set(model, Date.now() + 20e3);
      continue;
    }
    let d; try { d = await r.json() } catch { last = 'bad reply'; continue }
    const part = (d.candidates?.[0]?.content?.parts || []).find(p => p.inlineData?.data);
    if (!part) { last = 'no audio'; continue }
    const rate = Number(/rate=(\d+)/.exec(part.inlineData.mimeType || '')?.[1]) || 24000;
    const out = wav(Buffer.from(part.inlineData.data, 'base64'), rate);
    return new Response(out, { headers: { 'content-type': 'audio/wav', 'cache-control': 'no-store', 'x-model': model } });
  }
  return json({ error: limited ? 'limit' : last || 'unavailable' }, limited ? 429 : 503);
}
