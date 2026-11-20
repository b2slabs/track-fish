export interface StoreAdapter {
  scrape(config: { domain: string; slug: string; platform: string; collectionHandle?: string }): Promise<{ data: unknown; listingCount: number }>;
}
