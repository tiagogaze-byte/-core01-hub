// api/insight.js
// Vercel Serverless Function — Claude gera conteúdo real para o HUB

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });

  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY não configurada' });

  const { topic, category } = req.body || {};
  if (!topic) return res.status(400).json({ error: 'topic é obrigatório' });

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
        max_tokens: 300,
        messages: [{
          role: 'user',
          content: `Você é um editor de uma publicação de inteligência estratégica premium.
Escreva um card de conteúdo para o tema: "${topic}"
Categoria: ${category || 'Análise'}

Retorne APENAS um JSON válido neste formato exato (sem markdown, sem explicações):
{
  "title": "Título atraente em até 8 palavras",
  "summary": "Resumo editorial em 2 frases, máximo 40 palavras, tom analítico e sofisticado",
  "category": "${category || 'Análise'}",
  "date": "${new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })}"
}`
        }],
      })
    });

    const data = await r.json();
    const raw  = data?.content?.[0]?.text?.trim();

    // Parse seguro do JSON retornado pelo Claude
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('JSON inválido na resposta');

    const insight = JSON.parse(jsonMatch[0]);
    res.status(200).json({ ok: true, insight });

  } catch (e) {
    res.status(500).json({ error: 'Falha ao gerar insight', detail: e.message });
  }
}
