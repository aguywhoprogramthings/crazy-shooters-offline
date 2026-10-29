/**
 * Crazy Shooters Offline - Ultimate Mod Engine (v3.0)
 * Reverse-engineered for Unity 2017 IL2CPP WebGL asm.js
 * 
 * Features:
 * 1. Infinite Ammo & No Reload [F6]:
 *    - bulletsLeft locked permanently at 999 (clip never empties, reload never triggers).
 *    - clips locked at 9999.
 * 
 * 2. Enhanced Physics: Jump & Speed Boost [F7]:
 *    - Jump Height (baseHeight) boosted from 1.0m to 1.85m (+85%).
 *      Allows easily vaulting onto crates, shipping containers, and obstacles.
 *    - Walk Speed boosted from 8.0 to 10.5 (+31%).
 *    - Run / Sprint Speed boosted from 11.5 to 15.0 (+30%).
 *    - Directional speeds boosted from 10.0 to 14.0 (+40%).
 *    - Standard gravity (20.0 m/s^2) preserved for tight, crisp control (zero floatiness).
 * 
 * 3. Rapid Fire Rate (+30% Fire Speed) [F9]:
 *    - Reduces shot delay / firing interval by 0.75x (+33% Rounds Per Minute).
 *    - Natural, subtle, and competitive: avoids ridiculous cartoonish speeds so
 *      firing sound effects, muzzle flash, and recoil animations remain authentic
 *      and responsive.
 *    - Dynamically covers MachineGun (MP5, AK-47, M4, Sniper, Pistol),
 *      shotGun (M87T), GrenadeLauncher (RPG), and Ballistic Knife.
 * 
 * 4. Master Toggle [F8]:
 *    - Toggles all mods simultaneously.
 * 
 * 5. Interactive In-Game HUD:
 *    - 3 modern status badges in the top-left corner with real-time feedback and click-to-toggle.
 * 
 * 6. Validated, incremental memory discovery:
 *    - Dynamic class pointer discovery.
 *    - Automatically caches baseline vanilla values and restores them cleanly when disabled.
 */

(function() {
  'use strict';

  // --- Mod States ---
  let ammoModEnabled = true;
  let physicsModEnabled = true;
  let rapidFireEnabled = true;

  // --- Tuning Configurations ---
  const FIRE_RATE_INTERVAL_MULT = 0.75; // 0.75x interval = +33% fire rate (subtle & natural)

  const PHYSICS_CONFIG = {
    vanilla: {
      baseHeight: 1.0,
      extraHeight: 2.0,
      walkSpeed: 8.0,
      runSpeed: 11.5,
      maxForwardSpeed: 10.0,
      maxSidewaysSpeed: 10.0,
      maxBackwardsSpeed: 10.0
    },
    boosted: {
      baseHeight: 1.85,  // +85% jump: allows jumping onto crates, containers, barriers
      extraHeight: 3.0,
      walkSpeed: 10.5,   // +31% walk speed
      runSpeed: 15.0,    // +30% sprint speed
      maxForwardSpeed: 14.0,
      maxSidewaysSpeed: 14.0,
      maxBackwardsSpeed: 14.0
    }
  };

  // Baselines are kept for live instances only, so toggles can restore the
  // actual values in this build instead of assuming every weapon is the same.
  const baselineFireRates = { mg: new Map(), sg: new Map(), gl: new Map(), knife: new Map() };
  const baselineAmmo = { mg: new Map(), sg: new Map(), gl: new Map() };
  const fireTemplates = { mg: new Map(), sg: new Map(), gl: new Map(), knife: new Map() };
  const ammoTemplates = { mg: new Map(), sg: new Map(), gl: new Map() };
  const physicsWasApplied = { mov: false, jmp: false };
  let cameraAccessor = null;
  let failedCameraModule = null;
  let photonClock = null;
  let failedClockModule = null;
  const baselinePhysics = { mov: new Map(), jmp: new Map() };

  const cachedKlasses = {
    machineGun: null, shotGun: null, grenadeLauncher: null, knife: null,
    fpsMovement: null, fpsJumping: null, fpsController: null, pnc: null,
    playerDamage: null, rmm: null, photonNetwork: null
  };
  const instancePtrs = {
    mg: [], sg: [], gl: [], knife: [], mov: [], jmp: [],
    fpsCtrl: [], pnc: [], damage: [], rmm: []
  };

  function getModule() {
    if (window.gameInstance && window.gameInstance.Module && window.gameInstance.Module.HEAP32) {
      return window.gameInstance.Module;
    }
    if (typeof Module !== 'undefined' && Module.HEAP32) return Module;
    return null;
  }

  function plainObject(heap, floats, index, klass) {
    const classIndex = klass / 4;
    // Exclude references inside Il2CppClass itself and its metadata tables.
    return index !== classIndex + 6 && index !== classIndex + 7 &&
      heap[index - 1] !== klass && heap[index - 1] !== heap[classIndex + 9];
  }

  function unityComponent(heap, floats, index, klass, limit) {
    if (!plainObject(heap, floats, index, klass)) return false;
    // MonoBehaviours have a native object pointer at +8. A null pointer is a
    // destroyed/uninitialized object; a pointer to an Il2CppClass is metadata,
    // not an instance. Do not write to either.
    const native = heap[index + 2] >>> 0;
    if (!native || native % 4 || native / 4 + 7 >= limit) return false;
    const n = native / 4;
    return !(heap[n + 6] === native && heap[n + 7] === native);
  }

  const classTypes = [
    { classKey: 'machineGun', instanceKey: 'mg', maxOffset: 13,
      names: [{ address: 10553142, text: 'MachineGun' }, { address: 10545300, text: 'MachineGun' }],
      validate: (h, f, p, k) => plainObject(h, f, p, k) && f[p + 7] > 0.0001 && f[p + 7] < 5 },
    { classKey: 'shotGun', instanceKey: 'sg', maxOffset: 12,
      names: [{ address: 10553029, text: 'shotGun' }],
      validate: (h, f, p, k) => plainObject(h, f, p, k) && (h[p + 3] === 4 || h[p + 3] === 5) && f[p + 5] > 0.0001 && f[p + 5] < 5 },
    { classKey: 'grenadeLauncher', instanceKey: 'gl', maxOffset: 9,
      names: [{ address: 10553089, text: 'GrenadeLauncher' }, { address: 10545350, text: 'GrenadeLauncher' }],
      validate: (h, f, p, k) => plainObject(h, f, p, k) && h[p + 5] > 0 && h[p + 5] < 10000 &&
        Number.isFinite(f[p + 6]) && f[p + 6] >= 0 && f[p + 6] < 5 },
    { classKey: 'knife', instanceKey: 'knife', maxOffset: 5,
      names: [{ address: 10553194, text: 'Knife' }],
      validate: (h, f, p, k) => plainObject(h, f, p, k) && f[p + 4] > 0.0001 && f[p + 4] < 5 },
    { classKey: 'fpsMovement', instanceKey: 'mov', maxOffset: 6,
      names: [{ address: 10540523, text: 'FPScontrollerMovement' }],
      validate: (h, f, p, k) => plainObject(h, f, p, k) &&
        [2, 3, 4, 5, 6].every(n => Number.isFinite(f[p + n]) && f[p + n] >= 0.1 && f[p + n] <= 100) },
    { classKey: 'fpsJumping', instanceKey: 'jmp', maxOffset: 4,
      names: [{ address: 10540900, text: 'FPScontrollerJumping' }],
      validate: (h, f, p, k) => plainObject(h, f, p, k) && (h[p + 2] === 0 || h[p + 2] === 1) &&
        f[p + 3] >= 0.1 && f[p + 3] <= 100 && f[p + 4] >= 0.1 && f[p + 4] <= 100 },
    { classKey: 'fpsController', instanceKey: 'fpsCtrl', maxOffset: 38,
      names: [{ address: 10539619, text: 'FPScontroller' }], validate: unityComponent },
    { classKey: 'pnc', instanceKey: 'pnc', maxOffset: 35,
      names: [{ address: 10545213, text: 'PlayerNetworkController' }], validate: unityComponent },
    { classKey: 'playerDamage', instanceKey: 'damage', maxOffset: 19,
      names: [{ address: 10544838, text: 'PlayerDamage' }], validate: unityComponent },
    { classKey: 'rmm', instanceKey: 'rmm', maxOffset: 46,
      names: [{ address: 10545916, text: 'RoomMultiplayerMenu' }], validate: unityComponent },
    { classKey: 'photonNetwork', names: [{ address: 10566946, text: 'PhotonNetwork' }] }
  ];
  const typesByInstance = Object.fromEntries(classTypes.filter(t => t.instanceKey).map(t => [t.instanceKey, t]));
  const fireRateOffsets = { mg: 7, sg: 5, gl: 6, knife: 4 };
  const ammoOffsets = { mg: [8, 9, 10], sg: [9, 10, 11], gl: [9] };
  const physicsOffsets = { mov: [2, 3, 4, 5, 6], jmp: [3, 4] };
  const physicsValues = {
    mov: [14, 14, 14, 10.5, 15], jmp: [1.85, 3]
  };
  const vanillaPhysicsValues = {
    mov: [10, 10, 10, 8, 11.5], jmp: [1, 2]
  };
  // These are stable weapon configuration/asset fields, not ammo or rate.
  // They let us recognize a newly spawned copy of a modded prefab.
  const signatureOffsets = {
    mg: [2, 4, 5, 11, 12, 13], sg: [2, 3, 4, 6, 7, 8],
    gl: [2, 3, 4, 5, 7, 8], knife: [2, 3, 5]
  };

  function closeEnough(a, b) {
    return Math.abs(a - b) <= Math.max(0.000001, Math.abs(b) * 0.00001);
  }

  function weaponSignature(key, heap, p) {
    return signatureOffsets[key].map(offset => heap[p + offset]).join(',');
  }

  function rememberTemplate(map, signature, value) {
    // Prevent unbounded growth when many objects or maps are loaded.
    if (!map.has(signature) && map.size >= 256) map.delete(map.keys().next().value);
    map.set(signature, value);
  }

  function captureFireRate(key, p, mod) {
    const current = mod.HEAPF32[p + fireRateOffsets[key]];
    const signature = weaponSignature(key, mod.HEAP32, p);
    const templates = fireTemplates[key].get(signature) || [];
    let base = current;
    // Prefer an exact known vanilla rate over an ambiguous accelerated match.
    if (!templates.some(value => closeEnough(current, value))) {
      const inherited = templates.find(value => closeEnough(current, value * FIRE_RATE_INTERVAL_MULT));
      if (inherited !== undefined) base = inherited;
    }
    const entry = { value: base, signature };
    baselineFireRates[key].set(p, entry);
    // A copy can be created while the feature is already off. Undo only a
    // rate that matches one of our own previously applied templates.
    if (!rapidFireEnabled && !closeEnough(current, base)) mod.HEAPF32[p + fireRateOffsets[key]] = base;
    return entry;
  }

  function originalAmmo(key, heap, p) {
    const values = ammoOffsets[key].map(offset => heap[p + offset]);
    const signature = weaponSignature(key, heap, p);
    const boosted = key === 'mg' ? values[0] === 999 && values[1] === 9999 && values[2] === 999 :
      key === 'sg' ? values[0] === 999 && values[1] === 999 && values[2] === 9999 : values[0] === 999;
    if (!boosted) {
      rememberTemplate(ammoTemplates[key], signature, values.slice());
      return values;
    }
    const template = ammoTemplates[key].get(signature);
    if (!template) return values;
    const restored = template.slice();
    // Prefabs often have zero bulletsLeft before their first equip. A spawned
    // copy of one should return to a usable vanilla-sized magazine, not 999.
    if (key === 'mg' && restored[2] === 0) restored[2] = restored[0];
    if (key === 'sg' && restored[1] === 0) restored[1] = restored[0];
    return restored;
  }

  function restoreInheritedAmmo(key, p, mod) {
    const heap = mod.HEAP32;
    const values = originalAmmo(key, heap, p);
    ammoOffsets[key].forEach((offset, i) => { heap[p + offset] = values[i]; });
  }

  function originalPhysics(key, floats, p) {
    const values = physicsOffsets[key].map(offset => floats[p + offset]);
    if (physicsWasApplied[key] && values.every((value, i) => closeEnough(value, physicsValues[key][i]))) {
      return vanillaPhysicsValues[key].slice();
    }
    return values;
  }

  function clearBaselines() {
    for (const group of [baselineFireRates, baselineAmmo, baselinePhysics, fireTemplates, ammoTemplates]) {
      for (const map of Object.values(group)) map.clear();
    }
    physicsWasApplied.mov = physicsWasApplied.jmp = false;
    cameraAccessor = null;
    failedCameraModule = null;
    photonClock = null;
    failedClockModule = null;
  }

  const scanner = new window.CrazyShootersHeapScanner.IncrementalHeapScanner({
    types: classTypes,
    klasses: cachedKlasses,
    instances: instancePtrs,
    onFound: function(type, index, mod) {
      const key = type.instanceKey;
      if (baselineFireRates[key] && !baselineFireRates[key].has(index)) captureFireRate(key, index, mod);
      if (baselineAmmo[key] && !ammoModEnabled) restoreInheritedAmmo(key, index, mod);
      if (baselinePhysics[key] && !physicsModEnabled) {
        const values = originalPhysics(key, mod.HEAPF32, index);
        physicsOffsets[key].forEach((offset, i) => { mod.HEAPF32[index + offset] = values[i]; });
      }
    },
    onRemoved: function(type, index) {
      for (const group of [baselineFireRates, baselineAmmo, baselinePhysics]) {
        if (group[type.instanceKey]) group[type.instanceKey].delete(index);
      }
    },
    onReset: clearBaselines
  });

  function isLive(type, mod, index, limit) {
    const heap = mod.HEAP32;
    const klass = cachedKlasses[type.classKey];
    return !!klass && index > 0 && index + type.maxOffset < limit &&
      heap[index] === klass && heap[index + 1] === 0 &&
      type.validate(heap, mod.HEAPF32, index, klass, limit);
  }

  function forEachLive(key, mod, limit, callback) {
    const type = typesByInstance[key];
    for (const index of instancePtrs[key]) {
      if (isLive(type, mod, index, limit)) callback(index);
    }
  }

  function applyAmmo(mod, limit) {
    const heap = mod.HEAP32;
    for (const key of Object.keys(ammoOffsets)) {
      const offsets = ammoOffsets[key];
      forEachLive(key, mod, limit, function(p) {
        if (!baselineAmmo[key].has(p)) baselineAmmo[key].set(p, originalAmmo(key, heap, p));
        if (key === 'mg') {
          heap[p + 8] = 999; heap[p + 9] = 9999; heap[p + 10] = 999;
        } else if (key === 'sg') {
          heap[p + 9] = 999; heap[p + 10] = 999; heap[p + 11] = 9999;
        } else {
          heap[p + 9] = 999;
        }
      });
    }
  }

  function restoreAmmo() {
    const mod = getModule();
    const limit = mod && window.CrazyShootersHeapScanner.allocatedWords(mod);
    for (const key of Object.keys(ammoOffsets)) {
      if (mod && limit) forEachLive(key, mod, limit, function(p) {
        const values = baselineAmmo[key].get(p);
        if (values) ammoOffsets[key].forEach((offset, i) => { mod.HEAP32[p + offset] = values[i]; });
      });
      baselineAmmo[key].clear();
    }
  }

  function applyFireRate(mod, limit) {
    for (const key of Object.keys(fireRateOffsets)) {
      forEachLive(key, mod, limit, function(p) {
        const offset = fireRateOffsets[key];
        const current = mod.HEAPF32[p + offset];
        const entry = baselineFireRates[key].get(p) || captureFireRate(key, p, mod);
        if (!closeEnough(current, entry.value * FIRE_RATE_INTERVAL_MULT) && !closeEnough(current, entry.value)) {
          // An address may be reused for another weapon. Re-evaluate the
          // current value, including the copied-prefab case, before changing it.
          captureFireRate(key, p, mod);
        }
        const active = baselineFireRates[key].get(p);
        if (!active.registered) {
          const known = fireTemplates[key].get(active.signature) || [];
          if (!known.some(value => closeEnough(value, active.value))) {
            rememberTemplate(fireTemplates[key], active.signature, known.concat(active.value).slice(-16));
          }
          active.registered = true;
        }
        mod.HEAPF32[p + offset] = active.value * FIRE_RATE_INTERVAL_MULT;
      });
    }
  }

  function restoreFireRates() {
    const mod = getModule();
    const limit = mod && window.CrazyShootersHeapScanner.allocatedWords(mod);
    if (!mod || !limit) return;
    for (const key of Object.keys(fireRateOffsets)) {
      forEachLive(key, mod, limit, function(p) {
        const entry = baselineFireRates[key].get(p);
        if (entry) mod.HEAPF32[p + fireRateOffsets[key]] = entry.value;
      });
    }
  }

  function applyPhysics(mod, limit) {
    for (const key of Object.keys(physicsOffsets)) {
      const offsets = physicsOffsets[key];
      forEachLive(key, mod, limit, function(p) {
        if (!baselinePhysics[key].has(p)) baselinePhysics[key].set(p, originalPhysics(key, mod.HEAPF32, p));
        offsets.forEach((offset, i) => { mod.HEAPF32[p + offset] = physicsValues[key][i]; });
        physicsWasApplied[key] = true;
      });
    }
  }

  function restorePhysics() {
    const mod = getModule();
    const limit = mod && window.CrazyShootersHeapScanner.allocatedWords(mod);
    for (const key of Object.keys(physicsOffsets)) {
      if (mod && limit) forEachLive(key, mod, limit, function(p) {
        const values = baselinePhysics[key].get(p);
        if (values) physicsOffsets[key].forEach((offset, i) => { mod.HEAPF32[p + offset] = values[i]; });
      });
      baselinePhysics[key].clear();
    }
  }

  // RoomMultiplayerMenu recomputes its remaining time as
  // duration - (PhotonNetwork.time - referenceTime) on every Unity frame.
  // Refreshing referenceTime keeps the round open instead of merely delaying
  // its timeout for 99,999 seconds. Resolve the exact bundled getter once.
  function readPhotonTime(mod, limit) {
    if (failedClockModule === mod || typeof mod.dynCall_dii !== 'function' || !mod.HEAPU8) return null;
    const h = mod.HEAP32, klass = cachedKlasses.photonNetwork;
    if (!klass || !window.CrazyShootersHeapScanner.isClass(h, klass / 4, [10566946])) return null;
    if (!photonClock || photonClock.mod !== mod || photonClock.klass !== klass) {
      const k = klass / 4, statics = h[k + 20], table = h[k + 16], count = h[k + 39] & 0xffff;
      if (statics <= 0 || statics % 4 || statics / 4 + 2 >= limit || !h[statics / 4 + 1] || !h[statics / 4 + 2] ||
          table <= 0 || table % 4 || !count || count > 512 || table / 4 + count > limit) return null;
      let getter = null;
      for (let i = 0; i < count; i++) {
        const pointer = h[table / 4 + i];
        if (pointer <= 0 || pointer % 4 || pointer / 4 + 11 >= limit) continue;
        const p = pointer / 4, fn = h[p];
        if (h[p + 3] === klass && (h[p + 10] & 0x10) && (h[p + 11] >>> 16) === 0 &&
            h[p + 4] === 136148 && fn > 0 && fn < 16 &&
            window.CrazyShootersHeapScanner.stringEquals(mod.HEAPU8, h[p + 2], 'get_time')) {
          getter = { pointer, fn }; break;
        }
      }
      if (!getter) return null;
      photonClock = { mod, klass, ...getter };
    }
    try {
      const time = mod.dynCall_dii(photonClock.fn, 0, photonClock.pointer);
      return Number.isFinite(time) && time >= 0 ? time : null;
    } catch (err) {
      failedClockModule = mod;
      console.warn('[Crazy Shooters Mod] Photon clock unavailable:', err);
      return null;
    }
  }

  function onFrame() {
    const mod = getModule();
    const limit = mod && mod.HEAPF32 && window.CrazyShootersHeapScanner.allocatedWords(mod);
    if (mod && limit) {
      if (ammoModEnabled) applyAmmo(mod, limit);
      if (rapidFireEnabled) applyFireRate(mod, limit);
      if (physicsModEnabled) applyPhysics(mod, limit);
      // Preserve the original offline match-time lock, but only on validated
      // RoomMultiplayerMenu objects, never on class metadata.
      let photonTime;
      forEachLive('rmm', mod, limit, function(p) {
        if (photonTime === undefined) photonTime = readPhotonTime(mod, limit);
        mod.HEAP32[p + 44] = 99999;
        if (photonTime !== null) mod.HEAPF32[p + 45] = photonTime;
        mod.HEAPF32[p + 46] = 590.0;
      });
    }
    requestAnimationFrame(onFrame);
  }

  // Scan a little at a time between frames. Nothing runs while the tab is
  // hidden, and idle time between sweeps does not queue up blocking intervals.
  function scanTick() {
    const mod = getModule();
    let delay = 250;
    if (!document.hidden && mod && mod.asm && mod.HEAPF32) {
      delay = scanner.work(mod, performance.now());
    }
    setTimeout(scanTick, delay);
  }

  // --- Interactive HUD Interface ---

  function createHUD() {
    let container = document.getElementById('mod-hud-container');
    if (container) container.remove();

    const oldBadge = document.getElementById('mod-hud-badge');
    if (oldBadge) oldBadge.remove();

    container = document.createElement('div');
    container.id = 'mod-hud-container';
    container.style.position = 'fixed';
    container.style.top = '12px';
    container.style.left = '12px';
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.gap = '6px';
    container.style.zIndex = '999999';
    container.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    container.style.userSelect = 'none';

    // 1. Ammo Badge
    const ammoBadge = document.createElement('div');
    ammoBadge.id = 'mod-hud-ammo';
    ammoBadge.title = 'Click or press [F6] to toggle Infinite Ammo & No Reload';
    ammoBadge.style.display = 'flex';
    ammoBadge.style.alignItems = 'center';
    ammoBadge.style.gap = '8px';
    ammoBadge.style.padding = '6px 14px';
    ammoBadge.style.borderRadius = '6px';
    ammoBadge.style.boxShadow = '0 3px 10px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.2)';
    ammoBadge.style.cursor = 'pointer';
    ammoBadge.style.transition = 'all 0.2s ease';
    ammoBadge.addEventListener('click', toggleAmmoMod);

    // 2. Physics Badge
    const physBadge = document.createElement('div');
    physBadge.id = 'mod-hud-phys';
    physBadge.title = 'Click or press [F7] to toggle Enhanced Jump & Speed';
    physBadge.style.display = 'flex';
    physBadge.style.alignItems = 'center';
    physBadge.style.gap = '8px';
    physBadge.style.padding = '6px 14px';
    physBadge.style.borderRadius = '6px';
    physBadge.style.boxShadow = '0 3px 10px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.2)';
    physBadge.style.cursor = 'pointer';
    physBadge.style.transition = 'all 0.2s ease';
    physBadge.addEventListener('click', togglePhysicsMod);

    // 3. Rapid Fire Badge
    const fireBadge = document.createElement('div');
    fireBadge.id = 'mod-hud-fire';
    fireBadge.title = 'Click or press [F9] to toggle Rapid Fire Rate (+30% Speed)';
    fireBadge.style.display = 'flex';
    fireBadge.style.alignItems = 'center';
    fireBadge.style.gap = '8px';
    fireBadge.style.padding = '6px 14px';
    fireBadge.style.borderRadius = '6px';
    fireBadge.style.boxShadow = '0 3px 10px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.2)';
    fireBadge.style.cursor = 'pointer';
    fireBadge.style.transition = 'all 0.2s ease';
    fireBadge.addEventListener('click', toggleRapidFire);

    container.appendChild(ammoBadge);
    container.appendChild(physBadge);
    container.appendChild(fireBadge);
    document.body.appendChild(container);

    updateHUD();
  }

  function updateHUD() {
    const ammoBadge = document.getElementById('mod-hud-ammo');
    const physBadge = document.getElementById('mod-hud-phys');
    const fireBadge = document.getElementById('mod-hud-fire');

    if (ammoBadge) {
      if (ammoModEnabled) {
        ammoBadge.style.background = 'linear-gradient(135deg, rgba(16, 185, 129, 0.95), rgba(5, 150, 105, 0.95))';
        ammoBadge.style.color = '#ffffff';
        ammoBadge.innerHTML = '<span style="font-size:14px;">⚡</span><div><div style="font-weight:800;font-size:11px;letter-spacing:0.5px;">AMMO & NO RELOAD</div><div style="font-size:10px;opacity:0.9;"><b>ACTIVE [999]</b> &bull; [F6] Toggle</div></div>';
      } else {
        ammoBadge.style.background = 'linear-gradient(135deg, rgba(239, 68, 68, 0.9), rgba(185, 28, 28, 0.9))';
        ammoBadge.style.color = '#ffffff';
        ammoBadge.innerHTML = '<span style="font-size:14px;">⚪</span><div><div style="font-weight:800;font-size:11px;letter-spacing:0.5px;">AMMO & NO RELOAD</div><div style="font-size:10px;opacity:0.9;"><b>OFF (VANILLA)</b> &bull; [F6] Toggle</div></div>';
      }
    }

    if (physBadge) {
      if (physicsModEnabled) {
        physBadge.style.background = 'linear-gradient(135deg, rgba(59, 130, 246, 0.95), rgba(37, 99, 235, 0.95))';
        physBadge.style.color = '#ffffff';
        physBadge.innerHTML = '<span style="font-size:14px;">🦘</span><div><div style="font-weight:800;font-size:11px;letter-spacing:0.5px;">PHYSICS BOOST</div><div style="font-size:10px;opacity:0.9;"><b>JUMP +85% | SPEED +30%</b> &bull; [F7] Toggle</div></div>';
      } else {
        physBadge.style.background = 'linear-gradient(135deg, rgba(107, 114, 128, 0.9), rgba(75, 85, 99, 0.9))';
        physBadge.style.color = '#ffffff';
        physBadge.innerHTML = '<span style="font-size:14px;">⚪</span><div><div style="font-weight:800;font-size:11px;letter-spacing:0.5px;">PHYSICS BOOST</div><div style="font-size:10px;opacity:0.9;"><b>OFF (VANILLA)</b> &bull; [F7] Toggle</div></div>';
      }
    }

    if (fireBadge) {
      if (rapidFireEnabled) {
        fireBadge.style.background = 'linear-gradient(135deg, rgba(249, 115, 22, 0.95), rgba(234, 88, 12, 0.95))';
        fireBadge.style.color = '#ffffff';
        fireBadge.innerHTML = '<span style="font-size:14px;">🔥</span><div><div style="font-weight:800;font-size:11px;letter-spacing:0.5px;">RAPID FIRE RATE</div><div style="font-size:10px;opacity:0.9;"><b>+30% SPEED [0.75x DELAY]</b> &bull; [F9] Toggle</div></div>';
      } else {
        fireBadge.style.background = 'linear-gradient(135deg, rgba(107, 114, 128, 0.9), rgba(75, 85, 99, 0.9))';
        fireBadge.style.color = '#ffffff';
        fireBadge.innerHTML = '<span style="font-size:14px;">⚪</span><div><div style="font-weight:800;font-size:11px;letter-spacing:0.5px;">RAPID FIRE RATE</div><div style="font-size:10px;opacity:0.9;"><b>OFF (VANILLA)</b> &bull; [F9] Toggle</div></div>';
      }
    }
  }

  function setAmmo(enabled) {
    enabled = !!enabled;
    if (ammoModEnabled && !enabled) restoreAmmo();
    ammoModEnabled = enabled;
    updateHUD();
  }

  function setPhysics(enabled) {
    enabled = !!enabled;
    if (physicsModEnabled && !enabled) restorePhysics();
    physicsModEnabled = enabled;
    updateHUD();
  }

  function setRapidFire(enabled) {
    enabled = !!enabled;
    if (rapidFireEnabled && !enabled) restoreFireRates();
    rapidFireEnabled = enabled;
    updateHUD();
  }

  function toggleAmmoMod() {
    setAmmo(!ammoModEnabled);
    console.log('[Crazy Shooters Mod] Infinite Ammo:', ammoModEnabled ? 'ENABLED' : 'DISABLED');
  }

  function togglePhysicsMod() {
    setPhysics(!physicsModEnabled);
    console.log('[Crazy Shooters Mod] Physics Boost:', physicsModEnabled ? 'ENABLED' : 'DISABLED');
  }

  function toggleRapidFire() {
    setRapidFire(!rapidFireEnabled);
    console.log('[Crazy Shooters Mod] Rapid Fire Rate:', rapidFireEnabled ? 'ENABLED (+33%)' : 'DISABLED (VANILLA)');
  }

  function toggleAllMods() {
    const newState = !(ammoModEnabled || physicsModEnabled || rapidFireEnabled);
    setAmmo(newState);
    setPhysics(newState);
    setRapidFire(newState);
    console.log('[Crazy Shooters Mod] Master Toggle:', newState ? 'ALL ENABLED' : 'ALL DISABLED');
  }

  window.addEventListener('keydown', function(e) {
    if (e.repeat) return;
    if (e.key === 'F6' || e.code === 'F6') {
      e.preventDefault();
      toggleAmmoMod();
    } else if (e.key === 'F7' || e.code === 'F7') {
      e.preventDefault();
      togglePhysicsMod();
    } else if (e.key === 'F8' || e.code === 'F8') {
      e.preventDefault();
      toggleAllMods();
    } else if (e.key === 'F9' || e.code === 'F9') {
      e.preventDefault();
      toggleRapidFire();
    }
  });

  // Tactical AI Bridge: Player State & Health Manipulation
  // The network rotation fields are not updated for the local player. Resolve
  // Unity's existing Transform getters from validated IL2CPP metadata instead,
  // so the AI overlay tracks the actual camera when the mouse moves. These
  // calling conventions are specific to the checked-in Unity 2017 asm.js build.
  function unityObjectClass(mod, pointer, expectedName, limit) {
    const heap = mod.HEAP32, bytes = mod.HEAPU8;
    if (!bytes || !Number.isInteger(pointer) || pointer <= 0 || pointer % 4 || pointer / 4 + 2 >= limit) return 0;
    const p = pointer / 4, klass = heap[p];
    if (klass <= 0 || klass % 4 || klass / 4 + 39 >= limit || heap[p + 2] <= 0 || heap[p + 2] >= limit * 4) return 0;
    const k = klass / 4;
    if (heap[k + 6] !== klass || heap[k + 7] !== klass ||
        !window.CrazyShootersHeapScanner.stringEquals(bytes, heap[k + 2], expectedName) ||
        !window.CrazyShootersHeapScanner.stringEquals(bytes, heap[k + 3], 'UnityEngine')) return 0;
    return klass;
  }

  function unityMethod(mod, klass, name, limit) {
    const heap = mod.HEAP32, bytes = mod.HEAPU8, k = klass / 4;
    const table = heap[k + 16], count = heap[k + 39] & 0xffff;
    if (table <= 0 || table % 4 || !count || count > 512 || table / 4 + count > limit) return null;
    for (let i = 0; i < count; i++) {
      const pointer = heap[table / 4 + i];
      if (pointer <= 0 || pointer % 4 || pointer / 4 + 11 >= limit) continue;
      const p = pointer / 4, fn = heap[p];
      if (heap[p + 3] === klass && !(heap[p + 10] & 0x10) && (heap[p + 11] >>> 16) === 0 &&
          fn > 0 && fn < 8192 && window.CrazyShootersHeapScanner.stringEquals(bytes, heap[p + 2], name)) {
        return { pointer, fn };
      }
    }
    return null;
  }

  function readCameraRotation(mod, controller, limit) {
    if (failedCameraModule === mod || typeof mod.dynCall_iii !== 'function' || typeof mod.dynCall_viii !== 'function' || typeof mod._malloc !== 'function') return null;
    const heap = mod.HEAP32, bodyTransform = heap[controller + 29], camera = heap[controller + 6];
    const transformClass = unityObjectClass(mod, bodyTransform, 'Transform', limit);
    if (!transformClass) return null;
    const objectClass = unityObjectClass(mod, camera, 'GameObject', limit);
    if (!cameraAccessor || cameraAccessor.mod !== mod || cameraAccessor.transformClass !== transformClass || cameraAccessor.objectClass !== objectClass) {
      const getRotation = unityMethod(mod, transformClass, 'get_rotation', limit);
      const getTransform = objectClass ? unityMethod(mod, objectClass, 'get_transform', limit) : null;
      if (!getRotation) return null;
      // Keep one native scratch buffer per module; no allocations per frame.
      const scratch = cameraAccessor && cameraAccessor.mod === mod ? cameraAccessor.scratch : mod._malloc(16);
      if (!scratch || scratch % 4 || scratch + 16 > heap.byteLength) return null;
      cameraAccessor = { mod, transformClass, objectClass, getRotation, getTransform, scratch, camera: 0, transform: 0 };
    }
    let transform = bodyTransform;
    if (objectClass && cameraAccessor.getTransform) {
      if (cameraAccessor.camera !== camera ||
          unityObjectClass(mod, cameraAccessor.transform, 'Transform', limit) !== transformClass) {
        cameraAccessor.camera = camera;
        cameraAccessor.transform = mod.dynCall_iii(cameraAccessor.getTransform.fn, camera, cameraAccessor.getTransform.pointer);
      }
      if (unityObjectClass(mod, cameraAccessor.transform, 'Transform', limit) === transformClass) transform = cameraAccessor.transform;
    }
    mod.dynCall_viii(cameraAccessor.getRotation.fn, cameraAccessor.scratch, transform, cameraAccessor.getRotation.pointer);
    const f = mod.HEAPF32, p = cameraAccessor.scratch / 4;
    const x = f[p], y = f[p + 1], z = f[p + 2], w = f[p + 3];
    const length = Math.hypot(x, y, z, w);
    return Number.isFinite(length) && length > 0.5 && length < 1.5
      ? [x / length, y / length, z / length, w / length] : null;
  }

  function getPlayerState() {
    const mod = getModule();
    if (!mod || !mod.HEAP32 || !mod.HEAPF32) return null;
    const heap32 = mod.HEAP32;
    const heapF32 = mod.HEAPF32;
    const limit = window.CrazyShootersHeapScanner.allocatedWords(mod);
    if (!limit) return null;

    let pos = null;
    let rot = [0, 0, 0, 1];
    let localDamagePtr = 0;
    let playerController = 0;

    // Prefer the controller belonging to the local Photon player. The heap
    // can also contain remote players, prefabs and recently destroyed objects.
    for (let i = 0; i < instancePtrs.pnc.length; i++) {
      const p = instancePtrs.pnc[i];
      if (isLive(typesByInstance.pnc, mod, p, limit) && heap32[p + 28] === 1) {
        const damagePtr = heap32[p + 22];
        if (damagePtr > 0 && damagePtr % 4 === 0 &&
            isLive(typesByInstance.damage, mod, damagePtr / 4, limit)) localDamagePtr = damagePtr;
        const rx = heapF32[p + 32], ry = heapF32[p + 33];
        const rz = heapF32[p + 34], rw = heapF32[p + 35];
        const length = Math.hypot(rx, ry, rz, rw);
        if (Number.isFinite(length) && length > 0.01 && length < 2) {
          rot = [rx / length, ry / length, rz / length, rw / length];
        }
        break;
      }
    }

    let fallback = null;
    for (let i = 0; i < instancePtrs.fpsCtrl.length; i++) {
      const p = instancePtrs.fpsCtrl[i];
      if (!isLive(typesByInstance.fpsCtrl, mod, p, limit)) continue;
      const damagePtr = heap32[p + 31];
      if (damagePtr <= 0 || damagePtr % 4 || !isLive(typesByInstance.damage, mod, damagePtr / 4, limit) ||
          (localDamagePtr && damagePtr !== localDamagePtr)) continue;
      const x = heapF32[p + 36], y = heapF32[p + 37], z = heapF32[p + 38];
      // Different maps/spawns can be well above y=60. Only reject clearly
      // invalid/uninitialized coordinates, not legitimate map locations.
      if (![x, y, z].every(value => Number.isFinite(value) && Math.abs(value) < 100000) ||
          (x === 0 && y === 0 && z === 0)) continue;
      const candidate = { x, y, z };
      if (localDamagePtr && heap32[p + 31] === localDamagePtr) {
        pos = candidate;
        playerController = p;
        break;
      }
      if (!fallback) fallback = { pos: candidate, controller: p };
    }
    if (!pos && fallback) { pos = fallback.pos; playerController = fallback.controller; }
    if (!pos) return null;
    try { rot = readCameraRotation(mod, playerController, limit) || rot; } catch (err) {
      // An unavailable getter should not take down the mod or AI overlay.
      cameraAccessor = null;
      failedCameraModule = mod; // do not retry a failed native call every frame
      console.warn('[Crazy Shooters Mod] Camera rotation unavailable:', err);
    }
    return { pos, rot };
  }

  function applyDamageToPlayer(amount = 15) {
    const mod = getModule();
    if (!mod || !mod.HEAP32 || !mod.HEAPF32) return false;
    const heap32 = mod.HEAP32;
    const heapF32 = mod.HEAPF32;
    const limit = window.CrazyShootersHeapScanner.allocatedWords(mod);
    if (!limit || !Number.isFinite(amount) || amount <= 0) return false;

    // Direct hit via local PNC -> PlayerDamage pointer
    for (let i = 0; i < instancePtrs.pnc.length; i++) {
      const p = instancePtrs.pnc[i];
      if (isLive(typesByInstance.pnc, mod, p, limit) && heap32[p + 28] === 1) {
        const pdmgPtr = heap32[p + 22]; // offset +88
        if (pdmgPtr > 0 && pdmgPtr % 4 === 0) {
          const pdmgIdx = pdmgPtr / 4;
          if (isLive(typesByInstance.damage, mod, pdmgIdx, limit)) {
            const currentHp = heapF32[pdmgIdx + 11]; // float at +44
            if (currentHp > 0) {
              const newHp = Math.max(0, currentHp - amount);
              heapF32[pdmgIdx + 11] = newHp;
              heapF32[pdmgIdx + 19] = 0.85; // Blood screen vignette flash
              console.log(`[Crazy Shooters Mod] Bot hit player: ${currentHp.toFixed(0)} -> ${newHp.toFixed(0)} HP`);
              return true;
            }
          }
        }
      }
    }

    // Fallback: search instancePtrs.damage
    for (let i = 0; i < instancePtrs.damage.length; i++) {
      const p = instancePtrs.damage[i];
      if (isLive(typesByInstance.damage, mod, p, limit)) {
        const currentHp = heapF32[p + 11];
        if (currentHp > 0 && currentHp <= 100.0) {
          const newHp = Math.max(0, currentHp - amount);
          heapF32[p + 11] = newHp;
          heapF32[p + 19] = 0.85;
          console.log(`[Crazy Shooters Mod] Player damage applied: ${currentHp.toFixed(0)} -> ${newHp.toFixed(0)} HP`);
          return true;
        }
      }
    }
    return false;
  }

  // Global Developer & Automation API
  window.CrazyShootersMod = {
    toggleAmmo: toggleAmmoMod,
    togglePhysics: togglePhysicsMod,
    toggleRapidFire: toggleRapidFire,
    toggleAll: toggleAllMods,
    setAmmo: setAmmo,
    setPhysics: setPhysics,
    setRapidFire: setRapidFire,

    isAmmoEnabled: () => ammoModEnabled,
    isPhysicsEnabled: () => physicsModEnabled,
    isRapidFireEnabled: () => rapidFireEnabled,

    getPlayerState: getPlayerState,
    applyDamageToPlayer: applyDamageToPlayer,
    getClassPointer: (name) => cachedKlasses[name] || null,
    getScanStats: () => scanner.getStats(),
    getInstancePointers: () => Object.fromEntries(Object.entries(instancePtrs).map(([key, list]) => [key, list.slice()])),

    getConfig: () => ({
      fireRateIntervalMult: FIRE_RATE_INTERVAL_MULT,
      physics: { ...PHYSICS_CONFIG }
    }),
    getInstances: () => ({
      mg: instancePtrs.mg.length,
      sg: instancePtrs.sg.length,
      gl: instancePtrs.gl.length,
      knife: instancePtrs.knife.length,
      mov: instancePtrs.mov.length,
      jmp: instancePtrs.jmp.length,
      fpsCtrl: instancePtrs.fpsCtrl.length,
      pnc: instancePtrs.pnc.length,
      damage: instancePtrs.damage.length,
      rmm: instancePtrs.rmm.length
    }),
    getBaselines: () => ({
      mgCount: baselineFireRates.mg.size,
      sgCount: baselineFireRates.sg.size,
      glCount: baselineFireRates.gl.size
    })
  };

  // Start incremental discovery and the lightweight per-frame mod updates.
  setTimeout(scanTick, 250);
  requestAnimationFrame(onFrame);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createHUD);
  } else {
    createHUD();
  }

  console.log('[Crazy Shooters Mod] Ultimate Mod Engine v4 Initialized: Ammo [F6] | Physics [F7] | All [F8] | Rapid Fire [F9]');
})();
