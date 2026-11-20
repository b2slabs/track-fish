import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractScientificName, scientificNameSlug } from './scientific-name.js';

test('extracts a parenthetical binomial from the title', () => {
  const name = extractScientificName({
    commonName: 'Peugeot Tetra (Hyphessobrycon peugeoti)',
    description: '',
  });
  assert.equal(name, 'Hyphessobrycon peugeoti');
});

test('extracts a three-word binomial with a subspecies/variety word', () => {
  const name = extractScientificName({
    commonName: 'Some Fish (Corydoras sp. black)',
    description: '',
  });
  assert.equal(name, 'Corydoras sp. black');
});

test('extracts an explicit "Scientific Name:" label from the description', () => {
  const name = extractScientificName({
    commonName: 'Red Melon Discus',
    description: 'Scientific Name: Symphysodon aequifasciatus. From our tank to your tank!',
  });
  assert.equal(name, 'Symphysodon aequifasciatus');
});

test('falls back to a parenthetical binomial in the description when the title has none', () => {
  const name = extractScientificName({
    commonName: 'Red Melon Discus',
    description: 'A beautiful discus (Symphysodon aequifasciatus) for any tank.',
  });
  assert.equal(name, 'Symphysodon aequifasciatus');
});

test('prefers the title over the description when both have a binomial', () => {
  const name = extractScientificName({
    commonName: 'Peugeot Tetra (Hyphessobrycon peugeoti)',
    description: 'Scientific Name: Something else entirely',
  });
  assert.equal(name, 'Hyphessobrycon peugeoti');
});

test('returns null when there is nothing scientific-name-shaped at all', () => {
  const name = extractScientificName({
    commonName: 'Green Moscow Guppy',
    description: 'A lovely, hardy livebearer for beginners.',
  });
  assert.equal(name, null);
});

test('does not false-positive on common variant descriptors in parentheses', () => {
  assert.equal(
    extractScientificName({ commonName: 'Blue Tail Goodeid (Locally Bred)', description: '' }),
    null
  );
  assert.equal(
    extractScientificName({ commonName: 'Guppy Pair (1 Male + 1 Female)', description: '' }),
    null
  );
  assert.equal(
    extractScientificName({ commonName: 'Fish (Tank Bred)', description: '' }),
    null
  );
});

test('slugifies a scientific name for use as a Canonical Fish id suffix', () => {
  assert.equal(scientificNameSlug('Hyphessobrycon peugeoti'), 'hyphessobrycon-peugeoti');
  assert.equal(scientificNameSlug('Corydoras sp. black'), 'corydoras-sp-black');
});
