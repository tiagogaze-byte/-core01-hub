// api/briefing.js — Upstash Redis REST API v8

async function kvSet(key, value) {
  const url = `${process.env.KV_REST_API_URL}/set/${encodeURIComponent(key)}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(value),
  });
  return r.json();
}

async function kvGet(key) {
  const url = `${process.env.KV_REST_API_URL}/get/${encodeURIComponent(key)}`;
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` },
  });
  const d = await r.json();
  if (d.result === null || d.result === undefined) return null;
  try { return JSON.parse(d.result); } catch { return d.result; }
}

function toArray(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  if (typeof val === 'object') return Object.values(val);
  return [];
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  const hasKV = !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);

  if (req.method === 'GET') {
    const mes = req.query?.mes || '';
    const id = req.query?.id || '';
    try {
      if (hasKV) {
        if (id) {
          const briefing = await kvGet('briefing:' + id);
          if (!briefing) return res.status(404).json({ ok: false, error: 'Briefing não encontrado' });
          return res.status(200).json({ ok: true, briefing });
        }
        const rawIndex = await kvGet('briefing:index');
        const index = toArray(rawIndex);
        const filtered = mes ? index.filter(b => b.mes === mes) : index;
        const top50 = filtered.slice(0, 50);
        const full = await Promise.all(top50.map(b => kvGet('briefing:' + b.id)));
        const meses = [...new Set(index.map(b => b.mes).filter(Boolean))].sort().reverse();
        return res.status(200).json({ ok: true, briefings: full.filter(Boolean), index: filtered, total: index.length, meses });
      } else {
        const list = toArray(global._briefings);
        const filtered = mes ? list.filter(b => b.mes === mes) : list;
        if (id) {
          const briefing = list.find(b => b.id == id);
          if (!briefing) return res.status(404).json({ ok: false, error: 'Briefing não encontrado' });
          return res.status(200).json({ ok: true, briefing });
        }
        return res.status(200).json({ ok: true, briefings: filtered, total: list.length, meses: [], index: [] });
      }
    } catch (e) {
      return res.status(500).json({ error: 'Erro ao buscar briefings: ' + e.message });
    }
  }

  if (req.method === 'POST') {
    const { texto, dataManual, titulo } = req.body || {};
    if (!texto || texto.trim().length < 50)
      return res.status(400).json({ error: 'Texto muito curto ou vazio.' });
    if (!ANTHROPIC_KEY)
      return res.status(500).json({ error: 'ANTHROPIC_API_KEY nao configurada.' });

    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 3000,
          messages: [{
            role: 'user',
            content: `Voce e um assistente politico. Analise o briefing abaixo e extraia TODAS as pautas por mandato.

REGRAS CRITICAS:
- Retorne APENAS JSON valido, sem markdown, sem blocos de codigo
- Use apenas aspas duplas, nunca apostrofos ou aspas curvas dent
