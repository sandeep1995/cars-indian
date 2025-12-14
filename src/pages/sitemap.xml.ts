import type { APIRoute } from 'astro';
import { getAllDealers, getCities } from '../lib/dealers';

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

export const GET: APIRoute = ({ site }) => {
  const urls: string[] = [];

  urls.push(absolute(site, '/'));
  urls.push(absolute(site, '/contact'));
  urls.push(absolute(site, '/pre-owned-luxury-cars'));

  for (const c of getCities()) {
    urls.push(absolute(site, `/pre-owned-luxury-cars/${c.citySlug}`));
  }

  for (const d of getAllDealers()) {
    urls.push(
      absolute(site, `/pre-owned-luxury-cars/${d.citySlug}/${d.dealerSlug}`)
    );
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
