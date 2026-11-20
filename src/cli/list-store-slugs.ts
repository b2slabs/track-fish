import stores from '../config/stores.js';

/**
 * Prints every configured Store's slug as a JSON array, e.g.
 * `["aquatic-arts"]`. Used by the workflow's `stores` job to build the
 * scrape matrix's `include` list from `src/config/stores.ts` -- the single
 * source of truth for which Stores exist -- instead of duplicating it in
 * YAML.
 */
console.log(JSON.stringify(stores.map((store) => store.slug)));
