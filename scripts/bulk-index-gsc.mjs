import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { google } from 'googleapis';
import Database from 'better-sqlite3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SITEMAP_URL = 'https://indianluxurycars.com/sitemap.xml';
const DB_FILE = join(__dirname, 'gsc_indexing.db');
const SERVICE_ACCOUNT_FILE = join(__dirname, 'service.json');
const SCOPES = ['https://www.googleapis.com/auth/indexing'];

function initDb() {
  const db = new Database(DB_FILE);
  db.exec(`
    CREATE TABLE IF NOT EXISTS submitted_urls (
      url TEXT PRIMARY KEY,
      submitted_at TEXT,
      status TEXT
    )
  `);
  return db;
}

function getSubmittedUrls(db) {
  const stmt = db.prepare('SELECT url FROM submitted_urls');
  const rows = stmt.all();
  return new Set(rows.map((row) => row.url));
}

function markUrlSubmitted(db, url, status = 'submitted') {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO submitted_urls (url, submitted_at, status)
    VALUES (?, ?, ?)
  `);
  stmt.run(url, new Date().toISOString(), status);
}

async function fetchSitemap(url) {
  console.log(`Fetching sitemap from ${url}...`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch sitemap: ${response.status} ${response.statusText}`
    );
  }
  return await response.text();
}

function parseSitemap(xmlContent) {
  const urls = [];
  const urlMatches = xmlContent.matchAll(/<loc>(.*?)<\/loc>/g);

  for (const match of urlMatches) {
    const url = match[1].trim();
    if (url) {
      urls.push(url);
    }
  }

  return urls;
}

async function getAuthenticatedService() {
  if (!existsSync(SERVICE_ACCOUNT_FILE)) {
    throw new Error(
      `Service account file '${SERVICE_ACCOUNT_FILE}' not found.\n` +
        'Please download your service account JSON key from Google Cloud Console:\n' +
        '1. Go to https://console.cloud.google.com/\n' +
        '2. Create a project or select existing one\n' +
        '3. Enable "Indexing API"\n' +
        '4. Create a service account\n' +
        '5. Download the JSON key file\n' +
        '6. Save it as "service.json" in the scripts directory\n' +
        '7. Add the service account email to your Search Console property as an owner'
    );
  }

  const credentials = JSON.parse(readFileSync(SERVICE_ACCOUNT_FILE, 'utf8'));
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: SCOPES,
  });

  const authClient = await auth.getClient();

  return google.indexing({ version: 'v3', auth: authClient });
}

async function submitUrl(service, url) {
  try {
    const response = await service.urlNotifications.publish({
      requestBody: {
        url: url,
        type: 'URL_UPDATED',
      },
    });
    return { success: true, data: response.data };
  } catch (error) {
    console.error(error);
    if (error.code === 403) {
      return {
        success: false,
        error:
          'Permission denied. Make sure the service account has access to the property in Search Console.',
      };
    } else if (error.code === 429) {
      return {
        success: false,
        error: 'Rate limit exceeded. Please wait before retrying.',
      };
    } else {
      return {
        success: false,
        error: `HTTP ${error.code || 'unknown'}: ${error.message}`,
      };
    }
  }
}

async function submitBatch(service, urls) {
  const promises = urls.map((url) => submitUrl(service, url));
  const results = await Promise.allSettled(promises);

  return results.map((result, index) => {
    const url = urls[index];
    if (result.status === 'fulfilled') {
      return {
        url,
        success: result.value.success,
        error: result.value.error || null,
        data: result.value.data || null,
      };
    } else {
      return {
        url,
        success: false,
        error: result.reason?.message || 'Unknown error',
        data: null,
      };
    }
  });
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log('Google Search Console Bulk Indexing Script');
  console.log('='.repeat(50));

  if (!existsSync(SERVICE_ACCOUNT_FILE)) {
    console.log(`\nError: ${SERVICE_ACCOUNT_FILE} not found!`);
    console.log('\nSetup instructions:');
    console.log('1. Go to https://console.cloud.google.com/');
    console.log('2. Create/select a project');
    console.log('3. Enable "Indexing API"');
    console.log('4. Create a service account');
    console.log('5. Download JSON key and save as "service.json"');
    console.log(
      '6. Add the service account email to your Search Console property'
    );
    process.exit(1);
  }

  const db = initDb();
  const submittedUrls = getSubmittedUrls(db);
  console.log(
    `Found ${submittedUrls.size} previously submitted URLs in database`
  );

  console.log('\nFetching sitemap...');
  const xmlContent = await fetchSitemap(SITEMAP_URL);
  const allUrls = parseSitemap(xmlContent);
  console.log(`Found ${allUrls.length} URLs in sitemap`);

  const urlsToSubmit = allUrls.filter((url) => !submittedUrls.has(url));
  console.log(`\nURLs to submit: ${urlsToSubmit.length}`);

  if (urlsToSubmit.length === 0) {
    console.log('All URLs have already been submitted!');
    db.close();
    return;
  }

  console.log('\nAuthenticating with Google Search Console API...');
  let service;
  try {
    service = await getAuthenticatedService();
  } catch (error) {
    console.error(`Authentication failed: ${error.message}`);
    db.close();
    process.exit(1);
  }

  console.log('\nStarting URL submission...');
  console.log(
    '(Processing in batches of 100 URLs, Rate limit: ~200 URLs per day)'
  );

  let successCount = 0;
  let errorCount = 0;
  const batchSize = 100;
  const delayBetweenBatches = 1000;

  const batches = [];
  for (let i = 0; i < urlsToSubmit.length; i += batchSize) {
    batches.push(urlsToSubmit.slice(i, i + batchSize));
  }

  console.log(
    `Processing ${batches.length} batch(es) of up to ${batchSize} URLs each...\n`
  );

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const batch = batches[batchIndex];
    const batchNum = batchIndex + 1;

    console.log(
      `Processing batch ${batchNum}/${batches.length} (${batch.length} URLs)...`
    );

    const results = await submitBatch(service, batch);

    for (const result of results) {
      if (result.success) {
        markUrlSubmitted(db, result.url, 'submitted');
        successCount++;
      } else {
        markUrlSubmitted(db, result.url, `error: ${result.error}`);
        errorCount++;
        console.error(`Error submitting ${result.url}: ${result.error}`);
      }
    }

    console.log(
      `Batch ${batchNum} complete: ✓ ${
        results.filter((r) => r.success).length
      } submitted, ✗ ${results.filter((r) => !r.success).length} errors`
    );
    console.log(
      `Overall progress: ${successCount + errorCount}/${
        urlsToSubmit.length
      } (✓ ${successCount} submitted, ✗ ${errorCount} errors)\n`
    );

    if (batchIndex < batches.length - 1) {
      await sleep(delayBetweenBatches);
    }
  }

  console.log('\n' + '='.repeat(50));
  console.log('Submission complete!');
  console.log(`Successfully submitted: ${successCount}`);
  console.log(`Errors: ${errorCount}`);
  console.log(`Database saved to: ${DB_FILE}`);

  db.close();
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
