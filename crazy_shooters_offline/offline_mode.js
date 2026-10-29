/**
 * Choose the original Photon multiplayer connection or local offline play.
 * Changing modes reloads Unity: Photon offlineMode must be set before joining
 * a room, and an existing online room must be left rather than silently reused.
 */
(function() {
  'use strict';
  const STORAGE_KEY = 'crazyShooters.connectionMode';
  const PHOTON_NAME = 10566946;
  // Fast path for this exact bundled build, always checked against metadata.
  // The incremental scanner provides a fallback if allocations differ.
  const PHOTON_CLASS_HINT = 20254584;

  function isMode(value) { return value === 'online' || value === 'offline'; }

  function initialMode() {
    const query = new URLSearchParams(window.location.search);
    const explicit = query.get('mode');
    if (isMode(explicit)) return explicit;
    // Preserve links published for the previous build and offer a simple
    // explicit offline URL for testing or launching without browser storage.
    if (query.get('offline') === '1') return 'offline';
    if (query.get('online') === '1') return 'online';
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (isMode(saved)) return saved;
    } catch (e) { /* Online remains the default without browser storage. */ }
    return 'online';
  }

  const mode = initialMode();
  let state = mode === 'online' ? 'online' : 'preparing';
  let networkState = 'unknown';
  let readyAt = null;

  function updateStatus() {
    const node = document.getElementById('connection-mode');
    if (!node) return;
    if (state === 'online') {
      const labels = {
        unknown: 'Online mode',
        disconnected: 'Online: not connected',
        connecting: 'Online: connecting…',
        connected: 'Online: connected'
      };
      node.textContent = labels[networkState];
      node.title = networkState === 'connected' ? 'Photon reports that the online connection is ready.' :
        'Press Start to connect to the original Photon service. Online mode alone does not guarantee a connection.';
    } else {
      node.textContent = state === 'offline' ? 'Offline' :
        state === 'unavailable' ? 'Offline unavailable' : 'Preparing offline…';
      node.title = state === 'unavailable' ? 'Offline mode could not be initialized; see the browser console.' :
        'Photon local offline mode; rooms and overlay bots are not shared with other players.';
    }
  }

  function setStatus(next) {
    state = next;
    updateStatus();
  }

  function readName(bytes, pointer) {
    if (pointer <= 0 || pointer >= bytes.length) return '';
    let result = '';
    for (let i = pointer; i < bytes.length && i < pointer + 80 && bytes[i]; i++) {
      if (bytes[i] < 32 || bytes[i] > 126) return '';
      result += String.fromCharCode(bytes[i]);
    }
    return result;
  }

  // Find only methods whose owner, static flag and parameter count match the
  // bundled IL2CPP metadata. Never call an unvalidated function pointer.
  function photonMethods(mod, klass, limit, wanted) {
    const heap = mod.HEAP32;
    const bytes = mod.HEAPU8;
    const k = klass / 4;
    if (!bytes || !window.CrazyShootersHeapScanner.isClass(heap, k, [PHOTON_NAME]) ||
        !window.CrazyShootersHeapScanner.stringEquals(bytes, PHOTON_NAME, 'PhotonNetwork')) return null;

    // In this IL2CPP version +16 is the method table and the low 16 bits of
    // +39 are its count. Require initialized Photon statics/peer first.
    const statics = heap[k + 20];
    const table = heap[k + 16];
    const count = heap[k + 39] & 0xffff;
    if (statics <= 0 || statics % 4 || statics / 4 + 2 >= limit ||
        !heap[statics / 4 + 1] || !heap[statics / 4 + 2] ||
        table <= 0 || table % 4 || !count || count > 512 || table / 4 + count > limit) return null;

    const methods = Object.create(null);
    for (let i = 0; i < count; i++) {
      const method = heap[table / 4 + i];
      if (method <= 0 || method % 4 || method / 4 + 11 >= limit) continue;
      const p = method / 4;
      if (heap[p + 3] !== klass || !(heap[p + 10] & 0x10) || heap[p] <= 0) continue;
      const name = readName(bytes, heap[p + 2]);
      if (Object.prototype.hasOwnProperty.call(wanted, name) && (heap[p + 11] >>> 16) === wanted[name]) {
        methods[name] = method;
      }
    }
    return Object.keys(wanted).every(name => methods[name]) ? methods : null;
  }

  function enableOffline(mod, klass, limit) {
    const methods = photonMethods(mod, klass, limit, { get_offlineMode: 0, set_offlineMode: 1 });
    if (!methods || typeof mod.dynCall_iii !== 'function' || typeof mod.dynCall_viii !== 'function') return false;
    const heap = mod.HEAP32, getter = methods.get_offlineMode, setter = methods.set_offlineMode;

    // Unity 2017 IL2CPP static methods still take a null 'this' plus MethodInfo.
    const previous = mod.dynCall_iii(heap[getter / 4], 0, getter);
    if (previous !== 0 && previous !== 1) return false;
    if (!previous) mod.dynCall_viii(heap[setter / 4], 0, 1, setter);
    return mod.dynCall_iii(heap[getter / 4], 0, getter) === 1;
  }

  function readOnlineState(mod, klass, limit) {
    const methods = photonMethods(mod, klass, limit, { get_connectedAndReady: 0, get_connecting: 0 });
    if (!methods || typeof mod.dynCall_iii !== 'function') return null;
    const heap = mod.HEAP32, ready = methods.get_connectedAndReady, connecting = methods.get_connecting;
    const isReady = mod.dynCall_iii(heap[ready / 4], 0, ready);
    const isConnecting = mod.dynCall_iii(heap[connecting / 4], 0, connecting);
    if ((isReady !== 0 && isReady !== 1) || (isConnecting !== 0 && isConnecting !== 1)) return null;
    return isReady ? 'connected' : isConnecting ? 'connecting' : 'disconnected';
  }

  function tick() {
    if (state !== 'preparing' && state !== 'online') return;
    if (mode === 'online' && document.hidden) {
      setTimeout(tick, 1000);
      return;
    }
    const mod = window.gameInstance && window.gameInstance.Module;
    if (readyAt !== null && performance.now() - readyAt >= 1000 && mod && mod.HEAP32 && mod.HEAPF32 && mod.asm) {
      const limit = window.CrazyShootersHeapScanner.allocatedWords(mod);
      const discovered = window.CrazyShootersMod && window.CrazyShootersMod.getClassPointer('photonNetwork');
      const klass = discovered || PHOTON_CLASS_HINT;
      if (limit) {
        try {
          if (mode === 'offline') {
            if (enableOffline(mod, klass, limit)) {
              setStatus('offline');
              console.log('[Crazy Shooters] Photon local offline mode enabled.');
              return;
            }
          } else {
            const next = readOnlineState(mod, klass, limit);
            if (next && next !== networkState) {
              networkState = next;
              updateStatus();
            }
          }
        } catch (err) {
          if (mode === 'offline') setStatus('unavailable');
          else { networkState = 'unknown'; updateStatus(); }
          console.warn('[Crazy Shooters] Could not read or configure Photon mode:', err);
          return; // Do not repeatedly invoke a failed Unity method.
        }
      }
      if (mode === 'offline' && performance.now() - readyAt > 90000) {
        setStatus('unavailable');
        console.warn('[Crazy Shooters] Photon local mode was not found in this build.');
        return;
      }
    }
    setTimeout(tick, mode === 'online' ? 1000 : 250);
  }

  function changeMode(next) {
    if (!isMode(next)) return false;
    if (next === mode) return true;
    let url;
    try { url = new URL(window.location.href); } catch (e) { return false; }
    if (!window.confirm('Switch to ' + next + ' mode? The game will reload and leave the current room.')) return false;
    url.searchParams.delete('online');
    url.searchParams.delete('offline');
    url.searchParams.set('mode', next);
    try { window.localStorage.setItem(STORAGE_KEY, next); } catch (e) { /* URL still preserves the selection. */ }
    window.location.assign(url.toString());
    return true;
  }

  function init() {
    updateStatus();
    const select = document.getElementById('connection-select');
    if (select) {
      select.value = mode;
      select.addEventListener('change', function() {
        if (!changeMode(select.value)) select.value = mode;
      });
    }
  }

  window.CrazyShootersOffline = {
    notifyUnityReady: function() { if (readyAt === null) readyAt = performance.now(); },
    getState: function() { return state; },
    getMode: function() { return mode; },
    getNetworkState: function() { return mode === 'online' ? networkState : null; },
    changeMode
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
  setTimeout(tick, mode === 'online' ? 1000 : 250);
})();
