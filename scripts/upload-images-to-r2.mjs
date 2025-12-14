import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';

const DEFAULT_ENDPOINT = 'https://e3715bd8aa0c6e455f26ccd0a2ba0919.r2.cloudflarestorage.com';
const DEFAULT_BUCKET = 'pics';
const DEFAULT_PUBLIC_BASE = 'https://media.indianluxurycars.com';

function stripQuotes(v) {
	const s = String(v ?? '').trim();
	if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) return s.slice(1, -1);
	return s;
}

async function loadEnvFileIfPresent(filePath) {
	try {
		const raw = await fs.readFile(filePath, 'utf8');
		const lines = raw.split(/\r?\n/);
		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith('#')) continue;

			const noExport = trimmed.startsWith('export ') ? trimmed.slice(7).trim() : trimmed;
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

function isHttpUrl(u) {
	try {
		const url = new URL(u);
		return url.protocol === 'http:' || url.protocol === 'https:';
	} catch {
		return false;
	}
}

function extFromContentType(ct) {
	const s = String(ct || '').toLowerCase();
	if (s.includes('image/jpeg')) return 'jpg';
	if (s.includes('image/png')) return 'png';
	if (s.includes('image/webp')) return 'webp';
	if (s.includes('image/gif')) return 'gif';
	return undefined;
}

function extFromUrl(u) {
	try {
		const p = new URL(u).pathname.toLowerCase();
		if (p.endsWith('.jpg') || p.endsWith('.jpeg')) return 'jpg';
		if (p.endsWith('.png')) return 'png';
		if (p.endsWith('.webp')) return 'webp';
		if (p.endsWith('.gif')) return 'gif';
	} catch {
		// ignore
	}
	return undefined;
}

async function fileExists(p) {
	try {
		await fs.stat(p);
		return true;
	} catch {
		return false;
	}
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
	const dryRunFetch = hasFlag('--dry-run-fetch');
	const limit = Number(pickArg('--limit', '0')) || 0;
	const concurrency = Math.max(1, Number(pickArg('--concurrency', '8')) || 8);

	const endpoint = process.env.R2_ENDPOINT || DEFAULT_ENDPOINT;
	const bucket = process.env.R2_BUCKET || DEFAULT_BUCKET;
	const publicBase = normalizePublicBase(process.env.R2_PUBLIC_BASE || DEFAULT_PUBLIC_BASE);

	let client;
	if (apply) {
		const accessKeyId = process.env.R2_ACCESS_KEY_ID;
		const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
		if (!accessKeyId || !secretAccessKey) {
			throw new Error('Missing credentials. Set R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY env vars.');
		}
		client = new S3Client({
			region: 'auto',
			endpoint,
			credentials: { accessKeyId, secretAccessKey },
		});
	}

	const citiesDir = path.join(root, 'src', 'data', 'cities');
	const scriptsDir = path.join(root, 'scripts');
	const cachePath = path.join(scriptsDir, 'image-url-map.json');

	await fs.mkdir(scriptsDir, { recursive: true });

	let cache = {};
	if (await fileExists(cachePath)) {
		try {
			cache = JSON.parse(await fs.readFile(cachePath, 'utf8')) || {};
		} catch {
			cache = {};
		}
	}

	const cityFiles = (await fs.readdir(citiesDir))
		.filter((f) => f.toLowerCase().endsWith('.json'))
		.map((f) => path.join(citiesDir, f));

	const urls = new Set();
	const perFile = new Map(); // filePath -> records

	for (const filePath of cityFiles) {
		const raw = await fs.readFile(filePath, 'utf8');
		const records = JSON.parse(raw);
		if (!Array.isArray(records)) continue;
		perFile.set(filePath, records);

		for (const r of records) {
			const u = r?.imageUrl;
			if (!u || typeof u !== 'string') continue;
			if (!isHttpUrl(u)) continue;
			if (u.startsWith(publicBase + '/')) continue;
			urls.add(u);
		}
	}

	let uniqueUrls = Array.from(urls);
	if (limit > 0) uniqueUrls = uniqueUrls.slice(0, limit);

	console.log(
		`Found ${urls.size} unique imageUrl(s). Selected ${uniqueUrls.length}. Mode=${apply ? 'apply' : 'dry-run'} (concurrency=${concurrency})`
	);

	const toProcess = uniqueUrls.filter((u) => !cache[u]);

	console.log(`Cache hits: ${uniqueUrls.length - toProcess.length}. Uploading/downloading: ${toProcess.length}`);

	if (!apply && !dryRunFetch) {
		console.log('Dry-run: not fetching, not uploading, not rewriting files. Use --apply to perform the migration.');
		return;
	}

	async function ensureUploaded(sourceUrl) {
		if (cache[sourceUrl]) return cache[sourceUrl];

		const res = await fetch(sourceUrl, {
			redirect: 'follow',
			headers: {
				'user-agent': 'indianluxurycars-image-migrator/1.0',
				'accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
			},
		});
		if (!res.ok) {
			throw new Error(`Fetch failed (${res.status}) for ${sourceUrl}`);
		}

		const contentType = res.headers.get('content-type') || '';
		const ab = await res.arrayBuffer();
		const buf = Buffer.from(ab);
		if (!buf.length) throw new Error(`Empty body for ${sourceUrl}`);

		const hash = createHash('sha256').update(buf).digest('hex');
		const ext = extFromContentType(contentType) || extFromUrl(sourceUrl) || 'jpg';
		const key = `google/${hash}.${ext}`;
		const outUrl = `${publicBase}/${key}`;

		if (!apply) {
			cache[sourceUrl] = outUrl;
			return outUrl;
		}

		// Avoid duplicate uploads
		try {
			await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
		} catch {
			await client.send(
				new PutObjectCommand({
					Bucket: bucket,
					Key: key,
					Body: buf,
					ContentType: contentType || undefined,
					CacheControl: 'public, max-age=31536000, immutable',
				})
			);
		}

		cache[sourceUrl] = outUrl;
		return outUrl;
	}

	let ok = 0;
	let fail = 0;

	await mapWithConcurrency(toProcess, concurrency, async (u) => {
		try {
			await ensureUploaded(u);
			ok++;
			if (ok % 50 === 0) console.log(`Uploaded ${ok}/${toProcess.length}...`);
		} catch (e) {
			fail++;
			console.warn(String(e?.message || e));
		}
	});

	await fs.writeFile(cachePath, JSON.stringify(cache, null, 2) + '\n', 'utf8');

	if (!apply) {
		console.log('Dry-run fetch complete: cache updated, JSON not rewritten. Re-run with --apply to upload + rewrite JSON.');
		return;
	}

	let touchedFiles = 0;
	let replaced = 0;

	for (const [filePath, records] of perFile.entries()) {
		let changed = false;
		for (const r of records) {
			const u = r?.imageUrl;
			if (!u || typeof u !== 'string') continue;
			const mapped = cache[u];
			if (!mapped) continue;
			if (mapped !== u) {
				r.imageUrl = mapped;
				changed = true;
				replaced++;
			}
		}
		if (changed) {
			touchedFiles++;
			await fs.writeFile(filePath, JSON.stringify(records, null, 2) + '\n', 'utf8');
		}
	}

	console.log(`Done. ok=${ok} fail=${fail}. Replaced ${replaced} URLs across ${touchedFiles} files.`);
	console.log(`Cache saved to ${path.relative(root, cachePath)}`);
}

await main();


