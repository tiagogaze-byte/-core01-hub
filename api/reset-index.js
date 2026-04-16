// api/reset-index.js — limpa e reconstrói o índice do KV
// Use UMA VEZ para corrigir o double encoding
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const KV_URL   = process.env.KV_REST_API_URL;
  const KV_TOKEN = process.env.KV_REST_API_TOKEN;
  if (!KV_URL || !KV_TOKEN) return res.status(500).json({ error: 'KV não configurado' });

  try {
    // 1. Lê o índice atual (corrompido)
    const getRes = await fetch(`${KV_URL}/get/briefing%3Aindex`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
    });
    const getData = await getRes.json();

    // 2. Desempacota todos os níveis de encoding
    let index = getData.result;
    for (let i = 0; i < 5; i++) {
      if (typeof index !== 'string') break;
      try { index = JSON.parse(index); } catch { break; }
    }

    // 3. Garante que é array
    if (!Array.isArray(index)) index = [];

    // 4. Reescreve limpo (sem double encoding)
    const setRes = await fetch(`${KV_URL}/set/briefing%3Aindex`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(index), // salva uma única vez, sem double stringify
    });
    const setData = await setRes.json();

    return res.status(200).json({
      ok: true,
      msg: 'Índice reconstruído com sucesso',
      totalBriefings: index.length,
      setResult: setData,
      amostra: index.slice(0, 3),
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
