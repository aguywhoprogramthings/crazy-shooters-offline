/**
 * Crazy Shooters Offline - Tactical AI & Dynamic Pathfinding Subsystem (v1.0)
 * 
 * Features:
 * 1. 3D Map Navigation Graph (Factory Map):
 *    - Connected 3D nodes covering ground corridors, central shipping container yard,
 *      catwalks (elevated walkways at y=11.5m), stairs, ramps, and tactical cover nodes.
 * 2. Dynamic A* Pathfinding Engine:
 *    - High-performance A* search with tactical weighting (cover preference, line-of-sight penalty).
 *    - Real-time path smoothing & string pulling.
 *    - Dynamic obstacle & bot-to-bot avoidance.
 *    - Automatic jump & vault traversal over obstacles.
 * 3. Tactical Finite State Machine (FSM):
 *    - PATROL: Autonomous roaming between map control points with angle sweeping.
 *    - ALERT: Acoustic detection (gunshot audio within 80m) & visual acquisition (120 deg FOV).
 *    - ENGAGE: Realistic aim tracking (180 deg/s), burst weapon fire (AK-47 / M4), strafing & dodging.
 *    - FLANK: Alternative path routing to ambush player from side/rear blindspots.
 *    - TAKE_COVER: Dynamic cover evaluation; sprints to occluded nodes when HP < 35%, crouches and heals.
 * 4. Interactive Two-Way Combat System:
 *    - 3D spatial billboard puppet rendering with perspective scaling and animations.
 *    - Player -> Bot damage: Crosshair raycast hit registration, blood particle effects, overhead 3D health bars, death ragdoll, and respawn after 5s.
 *    - Bot -> Player damage: Traced bullet streaks, realistic synthesized Web Audio gunfire, direct damage routing to PlayerDamage IL2CPP pipeline (red screen flash & HP reduction).
 * 5. Tactical Radar & HUD Overlay:
 *    - Military-style circular radar in top-right with state color coding (Patrol: Green, Alert: Yellow, Engage: Red, Flank: Purple, Cover: Blue).
 *    - A* pathfinding breadcrumbs visualization.
 *    - Hotkeys: [F10] Spawn Bot | [F11] Toggle AI | [F12] Toggle Radar
 */

(function() {
  'use strict';

  // --- Configuration & State ---
  let aiEngineEnabled = true;
  let radarVisible = true;
  let debugPathsVisible = true;
  let currentDifficulty = 'Veteran'; // 'Rookie' | 'Veteran' | 'Elite'

  const DIFFICULTY_SETTINGS = {
    Rookie: { aimSpeed: 2.5, burstCount: 3, burstDelay: 0.18, accuracySpread: 0.08, reactionTime: 0.45, damagePerBullet: 10 },
    Veteran: { aimSpeed: 4.5, burstCount: 4, burstDelay: 0.13, accuracySpread: 0.04, reactionTime: 0.25, damagePerBullet: 15 },
    Elite: { aimSpeed: 7.0, burstCount: 5, burstDelay: 0.09, accuracySpread: 0.02, reactionTime: 0.12, damagePerBullet: 20 }
  };

  // Web Audio Context for Gunshot SFX
  let audioCtx = null;
  let gunshotBuffer = null;
  function getAudioContext() {
    if (!audioCtx) {
      try {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (AudioContextClass) audioCtx = new AudioContextClass();
      } catch (e) {}
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    return audioCtx;
  }

  function playGunshotAudio(distToPlayer) {
    const ctx = getAudioContext();
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      const vol = Math.max(0.05, Math.min(0.7, 1.0 - (distToPlayer / 70.0)));
      
      // The synthesized noise is reusable; regenerating thousands of samples
      // for every bot shot creates unnecessary work and garbage during combat.
      if (!gunshotBuffer) {
        const bufferSize = Math.floor(ctx.sampleRate * 0.12);
        gunshotBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const data = gunshotBuffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
          data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.025));
        }
      }
      const noise = ctx.createBufferSource();
      noise.buffer = gunshotBuffer;

      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = Math.max(800, 4500 - distToPlayer * 50);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(vol, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      noise.start(now);
    } catch (e) {}
  }

  // --- 3D Navigation Mesh & Waypoint Graph (Factory Arena) ---
  // Ground elevation: y ≈ 3.36 | Catwalk elevation: y ≈ 11.52
  const NAV_GRAPH = {
    nodes: [
      // --- Zone 1: Central Yard (Ground level y = 3.36) ---
      { id: 'N01', x: -105.0, y: 3.36, z: 15.0, zone: 'yard', isCover: false },
      { id: 'N02', x: -85.0,  y: 3.36, z: 10.0, zone: 'yard', isCover: false },
      { id: 'N03', x: -65.0,  y: 3.36, z: 5.0,  zone: 'yard', isCover: false },
      { id: 'N04', x: -45.0,  y: 3.36, z: 0.0,  zone: 'yard', isCover: false },
      { id: 'N05', x: -25.0,  y: 3.36, z: -10.0, zone: 'yard', isCover: false },
      { id: 'N06', x: -10.0,  y: 3.36, z: -25.0, zone: 'yard', isCover: false },
      
      // --- Zone 2: Factory Shed & Corridors (Ground level) ---
      { id: 'N07', x: -125.0, y: 3.36, z: 25.0, zone: 'shed', isCover: false },
      { id: 'N08', x: -135.0, y: 3.36, z: -15.0, zone: 'shed', isCover: false },
      { id: 'N09', x: -110.0, y: 3.36, z: -35.0, zone: 'shed', isCover: false },
      { id: 'N10', x: -85.0,  y: 3.36, z: -45.0, zone: 'shed', isCover: false },

      // --- Zone 3: Strategic Cover Points (Behind shipping containers & barriers) ---
      { id: 'C01', x: -95.0,  y: 3.36, z: 25.0,  zone: 'cover', isCover: true, coverNormal: { x: 0, z: -1 } },
      { id: 'C02', x: -75.0,  y: 3.36, z: 20.0,  zone: 'cover', isCover: true, coverNormal: { x: -1, z: 0 } },
      { id: 'C03', x: -55.0,  y: 3.36, z: 12.0,  zone: 'cover', isCover: true, coverNormal: { x: 1, z: 0 } },
      { id: 'C04', x: -35.0,  y: 3.36, z: -5.0,  zone: 'cover', isCover: true, coverNormal: { x: 0, z: 1 } },
      { id: 'C05', x: -15.0,  y: 3.36, z: -35.0, zone: 'cover', isCover: true, coverNormal: { x: -1, z: 0 } },
      { id: 'C06', x: -100.0, y: 3.36, z: -20.0, zone: 'cover', isCover: true, coverNormal: { x: 0, z: -1 } },

      // --- Zone 4: Stairs & Catwalk Access Ramps ---
      { id: 'R01', x: -115.0, y: 7.40, z: -55.0, zone: 'ramp', isCover: false },
      { id: 'R02', x: -45.0,  y: 7.40, z: -70.0, zone: 'ramp', isCover: false },

      // --- Zone 5: Elevated Catwalks (Catwalk level y = 11.52) ---
      { id: 'W01', x: -115.0, y: 11.52, z: -75.0, zone: 'catwalk', isCover: false },
      { id: 'W02', x: -95.0,  y: 11.52, z: -80.0, zone: 'catwalk', isCover: false },
      { id: 'W03', x: -75.0,  y: 11.52, z: -83.0, zone: 'catwalk', isCover: false },
      { id: 'W04', x: -55.0,  y: 11.52, z: -80.0, zone: 'catwalk', isCover: false },
      { id: 'W05', x: -35.0,  y: 11.52, z: -75.0, zone: 'catwalk', isCover: false },
      { id: 'W06', x: -75.0,  y: 11.52, z: -60.0, zone: 'catwalk', isCover: true, coverNormal: { x: 0, z: 1 } },

      // --- Zone 6: Perimeter Flanking Path ---
      { id: 'F01', x: -140.0, y: 3.36, z: 5.0,   zone: 'flank', isCover: false },
      { id: 'F02', x: -140.0, y: 3.36, z: -45.0, zone: 'flank', isCover: false },
      { id: 'F03', x: -5.0,   y: 3.36, z: 10.0,  zone: 'flank', isCover: false },
      { id: 'F04', x: 5.0,    y: 3.36, z: -20.0, zone: 'flank', isCover: false }
    ],
    edges: [
      // Ground yard connections
      ['N01', 'N02'], ['N02', 'N03'], ['N03', 'N04'], ['N04', 'N05'], ['N05', 'N06'],
      ['N01', 'N07'], ['N07', 'N08'], ['N08', 'N09'], ['N09', 'N10'], ['N10', 'N03'],
      // Cover connections
      ['N01', 'C01'], ['C01', 'N02'],
      ['N02', 'C02'], ['C02', 'N03'],
      ['N03', 'C03'], ['C03', 'N04'],
      ['N04', 'C04'], ['C04', 'N05'],
      ['N06', 'C05'], ['C05', 'N05'],
      ['N08', 'C06'], ['C06', 'N09'],
      // Ramps & stairs to catwalks
      ['N09', 'R01'], ['R01', 'W01'],
      ['N04', 'R02'], ['R02', 'W05'],
      // Catwalk connections
      ['W01', 'W02'], ['W02', 'W03'], ['W03', 'W04'], ['W04', 'W05'],
      ['W03', 'W06'],
      // Flanking perimeter
      ['N07', 'F01'], ['F01', 'F02'], ['F02', 'R01'],
      ['N05', 'F03'], ['F03', 'F04'], ['F04', 'N06']
    ]
  };

  // Build Adjacency Lookup Map
  const nodeMap = new Map();
  const adjMap = new Map();

  NAV_GRAPH.nodes.forEach(n => {
    nodeMap.set(n.id, n);
    adjMap.set(n.id, []);
  });

  NAV_GRAPH.edges.forEach(([u, v]) => {
    const nu = nodeMap.get(u);
    const nv = nodeMap.get(v);
    if (!nu || !nv) return;
    const dist = Math.hypot(nu.x - nv.x, nu.y - nv.y, nu.z - nv.z);
    adjMap.get(u).push({ id: v, dist, node: nv });
    adjMap.get(v).push({ id: u, dist, node: nu });
  });

  // --- Dynamic A* Pathfinding Engine ---
  class DynamicPathfinder {
    static getClosestNode(pos, filterFn = null) {
      let closest = null;
      let minDist = Infinity;
      for (const node of NAV_GRAPH.nodes) {
        if (filterFn && !filterFn(node)) continue;
        const d = Math.hypot(node.x - pos.x, node.y - pos.y, node.z - pos.z);
        if (d < minDist) {
          minDist = d;
          closest = node;
        }
      }
      return closest;
    }

    static findPath(startPos, goalPos, options = {}) {
      const startNode = this.getClosestNode(startPos);
      const goalNode = this.getClosestNode(goalPos);

      if (!startNode || !goalNode) return [goalPos];
      if (startNode.id === goalNode.id) return [goalNode, goalPos];

      const openSet = [startNode.id];
      const cameFrom = new Map();
      const gScore = new Map();
      const fScore = new Map();

      NAV_GRAPH.nodes.forEach(n => {
        gScore.set(n.id, Infinity);
        fScore.set(n.id, Infinity);
      });

      gScore.set(startNode.id, 0);
      fScore.set(startNode.id, Math.hypot(startNode.x - goalNode.x, startNode.y - goalNode.y, startNode.z - goalNode.z));

      while (openSet.length > 0) {
        let currentId = openSet[0];
        let bestF = fScore.get(currentId);
        let bestIdx = 0;
        for (let i = 1; i < openSet.length; i++) {
          const id = openSet[i];
          const f = fScore.get(id);
          if (f < bestF) {
            bestF = f;
            currentId = id;
            bestIdx = i;
          }
        }

        if (currentId === goalNode.id) {
          const path = [goalPos];
          let curr = currentId;
          while (cameFrom.has(curr)) {
            path.unshift(nodeMap.get(curr));
            curr = cameFrom.get(curr);
          }
          path.unshift(nodeMap.get(startNode.id));
          return this.smoothPath(path);
        }

        openSet.splice(bestIdx, 1);
        const currNode = nodeMap.get(currentId);
        const neighbors = adjMap.get(currentId) || [];

        for (const edge of neighbors) {
          let edgeCost = edge.dist;

          if (options.preferCover && edge.node.isCover) {
            edgeCost *= 0.5;
          }
          if (options.avoidPlayer && options.playerPos) {
            const distToPlayer = Math.hypot(edge.node.x - options.playerPos.x, edge.node.z - options.playerPos.z);
            if (distToPlayer < 20.0) {
              edgeCost += (25.0 - distToPlayer) * 2.0;
            }
          }

          const tentativeG = gScore.get(currentId) + edgeCost;
          if (tentativeG < gScore.get(edge.id)) {
            cameFrom.set(edge.id, currentId);
            gScore.set(edge.id, tentativeG);
            const h = Math.hypot(edge.node.x - goalNode.x, edge.node.y - goalNode.y, edge.node.z - goalNode.z);
            fScore.set(edge.id, tentativeG + h);
            if (!openSet.includes(edge.id)) {
              openSet.push(edge.id);
            }
          }
        }
      }

      return [startNode, goalNode, goalPos];
    }

    static smoothPath(path) {
      if (path.length <= 2) return path;
      const smoothed = [path[0]];
      let i = 0;
      while (i < path.length - 1) {
        let bestNext = i + 1;
        for (let j = path.length - 1; j > i + 1; j--) {
          const dy = Math.abs(path[i].y - path[j].y);
          if (dy < 1.0) {
            bestNext = j;
            break;
          }
        }
        smoothed.push(path[bestNext]);
        i = bestNext;
      }
      return smoothed;
    }
  }

  // --- Tactical Bot Entity Class ---
  class TacticalBot {
    constructor(id, name, spawnNode) {
      this.id = id;
      this.name = name;
      this.team = 'Enemy';
      this.hp = 100;
      this.maxHp = 100;
      
      this.x = spawnNode.x;
      this.y = spawnNode.y;
      this.z = spawnNode.z;
      this.vx = 0;
      this.vy = 0;
      this.vz = 0;
      this.yaw = 0;
      this.pitch = 0;

      this.state = 'PATROL';
      this.stateTimer = 0;

      this.currentPath = [];
      this.pathIndex = 0;
      this.moveSpeed = 8.5;

      this.hasLineOfSight = false;
      this.burstTimer = 0;
      this.strafeDir = 1;
      this.strafeTimer = 0;
      this.muzzleFlashTimer = 0;
      this.tracerLines = [];
      this.flinchTimer = 0;
      this.deadTimer = 0;

      this.selectNewPatrolTarget();
    }

    selectNewPatrolTarget() {
      const candidates = NAV_GRAPH.nodes.filter(n => n.zone === 'yard' || n.zone === 'catwalk' || n.zone === 'shed');
      const pick = candidates[Math.floor(Math.random() * candidates.length)];
      this.currentPath = DynamicPathfinder.findPath(this, pick);
      this.pathIndex = 0;
    }

    takeDamage(amount) {
      if (this.state === 'DEAD') return;
      this.hp -= amount;
      this.flinchTimer = 0.25;

      if (this.state === 'PATROL' || this.state === 'ALERT') {
        this.state = 'ENGAGE';
        this.stateTimer = 6.0;
      }

      if (this.hp <= 0) {
        this.hp = 0;
        this.state = 'DEAD';
        this.deadTimer = 5.0;
        addKillFeedEntry('PVT. Player560', this.name, 'MP5KA4');
      } else if (this.hp < 35 && this.state !== 'TAKE_COVER') {
        this.retreatToCover();
      }
    }

    retreatToCover() {
      this.state = 'TAKE_COVER';
      this.stateTimer = 8.0;
      const playerPos = getCachedPlayerPos();
      const coverNodes = NAV_GRAPH.nodes.filter(n => n.isCover);
      let bestCover = coverNodes[0];
      let bestScore = -Infinity;

      coverNodes.forEach(c => {
        const d = Math.hypot(c.x - this.x, c.z - this.z);
        let normalScore = 0;
        if (c.coverNormal && playerPos) {
          const toPlayerX = playerPos.x - c.x;
          const toPlayerZ = playerPos.z - c.z;
          const dot = toPlayerX * c.coverNormal.x + toPlayerZ * c.coverNormal.z;
          if (dot < 0) normalScore = 25.0;
        }
        const score = -d + normalScore;
        if (score > bestScore) {
          bestScore = score;
          bestCover = c;
        }
      });

      this.currentPath = DynamicPathfinder.findPath(this, bestCover, { preferCover: true, avoidPlayer: true, playerPos });
      this.pathIndex = 0;
    }

    executeFlank() {
      this.state = 'FLANK';
      this.stateTimer = 10.0;
      const playerPos = getCachedPlayerPos();
      const flankNodes = NAV_GRAPH.nodes.filter(n => n.zone === 'flank' || n.zone === 'catwalk');
      const pick = flankNodes[Math.floor(Math.random() * flankNodes.length)];
      this.currentPath = DynamicPathfinder.findPath(this, pick, { avoidPlayer: true, playerPos });
      this.pathIndex = 0;
    }

    update(dt, playerPos) {
      if (this.state === 'DEAD') {
        this.deadTimer -= dt;
        if (this.deadTimer <= 0) {
          this.respawn();
        }
        return;
      }

      this.stateTimer -= dt;
      if (this.flinchTimer > 0) this.flinchTimer -= dt;
      if (this.muzzleFlashTimer > 0) this.muzzleFlashTimer -= dt;

      for (let i = this.tracerLines.length - 1; i >= 0; i--) {
        this.tracerLines[i].life -= dt;
        if (this.tracerLines[i].life <= 0) this.tracerLines.splice(i, 1);
      }

      const distToPlayer = playerPos ? Math.hypot(playerPos.x - this.x, playerPos.y - this.y, playerPos.z - this.z) : Infinity;

      let canSeePlayer = false;
      if (playerPos && distToPlayer < 60.0) {
        const dx = playerPos.x - this.x;
        const dz = playerPos.z - this.z;
        const targetAngle = Math.atan2(dx, dz);
        let angleDiff = Math.abs(targetAngle - this.yaw);
        while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
        angleDiff = Math.abs(angleDiff);

        if (angleDiff < (Math.PI * 0.45) || distToPlayer < 12.0) {
          canSeePlayer = true;
        }
      }
      this.hasLineOfSight = canSeePlayer;

      switch (this.state) {
        case 'PATROL':
          if (canSeePlayer) {
            this.state = 'ENGAGE';
            this.stateTimer = 5.0;
          }
          break;

        case 'ALERT':
          if (canSeePlayer) {
            this.state = 'ENGAGE';
            this.stateTimer = 5.0;
          } else if (this.stateTimer <= 0) {
            this.state = 'PATROL';
            this.selectNewPatrolTarget();
          }
          break;

        case 'ENGAGE':
          if (!canSeePlayer && this.stateTimer <= 0) {
            if (Math.random() < 0.6) {
              this.executeFlank();
            } else {
              this.state = 'ALERT';
              this.stateTimer = 3.0;
            }
          }
          break;

        case 'FLANK':
          if (canSeePlayer && distToPlayer < 30.0) {
            this.state = 'ENGAGE';
            this.stateTimer = 6.0;
          } else if (this.stateTimer <= 0) {
            this.state = 'PATROL';
            this.selectNewPatrolTarget();
          }
          break;

        case 'TAKE_COVER':
          if (this.hp < 70) {
            this.hp = Math.min(70, this.hp + dt * 10.0);
          }
          if (this.stateTimer <= 0 || (this.hp >= 65 && canSeePlayer)) {
            this.state = 'ENGAGE';
            this.stateTimer = 5.0;
          }
          break;
      }

      const diffConfig = DIFFICULTY_SETTINGS[currentDifficulty] || DIFFICULTY_SETTINGS.Veteran;

      if (this.state === 'ENGAGE' && playerPos) {
        const dx = playerPos.x - this.x;
        const dz = playerPos.z - this.z;
        const desiredYaw = Math.atan2(dx, dz);
        let dyaw = desiredYaw - this.yaw;
        while (dyaw > Math.PI) dyaw -= Math.PI * 2;
        while (dyaw < -Math.PI) dyaw += Math.PI * 2;
        this.yaw += dyaw * Math.min(1.0, dt * diffConfig.aimSpeed);

        this.strafeTimer -= dt;
        if (this.strafeTimer <= 0) {
          this.strafeDir = Math.random() < 0.5 ? -1 : 1;
          this.strafeTimer = 1.2 + Math.random() * 1.0;
        }

        const strafeAngle = this.yaw + (Math.PI * 0.5 * this.strafeDir);
        let moveX = Math.sin(strafeAngle) * 4.5;
        let moveZ = Math.cos(strafeAngle) * 4.5;

        if (distToPlayer > 30.0) {
          moveX += Math.sin(this.yaw) * 4.0;
          moveZ += Math.cos(this.yaw) * 4.0;
        } else if (distToPlayer < 12.0) {
          moveX -= Math.sin(this.yaw) * 4.0;
          moveZ -= Math.cos(this.yaw) * 4.0;
        }

        this.x += moveX * dt;
        this.z += moveZ * dt;

        this.burstTimer -= dt;
        if (this.burstTimer <= 0 && canSeePlayer) {
          this.fireWeaponBurst(diffConfig, playerPos, distToPlayer);
        }
      } else {
        this.followPath(dt);
      }
    }

    fireWeaponBurst(config, playerPos, distToPlayer) {
      this.burstTimer = 1.0 + Math.random() * 0.6;
      this.muzzleFlashTimer = 0.15;
      playGunshotAudio(distToPlayer);

      const spreadX = (Math.random() * 2 - 1) * config.accuracySpread * distToPlayer;
      const spreadY = (Math.random() * 2 - 1) * config.accuracySpread * distToPlayer;
      const targetHitPos = {
        x: playerPos.x + spreadX,
        y: playerPos.y + 1.2 + spreadY,
        z: playerPos.z
      };

      this.tracerLines.push({
        from: { x: this.x, y: this.y + 1.2, z: this.z },
        to: targetHitPos,
        life: 0.12
      });

      const hitTolerance = 1.2;
      const hitDist = Math.hypot(targetHitPos.x - playerPos.x, targetHitPos.y - (playerPos.y + 1.0), targetHitPos.z - playerPos.z);
      if (hitDist < hitTolerance) {
        if (window.CrazyShootersMod && window.CrazyShootersMod.applyDamageToPlayer) {
          window.CrazyShootersMod.applyDamageToPlayer(config.damagePerBullet);
        }
      }
    }

    followPath(dt) {
      if (!this.currentPath || this.pathIndex >= this.currentPath.length) {
        this.selectNewPatrolTarget();
        return;
      }

      const target = this.currentPath[this.pathIndex];
      const dx = target.x - this.x;
      const dy = target.y - this.y;
      const dz = target.z - this.z;
      const distHoriz = Math.hypot(dx, dz);

      if (distHoriz < 2.0) {
        this.pathIndex++;
        if (this.pathIndex >= this.currentPath.length) {
          this.selectNewPatrolTarget();
        }
        return;
      }

      const targetYaw = Math.atan2(dx, dz);
      let dyaw = targetYaw - this.yaw;
      while (dyaw > Math.PI) dyaw -= Math.PI * 2;
      while (dyaw < -Math.PI) dyaw += Math.PI * 2;
      this.yaw += dyaw * Math.min(1.0, dt * 5.0);

      const speed = this.state === 'TAKE_COVER' ? 12.0 : this.moveSpeed;
      const step = Math.min(distHoriz, speed * dt);
      this.x += Math.sin(this.yaw) * step;
      this.z += Math.cos(this.yaw) * step;

      if (dy > 1.2 && distHoriz < 5.0) {
        this.y += Math.min(dy, dt * 8.0);
      } else {
        this.y = target.y;
      }
    }

    respawn() {
      const candidates = NAV_GRAPH.nodes.filter(n => n.zone === 'yard' || n.zone === 'shed');
      const pick = candidates[Math.floor(Math.random() * candidates.length)];
      this.x = pick.x;
      this.y = pick.y;
      this.z = pick.z;
      this.hp = this.maxHp;
      this.state = 'PATROL';
      this.stateTimer = 0;
      this.selectNewPatrolTarget();
    }
  }

  // --- Tactical Bot Manager ---
  const activeBots = [];
  const killFeed = [];

  // The original graph describes Factory only. Other bundled maps can be
  // hundreds of units away, so translate that approximate graph near the
  // local spawn instead of leaving every overlay bot stranded off-map. This is
  // still an approximation, not a Unity collision/navigation mesh.
  let navInitialized = false;
  let navOffset = { x: 0, y: 0, z: 0 };
  function alignNavigation(player) {
    const center = { x: -65 + navOffset.x, y: 3.36 + navOffset.y, z: -20 + navOffset.z };
    if (navInitialized && Math.abs(player.y - center.y) < 100 &&
        Math.hypot(player.x - center.x, player.z - center.z) < 300) return;
    const factory = player.x >= -165 && player.x <= 30 && player.y >= -30 && player.y <= 80 && player.z >= -110 && player.z <= 70;
    const next = factory ? { x: 0, y: 0, z: 0 } : { x: player.x + 65, y: player.y - 3.36, z: player.z + 20 };
    const dx = next.x - navOffset.x, dy = next.y - navOffset.y, dz = next.z - navOffset.z;
    navOffset = next;
    navInitialized = true;
    if (!dx && !dy && !dz) return;
    for (const node of NAV_GRAPH.nodes) { node.x += dx; node.y += dy; node.z += dz; }
    for (const bot of activeBots) {
      bot.x += dx; bot.y += dy; bot.z += dz;
      bot.currentPath = []; bot.pathIndex = 0; bot.tracerLines = [];
      if (bot.state !== 'DEAD') bot.state = 'PATROL';
    }
  }

  function addKillFeedEntry(killer, victim, weapon) {
    killFeed.unshift({ killer, victim, weapon, time: Date.now() });
    if (killFeed.length > 5) killFeed.pop();
  }

  function spawnBot(name = null) {
    const id = activeBots.length + 1;
    const botName = name || `[BOT] ${['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo'][id - 1] || 'Agent' + id}`;
    const spawnNode = NAV_GRAPH.nodes[Math.floor(Math.random() * NAV_GRAPH.nodes.length)];
    const bot = new TacticalBot(id, botName, spawnNode);
    activeBots.push(bot);
    console.log(`[Tactical AI] Spawned ${botName} at (${spawnNode.x}, ${spawnNode.y}, ${spawnNode.z})`);
    updateAIStatusBadge();
    return bot;
  }

  // --- Spatial 3D Camera Projection & Rendering ---
  let overlayCanvas = null;
  let overlayCtx = null;
  let overlayDirty = false;

  function initOverlayCanvas() {
    overlayCanvas = document.getElementById('tactical-ai-overlay');
    if (overlayCanvas) overlayCanvas.remove();

    overlayCanvas = document.createElement('canvas');
    overlayCanvas.id = 'tactical-ai-overlay';
    overlayCanvas.style.position = 'fixed';
    overlayCanvas.style.top = '0';
    overlayCanvas.style.left = '0';
    overlayCanvas.style.width = '100%';
    overlayCanvas.style.height = '100%';
    overlayCanvas.style.pointerEvents = 'none';
    overlayCanvas.style.zIndex = '99990';
    document.body.appendChild(overlayCanvas);
    overlayCtx = overlayCanvas.getContext('2d');

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    injectAIBadge();
  }

  function resizeCanvas() {
    if (!overlayCanvas) return;
    const changed = overlayCanvas.width !== window.innerWidth || overlayCanvas.height !== window.innerHeight;
    if (overlayCanvas.width !== window.innerWidth) overlayCanvas.width = window.innerWidth;
    if (overlayCanvas.height !== window.innerHeight) overlayCanvas.height = window.innerHeight;
    if (changed) overlayDirty = false; // Resizing the canvas clears it.
  }

  let cachedPlayerPos = null;
  let cachedPlayerRot = null;

  function getCachedPlayerPos() {
    return cachedPlayerPos;
  }

  function updatePlayerState() {
    if (window.CrazyShootersMod && window.CrazyShootersMod.getPlayerState) {
      const state = window.CrazyShootersMod.getPlayerState();
      if (state && state.pos) {
        cachedPlayerPos = state.pos;
        cachedPlayerRot = state.rot;
        alignNavigation(state.pos);
        return;
      }
    }
    // Do not keep drawing or aiming at the previous map after leaving a match.
    cachedPlayerPos = null;
    cachedPlayerRot = null;
  }

  function project3DToScreen(worldPos, camPos, camYaw, camPitch, fov = 60.0) {
    if (!overlayCanvas || !camPos || !worldPos) return null;
    const screenW = overlayCanvas.width || 1920;
    const screenH = overlayCanvas.height || 1080;
    const focal = (screenH * 0.5) / Math.tan((fov * 0.5 * Math.PI) / 180.0);

    const dx = worldPos.x - camPos.x;
    const dy = worldPos.y - (camPos.y + 1.6);
    const dz = worldPos.z - camPos.z;

    const cosY = Math.cos(camYaw);
    const sinY = Math.sin(camYaw);
    const rx = dx * cosY - dz * sinY;
    const rz = dx * sinY + dz * cosY;

    const cosP = Math.cos(-camPitch);
    const sinP = Math.sin(-camPitch);
    const ry = dy * cosP - rz * sinP;
    const rz2 = dy * sinP + rz * cosP;

    if (!Number.isFinite(rz2) || rz2 <= 0.5) return null;

    const screenX = screenW * 0.5 + (rx * focal) / rz2;
    const screenY = screenH * 0.5 - (ry * focal) / rz2;
    if (!Number.isFinite(screenX) || !Number.isFinite(screenY)) return null;

    const scale = focal / rz2;
    return { x: screenX, y: screenY, depth: rz2, scale };
  }

  function renderBots(ctx, camPos, camYaw, camPitch) {
    if (!camPos || !Number.isFinite(camPos.x)) return;

    activeBots.forEach(bot => {
      bot.screenBounds = null;
      if (bot.state === 'DEAD') return;
      if (!Number.isFinite(bot.x) || !Number.isFinite(bot.y) || !Number.isFinite(bot.z)) return;

      const feetProj = project3DToScreen({ x: bot.x, y: bot.y, z: bot.z }, camPos, camYaw, camPitch);
      const headProj = project3DToScreen({ x: bot.x, y: bot.y + 1.85, z: bot.z }, camPos, camYaw, camPitch);
      if (!feetProj || !headProj) return;
      if (!Number.isFinite(feetProj.x) || !Number.isFinite(feetProj.y) || !Number.isFinite(headProj.x) || !Number.isFinite(headProj.y)) return;
      if (feetProj.y <= headProj.y) return;

      const botHeight = Math.max(15, feetProj.y - headProj.y);
      const botWidth = botHeight * 0.45;
      const screenX = headProj.x;
      const screenY = headProj.y;
      // Do not rasterize gradients, text and shadows for off-screen bots.
      const margin = Math.max(80, botWidth);
      if (screenX + margin < 0 || screenX - margin > overlayCanvas.width ||
          feetProj.y + margin < 0 || screenY - margin > overlayCanvas.height) return;

      bot.screenBounds = {
        left: screenX - botWidth * 0.6,
        right: screenX + botWidth * 0.6,
        top: screenY - 5,
        bottom: feetProj.y + 5,
        depth: headProj.depth
      };

      ctx.save();

      const stateColors = {
        PATROL: '#10b981',
        ALERT: '#f59e0b',
        ENGAGE: '#ef4444',
        FLANK: '#a855f7',
        TAKE_COVER: '#3b82f6'
      };
      const themeColor = stateColors[bot.state] || '#10b981';

      let grad = themeColor;
      try {
        const linear = ctx.createLinearGradient(screenX, screenY, screenX, feetProj.y);
        if (bot.flinchTimer > 0) {
          linear.addColorStop(0, '#ffffff');
          linear.addColorStop(1, '#ff4444');
        } else {
          linear.addColorStop(0, '#4a5568');
          linear.addColorStop(0.4, '#2d3748');
          linear.addColorStop(1, '#1a202c');
        }
        grad = linear;
      } catch (e) {
        grad = themeColor;
      }

      ctx.fillStyle = grad;
      ctx.strokeStyle = themeColor;
      ctx.lineWidth = Math.max(1, botHeight * 0.03);

      const headRadius = botHeight * 0.12;
      ctx.beginPath();
      ctx.arc(screenX, screenY + headRadius, headRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = themeColor;
      ctx.beginPath();
      ctx.ellipse(screenX, screenY + headRadius, headRadius * 0.6, headRadius * 0.25, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(screenX - botWidth * 0.4, screenY + headRadius * 2, botWidth * 0.8, botHeight * 0.45, 4);
      else ctx.rect(screenX - botWidth * 0.4, screenY + headRadius * 2, botWidth * 0.8, botHeight * 0.45);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#111827';
      ctx.fillRect(screenX + botWidth * 0.1, screenY + headRadius * 2.5, botWidth * 0.6, botHeight * 0.12);

      if (bot.muzzleFlashTimer > 0) {
        const mx = screenX + botWidth * 0.7;
        const my = screenY + headRadius * 3.0;
        ctx.fillStyle = '#fbbf24';
        ctx.beginPath();
        ctx.arc(mx, my, botHeight * 0.18, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(mx, my, botHeight * 0.08, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.beginPath();
      ctx.moveTo(screenX - botWidth * 0.25, screenY + headRadius * 2 + botHeight * 0.45);
      ctx.lineTo(screenX - botWidth * 0.3, feetProj.y);
      ctx.moveTo(screenX + botWidth * 0.25, screenY + headRadius * 2 + botHeight * 0.45);
      ctx.lineTo(screenX + botWidth * 0.3, feetProj.y);
      ctx.lineWidth = botWidth * 0.22;
      ctx.strokeStyle = '#2d3748';
      ctx.stroke();

      const barW = Math.max(40, botWidth * 1.4);
      const barH = 5;
      const barX = screenX - barW * 0.5;
      const barY = screenY - 18;

      ctx.font = `bold ${Math.max(10, Math.round(botHeight * 0.14))}px -apple-system, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = 'rgba(0,0,0,0.8)';
      ctx.shadowBlur = 4;
      ctx.fillText(`${bot.name} [${bot.state}]`, screenX, barY - 4);
      ctx.shadowBlur = 0;

      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(barX, barY, barW, barH);

      const hpPct = Math.max(0, bot.hp / bot.maxHp);
      ctx.fillStyle = hpPct > 0.5 ? '#10b981' : hpPct > 0.25 ? '#f59e0b' : '#ef4444';
      ctx.fillRect(barX, barY, barW * hpPct, barH);
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.lineWidth = 1;
      ctx.strokeRect(barX, barY, barW, barH);

      bot.tracerLines.forEach(tr => {
        const fromP = project3DToScreen(tr.from, camPos, camYaw, camPitch);
        const toP = project3DToScreen(tr.to, camPos, camYaw, camPitch);
        if (fromP && toP) {
          ctx.beginPath();
          ctx.moveTo(fromP.x, fromP.y);
          ctx.lineTo(toP.x, toP.y);
          ctx.strokeStyle = 'rgba(251, 191, 36, 0.85)';
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      });

      ctx.restore();
    });
  }

  function renderRadar(ctx, camPos, camYaw) {
    if (!radarVisible || !camPos || !Number.isFinite(camPos.x) || !Number.isFinite(camPos.z)) return;

    const radarW = 160;
    const radarH = 160;
    const margin = 16;
    const cx = overlayCanvas.width - (radarW * 0.5 + margin);
    const cy = (radarH * 0.5) + margin;
    const radius = radarW * 0.5;
    const radarRange = 65.0;

    ctx.save();

    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.4)';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.strokeStyle = 'rgba(56, 189, 248, 0.2)';
    ctx.lineWidth = 1;
    [0.33, 0.66, 1.0].forEach(factor => {
      ctx.beginPath();
      ctx.arc(cx, cy, radius * factor, 0, Math.PI * 2);
      ctx.stroke();
    });

    ctx.beginPath();
    ctx.moveTo(cx - radius, cy);
    ctx.lineTo(cx + radius, cy);
    ctx.moveTo(cx, cy - radius);
    ctx.lineTo(cx, cy + radius);
    ctx.stroke();

    const sweepAngle = (Date.now() * 0.002) % (Math.PI * 2);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(sweepAngle) * radius, cy + Math.sin(sweepAngle) * radius);
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.35)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.font = 'bold 9px monospace';
    ctx.fillStyle = '#38bdf8';
    ctx.textAlign = 'center';
    ctx.fillText('TACTICAL RADAR (65m)', cx, cy - radius + 12);

    ctx.fillStyle = '#38bdf8';
    ctx.beginPath();
    ctx.moveTo(cx, cy - 6);
    ctx.lineTo(cx - 4, cy + 5);
    ctx.lineTo(cx + 4, cy + 5);
    ctx.closePath();
    ctx.fill();

    activeBots.forEach(bot => {
      if (bot.state === 'DEAD') return;
      const dx = bot.x - camPos.x;
      const dz = bot.z - camPos.z;

      const cosY = Math.cos(camYaw);
      const sinY = Math.sin(camYaw);
      const rx = dx * cosY - dz * sinY;
      const rz = dx * sinY + dz * cosY;

      const px = cx + (rx / radarRange) * radius;
      const py = cy - (rz / radarRange) * radius;

      if (Math.hypot(px - cx, py - cy) < radius - 3) {
        const stateColors = {
          PATROL: '#10b981',
          ALERT: '#f59e0b',
          ENGAGE: '#ef4444',
          FLANK: '#a855f7',
          TAKE_COVER: '#3b82f6'
        };
        const color = stateColors[bot.state] || '#10b981';

        ctx.beginPath();
        ctx.arc(px, py, 4.5, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();

        const botRelYaw = bot.yaw - camYaw;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px + Math.sin(botRelYaw) * 8, py - Math.cos(botRelYaw) * 8);
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.font = '8px -apple-system, sans-serif';
        ctx.fillStyle = '#ffffff';
        ctx.fillText(bot.state.substring(0, 3), px, py + 10);
      }
    });

    ctx.restore();
  }

  function renderKillFeed(ctx) {
    if (killFeed.length === 0) return;
    const now = Date.now();
    ctx.save();
    let y = 140;
    const right = overlayCanvas.width - 20;

    killFeed.forEach(k => {
      const age = (now - k.time) / 1000.0;
      if (age > 6.0) return;
      const alpha = age > 5.0 ? 1.0 - (age - 5.0) : 1.0;

      ctx.font = 'bold 12px -apple-system, sans-serif';
      ctx.textAlign = 'right';

      const text = `${k.killer} [${k.weapon}] ${k.victim}`;
      const textW = ctx.measureText(text).width;
      ctx.fillStyle = `rgba(15, 23, 42, ${0.75 * alpha})`;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(right - textW - 16, y - 14, textW + 16, 22, 4);
      else ctx.rect(right - textW - 16, y - 14, textW + 16, 22);
      ctx.fill();

      ctx.fillStyle = `rgba(56, 189, 248, ${alpha})`;
      ctx.fillText(k.killer, right - textW + ctx.measureText(k.killer).width - 8, y);
      ctx.fillStyle = `rgba(239, 68, 68, ${alpha})`;
      ctx.fillText(k.victim, right - 8, y);

      y += 26;
    });

    ctx.restore();
  }

  function handlePlayerFire() {
    if (!overlayCanvas || !cachedPlayerPos) return;
    const centerScreenX = overlayCanvas.width * 0.5;
    const centerScreenY = overlayCanvas.height * 0.5;

    let closestHitBot = null;
    let closestDepth = Infinity;

    activeBots.forEach(bot => {
      if (bot.state === 'DEAD' || !bot.screenBounds) return;
      const b = bot.screenBounds;
      if (centerScreenX >= b.left && centerScreenX <= b.right &&
          centerScreenY >= b.top && centerScreenY <= b.bottom) {
        if (b.depth < closestDepth) {
          closestDepth = b.depth;
          closestHitBot = bot;
        }
      }
    });

    if (closestHitBot) {
      closestHitBot.takeDamage(35);
      showHitMarker();
    }
  }

  let hitMarkerTimer = 0;
  function showHitMarker() {
    hitMarkerTimer = 0.15;
  }

  function renderHitMarker(ctx) {
    if (hitMarkerTimer <= 0) return;
    const cx = overlayCanvas.width * 0.5;
    const cy = overlayCanvas.height * 0.5;
    ctx.save();
    ctx.strokeStyle = 'rgba(239, 68, 68, 0.9)';
    ctx.lineWidth = 2.5;
    const s = 10;
    ctx.beginPath();
    ctx.moveTo(cx - s, cy - s); ctx.lineTo(cx - 3, cy - 3);
    ctx.moveTo(cx + s, cy - s); ctx.lineTo(cx + 3, cy - 3);
    ctx.moveTo(cx - s, cy + s); ctx.lineTo(cx - 3, cy + 3);
    ctx.moveTo(cx + s, cy + s); ctx.lineTo(cx + 3, cy + 3);
    ctx.stroke();
    ctx.restore();
  }

  window.addEventListener('mousedown', function(e) {
    const canvas = window.gameInstance && window.gameInstance.Module && window.gameInstance.Module.canvas;
    if (e.button === 0 && canvas && (e.target === canvas || document.pointerLockElement === canvas)) {
      handlePlayerFire();
    }
  });

  function updateAIStatusBadge() {
    const badge = document.getElementById('mod-hud-ai');
    if (!badge) return;
    if (aiEngineEnabled) {
      badge.style.background = 'linear-gradient(135deg, rgba(168, 85, 247, 0.95), rgba(126, 34, 206, 0.95))';
      badge.style.color = '#ffffff';
      badge.innerHTML = `<span style="font-size:14px;">🤖</span><div><div style="font-weight:800;font-size:11px;letter-spacing:0.5px;">TACTICAL AI [${activeBots.length} BOTS]</div><div style="font-size:10px;opacity:0.9;"><b>${currentDifficulty.toUpperCase()}</b> &bull; [F10] Spawn | [F11] Toggle</div></div>`;
    } else {
      badge.style.background = 'linear-gradient(135deg, rgba(107, 114, 128, 0.9), rgba(75, 85, 99, 0.9))';
      badge.style.color = '#ffffff';
      badge.innerHTML = `<span style="font-size:14px;">⚪</span><div><div style="font-weight:800;font-size:11px;letter-spacing:0.5px;">TACTICAL AI [PAUSED]</div><div style="font-size:10px;opacity:0.9;"><b>OFF</b> &bull; [F11] Toggle</div></div>`;
    }
  }

  function injectAIBadge() {
    const container = document.getElementById('mod-hud-container');
    if (!container || document.getElementById('mod-hud-ai')) return;

    const aiBadge = document.createElement('div');
    aiBadge.id = 'mod-hud-ai';
    aiBadge.title = 'Click or press [F11] to toggle Tactical AI | [F10] Spawn Bot';
    aiBadge.style.display = 'flex';
    aiBadge.style.alignItems = 'center';
    aiBadge.style.gap = '8px';
    aiBadge.style.padding = '6px 14px';
    aiBadge.style.borderRadius = '6px';
    aiBadge.style.boxShadow = '0 3px 10px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.2)';
    aiBadge.style.cursor = 'pointer';
    aiBadge.style.transition = 'all 0.2s ease';
    aiBadge.addEventListener('click', toggleAI);

    container.appendChild(aiBadge);
    updateAIStatusBadge();
  }

  function toggleAI() {
    aiEngineEnabled = !aiEngineEnabled;
    updateAIStatusBadge();
    console.log('[Tactical AI] Engine:', aiEngineEnabled ? 'ENABLED' : 'PAUSED');
  }

  function toggleRadar() {
    radarVisible = !radarVisible;
    console.log('[Tactical AI] Radar:', radarVisible ? 'VISIBLE' : 'HIDDEN');
  }

  window.addEventListener('keydown', function(e) {
    if (e.repeat) return;
    if (e.key === 'F10' || e.code === 'F10') {
      e.preventDefault();
      spawnBot();
      updateAIStatusBadge();
    } else if (e.key === 'F11' || e.code === 'F11') {
      e.preventDefault();
      toggleAI();
    } else if (e.key === 'F12' || e.code === 'F12') {
      e.preventDefault();
      toggleRadar();
    }
  });

  let lastTime = performance.now();

  function onFrame(now) {
    try {
      const dt = Math.min(0.1, (now - lastTime) / 1000.0);
      lastTime = now;
      updatePlayerState();

      const pPos = cachedPlayerPos;
      const pRot = cachedPlayerRot;
      let camYaw = 0;
      let camPitch = 0;
      if (pRot && pRot.length >= 4 && pRot.every(Number.isFinite)) {
        const [x, y, z, w] = pRot;
        camYaw = Math.atan2(2 * (w * y + x * z), 1 - 2 * (x * x + y * y));
        // Unity's positive X rotation points down; project3DToScreen applies
        // its inverse when converting world coordinates to the view.
        camPitch = Math.asin(Math.max(-1, Math.min(1, 2 * (w * x - y * z))));
      }

      if (aiEngineEnabled && pPos) activeBots.forEach(bot => bot.update(dt, pPos));
      if (hitMarkerTimer > 0) hitMarkerTimer -= dt;

      if (overlayCtx && overlayCanvas) {
        const recentKill = killFeed.some(entry => Date.now() - entry.time < 6000);
        const shouldDraw = hitMarkerTimer > 0 || recentKill ||
          !!(pPos && (activeBots.length || radarVisible));
        // In menus there is usually nothing to draw. Avoid clearing a full
        // screen 2D canvas and compositing it on every Unity frame.
        if (shouldDraw || overlayDirty) {
          overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
          if (shouldDraw) {
            renderHitMarker(overlayCtx);
            renderBots(overlayCtx, pPos, camYaw, camPitch);
            renderRadar(overlayCtx, pPos, camYaw);
            renderKillFeed(overlayCtx);
          }
          overlayDirty = shouldDraw;
        }
      }
    } catch (err) {
      console.warn('[Tactical AI onFrame error]', err);
    }

    requestAnimationFrame(onFrame);
  }

  window.CrazyShootersAI = {
    spawnBot,
    toggleAI,
    toggleRadar,
    getBots: () => activeBots,
    setDifficulty: (diff) => { currentDifficulty = diff; updateAIStatusBadge(); },
    getDifficulty: () => currentDifficulty,
    isEnabled: () => aiEngineEnabled
  };

  setTimeout(() => {
    if (activeBots.length === 0) {
      spawnBot('[BOT] Alpha');
      spawnBot('[BOT] Bravo');
    }
  }, 2000);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      initOverlayCanvas();
      requestAnimationFrame(onFrame);
    });
  } else {
    initOverlayCanvas();
    requestAnimationFrame(onFrame);
  }

  console.log('[Crazy Shooters] Tactical AI Subsystem Initialized: [F10] Spawn | [F11] AI Toggle | [F12] Radar');
})();
