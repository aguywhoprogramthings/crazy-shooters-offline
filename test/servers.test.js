'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const zlib = require('node:zlib');
const fs = require('node:fs');
const os = require('node:os');
const { spawn, spawnSync } = require('node:child_process');
const path = require('node:path');

function startServer(command, script) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [script], {
      cwd: path.resolve('crazy_shooters_offline'),
      env: { ...process.env, HOST: '127.0.0.1', PORT: '0', PYTHONUNBUFFERED: '1' },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let output = '';
    const timeout = setTimeout(() => { child.kill(); reject(new Error(`Server failed to start: ${output}`)); }, 10000);
    child.on('error', err => { clearTimeout(timeout); reject(err); });
    child.on('exit', code => { if (!child.ready) { clearTimeout(timeout); reject(new Error(`Server exited ${code}: ${output}`)); } });
    for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => {
      output += chunk;
      const match = output.match(/http:\/\/127\.0\.0\.1:(\d+)/);
      if (match && !child.ready) {
        child.ready = true; clearTimeout(timeout); resolve({ child, port: Number(match[1]) });
      }
    });
  });
}

function request(port, requestPath, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: requestPath, method }, res => {
      const chunks = [];
      res.on('data', data => chunks.push(data));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject); req.end();
  });
}

async function checkServer(command, script) {
  const { child, port } = await startServer(command, script);
  try {
    const [index, manifest, head, asset, traversal, bad] = await Promise.all([
      request(port, '/'), request(port, '/Build/game.json?cache=1'),
      request(port, '/Build/game.asm.memory.unityweb', 'HEAD'),
      request(port, '/Build/game.asm.memory.unityweb'),
      request(port, '/%2e%2e%2f%2e%2e%2fetc%2fpasswd'), request(port, '/%00')
    ]);
    assert.equal(index.status, 200); assert.match(index.body.toString(), /heap_scanner\.js/);
    assert.equal(manifest.status, 200); assert.equal(JSON.parse(manifest.body).TOTAL_MEMORY, 268435456);
    assert.equal(head.status, 200); assert.equal(head.body.length, 0); assert.equal(head.headers['content-encoding'], 'gzip');
    assert.equal(asset.status, 200); assert.equal(asset.headers['content-encoding'], 'gzip');
    assert.equal(asset.headers['cross-origin-opener-policy'], 'same-origin');
    assert.equal(asset.headers['cross-origin-embedder-policy'], 'require-corp');
    assert.ok(zlib.gunzipSync(asset.body).length > 1000000);
    assert.equal(traversal.status, 403); assert.equal(bad.status, 400);
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'crazy-shooters-test-'));
    const linkName = `.server-test-link-${process.pid}`;
    const link = path.resolve('crazy_shooters_offline', linkName);
    try {
      fs.writeFileSync(path.join(outside, 'secret.txt'), 'not served');
      try { fs.symlinkSync(outside, link, 'dir'); } catch (err) {
        // Windows may require elevated privileges for symlink creation.
        if (process.platform !== 'win32') throw err;
      }
      if (fs.existsSync(link)) assert.equal((await request(port, `/${linkName}/secret.txt`)).status, 403);
    } finally {
      fs.rmSync(link, { force: true }); fs.rmSync(outside, { recursive: true, force: true });
    }
  } finally {
    child.kill();
  }
}

test('Node server streams Unity assets with the right headers', async () => {
  await checkServer(process.execPath, 'server.js');
});

test('Python server streams Unity assets concurrently with the right headers', async t => {
  const python = ['python3', 'python'].find(cmd => spawnSync(cmd, ['--version']).status === 0);
  if (!python) return t.skip('Python is not installed');
  await checkServer(python, 'server.py');
});
