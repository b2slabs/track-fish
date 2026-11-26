import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getDisplayName, stripNameQualifiers } from './display-name.ts';

test('stripNameQualifiers leaves a plain name untouched', () => {
  assert.equal(stripNameQualifiers('Neon Tetra'), 'Neon Tetra');
});

test('stripNameQualifiers drops a trailing parenthetical', () => {
  assert.equal(stripNameQualifiers('Rummynose Tetra (Medium)'), 'Rummynose Tetra');
});

test('stripNameQualifiers drops a parenthetical scientific name', () => {
  assert.equal(stripNameQualifiers('Habrosus Cory (Corydoras habrosus)'), 'Habrosus Cory');
});

test('stripNameQualifiers drops a trailing "Size X" qualifier with no parens', () => {
  assert.equal(stripNameQualifiers('Giant Danio Size S'), 'Giant Danio');
});

test('stripNameQualifiers drops a multi-word size qualifier', () => {
  assert.equal(stripNameQualifiers('Galaxy Rasbora Size Large'), 'Galaxy Rasbora');
});

test('stripNameQualifiers drops both a parenthetical and a size qualifier together', () => {
  assert.equal(stripNameQualifiers('Betta Splendens (Male) Size L'), 'Betta Splendens');
});

test('stripNameQualifiers falls back to the trimmed original when stripping empties the name', () => {
  assert.equal(stripNameQualifiers('(Medium)'), '(Medium)');
});

test('getDisplayName strips qualifiers from commonName and surfaces scientificName as a clean subtitle', () => {
  const result = getDisplayName({
    commonName: 'Habrosus Cory (Corydoras habrosus)',
    scientificName: 'Corydoras habrosus',
  });
  assert.deepEqual(result, { name: 'Habrosus Cory', scientificName: 'Corydoras habrosus' });
});

test('getDisplayName returns a null scientificName subtitle when the Listing has none', () => {
  const result = getDisplayName({ commonName: 'Giant Danio Size S', scientificName: null });
  assert.deepEqual(result, { name: 'Giant Danio', scientificName: null });
});

test('getDisplayName treats a missing scientificName field the same as null', () => {
  const result = getDisplayName({ commonName: 'Neon Tetra', scientificName: undefined });
  assert.deepEqual(result, { name: 'Neon Tetra', scientificName: null });
});
