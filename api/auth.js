// api/auth.js — autenticação completa
// KV keys: user:EMAIL, session:TOKEN

const KV_URL   = () => process.env.KV_REST_API_URL;
const KV_TOKEN = () => process.env.KV_REST_API_TOKEN;
const MASTER_EMAIL = process.env.MASTER_EMAIL || 'master@core01.com';
const MASTER_PASS  = process.env.MASTER_PASS  || 'core01master2026';

async function kvSet(key, value) {
  const body = typeof value === 'string' ? value : JSON.stringify(value);
  const r = await fetch(`${KV_URL()}/set/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN()}`, 'Content-Type': 'application/json' },
    body,
  });
  return r.json();
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

async function kvDel(key) {
  await fetch(`${KV_URL()}/del/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN()}` },
  });
}

// Hash simples (sem bcrypt para evitar deps)
function hashPass(pass) {
  let h = 0;
  const s = pass + 'core01salt2026';
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h) + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h).toString(36) + s.length.toString(36);
}

function genToken() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36) + Math.random().toString(36).slice(2);
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action } = req.query || {};

  // ── SEED: cria/recria master com as variáveis do Vercel ──
  if (action === 'seed') {
    // Remove master antigo (qualquer email) do índice
    const idx = (await kvGet('users:index')) || [];
    // Recria sempre com as variáveis atuais
    const masterUser = {
      email: MASTER_EMAIL,
      name: 'Master',
      role: 'master',
      active: true,
      passHash: hashPass(MASTER_PASS),
      createdAt: new Date().toISOString(),
    };
    await kvSet('user:' + MASTER_EMAIL, masterUser);

    // Garante que está no índice
    if (!idx.includes(MASTER_EMAIL)) {
      idx.unshift(MASTER_EMAIL);
      await kvSet('users:index', idx);
    }
    return res.status(200).json({ ok: true, msg: 'Master criado/atualizado: ' + MASTER_EMAIL });
  }

  // ── LOGIN ─────────────────────────────────────────────
  if (action === 'login' && req.method === 'POST') {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Email e senha obrigatórios' });

    const user = await kvGet('user:' + email.toLowerCase().trim());
    if (!user) return res.status(401).json({ error: 'Usuário não encontrado' });
    if (!user.active) return res.status(401).json({ error: 'Acesso desativado' });
    if (user.passHash !== hashPass(password)) return res.status(401).json({ error: 'Senha incorreta' });

    // Gera token de sessão (expira em 7 dias)
    const token = genToken();
    const session = {
      token, email: user.email, name: user.name,
      role: user.role, createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    };
    await kvSet('session:' + token, session);

    // Registra último login
    user.lastLogin = new Date().toISOString();
    await kvSet('user:' + user.email, user);

    return res.status(200).json({ ok: true, token, user: { email: user.email, name: user.name, role: user.role } });
  }

  // ── LOGOUT ────────────────────────────────────────────
  if (action === 'logout' && req.method === 'POST') {
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    if (token) await kvDel('session:' + token);
    return res.status(200).json({ ok: true });
  }

  // ── VERIFY (valida token) ─────────────────────────────
  if (action === 'verify') {
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Token ausente' });
    const session = await kvGet('session:' + token);
    if (!session) return res.status(401).json({ error: 'Sessão inválida' });
    if (new Date(session.expiresAt) < new Date()) {
      await kvDel('session:' + token);
      return res.status(401).json({ error: 'Sessão expirada' });
    }
    return res.status(200).json({ ok: true, user: { email: session.email, name: session.name, role: session.role } });
  }

  return res.status(405).json({ error: 'Método não permitido' });
};
