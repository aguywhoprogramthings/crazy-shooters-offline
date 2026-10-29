'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync('crazy_shooters_offline/mod_tactical_ai.js', 'utf8');

function fixture() {
  const elements = new Map(), listeners = {}, frames = [], timers = [];
  let now = 100, player = null, clears = 0, htmlUpdates = 0;
  const ctx = new Proxy({
    clearRect() { clears++; }, createLinearGradient() { return { addColorStop() {} }; },
    measureText(text) { return { width: text.length * 6 }; }
  }, { get(target, key) { return key in target ? target[key] : function() {}; }, set(target, key, value) { target[key] = value; return true; } });
  function element(tag) {
    let html = '';
    return { tag, style: {}, children: [], width: 300, height: 150,
      set innerHTML(value) { html = value; htmlUpdates++; }, get innerHTML() { return html; },
      addEventListener(name, fn) { this[name] = fn; },
      appendChild(child) { this.children.push(child); if (child.id) elements.set(child.id, child); },
      remove() { if (this.id) elements.delete(this.id); },
      getContext() { return ctx; } };
  }
  const hud = element('div'); hud.id = 'mod-hud-container'; elements.set(hud.id, hud);
  const canvas = element('canvas');
  const document = { readyState: 'complete', body: element('body'), pointerLockElement: null,
    createElement: element, getElementById(id) { return elements.get(id) || null; } };
  const window = { innerWidth: 800, innerHeight: 600, gameInstance: { Module: { canvas } },
    CrazyShootersMod: { getPlayerState: () => player, applyDamageToPlayer() {} },
    addEventListener(name, fn) { (listeners[name] ||= []).push(fn); } };
  const context = { window, document, performance: { now: () => now }, console: { log() {}, warn() {} },
    setTimeout(fn) { timers.push(fn); }, requestAnimationFrame(fn) { frames.push(fn); } };
  vm.runInNewContext(source, context, { filename: 'mod_tactical_ai.js' });
  function tick(count = 1) { for (let i = 0; i < count; i++) { now += 16; const queue = frames.splice(0); queue.forEach(fn => fn(now)); } }
  return { window, document, canvas, listeners, timers, elements, tick,
    setPlayer(value) { player = value; }, clears: () => clears, htmlUpdates: () => htmlUpdates };
}

test('retains bots and hotkeys without rebuilding the AI badge or clearing an empty overlay every frame', () => {
  const g = fixture();
  g.timers[0](); // two default bots
  assert.equal(g.window.CrazyShootersAI.getBots().length, 2);
  const htmlBefore = g.htmlUpdates();
  g.tick(60);
  assert.equal(g.htmlUpdates(), htmlBefore);
  assert.equal(g.clears(), 0);
  function key(code) { g.listeners.keydown[0]({ key: code, code, repeat: false, preventDefault() {} }); }
  key('F10'); assert.equal(g.window.CrazyShootersAI.getBots().length, 3);
  key('F11'); assert.equal(g.window.CrazyShootersAI.isEnabled(), false);
  key('F12');
  assert.ok(g.htmlUpdates() > htmlBefore);
});

test('only game-canvas shots hit visible bots and stale player positions are cleared', () => {
  const g = fixture(); g.timers[0]();
  const api = g.window.CrazyShootersAI, bot = api.getBots()[0];
  api.getBots()[1].state = 'DEAD';
  api.toggleAI(); // freeze movement while checking the screen-space hitbox
  bot.x = 0; bot.y = 3; bot.z = 10; bot.hp = 100;
  g.setPlayer({ pos: { x: 0, y: 3, z: 0 }, rot: [0, 0, 0, 1] });
  g.tick();
  assert.ok(bot.screenBounds && bot.screenBounds.left < 400 && bot.screenBounds.right > 400);
  const fire = g.listeners.mousedown[0];
  fire({ button: 0, target: g.elements.get('mod-hud-ai') }); assert.equal(bot.hp, 100);
  fire({ button: 0, target: g.canvas }); assert.equal(bot.hp, 65);
  bot.z = -10; g.tick();
  assert.equal(bot.screenBounds, null);
  fire({ button: 0, target: g.canvas }); assert.equal(bot.hp, 65);
  g.setPlayer(null); g.tick(20);
  const afterClear = g.clears(); g.tick(10); assert.equal(g.clears(), afterClear);
});

test('projects bots in front of the actual camera yaw and pitch', () => {
  const g = fixture(); g.timers[0]();
  const api = g.window.CrazyShootersAI, bot = api.getBots()[0];
  api.getBots()[1].state = 'DEAD'; api.toggleAI();
  bot.x = 10; bot.y = 3; bot.z = 0;
  g.setPlayer({ pos: { x: 0, y: 3, z: 0 }, rot: [0, Math.SQRT1_2, 0, Math.SQRT1_2] });
  g.tick();
  assert.ok(bot.screenBounds && bot.screenBounds.left < 400 && bot.screenBounds.right > 400);
  bot.x = 0; bot.y = -7; bot.z = 10;
  g.setPlayer({ pos: { x: 0, y: 3, z: 0 }, rot: [Math.sin(Math.PI / 8), 0, 0, Math.cos(Math.PI / 8)] });
  g.tick();
  assert.ok(bot.screenBounds && bot.screenBounds.top < 300 && bot.screenBounds.bottom > 300);
});

test('keeps overlay bots near the player when a non-Factory map is selected', () => {
  const g = fixture(); g.timers[0]();
  const api = g.window.CrazyShootersAI; api.toggleAI();
  g.setPlayer({ pos: { x: 270, y: 258, z: 135 }, rot: [0, 0, 0, 1] }); g.tick();
  for (const bot of api.getBots()) {
    assert.ok(Math.hypot(bot.x - 270, bot.z - 135) < 110);
    assert.ok(bot.y >= 257 && bot.y <= 267);
  }
  g.setPlayer({ pos: { x: -65, y: 3.36, z: 0 }, rot: [0, 0, 0, 1] }); g.tick();
  for (const bot of api.getBots()) assert.ok(bot.x >= -150 && bot.x <= 15 && bot.y < 20);
});
