/* =====================================================================
 * 生活记录 · 本地静态服务器
 *
 * 用法：node server.js [端口]
 * 默认监听 0.0.0.0，因此同一局域网内的手机也能访问。
 * ===================================================================== */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = Number(process.argv[2]) || 8788;
const ROOT = __dirname;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.sql': 'text/plain; charset=utf-8',
  '.ps1': 'text/plain; charset=utf-8',
};

function lanAddresses() {
  const out = [];
  const nics = os.networkInterfaces();
  for (const name of Object.keys(nics)) {
    for (const info of nics[name] || []) {
      if (info.family === 'IPv4' && !info.internal) {
        out.push({ name, address: info.address });
      }
    }
  }
  return out;
}

const server = http.createServer((req, res) => {
  let urlPath;
  try {
    urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  } catch (e) {
    res.writeHead(400).end('Bad Request');
    return;
  }

  if (urlPath === '/') urlPath = '/index.html';

  // 阻止目录穿越
  const filePath = path.join(ROOT, urlPath);
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 找不到：' + urlPath);
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': TYPES[ext] || 'application/octet-stream',
      'Content-Length': stat.size,
      // 不缓存，方便改完代码立刻看到效果
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    });

    const stream = fs.createReadStream(filePath);
    stream.on('error', () => res.end());
    stream.pipe(res);
  });
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  端口 ${PORT} 被占用。换个端口：node server.js 8790\n`);
  } else {
    console.error('\n  启动失败：', err.message, '\n');
  }
  process.exit(1);
});

server.listen(PORT, '0.0.0.0', () => {
  const ips = lanAddresses();
  console.log('');
  console.log('  本机访问:  http://localhost:' + PORT);
  if (ips.length) {
    ips.forEach((i) => {
      console.log('  局域网:    http://' + i.address + ':' + PORT + '   (' + i.name + ')');
    });
  } else {
    console.log('  局域网:    未检测到可用地址');
  }
  console.log('');
  console.log('  按 Ctrl+C 停止');
  console.log('');
});
