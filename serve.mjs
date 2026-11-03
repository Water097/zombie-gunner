#!/usr/bin/env node
// 本地静态服务器（替代 python -m http.server）
//
// 为什么需要它：ES module 会被浏览器按 URL 缓存，python 的 http.server 又不发缓存头，
// 结果是「改了代码、刷新页面，看到的还是旧版本」——今天已经踩过两次（面板里少了新加的卡）。
// 这个服务强制 `Cache-Control: no-store`，改完刷新即生效。
//
// 用法：node serve.mjs          （默认 8123）
//       node serve.mjs 8124     （换端口）

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.argv[3] || '.');
const PORT = Number(process.argv[2] || 8123);
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8',
};

http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  let filePath = path.join(ROOT, urlPath === '/' ? 'index.html' : urlPath);
  // 防目录穿越
  if (!filePath.startsWith(ROOT)) { res.writeHead(403).end('forbidden'); return; }
  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store, no-cache, must-revalidate', // 关键：不做任何缓存
      'Pragma': 'no-cache',
      'Expires': '0',
    });
    fs.createReadStream(filePath).pipe(res);
  });
}).listen(PORT, () => {
  console.log(`要塞射击 Demo： http://localhost:${PORT}  （no-store，改完刷新即生效）`);
});
