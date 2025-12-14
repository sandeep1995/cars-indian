import { promises as fs } from 'node:fs';
import path from 'node:path';

function slugify(input) {
	return String(input ?? '')
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.trim()
		.toLowerCase()
		.replace(/['"]/g, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.replace(/-{2,}/g, '-');
}

function safeText(v, fallback = '') {
	if (typeof v === 'string') return v.trim();
	return fallback;
}

function guessCityFromFilename(file) {
	const base = file.replace(/\.json$/i, '');
	const first = base.split(',')[0] ?? base;
	const cleaned = first.replace(/[-_]+/g, ' ').trim();
	return cleaned || undefined;
}

function inferCityFromAddress(address) {
	const a = safeText(address);
	if (!a) return undefined;
	const parts = a
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);
	if (parts.length < 3) return undefined;

	// Common pattern: "... , <city>, <state + postal>, India"
	const candidate = parts[parts.length - 3];
	if (!candidate) return undefined;
	if (/\d{5,6}/.test(candidate)) return undefined;
	if (candidate.length > 48) return undefined;
	return candidate;
}

function cityNameFromRecordOrFile(record, file) {
	return safeText(record?.city) || inferCityFromAddress(record?.address) || guessCityFromFilename(file) || 'India';
}

function dedupeKey(record, citySlug) {
	const placeId = safeText(record?.placeId);
	if (placeId) return `${citySlug}:${placeId}`;
	return `${citySlug}:${safeText(record?.title)}:${safeText(record?.address)}`;
}

async function ensureDir(p) {
	await fs.mkdir(p, { recursive: true });
}

async function main() {
	const root = process.cwd();
	const srcDir = path.join(root, 'src', 'data');
	const outDir = path.join(srcDir, 'cities');
	const rawDir = path.join(srcDir, 'raw');

	await ensureDir(outDir);
	await ensureDir(rawDir);

	// Prefer normalizing from src/data/raw if it exists (so reruns are idempotent)
	let inputDir = srcDir;
	try {
		const st = await fs.stat(rawDir);
		if (st.isDirectory()) inputDir = rawDir;
	} catch {
		// ignore
	}

	// Clean outDir (remove old generated jsons)
	const outEntries = await fs.readdir(outDir, { withFileTypes: true });
	for (const e of outEntries) {
		if (e.isFile() && e.name.toLowerCase().endsWith('.json')) {
			await fs.unlink(path.join(outDir, e.name));
		}
	}

	const entries = await fs.readdir(inputDir, { withFileTypes: true });
	const jsonFiles = entries.filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.json')).map((e) => e.name);

	if (jsonFiles.length === 0) {
		console.log(`No JSON files found in ${path.relative(root, inputDir)}/`);
		return;
	}

	const grouped = new Map(); // citySlug -> { cityName, records: [] }
	const seen = new Set();

	for (const file of jsonFiles) {
		const full = path.join(inputDir, file);
		const txt = await fs.readFile(full, 'utf8');

		let arr;
		try {
			arr = JSON.parse(txt);
		} catch (e) {
			console.warn(`Skipping invalid JSON: ${file}`);
			continue;
		}

		if (!Array.isArray(arr)) {
			console.warn(`Skipping non-array JSON: ${file}`);
			continue;
		}

		for (const r of arr) {
			const cityName = cityNameFromRecordOrFile(r, file);
			const citySlug = slugify(cityName || 'india');
			if (!citySlug) continue;

			const key = dedupeKey(r, citySlug);
			if (seen.has(key)) continue;
			seen.add(key);

			const existing = grouped.get(citySlug);
			if (!existing) {
				grouped.set(citySlug, { cityName, records: [r] });
			} else {
				existing.records.push(r);
			}
		}
	}

	// write city files
	const citySlugs = Array.from(grouped.keys()).sort();
	for (const citySlug of citySlugs) {
		const g = grouped.get(citySlug);
		g.records.sort((a, b) => safeText(a?.title).localeCompare(safeText(b?.title)));
		const outPath = path.join(outDir, `${citySlug}.json`);
		await fs.writeFile(outPath, JSON.stringify(g.records, null, 2) + '\n', 'utf8');
	}

	// move originals to raw/
	if (inputDir === srcDir) {
		for (const file of jsonFiles) {
			const from = path.join(srcDir, file);
			const to = path.join(rawDir, file);
			try {
				await fs.rename(from, to);
			} catch {
				// If rename fails (e.g. cross-device), fallback to copy+unlink
				await fs.copyFile(from, to);
				await fs.unlink(from);
			}
		}
		console.log(`Moved ${jsonFiles.length} original file(s) into src/data/raw/`);
	} else {
		console.log(`Using existing raw inputs (${jsonFiles.length} file(s)) from src/data/raw/`);
	}

	console.log(`Created ${citySlugs.length} city file(s) in src/data/cities/`);
}

await main();


