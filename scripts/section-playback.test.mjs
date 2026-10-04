import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_MODEL, cloneModel, sectionContours} from '../lib/form-engine.ts';

test('bounded section contours follow ripple phase and preserve the paused section', () => {
  const model = cloneModel(DEFAULT_MODEL), wave = model.influences.find(f => f.kind === 'wave');
  wave.phase = 0;
  const depth = model.depth / 2 - 3, paused = sectionContours(model, depth, 56);
  wave.phase = 90;
  const animated = sectionContours(model, depth, 56);
  assert.ok(paused.segments.length > 0 && animated.segments.length > 0);
  assert.ok(animated.segments.flat().every(Number.isFinite));
  assert.notDeepEqual(animated.segments, paused.segments);
  wave.phase = 0;
  assert.deepEqual(sectionContours(model, depth, 56).segments, paused.segments);
});
