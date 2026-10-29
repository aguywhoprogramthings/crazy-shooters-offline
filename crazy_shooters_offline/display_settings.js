/* Keep the Unity drawing buffer affordable on large/high-resolution screens. */
(function() {
  'use strict';

  const STORAGE_KEY = 'crazyShooters.graphics';
  const presets = {
    balanced: { width: 1280, height: 720 },
    performance: { width: 960, height: 540 },
    native: null
  };
  let mode = 'balanced';
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (Object.prototype.hasOwnProperty.call(presets, saved)) mode = saved;
  } catch (e) { /* The game still works when storage is unavailable. */ }

  function fitScreen() {
    const container = document.getElementById('gameContainer');
    if (!container) return;
    const width = Math.max(1, window.innerWidth);
    const height = Math.max(1, window.innerHeight);
    const cap = presets[mode];
    const scale = cap ? Math.min(1, cap.width / width, cap.height / height) : 1;
    const renderWidth = Math.max(1, Math.round(width * scale));
    const renderHeight = Math.max(1, Math.round(height * scale));

    // Unity 2017 reads canvas.clientWidth/clientHeight when choosing its render
    // resolution. Scale the whole container visually so those logical sizes,
    // Unity's drawing buffer and mouse hit coordinates remain in agreement.
    container.style.width = renderWidth + 'px';
    container.style.height = renderHeight + 'px';
    container.style.transformOrigin = 'top left';
    container.style.transform = 'scale(' + (width / renderWidth) + ', ' + (height / renderHeight) + ')';

    const canvas = window.gameInstance && window.gameInstance.Module && window.gameInstance.Module.canvas;
    if (canvas) {
      // Assigning either property resets the WebGL drawing buffer. Never do it
      // again on focus or a redundant resize when the dimensions are unchanged.
      if (canvas.width !== renderWidth) canvas.width = renderWidth;
      if (canvas.height !== renderHeight) canvas.height = renderHeight;
    }
  }

  function setMode(next) {
    if (!Object.prototype.hasOwnProperty.call(presets, next)) return false;
    mode = next;
    try { localStorage.setItem(STORAGE_KEY, mode); } catch (e) {}
    const select = document.getElementById('graphics-quality');
    if (select) select.value = mode;
    fitScreen();
    return true;
  }

  function init() {
    const select = document.getElementById('graphics-quality');
    if (select) {
      select.value = mode;
      select.addEventListener('change', function() { setMode(select.value); });
    }
    fitScreen();
  }

  // Unity 2017's Emscripten mouse callbacks subtract the canvas rectangle from
  // clientX/Y without accounting for CSS transforms. Correct those coordinates
  // before Unity's listeners run; leave pageX/Y and movementX/Y alone (the SDL
  // path already scales page coordinates, and pointer-lock uses movement).
  function adjustMouseCoordinates(event) {
    const canvas = window.gameInstance && window.gameInstance.Module && window.gameInstance.Module.canvas;
    if (!canvas || event.target !== canvas || document.pointerLockElement === canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const xScale = canvas.clientWidth / rect.width;
    const yScale = canvas.clientHeight / rect.height;
    if (Math.abs(xScale - 1) < 0.0001 && Math.abs(yScale - 1) < 0.0001) return;
    try {
      Object.defineProperty(event, 'clientX', { configurable: true, value: rect.left + (event.clientX - rect.left) * xScale });
      Object.defineProperty(event, 'clientY', { configurable: true, value: rect.top + (event.clientY - rect.top) * yScale });
    } catch (e) { /* Unsupported event implementation; native mode remains available. */ }
  }
  ['mousemove', 'mousedown', 'mouseup', 'mouseenter', 'mouseleave', 'wheel'].forEach(function(type) {
    window.addEventListener(type, adjustMouseCoordinates, true);
  });

  window.FitScreen = fitScreen;
  window.CrazyShootersDisplay = { setMode: setMode, getMode: function() { return mode; }, fit: fitScreen };
  window.addEventListener('load', fitScreen);
  window.addEventListener('resize', fitScreen);
  window.addEventListener('focus', fitScreen);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
