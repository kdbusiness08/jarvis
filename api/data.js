import { json, isAuthed, locked, kget, kset, hasStore } from './_lib.js';

// Jarvis's memory: leads, clients, sales, tasks, notes and goals, synced across your devices.
export async function GET(req) {
  if (!isAuthed(req)) return locked();
  try { return json({ data: await kget('data'), store: hasStore() }) }
  catch (e) { return json({ error: e.message }, 502) }
}
export async function PUT(req) {
  if (!isAuthed(req)) return locked();
  const text = await req.text();
  if (text.length > 900000) return json({ error: 'Memory is full. Clear out old notes or records.' }, 413);
  let data; try { data = JSON.parse(text) } catch { return json({ error: 'Bad data' }, 400) }
  if (!data || typeof data !== 'object' || !Array.isArray(data.records)) return json({ error: 'Bad data' }, 400);
  try { await kset('data', data); return json({ ok: true, store: hasStore() }) }
  catch (e) { return json({ error: e.message }, 502) }
}
