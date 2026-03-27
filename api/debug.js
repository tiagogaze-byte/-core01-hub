// api/debug.js — diagnóstico do KV
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const KV_URL   = process.env.KV_REST_API_URL;
  const KV_TOKEN = process.env.KV_REST_API_TOKEN;

  if (!KV_URL || !KV_TOKEN) {
    return res.status(200).json({ ok: false, erro: 'Variáveis KV não encontradas' });
  }

  function desserializar(val) {
    let v = val;
    for (let i = 0; i < 4; i++) {
      if (typeof v !== 'string') break;
      try { v = JSON.parse(v); } catch { break; }
    }
    return v;
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
    const indexDesserializado = desserializar(idxData.result);

    return res.status(200).json({
      ok: true,
      kvUrl: KV_URL.substring(0, 40) + '...',
      setOk: setData.result === 'OK',
      getOk: !!getData.result,
      index: {
        raw: typeof idxData.result,
        totalBriefings: Array.isArray(indexDesserializado) ? indexDesserializado.length : 0,
        primeiros: Array.isArray(indexDesserializado) ? indexDesserializado.slice(0, 3) : indexDesserializado,
      },
    });
  } catch (e) {
    return res.status(500).json({ ok: false, erro: e.message });
  }
};
