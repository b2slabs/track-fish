import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractVariety, varietyCompatible, varietySlug } from './variety.js';

test('returns an empty signature for a plain, wild-type common name', () => {
  assert.deepEqual(extractVariety('Phoenix Rasbora'), []);
  assert.deepEqual(extractVariety('Bronze Corydoras (Tank-Bred)'), ['bronze']);
});

test('detects a single color/morph term', () => {
  assert.deepEqual(extractVariety('Albino Cory'), ['albino']);
  assert.deepEqual(extractVariety('Platinum Medaka'), ['platinum']);
  assert.deepEqual(extractVariety('Black Medaka Ricefish'), ['black']);
});

test('detects multiple terms, sorted and deduplicated', () => {
  assert.deepEqual(extractVariety('Albino HiFin Cory'), ['albino', 'hifin']);
  assert.deepEqual(extractVariety('Bronze AKA Green Aeneus Cory Catfish'), ['bronze', 'green']);
});

test('recognizes a term regardless of hyphenation/spacing variants', () => {
  assert.deepEqual(extractVariety('Albino Hi-Fin Cory'), ['albino', 'hifin']);
  assert.deepEqual(extractVariety('Albino Hi Fin Cory'), ['albino', 'hifin']);
});

test('ignores a parenthetical scientific name when scanning for variety terms', () => {
  assert.deepEqual(extractVariety('Albino Cory (Corydoras aeneus)'), ['albino']);
});

test('does not treat an unrecognized geographic/origin qualifier as a variety', () => {
  // "Venezuelan" is deliberately excluded (see module doc) -- the color
  // word alone is what distinguishes real-world cases.
  assert.deepEqual(extractVariety('Orange Venezuelan Cory'), ['orange']);
  assert.deepEqual(extractVariety('Red Venezuelan Sailfin Cory'), ['red', 'sailfin']);
});

test('varietyCompatible: both empty (plain/wild-type on both sides) is compatible', () => {
  assert.equal(varietyCompatible([], []), true);
});

test('varietyCompatible: an exact signature match is compatible', () => {
  assert.equal(varietyCompatible(['albino'], ['albino']), true);
  assert.equal(varietyCompatible(['albino', 'hifin'], ['albino', 'hifin']), true);
});

test('varietyCompatible: one side plain and the other varietal is NOT compatible', () => {
  assert.equal(varietyCompatible([], ['albino']), false);
  assert.equal(varietyCompatible(['albino'], []), false);
});

test('varietyCompatible: different detected varieties are NOT compatible', () => {
  assert.equal(varietyCompatible(['albino'], ['bronze']), false);
  assert.equal(varietyCompatible(['albino'], ['albino', 'hifin']), false);
});

test('varietySlug joins a signature for use as a Canonical Fish id suffix', () => {
  assert.equal(varietySlug(['albino']), 'albino');
  assert.equal(varietySlug(['albino', 'hifin']), 'albino-hifin');
});

test('real-world issue #34 case: Corydoras aeneus color morphs get distinct signatures', () => {
  assert.notEqual(varietySlug(extractVariety('Albino Cory')), varietySlug(extractVariety('Bronze Cory')));
  assert.notEqual(
    varietySlug(extractVariety('Bronze Cory')),
    varietySlug(extractVariety('Orange Venezuelan Cory'))
  );
  assert.notEqual(
    varietySlug(extractVariety('Albino Cory')),
    varietySlug(extractVariety('Orange Venezuelan Cory'))
  );
});

test('real-world issue #34 case: Medaka varieties get distinct signatures despite the shared base noun', () => {
  assert.notEqual(
    varietySlug(extractVariety('Platinum White Medaka Ricefish')),
    varietySlug(extractVariety('Black Medaka Ricefish'))
  );
});
