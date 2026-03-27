// api/briefing.js — processa briefing da Geni e publica no HUB

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

  // GET — retorna briefings salvos (simulado com dados em memória global)
  if (req.method === 'GET') {
    return res.status(200).json({
      ok: true,
      briefings: global._briefings || [],
      lastUpdate: global._lastUpdate || null,
    });
  }

  // POST — processa novo briefing
  if (req.method === 'POST') {
    const { texto } = req.body || {};
    if (!texto || texto.trim().length < 50) {
      return res.status(400).json({ error: 'Texto do briefing muito curto ou vazio.' });
    }

    if (!ANTHROPIC_KEY) {
      return res.status(500).json({ error: 'ANTHROPIC_API_KEY não configurada.' });
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
          max_tokens: 1500,
          messages: [{
            role: 'user',
            content: `Você é um assistente político especializado. Analise o briefing abaixo e extraia os cards de conteúdo organizados por mandato.

BRIEFING:
${texto}

Retorne APENAS um JSON válido neste formato exato (sem markdown, sem explicações):
{
  "data": "data do briefing em português (ex: 27 de março de 2026)",
  "resumo": "Uma frase resumindo o panorama geral do dia, max 20 palavras",
  "mandatos": {
    "lincoln": {
      "nome": "Lincoln Portela",
      "cargo": "Deputado Federal",
      "ambito": "Federal",
      "cards": [
        {
          "tipo": "pauta",
          "titulo": "título da pauta em até 8 palavras",
          "descricao": "descrição em 2 frases do que está acontecendo",
          "acao": "o que o mandato deve fazer — 1 frase",
          "copy": "texto pronto para redes sociais — até 3 linhas",
          "prioridade": "alta|media|baixa"
        }
      ]
    },
    "marilda": {
      "nome": "Marilda Portela",
      "cargo": "Vereadora",
      "ambito": "Municipal BH",
      "cards": [
        {
          "tipo": "pauta",
          "titulo": "título da pauta em até 8 palavras",
          "descricao": "descrição em 2 frases do que está acontecendo",
          "acao": "o que o mandato deve fazer — 1 frase",
          "copy": "texto pronto para redes sociais — até 3 linhas",
          "prioridade": "alta|media|baixa"
        }
      ]
    },
    "ale": {
      "nome": "Alê Portela",
      "cargo": "Deputada Estadual",
      "ambito": "Estadual MG",
      "cards": []
    }
  },
  "insights": [
    {
      "titulo": "título do insight viral",
      "descricao": "descrição do insight em 1 frase",
      "mandato": "lincoln|marilda|ale|geral"
    }
  ]
}

Se não houver informações para um mandato no briefing, deixe o array cards vazio. Extraia TUDO que for relevante para Lincoln e Marilda do briefing fornecido.`
          }],
        })
      });

      const data = await r.json();
      const raw = data?.content?.[0]?.text?.trim();
      const match = raw?.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('JSON inválido na resposta do Claude');

      const parsed = JSON.parse(match[0]);

      // Salva em memória global (persiste enquanto a função estiver quente)
      if (!global._briefings) global._briefings = [];
      global._briefings.unshift({
        id: Date.now(),
        ...parsed,
        timestamp: new Date().toISOString(),
      });
      // Mantém só os últimos 10 briefings
      global._briefings = global._briefings.slice(0, 10);
      global._lastUpdate = new Date().toISOString();

      return res.status(200).json({ ok: true, briefing: parsed });

    } catch (e) {
      return res.status(500).json({ error: 'Falha ao processar briefing: ' + e.message });
    }
  }

  return res.status(405).json({ error: 'Método não permitido' });
};
