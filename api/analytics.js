// api/analytics.js — rastreamento de eventos dos assessores

const KV_URL   = () => process.env.KV_REST_API_URL;
const KV_TOKEN = () => process.env.KV_REST_API_TOKEN;

async function kvSet(key, value) {
  const body = typeof value === 'string' ? value : JSON.stringify(value);
  await fetch(`${KV_URL()}/set/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN()}`, 'Content-Type': 'application/json' },
    body,
  });
}

async function kvGet(key) {
  const r = await fetch(`${KV_URL()}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN()}` },
  });
  const d = await r.json();
  if (!d.result) return null;
  let v = d.result;
  for (let i = 0; i < 3; i++) {
    if (typeof v !== 'string') break;
    try { v = JSON.parse(v); } catch { break; }
  }
  return v;
}

async function getSession(req) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return null;
  const session = await kvGet('session:' + token);
  if (!session) return null;
  if (new Date(session.expiresAt) < new Date()) return null;
  return session;
}

function getWeekKey(date = new Date()) {
  const d = new Date(date);
  const jan1 = new Date(d.getFullYear(), 0, 1);
  const week = Math.ceil(((d - jan1) / 86400000 + jan1.getDay() + 1) / 7);
  return `${d.getFullYear()}-W${String(week).padStart(2, '0')}`;
}

function getDevice(ua = '') {
  if (/mobile|android|iphone|ipad/i.test(ua)) return 'mobile';
  if (/tablet/i.test(ua)) return 'tablet';
  return 'desktop';
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action } = req.query || {};

  // ── POST: registra evento ─────────────────────────────
  if (req.method === 'POST' && action === 'track') {
    const session = await getSession(req);
    if (!session) return res.status(401).json({ error: 'Não autenticado' });

    const { type, data } = req.body || {};
    // tipos: page_view, card_view, copy_click, heartbeat, logout
    const evento = {
      type, data: data || {},
      email: session.email,
      name: session.name,
      role: session.role,
      ts: new Date().toISOString(),
      device: getDevice(req.headers['user-agent']),
      week: getWeekKey(),
    };

    const eventId = Date.now().toString() + Math.random().toString(36).slice(2, 5);
    await kvSet('analytics:event:' + eventId, evento);

    // Atualiza sumário do usuário na semana
    const weekKey = `analytics:user:${session.email}:${evento.week}`;
    const summary = (await kvGet(weekKey)) || {
      email: session.email, name: session.name,
      week: evento.week, sessions: 0, totalTime: 0,
      cardsViewed: [], copiesMade: [], lastSeen: null,
      devices: {}, accessTimes: [],
    };

    if (type === 'page_view') {
      summary.sessions = (summary.sessions || 0) + 1;
      summary.lastSeen = evento.ts;
      const hour = new Date(evento.ts).getHours();
      summary.accessTimes = [...(summary.accessTimes || []), hour].slice(-50);
      summary.devices = summary.devices || {};
      summary.devices[evento.device] = (summary.devices[evento.device] || 0) + 1;
    }
    if (type === 'card_view' && data?.cardTitle) {
      summary.cardsViewed = [...(summary.cardsViewed || []), { title: data.cardTitle, mandato: data.mandato, ts: evento.ts }].slice(-100);
    }
    if (type === 'copy_click' && data?.copyPreview) {
      summary.copiesMade = [...(summary.copiesMade || []), { preview: data.copyPreview.substring(0, 60), mandato: data.mandato, ts: evento.ts }].slice(-100);
    }
    if (type === 'heartbeat') {
      summary.totalTime = (summary.totalTime || 0) + 30; // 30s por heartbeat
      summary.lastSeen = evento.ts;
    }

    await kvSet(weekKey, summary);

    // Índice de eventos da semana
    const weekIdx = (await kvGet('analytics:week:' + evento.week)) || [];
    if (!weekIdx.includes(session.email)) {
      weekIdx.unshift(session.email);
      await kvSet('analytics:week:' + evento.week, weekIdx.slice(0, 200));
    }

    return res.status(200).json({ ok: true });
  }

  // ── GET: dashboard do master ──────────────────────────
  if (req.method === 'GET') {
    const session = await getSession(req);
    if (!session || session.role !== 'master')
      return res.status(403).json({ error: 'Apenas o Master pode ver analytics' });

    const week = req.query.week || getWeekKey();
    const weekEmails = (await kvGet('analytics:week:' + week)) || [];

    const summaries = await Promise.all(
      weekEmails.map(email => kvGet(`analytics:user:${email}:${week}`).catch(() => null))
    );
    const valid = summaries.filter(Boolean);

    // Agrega dados
    const totalSessions = valid.reduce((n, s) => n + (s.sessions || 0), 0);
    const totalTime = valid.reduce((n, s) => n + (s.totalTime || 0), 0);

    // Top cards
    const cardCount = {};
    valid.forEach(s => (s.cardsViewed || []).forEach(c => {
      cardCount[c.title] = (cardCount[c.title] || 0) + 1;
    }));
    const topCards = Object.entries(cardCount).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([t, n]) => ({ title: t, count: n }));

    // Top copies
    const copyCount = {};
    valid.forEach(s => (s.copiesMade || []).forEach(c => {
      copyCount[c.preview] = (copyCount[c.preview] || 0) + 1;
    }));
    const topCopies = Object.entries(copyCount).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([p, n]) => ({ preview: p, count: n }));

    // Horários de pico
    const hours = {};
    valid.forEach(s => (s.accessTimes || []).forEach(h => { hours[h] = (hours[h] || 0) + 1; }));

    return res.status(200).json({
      ok: true,
      week,
      totalAssessores: weekEmails.length,
      totalSessions,
      totalTimeMin: Math.round(totalTime / 60),
      topCards,
      topCopies,
      hours,
      assessores: valid.map(s => ({
        email: s.email, name: s.name,
        sessions: s.sessions || 0,
        totalTimeMin: Math.round((s.totalTime || 0) / 60),
        cardsViewed: s.cardsViewed?.length || 0,
        copiesMade: s.copiesMade?.length || 0,
        lastSeen: s.lastSeen,
        devices: s.devices || {},
      })).sort((a, b) => b.sessions - a.sessions),
    });
  }

  return res.status(405).json({ error: 'Método não permitido' });
};
