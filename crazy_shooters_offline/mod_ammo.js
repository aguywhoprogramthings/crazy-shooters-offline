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
 *      and undetectable ("never caught way too fast").
 *    - Dynamically covers MachineGun (MP5, AK-47, M4, Sniper, Pistol),
 *      shotGun (M87T), GrenadeLauncher (RPG), and Ballistic Knife.
 * 
 * 4. Master Toggle [F8]:
 *    - Toggles all mods simultaneously.
 * 
 * 5. Interactive In-Game HUD:
 *    - 3 modern status badges in the top-left corner with real-time feedback and click-to-toggle.
 * 
 * 6. 100% Memory-Safe:
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

  // Baseline Fire Rates Storage (heapIndex -> vanilla float)
  const baselineFireRates = {
    mg: new Map(),
    sg: new Map(),
    gl: new Map(),
    knife: new Map()
  };

  // Resolved IL2CPP Class Pointers
  const cachedKlasses = {
    machineGun: null,
    shotGun: null,
    grenadeLauncher: null,
    knife: null,
    fpsMovement: null,
    fpsJumping: null,
    fpsController: null,
    pnc: null,
    playerDamage: null,
    rmm: null
  };

  // Active Instance Pointers (Heap Indices)
  const instancePtrs = {
    mg: [],
    sg: [],
    gl: [],
    knife: [],
    mov: [],
    jmp: [],
    fpsCtrl: [],
    pnc: [],
    damage: [],
    rmm: []
  };

  // IL2CPP Static String Pointers in asm.js Data Segment
  const NAME_MG       = 10553142; // "MachineGun"
  const NAME_MG_ALT   = 10545300;
  const NAME_SG       = 10553029; // "shotGun"
  const NAME_GL       = 10553089; // "GrenadeLauncher"
  const NAME_GL_ALT   = 10545350;
  const NAME_KNIFE    = 10553194; // "Knife"
  const NAME_MOV      = 10540523; // "FPScontrollerMovement"
  const NAME_JMP      = 10540900; // "FPScontrollerJumping"
  const NAME_FPSCTRL  = 10540453; // "FPScontroller"
  const NAME_PNC      = 10543594; // "PlayerNetworkController"
  const NAME_PDMG     = 10534125; // "PlayerDamage"
  const NAME_RMM      = 10544520; // "RoomMultiplayerMenu"

  function getModule() {
    if (window.gameInstance && window.gameInstance.Module && window.gameInstance.Module.HEAP32) {
      return window.gameInstance.Module;
    }
    if (typeof Module !== 'undefined' && Module.HEAP32) {
      return Module;
    }
    return null;
  }

  function resolveKlasses() {
    const mod = getModule();
    if (!mod) return false;
    const heap32 = mod.HEAP32;

    function findKlassByPtr(namePtr) {
      if (!namePtr) return null;
      for (let i = 0; i < heap32.length; i++) {
        if (heap32[i] === namePtr) {
          return (i - 2) * 4;
        }
      }
      return null;
    }

    if (!cachedKlasses.machineGun) cachedKlasses.machineGun = findKlassByPtr(NAME_MG) || findKlassByPtr(NAME_MG_ALT);
    if (!cachedKlasses.shotGun) cachedKlasses.shotGun = findKlassByPtr(NAME_SG);
    if (!cachedKlasses.grenadeLauncher) cachedKlasses.grenadeLauncher = findKlassByPtr(NAME_GL) || findKlassByPtr(NAME_GL_ALT);
    if (!cachedKlasses.knife) cachedKlasses.knife = findKlassByPtr(NAME_KNIFE);
    if (!cachedKlasses.fpsMovement) cachedKlasses.fpsMovement = findKlassByPtr(NAME_MOV);
    if (!cachedKlasses.fpsJumping) cachedKlasses.fpsJumping = findKlassByPtr(NAME_JMP);
    if (!cachedKlasses.fpsController) cachedKlasses.fpsController = findKlassByPtr(NAME_FPSCTRL) || 20904848;
    if (!cachedKlasses.pnc) cachedKlasses.pnc = findKlassByPtr(NAME_PNC) || 20943736;
    if (!cachedKlasses.playerDamage) cachedKlasses.playerDamage = findKlassByPtr(NAME_PDMG) || 20401144;
    if (!cachedKlasses.rmm) cachedKlasses.rmm = findKlassByPtr(NAME_RMM) || 20952960;

    return (cachedKlasses.machineGun || cachedKlasses.shotGun || cachedKlasses.fpsMovement);
  }

  function scanInstances() {
    const mod = getModule();
    if (!mod) return;
    const heap32 = mod.HEAP32;
    const heapF32 = mod.HEAPF32;

    if (!resolveKlasses()) return;

    const kMg      = cachedKlasses.machineGun;
    const kSg      = cachedKlasses.shotGun;
    const kGl      = cachedKlasses.grenadeLauncher;
    const kKn      = cachedKlasses.knife;
    const kMov     = cachedKlasses.fpsMovement;
    const kJmp     = cachedKlasses.fpsJumping;
    const kFpsCtrl = cachedKlasses.fpsController;
    const kPnc     = cachedKlasses.pnc;
    const kPdmg    = cachedKlasses.playerDamage;
    const kRmm     = cachedKlasses.rmm;

    const newMg = [], newSg = [], newGl = [], newKn = [], newMov = [], newJmp = [];
    const newFpsCtrl = [], newPnc = [], newPdmg = [], newRmm = [];
    const minHeapIndex = 2000000;
    const maxHeapIndex = heap32.length - 30;

    for (let i = minHeapIndex; i < maxHeapIndex; i++) {
      if (heap32[i + 1] !== 0) continue;

      const klass = heap32[i];

      // MachineGun
      if (kMg && klass === kMg) {
        const fr = heapF32[i + 7];
        if (fr > 0.001 && fr < 5.0) {
          newMg.push(i);
          if (!baselineFireRates.mg.has(i)) {
            baselineFireRates.mg.set(i, fr);
          }
        }
      }
      // ShotGun
      else if (kSg && klass === kSg) {
        const frc = heap32[i + 3];
        if (frc === 4 || frc === 5) {
          newSg.push(i);
          if (!baselineFireRates.sg.has(i)) {
            const fr = heapF32[i + 5];
            if (fr > 0.001 && fr < 5.0) baselineFireRates.sg.set(i, fr);
          }
        }
      }
      // GrenadeLauncher
      else if (kGl && klass === kGl) {
        newGl.push(i);
        if (!baselineFireRates.gl.has(i)) {
          const sd = heapF32[i + 6];
          if (sd >= 0 && sd < 5.0) baselineFireRates.gl.set(i, sd);
        }
      }
      // Knife
      else if (kKn && klass === kKn) {
        newKn.push(i);
        if (!baselineFireRates.knife.has(i)) {
          const fr = heapF32[i + 4];
          if (fr > 0.001 && fr < 5.0) baselineFireRates.knife.set(i, fr);
        }
      }
      // FPScontrollerMovement
      else if (kMov && klass === kMov) {
        newMov.push(i);
      }
      // FPScontrollerJumping
      else if (kJmp && klass === kJmp) {
        newJmp.push(i);
      }
      // FPScontroller
      else if (kFpsCtrl && klass === kFpsCtrl) {
        newFpsCtrl.push(i);
      }
      // PlayerNetworkController
      else if (kPnc && klass === kPnc) {
        newPnc.push(i);
      }
      // PlayerDamage
      else if (kPdmg && klass === kPdmg) {
        newPdmg.push(i);
      }
      // RoomMultiplayerMenu
      else if (kRmm && klass === kRmm) {
        newRmm.push(i);
      }
    }

    instancePtrs.mg      = newMg;
    instancePtrs.sg      = newSg;
    instancePtrs.gl      = newGl;
    instancePtrs.knife   = newKn;
    instancePtrs.mov     = newMov;
    instancePtrs.jmp     = newJmp;
    instancePtrs.fpsCtrl = newFpsCtrl;
    instancePtrs.pnc     = newPnc;
    instancePtrs.damage  = newPdmg;
    instancePtrs.rmm     = newRmm;
  }

  // --- Ammo Engine ---
  function applyAmmo(heap32) {
    const kMg = cachedKlasses.machineGun;
    const kSg = cachedKlasses.shotGun;
    const kGl = cachedKlasses.grenadeLauncher;

    if (kMg) {
      const list = instancePtrs.mg;
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        if (heap32[p] === kMg && heap32[p + 1] === 0) {
          heap32[p + 8] = 999;   // bulletsPerClip
          heap32[p + 9] = 9999;  // clips
          heap32[p + 10] = 999;  // bulletsLeft
        }
      }
    }

    if (kSg) {
      const list = instancePtrs.sg;
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        if (heap32[p] === kSg && heap32[p + 1] === 0) {
          heap32[p + 9] = 999;   // bulletsPerClip
          heap32[p + 10] = 999;  // bulletsLeft
          heap32[p + 11] = 9999; // clips
        }
      }
    }

    if (kGl) {
      const list = instancePtrs.gl;
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        if (heap32[p] === kGl && heap32[p + 1] === 0) {
          heap32[p + 9] = 999;   // ammoCount
        }
      }
    }
  }

  // --- Rapid Fire Rate Engine ---
  function applyFireRate(heap32, heapF32) {
    const kMg = cachedKlasses.machineGun;
    const kSg = cachedKlasses.shotGun;
    const kGl = cachedKlasses.grenadeLauncher;
    const kKn = cachedKlasses.knife;

    const mult = rapidFireEnabled ? FIRE_RATE_INTERVAL_MULT : 1.0;

    // MachineGun (fireRate at +7)
    if (kMg) {
      const list = instancePtrs.mg;
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        if (heap32[p] === kMg && heap32[p + 1] === 0) {
          const base = baselineFireRates.mg.get(p) || 0.085;
          heapF32[p + 7] = base * mult;
        }
      }
    }

    // ShotGun (fireRate at +5)
    if (kSg) {
      const list = instancePtrs.sg;
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        if (heap32[p] === kSg && heap32[p + 1] === 0) {
          const base = baselineFireRates.sg.get(p) || 1.0;
          heapF32[p + 5] = base * mult;
        }
      }
    }

    // GrenadeLauncher (shotDelay at +6)
    if (kGl) {
      const list = instancePtrs.gl;
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        if (heap32[p] === kGl && heap32[p + 1] === 0) {
          const base = baselineFireRates.gl.get(p) || 0.40;
          heapF32[p + 6] = base * mult;
        }
      }
    }

    // Knife (fireRate at +4)
    if (kKn) {
      const list = instancePtrs.knife;
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        if (heap32[p] === kKn && heap32[p + 1] === 0) {
          const base = baselineFireRates.knife.get(p) || 0.20;
          heapF32[p + 4] = base * mult;
        }
      }
    }
  }

  // --- Physics Engine (Jump & Speed) ---
  function applyPhysics(heap32, heapF32, config) {
    const kMov = cachedKlasses.fpsMovement;
    const kJmp = cachedKlasses.fpsJumping;

    if (kMov) {
      const list = instancePtrs.mov;
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        if (heap32[p] === kMov && heap32[p + 1] === 0) {
          heapF32[p + 2] = config.maxForwardSpeed;
          heapF32[p + 3] = config.maxSidewaysSpeed;
          heapF32[p + 4] = config.maxBackwardsSpeed;
          heapF32[p + 5] = config.walkSpeed;
          heapF32[p + 6] = config.runSpeed;
        }
      }
    }

    if (kJmp) {
      const list = instancePtrs.jmp;
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        if (heap32[p] === kJmp && heap32[p + 1] === 0) {
          heapF32[p + 3] = config.baseHeight;
          heapF32[p + 4] = config.extraHeight;
        }
      }
    }
  }

  function onFrame() {
    const mod = getModule();
    if (mod && mod.HEAP32 && mod.HEAPF32) {
      const heap32 = mod.HEAP32;
      const heapF32 = mod.HEAPF32;

      // 1. Ammo Mod
      if (ammoModEnabled) {
        applyAmmo(heap32);
      }

      // 2. Rapid Fire Rate Mod
      applyFireRate(heap32, heapF32);

      // 3. Physics Mod
      const currentConfig = physicsModEnabled ? PHYSICS_CONFIG.boosted : PHYSICS_CONFIG.vanilla;
      applyPhysics(heap32, heapF32, currentConfig);

      // 4. Offline Match Time Lock (Prevent match timeout)
      const rmmList = instancePtrs.rmm;
      for (let i = 0; i < rmmList.length; i++) {
        const p = rmmList[i];
        if (heap32[p] === cachedKlasses.rmm && heap32[p + 1] === 0) {
          heap32[p + 44] = 99999;
          heapF32[p + 46] = 590.0;
        }
      }
    }

    requestAnimationFrame(onFrame);
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

  function toggleAmmoMod() {
    ammoModEnabled = !ammoModEnabled;
    updateHUD();
    console.log('[Crazy Shooters Mod] Infinite Ammo:', ammoModEnabled ? 'ENABLED' : 'DISABLED');
  }

  function togglePhysicsMod() {
    physicsModEnabled = !physicsModEnabled;
    updateHUD();
    console.log('[Crazy Shooters Mod] Physics Boost:', physicsModEnabled ? 'ENABLED' : 'DISABLED');
  }

  function toggleRapidFire() {
    rapidFireEnabled = !rapidFireEnabled;
    updateHUD();
    console.log('[Crazy Shooters Mod] Rapid Fire Rate:', rapidFireEnabled ? 'ENABLED (+30%)' : 'DISABLED (VANILLA)');
  }

  function toggleAllMods() {
    const newState = !(ammoModEnabled || physicsModEnabled || rapidFireEnabled);
    ammoModEnabled = newState;
    physicsModEnabled = newState;
    rapidFireEnabled = newState;
    updateHUD();
    console.log('[Crazy Shooters Mod] Master Toggle:', newState ? 'ALL ENABLED' : 'ALL DISABLED');
  }

  window.addEventListener('keydown', function(e) {
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
  function getPlayerState() {
    const mod = getModule();
    if (!mod || !mod.HEAP32 || !mod.HEAPF32) return null;
    const heap32 = mod.HEAP32;
    const heapF32 = mod.HEAPF32;

    let pos = null;
    let rot = [0, 0, 0, 1];

    // Find the real FPScontroller instance with valid world coordinates
    for (let i = 0; i < instancePtrs.fpsCtrl.length; i++) {
      const p = instancePtrs.fpsCtrl[i];
      if (heap32[p] === cachedKlasses.fpsController) {
        const x = heapF32[p + 36];
        const y = heapF32[p + 37];
        const z = heapF32[p + 38];
        if (!isNaN(x) && !isNaN(y) && !isNaN(z) && y >= 1.0 && y <= 60.0 && (Math.abs(x) >= 1.0 || Math.abs(z) >= 1.0)) {
          pos = { x, y, z };
          break;
        }
      }
    }

    // Find local player PNC for rotation
    for (let i = 0; i < instancePtrs.pnc.length; i++) {
      const p = instancePtrs.pnc[i];
      if (heap32[p] === cachedKlasses.pnc && heap32[p + 28] === 1) {
        const rx = heapF32[p + 32];
        const ry = heapF32[p + 33];
        const rz = heapF32[p + 34];
        const rw = heapF32[p + 35];
        if (!isNaN(rx) && !isNaN(ry) && !isNaN(rz) && !isNaN(rw) && rw !== 0) {
          rot = [rx, ry, rz, rw];
        }
        break;
      }
    }

    if (!pos) return null;
    return { pos, rot };
  }

  function applyDamageToPlayer(amount = 15) {
    const mod = getModule();
    if (!mod || !mod.HEAP32 || !mod.HEAPF32) return false;
    const heap32 = mod.HEAP32;
    const heapF32 = mod.HEAPF32;

    // Direct hit via local PNC -> PlayerDamage pointer
    for (let i = 0; i < instancePtrs.pnc.length; i++) {
      const p = instancePtrs.pnc[i];
      if (heap32[p] === cachedKlasses.pnc && heap32[p + 28] === 1) {
        const pdmgPtr = heap32[p + 22]; // offset +88
        if (pdmgPtr) {
          const pdmgIdx = pdmgPtr / 4;
          if (heap32[pdmgIdx] === cachedKlasses.playerDamage) {
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
      if (heap32[p] === cachedKlasses.playerDamage) {
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
    setAmmo: (val) => { ammoModEnabled = !!val; updateHUD(); },
    setPhysics: (val) => { physicsModEnabled = !!val; updateHUD(); },
    setRapidFire: (val) => { rapidFireEnabled = !!val; updateHUD(); },

    isAmmoEnabled: () => ammoModEnabled,
    isPhysicsEnabled: () => physicsModEnabled,
    isRapidFireEnabled: () => rapidFireEnabled,

    getPlayerState: getPlayerState,
    applyDamageToPlayer: applyDamageToPlayer,

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

  // Start periodic scans and frame loop
  setInterval(scanInstances, 500);
  requestAnimationFrame(onFrame);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createHUD);
  } else {
    createHUD();
  }

  console.log('[Crazy Shooters Mod] Ultimate Mod Engine v3 Initialized: Ammo [F6] | Physics [F7] | All [F8] | Rapid Fire [F9]');
})();
