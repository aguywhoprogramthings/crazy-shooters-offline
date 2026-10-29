'use strict';

// Optional live check: use the actual Unity client and original Photon service.
// By default this does not create or join a room. A temporary public test room
// is only created when CSO_ONLINE_ROOM_TEST=1 is explicitly set. Unlike the
// main browser smoke test, this depends on a third-party service and network.
const { spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
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

async function clickGame(page, x, y) {
  await page.mouse.move(x, y);
  await page.mouse.down(); await page.waitForTimeout(800); await page.mouse.up();
  await page.waitForTimeout(2500);
}

async function exerciseTemporaryRoom(page) {
  // Distinct CI-labelled 8-character name, two-player limit, no shots. Closing
  // the browser disconnects the sole test player and closes the temporary room.
  const name = 'CI' + randomBytes(3).toString('hex').toUpperCase();
  await page.waitForTimeout(3000);
  await clickGame(page, 512, 136); // Lobby -> Create room
  await page.evaluate(() => { const hud = document.getElementById('mod-hud-container'); if (hud) hud.style.display = 'none'; });
  await clickGame(page, 260, 140); // Room name field
  await page.keyboard.press('Control+A');
  await page.keyboard.type(name, { delay: 150 });
  await clickGame(page, 230, 180); // Two-player limit
  const joined = page.waitForEvent('console', { predicate: message => message.text().includes('Joined room:'), timeout: 120000 });
  await clickGame(page, 512, 136); // Continue / create
  const message = await joined;
  if (!message.text().includes('Joined room: ' + name)) throw new Error('Joined a different room than the temporary test room.');
  await page.waitForFunction(() => CrazyShootersMod.getInstances().rmm > 0, null, { timeout: 120000 });
  await page.waitForTimeout(2000);
  await clickGame(page, 485, 92); // Join battle
  await page.waitForFunction(() => CrazyShootersMod.getPlayerState() !== null, null, { timeout: 120000 });
  console.log('Live Photon room check: created the temporary room and spawned.');
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
    if (process.env.CSO_ONLINE_ROOM_TEST === '1') await exerciseTemporaryRoom(page);
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
