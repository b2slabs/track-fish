import { withDataBranchWorktree, commitAndPushDataBranch } from '../lib/data-branch.js';
import { migrateHeartbeatsInDataDir } from '../lib/migrate-heartbeats.js';

/**
 * One-time CLI for issue #81: checks out the real `data` branch, compacts
 * every history file's Heartbeat events into `lastCheckedAt`, prints a
 * before/after size report, and commits + pushes the result. Safe to
 * re-run (`migrateHeartbeatsInDataDir` is idempotent — a file with no
 * Heartbeats left and `lastCheckedAt` already populated is left
 * byte-for-byte unchanged).
 */
async function main() {
  await withDataBranchWorktree(async (dataDir) => {
    const summary = migrateHeartbeatsInDataDir(dataDir);

    console.log(`Scanned ${summary.filesScanned} history file(s); ${summary.filesChanged} changed.`);
    console.log(`Removed ${summary.totalHeartbeatsRemoved} Heartbeat event(s) in total.`);

    const biggest = [...summary.perFile].sort((a, b) => b.bytesBefore - b.bytesAfter - (a.bytesBefore - a.bytesAfter));
    console.log('\nLargest reductions:');
    for (const f of biggest.slice(0, 10)) {
      if (f.bytesBefore === f.bytesAfter) continue;
      const pct = f.bytesBefore > 0 ? Math.round((1 - f.bytesAfter / f.bytesBefore) * 1000) / 10 : 0;
      console.log(
        `  ${f.canonicalFishId} (${f.fileName}): ${f.bytesBefore}B -> ${f.bytesAfter}B (-${pct}%), ${f.heartbeatsRemoved} heartbeats removed, ${f.changeEventsUntouched} change events kept`
      );
    }

    const pct =
      summary.totalBytesBefore > 0
        ? Math.round((1 - summary.totalBytesAfter / summary.totalBytesBefore) * 1000) / 10
        : 0;
    console.log(
      `\nTotal fish/ size: ${summary.totalBytesBefore}B -> ${summary.totalBytesAfter}B (-${pct}%)`
    );

    const committed = commitAndPushDataBranch(dataDir, 'Migrate Heartbeat events to lastCheckedAt (issue #81)');
    console.log(committed ? '\nPushed migrated data to data branch.' : '\nNo changes to commit.');
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
