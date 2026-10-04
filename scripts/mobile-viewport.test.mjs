import test from 'node:test';
import assert from 'node:assert/strict';
import {keyboardObstruction} from '../lib/mobile-viewport.ts';

const viewport = {appHeight:844, visualHeight:510, offsetTop:0, scale:1, mobile:true, editing:true};

test('keyboard clearance uses the visible bottom, including Safari viewport offsets', () => {
  assert.equal(keyboardObstruction(viewport), 334);
  assert.equal(keyboardObstruction({...viewport, offsetTop:45}), 289);
  assert.equal(keyboardObstruction({...viewport, visualHeight:900}), 0);
});

test('browser chrome, desktop focus and pinch zoom do not count as a keyboard', () => {
  assert.equal(keyboardObstruction({...viewport, visualHeight:780}), 0);
  assert.equal(keyboardObstruction({...viewport, editing:false}), 0);
  assert.equal(keyboardObstruction({...viewport, mobile:false}), 0);
  assert.equal(keyboardObstruction({...viewport, scale:1.5}), 0);
});
