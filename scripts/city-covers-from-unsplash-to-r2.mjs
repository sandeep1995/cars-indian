import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';

const DEFAULT_ENDPOINT =
  'https://e3715bd8aa0c6e455f26ccd0a2ba0919.r2.cloudflarestorage.com';
const DEFAULT_BUCKET = 'pics';
const DEFAULT_PUBLIC_BASE = 'https://media.indianluxurycars.com';

// Provided in prompt; override via UNSPLASH_ACCESS_KEY in .env.local
const DEFAULT_UNSPLASH_ACCESS_KEY =
  'AFT03uPn-rVvC2rbW5QUcn0Ma8Np2a916omCCXFE39A';

function stripQuotes(v) {
  const s = String(v ?? '').trim();
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  )
    return s.slice(1, -1);
  return s;
}

async function loadEnvFileIfPresent(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const lines = raw.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const noExport = trimmed.startsWith('export ')
        ? trimmed.slice(7).trim()
        : trimmed;
      const eq = noExport.indexOf('=');
      if (eq === -1) continue;
      const key = noExport.slice(0, eq).trim();
      const val = stripQuotes(noExport.slice(eq + 1));
      if (!key) continue;
      if (process.env[key] === undefined) process.env[key] = val;
    }
    return true;
  } catch {
    return false;
  }
}

function pickArg(flag, fallback) {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return fallback;
  return process.argv[idx + 1] ?? fallback;
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function normalizePublicBase(base) {
  return String(base || '').replace(/\/+$/, '');
}

function safeText(v, fallback = '') {
  if (typeof v === 'string') return v.trim();
  return fallback;
}

function mainCityOnly(cityField) {
  const s = safeText(cityField);
  if (!s) return '';
  // Handle "Mumbai, Thane" or "Agra, Basai" -> "Mumbai"/"Agra"
  const first = s.split(',')[0]?.trim() ?? '';
  return first;
}

function inferCityFromAddress(address) {
  const a = safeText(address);
  if (!a) return '';
  const parts = a
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  if (parts.length < 3) return '';
  // Common: "... , <city>, <state + postal>, India"
  const candidate = parts[parts.length - 3] ?? '';
  if (!candidate) return '';
  if (/\d{5,6}/.test(candidate)) return '';
  if (candidate.length > 48) return '';
  return candidate;
}

function titleizeFromSlug(slug) {
  return slug
    .split('-')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

async function fileExists(p) {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

async function mapWithConcurrency(items, concurrency, worker) {
  let i = 0;
  const results = [];
  const workers = Array.from({ length: concurrency }, async () => {
    while (true) {
      const idx = i++;
      if (idx >= items.length) return;
      results[idx] = await worker(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return results;
}

async function main() {
  const root = process.cwd();
  await loadEnvFileIfPresent(path.join(root, '.env.local'));

  const apply = hasFlag('--apply');
  const dryRun = hasFlag('--dry-run') || !apply;
  const concurrency = Math.max(1, Number(pickArg('--concurrency', '2')) || 2);
  const limit = Number(pickArg('--limit', '10')) || 10;
  const sleepMs = Number(pickArg('--sleep-ms', '1000')) || 1000;
  const overwrite = hasFlag('--overwrite');

  const endpoint = process.env.R2_ENDPOINT || DEFAULT_ENDPOINT;
  const bucket = process.env.R2_BUCKET || DEFAULT_BUCKET;
  const publicBase = normalizePublicBase(
    process.env.R2_PUBLIC_BASE || DEFAULT_PUBLIC_BASE
  );
  const unsplashKey =
    process.env.UNSPLASH_ACCESS_KEY || DEFAULT_UNSPLASH_ACCESS_KEY;

  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

  if (apply && (!accessKeyId || !secretAccessKey)) {
    throw new Error(
      'Missing credentials. Set R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY in .env.local.'
    );
  }

  const client = apply
    ? new S3Client({
        region: 'auto',
        endpoint,
        credentials: { accessKeyId, secretAccessKey },
      })
    : undefined;

  const citiesDir = path.join(root, 'src', 'data', 'cities');
  const coversPath = path.join(root, 'src', 'data', 'city-covers.json');
  const scriptsDir = path.join(root, 'scripts');
  const cachePath = path.join(scriptsDir, 'unsplash-cover-cache.json');

  await fs.mkdir(scriptsDir, { recursive: true });

  let covers = {};
  if (await fileExists(coversPath)) {
    try {
      covers = JSON.parse(await fs.readFile(coversPath, 'utf8')) || {};
    } catch {
      covers = {};
    }
  }

  let cache = {};
  if (await fileExists(cachePath)) {
    try {
      cache = JSON.parse(await fs.readFile(cachePath, 'utf8')) || {};
    } catch {
      cache = {};
    }
  }

  const cityFiles = (await fs.readdir(citiesDir)).filter((f) =>
    f.toLowerCase().endsWith('.json')
  );
  const citySlugsAll = cityFiles.map((f) => f.replace(/\.json$/i, ''));
  const citySlugs = limit > 0 ? citySlugsAll.slice(0, limit) : citySlugsAll;

  console.log(
    `Cities: ${citySlugsAll.length}. Selected: ${citySlugs.length}. Mode=${
      apply ? 'apply' : 'dry-run'
    } concurrency=${concurrency}`
  );

  const targets = citySlugs
    .filter((slug) => overwrite || !covers[slug]?.url)
    .filter((slug) => !cache[slug] || overwrite);

  console.log(
    `To fetch: ${targets.length} (existing covers kept unless --overwrite)`
  );

  async function searchUnsplash(query) {
    const url = new URL('https://api.unsplash.com/search/photos');
    url.searchParams.set('query', query);
    url.searchParams.set('orientation', 'landscape');
    url.searchParams.set('per_page', '1');
    url.searchParams.set('content_filter', 'high');
    url.searchParams.set('client_id', unsplashKey);

    const res = await fetch(url.toString());

    if (res.status === 429) throw new Error('Unsplash rate limited (429)');
    if (!res.ok) throw new Error(`Unsplash search failed (${res.status})`);
    return await res.json();
  }

  async function ensureUploadedFromUrl(imageUrl, preferredKeyPrefix) {
    const res = await fetch(imageUrl, {
      redirect: 'follow',
      headers: {
        'user-agent': 'indianluxurycars-city-cover/1.0',
        accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      },
    });
    if (!res.ok) throw new Error(`Image fetch failed (${res.status})`);
    const contentType = res.headers.get('content-type') || 'image/jpeg';
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length) throw new Error('Empty image');

    const hash = createHash('sha256').update(buf).digest('hex');
    const ext = contentType.includes('png')
      ? 'png'
      : contentType.includes('webp')
      ? 'webp'
      : 'jpg';
    const key = `${preferredKeyPrefix}/${hash}.${ext}`.replace(/\/+/g, '/');
    const outUrl = `${publicBase}/${key}`;

    if (!apply) return { outUrl, key };

    try {
      await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    } catch {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: buf,
          ContentType: contentType,
          CacheControl: 'public, max-age=31536000, immutable',
        })
      );
    }

    return { outUrl, key };
  }

  let ok = 0;
  let fail = 0;

  await mapWithConcurrency(targets, concurrency, async (citySlug) => {
    try {
      const samplePath = path.join(citiesDir, `${citySlug}.json`);
      const records = JSON.parse(await fs.readFile(samplePath, 'utf8'));
      const firstRecord = Array.isArray(records) ? records?.[0] : undefined;

      const fromCityField = mainCityOnly(firstRecord?.city);
      const fromAddress = inferCityFromAddress(firstRecord?.address);
      const fromSlug = titleizeFromSlug(citySlug);

      const query = fromCityField || fromAddress || fromSlug;

      if (sleepMs) await sleep(sleepMs);

      const search = await searchUnsplash(query);
      const photo = search?.results?.[0];
      if (!photo) throw new Error(`No Unsplash result for ${query}`);

      const regularUrl = safeText(photo?.urls?.regular);
      if (!regularUrl) throw new Error('Missing urls.regular');

      const uploadPrefix = `covers/cities/${citySlug}`;
      const { outUrl } = await ensureUploadedFromUrl(regularUrl, uploadPrefix);

      cache[citySlug] = { url: outUrl, query };
      ok++;
      if (ok % 25 === 0) console.log(`Processed ${ok}/${targets.length}...`);
    } catch (e) {
      fail++;
      console.warn(`[${citySlug}] ${String(e?.message || e)}`);
    }
  });

  await fs.writeFile(cachePath, JSON.stringify(cache, null, 2) + '\n', 'utf8');

  if (!apply) {
    console.log(
      `Dry-run complete: ok=${ok} fail=${fail}. Re-run with --apply to upload + write city-covers.json`
    );
    return;
  }

  let updated = 0;
  for (const [slug, data] of Object.entries(cache)) {
    if (!data?.url) continue;
    if (!overwrite && covers[slug]) continue;
    covers[slug] = data.url;
    updated++;
  }

  await fs.writeFile(
    coversPath,
    JSON.stringify(covers, null, 2) + '\n',
    'utf8'
  );
  console.log(
    `Done. ok=${ok} fail=${fail}. Updated covers: ${updated}. Wrote src/data/city-covers.json`
  );
}

await main();
