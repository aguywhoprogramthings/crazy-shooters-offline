'use strict';

// These exercise the real Windows batch/PowerShell launchers in CI. An older
// server occupies the requested port, so blindly opening it would be a failure.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawn, spawnSync } = require('node:child_process');

function request(port) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: '/' }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks).toString()));
    }).on('error', reject);
  });
}

function runLauncher(command, args, port) {
  return new Promise(resolve => {
    // File handles avoid waiting forever for a background server that inherited
    // a pipe from cmd.exe. Resolve on launcher exit, not on pipe closure.
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'crazy-shooters-launcher-'));
    const stdoutPath = path.join(temp, 'stdout.txt');
    const stderrPath = path.join(temp, 'stderr.txt');
    const stdout = fs.openSync(stdoutPath, 'w');
    const stderr = fs.openSync(stderrPath, 'w');
    const child = spawn(command, args, {
      cwd: path.resolve('crazy_shooters_offline'),
      env: { ...process.env, PORT: String(port), CSO_NO_BROWSER: '1' },
      windowsHide: true,
      stdio: ['ignore', stdout, stderr]
    });
    let finished = false;
    const finish = (code, extra = '') => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      fs.closeSync(stdout); fs.closeSync(stderr);
      const output = fs.readFileSync(stdoutPath, 'utf8') + fs.readFileSync(stderrPath, 'utf8') + extra;
      // On Windows an inherited open handle can temporarily prevent removal.
      try { fs.rmSync(temp, { recursive: true, force: true }); } catch (e) {}
      resolve({ code, output });
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(null, '\nLauncher timed out.');
    }, 40000);
    child.on('error', error => finish(null, '\n' + error.message));
    child.on('exit', code => finish(code));
  });
}

async function checkLauncher(command, args) {
  const oldServer = http.createServer((req, res) => res.end('old copy'));
  await new Promise((resolve, reject) => {
    oldServer.once('error', reject);
    oldServer.listen(0, '127.0.0.1', resolve);
  });
  const occupiedPort = oldServer.address().port;
  let serverPid;
  try {
    const result = await runLauncher(command, args, occupiedPort);
    const match = result.output.match(/Server ready: port (\d+), PID (\d+)\./);
    if (match) serverPid = Number(match[2]);
    assert.equal(result.code, 0, result.output);
    assert.ok(match, result.output);
    const port = Number(match[1]);
    assert.ok(serverPid > 0);
    assert.notEqual(port, occupiedPort, result.output);
    assert.match(result.output, new RegExp(`Game URL: http://127\\.0\\.0\\.1:${port}/index\\.html`));
    assert.equal(await request(occupiedPort), 'old copy');
    assert.match(await request(port), /Optimized v3/);
  } finally {
    if (serverPid) spawnSync('taskkill.exe', ['/PID', String(serverPid), '/T', '/F'], { windowsHide: true, timeout: 10000 });
    oldServer.closeAllConnections();
    await new Promise(resolve => oldServer.close(resolve));
  }
}

const onlyWindows = { skip: process.platform !== 'win32' };
test('batch launcher opens the new server rather than an occupied port', onlyWindows, async () => {
  await checkLauncher('cmd.exe', ['/d', '/c', 'call', 'start_game.bat']);
});

test('PowerShell launcher opens the new server rather than an occupied port', onlyWindows, async () => {
  await checkLauncher('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'start_game.ps1']);
});
