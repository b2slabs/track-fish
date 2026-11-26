import { test } from 'node:test';
import assert from 'node:assert/strict';
import { singlePointStubPath } from './price-history-chart-geometry.ts';

// Issue #89: a run with exactly one point must render using the same
// "line-style marker" visual language as a multi-point run's connected
// step-line (color, dash pattern, stroke width) rather than a lone dot with
// no line-like geometry at all. `singlePointStubPath` is the pure geometry
// behind that marker: a short horizontal stub centered on the point, drawn
// as an SVG path `d` string so it can share the exact same <path> stroke
// styling (color/dash/width) multi-point runs already use.

test('singlePointStubPath centers a horizontal stub of the given half-width on the point', () => {
  const d = singlePointStubPath(100, 50, 8);
  assert.equal(d, 'M 92 50 H 108');
});

test('singlePointStubPath defaults to a small, non-zero half-width when none is given', () => {
  const d = singlePointStubPath(100, 50);
  // Must not collapse to a zero-length path (an `M` with no draw command is
  // invisible — that's exactly the "renders as a dot, not a line" bug).
  assert.notEqual(d, 'M 100 50');
  assert.match(d, /^M -?\d+(\.\d+)? 50 H -?\d+(\.\d+)?$/);
});
