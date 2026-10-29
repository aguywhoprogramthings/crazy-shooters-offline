'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const scannerApi = require('../crazy_shooters_offline/heap_scanner.js');
const source = fs.readFileSync('crazy_shooters_offline/mod_ammo.js', 'utf8');

function approx(actual, expected) { assert.ok(Math.abs(actual - expected) < 0.0001, `${actual} != ${expected}`); }

function makeGame() {
  const buffer = new ArrayBuffer(24 * 1024 * 1024);
  const h = new Int32Array(buffer), f = new Float32Array(buffer), u = new Uint8Array(buffer);
  h[16] = buffer.byteLength;
  const mod = { HEAP32: h, HEAPF32: f, HEAPU8: u, asm: {},
    asmLibraryArg: { DYNAMICTOP_PTR: 64, STACK_MAX: 8 * 1024 * 1024 } };
  const specs = [
    ['mg', 'MachineGun', 10553142], ['sg', 'shotGun', 10553029],
    ['gl', 'GrenadeLauncher', 10553089], ['knife', 'Knife', 10553194],
    ['mov', 'FPScontrollerMovement', 10540523], ['jmp', 'FPScontrollerJumping', 10540900],
    ['fpsCtrl', 'FPScontroller', 10539619], ['pnc', 'PlayerNetworkController', 10545213],
    ['damage', 'PlayerDamage', 10544838], ['rmm', 'RoomMultiplayerMenu', 10545916],
    ['photon', 'PhotonNetwork', 10566946]
  ];
  const ptrs = {};
  specs.forEach(([key, name, address], i) => {
    u.set(Buffer.from(name + '\0'), address);
    const ci = 5900000 + i * 100;
    const klass = ci * 4;
    h[ci] = 4000; h[ci + 2] = address; h[ci + 6] = klass; h[ci + 7] = klass; h[ci + 9] = 2048;
    const p = 3000000 + i * 100;
    h[p] = klass;
    ptrs[key] = p;
  });
  // False metadata match: the old jump validator accepted its tiny float.
  const fakeJump = 3100000;
  h[fakeJump] = h[ptrs.jmp]; h[fakeJump + 3] = h[ptrs.mov];
  f[ptrs.mg + 7] = 0.1; h[ptrs.mg + 8] = 30; h[ptrs.mg + 9] = 90; h[ptrs.mg + 10] = 20;
  h[ptrs.sg + 3] = 5; f[ptrs.sg + 5] = 0.8;
  h[ptrs.sg + 9] = 8; h[ptrs.sg + 10] = 7; h[ptrs.sg + 11] = 64;
  h[ptrs.gl + 5] = 20; f[ptrs.gl + 6] = 0.4; h[ptrs.gl + 9] = 6;
  f[ptrs.knife + 4] = 0.2;
  [10, 10, 10, 8, 11.5].forEach((v, i) => { f[ptrs.mov + 2 + i] = v; });
  h[ptrs.jmp + 2] = 1; f[ptrs.jmp + 3] = 1; f[ptrs.jmp + 4] = 2;
  for (const key of ['fpsCtrl', 'pnc', 'damage', 'rmm']) h[ptrs[key] + 2] = 2400000 * 4;
  f[ptrs.fpsCtrl + 36] = 5; f[ptrs.fpsCtrl + 37] = 3; f[ptrs.fpsCtrl + 38] = -9;
  h[ptrs.pnc + 28] = 1; f[ptrs.pnc + 35] = 1; h[ptrs.pnc + 22] = ptrs.damage * 4;
  h[ptrs.fpsCtrl + 31] = ptrs.damage * 4;
  f[ptrs.damage + 11] = 100;
  const timers = [], frames = [], listeners = {};
  let now = 100;
  const document = { readyState: 'loading', hidden: false, addEventListener() {}, getElementById() { return null; } };
  const window = { CrazyShootersHeapScanner: scannerApi, gameInstance: { Module: mod },
    addEventListener(name, fn) { listeners[name] = fn; } };
  const context = { window, document, performance: { now: () => now }, console: { log() {}, warn() {} },
    setTimeout(fn) { timers.push(fn); }, requestAnimationFrame(fn) { frames.push(fn); } };
  vm.runInNewContext(source, context, { filename: 'mod_ammo.js' });
  function tick(count = 1) {
    for (let i = 0; i < count; i++) {
      now += 16;
      const t = timers.shift(); if (t) t();
      const queued = frames.splice(0); for (const frame of queued) frame(now);
    }
  }
  function until(condition, limit = 1000) {
    for (let i = 0; i < limit && !condition(); i++) tick();
    assert.ok(condition(), 'timed out waiting for discovery');
    tick(2);
  }
  return { h, f, mod, ptrs, fakeJump, window, listeners, tick, until };
}

test('ammo, jump/speed, fire rate, match time and AI bridge operate and restore actual baselines', () => {
  const g = makeGame(), { h, f, ptrs: p } = g;
  const api = g.window.CrazyShootersMod;
  g.until(() => Object.values(api.getInstances()).every(count => count > 0));
  assert.deepEqual([h[p.mg + 8], h[p.mg + 9], h[p.mg + 10]], [999, 9999, 999]);
  assert.deepEqual([h[p.sg + 9], h[p.sg + 10], h[p.sg + 11]], [999, 999, 9999]);
  assert.equal(h[p.gl + 9], 999);
  approx(f[p.mg + 7], 0.075); approx(f[p.sg + 5], 0.6);
  approx(f[p.gl + 6], 0.3); approx(f[p.knife + 4], 0.15);
  assert.deepEqual(Array.from(f.subarray(p.mov + 2, p.mov + 7)), [14, 14, 14, 10.5, 15]);
  approx(f[p.jmp + 3], 1.85); approx(f[p.jmp + 4], 3);
  assert.equal(h[p.rmm + 44], 99999); approx(f[p.rmm + 46], 590);
  assert.equal(h[g.fakeJump + 3], h[p.mov]); // no metadata corruption
  assert.deepEqual(JSON.parse(JSON.stringify(api.getPlayerState().pos)), { x: 5, y: 3, z: -9 });
  f[p.fpsCtrl + 37] = 262;
  assert.equal(api.getPlayerState().pos.y, 262); // valid spawn above the old hard-coded y=60 limit
  assert.equal(api.applyDamageToPlayer(15), true); approx(f[p.damage + 11], 85); approx(f[p.damage + 19], 0.85);
  assert.equal(api.applyDamageToPlayer(-5), false);
  api.setAmmo(false); api.setPhysics(false); api.setRapidFire(false);
  assert.deepEqual([h[p.mg + 8], h[p.mg + 9], h[p.mg + 10]], [30, 90, 20]);
  assert.deepEqual([h[p.sg + 9], h[p.sg + 10], h[p.sg + 11]], [8, 7, 64]);
  assert.equal(h[p.gl + 9], 6);
  approx(f[p.mg + 7], 0.1); approx(f[p.sg + 5], 0.8); approx(f[p.gl + 6], 0.4); approx(f[p.knife + 4], 0.2);
  assert.deepEqual(Array.from(f.subarray(p.mov + 2, p.mov + 7)), [10, 10, 10, 8, 11.5]);
  approx(f[p.jmp + 3], 1); approx(f[p.jmp + 4], 2);
});

test('respawned copies do not compound rapid fire and restore their original settings', () => {
  const g = makeGame(), { h, f, ptrs: p } = g;
  const api = g.window.CrazyShootersMod;
  g.until(() => api.getInstances().mg && api.getInstances().mov && api.getInstances().jmp);
  const clone = { mg: 3400000, mov: 3400100, jmp: 3400200 };
  for (const key of Object.keys(clone)) h.set(h.subarray(p[key], p[key] + 20), clone[key]);
  g.until(() => api.getInstances().mg >= 2 && api.getInstances().mov >= 2 && api.getInstances().jmp >= 2);
  approx(f[clone.mg + 7], 0.075); // never 0.1 * 0.75 * 0.75
  assert.equal(h[clone.mg + 10], 999);
  approx(f[clone.mov + 2], 14); approx(f[clone.jmp + 3], 1.85);
  api.setAmmo(false); api.setPhysics(false); api.setRapidFire(false);
  assert.deepEqual([h[clone.mg + 8], h[clone.mg + 9], h[clone.mg + 10]], [30, 90, 20]);
  approx(f[clone.mg + 7], 0.1);
  assert.deepEqual(Array.from(f.subarray(clone.mov + 2, clone.mov + 7)), [10, 10, 10, 8, 11.5]);
  approx(f[clone.jmp + 3], 1); approx(f[clone.jmp + 4], 2);
  api.setAmmo(true); api.setPhysics(true); api.setRapidFire(true); g.tick(5);
  approx(f[clone.mg + 7], 0.075); assert.equal(h[clone.mg + 10], 999);
});

test('hotkeys retain their original toggles and ignore key repeat', () => {
  const g = makeGame(), api = g.window.CrazyShootersMod;
  let prevented = 0;
  function key(code, repeat = false) { g.listeners.keydown({ key: code, code, repeat, preventDefault() { prevented++; } }); }
  key('F6'); assert.equal(api.isAmmoEnabled(), false);
  key('F6', true); assert.equal(api.isAmmoEnabled(), false);
  key('F7'); assert.equal(api.isPhysicsEnabled(), false);
  key('F9'); assert.equal(api.isRapidFireEnabled(), false);
  key('F8'); assert.equal(api.isAmmoEnabled(), true); assert.equal(api.isPhysicsEnabled(), true); assert.equal(api.isRapidFireEnabled(), true);
  key('F8'); assert.equal(api.isAmmoEnabled(), false); assert.equal(api.isPhysicsEnabled(), false); assert.equal(api.isRapidFireEnabled(), false);
  assert.equal(prevented, 5);
});

test('camera rotation uses validated Unity metadata and reuses the native scratch buffer', () => {
  const g = makeGame(), { h, f, mod, ptrs } = g, u = mod.HEAPU8;
  const api = g.window.CrazyShootersMod;
  g.until(() => api.getInstances().fpsCtrl && api.getInstances().damage && api.getInstances().pnc);
  const transformClass = 5000000, objectClass = 5000100;
  const transformTable = 5000200, objectTable = 5000250;
  const rotationMethod = 5000300, transformMethod = 5000350;
  const body = 5000400, camera = 5000450, cameraTransform = 5000500;
  function text(address, value) { u.set(Buffer.from(value + '\0'), address); return address; }
  function klass(index, name, table) {
    const pointer = index * 4;
    h[index] = 1; h[index + 2] = text(name === 'Transform' ? 10600000 : 10600100, name);
    h[index + 3] = text(10600200, 'UnityEngine'); h[index + 6] = pointer; h[index + 7] = pointer;
    h[index + 16] = table * 4; h[index + 39] = 1;
  }
  function method(index, owner, name, fn, address) {
    h[index] = fn; h[index + 2] = text(address, name); h[index + 3] = owner * 4;
    h[index + 10] = 0; h[index + 11] = 65535;
  }
  klass(transformClass, 'Transform', transformTable); klass(objectClass, 'GameObject', objectTable);
  method(rotationMethod, transformClass, 'get_rotation', 123, 10600300);
  method(transformMethod, objectClass, 'get_transform', 124, 10600400);
  h[transformTable] = rotationMethod * 4; h[objectTable] = transformMethod * 4;
  for (const [instance, cls] of [[body, transformClass], [camera, objectClass], [cameraTransform, transformClass]]) {
    h[instance] = cls * 4; h[instance + 2] = 2400000 * 4;
  }
  h[ptrs.fpsCtrl + 29] = body * 4; h[ptrs.fpsCtrl + 6] = camera * 4;
  let allocations = 0, transforms = 0, rotations = 0;
  mod._malloc = bytes => { assert.equal(bytes, 16); allocations++; return 23000000; };
  mod.dynCall_iii = (fn, self, info) => {
    assert.deepEqual([fn, self, info], [124, camera * 4, transformMethod * 4]); transforms++; return cameraTransform * 4;
  };
  mod.dynCall_viii = (fn, target, self, info) => {
    assert.deepEqual([fn, target, self, info], [123, 23000000, cameraTransform * 4, rotationMethod * 4]);
    rotations++; f.set([0, Math.SQRT1_2, 0, Math.SQRT1_2], target / 4);
  };
  const first = api.getPlayerState(), second = api.getPlayerState();
  approx(first.rot[1], Math.SQRT1_2); approx(second.rot[3], Math.SQRT1_2);
  assert.equal(allocations, 1); assert.equal(transforms, 1); assert.equal(rotations, 2);
  // A destroyed camera is never passed to Unity's native getter.
  h[camera + 2] = 0;
  mod.dynCall_viii = (fn, target, self) => { assert.equal(self, body * 4); f.set([0, 0, 0, 1], target / 4); };
  assert.deepEqual(Array.from(api.getPlayerState().rot), [0, 0, 0, 1]);
  let failures = 0;
  mod.dynCall_viii = () => { failures++; throw new Error('getter unavailable'); };
  api.getPlayerState(); api.getPlayerState();
  assert.equal(failures, 1); // failed native calls are not retried every frame
});


test('match time remains open beyond the old fixed-duration limit', () => {
  const g = makeGame(), { h, f, mod, ptrs } = g, api = g.window.CrazyShootersMod;
  g.until(() => api.getClassPointer('photonNetwork') && api.getInstances().rmm);
  const klass = h[ptrs.photon], k = klass / 4, statics = 5100000, table = 5100100, method = 5100200;
  h[k + 20] = statics * 4; h[statics + 1] = 1; h[statics + 2] = 1;
  h[k + 16] = table * 4; h[k + 39] = 1; h[table] = method * 4;
  mod.HEAPU8.set(Buffer.from('get_time\0'), 10601000);
  h[method] = 13; h[method + 2] = 10601000; h[method + 3] = klass;
  h[method + 4] = 136148; h[method + 10] = 0x10; h[method + 11] = 65535;
  let time = 100;
  mod.dynCall_dii = (fn, self, info) => {
    assert.deepEqual([fn, self, info], [13, 0, method * 4]); return time;
  };
  g.tick(1); assert.equal(f[ptrs.rmm + 45], 100);
  time = 120000; g.tick(1); // more than 99,999 seconds later
  assert.equal(h[ptrs.rmm + 44], 99999); assert.equal(f[ptrs.rmm + 45], 120000);
  assert.equal(h[ptrs.rmm + 44] - (time - f[ptrs.rmm + 45]), 99999);
});
