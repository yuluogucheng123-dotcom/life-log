/* =====================================================================
 * Service Worker · 离线缓存
 *
 * 设计要点（避免首屏白屏）：
 *   1. 任何分支都必须返回一个有效的 Response，绝不返回 undefined。
 *   2. 安装阶段预缓存失败不阻断激活。
 *   3. 静态资源用「stale-while-revalidate」，网络失败时回退缓存。
 *   4. 数据存在 localStorage，不经过 SW，因此断网也能完整使用。
 * ===================================================================== */

const CACHE = 'lifelog-v6';

const SHELL = [
  './',
  './index.html',
  './style.css',
  './config.js',
  './vendor/supabase.js',
  './data.js',
  './insight.js',
  './sync.js',
  './app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

/* ---------- 安装：逐个预缓存，单个失败不影响整体 ---------- */
self.addEventListener('install', (ev) => {
  ev.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(SHELL.map(async (url) => {
      try {
        const res = await fetch(new Request(url, { cache: 'reload' }));
        if (res && res.ok) await cache.put(url, res);
      } catch (e) {
        console.warn('[SW] 预缓存跳过:', url, e.message);
      }
    }));
    await self.skipWaiting();
  })());
});

/* ---------- 激活：清理旧缓存 ---------- */
self.addEventListener('activate', (ev) => {
  ev.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

/* ---------- 统一的网络回退：保证永远有响应 ---------- */
async function networkFirst(req, fallbackUrl) {
  try {
    const res = await fetch(req);
    if (res && res.ok) {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(fallbackUrl || req, copy)).catch(() => {});
    }
    return res;
  } catch (e) {
    const cached = await caches.match(fallbackUrl || req, { ignoreSearch: true });
    if (cached) return cached;
    // 最后兜底：HTML 请求返回缓存的首页，其余返回 503
    if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
      const home = await caches.match('./index.html');
      if (home) return home;
      return new Response('<h1>离线</h1><p>请恢复网络后重试。</p>', {
        status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }
    return new Response('', { status: 503, statusText: 'Offline' });
  }
}

async function staleWhileRevalidate(req) {
  const cached = await caches.match(req, { ignoreSearch: true });
  const fetching = fetch(req).then((res) => {
    // basic = 同源；cors = 跨域 CDN。两者都可缓存（不透明的 opaque 除外）
    if (res && res.ok && (res.type === 'basic' || res.type === 'cors')) {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
    }
    return res;
  }).catch(() => null);

  if (cached) return cached;
  const fresh = await fetching;
  return fresh || new Response('', { status: 503, statusText: 'Offline' });
}

/* ---------- 请求拦截 ---------- */
self.addEventListener('fetch', (ev) => {
  const req = ev.request;

  // 只处理 GET
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch (e) { return; }

  // 跨域：只放行 Supabase 的云同步请求走网络（不缓存业务数据），
  // 其余跨域静态资源（如 CDN 上的 SDK）正常缓存，保证离线可用
  if (url.origin !== self.location.origin) {
    const isSupabase = /supabase\.co$/.test(url.hostname) || /supabase\.in$/.test(url.hostname);
    if (isSupabase) return;                 // 交给浏览器，不拦截
    ev.respondWith(staleWhileRevalidate(req));
    return;
  }

  // 页面导航：网络优先，离线回退首页
  if (req.mode === 'navigate') {
    ev.respondWith(networkFirst(req, './index.html'));
    return;
  }

  // 同源静态资源：缓存优先，后台更新
  ev.respondWith(staleWhileRevalidate(req));
});
