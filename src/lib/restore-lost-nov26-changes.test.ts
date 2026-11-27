import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import {
  findLostNov26Events,
  buildLastCheckedAtIndex,
  restoreLostNov26EventsInDataDir,
} from './restore-lost-nov26-changes.js';
import type { CanonicalFishHistory } from '../types/listing.js';

/**
 * One-time migration for issue #122 -- see module doc in
 * restore-lost-nov26-changes.ts for full context.
 */

function withTempDir(fn: (dir: string) => void): void {
  const dir = mkdtempSync(path.join(tmpdir(), 'track-fish-nov26-restore-test-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function writeHistory(dataDir: string, fileName: string, history: CanonicalFishHistory): void {
  const fishDir = path.join(dataDir, 'fish');
  mkdirSync(fishDir, { recursive: true });
  writeFileSync(path.join(fishDir, fileName), JSON.stringify(history, null, 2) + '\n');
}

function readHistory(dataDir: string, fileName: string): CanonicalFishHistory {
  return JSON.parse(readFileSync(path.join(dataDir, 'fish', fileName), 'utf-8'));
}

// --- findLostNov26Events -------------------------------------------------

test('findLostNov26Events finds an event present in the Nov26 commit but not the baseline', () => {
  withTempDir((baselineDir) => {
    withTempDir((nov26Dir) => {
      const baseline: CanonicalFishHistory = {
        canonicalFishId: 'cf:sci:corydoras-habrosus',
        commonName: 'Salt and Pepper Cory',
        scientificName: 'Corydoras habrosus',
        listings: [
          {
            listingId: 'monster-aquarium:1',
            storeSlug: 'monster-aquarium',
            storeName: 'Monster Aquarium',
            commonName: 'Salt and Pepper Cory',
            lastCheckedAt: '2026-11-25T19:01:08.640Z',
          },
        ],
        events: [
          {
            type: 'change',
            observedAt: '2026-11-01T00:00:00.000Z',
            price: 3.99,
            currency: 'USD',
            available: true,
            variants: [],
            changedFields: ['first-observed'],
            listingId: 'monster-aquarium:1',
            storeSlug: 'monster-aquarium',
          },
        ],
      };
      const nov26: CanonicalFishHistory = {
        ...baseline,
        events: [
          ...baseline.events,
          {
            type: 'change',
            observedAt: '2026-11-26T18:52:43.808Z',
            price: 3.99,
            currency: 'USD',
            available: false,
            variants: [],
            changedFields: ['available'],
            listingId: 'monster-aquarium:1',
            storeSlug: 'monster-aquarium',
          },
        ],
      };
      writeHistory(baselineDir, 'cf-sci-corydoras-habrosus.json', baseline);
      writeHistory(nov26Dir, 'cf-sci-corydoras-habrosus.json', nov26);

      const lost = findLostNov26Events(baselineDir, nov26Dir);
      assert.equal(lost.length, 1);
      assert.equal(lost[0].listingId, 'monster-aquarium:1');
      assert.equal(lost[0].event.observedAt, '2026-11-26T18:52:43.808Z');
      assert.equal(lost[0].event.available, false);
    });
  });
});

test('findLostNov26Events ignores an event identical in both, even if filename differs (moved by issue #114)', () => {
  withTempDir((baselineDir) => {
    withTempDir((nov26Dir) => {
      const sharedEvent = {
        type: 'change' as const,
        observedAt: '2026-11-01T00:00:00.000Z',
        price: 9.99,
        currency: 'USD',
        available: true,
        variants: [],
        changedFields: ['first-observed'],
        listingId: 'dans-fish:1',
        storeSlug: 'dans-fish',
      };
      const inOldFile: CanonicalFishHistory = {
        canonicalFishId: 'cf:sci:gastrodermus-hastatus',
        commonName: 'Tail Spot Pygmy Cory',
        scientificName: 'Gastrodermus hastatus',
        listings: [
          { listingId: 'dans-fish:1', storeSlug: 'dans-fish', storeName: "Dan's Fish", commonName: 'Tail Spot Pygmy Cory', lastCheckedAt: '2026-11-25T00:00:00.000Z' },
        ],
        events: [sharedEvent],
      };
      const inNewFile: CanonicalFishHistory = { ...inOldFile, canonicalFishId: 'cf:sci:corydoras-hastatus' };
      writeHistory(baselineDir, 'cf-sci-gastrodermus-hastatus.json', inOldFile);
      writeHistory(nov26Dir, 'cf-sci-corydoras-hastatus.json', inNewFile); // renamed, same listingId+event

      const lost = findLostNov26Events(baselineDir, nov26Dir);
      assert.equal(lost.length, 0);
    });
  });
});

// --- buildLastCheckedAtIndex ----------------------------------------------

test('buildLastCheckedAtIndex maps every listingId to its lastCheckedAt', () => {
  withTempDir((dir) => {
    const history: CanonicalFishHistory = {
      canonicalFishId: 'cf:sci:corydoras-habrosus',
      commonName: 'Salt and Pepper Cory',
      scientificName: 'Corydoras habrosus',
      listings: [
        { listingId: 'monster-aquarium:1', storeSlug: 'monster-aquarium', storeName: 'Monster Aquarium', commonName: 'Salt and Pepper Cory', lastCheckedAt: '2026-11-25T19:01:08.640Z' },
      ],
      events: [],
    };
    writeHistory(dir, 'cf-sci-corydoras-habrosus.json', history);
    const index = buildLastCheckedAtIndex(dir);
    assert.equal(index.get('monster-aquarium:1'), '2026-11-25T19:01:08.640Z');
  });
});

// --- restoreLostNov26EventsInDataDir ---------------------------------------

test('fixes a late-rediscovered event in place: corrects observedAt and stamps confirmedSameUntil (Monster Aquarium precedent)', () => {
  withTempDir((currentDir) => {
    const current: CanonicalFishHistory = {
      canonicalFishId: 'cf:sci:corydoras-habrosus',
      commonName: 'Salt and Pepper Cory',
      scientificName: 'Corydoras habrosus',
      listings: [
        { listingId: 'monster-aquarium:1', storeSlug: 'monster-aquarium', storeName: 'Monster Aquarium', commonName: 'Salt and Pepper Cory', lastCheckedAt: '2026-11-27T04:36:20.162Z' },
      ],
      events: [
        {
          type: 'change',
          observedAt: '2026-11-01T00:00:00.000Z',
          price: 3.99,
          currency: 'USD',
          available: true,
          variants: [],
          changedFields: ['first-observed'],
          listingId: 'monster-aquarium:1',
          storeSlug: 'monster-aquarium',
        },
        {
          // the late rediscovery -- wrong date, correct resulting state, no confirmedSameUntil
          type: 'change',
          observedAt: '2026-11-27T04:36:20.162Z',
          price: 3.99,
          currency: 'USD',
          available: false,
          variants: [],
          changedFields: ['available'],
          listingId: 'monster-aquarium:1',
          storeSlug: 'monster-aquarium',
        },
      ],
    };
    writeHistory(currentDir, 'cf-sci-corydoras-habrosus.json', current);

    const lostEvent = {
      listingId: 'monster-aquarium:1',
      event: {
        type: 'change' as const,
        observedAt: '2026-11-26T18:52:43.808Z',
        price: 3.99,
        currency: 'USD',
        available: false,
        variants: [],
        changedFields: ['available'],
        listingId: 'monster-aquarium:1',
        storeSlug: 'monster-aquarium',
      },
    };
    const baselineLastCheckedAt = new Map([['monster-aquarium:1', '2026-11-25T19:01:08.640Z']]);

    const actions = restoreLostNov26EventsInDataDir(currentDir, [lostEvent], baselineLastCheckedAt);

    assert.equal(actions.length, 1);
    assert.equal(actions[0].kind, 'fixed-in-place');
    assert.equal(actions[0].trueObservedAt, '2026-11-26T18:52:43.808Z');
    assert.equal(actions[0].confirmedSameUntil, '2026-11-25T19:01:08.640Z');

    const result = readHistory(currentDir, 'cf-sci-corydoras-habrosus.json');
    assert.equal(result.events.length, 2); // net-zero: fix in place, no duplicate
    const fixed = result.events.find((e) => e.available === false)!;
    assert.equal(fixed.observedAt, '2026-11-26T18:52:43.808Z');
    assert.equal(fixed.confirmedSameUntil, '2026-11-25T19:01:08.640Z');
  });
});

test('does not stamp confirmedSameUntil when baseline lastCheckedAt is not later than the previous event', () => {
  withTempDir((currentDir) => {
    const current: CanonicalFishHistory = {
      canonicalFishId: 'cf:sci:x',
      commonName: 'X',
      scientificName: null,
      listings: [
        { listingId: 'store:1', storeSlug: 'store', storeName: 'Store', commonName: 'X', lastCheckedAt: '2026-11-27T00:00:00.000Z' },
      ],
      events: [
        {
          type: 'change',
          observedAt: '2026-11-26T17:00:00.000Z', // previous event itself is AFTER baseline lastCheckedAt below
          price: 1,
          currency: 'USD',
          available: true,
          variants: [],
          changedFields: ['first-observed'],
          listingId: 'store:1',
          storeSlug: 'store',
        },
        {
          type: 'change',
          observedAt: '2026-11-27T00:00:00.000Z',
          price: 1,
          currency: 'USD',
          available: false,
          variants: [],
          changedFields: ['available'],
          listingId: 'store:1',
          storeSlug: 'store',
        },
      ],
    };
    writeHistory(currentDir, 'cf-sci-x.json', current);
    const lostEvent = {
      listingId: 'store:1',
      event: {
        type: 'change' as const,
        observedAt: '2026-11-26T18:00:00.000Z',
        price: 1,
        currency: 'USD',
        available: false,
        variants: [],
        changedFields: ['available'],
        listingId: 'store:1',
        storeSlug: 'store',
      },
    };
    // Baseline lastCheckedAt is EARLIER than the previous real event's own date -- no confirmed-unchanged gap.
    const baselineLastCheckedAt = new Map([['store:1', '2026-11-26T13:00:00.000Z']]);

    const actions = restoreLostNov26EventsInDataDir(currentDir, [lostEvent], baselineLastCheckedAt);
    assert.equal(actions[0].confirmedSameUntil, undefined);
  });
});

test('restores a never-rediscovered event into its Listing CURRENT canonical-fish file, even if renamed since', () => {
  withTempDir((currentDir) => {
    // Listing now lives under a DIFFERENT file than it did historically
    // (issue #114 moved it).
    const current: CanonicalFishHistory = {
      canonicalFishId: 'cf:sci:corydoras-hastatus',
      commonName: 'Tail Spot Pygmy Cory',
      scientificName: 'Corydoras hastatus',
      listings: [
        { listingId: 'dans-fish:1', storeSlug: 'dans-fish', storeName: "Dan's Fish", commonName: 'Tail Spot Pygmy Cory', lastCheckedAt: '2026-11-27T00:00:00.000Z' },
      ],
      events: [
        {
          type: 'change',
          observedAt: '2026-11-01T00:00:00.000Z',
          price: 9.99,
          currency: 'USD',
          available: true,
          variants: [],
          changedFields: ['first-observed'],
          listingId: 'dans-fish:1',
          storeSlug: 'dans-fish',
        },
        {
          type: 'change',
          observedAt: '2026-11-28T00:00:00.000Z',
          price: 12.99, // unrelated later change, different state -- not a rediscovery
          currency: 'USD',
          available: true,
          variants: [],
          changedFields: ['price'],
          listingId: 'dans-fish:1',
          storeSlug: 'dans-fish',
        },
      ],
    };
    writeHistory(currentDir, 'cf-sci-corydoras-hastatus.json', current);

    const lostEvent = {
      listingId: 'dans-fish:1',
      event: {
        type: 'change' as const,
        observedAt: '2026-11-26T00:00:00.000Z',
        price: 10.99,
        currency: 'USD',
        available: true,
        variants: [],
        changedFields: ['price'],
        listingId: 'dans-fish:1',
        storeSlug: 'dans-fish',
      },
    };

    const actions = restoreLostNov26EventsInDataDir(currentDir, [lostEvent], new Map());
    assert.equal(actions[0].kind, 'restored');
    assert.equal(actions[0].canonicalFishId, 'cf:sci:corydoras-hastatus');

    const result = readHistory(currentDir, 'cf-sci-corydoras-hastatus.json');
    assert.equal(result.events.length, 3); // net +1: a genuine restore
    assert.deepEqual(
      result.events.map((e) => e.observedAt),
      ['2026-11-01T00:00:00.000Z', '2026-11-26T00:00:00.000Z', '2026-11-28T00:00:00.000Z']
    );
  });
});

test('skips as already-present when the exact event already sits in current history (idempotent re-run, or a merge-growth listingId artifact)', () => {
  withTempDir((currentDir) => {
    // This mirrors the real-world "nationwide-aquatics-usa / Polypterus
    // weeksii" case: a same-Store merge grew a new member on Nov 26,
    // reshuffling an OLDER, genuinely-unaffected event onto a new
    // listingId -- the diff against the baseline (which still has the
    // old listingId) sees that older event as "lost" even though it's
    // already sitting, unchanged, in current data under the (new,
    // already-current) listingId.
    const current: CanonicalFishHistory = {
      canonicalFishId: 'cf:sci:polypterus-weeksii',
      commonName: 'Weeksii Bichir',
      scientificName: 'Polypterus weeksii',
      listings: [
        { listingId: 'store:a+b', storeSlug: 'store', storeName: 'Store', commonName: 'Weeksii Bichir', lastCheckedAt: '2026-11-27T00:00:00.000Z' },
      ],
      events: [
        {
          type: 'change',
          observedAt: '2026-05-24T04:00:00.000Z',
          price: 155,
          currency: 'USD',
          available: true,
          variants: [],
          changedFields: ['first-observed'],
          listingId: 'store:a+b',
          storeSlug: 'store',
        },
      ],
    };
    writeHistory(currentDir, 'cf-sci-polypterus-weeksii.json', current);

    const lostEvent = {
      listingId: 'store:a+b', // same (already-current) merged listingId
      event: {
        type: 'change' as const,
        observedAt: '2026-05-24T04:00:00.000Z',
        price: 155,
        currency: 'USD',
        available: true,
        variants: [],
        changedFields: ['first-observed'],
        listingId: 'store:a+b',
        storeSlug: 'store',
      },
    };

    const actions = restoreLostNov26EventsInDataDir(currentDir, [lostEvent], new Map());
    assert.equal(actions.length, 1);
    assert.equal(actions[0].kind, 'already-present');

    const result = readHistory(currentDir, 'cf-sci-polypterus-weeksii.json');
    assert.equal(result.events.length, 1); // no duplicate inserted
  });
});

test('reports unresolved when the listingId has no current home at all', () => {
  withTempDir((currentDir) => {
    mkdirSync(path.join(currentDir, 'fish'), { recursive: true });
    const lostEvent = {
      listingId: 'ghost-store:999',
      event: {
        type: 'change' as const,
        observedAt: '2026-11-26T00:00:00.000Z',
        price: 1,
        currency: 'USD',
        available: true,
        variants: [],
        changedFields: ['price'],
        listingId: 'ghost-store:999',
        storeSlug: 'ghost-store',
      },
    };
    const actions = restoreLostNov26EventsInDataDir(currentDir, [lostEvent], new Map());
    assert.equal(actions.length, 1);
    assert.equal(actions[0].kind, 'unresolved');
  });
});
