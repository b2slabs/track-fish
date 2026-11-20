import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { StoreIndexMeta } from '@/types/data';

export type AvailabilityFilter = 'all' | 'available' | 'unavailable';
export type SortOrder = 'price-asc' | 'price-desc';

export interface FilterState {
  search: string;
  storeSlug: string; // 'all' or a storeSlug key
  availability: AvailabilityFilter;
  sort: SortOrder;
}

interface FilterBarProps {
  stores: Record<string, StoreIndexMeta>;
  value: FilterState;
  onChange: (next: FilterState) => void;
}

export function FilterBar({ stores, value, onChange }: FilterBarProps) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <div className="flex-1">
        <label htmlFor="search" className="mb-1 block text-sm font-medium">
          Search
        </label>
        <Input
          id="search"
          placeholder="Common or scientific name…"
          value={value.search}
          onChange={(e) => onChange({ ...value, search: e.target.value })}
        />
      </div>

      <div className="w-full sm:w-48">
        <label htmlFor="store" className="mb-1 block text-sm font-medium">
          Store
        </label>
        <Select
          value={value.storeSlug}
          onValueChange={(storeSlug) => onChange({ ...value, storeSlug })}
        >
          <SelectTrigger id="store" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All stores</SelectItem>
            {Object.entries(stores).map(([slug, meta]) => (
              <SelectItem key={slug} value={slug}>
                {meta.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="w-full sm:w-44">
        <label htmlFor="availability" className="mb-1 block text-sm font-medium">
          Availability
        </label>
        <Select
          value={value.availability}
          onValueChange={(availability) =>
            onChange({ ...value, availability: availability as AvailabilityFilter })
          }
        >
          <SelectTrigger id="availability" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="available">In stock</SelectItem>
            <SelectItem value="unavailable">Out of stock</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="w-full sm:w-44">
        <label htmlFor="sort" className="mb-1 block text-sm font-medium">
          Sort by price
        </label>
        <Select
          value={value.sort}
          onValueChange={(sort) => onChange({ ...value, sort: sort as SortOrder })}
        >
          <SelectTrigger id="sort" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="price-asc">Price: low to high</SelectItem>
            <SelectItem value="price-desc">Price: high to low</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
