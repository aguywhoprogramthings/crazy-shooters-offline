'use strict';

// Exercises the actual checked-in Unity build, not a mock of the game. CI uses
// Chrome's software renderer, so this checks behavior rather than asserting a
// hardware-dependent frame rate.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');

async function startServer() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['server.js'], {
      cwd: path.resolve('crazy_shooters_offline'),
      env: { ...process.env, HOST: '127.0.0.1', PORT: '0' },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let output = '';
    const timeout = setTimeout(() => { child.kill(); reject(new Error('Server startup timed out: ' + output)); }, 10000);
    child.on('error', err => { clearTimeout(timeout); reject(err); });
    child.on('exit', code => { if (!child.ready) { clearTimeout(timeout); reject(new Error(`Server exited ${code}: ${output}`)); } });
    for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => {
      output += chunk;
      const match = output.match(/http:\/\/127\.0\.0\.1:(\d+)/);
      if (match && !child.ready) { child.ready = true; clearTimeout(timeout); resolve({ child, port: +match[1] }); }
    });
  });
}

function browserPath() {
  const paths = [process.env.CHROMIUM_PATH, process.env.GOOGLE_CHROME_BIN,
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  const executable = paths.find(value => value && fs.existsSync(value));
  if (!executable) throw new Error('Chrome/Chromium not found. Set CHROMIUM_PATH to its executable.');
  return executable;
}

async function clickGame(page, x, y) {
  // Hold the button over at least one Unity frame even on a slow software GPU.
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.waitForTimeout(750);
  await page.mouse.up();
  await page.waitForTimeout(2500);
}

async function run() {
  const server = await startServer();
  let browser, page;
  const errors = [];
  try {
    browser = await chromium.launch({ executablePath: browserPath(), headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    page.on('pageerror', error => errors.push(error.stack || String(error)));
    page.on('console', message => {
      const text = message.text();
      if (text.includes('[Tactical AI onFrame error]') || text.includes('Could not enable Photon local mode') || text.includes('Camera rotation unavailable') || text.includes('Photon clock unavailable')) errors.push(text);
    });
    await page.goto(`http://127.0.0.1:${server.port}/index.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => window.CrazyShootersOffline && CrazyShootersOffline.getState() === 'offline', null, { timeout: 120000 });
    assert.equal(await page.locator('#connection-mode').innerText(), 'Offline');

    // Exercise the transformed canvas and its corrected mouse coordinates: the
    // actual Start button must work at a reduced drawing resolution.
    await page.selectOption('#graphics-quality', 'performance');
    await page.waitForTimeout(1000);
    const size = await page.evaluate(() => {
      const c = gameInstance.Module.canvas, rect = c.getBoundingClientRect();
      return { width: c.width, height: c.height, clientWidth: c.clientWidth, clientHeight: c.clientHeight,
        screenWidth: Math.round(rect.width), screenHeight: Math.round(rect.height) };
    });
    assert.deepEqual(size, { width: 720, height: 540, clientWidth: 720, clientHeight: 540, screenWidth: 800, screenHeight: 600 });
    await clickGame(page, 400, 356); // Start -> lobby

    await page.setViewportSize({ width: 640, height: 400 });
    await page.waitForTimeout(1500);
    await clickGame(page, 512, 136); // Create room
    await clickGame(page, 512, 136); // Continue -> load map
    await page.waitForFunction(() => CrazyShootersMod.getInstances().rmm > 0, null, { timeout: 120000 });
    await page.waitForTimeout(2000);
    await clickGame(page, 485, 92); // Join battle
    await page.waitForFunction(() => {
      const i = CrazyShootersMod.getInstances();
      return i.mg >= 18 && i.sg && i.gl && i.knife && i.mov && i.jmp && i.rmm && CrazyShootersMod.getPlayerState();
    }, null, { timeout: 120000 });
    await page.waitForTimeout(2500); // allow the per-frame updates to run

    const values = await page.evaluate(() => {
      const api = CrazyShootersMod, m = gameInstance.Module, h = m.HEAP32, f = m.HEAPF32, ptrs = api.getInstancePointers();
      const mg = ptrs.mg.find(p => h[p] === api.getClassPointer('machineGun') && h[p + 1] === 0 && h[p + 8] === 999 && h[p + 9] === 9999 && h[p + 10] === 999);
      const mov = ptrs.mov.find(p => h[p] === api.getClassPointer('fpsMovement') && h[p + 1] === 0 && f[p + 2] === 14 && f[p + 5] === 10.5);
      const jmp = ptrs.jmp.find(p => h[p] === api.getClassPointer('fpsJumping') && h[p + 1] === 0 && Math.abs(f[p + 3] - 1.85) < 0.001 && f[p + 4] === 3);
      if (mg === undefined || mov === undefined || jmp === undefined) return { missing: { mg, mov, jmp }, counts: api.getInstances() };
      const allGuns = ptrs.mg.filter(p => h[p] === api.getClassPointer('machineGun') && h[p + 1] === 0 && f[p + 7] > 0.0001 && f[p + 7] < 5);
      const gunRatesOn = allGuns.map(p => f[p + 7]);
      const on = { rate: f[mg + 7], ammo: [h[mg + 8], h[mg + 9], h[mg + 10]],
        movement: Array.from(f.subarray(mov + 2, mov + 7)), jump: [f[jmp + 3], f[jmp + 4]] };
      api.setAmmo(false); api.setPhysics(false); api.setRapidFire(false);
      const off = { rate: f[mg + 7], ammo: [h[mg + 8], h[mg + 9], h[mg + 10]],
        movement: Array.from(f.subarray(mov + 2, mov + 7)), jump: [f[jmp + 3], f[jmp + 4]] };
      return { on, off, guns: allGuns.map((p, i) => ({ on: gunRatesOn[i], off: f[p + 7], ammo: [h[p + 8], h[p + 9], h[p + 10]] })),
        state: api.getPlayerState(), stats: api.getScanStats(), heapBytes: h.byteLength, bots: CrazyShootersAI.getBots().length };
    });
    assert.ok(!values.missing, 'Expected real, boosted Unity instances: ' + JSON.stringify(values));
    assert.deepEqual(values.on.ammo, [999, 9999, 999]);
    assert.ok(values.off.ammo[0] !== 999 && values.off.ammo[1] !== 9999, JSON.stringify(values));
    assert.ok(Math.abs(values.on.rate - values.off.rate * 0.75) < 0.0001, JSON.stringify(values));
    const vanillaGunRates = [0.05, 0.085, 0.12, 0.5, 1.6];
    for (const gun of values.guns) {
      assert.ok(vanillaGunRates.some(rate => Math.abs(gun.off - rate) < 0.0001), 'Unexpected restored gun rate: ' + JSON.stringify(gun));
      assert.ok(Math.abs(gun.on - gun.off * 0.75) < 0.0001, 'Compounded gun rate: ' + JSON.stringify(gun));
      assert.ok(gun.ammo[0] !== 999 && gun.ammo[1] !== 9999, 'Gun ammo did not restore: ' + JSON.stringify(gun));
    }
    assert.deepEqual(values.on.movement, [14, 14, 14, 10.5, 15]);
    assert.deepEqual(values.off.movement, [10, 10, 10, 8, 11.5]);
    assert.ok(Math.abs(values.off.jump[0] - 1) < 0.001 && values.off.jump[1] === 2);
    assert.ok(values.state && Number.isFinite(values.state.pos.x));
    assert.ok(values.bots >= 2 && values.stats.slices > 0 && values.stats.allocatedBytes < values.heapBytes);

    const matchClock = () => page.evaluate(() => {
      const api = CrazyShootersMod, h = gameInstance.Module.HEAP32, f = gameInstance.Module.HEAPF32;
      const p = api.getInstancePointers().rmm.find(i => h[i] === api.getClassPointer('rmm') && h[i + 44] === 99999);
      return p === undefined ? null : { duration: h[p + 44], reference: f[p + 45] };
    });
    const clockBefore = await matchClock(); await page.waitForTimeout(2500); const clockAfter = await matchClock();
    assert.ok(clockBefore && clockAfter && clockAfter.reference > clockBefore.reference,
      'Match-time reference did not follow Photon time: ' + JSON.stringify({ clockBefore, clockAfter }));

    await page.keyboard.press('F8');
    assert.deepEqual(await page.evaluate(() => [CrazyShootersMod.isAmmoEnabled(), CrazyShootersMod.isPhysicsEnabled(), CrazyShootersMod.isRapidFireEnabled()]), [true, true, true]);
    const beforeBots = await page.evaluate(() => CrazyShootersAI.getBots().length);
    await page.keyboard.press('F10');
    assert.equal(await page.evaluate(() => CrazyShootersAI.getBots().length), beforeBots + 1);
    await page.keyboard.press('F11');
    assert.equal(await page.evaluate(() => CrazyShootersAI.isEnabled()), false);
    await page.keyboard.press('F12');

    // Check actual pointer lock, movement, and the camera quaternion used by
    // the bot overlay (Photon's network rotation is stale for local players).
    await page.mouse.click(320, 260);
    await page.waitForFunction(() => document.pointerLockElement === gameInstance.Module.canvas, null, { timeout: 15000 });
    await page.waitForTimeout(1000);
    const before = await page.evaluate(() => CrazyShootersMod.getPlayerState());
    let turned = before;
    const rotationChanged = (a, b) => a && b && Math.min(
      Math.hypot(...a.rot.map((v, i) => v - b.rot[i])), Math.hypot(...a.rot.map((v, i) => v + b.rot[i]))) > 0.0001;
    // Headless Chromium warps the virtual cursor back after CDP mouse moves,
    // cancelling their deltas. Dispatch relative movement while locked instead
    // so Unity consumes the same movementX/Y fields as a real pointer lock.
    for (let i = 0; i < 6 && !rotationChanged(before, turned); i++) {
      await page.evaluate(() => gameInstance.Module.canvas.dispatchEvent(new MouseEvent('mousemove', {
        bubbles: true, movementX: 40, movementY: 0
      })));
      await page.waitForTimeout(600);
      turned = await page.evaluate(() => CrazyShootersMod.getPlayerState());
    }
    assert.ok(rotationChanged(before, turned),
      'Camera rotation did not track pointer-lock movement: ' + JSON.stringify({ before, turned }));
    await page.keyboard.down('w'); await page.waitForTimeout(3000); await page.keyboard.up('w');
    const moved = await page.evaluate(() => CrazyShootersMod.getPlayerState());
    assert.ok(moved && Math.hypot(moved.pos.x - turned.pos.x, moved.pos.z - turned.pos.z) > 0.02,
      'Player did not move with W: ' + JSON.stringify({ turned, moved }));
    // Leave and create a second room to exercise the real Unity object
    // lifecycle and spawned weapon copies, not just synthetic heap fixtures.
    await page.keyboard.press('Escape'); await page.waitForTimeout(2000);
    await clickGame(page, 485, 175); // Leave Room
    await page.waitForFunction(() => CrazyShootersMod.getPlayerState() === null, null, { timeout: 60000 });
    await page.waitForTimeout(2000);
    await clickGame(page, 512, 136); // Create another room
    const roomJoined = page.waitForEvent('console', { predicate: msg => msg.text().includes('Joined room:'), timeout: 120000 });
    await clickGame(page, 512, 136); // Continue
    await roomJoined;
    await page.waitForFunction(() => {
      const api = CrazyShootersMod, h = gameInstance.Module.HEAP32;
      return api.getInstancePointers().rmm.some(p => h[p] === api.getClassPointer('rmm') && h[p + 2] > 0);
    }, null, { timeout: 120000 });
    await page.waitForTimeout(2000);
    await clickGame(page, 485, 92);
    await page.waitForFunction(() => CrazyShootersMod.getPlayerState() !== null, null, { timeout: 120000 });
    const sweepAtRejoin = await page.evaluate(() => CrazyShootersMod.getScanStats().sweeps);
    await page.waitForFunction(start => CrazyShootersMod.getScanStats().sweeps >= start + 2, sweepAtRejoin, { timeout: 120000 });
    const rejoined = await page.evaluate(() => {
      const api = CrazyShootersMod, h = gameInstance.Module.HEAP32, f = gameInstance.Module.HEAPF32;
      const guns = api.getInstancePointers().mg.filter(p => h[p] === api.getClassPointer('machineGun') && h[p + 1] === 0 && f[p + 7] > 0.0001 && f[p + 7] < 5);
      const on = guns.map(p => ({ rate: f[p + 7], ammo: [h[p + 8], h[p + 9], h[p + 10]] }));
      api.setAmmo(false); api.setPhysics(false); api.setRapidFire(false);
      return { on, off: guns.map(p => ({ rate: f[p + 7], ammo: [h[p + 8], h[p + 9], h[p + 10]] })),
        player: api.getPlayerState(), stats: api.getScanStats() };
    });
    assert.ok(rejoined.player && rejoined.on.length >= 18);
    for (let i = 0; i < rejoined.on.length; i++) {
      const on = rejoined.on[i], off = rejoined.off[i];
      assert.deepEqual(on.ammo, [999, 9999, 999]);
      assert.ok(vanillaGunRates.some(rate => Math.abs(off.rate - rate) < 0.0001) &&
        Math.abs(on.rate - off.rate * 0.75) < 0.0001 && off.ammo[0] !== 999 && off.ammo[1] !== 9999,
        'Rejoined weapon did not restore correctly: ' + JSON.stringify({ on, off }));
    }
    await page.keyboard.press('F8');
    assert.deepEqual(await page.evaluate(() => [CrazyShootersMod.isAmmoEnabled(), CrazyShootersMod.isPhysicsEnabled(), CrazyShootersMod.isRapidFireEnabled()]), [true, true, true]);
    assert.deepEqual(errors, []);
    console.log('Browser smoke passed:', JSON.stringify({ player: rejoined.player.pos, weaponCopies: rejoined.on.length, bots: beforeBots + 1, scanner: rejoined.stats }));
  } catch (error) {
    if (page) {
      fs.mkdirSync('test-results', { recursive: true });
      await page.screenshot({ path: 'test-results/browser-failure.png' }).catch(() => {});
      console.error('Browser errors:', errors);
    }
    throw error;
  } finally {
    if (browser) await browser.close();
    server.child.kill();
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
