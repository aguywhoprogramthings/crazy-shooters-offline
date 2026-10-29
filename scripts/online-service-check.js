'use strict';

// Optional live check: use the actual Unity client and original Photon service.
// This does not create or join a room. Unlike the main browser smoke test, it
// requires outbound network access and is inherently dependent on a third party.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');

function startServer() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['server.js'], {
      cwd: path.resolve('crazy_shooters_offline'),
      env: { ...process.env, HOST: '127.0.0.1', PORT: '0', CSO_PORT_FILE: '' },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let output = '';
    const timeout = setTimeout(() => { child.kill(); reject(new Error('Server startup timed out')); }, 10000);
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

function browserPath() {
  const paths = [process.env.CHROMIUM_PATH, process.env.GOOGLE_CHROME_BIN,
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  const executable = paths.find(value => value && fs.existsSync(value));
  if (!executable) throw new Error('Chrome/Chromium not found. Set CHROMIUM_PATH.');
  return executable;
}

async function run() {
  const server = await startServer();
  let browser;
  const hosts = new Set();
  try {
    browser = await chromium.launch({ executablePath: browserPath(), headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
    page.on('websocket', socket => {
      try { hosts.add(new URL(socket.url()).host); } catch (e) { /* Ignore malformed URLs. */ }
    });
    await page.goto(`http://127.0.0.1:${server.port}/index.html?mode=online`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => window.CrazyShootersOffline && CrazyShootersOffline.getNetworkState() !== 'unknown', null, { timeout: 120000 });
    await page.mouse.move(320, 237); // Start
    await page.mouse.down(); await page.waitForTimeout(750); await page.mouse.up();
    try {
      await page.waitForFunction(() => CrazyShootersOffline.getNetworkState() === 'connected', null, { timeout: 60000 });
      console.log('Live Photon check: connected.', JSON.stringify({ websocketHosts: [...hosts] }));
    } catch (error) {
      const state = await page.evaluate(() => CrazyShootersOffline.getNetworkState()).catch(() => 'unknown');
      throw new Error('Could not confirm a live Photon connection: ' + JSON.stringify({ state, websocketHosts: [...hosts] }));
    }
  } finally {
    if (browser) await browser.close();
    server.child.kill();
  }
}

run().catch(error => {
  console.error(error.message);
  if (process.env.GITHUB_ACTIONS) {
    const escaped = error.message.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
    console.log('::warning title=Photon live check detail::' + escaped);
  }
  process.exitCode = 1;
});
