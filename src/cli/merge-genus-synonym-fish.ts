import { withDataBranchWorktree, commitAndPushDataBranch } from '../lib/data-branch.js';
import { mergeGenusSynonymFishInDataDir } from '../lib/migrate-genus-synonym-merge.js';

/**
 * One-time CLI for issue #114: checks out the real `data` branch, merges
 * (or renames) every published fish history file still keyed on a
 * synonym genus (see `migrate-genus-synonym-merge.ts`'s own doc) into its
 * canonical counterpart, keeps `index.json`'s per-Listing
 * `canonicalFishId` consistent with the result, prints a before/after
 * report, and commits + pushes.
 *
 * Pass `--dry-run` to run the exact same migration against the checked-
 * out worktree and print the same report WITHOUT committing or pushing --
 * the worktree is a throwaway copy either way (see `withDataBranchWorktree`),
 * so a dry run still safely writes into it, just never calls
 * `commitAndPushDataBranch`, and the worktree is removed afterwards same
 * as a real run.
 *
 * Safe to re-run (`mergeGenusSynonymFishInDataDir` is idempotent -- a file
 * already canonicalized is left untouched).
 */
async function main() {
  const dryRun = process.argv.includes('--dry-run');

  await withDataBranchWorktree(async (dataDir) => {
    const summary = mergeGenusSynonymFishInDataDir(dataDir);

    console.log(`${dryRun ? '[DRY RUN] ' : ''}Scanned ${summary.filesScanned} fish history file(s); ${summary.filesAffected} affected.`);
    console.log(`index.json: ${summary.listingsUpdatedInIndex} Listing(s) had their canonicalFishId updated.`);

    if (summary.perFile.length > 0) {
      console.log('\nFiles affected:');
      for (const f of summary.perFile) {
        const action = f.mergedIntoExisting ? 'merged into' : 'renamed to';
        console.log(
          `  ${f.oldCanonicalFishId} (${f.oldFileName}) ${action} ${f.newCanonicalFishId}: ` +
            `${f.listingsMoved} listing(s), ${f.eventsMoved} event(s) moved`,
        );
      }
    }

    if (dryRun) {
      console.log('\n[DRY RUN] No changes committed or pushed.');
      return;
    }

    const committed = commitAndPushDataBranch(
      dataDir,
      'Merge fish history files still split across a genus synonym into their canonical match (issue #114)',
    );
    console.log(committed ? '\nPushed merged data to data branch.' : '\nNo changes to commit.');
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
