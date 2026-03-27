// api/insight.js — Vercel Serverless Function (CommonJS)

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY nao configurada' });

  const { topic, category } = req.body || {};
  if (!topic) return res.status(400).json({ error: 'topic e obrigatorio' });

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        messages: [{
          role: 'user',
          content: `Voce e um editor de publicacao premium. Escreva um card para: "${topic}". Categoria: ${category || 'Analise'}.
Retorne APENAS JSON valido:
{"title":"Titulo em ate 8 palavras","summary":"Resumo em 2 frases max 40 palavras","category":"${category || 'Analise'}"}`
        }],
      })
    });
    const data = await r.json();
    const raw = data?.content?.[0]?.text?.trim();
    const match = raw?.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('JSON invalido');
    const insight = JSON.parse(match[0]);
    return res.status(200).json({ ok: true, insight });
  } catch (e) {
    return res.status(500).json({ error: 'Falha ao gerar insight', detail: e.message });
  }
};
