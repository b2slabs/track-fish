import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commonNameSimilarity, normalizeCommonName, tokenize } from './fuzzy-match.js';

test('normalizes punctuation, parentheticals, and casing', () => {
  assert.equal(normalizeCommonName('Blue Tail Goodeid (Ataeniobius toweri)'), 'blue tail goodeid');
  assert.equal(normalizeCommonName("Betta's Dream-Fish!"), 'betta s dream fish');
});

test('tokenizes and drops short/stopword filler', () => {
  assert.deepEqual(tokenize('Red Male Betta Pair'), ['red', 'betta']);
});

test('near-identical common names score very high', () => {
  const score = commonNameSimilarity('Blue Tail Goodeid', 'Blue-Tail Goodeid');
  assert.ok(score > 0.9, `expected > 0.9, got ${score}`);
});

test('an exact match scores 1', () => {
  assert.equal(commonNameSimilarity('Discus', 'Discus'), 1);
});

test('reordered-but-overlapping wording scores reasonably high via token overlap', () => {
  const score = commonNameSimilarity('Golden Yellow Discus', 'Yellow Golden Discus');
  assert.ok(score > 0.9, `expected > 0.9, got ${score}`);
});

test('unrelated names score low', () => {
  const score = commonNameSimilarity('Green Moscow Guppy', 'Chinese Hillstream Loach');
  assert.ok(score < 0.4, `expected < 0.4, got ${score}`);
});

test('partial wording overlap lands in a mid-range score', () => {
  const score = commonNameSimilarity('Blue Cobalt Discus', 'Blue Diamond Discus');
  assert.ok(score > 0.3 && score < 0.95, `expected mid-range, got ${score}`);
});
