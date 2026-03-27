// api/briefing.js — com Vercel KV para persistência real

async function kvGet(key) {
  const url = `${process.env.KV_REST_API_URL}/get/${key}`;
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` }
  });
  const d = await r.json();
  return d.result ? JSON.parse(d.result) : null;
}

async function kvSet(key, value, exSeconds) {
  const url = `${process.env.KV_REST_API_URL}/set/${key}`;
  const body = { value: JSON.stringify(value) };
  if (exSeconds) body.ex = exSeconds;
  await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

async function kvKeys(pattern) {
  const url = `${process.env.KV_REST_API_URL}/keys/${pattern}`;
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` }
  });
  const d = await r.json();
  return d.result || [];
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  const hasKV = !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);

  // ── GET — retorna briefings salvos ────────────────────
  if (req.method === 'GET') {
    const { mes, limit = '30' } = req.query || {};
    try {
      if (hasKV) {
        // Busca índice geral
        const index = await kvGet('briefing:index') || [];
        // Filtra por mês se solicitado (ex: "2026-03")
        let filtered = mes ? index.filter(b => b.mes === mes) : index;
        filtered = filtered.slice(0, parseInt(limit));
        // Carrega dados completos dos mais recentes
        const full = await Promise.all(
          filtered.slice(0, 10).map(b => kvGet('briefing:' + b.id))
        );
        return res.status(200).json({
          ok: true,
          briefings: full.filter(Boolean),
          index: filtered,
          total: index.length,
          meses: [...new Set(index.map(b => b.mes))],
        });
      } else {
        // Fallback memória
        return res.status(200).json({ ok: true, briefings: global._briefings || [], total: (global._briefings || []).length });
      }
    } catch (e) {
      return res.status(500).json({ error: 'Erro ao buscar briefings: ' + e.message });
    }
  }

  // ── POST — processa e salva briefing ─────────────────
  if (req.method === 'POST') {
    const { texto } = req.body || {};
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
            content: `Voce e um assistente politico. Analise o briefing abaixo e extraia os cards por mandato.

REGRAS:
- Retorne APENAS JSON valido, sem markdown, sem blocos de codigo
- Use apenas aspas duplas, nunca apostrofos dentro de valores
- Sem quebras de linha dentro de strings, sem emojis nos valores
- Textos curtos e limpos

BRIEFING:
${texto.substring(0, 3000)}

JSON esperado (retorne APENAS isso):
{
  "data": "27 de marco de 2026",
  "mes": "2026-03",
  "resumo": "panorama do dia em uma frase",
  "mandatos": {
    "lincoln": {
      "nome": "Lincoln Portela",
      "cargo": "Deputado Federal",
      "cards": [
        {
          "titulo": "titulo curto sem pontuacao especial",
          "descricao": "descricao em duas frases sem apostrofos",
          "acao": "acao recomendada em uma frase",
          "copy": "texto para redes sem aspas internas",
          "prioridade": "alta"
        }
      ]
    },
    "marilda": {
      "nome": "Marilda Portela",
      "cargo": "Vereadora",
      "cards": [
        {
          "titulo": "titulo curto",
          "descricao": "descricao em duas frases",
          "acao": "acao recomendada",
          "copy": "texto para redes",
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
      "titulo": "titulo do insight",
      "descricao": "descricao curta",
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

      // Parse robusto
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

      // Garante campo mes
      if (!parsed.mes) {
        const now = new Date();
        parsed.mes = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
      }

      // Gera ID único
      const id = Date.now().toString();
      const entry = { ...parsed, id, timestamp: new Date().toISOString() };

      // Persiste no KV ou memória
      if (hasKV) {
        // Salva briefing completo
        await kvSet('briefing:' + id, entry);
        // Atualiza índice
        const index = await kvGet('briefing:index') || [];
        index.unshift({
          id,
          data: parsed.data || '',
          mes: parsed.mes,
          resumo: parsed.resumo || '',
          timestamp: entry.timestamp,
          totalCards: countCards(parsed),
        });
        await kvSet('briefing:index', index.slice(0, 200)); // máximo 200 no índice
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
  let n = 0;
  Object.values(b.mandatos || {}).forEach(m => { n += m?.cards?.length || 0; });
  return n;
}
