// api/flow.js
// Vercel Serverless Function — dispara o fluxo completo sequencial
// Gemini captura → Grok puxa trends → Claude estrutura → retorna tudo

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });

  const GEMINI_KEY    = process.env.GEMINI_API_KEY;
  const GROK_KEY      = process.env.GROK_API_KEY;
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

  const timeline = [];
  const now = () => new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  // ── STEP 1: Gemini captura tópicos ─────────────────────
  let geminiTopics = [];
  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [{ text: 'Liste 5 tópicos relevantes de tecnologia, IA ou negócios para hoje. Retorne APENAS um array JSON com strings, sem explicações. Ex: ["Tópico 1", "Tópico 2"]' }]
          }]
        })
      }
    );
    const data = await r.json();
    const raw  = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    const match = raw?.match(/\[[\s\S]*\]/);
    geminiTopics = match ? JSON.parse(match[0]) : ['IA generativa', 'Automação', 'Dados em tempo real'];
    timeline.push({ tool: 'Gemini', time: now(), action: `${geminiTopics.length} tópicos capturados`, status: 'done' });
  } catch {
    geminiTopics = ['IA generativa', 'Automação', 'Mercado tech'];
    timeline.push({ tool: 'Gemini', time: now(), action: 'Fallback ativo — tópicos padrão', status: 'warn' });
  }

  // ── STEP 2: Grok puxa trends ────────────────────────────
  let grokTrends = '';
  try {
    const r = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROK_KEY}`,
      },
      body: JSON.stringify({
        model: 'grok-3-fast',
        messages: [{
          role: 'user',
          content: 'Quais são os 3 trending topics mais relevantes no X/Twitter agora? Responda apenas os tópicos separados por " · ", sem numeração, max 20 palavras total.'
        }],
        max_tokens: 80,
      })
    });
    const data = await r.json();
    grokTrends = data?.choices?.[0]?.message?.content?.trim() || '';
    timeline.push({ tool: 'Grok', time: now(), action: `Trends: ${grokTrends}`, status: 'done' });
  } catch {
    grokTrends = 'Dados do X temporariamente indisponíveis';
    timeline.push({ tool: 'Grok', time: now(), action: 'Fallback — dados do X indisponíveis', status: 'warn' });
  }

  // ── STEP 3: Claude estrutura o relatório ────────────────
  let claudeReport = null;
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
        max_tokens: 400,
        messages: [{
          role: 'user',
          content: `Você é um editor estratégico. Com base nos dados abaixo, gere 2 cards de conteúdo para publicação.

Tópicos do dia (Gemini): ${geminiTopics.slice(0,3).join(', ')}
Trends do X (Grok): ${grokTrends}

Retorne APENAS JSON válido neste formato:
{
  "cards": [
    {
      "title": "Título em até 8 palavras",
      "summary": "Resumo editorial em 2 frases, tom analítico",
      "category": "Análise"
    },
    {
      "title": "Título em até 8 palavras",
      "summary": "Resumo editorial em 2 frases, tom analítico",
      "category": "Tendências"
    }
  ],
  "digest": "Uma frase resumindo o panorama do dia, max 20 palavras"
}`
        }],
      })
    });
    const data = await r.json();
    const raw  = data?.content?.[0]?.text?.trim();
    const match = raw?.match(/\{[\s\S]*\}/);
    claudeReport = match ? JSON.parse(match[0]) : null;
    timeline.push({ tool: 'Claude', time: now(), action: claudeReport ? 'Relatório estruturado — pronto para HUB' : 'Estruturação parcial', status: claudeReport ? 'done' : 'warn' });
  } catch {
    timeline.push({ tool: 'Claude', time: now(), action: 'Fallback — estruturação manual necessária', status: 'error' });
  }

  // ── STEP 4: Opal (manual por enquanto) ─────────────────
  timeline.push({ tool: 'Opal', time: now(), action: 'Aguardando input manual — sem API pública', status: 'pending' });

  res.status(200).json({
    ok: true,
    timestamp: new Date().toISOString(),
    timeline,
    geminiTopics,
    grokTrends,
    claudeReport,
  });
}
