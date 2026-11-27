import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { withDataBranchWorktree, commitAndPushDataBranch } from '../lib/data-branch.js';
import {
  findLostNov26Events,
  buildLastCheckedAtIndex,
  restoreLostNov26EventsInDataDir,
  type RestoreAction,
} from '../lib/restore-lost-nov26-changes.js';

/**
 * One-time CLI for issue #122 -- see `src/lib/restore-lost-nov26-changes.ts`
 * for full context and the migration's own doc.
 *
 * Checks out two READ-ONLY worktrees of the `data` branch's git history --
 * `eb7ff7ec3` (the pre-revert Nov 25 baseline) and `87f47e8640` (the real,
 * since-wiped Nov 26 scrape run) -- diffs them to find every lost Nov 26
 * event, then applies the fix to a THIRD, mutable worktree of the live
 * `data` branch tip (via `withDataBranchWorktree`, same as every other
 * data-branch migration in this repo).
 *
 * Pass `--dry-run` to print the full before/after report WITHOUT
 * committing or pushing (the live worktree is a throwaway copy either way;
 * a dry run just skips `commitAndPushDataBranch`). Per issue #122, a dry
 * run against the real `data` branch MUST be reviewed before this is ever
 * run for real.
 */

const BASELINE_COMMIT = 'eb7ff7ec3';
const NOV26_COMMIT = '87f47e8640';
const READONLY_WORKTREE_PREFIX = '.nov26-restore-readonly-worktree-';

function git(args: string, cwd?: string): string {
  return execSync(`git ${args}`, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
}

function repoRoot(): string {
  return execSync('git rev-parse --show-toplevel').toString().trim();
}

/** Checks out `commit` (any ref, including one not at a branch tip) into a
 * throwaway, read-only worktree and runs `fn` against its directory. The
 * worktree is always removed afterwards, dry run or not -- nothing here
 * ever writes back to git history, only reads it. */
async function withReadOnlyCommitWorktree<T>(commit: string, fn: (dir: string) => Promise<T> | T): Promise<T> {
  const root = repoRoot();
  const worktreeDir = path.join(root, `${READONLY_WORKTREE_PREFIX}${commit}`);
  try {
    git(`worktree remove --force ${worktreeDir}`);
  } catch {
    // didn't exist -- fine.
  }
  if (fs.existsSync(worktreeDir)) {
    fs.rmSync(worktreeDir, { recursive: true, force: true });
  }
  git(`worktree add --detach ${worktreeDir} ${commit}`);
  try {
    return await fn(worktreeDir);
  } finally {
    try {
      git(`worktree remove --force ${worktreeDir}`);
    } catch {
      // best-effort cleanup.
    }
  }
}

function countListingsAndEvents(dataDir: string): { listings: number; events: number } {
  const fishDir = path.join(dataDir, 'fish');
  if (!fs.existsSync(fishDir)) {
    return { listings: 0, events: 0 };
  }
  let listings = 0;
  let events = 0;
  for (const fileName of fs.readdirSync(fishDir).filter((f) => f.endsWith('.json'))) {
    const history = JSON.parse(fs.readFileSync(path.join(fishDir, fileName), 'utf-8'));
    listings += history.listings.length;
    events += history.events.length;
  }
  return { listings, events };
}

function describeAction(a: RestoreAction): string {
  if (a.kind === 'unresolved') {
    return `  UNRESOLVED  listingId=${a.listingId} trueObservedAt=${a.trueObservedAt} -- no current home found, needs manual review`;
  }
  if (a.kind === 'already-present') {
    return `  NOOP        listingId=${a.listingId} -> ${a.canonicalFishId}  (already present at ${a.trueObservedAt} -- already fixed, or a same-Store merge-growth listingId artifact unrelated to the revert)`;
  }
  if (a.kind === 'restored') {
    return `  RESTORED    listingId=${a.listingId} -> ${a.canonicalFishId}  (re-inserted at ${a.trueObservedAt})`;
  }
  return (
    `  FIXED       listingId=${a.listingId} -> ${a.canonicalFishId}  ` +
    `(${a.wrongObservedAt} -> ${a.trueObservedAt}` +
    `${a.confirmedSameUntil ? `, confirmedSameUntil=${a.confirmedSameUntil}` : ''})`
  );
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  await withReadOnlyCommitWorktree(BASELINE_COMMIT, async (baselineDir) => {
    await withReadOnlyCommitWorktree(NOV26_COMMIT, async (nov26Dir) => {
      const lostEvents = findLostNov26Events(baselineDir, nov26Dir);
      const baselineLastCheckedAt = buildLastCheckedAtIndex(baselineDir);

      console.log(`${dryRun ? '[DRY RUN] ' : ''}Found ${lostEvents.length} lost Nov 26 event(s) across ${new Set(lostEvents.map((e) => e.listingId)).size} listing(s).`);

      await withDataBranchWorktree(async (currentDir) => {
        const before = countListingsAndEvents(currentDir);

        const actions = restoreLostNov26EventsInDataDir(currentDir, lostEvents, baselineLastCheckedAt);

        const after = countListingsAndEvents(currentDir);

        const fixed = actions.filter((a) => a.kind === 'fixed-in-place');
        const restored = actions.filter((a) => a.kind === 'restored');
        const unresolved = actions.filter((a) => a.kind === 'unresolved');
        const alreadyPresent = actions.filter((a) => a.kind === 'already-present');

        console.log(`\n${dryRun ? '[DRY RUN] ' : ''}Summary:`);
        console.log(`  fixed-in-place:  ${fixed.length}`);
        console.log(`  restored:        ${restored.length}`);
        console.log(`  already-present: ${alreadyPresent.length} (no-op -- already fixed, or a merge-growth listingId artifact)`);
        console.log(`  unresolved:      ${unresolved.length}`);
        console.log(`\n  listings: ${before.listings} -> ${after.listings} (expect unchanged)`);
        console.log(`  events:   ${before.events} -> ${after.events} (expect +${restored.length}, i.e. one per genuine restore)`);

        if (actions.length > 0) {
          console.log('\nPer-listing detail:');
          for (const a of actions) {
            console.log(describeAction(a));
          }
        }

        if (dryRun) {
          console.log('\n[DRY RUN] No changes committed or pushed.');
          return;
        }

        const committed = commitAndPushDataBranch(
          currentDir,
          'Restore true Nov 26 dates for real Change Events wiped by the data-branch revert (issue #122)',
        );
        console.log(committed ? '\nPushed restored data to data branch.' : '\nNo changes to commit.');
      });
    });
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
