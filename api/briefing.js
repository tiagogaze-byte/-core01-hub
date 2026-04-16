// api/briefing.js — Upstash Redis REST API (corrigido)
// Upstash REST API: POST /set/key com body = valor como string

const KV_URL   = () => process.env.KV_REST_API_URL;
const KV_TOKEN = () => process.env.KV_REST_API_TOKEN;

async function kvSet(key, value) {
  // Upstash: body deve ser o valor diretamente, sem JSON.stringify extra
  const body = typeof value === 'string' ? value : JSON.stringify(value);
  const res = await fetch(`${KV_URL()}/set/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${KV_TOKEN()}`,
      'Content-Type': 'application/json',
    },
    body, // envia como string JSON limpa, sem duplo encoding
  });
  const d = await res.json();
  if (d.error) throw new Error('KV set error: ' + d.error);
  return d;
}

async function kvGet(key) {
  const res = await fetch(`${KV_URL()}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN()}` },
  });
  const d = await res.json();
  if (!d.result) return null;
  // Desempacota double encoding gerado pela versão antiga
  let val = d.result;
  // Tenta desserializar até 3 vezes (caso haja múltiplos níveis)
  for (let i = 0; i < 3; i++) {
    if (typeof val !== 'string') break;
    try { val = JSON.parse(val); } catch { break; }
  }
  return val;
}

function toArray(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  if (typeof val === 'object') return Object.values(val);
  return [];
}

function countCards(b) {
  return Object.values(b.mandatos || {}).reduce((n, m) => n + (m?.cards?.length || 0), 0);
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  const hasKV = !!(KV_URL() && KV_TOKEN());

  // ── GET — lista briefings ──────────────────────────────
  if (req.method === 'GET') {
    const mes = req.query?.mes || '';
    try {
      if (hasKV) {
        const rawIndex = await kvGet('briefing:index');
        const index = toArray(rawIndex);
        const filtered = mes ? index.filter(b => b.mes === mes) : index;
        // Carrega os 10 mais recentes completos
        const top = filtered.slice(0, 10);
        const full = await Promise.all(top.map(b => kvGet('briefing:' + b.id).catch(() => null)));
        const meses = [...new Set(index.map(b => b.mes).filter(Boolean))].sort().reverse();
        return res.status(200).json({
          ok: true,
          briefings: full.filter(Boolean),
          index: filtered,
          total: index.length,
          meses,
          kvAtivo: true,
        });
      } else {
        const list = toArray(global._briefings);
        return res.status(200).json({ ok: true, briefings: list, total: list.length, meses: [], index: [], kvAtivo: false });
      }
    } catch (e) {
      return res.status(500).json({ error: 'Erro ao buscar briefings: ' + e.message });
    }
  }

  // ── POST — processa e salva novo briefing ──────────────
  if (req.method === 'POST') {
    const { texto, dataManual, titulo } = req.body || {};
    if (!texto || texto.trim().length < 50)
      return res.status(400).json({ error: 'Texto muito curto ou vazio.' });
    if (!ANTHROPIC_KEY)
      return res.status(500).json({ error: 'ANTHROPIC_API_KEY nao configurada.' });

    try {
      // Chama Claude para processar o briefing
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 2000,
          messages: [{
            role: 'user',
            content: `Voce e um assistente politico. Analise o briefing abaixo e extraia TUDO por mandato.

REGRAS CRITICAS:
- Retorne APENAS JSON valido, sem markdown, sem blocos de codigo
- Use apenas aspas duplas, nunca apostrofos ou aspas curvas dentro de valores
- Sem quebras de linha dentro de strings JSON
- Extraia a DATA REAL — ela aparece no cabecalho como "quinta-feira, 26 de marco de 2026"
- O campo mes deve ser no formato YYYY-MM ex: 2026-03
- Extraia TUDO: pauta, copy, trend (Lincoln), insight (Marilda)
- Crie um card separado para cada pauta distinta de cada mandato

BRIEFING:
${texto.substring(0, 3500)}

Retorne APENAS este JSON (sem nada antes ou depois):
{
  "data": "26 de marco de 2026",
  "mes": "2026-03",
  "resumo": "panorama do dia em uma frase",
  "mandatos": {
    "lincoln": {
      "nome": "Lincoln Portela",
      "cargo": "Deputado Federal",
      "cards": [
        {
          "titulo": "titulo da pauta sem pontuacao especial",
          "descricao": "o que esta acontecendo em duas frases",
          "acao": "o que fazer em uma frase",
          "copy": "texto para redes sem aspas internas",
          "trend": "instrucao de como distribuir nos canais",
          "prioridade": "alta"
        }
      ]
    },
    "marilda": {
      "nome": "Marilda Portela",
      "cargo": "Vereadora",
      "cards": [
        {
          "titulo": "titulo da pauta",
          "descricao": "o que esta acontecendo em duas frases",
          "acao": "o que fazer em uma frase",
          "copy": "texto para redes",
          "insight": "instrucao criativa de distribuicao",
          "prioridade": "media"
        }
      ]
    },
    "ale": {
      "nome": "Ale Portela",
      "cargo": "Deputada Estadual",
      "cards": []
    }
  },
  "insights": [
    {
      "titulo": "insight viral disruptivo",
      "descricao": "como executar",
      "mandato": "lincoln"
    }
  ]
}`
          }],
        })
      });

      const data = await r.json();
      const raw = data?.content?.[0]?.text?.trim();
      if (!raw) throw new Error('Resposta vazia do Claude');

      // Parse robusto — 4 tentativas
      let parsed = null;
      for (const fn of [
        () => JSON.parse(raw),
        () => JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0]),
        () => JSON.parse(raw.replace(/```json|```/g, '').trim()),
        () => {
          const clean = raw.replace(/```json|```/g,'')
            .replace(/[\u2018\u2019]/g, "'")
            .replace(/[\u201C\u201D]/g, '"')
            .replace(/[\r\n]+/g, ' ');
          return JSON.parse(clean.match(/\{[\s\S]*\}/)?.[0]);
        },
      ]) {
        try { parsed = fn(); if (parsed) break; } catch {}
      }
      if (!parsed) throw new Error('JSON invalido — Claude retornou formato inesperado');

      // Data manual tem PRIORIDADE TOTAL sobre o que o Claude extraiu
      if (dataManual?.label) parsed.data = dataManual.label;
      if (dataManual?.mes)   parsed.mes  = dataManual.mes;
      if (titulo)            parsed.titulo = titulo;

      // Garante mes se ainda não tiver
      if (!parsed.mes) {
        const now = new Date();
        parsed.mes = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
      }

      const id = Date.now().toString();
      const entry = { ...parsed, id, timestamp: new Date().toISOString(), textoOriginal: texto.substring(0, 8000) };

      // Salva no KV ou memória
      if (hasKV) {
        // 1. Salva briefing completo
        await kvSet('briefing:' + id, entry);

        // 2. Atualiza índice
        let index = toArray(await kvGet('briefing:index').catch(() => null));
        index.unshift({
          id,
          data:       parsed.data || '',
          mes:        parsed.mes,
          titulo:     parsed.titulo || '',
          resumo:     parsed.resumo || '',
          timestamp:  entry.timestamp,
          totalCards: countCards(parsed),
        });
        index = index.slice(0, 500);
        await kvSet('briefing:index', index);
      } else {
        if (!global._briefings) global._briefings = [];
        global._briefings.unshift(entry);
        global._briefings = global._briefings.slice(0, 30);
      }

      return res.status(200).json({ ok: true, briefing: parsed, id, persistido: hasKV });

    } catch (e) {
      return res.status(500).json({ error: 'Falha ao processar briefing: ' + e.message });
    }
  }

  return res.status(405).json({ error: 'Metodo nao permitido' });
};
