import type { APIRoute } from 'astro';
import { getAllDealers, getCities } from '../lib/dealers';
import { slugify } from '../lib/slug';
import { getAllUsedCars, generateCarSlug } from '../lib/api';
import brands from '../data/luxury-brands.json';

function xmlEscape(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function absolute(site: URL | undefined, pathname: string): string {
  if (!site) return pathname;
  return new URL(pathname, site).toString();
}

export const GET: APIRoute = async ({ site }) => {
  const urls: string[] = [];

  urls.push(absolute(site, '/'));
  urls.push(absolute(site, '/contact'));
  urls.push(absolute(site, '/pre-owned-luxury-cars'));
  urls.push(absolute(site, '/second-hand-luxury-cars'));

  for (const c of getCities()) {
    urls.push(absolute(site, `/pre-owned-luxury-cars/${c.citySlug}`));
    urls.push(absolute(site, `/second-hand-luxury-cars/${c.citySlug}`));
  }

  for (const d of getAllDealers()) {
    urls.push(
      absolute(site, `/pre-owned-luxury-cars/${d.citySlug}/${d.dealerSlug}`)
    );
  }

  // Used Car Pages
  const cars = await getAllUsedCars();
  for (const car of cars) {
    const slug = generateCarSlug(car);
    urls.push(absolute(site, `/cars/${slug}`));
  }

  // Sell Car Pages
  urls.push(absolute(site, '/sell'));

  const topCities = getCities()
    .sort((a, b) => b.count - a.count)
    .slice(0, 80);
  for (const c of topCities) {
    // Generic Sell Page
    urls.push(absolute(site, `/sell/luxury-cars-in-${c.citySlug}`));

    // Brand Specific Sell Pages
    for (const brand of brands) {
      const brandSlug = slugify(brand);
      urls.push(absolute(site, `/sell/${brandSlug}-in-${c.citySlug}`));
    }
  }

  const body =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.map((u) => `  <url><loc>${xmlEscape(u)}</loc></url>`).join('\n') +
    '\n</urlset>\n';

  return new Response(body, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
    },
  });
};
