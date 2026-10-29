'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { IncrementalHeapScanner, allocatedWords, isClass } = require('../crazy_shooters_offline/heap_scanner.js');

function fixture() {
  const buffer = new ArrayBuffer(4096 * 4);
  const heap = new Int32Array(buffer);
  const bytes = new Uint8Array(buffer);
  const floats = new Float32Array(buffer);
  const name = 80;
  bytes.set(Buffer.from('Example\0'), name);
  const classIndex = 1800;
  const klass = classIndex * 4;
  heap[classIndex] = 1234;
  heap[classIndex + 2] = name;
  heap[classIndex + 6] = klass;
  heap[classIndex + 7] = klass;
  heap[classIndex + 9] = 4321;
  // This name reference is not an Il2CppClass and must never be accepted.
  heap[1950 + 2] = name;
  heap[1950] = 42;
  const objectIndex = 400;
  heap[objectIndex] = klass;
  heap[objectIndex + 2] = 7;
  heap[0] = 2048 * 4;
  const mod = { HEAP32: heap, HEAPF32: floats, HEAPU8: bytes,
    asmLibraryArg: { DYNAMICTOP_PTR: 0, STACK_MAX: 128 } };
  return { mod, heap, classIndex, klass, objectIndex };
}

function makeScanner(overrides = {}) {
  const klasses = { example: null };
  const instances = { example: [] };
  const found = [], removed = [];
  let resets = 0;
  const scanner = new IncrementalHeapScanner({
    types: [{ classKey: 'example', instanceKey: 'example', maxOffset: 2,
      names: [{ address: 80, text: 'Example' }],
      validate: (h, f, p) => h[p + 2] === 7 }],
    klasses, instances, chunkWords: 64, maxChunks: 1, intervalMs: 0,
    onFound: (type, p) => found.push(p), onRemoved: (type, p) => removed.push(p),
    onReset: () => resets++, ...overrides
  });
  return { scanner, klasses, instances, found, removed, resets: () => resets };
}

function drive(scanner, mod, loops = 100) {
  for (let i = 0; i < loops; i++) scanner.work(mod, i * 16 + 1000);
}

test('discovers real classes and instances incrementally, ignoring metadata and unallocated memory', () => {
  const { mod, heap, classIndex, klass, objectIndex } = fixture();
  const { scanner, klasses, instances, found } = makeScanner();
  heap[3000] = klass; heap[3002] = 7; // outside allocator high-water mark
  scanner.work(mod, 1000);
  assert.equal(scanner.getStats().slices, 1);
  assert.equal(scanner.getStats().sweeps, 0);
  assert.ok(scanner.getStats().progress > 0 && scanner.getStats().progress < 1);
  drive(scanner, mod);
  assert.equal(klasses.example, klass);
  assert.equal(isClass(heap, classIndex, [80]), true);
  assert.deepEqual(instances.example, [objectIndex]);
  assert.deepEqual(found, [objectIndex]);
  assert.equal(scanner.getStats().allocatedBytes, 2048 * 4);
});

test('finds new allocations after heap growth, and prunes dead objects after a complete sweep', () => {
  const { mod, heap, klass, objectIndex } = fixture();
  const { scanner, instances, found, removed } = makeScanner();
  drive(scanner, mod);
  heap[3000] = klass; heap[3002] = 7;
  heap[0] = 4096 * 4;
  heap[objectIndex] = 0;
  drive(scanner, mod, 200);
  assert.deepEqual(instances.example, [3000]);
  assert.ok(found.includes(3000));
  assert.ok(removed.includes(objectIndex));
});

test('resets stale pointers and baselines when the Unity module or buffer changes', () => {
  const first = fixture(), second = fixture();
  const { scanner, instances, resets, removed } = makeScanner();
  drive(scanner, first.mod);
  assert.equal(instances.example.length, 1);
  second.heap[second.objectIndex] = 0;
  drive(scanner, second.mod);
  assert.deepEqual(instances.example, []);
  assert.equal(resets(), 2);
  assert.deepEqual(removed, []); // onReset owns the old module's cleanup
});

test('uses the allocator high-water mark and rejects uninitialized or corrupt bounds', () => {
  const { mod, heap } = fixture();
  assert.equal(allocatedWords(mod), 2048);
  heap[0] = 0;
  assert.equal(allocatedWords(mod), 0);
  heap[0] = 999999999;
  assert.equal(allocatedWords(mod), 0);
  delete mod.asmLibraryArg.DYNAMICTOP_PTR;
  assert.equal(allocatedWords(mod), heap.length);
});
