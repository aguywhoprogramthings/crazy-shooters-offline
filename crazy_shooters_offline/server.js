const http = require('http');
const fs = require('fs');
const path = require('path');

const DEFAULT_PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 8088;
const HOST = process.env.HOST || '127.0.0.1';
const ROOT = fs.realpathSync(__dirname);

// The Windows launchers need the port of *this* server, not merely the
// default port (which may belong to an older copy). Publish it atomically
// only after listen() succeeds. Manual launches do not need a ready file.
function publishReadyFile(port) {
  const readyFile = process.env.CSO_PORT_FILE;
  if (!readyFile) return;
  const temporaryFile = `${readyFile}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporaryFile, `${port},${process.pid}\n`, { encoding: 'utf8', flag: 'wx' });
    fs.renameSync(temporaryFile, readyFile);
  } finally {
    try { fs.unlinkSync(temporaryFile); } catch (err) { if (err.code !== 'ENOENT') throw err; }
  }
}

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
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' });
      return res.end();
    }
    let reqPath;
    try {
      reqPath = decodeURIComponent(req.url.split('?')[0].split('#')[0]);
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      return res.end('Invalid request path');
    }
    if (reqPath.includes('\0')) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      return res.end('Invalid request path');
    }
    const safePath = path.resolve(ROOT, '.' + (reqPath === '/' ? '/index.html' : reqPath));
    const relative = path.relative(ROOT, safePath);
    if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      return res.end('Access Denied');
    }

    // Resolve symlinks too; lexical normalization alone cannot prevent a
    // link inside the game folder from exposing files outside it.
    fs.realpath(safePath, (realError, realPath) => {
      if (realError) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        return res.end('File Not Found: ' + reqPath);
      }
      const realRelative = path.relative(ROOT, realPath);
      if (realRelative === '..' || realRelative.startsWith('..' + path.sep) || path.isAbsolute(realRelative)) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        return res.end('Access Denied');
      }
      fs.stat(realPath, (err, stats) => {
        if (err || !stats.isFile()) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          return res.end('File Not Found: ' + reqPath);
        }

        const ext = path.extname(realPath).toLowerCase();
        const headers = {
          'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
          'Content-Length': stats.size,
          'Access-Control-Allow-Origin': '*',
          'Cross-Origin-Opener-Policy': 'same-origin',
          'Cross-Origin-Embedder-Policy': 'require-corp',
          'Cache-Control': 'no-cache'
        };
        if (ext === '.unityweb') headers['Content-Encoding'] = 'gzip';
        res.writeHead(200, headers);
        if (req.method === 'HEAD') return res.end();
        const stream = fs.createReadStream(realPath);
        stream.on('error', () => res.destroy());
        stream.pipe(res);
      });
    });
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`Port ${port} in use, trying ${port + 1}...`);
      createServer(port + 1);
    } else {
      console.error('Server error:', err);
      process.exitCode = 1;
    }
  });

  server.listen(port, HOST, () => {
    const actualPort = server.address().port;
    try {
      publishReadyFile(actualPort);
    } catch (error) {
      console.error('Could not publish server readiness:', error.message);
      process.exitCode = 1;
      server.close();
      return;
    }
    console.log('=======================================================');
    console.log('Crazy Shooters Local Web Server is RUNNING!');
    console.log(`URL: http://127.0.0.1:${actualPort}`);
    console.log(`Root: ${ROOT}`);
    console.log('Gzip Streaming & Cross-Origin Isolation: ACTIVE');
    console.log('=======================================================');
  });
}

createServer(DEFAULT_PORT);
