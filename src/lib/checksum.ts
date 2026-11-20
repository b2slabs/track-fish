import { createHash } from 'crypto';

export function computeChecksum(data: Buffer): string {
  const hash = createHash('sha256');
  hash.update(data);
  return hash.digest('hex');
}
