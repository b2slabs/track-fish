import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import type { CanonicalFishHistory, IndexFile, PendingMatch } from '../types/listing.js';
import { isLegacyHistory, migrateLegacyHistory } from './canonical-fish.js';

const WORKTREE_DIRNAME = '.data-branch-worktree';
const DATA_BRANCH = 'data';

function git(args: string, cwd?: string): string {
  return execSync(`git ${args}`, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
}

function repoRoot(): string {
  return execSync('git rev-parse --show-toplevel').toString().trim();
}

/**
 * Checks out the dedicated `data` git branch (see ADR 0003) into a
 * throwaway worktree, runs `fn` against that worktree's directory, and
 * removes the worktree afterwards (the branch itself, and anything
 * committed to it, survives). Creates the branch as an orphan — containing
 * only the processed JSON, no application source — the first time it's
 * needed, locally or on `origin`.
 */
export async function withDataBranchWorktree<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const root = repoRoot();
  const worktreeDir = path.join(root, WORKTREE_DIRNAME);

  cleanupStaleWorktree(root, worktreeDir);

  const hasLocalBranch = tryGit(`rev-parse --verify --quiet ${DATA_BRANCH}`) !== undefined;
  const hasRemoteBranch = !hasLocalBranch && git(`ls-remote --heads origin ${DATA_BRANCH}`).length > 0;

  if (hasLocalBranch) {
    tryGit(`fetch origin ${DATA_BRANCH}:${DATA_BRANCH}`);
    git(`worktree add ${worktreeDir} ${DATA_BRANCH}`);
  } else if (hasRemoteBranch) {
    git(`fetch origin ${DATA_BRANCH}:${DATA_BRANCH}`);
    git(`worktree add ${worktreeDir} ${DATA_BRANCH}`);
  } else {
    git(`worktree add --orphan -b ${DATA_BRANCH} ${worktreeDir}`);
  }

  try {
    return await fn(worktreeDir);
  } finally {
    tryGit(`worktree remove --force ${worktreeDir}`);
  }
}

function cleanupStaleWorktree(root: string, worktreeDir: string): void {
  tryGit(`worktree remove --force ${worktreeDir}`);
  if (fs.existsSync(worktreeDir)) {
    fs.rmSync(worktreeDir, { recursive: true, force: true });
  }
  tryGit('worktree prune');
}

function tryGit(args: string): string | undefined {
  try {
    return git(args);
  } catch {
    return undefined;
  }
}

/**
 * Stages and commits every change in the `data` branch worktree and pushes
 * it to `origin`. Returns false (no-op) if there was nothing to commit —
 * this happens when a Scrape Run produces only Heartbeats for Listings
 * whose observation timestamps are, for whatever reason, already current.
 */
export function commitAndPushDataBranch(worktreeDir: string, message: string): boolean {
  git('add -A', worktreeDir);
  const status = git('status --porcelain', worktreeDir);
  if (!status) {
    return false;
  }
  git(`commit -m ${JSON.stringify(message)}`, worktreeDir);
  git(`push -u origin ${DATA_BRANCH}`, worktreeDir);
  return true;
}

const EMPTY_INDEX: IndexFile = {
  generatedAt: new Date(0).toISOString(),
  stores: {},
  listings: [],
};

export function readIndexFile(dataDir: string): IndexFile {
  const filePath = path.join(dataDir, 'index.json');
  if (!fs.existsSync(filePath)) {
    return structuredClone(EMPTY_INDEX);
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as IndexFile;
}

export function writeIndexFile(dataDir: string, index: IndexFile): void {
  const filePath = path.join(dataDir, 'index.json');
  fs.writeFileSync(filePath, JSON.stringify(index, null, 2) + '\n');
}

function historyFilePath(dataDir: string, canonicalFishId: string): string {
  const safeName = canonicalFishId.replace(/[^a-zA-Z0-9_-]/g, '-');
  return path.join(dataDir, 'fish', `${safeName}.json`);
}

export function readHistoryFile(dataDir: string, canonicalFishId: string): CanonicalFishHistory | undefined {
  const filePath = historyFilePath(dataDir, canonicalFishId);
  if (!fs.existsSync(filePath)) {
    return undefined;
  }
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  // Upgrade history files written before issue #3 (one Listing per
  // Canonical Fish) to the current shape on read. Nothing on disk
  // changes until the caller writes it back.
  return isLegacyHistory(raw) ? migrateLegacyHistory(raw) : (raw as CanonicalFishHistory);
}

export function writeHistoryFile(dataDir: string, history: CanonicalFishHistory): void {
  const filePath = historyFilePath(dataDir, history.canonicalFishId);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(history, null, 2) + '\n');
}

/**
 * Deletes a Canonical Fish's history file. Called only when every
 * Listing that used to contribute to it has been repointed elsewhere
 * (see `removeListingFromHistory` in `canonical-fish.ts`) — at that
 * point the file is fully superseded, not merely stale, so removing it
 * is what keeps a repoint from leaving a duplicate copy of the same
 * history behind under the old id.
 */
export function deleteHistoryFile(dataDir: string, canonicalFishId: string): void {
  const filePath = historyFilePath(dataDir, canonicalFishId);
  if (fs.existsSync(filePath)) {
    fs.rmSync(filePath);
  }
}

function pendingMatchesFilePath(dataDir: string): string {
  return path.join(dataDir, 'pending-matches.json');
}

export function readPendingMatches(dataDir: string): PendingMatch[] {
  const filePath = pendingMatchesFilePath(dataDir);
  if (!fs.existsSync(filePath)) {
    return [];
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as PendingMatch[];
}

export function writePendingMatches(dataDir: string, pendingMatches: PendingMatch[]): void {
  const filePath = pendingMatchesFilePath(dataDir);
  const sorted = [...pendingMatches].sort((a, b) => a.listingId.localeCompare(b.listingId));
  fs.writeFileSync(filePath, JSON.stringify(sorted, null, 2) + '\n');
}
