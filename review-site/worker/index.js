import { authenticate } from './access.js';
import { handleComments, json } from './comments.js';
import reviewJs from './client/review.js';
import reviewCss from './client/review.css';

const SECURITY = {
  'X-Robots-Tag': 'noindex, nofollow',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'same-origin',
  'X-Content-Type-Options': 'nosniff',
};

function withHeaders(res, extra = {}) {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries({ ...SECURITY, ...extra })) out.headers.set(k, v);
  return out;
}

function denyPage(message) {
  const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>无法访问 · Niu-Talent 评审站</title>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#f3f4f1;color:#1b1e25;font:15px/1.6 -apple-system,'PingFang SC',sans-serif">
<main style="max-width:28em;padding:24px"><h1 style="font-size:20px;margin:0 0 8px">无法访问评审站</h1><p style="margin:0;color:#474c56">${message}</p></main></body></html>`;
  return new Response(html, { status: 403, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}

// 给每个 HTML 页面挂上评论层；设计系统等页面同样可以评论
function injectReview(res) {
  return new HTMLRewriter()
    .on('head', { element: (el) => el.append('<link rel="stylesheet" href="/__review/review.css">', { html: true }) })
    .on('body', { element: (el) => el.append('<script src="/__review/review.js" defer></script>', { html: true }) })
    .transform(res);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const auth = await authenticate(request, env);
    if (auth.error) {
      return url.pathname.startsWith('/api/') ? json({ error: auth.error }, 403) : denyPage(auth.error);
    }

    if (url.pathname.startsWith('/api/')) {
      if (url.pathname === '/api/me') return withHeaders(json({ email: auth.email }), { 'Cache-Control': 'no-store' });
      try {
        return withHeaders(await handleComments(request, env, auth.email, url.pathname), { 'Cache-Control': 'no-store' });
      } catch (e) {
        console.error('comments api failed', e);
        return withHeaders(json({ error: '评论服务暂时不可用，请稍后重试' }, 500), { 'Cache-Control': 'no-store' });
      }
    }

    if (url.pathname === '/__review/review.js') {
      return withHeaders(new Response(reviewJs, { headers: { 'Content-Type': 'text/javascript; charset=utf-8' } }), { 'Cache-Control': 'no-cache' });
    }
    if (url.pathname === '/__review/review.css') {
      return withHeaders(new Response(reviewCss, { headers: { 'Content-Type': 'text/css; charset=utf-8' } }), { 'Cache-Control': 'no-cache' });
    }

    const res = await env.ASSETS.fetch(request);
    const type = res.headers.get('Content-Type') || '';
    if (type.includes('text/html')) return withHeaders(injectReview(res), { 'Cache-Control': 'no-cache' });
    return withHeaders(res);
  },
};
