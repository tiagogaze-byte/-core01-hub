// api/debug.js — diagnóstico do KV (remover em produção)
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const KV_URL   = process.env.KV_REST_API_URL;
  const KV_TOKEN = process.env.KV_REST_API_TOKEN;

  if (!KV_URL || !KV_TOKEN) {
    return res.status(200).json({ ok: false, erro: 'Variáveis KV não encontradas', vars: { KV_URL: !!KV_URL, KV_TOKEN: !!KV_TOKEN } });
  }

  try {
    // Testa SET
    const setRes = await fetch(`${KV_URL}/set/debug-test`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ teste: true, ts: Date.now() }),
    });
    const setData = await setRes.json();

    // Testa GET
    const getRes = await fetch(`${KV_URL}/get/debug-test`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
    });
    const getData = await getRes.json();

    // Testa índice
    const idxRes = await fetch(`${KV_URL}/get/briefing%3Aindex`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
    });
    const idxData = await idxRes.json();

    return res.status(200).json({
      ok: true,
      kvUrl: KV_URL.substring(0, 40) + '...',
      setResult: setData,
      getResult: getData,
      indexResult: idxData,
      indexTipo: typeof idxData.result,
      indexVazio: !idxData.result,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, erro: e.message });
  }
};
