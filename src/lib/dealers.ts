import { safeText, slugify } from './slug';

export type DealerRecord = {
  title?: string;
  subTitle?: string;
  categoryName?: string;
  address?: string;
  neighborhood?: string;
  street?: string;
  city?: string;
  postalCode?: string;
  state?: string;
  countryCode?: string;
  website?: string;
  phone?: string;
  phoneUnformatted?: string;
  location?: { lat?: number; lng?: number };
  totalScore?: number;
  reviewsCount?: number;
  imagesCount?: number;
  openingHours?: Array<{ day?: string; hours?: string }>;
  imageUrl?: string;
  url?: string;
  placeId?: string;
  categories?: string[];
  permanentlyClosed?: boolean;
  temporarilyClosed?: boolean;
};

export type Dealer = DealerRecord & {
  cityName: string;
  citySlug: string;
  dealerSlug: string;
};

type CityIndex = {
  cityName: string;
  citySlug: string;
  count: number;
};

const dataModules = import.meta.glob('../data/cities/*.json', {
  eager: true,
}) as Record<string, { default: DealerRecord[] }>;

function guessCityFromPath(path: string): string | undefined {
  const file = path.split('/').pop() ?? '';
  const base = file.replace(/\.json$/i, '');
  if (!base) return undefined;
  const first = base.split(',')[0] ?? base;
  const cleaned = first.replace(/[-_]+/g, ' ').trim();
  return cleaned ? cleaned : undefined;
}

function cityNameFromRecordOrPath(r: DealerRecord, path: string): string {
  const fromRecord = safeText(r.city);
  if (fromRecord) return fromRecord;
  return guessCityFromPath(path) ?? 'India';
}

function shortId(input: string): string {
  const s = safeText(input, 'unknown').replace(/[^a-zA-Z0-9]/g, '');
  if (s.length <= 8) return s.toLowerCase();
  return s.slice(-8).toLowerCase();
}

function hashId(input: string): string {
  // small deterministic id for missing placeId
  let h = 5381;
  for (let i = 0; i < input.length; i++) h = (h * 33) ^ input.charCodeAt(i);
  return (h >>> 0).toString(36).slice(0, 8);
}

function buildDealerSlug(
  title: string,
  placeId: string,
  address?: string
): string {
  const t = slugify(title || 'dealer');
  const id = safeText(placeId);
  if (id) return `${t}-${shortId(id)}`;
  return `${t}-${hashId(`${title}|${safeText(address)}`)}`;
}

let _allDealers: Dealer[] | undefined;
let _cities: CityIndex[] | undefined;
let _dealersByCity: Map<string, Dealer[]> | undefined;

export function getAllDealers(): Dealer[] {
  if (_allDealers) return _allDealers;

  const seen = new Set<string>();
  const out: Dealer[] = [];

  for (const [path, mod] of Object.entries(dataModules)) {
    const records = Array.isArray(mod?.default) ? mod.default : [];
    for (const r of records) {
      const placeId = safeText(r.placeId);
      const title = safeText(r.title) || 'Dealer';
      const cityName = cityNameFromRecordOrPath(r, path);
      const citySlug = slugify(cityName || 'india');
      if (!citySlug) continue;

      const key = placeId
        ? `${citySlug}:${placeId}`
        : `${citySlug}:${title}:${safeText(r.address)}`;
      if (seen.has(key)) continue;
      seen.add(key);

      out.push({
        ...r,
        cityName,
        citySlug,
        dealerSlug: buildDealerSlug(title, placeId, r.address),
      });
    }
  }

  _allDealers = out;
  return out;
}

export function getCities(): CityIndex[] {
  if (_cities) return _cities;

  const byCity = new Map<string, { cityName: string; count: number }>();
  for (const d of getAllDealers()) {
    const prev = byCity.get(d.citySlug);
    if (!prev) {
      byCity.set(d.citySlug, { cityName: d.cityName, count: 1 });
    } else {
      prev.count += 1;
    }
  }

  _cities = Array.from(byCity.entries())
    .map(([citySlug, v]) => ({
      citySlug,
      cityName: v.cityName,
      count: v.count,
    }))
    .sort((a, b) => b.count - a.count || a.cityName.localeCompare(b.cityName));

  return _cities;
}

export function getDealersByCitySlug(citySlug: string): Dealer[] {
  if (!_dealersByCity) {
    _dealersByCity = new Map();
    for (const d of getAllDealers()) {
      const arr = _dealersByCity.get(d.citySlug);
      if (arr) arr.push(d);
      else _dealersByCity.set(d.citySlug, [d]);
    }
    for (const [k, v] of _dealersByCity) {
      v.sort((a, b) => {
        const ar = typeof a.totalScore === 'number' ? a.totalScore : -1;
        const br = typeof b.totalScore === 'number' ? b.totalScore : -1;
        return br - ar || safeText(a.title).localeCompare(safeText(b.title));
      });
      _dealersByCity.set(k, v);
    }
  }

  return _dealersByCity.get(citySlug) ?? [];
}

export function findDealer(
  citySlug: string,
  dealerSlug: string
): Dealer | undefined {
  const dealers = getDealersByCitySlug(citySlug);
  return dealers.find((d) => d.dealerSlug === dealerSlug);
}

export function isLikelyUsedLuxuryDealer(d: DealerRecord): boolean {
  const category = safeText(d.categoryName).toLowerCase();
  const cats = (d.categories ?? []).map((c) => safeText(c).toLowerCase());

  const combined = [category, ...cats].join(' ');
  return (
    combined.includes('used car dealer') ||
    combined.includes('car dealer') ||
    combined.includes('motor vehicle dealer') ||
    combined.includes('audi dealer') ||
    combined.includes('bmw dealer') ||
    combined.includes('mercedes-benz dealer') ||
    combined.includes('land rover dealer') ||
    combined.includes('jaguar dealer') ||
    combined.includes('volvo dealer')
  );
}
