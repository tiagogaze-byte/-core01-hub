// api/status.js — status das ferramentas com data atual forçada

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const GEMINI_KEY = process.env.GEMINI_API_KEY;
  const GROK_KEY   = process.env.GROK_API_KEY;

  // Data de hoje para forçar no contexto
  const hoje = new Date();
  const dataHoje = hoje.toLocaleDateString('pt-BR', { weekday:'long', day:'2-digit', month:'long', year:'numeric' });
  const anoMes = `${hoje.getFullYear()}-${String(hoje.getMonth()+1).padStart(2,'0')}`;

  const results = {
    gemini:     { status: 'idle', summary: 'GEMINI_API_KEY não configurada' },
    grok:       { status: 'idle', summary: 'GROK_API_KEY não configurada' },
    perplexity: { status: 'manual', summary: 'API pendente' },
    opal:       { status: 'manual', summary: 'Sem API pública' },
    claude:     { status: 'active', lastRun: hoje.toISOString(), summary: 'Em sessão ativa' },
  };

  // GEMINI — resumo político do dia
  if (GEMINI_KEY) {
    try {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: `Hoje é ${dataHoje}. Em uma frase curta (máx 15 palavras), qual o principal assunto da política brasileira HOJE? Responda apenas a frase, sem aspas.` }] }]
          })
        }
      );
      const data = await r.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      results.gemini = { status: 'active', lastRun: hoje.toISOString(), summary: text || 'Captura concluída.', progress: 100 };
    } catch (e) {
      results.gemini = { status: 'error', summary: 'Falha: ' + e.message };
    }
  }

  // GROK — trending topics políticos de hoje
  if (GROK_KEY) {
    try {
      const r = await fetch('https://api.x.ai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROK_KEY}` },
        body: JSON.stringify({
          model: 'grok-3-latest',
          messages: [{
            role: 'system',
            content: `Você é um analista político brasileiro. Hoje é ${dataHoje}. Responda SEMPRE com base no que está acontecendo AGORA em ${anoMes}.`
          }, {
            role: 'user',
            content: `Quais são os 3 principais trending topics da política brasileira no X/Twitter HOJE, ${dataHoje}? Liste apenas os tópicos separados por " · ". Máximo 20 palavras total. Seja específico com nomes e pautas reais de hoje.`
          }],
          max_tokens: 100,
        })
      });
      const data = await r.json();
      const text = data?.choices?.[0]?.message?.content?.trim();
      results.grok = { status: 'active', lastRun: hoje.toISOString(), summary: text || 'Trends capturados.', progress: 85 };
    } catch (e) {
      results.grok = { status: 'error', summary: 'Falha: ' + e.message };
    }
  }

  return res.status(200).json({ ok: true, timestamp: hoje.toISOString(), tools: results, dataHoje });
};
