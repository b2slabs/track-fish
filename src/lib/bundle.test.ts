import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isBundleListing } from './bundle.js';

test('detects real-world combo/bundle titles found in the dataset', () => {
  for (const title of [
    'Carbon Rili Shrimp Breeder Combo Box',
    'Bred by Aquatic Arts™ Mix & Match Neocaridina Shrimp – Choose 2',
    'Bred by Aquatic Arts™ Mix & Match Shrimp Combo Box – Choose 2',
    'Crystal Black Shrimp Combo Box',
    'Mix + Match Anubias Bundle',
    'Build Your Own Algae Eating Crew',
    'Freshwater Live Food Variety Pack – Choose Your Worms, 3 Pack',
    'Choose Your Betta Livestream',
    'Combo Deal !! PRE SALE , 3 Darnoid + 3 Lemon barb',
    'Air Plant Variety Pack - Bulk Assorted Species of Live Tillandsia with Fertilizer Bottle',
  ]) {
    assert.equal(isBundleListing(title), true, `expected "${title}" to be detected as a bundle`);
  }
});

test('does not flag a plain species/variant Listing', () => {
  for (const title of [
    'White Cloud Minnow (School of 6)',
    'Anubias Nana Petite on Lava Stone',
    'Carbon Rili Shrimp (Neocaridina davidi), BREDBY: Aquatic Arts',
    'Wild Form Neocaridina Shrimp (Neocaridina davidi), Tank-Bred!',
    'Galaxy Rasbora / Celestial Pearl Danio (Size Large)',
  ]) {
    assert.equal(isBundleListing(title), false, `expected "${title}" to NOT be detected as a bundle`);
  }
});
