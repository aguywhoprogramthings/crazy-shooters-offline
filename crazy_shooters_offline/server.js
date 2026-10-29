const http = require('http');
const fs = require('fs');
const path = require('path');

const DEFAULT_PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 8088;
const ROOT = path.resolve(__dirname);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.unityweb': 'application/octet-stream',
  '.data': 'application/octet-stream',
  '.mem': 'application/octet-stream'
};

function createServer(port) {
  const server = http.createServer((req, res) => {
    const reqPath = decodeURIComponent(req.url.split('?')[0]);
    let safePath = path.normalize(path.join(ROOT, reqPath === '/' ? 'index.html' : reqPath));

    if (!safePath.startsWith(ROOT)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      return res.end('Access Denied');
    }

    fs.stat(safePath, (err, stats) => {
      if (err || !stats.isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        return res.end('File Not Found: ' + reqPath);
      }

      const ext = path.extname(safePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';

      const headers = {
        'Content-Type': contentType,
        'Content-Length': stats.size,
        'Access-Control-Allow-Origin': '*',
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
        'Cache-Control': 'no-cache'
      };

      if (ext === '.unityweb') {
        headers['Content-Encoding'] = 'gzip';
      }

      res.writeHead(200, headers);
      fs.createReadStream(safePath).pipe(res);
    });
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`Port ${port} in use, trying ${port + 1}...`);
      createServer(port + 1);
    } else {
      console.error('Server error:', err);
    }
  });

  server.listen(port, '127.0.0.1', () => {
    console.log(`=======================================================`);
    console.log(`🎮 Crazy Shooters Offline Server is RUNNING!`);
    console.log(`📡 URL: http://127.0.0.1:${port}`);
    console.log(`📂 Root: ${ROOT}`);
    console.log(`⚡ Gzip Streaming & Cross-Origin Isolation: ACTIVE`);
    console.log(`=======================================================`);
  });
}

createServer(DEFAULT_PORT);
