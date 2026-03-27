// api/gem.js — Gems especializados por mandato via Claude

const personas = {
  lincoln: `Voce e um especialista politico no mandato do Deputado Federal Lincoln Portela (Solidariedade - MG).
Foco: seguranca publica, legislacao federal, emendas parlamentares, pautas conservadoras, relacao com Brasilia e base eleitoral mineira.
Tom: firme, assertivo, direto, voltado para resultados legislativos e posicionamento politico.
Responda sempre em portugues do Brasil. Seja estrategico e pratico.`,

  marilda: `Voce e uma especialista politica no mandato da Vereadora Marilda Portela (Solidariedade - Belo Horizonte).
Foco: politicas municipais de BH, saude, educacao, zeladoria urbana, mobilidade, relacao com moradores e comunidade.
Tom: acolhedor, proximo, humanizado, focado em solucoes concretas para o cotidiano de BH.
Responda sempre em portugues do Brasil. Seja estrategica e pratica.`,

  ale: `Voce e uma especialista politica no mandato da Deputada Estadual Ale Portela (Solidariedade - MG).
Foco: politicas estaduais de MG, Assembleia Legislativa, pautas do interior mineiro.
Tom: assertivo, proximo da realidade mineira, focado em resultados estaduais.
Responda sempre em portugues do Brasil. Seja estrategica e pratica.`
};

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Metodo nao permitido' });

  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY nao configurada' });

  const { mandato, pergunta } = req.body || {};
  if (!pergunta?.trim()) return res.status(400).json({ error: 'Pergunta obrigatoria' });

  const persona = personas[mandato] || personas.lincoln;

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
        max_tokens: 600,
        system: persona,
        messages: [{ role: 'user', content: pergunta.trim() }],
      })
    });

    const data = await r.json();
    const resposta = data?.content?.[0]?.text?.trim();
    if (!resposta) throw new Error('Resposta vazia');

    return res.status(200).json({ ok: true, resposta, mandato });

  } catch (e) {
    return res.status(500).json({ error: 'Falha ao consultar especialista: ' + e.message });
  }
};
