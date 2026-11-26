import { expect, test } from 'vitest';
import { getDisplayName, stripNameQualifiers } from './display-name';

test('stripNameQualifiers leaves a plain name untouched', () => {
  expect(stripNameQualifiers('Neon Tetra')).toBe('Neon Tetra');
});

test('stripNameQualifiers drops a trailing parenthetical', () => {
  expect(stripNameQualifiers('Rummynose Tetra (Medium)')).toBe('Rummynose Tetra');
});

test('stripNameQualifiers drops a parenthetical scientific name', () => {
  expect(stripNameQualifiers('Habrosus Cory (Corydoras habrosus)')).toBe('Habrosus Cory');
});

test('stripNameQualifiers drops a trailing "Size X" qualifier with no parens', () => {
  expect(stripNameQualifiers('Giant Danio Size S')).toBe('Giant Danio');
});

test('stripNameQualifiers drops a multi-word size qualifier', () => {
  expect(stripNameQualifiers('Galaxy Rasbora Size Large')).toBe('Galaxy Rasbora');
});

test('stripNameQualifiers drops both a parenthetical and a size qualifier together', () => {
  expect(stripNameQualifiers('Betta Splendens (Male) Size L')).toBe('Betta Splendens');
});

test('stripNameQualifiers falls back to the trimmed original when stripping empties the name', () => {
  expect(stripNameQualifiers('(Medium)')).toBe('(Medium)');
});

test('getDisplayName strips qualifiers from commonName and surfaces scientificName as a clean subtitle', () => {
  const result = getDisplayName({
    commonName: 'Habrosus Cory (Corydoras habrosus)',
    scientificName: 'Corydoras habrosus',
  });
  expect(result).toEqual({ name: 'Habrosus Cory', scientificName: 'Corydoras habrosus' });
});

test('getDisplayName returns a null scientificName subtitle when the Listing has none', () => {
  const result = getDisplayName({ commonName: 'Giant Danio Size S', scientificName: null });
  expect(result).toEqual({ name: 'Giant Danio', scientificName: null });
});

test('getDisplayName treats a missing scientificName field the same as null', () => {
  const result = getDisplayName({ commonName: 'Neon Tetra', scientificName: undefined });
  expect(result).toEqual({ name: 'Neon Tetra', scientificName: null });
});
