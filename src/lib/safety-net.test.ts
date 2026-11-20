import { test } from 'node:test';
import assert from 'node:assert/strict';
import { passesSafetyNetCheck } from './safety-net.js';

test('passes when there is no previous successful run', () => {
  assert.equal(passesSafetyNetCheck(0, undefined), true);
  assert.equal(passesSafetyNetCheck(5, undefined), true);
});

test('passes when the count is unchanged', () => {
  assert.equal(passesSafetyNetCheck(100, 100), true);
});

test('passes on exactly a 50% drop (not "more than")', () => {
  assert.equal(passesSafetyNetCheck(50, 100), true);
});

test('rejects a drop of more than 50%', () => {
  assert.equal(passesSafetyNetCheck(49, 100), false);
  assert.equal(passesSafetyNetCheck(0, 100), false);
});

test('passes on an increase in Listing count', () => {
  assert.equal(passesSafetyNetCheck(150, 100), true);
});
