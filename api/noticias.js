// api/noticias.js — Google Alerts (via Gmail) + sites das câmaras + Grok

const KV_URL   = () => process.env.KV_REST_API_URL;
const KV_TOKEN = () => process.env.KV_REST_API_TOKEN;
const GROK_KEY = process.env.GROK_API_KEY;
const GMAIL_TOKEN = process.env.GMAIL_ACCESS_TOKEN; // OAuth token do Gmail

async function kvSet(key, value) {
  const body = typeof value === 'string' ? value : JSON.stringify(value);
  await fetch(`${KV_URL()}/set/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN()}`, 'Content-Type': 'application/json' },
    body,
  });
}

async function kvGet(key) {
  const r = await fetch(`${KV_URL()}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN()}` },
  });
  const d = await r.json();
  if (!d.result) return null;
  let v = d.result;
  for (let i = 0; i < 3; i++) {
    if (typeof v !== 'string') break;
    try { v = JSON.parse(v); } catch { break; }
  }
  return v;
}

const hoje = new Date();
const dataHoje = hoje.toLocaleDateString('pt-BR', { weekday:'long', day:'2-digit', month:'long', year:'numeric' });

// Busca Google Alerts via Gmail API
async function buscarGoogleAlerts() {
  if (!GMAIL_TOKEN) return [];
  try {
    // Busca emails de alertas do Google nas últimas 48h
    const query = encodeURIComponent('from:googlealerts-noreply@google.com newer_than:2d');
    const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${query}&maxResults=20`, {
      headers: { Authorization: `Bearer ${GMAIL_TOKEN}` },
    });
    const data = await r.json();
    if (!data.messages?.length) return [];

    const alertas = [];
    for (const msg of data.messages.slice(0, 10)) {
      const detail = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=Date`, {
        headers: { Authorization: `Bearer ${GMAIL_TOKEN}` },
      });
      const d = await detail.json();
      const subject = d.headers?.find(h => h.name === 'Subject')?.value || '';
      const date = d.headers?.find(h => h.name === 'Date')?.value || '';
      if (subject) alertas.push({ subject, date, id: msg.id });
    }
    return alertas;
  } catch (e) {
    return [{ erro: e.message }];
  }
}

// Busca via Grok: parlamentares + sites oficiais
async function buscarViaGrok(tipo) {
  if (!GROK_KEY) return null;

  const prompts = {
    parlamentares: `Hoje é ${dataHoje}. Busque as ÚLTIMAS NOTÍCIAS de hoje sobre estes parlamentares brasileiros:
- Lincoln Portela (Deputado Federal, MG, Solidariedade)
- Marilda Portela (Vereadora, Belo Horizonte, Solidariedade)
- Alê Portela (Deputada Estadual, MG, Solidariedade)

Retorne JSON array com até 8 notícias, formato:
[{"titulo":"...","resumo":"...em 1 frase","parlamentar":"lincoln|marilda|ale","fonte":"site.com","data":"hoje"}]
APENAS JSON, sem markdown.`,

    camaras: `Hoje é ${dataHoje}. Busque as últimas notícias e pautas publicadas HOJE ou ontem nos sites oficiais:
- Câmara Federal: camara.leg.br (votações, projetos de lei em pauta)
- Câmara Municipal BH: cmbh.mg.gov.br (projetos, sessões)
- ALMG: almg.gov.br (plenário, comissões)

Retorne JSON array com até 8 notícias, formato:
[{"titulo":"...","resumo":"...em 1 frase","casa":"federal|municipal|almg","url":"...","data":"hoje"}]
APENAS JSON, sem markdown.`
  };

  try {
    const r = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GROK_KEY}` },
      body: JSON.stringify({
        model: 'grok-3-latest',
        messages: [
          { role: 'system', content: `Você é um assistente de inteligência política brasileira. Hoje é ${dataHoje}. Use apenas informações de ${dataHoje} ou dos últimos 2 dias. NUNCA use dados de 2024.` },
          { role: 'user', content: prompts[tipo] }
        ],
        max_tokens: 800,
      })
    });
    const data = await r.json();
    const text = data?.choices?.[0]?.message?.content?.trim();
    if (!text) return null;
    // Parse JSON da resposta
    const clean = text.replace(/```json|```/g, '').trim();
    const match = clean.match(/\[[\s\S]*\]/);
    return match ? JSON.parse(match[0]) : null;
  } catch { return null; }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { tipo = 'todos', refresh } = req.query;

  // Cache de 30 min no KV
  const cacheKey = `noticias:cache:${tipo}:${hoje.toISOString().slice(0,13)}`;
  if (!refresh) {
    const cached = await kvGet(cacheKey).catch(() => null);
    if (cached) return res.status(200).json({ ok: true, ...cached, cached: true });
  }

  try {
    const result = {};

    if (tipo === 'todos' || tipo === 'alertas') {
      result.alertas = await buscarGoogleAlerts();
    }
    if (tipo === 'todos' || tipo === 'parlamentares') {
      result.parlamentares = await buscarViaGrok('parlamentares') || [];
    }
    if (tipo === 'todos' || tipo === 'camaras') {
      result.camaras = await buscarViaGrok('camaras') || [];
    }

    result.dataHoje = dataHoje;
    result.geradoEm = hoje.toISOString();

    // Salva cache por 30 min
    await kvSet(cacheKey, result).catch(() => {});

    return res.status(200).json({ ok: true, ...result, cached: false });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
};
