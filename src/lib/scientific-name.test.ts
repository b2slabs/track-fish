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

test('issue #16: a labeled binomial followed immediately by a capitalized next sentence/label, with no punctuation boundary, does not swallow that next word as a bogus subspecies', () => {
  // Real AquaHuna product description: "Scientific Name: Corydoras Aeneus
  // From our tank to your tank!" -- before the fix, the case-insensitive
  // label match let "From" slip in as if it were a lowercase
  // subspecies/variety word, producing "Corydoras aeneus from" instead of
  // "Corydoras aeneus", which permanently forked this Store's Listings
  // away from every other Store's correctly-extracted "Corydoras aeneus".
  assert.equal(
    extractScientificName({
      commonName: 'Albino Cory',
      description: 'Scientific Name: Corydoras Aeneus From our tank to your tank! We have mastered the art of keeping fish.',
    }),
    null // vendor capitalized the species too ("Aeneus"), so this specific
    // description yields no confident extraction at all -- it is expected
    // to fall back to fuzzy common-name matching (see canonical-fish.test.ts).
  );

  // Real Aquarium Co-Op-style "Quick Facts" description: "Scientific Name
  // Corydoras pygmaeus Origin Brazil, Peru and Colombia ...". Same
  // no-punctuation-boundary shape, but with a properly-cased species, so
  // extraction should succeed and stop at "pygmaeus" -- not "origin".
  assert.equal(
    extractScientificName({
      commonName: 'Pygmy Cory (Gang of 5)',
      description: 'Quick Facts Scientific Name Corydoras pygmaeus Origin Brazil, Peru and Colombia Care Level Easy',
    }),
    'Corydoras pygmaeus'
  );
});

test('a genuinely lowercase stopword in the subspecies/variety slot is dropped, not treated as part of the name', () => {
  assert.equal(
    extractScientificName({
      commonName: 'Some Fish',
      description: 'Scientific Name: Corydoras aeneus origin unspecified.',
    }),
    'Corydoras aeneus'
  );
});

test('slugifies a scientific name for use as a Canonical Fish id suffix', () => {
  assert.equal(scientificNameSlug('Hyphessobrycon peugeoti'), 'hyphessobrycon-peugeoti');
  assert.equal(scientificNameSlug('Corydoras sp. black'), 'corydoras-sp-black');
});
