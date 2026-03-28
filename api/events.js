// api/events.js — próximos eventos políticos (CRUD manual)

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
  const s = await kvGet('session:' + token);
  if (!s || new Date(s.expiresAt) < new Date()) return null;
  return s;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const session = await getSession(req);
  if (!session) return res.status(401).json({ error: 'Não autenticado' });

  if (req.method === 'GET') {
    const events = (await kvGet('events:list')) || [];
    const hoje = new Date();
    // Retorna próximos 30 dias, ordenados por data
    const proximos = events
      .filter(e => new Date(e.data) >= hoje)
      .sort((a, b) => new Date(a.data) - new Date(b.data))
      .slice(0, 10);
    return res.status(200).json({ ok: true, events: proximos });
  }

  if (req.method === 'POST') {
    if (!['master', 'admin'].includes(session.role))
      return res.status(403).json({ error: 'Sem permissão' });
    const { titulo, data, mandato, tipo, local } = req.body || {};
    if (!titulo || !data) return res.status(400).json({ error: 'Título e data obrigatórios' });
    const events = (await kvGet('events:list')) || [];
    const novo = { id: Date.now().toString(), titulo, data, mandato: mandato || 'geral', tipo: tipo || 'sessao', local: local || '', criadoEm: new Date().toISOString() };
    events.push(novo);
    events.sort((a, b) => new Date(a.data) - new Date(b.data));
    await kvSet('events:list', events.slice(0, 100));
    return res.status(200).json({ ok: true, event: novo });
  }

  if (req.method === 'DELETE') {
    if (!['master', 'admin'].includes(session.role))
      return res.status(403).json({ error: 'Sem permissão' });
    const { id } = req.body || {};
    let events = (await kvGet('events:list')) || [];
    events = events.filter(e => e.id !== id);
    await kvSet('events:list', events);
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Método não permitido' });
};
