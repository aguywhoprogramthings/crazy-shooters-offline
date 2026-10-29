# 🎮 Crazy Shooters - Offline Standalone Edition

A 100% offline, DRM-free, ad-free standalone playable package of **Crazy Shooters** (Unity WebGL).

---

## 🚀 Quick Start (1-Click Launchers)

### Method A: Windows Batch Launcher (Easiest)
Double-click:
📂 **`start_game.bat`**

### Method B: PowerShell Launcher
Right-click and select **Run with PowerShell**:
📂 **`start_game.ps1`**

*Both launchers automatically boot the local streaming server in the background and launch Google Chrome or your default web browser directly in dedicated application mode (`--app=http://127.0.0.1:8088/index.html`).*

---

## 💻 Manual Launch

If you prefer launching via command line:

```powershell
# Using Node.js:
node server.js

# Or using Python 3:
python server.py
```

Then open your browser to **`http://127.0.0.1:8088/index.html`**.

---

## 🕹️ Controls & Gameplay

- **WASD / Arrow Keys**: Move
- **Mouse**: Look around
- **Left Click**: Fire / Attack
- **Right Click**: Aim down sights
- **R**: Reload
- **Space**: Jump
- **C**: Crouch
- **Shift**: Sprint
- **1 - 9**: Switch weapons (`BallisticKnife`, `Deagle`, `MP5KA4`, `STW-25`, `M87T`, `Blaser R93`, `RPG`, `M79`, `M67`)
- **[F6]**: **Toggle Infinite Ammo & No Reload**
- **[F7]**: **Toggle Enhanced Physics (Jump +85% & Speed +30%)**
- **[F9]**: **Toggle Rapid Fire Rate (+30% Fire Speed)**
- **[F8]**: **Master Toggle (All Mods On / Off)**
- **Tab / Esc**: Scoreboard / Options

---

## ⚡ Built-in Ultimate Mod Engine (v3.0)

The game includes an integrated, zero-latency reverse-engineered trainer (`mod_ammo.js`):

### 1. Infinite Ammo & No Reload (`[F6]`)
- **Infinite Ammo**: Magazine capacity is locked at **999** bullets and reserve clips at **9999** for all weapons (MachineGun, ShotGun, GrenadeLauncher/RPG, Sniper).
- **No Reload Needed**: The clip never empties, eliminating reloads entirely for continuous uninterrupted fire.
- **Toggle**: Press **`[F6]`** or click the green badge to toggle between Modded and Vanilla ammo.

### 2. Enhanced Physics: Jump & Speed Boost (`[F7]`)
- **Jump Boost (+85%)**: `baseHeight` tuned from `1.0m` to `1.85m`. Allows effortlessly vaulting onto crates, metal shipping containers, barriers, and low roofs that are completely unreachable in vanilla settings.
- **Controllable Physics**: Gravity remains at the standard tight $20.0\text{ m/s}^2$, ensuring snappy ascent/descent with zero floatiness or loss of aim control.
- **Speed Boost (+30%)**:
  - `WalkSpeed`: Boosted from `8.0` to `10.5` (+31%).
  - `RunSpeed` (Sprint): Boosted from `11.5` to `15.0` (+30%).
  - `maxForwardSpeed`, `maxSidewaysSpeed`, `maxBackwardsSpeed`: Boosted from `10.0` to `14.0` (+40%).
- **Toggle**: Press **`[F7]`** or click the blue badge to instantly toggle between Boosted and Vanilla physics.

### 3. Rapid Fire Rate (+30% Fire Speed) (`[F9]`)
- **Natural & Anti-Detection Fire Rate**: Multiplies weapon shot delay / firing interval by **`0.75x`** (+33% Rounds Per Minute).
- **Authentic Audio & Animation**: Avoids extreme or glitchy fire rates so that gun firing audio, muzzle flash, and recoil animations retain authentic fidelity and cannot be spotted as an obvious cheat ("never caught way too fast").
- **Universal Coverage**: Dynamically accelerates MachineGun (MP5, AK-47, M4, Sniper, Pistol), ShotGun (M87T), GrenadeLauncher (RPG), and Ballistic Knife.
- **Toggle**: Press **`[F9]`** or click the orange badge to toggle between Rapid and Vanilla fire rates.

### 4. Master Toggle (`[F8]`)
- Press **`[F8]`** to instantly toggle all 3 mods simultaneously.

### 5. Dynamic IL2CPP Memory Engine
- Dynamically resolves `MachineGun`, `shotGun`, `GrenadeLauncher`, `Knife`, `FPScontrollerMovement`, and `FPScontrollerJumping` classes and heap instances directly in WebGL asm.js memory.
- Automatically caches vanilla baseline parameters and cleanly restores them when toggled off.
- Executes inside `requestAnimationFrame` with **< 0.02ms** overhead (rock solid 60+ FPS).
- Re-applies across player respawns, map reloads, and weapon switching.

---

## 🛠️ Reverse Engineering & Modifications

1. **Unity Engine Version**: Unity 2017.1.3f1 WebGL (asm.js).
2. **Sitelock Bypass**: The game originally enforced domain checks (`GDValidDomain.CheckValid`) requiring `gamedistribution.com`, `freezenova.com`, etc. The package features:
   - Binary-level patch in `game.data.unityweb` mapping `freezenova.com` to `127.0.0.1:8088`.
   - JavaScript `document.URL` & `document.documentURI` property virtualization in `index.html`.
3. **Offline Mock SDK (`gdsdk_mock.js`)**: All GameDistribution ad networks, OneTrust cookie modals, tracking pixels, and video prerolls are replaced with zero-latency instant offline callbacks.
4. **Local HTTP Servers (`server.js` & `server.py`)**: Automatic `Content-Encoding: gzip` streaming for `.unityweb` packages, plus Cross-Origin Isolation headers (`COOP`/`COEP`).
5. **Trainer Engine (`mod_ammo.js`)**: Real-time IL2CPP WebGL Emscripten heap inspection targeting `MachineGun`, `shotGun`, and `GrenadeLauncher` instances.

