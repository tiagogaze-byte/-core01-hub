// api/briefing.js — Upstash Redis REST API

// Upstash usa comandos Redis via HTTP: /set/key/value e /get/key
async function kvSet(key, value) {
  const url = `${process.env.KV_REST_API_URL}/set/${encodeURIComponent(key)}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(JSON.stringify(value)), // Upstash espera string
  });
  return r.json();
}

async function kvGet(key) {
  const url = `${process.env.KV_REST_API_URL}/get/${encodeURIComponent(key)}`;
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` }
  });
  const d = await r.json();
  if (!d.result) return null;
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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  const hasKV = !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);

  // ── GET ────────────────────────────────────────────────
  if (req.method === 'GET') {
    const mes = req.query?.mes || '';
    try {
      if (hasKV) {
        const rawIndex = await kvGet('briefing:index');
        const index = toArray(rawIndex);
        const filtered = mes ? index.filter(b => b.mes === mes) : index;
        const top10 = filtered.slice(0, 10);
        const full = await Promise.all(top10.map(b => kvGet('briefing:' + b.id)));
        const meses = [...new Set(index.map(b => b.mes).filter(Boolean))];
        return res.status(200).json({
          ok: true,
          briefings: full.filter(Boolean),
          index: filtered,
          total: index.length,
          meses,
        });
      } else {
        const list = toArray(global._briefings);
        return res.status(200).json({ ok: true, briefings: list, total: list.length, meses: [], index: [] });
      }
    } catch (e) {
      return res.status(500).json({ error: 'Erro ao buscar briefings: ' + e.message });
    }
  }

  // ── POST ───────────────────────────────────────────────
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
          max_tokens: 2000,
          messages: [{
            role: 'user',
            content: `Voce e um assistente politico. Analise o briefing abaixo e extraia TUDO por mandato.

REGRAS CRITICAS:
- Retorne APENAS JSON valido, sem markdown, sem blocos de codigo
- Use apenas aspas duplas, nunca apostrofos ou aspas curvas dentro de valores
- Sem quebras de linha dentro de strings
- Extraia a DATA REAL do briefing — ela aparece no cabecalho como "quinta-feira, 26 de marco de 2026" ou similar
- O campo "mes" deve ser no formato "2026-03" (ano-mes)
- Extraia TODOS os tipos de conteudo: pautas, copy pronta, trends, insights criativos, instrucoes de uso

BRIEFING:
${texto.substring(0, 3500)}

Retorne APENAS este JSON:
{
  "data": "26 de marco de 2026",
  "mes": "2026-03",
  "resumo": "panorama do dia em uma frase simples",
  "mandatos": {
    "lincoln": {
      "nome": "Lincoln Portela",
      "cargo": "Deputado Federal",
      "cards": [
        {
          "titulo": "titulo curto da pauta principal",
          "descricao": "o que esta acontecendo em duas frases",
          "acao": "o que o mandato deve fazer em uma frase",
          "copy": "texto pronto para redes sociais sem aspas internas",
          "trend": "instrucao de como usar nos canais ex: Poste no Status do WhatsApp...",
          "prioridade": "alta"
        }
      ]
    },
    "marilda": {
      "nome": "Marilda Portela",
      "cargo": "Vereadora",
      "cards": [
        {
          "titulo": "titulo curto da pauta principal",
          "descricao": "o que esta acontecendo em duas frases",
          "acao": "o que o mandato deve fazer em uma frase",
          "copy": "texto pronto para redes sociais sem aspas internas",
          "insight": "instrucao criativa de como distribuir o conteudo ex: Mande nos grupos de...",
          "prioridade": "media"
        }
      ]
    },
    "ale": {
      "nome": "Ale Portela",
      "cargo": "Deputada Estadual",
      "cards": []
    }
  },
  "insights": [
    {
      "titulo": "titulo do insight viral disruptivo",
      "descricao": "como executar o insight em uma frase",
      "mandato": "lincoln"
    }
  ]
}`
          }],
        })
      });

      const data = await r.json();
      const raw = data?.content?.[0]?.text?.trim();
      if (!raw) throw new Error('Resposta vazia do Claude');

      let parsed = null;
      for (const fn of [
        () => JSON.parse(raw),
        () => JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0]),
        () => JSON.parse(raw.replace(/```json|```/g, '').trim()),
        () => JSON.parse(raw.replace(/```json|```/g,'').replace(/[\u2018\u2019]/g,"'").replace(/[\u201C\u201D]/g,'"').match(/\{[\s\S]*\}/)?.[0]),
      ]) {
        try { parsed = fn(); if (parsed) break; } catch {}
      }
      if (!parsed) throw new Error('JSON invalido na resposta do Claude');

      // Data manual tem prioridade sobre o que o Claude extraiu
      if (dataManual?.label) parsed.data = dataManual.label;
      if (dataManual?.mes) parsed.mes = dataManual.mes;
      if (titulo) parsed.titulo = titulo;

      // Garante mes
      if (!parsed.mes) {
        const now = new Date();
        parsed.mes = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
      }

      const id = Date.now().toString();
      const entry = { ...parsed, id, timestamp: new Date().toISOString() };

      if (hasKV) {
        await kvSet('briefing:' + id, entry);
        const rawIndex = await kvGet('briefing:index');
        const index = toArray(rawIndex);
        index.unshift({
          id,
          data: parsed.data || '',
          mes: parsed.mes,
          resumo: parsed.resumo || '',
          timestamp: entry.timestamp,
          totalCards: countCards(parsed),
        });
        await kvSet('briefing:index', index.slice(0, 500));
      } else {
        if (!global._briefings) global._briefings = [];
        global._briefings.unshift(entry);
        global._briefings = global._briefings.slice(0, 30);
      }

      return res.status(200).json({ ok: true, briefing: parsed, id, persistido: hasKV });

    } catch (e) {
      return res.status(500).json({ error: 'Falha ao processar briefing: ' + e.message });
    }
  }

  return res.status(405).json({ error: 'Metodo nao permitido' });
};

function countCards(b) {
  return Object.values(b.mandatos || {}).reduce((n, m) => n + (m?.cards?.length || 0), 0);
}
