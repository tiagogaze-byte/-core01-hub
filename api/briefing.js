// api/briefing.js — processa briefing da Geni e publica no HUB

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

  // GET
  if (req.method === 'GET') {
    return res.status(200).json({ ok: true, briefings: global._briefings || [], lastUpdate: global._lastUpdate || null });
  }

  // POST
  if (req.method === 'POST') {
    const { texto } = req.body || {};
    if (!texto || texto.trim().length < 50) {
      return res.status(400).json({ error: 'Texto muito curto ou vazio.' });
    }
    if (!ANTHROPIC_KEY) {
      return res.status(500).json({ error: 'ANTHROPIC_API_KEY nao configurada.' });
    }

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
            content: `Voce e um assistente politico. Analise o briefing abaixo e extraia os cards organizados por mandato.

REGRAS CRITICAS:
- Retorne APENAS JSON valido, sem markdown, sem blocos de codigo, sem explicacoes
- Todos os valores de string devem usar aspas duplas
- NUNCA use aspas simples, apostrofos ou aspas curvas dentro dos valores — substitua por espaco ou remova
- NUNCA use quebras de linha dentro de strings JSON — use espaco
- Emojis sao permitidos fora das strings mas NUNCA dentro de valores JSON
- Mantenha os textos curtos e sem caracteres especiais

BRIEFING:
${texto.substring(0, 3000)}

Retorne APENAS este JSON (sem nada antes ou depois):
{
  "data": "data em portugues",
  "resumo": "panorama geral em uma frase simples sem pontuacao especial",
  "mandatos": {
    "lincoln": {
      "nome": "Lincoln Portela",
      "cargo": "Deputado Federal",
      "cards": [
        {
          "titulo": "titulo curto sem aspas ou pontuacao especial",
          "descricao": "descricao em duas frases sem apostrofos ou aspas",
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
          "prioridade": "alta"
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

      // Tenta extrair JSON de forma robusta
      let parsed = null;
      const attempts = [
        // 1. direto
        () => JSON.parse(raw),
        // 2. extrai bloco entre { }
        () => JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0]),
        // 3. remove markdown fences
        () => JSON.parse(raw.replace(/```json|```/g, '').trim()),
        // 4. sanitiza caracteres problemáticos e tenta de novo
        () => {
          const sanitized = raw
            .replace(/```json|```/g, '')
            .replace(/[\u2018\u2019]/g, "'")
            .replace(/[\u201C\u201D]/g, '"')
            .trim();
          const block = sanitized.match(/\{[\s\S]*\}/)?.[0];
          return JSON.parse(block);
        },
      ];

      for (const attempt of attempts) {
        try { parsed = attempt(); if (parsed) break; } catch {}
      }

      if (!parsed) throw new Error('Nao foi possivel extrair JSON valido da resposta');

      // Salva em memoria global
      if (!global._briefings) global._briefings = [];
      global._briefings.unshift({ id: Date.now(), ...parsed, timestamp: new Date().toISOString() });
      global._briefings = global._briefings.slice(0, 10);
      global._lastUpdate = new Date().toISOString();

      return res.status(200).json({ ok: true, briefing: parsed });

    } catch (e) {
      return res.status(500).json({ error: 'Falha ao processar briefing: ' + e.message });
    }
  }

  return res.status(405).json({ error: 'Metodo nao permitido' });
};
