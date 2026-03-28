// api/alerts.js — busca Google Alerts do Gmail + Grok para o painel

const KV_URL   = () => process.env.KV_REST_API_URL;
const KV_TOKEN = () => process.env.KV_REST_API_TOKEN;
const GROK_KEY = process.env.GROK_API_KEY;
const GMAIL_TOKEN = process.env.GMAIL_ACCESS_TOKEN; // via OAuth — alternativa: buscar via fetch com token

// Parlamentares monitorados
const PARLAMENTARES = ['Lincoln Portela', 'Marilda Portela', 'Alê Portela'];
const SITES_CAMARAS = [
  { nome: 'Câmara Federal', url: 'camara.leg.br', sigla: 'federal' },
  { nome: 'CMBH', url: 'cmbh.mg.gov.br', sigla: 'municipal' },
  { nome: 'ALMG', url: 'almg.gov.br', sigla: 'estadual' },
];

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

async function getSession(req) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return null;
  const s = await kvGet('session:' + token);
  if (!s || new Date(s.expiresAt) < new Date()) return null;
  return s;
}

// Busca alertas do Gmail via API do Google
async function buscarAlertsGmail(gmailToken) {
  if (!gmailToken) return [];
  try {
    // Busca últimos 20 alerts dos parlamentares
    const query = encodeURIComponent(
      `from:googlealerts-noreply@google.com (subject:"Lincoln Portela" OR subject:"Marilda Portela" OR subject:"Alê Portela" OR subject:"Assembleia Legislativa" OR subject:"Câmara Municipal de Belo Horizonte" OR subject:"Câmara dos Deputados")`
    );
    const r = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${query}&maxResults=20`,
      { headers: { Authorization: 'Bearer ' + gmailToken } }
    );
    const data = await r.json();
    if (!data.messages?.length) return [];

    // Lê os primeiros 8 emails
    const emails = await Promise.all(
      data.messages.slice(0, 8).map(async m => {
        const msg = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=Date`,
          { headers: { Authorization: 'Bearer ' + gmailToken } }
        );
        return msg.json();
      })
    );

    return emails.map(e => {
      const headers = e.payload?.headers || [];
      const subject = headers.find(h => h.name === 'Subject')?.value || '';
      const date = headers.find(h => h.name === 'Date')?.value || '';
      const termo = subject.replace('Alerta do Google - ', '').replace('Google Alert - ', '');
      return {
        termo,
        assunto: subject,
        data: date,
        snippet: e.snippet || '',
        id: e.id,
      };
    });
  } catch { return []; }
}

// Busca Grok — tendências políticas + sites das câmaras
async function buscarGrok(hoje) {
  if (!GROK_KEY) return { parlamentares: [], camaras: [], tendencias: [] };
  try {
    const prompt = `Hoje é ${hoje}. Você é um analista político brasileiro especializado em Minas Gerais e Brasília.

Busque e retorne em JSON as notícias e informações mais recentes de HOJE ou desta semana sobre:

1. "parlamentares": Notícias sobre Lincoln Portela (Deputado Federal MG), Marilda Portela (Vereadora BH) e Alê Portela (Deputada Estadual MG). Máximo 3 itens por parlamentar.

2. "camaras": Últimas publicações e pautas de:
   - Câmara dos Deputados (camara.leg.br) — foco em votações e pautas da semana
   - Câmara Municipal de Belo Horizonte (cmbh.mg.gov.br) — foco em sessões e projetos
   - Assembleia Legislativa de MG (almg.gov.br) — foco em plenário e comissões

3. "tendencias": Top 5 assuntos políticos mais quentes no Brasil HOJE, com breve contexto.

Retorne APENAS JSON válido neste formato:
{
  "parlamentares": [
    {"nome": "Lincoln Portela", "titulo": "...", "resumo": "...", "fonte": "...", "url": "..."}
  ],
  "camaras": [
    {"casa": "Câmara Federal", "sigla": "federal", "titulo": "...", "resumo": "...", "data": "..."}
  ],
  "tendencias": [
    {"assunto": "...", "contexto": "...", "relevancia": "alta|media"}
  ]
}`;

    const r = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + GROK_KEY },
      body: JSON.stringify({
        model: 'grok-3',
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }],
        search_parameters: { mode: 'on', return_citations: true, max_search_results: 20 },
      }),
    });
    const d = await r.json();
    const raw = d.choices?.[0]?.message?.content?.trim() || '';
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return { parlamentares: [], camaras: [], tendencias: [] };
    return JSON.parse(match[0]);
  } catch { return { parlamentares: [], camaras: [], tendencias: [] }; }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const session = await getSession(req);
  if (!session) return res.status(401).json({ error: 'Não autenticado' });

  const { action } = req.query || {};
  const hoje = new Date().toLocaleDateString('pt-BR', {
    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric'
  });

  // Cache de 30 min no KV
  const cacheKey = 'alerts:cache:' + new Date().toISOString().slice(0, 13);
  const cached = await kvGet(cacheKey);
  if (cached && !req.query.force) {
    return res.status(200).json({ ok: true, ...cached, cached: true });
  }

  // Busca Gmail via token do header (passado pelo frontend)
  const gmailToken = req.headers['x-gmail-token'] || '';
  const [alertsGmail, dadosGrok] = await Promise.all([
    buscarAlertsGmail(gmailToken),
    buscarGrok(hoje),
  ]);

  const resultado = {
    hoje,
    alertsGmail,
    grok: dadosGrok,
    geradoEm: new Date().toISOString(),
  };

  // Salva cache
  await kvSet(cacheKey, resultado);

  return res.status(200).json({ ok: true, ...resultado, cached: false });
};
