// api/flow.js — Vercel Serverless Function (CommonJS)

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const GEMINI_KEY    = process.env.GEMINI_API_KEY;
  const GROK_KEY      = process.env.GROK_API_KEY;
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

  const timeline = [];
  const now = () => new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  // STEP 1: Gemini
  let geminiTopics = [];
  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'Liste 5 topicos relevantes de tecnologia ou IA para hoje. Retorne APENAS um array JSON com strings. Ex: ["Topico 1","Topico 2"]' }] }]
        })
      }
    );
    const data = await r.json();
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    const match = raw?.match(/\[[\s\S]*\]/);
    geminiTopics = match ? JSON.parse(match[0]) : ['IA generativa', 'Automacao', 'Dados em tempo real'];
    timeline.push({ tool: 'Gemini', time: now(), action: `${geminiTopics.length} topicos capturados`, status: 'done' });
  } catch {
    geminiTopics = ['IA generativa', 'Automacao', 'Mercado tech'];
    timeline.push({ tool: 'Gemini', time: now(), action: 'Fallback ativo', status: 'warn' });
  }

  // STEP 2: Grok
  let grokTrends = '';
  try {
    const r = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROK_KEY}` },
      body: JSON.stringify({
        model: 'grok-3-fast',
        messages: [{ role: 'user', content: 'Quais sao os 3 trending topics mais relevantes no X agora? Responda apenas os topicos separados por " - ", max 20 palavras.' }],
        max_tokens: 80,
      })
    });
    const data = await r.json();
    grokTrends = data?.choices?.[0]?.message?.content?.trim() || '';
    timeline.push({ tool: 'Grok', time: now(), action: grokTrends || 'Trends capturados', status: 'done' });
  } catch {
    grokTrends = 'Dados indisponiveis';
    timeline.push({ tool: 'Grok', time: now(), action: 'Fallback ativo', status: 'warn' });
  }

  // STEP 3: Claude
  let claudeReport = null;
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        messages: [{
          role: 'user',
          content: `Voce e um editor estrategico. Com base nos dados abaixo, gere 2 cards de conteudo.
Topicos (Gemini): ${geminiTopics.slice(0,3).join(', ')}
Trends (Grok): ${grokTrends}

Retorne APENAS JSON valido:
{"cards":[{"title":"Titulo em ate 8 palavras","summary":"Resumo em 2 frases, tom analitico","category":"Analise"},{"title":"Titulo em ate 8 palavras","summary":"Resumo em 2 frases, tom analitico","category":"Tendencias"}],"digest":"Uma frase resumindo o dia, max 20 palavras"}`
        }],
      })
    });
    const data = await r.json();
    const raw = data?.content?.[0]?.text?.trim();
    const match = raw?.match(/\{[\s\S]*\}/);
    claudeReport = match ? JSON.parse(match[0]) : null;
    timeline.push({ tool: 'Claude', time: now(), action: claudeReport ? 'Relatorio estruturado' : 'Estruturacao parcial', status: claudeReport ? 'done' : 'warn' });
  } catch (e) {
    timeline.push({ tool: 'Claude', time: now(), action: 'Erro: ' + e.message, status: 'error' });
  }

  timeline.push({ tool: 'Opal', time: now(), action: 'Aguardando input manual', status: 'pending' });

  return res.status(200).json({ ok: true, timestamp: new Date().toISOString(), timeline, geminiTopics, grokTrends, claudeReport });
};
