// api/status.js
// Vercel Serverless Function — busca status real das ferramentas
// Keys ficam seguras no servidor, nunca expostas ao browser

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const GEMINI_KEY = process.env.GEMINI_API_KEY;
  const GROK_KEY   = process.env.GROK_API_KEY;

  const results = {
    gemini:     { status: 'unknown', lastRun: null, summary: null },
    grok:       { status: 'unknown', lastRun: null, summary: null },
    perplexity: { status: 'idle',    lastRun: null, summary: 'API pendente — configurar em breve' },
    opal:       { status: 'manual',  lastRun: null, summary: 'Sem API pública — entrada manual ativa' },
    claude:     { status: 'active',  lastRun: new Date().toISOString(), summary: 'Em sessão — motor de raciocínio ativo' },
  };

  // ── GEMINI ─────────────────────────────────────────────
  if (GEMINI_KEY) {
    try {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [{ text: 'Em uma frase curta (max 12 palavras), descreva o principal tópico de IA ou tecnologia em destaque hoje. Responda apenas a frase, sem introdução.' }]
            }]
          })
        }
      );
      const data = await r.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      results.gemini = {
        status:  'active',
        lastRun: new Date().toISOString(),
        summary: text || 'Captura concluída com sucesso.',
        progress: 100,
      };
    } catch (e) {
      results.gemini = { status: 'error', lastRun: null, summary: 'Falha na conexão com Gemini.' };
    }
  } else {
    results.gemini = { status: 'idle', lastRun: null, summary: 'GEMINI_API_KEY não configurada.' };
  }

  // ── GROK ───────────────────────────────────────────────
  if (GROK_KEY) {
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
            content: 'Liste 3 trending topics do X/Twitter agora, em português, separados por " · ". Máximo 15 palavras no total. Apenas os tópicos, sem explicações.'
          }],
          max_tokens: 60,
        })
      });
      const data = await r.json();
      const text = data?.choices?.[0]?.message?.content?.trim();
      results.grok = {
        status:  'active',
        lastRun: new Date().toISOString(),
        summary: text || 'Trends capturados com sucesso.',
        progress: 85,
      };
    } catch (e) {
      results.grok = { status: 'error', lastRun: null, summary: 'Falha na conexão com Grok.' };
    }
  } else {
    results.grok = { status: 'idle', lastRun: null, summary: 'GROK_API_KEY não configurada.' };
  }

  res.status(200).json({
    ok: true,
    timestamp: new Date().toISOString(),
    tools: results,
  });
}
