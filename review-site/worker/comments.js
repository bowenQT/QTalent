// 评论接口：GET/POST /api/comments，PATCH/DELETE /api/comments/:id
// 任何登录者都能评论、回复、标记已解决；只能修改或删除自己的评论，有回复的讨论不能删。

const COLS = 'id, parent_id, page, author, body, kind, quote, prefix, suffix, selector, label, context, resolved, resolved_by, created_at, updated_at';
const PAGE_RE = /^\/[\w\-./]*(\?[\w\-=&.%]*)?$/;

export const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });

const clip = (v, max) => (v == null ? null : String(v).slice(0, max));
const now = () => new Date().toISOString();

// 写操作只接受同源 JSON，挡住跨站表单
function sameOrigin(request) {
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) return false;
  if (request.method === 'DELETE') return true;
  return (request.headers.get('Content-Type') || '').includes('application/json');
}

async function readJson(request) {
  try { return await request.json(); } catch (e) { return null; }
}

function cleanContext(ctx) {
  if (!ctx || typeof ctx !== 'object') return null;
  const s = JSON.stringify(ctx);
  return s.length > 2000 ? null : s;
}

async function list(request, env, me) {
  const q = new URL(request.url).searchParams;
  if (q.get('summary') === '1') {
    const { results } = await env.DB.prepare(
      'SELECT page, SUM(CASE WHEN resolved = 0 THEN 1 ELSE 0 END) AS open, COUNT(*) AS total FROM comments WHERE parent_id IS NULL GROUP BY page'
    ).all();
    return json({ me, pages: results });
  }
  const page = q.get('page') || '';
  if (!PAGE_RE.test(page) || page.length > 200) return json({ error: '页面参数不对' }, 400);
  const { results } = await env.DB.prepare(`SELECT ${COLS} FROM comments WHERE page = ? ORDER BY created_at`).bind(page).all();
  return json({ me, comments: results });
}

async function create(request, env, me) {
  const b = await readJson(request);
  if (!b) return json({ error: '请求格式不对' }, 400);
  const body = clip(String(b.body || '').trim(), 4000);
  if (!body) return json({ error: '评论不能为空' }, 400);
  const id = crypto.randomUUID();
  const t = now();

  if (b.parent_id) {
    const parent = await env.DB.prepare('SELECT id, parent_id, page FROM comments WHERE id = ?').bind(String(b.parent_id)).first();
    if (!parent || parent.parent_id) return json({ error: '要回复的讨论不存在' }, 400);
    await env.DB.prepare('INSERT INTO comments (id, parent_id, page, author, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(id, parent.id, parent.page, me, body, t, t).run();
  } else {
    const page = String(b.page || '');
    if (!PAGE_RE.test(page) || page.length > 200) return json({ error: '页面参数不对' }, 400);
    const kind = b.kind === 'element' ? 'element' : 'text';
    const quote = clip(String(b.quote || '').trim(), 1000);
    const selector = clip(String(b.selector || '').trim(), 600);
    if (kind === 'text' && !quote) return json({ error: '缺少划线原文' }, 400);
    if (kind === 'element' && !selector) return json({ error: '缺少元素位置' }, 400);
    await env.DB.prepare(
      'INSERT INTO comments (id, parent_id, page, author, body, kind, quote, prefix, suffix, selector, label, context, created_at, updated_at) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(id, page, me, body, kind, quote || null, clip(b.prefix, 80), clip(b.suffix, 80), selector || null, clip(b.label, 120), cleanContext(b.context), t, t).run();
  }
  const row = await env.DB.prepare(`SELECT ${COLS} FROM comments WHERE id = ?`).bind(id).first();
  return json({ comment: row }, 201);
}

async function update(request, env, me, id) {
  const b = await readJson(request);
  if (!b) return json({ error: '请求格式不对' }, 400);
  const row = await env.DB.prepare('SELECT id, parent_id, author FROM comments WHERE id = ?').bind(id).first();
  if (!row) return json({ error: '评论不存在' }, 404);
  const t = now();
  if (typeof b.resolved === 'boolean') {
    if (row.parent_id) return json({ error: '只能对整条讨论标记' }, 400);
    await env.DB.prepare('UPDATE comments SET resolved = ?, resolved_by = ?, updated_at = ? WHERE id = ?')
      .bind(b.resolved ? 1 : 0, b.resolved ? me : null, t, id).run();
  } else if (typeof b.body === 'string') {
    if (row.author !== me) return json({ error: '只能修改自己的评论' }, 403);
    const body = clip(b.body.trim(), 4000);
    if (!body) return json({ error: '评论不能为空' }, 400);
    await env.DB.prepare('UPDATE comments SET body = ?, updated_at = ? WHERE id = ?').bind(body, t, id).run();
  } else {
    return json({ error: '没有要修改的内容' }, 400);
  }
  const fresh = await env.DB.prepare(`SELECT ${COLS} FROM comments WHERE id = ?`).bind(id).first();
  return json({ comment: fresh });
}

async function remove(env, me, id) {
  const row = await env.DB.prepare('SELECT id, author FROM comments WHERE id = ?').bind(id).first();
  if (!row) return json({ error: '评论不存在' }, 404);
  if (row.author !== me) return json({ error: '只能删除自己的评论' }, 403);
  const replies = await env.DB.prepare('SELECT COUNT(*) AS n FROM comments WHERE parent_id = ?').bind(id).first();
  if (replies?.n > 0) return json({ error: '已有回复，不能删除' }, 400);
  await env.DB.prepare('DELETE FROM comments WHERE id = ?').bind(id).run();
  return json({ ok: true });
}

export async function handleComments(request, env, me, path) {
  const m = path.match(/^\/api\/comments(?:\/([0-9a-f-]{36}))?$/);
  if (!m) return json({ error: '接口不存在' }, 404);
  const id = m[1];
  if (request.method !== 'GET' && !sameOrigin(request)) return json({ error: '请求来源不对' }, 400);
  if (!id && request.method === 'GET') return list(request, env, me);
  if (!id && request.method === 'POST') return create(request, env, me);
  if (id && request.method === 'PATCH') return update(request, env, me, id);
  if (id && request.method === 'DELETE') return remove(env, me, id);
  return json({ error: '不支持的请求' }, 405);
}
