// 校验 Cloudflare Access 签发的登录凭证：签名、受众、签发方、过期时间和邮箱域名。
// Access 在边缘先挡一道；这里再验一次，防止有人绕过 Access 直接访问 workers.dev 地址。

let certCache = { team: '', keys: null, at: 0 };

async function getKeys(team) {
  if (certCache.keys && certCache.team === team && Date.now() - certCache.at < 3600e3) return certCache.keys;
  const r = await fetch(`https://${team}/cdn-cgi/access/certs`);
  if (!r.ok) throw new Error(`certs ${r.status}`);
  const j = await r.json();
  certCache = { team, keys: j.keys || [], at: Date.now() };
  return certCache.keys;
}

function b64url(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

const decode = (part) => JSON.parse(new TextDecoder().decode(b64url(part)));

async function verify(token, env) {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, p, sig] = parts;
  const header = decode(h);
  const jwk = (await getKeys(env.ACCESS_TEAM_DOMAIN)).find((k) => k.kid === header.kid);
  if (!jwk) return null;
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64url(sig), new TextEncoder().encode(`${h}.${p}`));
  if (!ok) return null;
  const payload = decode(p);
  if (!payload.exp || payload.exp < Date.now() / 1000) return null;
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(env.ACCESS_AUD)) return null;
  if (payload.iss !== `https://${env.ACCESS_TEAM_DOMAIN}`) return null;
  return payload;
}

function cookie(request, name) {
  const m = (request.headers.get('Cookie') || '').match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? m[1] : '';
}

const LOCAL = new Set(['localhost', '127.0.0.1']);

// 返回 { email } 或 { error }；error 是给访问者看的原因
export async function authenticate(request, env) {
  const url = new URL(request.url);
  // 仅本机调试：wrangler dev 下用 .dev.vars 的 DEV_BYPASS_EMAIL 模拟登录
  if (env.DEV_BYPASS_EMAIL && LOCAL.has(url.hostname)) return { email: env.DEV_BYPASS_EMAIL.toLowerCase() };

  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) return { error: '访问控制尚未配置，站点暂不开放。' };
  const token = request.headers.get('Cf-Access-Jwt-Assertion') || cookie(request, 'CF_Authorization');
  if (!token) return { error: '请先用公司邮箱验证后再访问。' };
  let payload = null;
  try { payload = await verify(token, env); } catch (e) { console.error('access verify failed', e); }
  const email = String(payload?.email || '').toLowerCase();
  const domain = String(env.ALLOWED_DOMAIN || '').toLowerCase();
  if (!email || !domain || !email.endsWith(`@${domain}`)) return { error: `仅限 @${domain || '公司'} 邮箱访问。` };
  return { email };
}
