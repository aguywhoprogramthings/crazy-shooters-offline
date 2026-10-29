'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const scanner = require('../crazy_shooters_offline/heap_scanner.js');
const source = fs.readFileSync('crazy_shooters_offline/offline_mode.js', 'utf8');

function fixture(search = '') {
  const buffer = new ArrayBuffer(24 * 1024 * 1024), h = new Int32Array(buffer), u = new Uint8Array(buffer), f = new Float32Array(buffer);
  h[16] = buffer.byteLength;
  const ci = 5900000, klass = ci * 4, table = 5800000, staticFields = 5800100, getter = 5800200, setter = 5800300;
  h[ci] = 4000; h[ci + 2] = 10566946; h[ci + 6] = klass; h[ci + 7] = klass;
  h[ci + 16] = table * 4; h[ci + 20] = staticFields * 4; h[ci + 39] = 2;
  h[staticFields + 1] = 2000; h[staticFields + 2] = 2004;
  u.set(Buffer.from('PhotonNetwork\0'), 10566946);
  u.set(Buffer.from('get_offlineMode\0'), 10570000); u.set(Buffer.from('set_offlineMode\0'), 10570100);
  h[table] = getter * 4; h[table + 1] = setter * 4;
  h[getter] = 123; h[getter + 2] = 10570000; h[getter + 3] = klass; h[getter + 10] = 0x10; h[getter + 11] = 0xffff;
  h[setter] = 456; h[setter + 2] = 10570100; h[setter + 3] = klass; h[setter + 10] = 0x10; h[setter + 11] = 0x1ffff;
  const calls = [];
  let enabled = 0, now = 100;
  const mod = { HEAP32: h, HEAPF32: f, HEAPU8: u, asm: {}, asmLibraryArg: { DYNAMICTOP_PTR: 64, STACK_MAX: 8 * 1024 * 1024 },
    dynCall_iii(index, self, method) { calls.push(['get', index, self, method]); return enabled; },
    dynCall_viii(index, self, value, method) { calls.push(['set', index, self, value, method]); enabled = value; } };
  const status = {};
  const document = { readyState: 'complete', getElementById() { return status; } };
  const tasks = [];
  const window = { location: { search }, gameInstance: { Module: mod }, CrazyShootersHeapScanner: scanner,
    CrazyShootersMod: { getClassPointer: () => klass } };
  const context = { window, document, URLSearchParams, performance: { now: () => now },
    setTimeout(fn) { tasks.push(fn); }, console: { log() {}, warn() {} } };
  vm.runInNewContext(source, context, { filename: 'offline_mode.js' });
  return { h, mod, klass, setter, status, window, calls, tasks,
    advance(ms) { now += ms; const task = tasks.shift(); if (task) task(); } };
}

test('enables the bundled Photon offline setter only after Unity and Photon are ready', () => {
  const g = fixture();
  g.advance(2000); assert.equal(g.calls.length, 0); // Unity hasn't reported ready
  g.window.CrazyShootersOffline.notifyUnityReady();
  g.advance(1100);
  assert.equal(g.window.CrazyShootersOffline.getState(), 'offline');
  assert.equal(g.status.textContent, 'Offline');
  assert.deepEqual(g.calls, [['get', 123, 0, (g.setter - 100) * 4], ['set', 456, 0, 1, g.setter * 4], ['get', 123, 0, (g.setter - 100) * 4]]);
  g.advance(1000); assert.equal(g.calls.length, 3);
});

test('online opt-out leaves Photon untouched and invalid metadata is never invoked', () => {
  const online = fixture('?online=1');
  assert.equal(online.window.CrazyShootersOffline.getState(), 'online');
  assert.equal(online.tasks.length, 0); assert.equal(online.calls.length, 0);
  const invalid = fixture();
  invalid.h[invalid.setter + 11] = 0xffff; // wrong setter signature
  invalid.window.CrazyShootersOffline.notifyUnityReady(); invalid.advance(1200);
  assert.equal(invalid.calls.length, 0);
  assert.equal(invalid.window.CrazyShootersOffline.getState(), 'preparing');
});
