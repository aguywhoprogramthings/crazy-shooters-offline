/**
 * Incremental IL2CPP heap discovery for the bundled Unity asm.js build.
 *
 * The Unity heap is 256 MB even when only a fraction is allocated. Scanning it
 * synchronously (especially once per missing class) stalls the game. This
 * scanner searches the allocated portion in small, time-budgeted slices and
 * keeps already-discovered objects usable while a new sweep is in progress.
 */
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CrazyShootersHeapScanner = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  function stringEquals(bytes, address, text) {
    if (!Number.isInteger(address) || address <= 0 || address + text.length >= bytes.length) return false;
    for (let i = 0; i < text.length; i++) {
      if (bytes[address + i] !== text.charCodeAt(i)) return false;
    }
    return bytes[address + text.length] === 0;
  }

  // Il2CppClass has its name at +8 and its element/cast classes at +24/+28.
  // Metadata tables also contain name pointers; accepting their first match as
  // a class (as the old scanner did) can cause writes into unrelated memory.
  function isClass(heap, index, nameAddresses) {
    if (!Number.isInteger(index) || index < 0 || index + 7 >= heap.length) return false;
    const pointer = index * 4;
    return heap[index] !== 0 && nameAddresses.indexOf(heap[index + 2]) !== -1 &&
      heap[index + 6] === pointer && heap[index + 7] === pointer;
  }

  function allocatedWords(mod) {
    const heap = mod.HEAP32;
    const args = mod.asmLibraryArg;
    if (args && Number.isInteger(args.DYNAMICTOP_PTR)) {
      const pointer = args.DYNAMICTOP_PTR;
      if (pointer < 0 || pointer % 4 !== 0 || pointer / 4 >= heap.length) return 0;
      const top = heap[pointer / 4] >>> 0;
      const stackMax = Number.isInteger(args.STACK_MAX) ? args.STACK_MAX : 0;
      // A zero/uninitialized or corrupt allocator pointer is not a scan limit.
      if (top < stackMax || top === 0 || top > heap.byteLength) return 0;
      return Math.floor(top / 4);
    }
    // Some Emscripten builds do not export DYNAMICTOP_PTR. Remain correct in
    // that case, but still bound every individual slice of the full heap.
    return heap.length;
  }

  class IncrementalHeapScanner {
    constructor(options) {
      this.types = options.types;
      this.klasses = options.klasses;
      this.instances = options.instances;
      this.onFound = options.onFound || function() {};
      this.onRemoved = options.onRemoved || function() {};
      this.onReset = options.onReset || function() {};
      this.clock = options.clock || function() { return performance.now(); };
      this.chunkWords = options.chunkWords || 32768;
      this.maxChunks = options.maxChunks || 16;
      this.budgetMs = options.budgetMs || 1.5;
      this.intervalMs = options.intervalMs === undefined ? 250 : options.intervalMs;
      this.fallbackStart = options.fallbackStart === undefined ? 2000000 : options.fallbackStart;
      this.module = null;
      this.buffer = null;
      this.sweep = null;
      this.nextSweepAt = 0;
      this.liveSets = {};
      this.stats = { slices: 0, sweeps: 0, maxSliceMs: 0, totalSliceMs: 0, allocatedBytes: 0 };
      for (const type of this.types) {
        if (type.instanceKey) this.liveSets[type.instanceKey] = new Set();
      }
    }

    reset(mod) {
      this.module = mod;
      this.buffer = mod.HEAP32.buffer;
      this.sweep = null;
      this.nextSweepAt = 0;
      for (const type of this.types) {
        this.klasses[type.classKey] = null;
        if (type.instanceKey) {
          this.instances[type.instanceKey] = [];
          this.liveSets[type.instanceKey] = new Set();
        }
      }
      this.onReset();
    }

    beginSweep(mod, limit) {
      const args = mod.asmLibraryArg;
      const stackMax = args && Number.isInteger(args.STACK_MAX) ? args.STACK_MAX : null;
      const start = stackMax !== null && stackMax >= 0 && stackMax / 4 < limit
        ? Math.ceil(stackMax / 4) : Math.min(this.fallbackStart, limit);
      const seen = {}, found = {}, startingKlasses = {};
      for (const type of this.types) {
        startingKlasses[type.classKey] = this.klasses[type.classKey];
        if (type.instanceKey) {
          seen[type.instanceKey] = new Set();
          found[type.instanceKey] = [];
        }
      }
      // Newly initialized classes are usually near the top of the allocator;
      // scan downwards so their older prefab/instance allocations can be found
      // in the same pass, instead of waiting for another complete sweep.
      this.sweep = { start, cursor: limit, limit, seen, found, startingKlasses };
    }

    finishSweep(now) {
      const sweep = this.sweep;
      for (const type of this.types) {
        const key = type.instanceKey;
        if (!key) continue;
        // If the class was discovered mid-sweep, the beginning of this sweep
        // wasn't searched for its instances. Keep existing results until the
        // next complete pass, while still publishing newly found ones promptly.
        if (!this.klasses[type.classKey] ||
            sweep.startingKlasses[type.classKey] !== this.klasses[type.classKey]) continue;
        const next = sweep.found[key];
        const nextSet = sweep.seen[key];
        for (const index of this.instances[key]) {
          if (!nextSet.has(index)) this.onRemoved(type, index);
        }
        this.instances[key] = next;
        this.liveSets[key] = nextSet;
      }
      this.sweep = null;
      this.nextSweepAt = now + this.intervalMs;
      this.stats.sweeps++;
    }

    // Returns the suggested delay before calling work() again.
    work(mod, now) {
      if (!mod || !mod.HEAP32 || !mod.HEAPF32) return 250;
      if (mod !== this.module || mod.HEAP32.buffer !== this.buffer) this.reset(mod);
      const heap = mod.HEAP32;
      const floats = mod.HEAPF32;
      const bytes = mod.HEAPU8 || new Uint8Array(heap.buffer);
      const limit = allocatedWords(mod);
      if (!limit) return 100;
      this.stats.allocatedBytes = limit * 4;

      // A replaced or reinitialized class must never leave stale pointers in
      // the active instance lists or baseline caches.
      for (const type of this.types) {
        const klass = this.klasses[type.classKey];
        if (klass && !isClass(heap, klass / 4, type.names.map(n => n.address))) {
          this.klasses[type.classKey] = null;
          if (type.instanceKey) {
            for (const index of this.instances[type.instanceKey]) this.onRemoved(type, index);
            this.instances[type.instanceKey] = [];
            this.liveSets[type.instanceKey].clear();
          }
          this.sweep = null;
          this.nextSweepAt = 0;
        }
      }

      // Map loads can allocate tens of megabytes while a sweep is in flight.
      // Restart at the new high-water mark instead of missing the new classes
      // until an old, smaller sweep has finished.
      if (this.sweep && limit > this.sweep.limit + Math.max(262144, this.sweep.limit * 0.05)) {
        this.sweep = null;
        this.nextSweepAt = 0;
      }
      if (!this.sweep) {
        if (now < this.nextSweepAt) return Math.max(16, this.nextSweepAt - now);
        this.beginSweep(mod, limit);
      }

      const startTime = this.clock();
      let chunks = 0;
      do {
        const sweep = this.sweep;
        if (sweep.cursor <= sweep.start) {
          this.finishSweep(now);
          break;
        }
        const end = sweep.cursor;
        const begin = Math.max(sweep.start, end - this.chunkWords);
        const segment = heap.subarray(begin, end);

        for (const type of this.types) {
          let klass = this.klasses[type.classKey];
          if (!klass) {
            for (const name of type.names) {
              if (!stringEquals(bytes, name.address, name.text)) continue;
              let offset = 0, match;
              while ((match = segment.indexOf(name.address, offset)) !== -1) {
                const index = begin + match - 2;
                if (isClass(heap, index, [name.address])) {
                  klass = index * 4;
                  this.klasses[type.classKey] = klass;
                  break;
                }
                offset = match + 1;
              }
              if (klass) break;
            }
          }

          if (!klass || !type.instanceKey) continue;
          let offset = 0, match;
          while ((match = segment.indexOf(klass, offset)) !== -1) {
            const index = begin + match;
            offset = match + 1;
            if (index + type.maxOffset >= sweep.limit || heap[index + 1] !== 0 ||
                !type.validate(heap, floats, index, klass, sweep.limit)) continue;
            const key = type.instanceKey;
            if (!sweep.seen[key].has(index)) {
              sweep.seen[key].add(index);
              sweep.found[key].push(index);
            }
            if (!this.liveSets[key].has(index)) {
              this.liveSets[key].add(index);
              this.instances[key].push(index);
              this.onFound(type, index, mod);
            }
          }
        }
        sweep.cursor = begin;
        chunks++;
      } while (chunks < this.maxChunks && this.clock() - startTime < this.budgetMs);

      const elapsed = this.clock() - startTime;
      this.stats.slices++;
      this.stats.totalSliceMs += elapsed;
      this.stats.maxSliceMs = Math.max(this.stats.maxSliceMs, elapsed);
      return this.sweep ? 16 : Math.max(16, this.nextSweepAt - now);
    }

    getStats() {
      return { ...this.stats, scanning: !!this.sweep,
        progress: this.sweep && this.sweep.limit > this.sweep.start
          ? (this.sweep.limit - this.sweep.cursor) / (this.sweep.limit - this.sweep.start) : 1 };
    }
  }

  return { IncrementalHeapScanner, allocatedWords, isClass, stringEquals };
});
