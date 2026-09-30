import { json, isAuthed, locked, localNow, fromLocal } from './_lib.js';

// Sales and revenue from Whop: today, this week, this month, this year, plus the latest payments.
let cache = null;

async function page(key, params) {
  const r = await fetch('https://api.whop.com/api/v1/payments?' + params, { headers: { authorization: 'Bearer ' + key } });
  const body = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, body };
}

export async function GET(req) {
  if (!isAuthed(req)) return locked();
  const key = process.env.WHOP_API_KEY;
  if (!key) return json({ configured: false });
  const force = new URL(req.url).searchParams.has('fresh');
  if (cache && !force && Date.now() - cache.at < 45000) return json(cache.value);

  const { y, m, d, dow, off } = localNow();
  const yearStart = fromLocal(y, 0, 1, off), monthStart = fromLocal(y, m, 1, off), dayStart = fromLocal(y, m, d, off);
  const weekStart = fromLocal(y, m, d - ((dow + 6) % 7), off); // Monday
  const lastWeekStart = new Date(weekStart.getTime() - 7 * 86400000);
  const company = process.env.WHOP_COMPANY_ID;

  const payments = [];
  let after = null, idParam = 'company_id', error = null;
  for (let i = 0; i < 40; i++) {
    const p = new URLSearchParams({ first: '100', order: 'created_at', direction: 'desc', created_after: yearStart.toISOString() });
    if (company) p.set(idParam, company);
    if (after) p.set('after', after);
    let res = await page(key, p);
    if (!res.ok && company && i === 0 && idParam === 'company_id' && (res.status === 400 || res.status === 422)) {
      idParam = 'account_id'; p.delete('company_id'); p.set('account_id', company); res = await page(key, p);
    }
    if (!res.ok) { error = (res.body && (res.body.error?.message || res.body.message)) || ('Whop answered ' + res.status); break }
    payments.push(...(res.body.data || []));
    const info = res.body.page_info || {};
    if (!info.has_next_page || !info.end_cursor) break;
    after = info.end_cursor;
  }
  if (new URL(req.url).searchParams.has('debug')) { const st = {}; for (const p of payments) { const k = p.status + '/' + (p.substatus || ''); st[k] = (st[k] || 0) + 1 } return json({ fetched: payments.length, statuses: st, idParam, company: !!company, error, fields: Object.keys(payments[0] || {}) }) }
  if (error && !payments.length) return json({ configured: true, error }, 502);

  const sum = { today: 0, week: 0, lastWeek: 0, month: 0, year: 0, countToday: 0, countMonth: 0, countYear: 0 };
  const recent = [];
  for (const pay of payments) {
    if (!['paid', 'succeeded'].includes(pay.status) && pay.substatus !== 'succeeded') continue;
    const gross = Number(pay.usd_total ?? pay.total ?? pay.subtotal ?? 0);
    const amount = Math.max(0, gross - Number(pay.refunded_amount || 0));
    const at = new Date(pay.paid_at || pay.created_at);
    if (!amount || isNaN(at)) continue;
    if (at >= yearStart) { sum.year += amount; sum.countYear++ }
    if (at >= monthStart) { sum.month += amount; sum.countMonth++ }
    if (at >= weekStart) sum.week += amount;
    else if (at >= lastWeekStart) sum.lastWeek += amount;
    if (at >= dayStart) { sum.today += amount; sum.countToday++ }
    if (recent.length < 12) recent.push({ id: pay.id, amount, at: at.toISOString(), name: pay.user?.name || pay.user?.username || 'Someone', product: pay.product?.title || 'Rise' });
  }
  for (const k of ['today', 'week', 'lastWeek', 'month', 'year']) sum[k] = Math.round(sum[k] * 100) / 100;
  const value = { configured: true, currency: 'USD', ...sum, recent, partial: !!error, updatedAt: new Date().toISOString() };
  cache = { at: Date.now(), value };
  return json(value);
}
