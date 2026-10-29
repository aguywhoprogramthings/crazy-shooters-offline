'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync('crazy_shooters_offline/display_settings.js', 'utf8');

function fixture(saved) {
  const listeners = {}, stored = new Map();
  if (saved) stored.set('crazyShooters.graphics', saved);
  const localStorage = { getItem: key => stored.get(key) || null, setItem: (key, value) => stored.set(key, value) };
  const container = { style: {} };
  const select = { value: '', addEventListener(name, fn) { this[name] = fn; } };
  const document = { readyState: 'complete', pointerLockElement: null,
    getElementById(id) { return id === 'gameContainer' ? container : id === 'graphics-quality' ? select : null; } };
  let width = 1920, height = 1080, writes = 0;
  const canvas = {
    get width() { return width; }, set width(v) { width = v; writes++; },
    get height() { return height; }, set height(v) { height = v; writes++; },
    get clientWidth() { return parseInt(container.style.width, 10); },
    get clientHeight() { return parseInt(container.style.height, 10); },
    getBoundingClientRect() { return { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight }; }
  };
  const window = { innerWidth: 3840, innerHeight: 2160, gameInstance: { Module: { canvas } },
    addEventListener(name, fn) { (listeners[name] ||= []).push(fn); } };
  vm.runInNewContext(source, { window, document, localStorage, console }, { filename: 'display_settings.js' });
  return { window, document, canvas, container, select, listeners, stored, writes: () => writes };
}

test('resolution presets limit the drawing buffer, persist, and avoid redundant WebGL resets', () => {
  const g = fixture();
  assert.equal(g.window.CrazyShootersDisplay.getMode(), 'balanced');
  assert.deepEqual([g.canvas.width, g.canvas.height], [1280, 720]);
  assert.equal(g.container.style.transform, 'scale(3, 3)');
  const before = g.writes();
  g.window.FitScreen(); g.listeners.focus[0]();
  assert.equal(g.writes(), before);
  assert.equal(g.window.CrazyShootersDisplay.setMode('performance'), true);
  assert.deepEqual([g.canvas.width, g.canvas.height], [960, 540]);
  assert.equal(g.stored.get('crazyShooters.graphics'), 'performance');
  assert.equal(g.window.CrazyShootersDisplay.setMode('native'), true);
  assert.deepEqual([g.canvas.width, g.canvas.height], [3840, 2160]);
  assert.equal(g.window.CrazyShootersDisplay.setMode('not-a-mode'), false);
  assert.equal(g.window.CrazyShootersDisplay.getMode(), 'native');
  g.window.innerWidth = 800; g.window.innerHeight = 600;
  g.window.CrazyShootersDisplay.setMode('balanced');
  assert.deepEqual([g.canvas.width, g.canvas.height], [800, 600]); // never upscale a small display
});

test('mouse input maps to logical Unity pixels without changing UI or pointer-lock movement', () => {
  const g = fixture('performance');
  const event = { target: g.canvas, clientX: 1920, clientY: 1080, pageX: 1920, movementX: 5 };
  g.listeners.mousedown[0](event);
  assert.equal(event.clientX, 480); assert.equal(event.clientY, 270);
  assert.equal(event.pageX, 1920); assert.equal(event.movementX, 5);
  const uiEvent = { target: g.select, clientX: 1920, clientY: 1080 };
  g.listeners.mousedown[0](uiEvent);
  assert.equal(uiEvent.clientX, 1920);
  g.document.pointerLockElement = g.canvas;
  const locked = { target: g.canvas, clientX: 1920, clientY: 1080, movementX: 9 };
  g.listeners.mousemove[0](locked);
  assert.equal(locked.clientX, 1920); assert.equal(locked.movementX, 9);
});
