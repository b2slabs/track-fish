import { withDataBranchWorktree, commitAndPushDataBranch } from '../lib/data-branch.js';
import { dedupeSpuriousFirstObservedInDataDir } from '../lib/migrate-dedupe-first-observed.js';

/**
 * One-time CLI for issue #96: checks out the real `data` branch, drops
 * every spurious extra `'first-observed'` Change Event the now-fixed
 * same-Store-merge composition-churn bug (see `migrate-dedupe-first-observed.ts`'s
 * own doc) left behind in already-published history files, prints a
 * before/after report, and commits + pushes the result. Safe to re-run
 * (`dedupeSpuriousFirstObservedInDataDir` is idempotent -- a file with no
 * duplicate `'first-observed'` entries left is left byte-for-byte
 * unchanged).
 */
async function main() {
  await withDataBranchWorktree(async (dataDir) => {
    const summary = dedupeSpuriousFirstObservedInDataDir(dataDir);

    console.log(`Scanned ${summary.filesScanned} history file(s); ${summary.filesChanged} changed.`);
    console.log(`Removed ${summary.totalSpuriousEventsRemoved} spurious first-observed event(s) in total.`);

    const changedFiles = summary.perFile.filter((f) => f.changed);
    console.log('\nFiles changed:');
    for (const f of changedFiles) {
      console.log(`  ${f.canonicalFishId} (${f.fileName}): -${f.spuriousEventsRemoved} spurious event(s)`);
    }

    const committed = commitAndPushDataBranch(
      dataDir,
      'Remove spurious duplicate first-observed events from same-Store merge composition churn (issue #96)',
    );
    console.log(committed ? '\nPushed cleaned data to data branch.' : '\nNo changes to commit.');
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
