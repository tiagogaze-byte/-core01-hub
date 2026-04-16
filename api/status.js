// api/status.js — Vercel Serverless Function (CommonJS)

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const GEMINI_KEY = process.env.GEMINI_API_KEY;
  const GROK_KEY   = process.env.GROK_API_KEY;

  const results = {
    gemini:     { status: 'idle', summary: 'GEMINI_API_KEY nao configurada' },
    grok:       { status: 'idle', summary: 'GROK_API_KEY nao configurada' },
    perplexity: { status: 'manual', summary: 'API pendente' },
    opal:       { status: 'manual', summary: 'Sem API publica' },
    claude:     { status: 'active', lastRun: new Date().toISOString(), summary: 'Em sessao ativa' },
  };

  // GEMINI
  if (GEMINI_KEY) {
    try {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: 'Em uma frase curta (max 12 palavras), qual o principal topico de tecnologia ou IA hoje? Responda apenas a frase.' }] }]
          })
        }
      );
      const data = await r.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      results.gemini = { status: 'active', lastRun: new Date().toISOString(), summary: text || 'Captura concluida.', progress: 100 };
    } catch (e) {
      results.gemini = { status: 'error', summary: 'Falha: ' + e.message };
    }
  }

  // GROK
  if (GROK_KEY) {
    try {
      const r = await fetch('https://api.x.ai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROK_KEY}` },
        body: JSON.stringify({
          model: 'grok-3-fast',
          messages: [{ role: 'user', content: 'Liste 3 trending topics do X agora, em portugues, separados por " - ". Max 15 palavras total. Apenas os topicos.' }],
          max_tokens: 80,
        })
      });
      const data = await r.json();
      const text = data?.choices?.[0]?.message?.content?.trim();
      results.grok = { status: 'active', lastRun: new Date().toISOString(), summary: text || 'Trends capturados.', progress: 85 };
    } catch (e) {
      results.grok = { status: 'error', summary: 'Falha: ' + e.message };
    }
  }

  return res.status(200).json({ ok: true, timestamp: new Date().toISOString(), tools: results });
};
