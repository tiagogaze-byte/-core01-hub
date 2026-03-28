// api/users.js — gerenciamento de usuários (master only)

const KV_URL   = () => process.env.KV_REST_API_URL;
const KV_TOKEN = () => process.env.KV_REST_API_TOKEN;

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
    method: 'POST', headers: { Authorization: `Bearer ${KV_TOKEN()}` },
  });
}

function hashPass(pass) {
  let h = 0;
  const s = pass + 'core01salt2026';
  for (let i = 0; i < s.length; i++) { h = ((h << 5) - h) + s.charCodeAt(i); h |= 0; }
  return Math.abs(h).toString(36) + s.length.toString(36);
}

async function getSession(req) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return null;
  const session = await kvGet('session:' + token);
  if (!session) return null;
  if (new Date(session.expiresAt) < new Date()) return null;
  return session;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Verifica sessão
  const session = await getSession(req);
  if (!session) return res.status(401).json({ error: 'Não autenticado' });

  const { action } = req.query || {};

  // ── LISTAR usuários (admin + master) ──────────────────
  if (req.method === 'GET' && !action) {
    if (!['master', 'admin'].includes(session.role))
      return res.status(403).json({ error: 'Sem permissão' });

    const idx = (await kvGet('users:index')) || [];
    const users = await Promise.all(
      idx.map(email => kvGet('user:' + email).catch(() => null))
    );
    return res.status(200).json({
      ok: true,
      users: users.filter(Boolean).map(u => ({
        email: u.email, name: u.name, role: u.role,
        active: u.active, createdAt: u.createdAt, lastLogin: u.lastLogin,
        phone: u.phone || null,
      })),
    });
  }

  // ── CRIAR usuário (master only) ───────────────────────
  if (req.method === 'POST' && action === 'create') {
    if (session.role !== 'master') return res.status(403).json({ error: 'Apenas o Master pode criar usuários' });

    const { email, name, role, password, phone } = req.body || {};
    if (!email || !name || !password) return res.status(400).json({ error: 'Email, nome e senha obrigatórios' });
    if (!['admin', 'assessor'].includes(role)) return res.status(400).json({ error: 'Role inválido. Use: admin ou assessor' });

    const emailNorm = email.toLowerCase().trim();
    const existing = await kvGet('user:' + emailNorm);
    if (existing) return res.status(409).json({ error: 'Email já cadastrado' });

    const user = {
      email: emailNorm, name, role, phone: phone || null,
      active: true, passHash: hashPass(password),
      createdAt: new Date().toISOString(), lastLogin: null,
      createdBy: session.email,
    };
    await kvSet('user:' + emailNorm, user);

    // Atualiza índice
    const idx = (await kvGet('users:index')) || [];
    if (!idx.includes(emailNorm)) {
      idx.unshift(emailNorm);
      await kvSet('users:index', idx);
    }

    return res.status(200).json({ ok: true, user: { email: user.email, name: user.name, role: user.role } });
  }

  // ── ATUALIZAR usuário (master only, não pode alterar master) ──
  if (req.method === 'PUT' && action === 'update') {
    if (session.role !== 'master') return res.status(403).json({ error: 'Apenas o Master pode editar usuários' });

    const { email, name, phone, active, password } = req.body || {};
    if (!email) return res.status(400).json({ error: 'Email obrigatório' });

    const emailNorm = email.toLowerCase().trim();
    const user = await kvGet('user:' + emailNorm);
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });
    if (user.role === 'master') return res.status(403).json({ error: 'Não é possível editar o perfil Master' });

    if (name !== undefined) user.name = name;
    if (phone !== undefined) user.phone = phone;
    if (active !== undefined) user.active = active;
    if (password) user.passHash = hashPass(password);
    user.updatedAt = new Date().toISOString();

    await kvSet('user:' + emailNorm, user);
    return res.status(200).json({ ok: true });
  }

  // ── DELETAR usuário (master only) ─────────────────────
  if (req.method === 'DELETE' && action === 'delete') {
    if (session.role !== 'master') return res.status(403).json({ error: 'Apenas o Master pode deletar usuários' });

    const { email } = req.body || {};
    if (!email) return res.status(400).json({ error: 'Email obrigatório' });

    const emailNorm = email.toLowerCase().trim();
    const user = await kvGet('user:' + emailNorm);
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });
    if (user.role === 'master') return res.status(403).json({ error: 'Não é possível deletar o Master' });

    await kvDel('user:' + emailNorm);

    // Remove do índice
    const idx = ((await kvGet('users:index')) || []).filter(e => e !== emailNorm);
    await kvSet('users:index', idx);

    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Método não permitido' });
};
