'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const scanner = require('../crazy_shooters_offline/heap_scanner.js');
const source = fs.readFileSync('crazy_shooters_offline/offline_mode.js', 'utf8');

function fixture(search = '', savedMode = null) {
  const buffer = new ArrayBuffer(24 * 1024 * 1024), h = new Int32Array(buffer), u = new Uint8Array(buffer), f = new Float32Array(buffer);
  h[16] = buffer.byteLength;
  const ci = 5900000, klass = ci * 4, table = 5800000, staticFields = 5800100;
  const getter = 5800200, setter = 5800300, ready = 5800400, connecting = 5800500;
  h[ci] = 4000; h[ci + 2] = 10566946; h[ci + 6] = klass; h[ci + 7] = klass;
  h[ci + 16] = table * 4; h[ci + 20] = staticFields * 4; h[ci + 39] = 4;
  h[staticFields + 1] = 2000; h[staticFields + 2] = 2004;
  u.set(Buffer.from('PhotonNetwork\0'), 10566946);
  const defs = [
    [getter, 'get_offlineMode', 10570000, 123, 0],
    [setter, 'set_offlineMode', 10570100, 456, 1],
    [ready, 'get_connectedAndReady', 10570200, 789, 0],
    [connecting, 'get_connecting', 10570300, 987, 0]
  ];
  defs.forEach(([method, name, namePtr, fn, args], i) => {
    u.set(Buffer.from(name + '\0'), namePtr);
    h[table + i] = method * 4; h[method] = fn; h[method + 2] = namePtr;
    h[method + 3] = klass; h[method + 10] = 0x10; h[method + 11] = (args << 16) | 0xffff;
  });
  const calls = [];
  let enabled = 0, isReady = 0, isConnecting = 0, now = 100, confirmed = true;
  const mod = { HEAP32: h, HEAPF32: f, HEAPU8: u, asm: {}, asmLibraryArg: { DYNAMICTOP_PTR: 64, STACK_MAX: 8 * 1024 * 1024 },
    dynCall_iii(index, self, method) {
      calls.push(['get', index, self, method]);
      if (index === 123) return enabled;
      if (index === 789) return isReady;
      if (index === 987) return isConnecting;
      throw new Error('Unexpected getter');
    },
    dynCall_viii(index, self, value, method) { calls.push(['set', index, self, value, method]); enabled = value; } };
  const status = {}, select = { value: '', addEventListener(name, fn) { this[name] = fn; } };
  const document = { readyState: 'complete', hidden: false,
    getElementById(id) { return id === 'connection-mode' ? status : id === 'connection-select' ? select : null; } };
  const tasks = [], navigations = [], stored = new Map();
  if (savedMode !== null) stored.set('crazyShooters.connectionMode', savedMode);
  const window = {
    location: { search, href: 'http://127.0.0.1:8088/index.html' + search + '#game', assign(url) { navigations.push(url); } },
    localStorage: { getItem(key) { return stored.get(key) || null; }, setItem(key, value) { stored.set(key, value); } },
    confirm() { return confirmed; }, gameInstance: { Module: mod }, CrazyShootersHeapScanner: scanner,
    CrazyShootersMod: { getClassPointer: () => klass }
  };
  const context = { window, document, URL, URLSearchParams, performance: { now: () => now },
    setTimeout(fn) { tasks.push(fn); }, console: { log() {}, warn() {} } };
  vm.runInNewContext(source, context, { filename: 'offline_mode.js' });
  return { h, mod, klass, getter, setter, ready, connecting, status, select, window, calls, tasks, stored, navigations,
    setNetwork(readyValue, connectingValue) { isReady = readyValue; isConnecting = connectingValue; },
    setConfirm(value) { confirmed = value; },
    advance(ms) { now += ms; const task = tasks.shift(); if (task) task(); } };
}

test('online is the default; explicit and saved mode preferences are respected', () => {
  const online = fixture();
  assert.equal(online.window.CrazyShootersOffline.getMode(), 'online');
  assert.equal(online.window.CrazyShootersOffline.getState(), 'online');
  assert.equal(online.status.textContent, 'Online mode');
  assert.equal(online.select.value, 'online');
  assert.equal(fixture('', 'offline').window.CrazyShootersOffline.getMode(), 'offline');
  assert.equal(fixture('?online=1', 'offline').window.CrazyShootersOffline.getMode(), 'online');
  assert.equal(fixture('?offline=1', 'online').window.CrazyShootersOffline.getMode(), 'offline');
  assert.equal(fixture('?mode=online&offline=1', 'offline').window.CrazyShootersOffline.getMode(), 'online');
  assert.equal(fixture('?mode=offline&online=1', 'online').window.CrazyShootersOffline.getMode(), 'offline');
});

test('offline enables the bundled Photon setter only after Unity and Photon are ready', () => {
  const g = fixture('?offline=1');
  g.advance(2000); assert.equal(g.calls.length, 0); // Unity hasn't reported ready
  g.window.CrazyShootersOffline.notifyUnityReady(); g.advance(1100);
  assert.equal(g.window.CrazyShootersOffline.getState(), 'offline');
  assert.equal(g.status.textContent, 'Offline');
  assert.deepEqual(g.calls, [['get', 123, 0, g.getter * 4], ['set', 456, 0, 1, g.setter * 4], ['get', 123, 0, g.getter * 4]]);
  g.advance(1000); assert.equal(g.calls.length, 3);
});

test('online reads the actual Photon status without enabling offline mode', () => {
  const g = fixture();
  g.advance(2000); assert.equal(g.calls.length, 0);
  g.window.CrazyShootersOffline.notifyUnityReady(); g.advance(1100);
  assert.equal(g.window.CrazyShootersOffline.getNetworkState(), 'disconnected');
  assert.equal(g.status.textContent, 'Online: not connected');
  g.setNetwork(0, 1); g.advance(1000);
  assert.equal(g.window.CrazyShootersOffline.getNetworkState(), 'connecting');
  assert.equal(g.status.textContent, 'Online: connecting…');
  g.setNetwork(1, 0); g.advance(1000);
  assert.equal(g.window.CrazyShootersOffline.getNetworkState(), 'connected');
  assert.equal(g.status.textContent, 'Online: connected');
  assert.ok(g.calls.every(call => call[0] === 'get' && (call[1] === 789 || call[1] === 987)));
  g.h[g.ready + 11] = 0x1ffff; g.advance(1000);
  assert.equal(g.window.CrazyShootersOffline.getNetworkState(), 'unknown');
  assert.equal(g.status.textContent, 'Online mode');
});

test('invalid Photon metadata is never invoked or reported connected', () => {
  const offline = fixture('?offline=1');
  offline.h[offline.setter + 11] = 0xffff; // wrong setter signature
  offline.window.CrazyShootersOffline.notifyUnityReady(); offline.advance(1200);
  assert.equal(offline.calls.length, 0);
  assert.equal(offline.window.CrazyShootersOffline.getState(), 'preparing');
  const online = fixture();
  online.h[online.ready + 11] = 0x1ffff; // wrong getter signature
  online.window.CrazyShootersOffline.notifyUnityReady(); online.advance(1200);
  assert.equal(online.calls.length, 0);
  assert.equal(online.window.CrazyShootersOffline.getNetworkState(), 'unknown');
  assert.equal(online.status.textContent, 'Online mode');
});

test('changing mode confirms, saves the preference and reloads with a compatible URL', () => {
  const g = fixture('?online=1&example=keep');
  g.setConfirm(false); g.select.value = 'offline'; g.select.change();
  assert.equal(g.select.value, 'online');
  assert.equal(g.navigations.length, 0);
  g.setConfirm(true); g.select.value = 'offline'; g.select.change();
  assert.equal(g.stored.get('crazyShooters.connectionMode'), 'offline');
  assert.equal(g.navigations.length, 1);
  const url = new URL(g.navigations[0]);
  assert.equal(url.searchParams.get('mode'), 'offline');
  assert.equal(url.searchParams.get('online'), null);
  assert.equal(url.searchParams.get('example'), 'keep');
  assert.equal(url.hash, '#game');
  assert.equal(g.window.CrazyShootersOffline.changeMode('invalid'), false);
});
