/**
 * Enable Photon's built-in offline mode for this offline package. The original
 * Unity build otherwise tries to reach a Photon server before allowing a room.
 * Add ?online=1 to retain the original networked startup instead.
 */
(function() {
  'use strict';
  const wantsOnline = new URLSearchParams(window.location.search).get('online') === '1';
  const PHOTON_NAME = 10566946;
  // Fast path for this exact bundled build, always checked against metadata.
  // The incremental scanner provides a fallback if allocations differ.
  const PHOTON_CLASS_HINT = 20254584;
  let state = wantsOnline ? 'online' : 'preparing';
  let readyAt = 0;

  function setStatus(next) {
    state = next;
    const node = document.getElementById('connection-mode');
    if (!node) return;
    node.textContent = next === 'offline' ? 'Offline' : next === 'online' ? 'Online' :
      next === 'unavailable' ? 'Offline unavailable' : 'Preparing offline…';
    node.title = next === 'unavailable' ? 'Offline mode could not be initialized; see the browser console.' :
      next === 'online' ? 'Original network mode (?online=1)' : 'Photon local offline mode';
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

  function enableOffline(mod, klass, limit) {
    const heap = mod.HEAP32;
    const bytes = mod.HEAPU8;
    const k = klass / 4;
    if (!bytes || !window.CrazyShootersHeapScanner.isClass(heap, k, [PHOTON_NAME]) ||
        !window.CrazyShootersHeapScanner.stringEquals(bytes, PHOTON_NAME, 'PhotonNetwork')) return false;

    // In this IL2CPP version +16 is the method table and the low 16 bits of
    // +39 are its count. Require initialized Photon statics/peer first.
    const statics = heap[k + 20];
    const table = heap[k + 16];
    const count = heap[k + 39] & 0xffff;
    if (statics <= 0 || statics % 4 || statics / 4 + 2 >= limit ||
        !heap[statics / 4 + 1] || !heap[statics / 4 + 2] ||
        table <= 0 || table % 4 || !count || count > 512 || table / 4 + count > limit) return false;

    let getter = 0, setter = 0;
    for (let i = 0; i < count; i++) {
      const method = heap[table / 4 + i];
      if (method <= 0 || method % 4 || method / 4 + 11 >= limit) continue;
      const p = method / 4;
      if (heap[p + 3] !== klass || !(heap[p + 10] & 0x10) || heap[p] <= 0) continue;
      const name = readName(bytes, heap[p + 2]);
      const parameterCount = heap[p + 11] >>> 16;
      if (name === 'get_offlineMode' && parameterCount === 0) getter = method;
      if (name === 'set_offlineMode' && parameterCount === 1) setter = method;
    }
    if (!getter || !setter || typeof mod.dynCall_iii !== 'function' || typeof mod.dynCall_viii !== 'function') return false;

    // Unity 2017 IL2CPP static methods still take a null 'this' plus MethodInfo.
    const previous = mod.dynCall_iii(heap[getter / 4], 0, getter);
    if (!previous) mod.dynCall_viii(heap[setter / 4], 0, 1, setter);
    return mod.dynCall_iii(heap[getter / 4], 0, getter) === 1;
  }

  function tick() {
    if (state !== 'preparing') return;
    const mod = window.gameInstance && window.gameInstance.Module;
    if (readyAt && performance.now() - readyAt >= 1000 && mod && mod.HEAP32 && mod.HEAPF32 && mod.asm) {
      const limit = window.CrazyShootersHeapScanner.allocatedWords(mod);
      const discovered = window.CrazyShootersMod && window.CrazyShootersMod.getClassPointer('photonNetwork');
      const klass = discovered || PHOTON_CLASS_HINT;
      if (limit) {
        try {
          if (enableOffline(mod, klass, limit)) {
            setStatus('offline');
            console.log('[Crazy Shooters Offline] Photon local mode enabled.');
            return;
          }
        } catch (err) {
          setStatus('unavailable');
          console.warn('[Crazy Shooters Offline] Could not enable Photon local mode:', err);
          return;
        }
      }
      if (performance.now() - readyAt > 90000) {
        setStatus('unavailable');
        console.warn('[Crazy Shooters Offline] Photon local mode was not found in this build.');
        return;
      }
    }
    setTimeout(tick, 250);
  }

  window.CrazyShootersOffline = {
    notifyUnityReady: function() { if (!readyAt) readyAt = performance.now(); },
    getState: function() { return state; }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function() { setStatus(state); });
  else setStatus(state);
  if (!wantsOnline) setTimeout(tick, 250);
})();
