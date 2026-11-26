import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Pins the test runner to UTC so date-formatting assertions (e.g.
// PriceHistoryChart's single-observation message, which embeds
// `formatDateTime` output) don't depend on the host machine's local
// timezone (issue #88).
process.env.TZ = 'UTC';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'node',
  },
});
