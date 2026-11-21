import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'zlib';
import { createHash } from 'crypto';
import { buildCombinedRawArchive, combinedGzipFilenameFor } from './raw-archive.js';

test('buildCombinedRawArchive combines every Store under its slug, and gzip decompresses back to that JSON', () => {
  const entries = [
    { slug: 'store-a', data: { listings: [{ id: 1 }] } },
    { slug: 'store-b', data: { listings: [{ id: 2 }, { id: 3 }] } },
  ];

  const { combined, gzipBuffer, checksum } = buildCombinedRawArchive(entries);

  assert.deepEqual(combined, {
    'store-a': { listings: [{ id: 1 }] },
    'store-b': { listings: [{ id: 2 }, { id: 3 }] },
  });

  const decompressed = JSON.parse(zlib.gunzipSync(gzipBuffer).toString('utf-8'));
  assert.deepEqual(decompressed, combined);

  const expectedChecksum = createHash('sha256').update(gzipBuffer).digest('hex');
  assert.equal(checksum, expectedChecksum);
});

test('buildCombinedRawArchive produces one asset regardless of how many Stores are combined', () => {
  const manyStores = Array.from({ length: 15 }, (_, i) => ({ slug: `store-${i}`, data: { n: i } }));
  const { combined } = buildCombinedRawArchive(manyStores);
  assert.equal(Object.keys(combined).length, 15);
});

test('combinedGzipFilenameFor names the asset by day, independent of any Store', () => {
  assert.equal(combinedGzipFilenameFor('2026-11-20'), 'raw-2026-11-20.json.gz');
});
