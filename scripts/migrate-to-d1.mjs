import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';

const execAsync = promisify(exec);

const DEFAULT_ENDPOINT =
  'https://e3715bd8aa0c6e455f26ccd0a2ba0919.r2.cloudflarestorage.com';
const DEFAULT_BUCKET = 'pics';
const DEFAULT_PUBLIC_BASE = 'https://media.indianluxurycars.com';
const DEFAULT_DB_NAME = 'used-cars-db';
const DEFAULT_ACCOUNT_ID = 'e3715bd8aa0c6e455f26ccd0a2ba0919';
const DEFAULT_DATABASE_ID = '98b1feaa-7ce3-4ee5-9714-03d284ac7134';

function getAuthHeaders(email, globalKey, apiToken) {
  if (apiToken) {
    return {
      Authorization: `Bearer ${apiToken}`,
    };
  } else if (email && globalKey) {
    return {
      'X-Auth-Email': email,
      'X-Auth-Key': globalKey,
    };
  } else {
    throw new Error(
      'Either CLOUDFLARE_API_TOKEN or both CLOUDFLARE_EMAIL and CLOUDFLARE_GLOBAL_KEY must be set'
    );
  }
}

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

function extractImages(car) {
  const images = [];

  // Add primary image if available
  if (car.pi && typeof car.pi === 'string' && isHttpUrl(car.pi)) {
    images.push(car.pi);
  }

  // Extract images from gallery_dto
  if (car.gallery_dto?.tabs && Array.isArray(car.gallery_dto.tabs)) {
    for (const tab of car.gallery_dto.tabs) {
      if (tab.list && Array.isArray(tab.list)) {
        for (const imgUrl of tab.list) {
          if (typeof imgUrl === 'string' && isHttpUrl(imgUrl)) {
            // Avoid duplicates
            if (!images.includes(imgUrl)) {
              images.push(imgUrl);
            }
          }
        }
      }
    }
  }

  // Limit to max 5 images
  return images.slice(0, 5);
}

async function ensureD1Database(dbName) {
  try {
    // Check if database exists by listing
    const { stdout } = await execAsync(`npx wrangler d1 list`);
    if (stdout.includes(dbName)) {
      console.log(`D1 database "${dbName}" already exists.`);
    } else {
      console.log(
        `D1 database "${dbName}" not found. Please create it first with: npm run d1:create`
      );
      console.log(
        'Or create it manually with: npx wrangler d1 create ' + dbName
      );
    }
  } catch (error) {
    console.warn(
      'Note: Make sure wrangler is installed and you are authenticated.'
    );
    console.warn('Create the database first with: npm run d1:create');
  }
}

async function createD1Tables(
  accountId,
  databaseId,
  email,
  globalKey,
  apiToken
) {
  const root = process.cwd();
  const schemaPath = path.join(root, 'scripts', 'd1-schema.sql');

  try {
    // Read schema file
    const schemaSql = await fs.readFile(schemaPath, 'utf8');

    // Remove comments and split by semicolons
    const lines = schemaSql.split('\n');
    const cleanedLines = lines
      .map((line) => {
        const commentIndex = line.indexOf('--');
        if (commentIndex >= 0) {
          return line.substring(0, commentIndex);
        }
        return line;
      })
      .join('\n');

    // Split by semicolons and filter out empty statements
    const statements = cleanedLines
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    // Execute each statement sequentially
    for (const statement of statements) {
      if (!statement) continue;

      try {
        await executeD1Query(
          accountId,
          databaseId,
          email,
          globalKey,
          apiToken,
          statement + ';'
        );
      } catch (error) {
        // Ignore "already exists" errors for tables/indexes
        const errorMsg = error.message.toLowerCase();
        if (
          errorMsg.includes('already exists') ||
          errorMsg.includes('duplicate') ||
          (errorMsg.includes('table') && errorMsg.includes('exists'))
        ) {
          console.log(
            `Skipping (already exists): ${statement.substring(0, 50)}...`
          );
          continue;
        }
        throw error;
      }
    }

    console.log('D1 tables created successfully.');
  } catch (error) {
    console.error('Error creating D1 tables:', error.message);
    throw error;
  }
}

async function createD1Database(accountId, dbName, email, globalKey, apiToken) {
  // Try using wrangler first if API token auth fails
  if (apiToken) {
    try {
      console.log('Attempting to create database via API...');
      const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database`;
      const headers = {
        ...getAuthHeaders(email, globalKey, apiToken),
        'Content-Type': 'application/json',
      };

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: dbName,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        // If auth fails with API token, try wrangler
        if (response.status === 401) {
          console.log('API token auth failed, trying wrangler...');
          return await createD1DatabaseViaWrangler(dbName);
        }
        // If database already exists, try to get its ID
        if (response.status === 400) {
          const errorData = JSON.parse(errorText);
          if (errorData.errors?.[0]?.code === 7502) {
            console.log(
              'Database already exists, fetching existing database...'
            );
            return await getD1DatabaseByName(
              accountId,
              dbName,
              email,
              globalKey,
              apiToken
            );
          }
        }
        throw new Error(
          `Failed to create D1 database (${response.status}): ${errorText}`
        );
      }

      const result = await response.json();
      if (!result.success) {
        // Check if database already exists
        if (result.errors?.[0]?.code === 7502) {
          console.log('Database already exists, fetching existing database...');
          return await getD1DatabaseByName(
            accountId,
            dbName,
            email,
            globalKey,
            apiToken
          );
        }
        throw new Error(
          `Failed to create D1 database: ${JSON.stringify(
            result.errors || result
          )}`
        );
      }

      return result.result;
    } catch (error) {
      if (
        error.message.includes('401') ||
        error.message.includes('Authentication')
      ) {
        console.log('API authentication failed, trying wrangler...');
        return await createD1DatabaseViaWrangler(dbName);
      }
      // Check if it's a 400 error about database existing
      if (
        error.message.includes('7502') ||
        error.message.includes('already exists')
      ) {
        console.log('Database already exists, fetching existing database...');
        return await getD1DatabaseByName(
          accountId,
          dbName,
          email,
          globalKey,
          apiToken
        );
      }
      throw error;
    }
  } else {
    // Use API with global key
    const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database`;
    const headers = {
      ...getAuthHeaders(email, globalKey, apiToken),
      'Content-Type': 'application/json',
    };

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: dbName,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      // If database already exists, try to get its ID
      if (response.status === 400) {
        try {
          const errorData = JSON.parse(errorText);
          if (errorData.errors?.[0]?.code === 7502) {
            console.log(
              'Database already exists, fetching existing database...'
            );
            return await getD1DatabaseByName(
              accountId,
              dbName,
              email,
              globalKey,
              apiToken
            );
          }
        } catch {
          // If parsing fails, continue with error
        }
      }
      throw new Error(
        `Failed to create D1 database (${response.status}): ${errorText}`
      );
    }

    const result = await response.json();
    if (!result.success) {
      // Check if database already exists
      if (result.errors?.[0]?.code === 7502) {
        console.log('Database already exists, fetching existing database...');
        return await getD1DatabaseByName(
          accountId,
          dbName,
          email,
          globalKey,
          apiToken
        );
      }
      throw new Error(
        `Failed to create D1 database: ${JSON.stringify(
          result.errors || result
        )}`
      );
    }

    return result.result;
  }
}

async function getD1DatabaseByName(
  accountId,
  dbName,
  email,
  globalKey,
  apiToken
) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database`;
  const headers = {
    ...getAuthHeaders(email, globalKey, apiToken),
    'Content-Type': 'application/json',
  };

  const response = await fetch(url, {
    method: 'GET',
    headers,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed to list D1 databases (${response.status}): ${errorText}`
    );
  }

  const result = await response.json();
  if (!result.success) {
    throw new Error(
      `Failed to list D1 databases: ${JSON.stringify(result.errors || result)}`
    );
  }

  const db = result.result?.find((d) => d.name === dbName);
  if (!db) {
    throw new Error(`Database "${dbName}" not found`);
  }

  console.log(`✓ Found existing database: ${dbName} (ID: ${db.uuid})`);
  return { uuid: db.uuid, name: db.name };
}

async function createD1DatabaseViaWrangler(dbName) {
  try {
    const { stdout } = await execAsync(`npx wrangler d1 create ${dbName}`);
    // Parse the database ID from wrangler output
    const dbIdMatch = stdout.match(/database_id[:\s]+([a-f0-9-]+)/i);
    if (dbIdMatch) {
      const databaseId = dbIdMatch[1];
      console.log(`✓ Database created via wrangler: ${databaseId}`);
      return { uuid: databaseId, name: dbName };
    }
    throw new Error('Could not parse database ID from wrangler output');
  } catch (error) {
    throw new Error(`Failed to create database via wrangler: ${error.message}`);
  }
}

async function testD1Connection(
  accountId,
  databaseId,
  email,
  globalKey,
  apiToken
) {
  try {
    const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;
    const headers = {
      ...getAuthHeaders(email, globalKey, apiToken),
      'Content-Type': 'application/json',
    };

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        sql: 'SELECT 1 as test;',
        params: [],
      }),
    });

    if (response.status === 401) {
      const errorText = await response.text();
      throw new Error(
        `Authentication failed. Your API token may be invalid, expired, or missing D1 permissions.\n` +
          `Response: ${errorText}\n\n` +
          `Please:\n` +
          `1. Go to https://dash.cloudflare.com/profile/api-tokens\n` +
          `2. Create a new token with "Account.Cloudflare D1:Edit" permission\n` +
          `3. Update CLOUDFLARE_API_TOKEN in your .env.local file`
      );
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `D1 connection test failed (${response.status}): ${errorText}`
      );
    }

    const result = await response.json();
    if (!result.success) {
      throw new Error(
        `D1 connection test failed: ${JSON.stringify(result.errors || result)}`
      );
    }

    return true;
  } catch (error) {
    throw error;
  }
}

async function executeD1Query(
  accountId,
  databaseId,
  email,
  globalKey,
  apiToken,
  sql,
  params = []
) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;
  const headers = {
    ...getAuthHeaders(email, globalKey, apiToken),
    'Content-Type': 'application/json',
  };

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      sql,
      params,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    let errorMessage = `D1 API error (${response.status}): ${errorText}`;

    if (response.status === 401) {
      errorMessage += '\n\nAuthentication failed. Please check:';
      errorMessage += '\n1. CLOUDFLARE_API_TOKEN is set correctly';
      errorMessage += '\n2. The token has D1 database permissions';
      errorMessage += '\n3. The token is not expired';
      errorMessage +=
        '\n\nGet a token at: https://developers.cloudflare.com/fundamentals/api/get-started/create-token/';
    }

    throw new Error(errorMessage);
  }

  const result = await response.json();
  if (!result.success) {
    throw new Error(
      `D1 query failed: ${JSON.stringify(result.errors || result)}`
    );
  }

  return result;
}

async function insertCarIntoD1(
  accountId,
  databaseId,
  email,
  globalKey,
  apiToken,
  car,
  imageUrls
) {
  const carParams = [
    car.used_car_id,
    car.used_car_sku_id || '',
    car.price || 0,
    car.formatted_price || '',
    car.msp,
    car.myear,
    car.model || '',
    car.variant_name,
    car.oem || '',
    car.km,
    car.ft,
    car.tt,
    car.city || '',
    car.city_id,
    car.locality,
    car.loc,
    car.bt,
    car.owner,
    car.owner_slug,
    car.dealer_id || 0,
    car.active !== false ? 1 : 0,
    car.inventory_status || 1,
    car.inventory_type_label,
    car.car_type,
    car.corporate_id,
    car.store_id,
    car.utype,
    car.vlink,
    car.from_url,
  ];

  const placeholders = carParams.map(() => '?').join(', ');
  const carSql = `INSERT OR REPLACE INTO used_cars (
		used_car_id, used_car_sku_id, price, formatted_price, msp, myear,
		model, variant_name, oem, km, fuel_type, transmission_type,
		city, city_id, locality, location, body_type, owner, owner_slug,
		dealer_id, active, inventory_status, inventory_type_label,
		car_type, corporate_id, store_id, utype, vlink, from_url
	) VALUES (${placeholders});`;

  try {
    // Insert car
    await executeD1Query(
      accountId,
      databaseId,
      email,
      globalKey,
      apiToken,
      carSql,
      carParams
    );

    // Delete existing images and insert new ones
    if (imageUrls.length > 0) {
      const deleteSql = `DELETE FROM car_images WHERE used_car_id = ?;`;
      await executeD1Query(
        accountId,
        databaseId,
        email,
        globalKey,
        apiToken,
        deleteSql,
        [car.used_car_id]
      );

      // Batch insert images - build VALUES clause with placeholders
      const imagePlaceholders = imageUrls.map(() => '(?, ?, ?, ?)').join(', ');
      const imageSql = `INSERT INTO car_images (used_car_id, image_url, image_order, is_primary) VALUES ${imagePlaceholders};`;
      const imageParams = imageUrls.flatMap((url, i) => [
        car.used_car_id,
        url,
        i,
        i === 0 ? 1 : 0,
      ]);
      await executeD1Query(
        accountId,
        databaseId,
        email,
        globalKey,
        apiToken,
        imageSql,
        imageParams
      );
    }
  } catch (error) {
    console.error(`Error inserting car ${car.used_car_id}:`, error.message);
    throw error;
  }
}

async function ensureUploaded(sourceUrl, client, bucket, publicBase, cache) {
  if (cache[sourceUrl]) return cache[sourceUrl];

  const res = await fetch(sourceUrl, {
    redirect: 'follow',
    headers: {
      'user-agent': 'indianluxurycars-image-migrator/1.0',
      accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
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
  const key = `used-cars/${hash}.${ext}`;
  const outUrl = `${publicBase}/${key}`;

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

async function main() {
  const root = process.cwd();
  await loadEnvFileIfPresent(path.join(root, '.env.local'));

  const apply = hasFlag('--apply');
  const dryRun = hasFlag('--dry-run') || !apply;
  const limit = Number(pickArg('--limit', '0')) || 0;
  const concurrency = Math.max(1, Number(pickArg('--concurrency', '4')) || 4);
  const dbName =
    process.env.D1_DATABASE_NAME || pickArg('--db', DEFAULT_DB_NAME);

  const endpoint = process.env.R2_ENDPOINT || DEFAULT_ENDPOINT;
  const bucket = process.env.R2_BUCKET || DEFAULT_BUCKET;
  const publicBase = normalizePublicBase(
    process.env.R2_PUBLIC_BASE || DEFAULT_PUBLIC_BASE
  );

  let client;
  if (apply) {
    const accessKeyId = process.env.R2_ACCESS_KEY_ID;
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
    if (!accessKeyId || !secretAccessKey) {
      throw new Error(
        'Missing credentials. Set R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY env vars.'
      );
    }
    client = new S3Client({
      region: 'auto',
      endpoint,
      credentials: { accessKeyId, secretAccessKey },
    });
  }

  const scriptsDir = path.join(root, 'scripts');
  const cachePath = path.join(scriptsDir, 'lux-cars-image-cache.json');
  const dataPath = path.join(root, 'src', 'data', 'lux-cars.json');

  await fs.mkdir(scriptsDir, { recursive: true });

  let cache = {};
  try {
    const cacheContent = await fs.readFile(cachePath, 'utf8');
    cache = JSON.parse(cacheContent) || {};
  } catch {
    cache = {};
  }

  console.log('Loading lux-cars.json...');
  const raw = await fs.readFile(dataPath, 'utf8');
  const cars = JSON.parse(raw);
  if (!Array.isArray(cars)) {
    throw new Error('lux-cars.json must be an array');
  }

  let carsToProcess = cars;
  if (limit > 0) {
    carsToProcess = cars.slice(0, limit);
  }

  console.log(
    `Processing ${carsToProcess.length} cars (out of ${cars.length} total)`
  );
  console.log(`Mode: ${apply ? 'apply' : 'dry-run'}`);

  // Get D1 credentials if applying
  let accountId, databaseId, apiToken, email, globalKey;
  if (apply) {
    accountId = process.env.CLOUDFLARE_ACCOUNT_ID || DEFAULT_ACCOUNT_ID;
    apiToken = process.env.CLOUDFLARE_API_TOKEN;
    email = process.env.CLOUDFLARE_EMAIL;
    globalKey = process.env.CLOUDFLARE_GLOBAL_KEY;

    // Support both API token and global key authentication
    // Prefer global key if both are present (more reliable)
    if (email && globalKey) {
      apiToken = undefined; // Use global key instead
      console.log('Using global API key authentication (preferred)');
    } else if (!apiToken && (!email || !globalKey)) {
      throw new Error(
        'Missing authentication. Set either:\n' +
          '  - CLOUDFLARE_API_TOKEN, or\n' +
          '  - Both CLOUDFLARE_EMAIL and CLOUDFLARE_GLOBAL_KEY\n' +
          'in your .env.local file.'
      );
    }

    // Create new database or use existing
    const createNewDb = hasFlag('--create-db');
    if (createNewDb) {
      console.log(`Creating new D1 database: ${dbName}...`);
      try {
        const newDb = await createD1Database(
          accountId,
          dbName,
          email,
          globalKey,
          apiToken
        );
        databaseId = newDb.uuid;
        console.log(`✓ Database created: ${dbName} (ID: ${databaseId})`);
        console.log(
          `\n⚠️  Update your wrangler.jsonc with this database_id:\n`
        );
        console.log(`  "database_id": "${databaseId}"\n`);
      } catch (error) {
        console.error('✗ Failed to create database:', error.message);
        throw error;
      }
    } else {
      databaseId = process.env.CLOUDFLARE_DATABASE_ID || DEFAULT_DATABASE_ID;
      console.log(`Using existing database: ${databaseId}`);
    }

    console.log(`Using account: ${accountId}, database: ${databaseId}`);
    if (apiToken) {
      console.log(
        `API token: ${apiToken.substring(0, 10)}...${apiToken.substring(
          apiToken.length - 4
        )}`
      );
    } else if (email && globalKey) {
      console.log(`Using global API key authentication (email: ${email})`);
    }

    // Test connection first
    console.log('Testing D1 connection...');
    try {
      await testD1Connection(accountId, databaseId, email, globalKey, apiToken);
      console.log('✓ D1 connection successful');
    } catch (error) {
      console.error('✗ D1 connection failed:', error.message);
      throw error;
    }

    // Create D1 database and tables
    console.log('Creating D1 tables...');
    await ensureD1Database(dbName);
    try {
      await createD1Tables(accountId, databaseId, email, globalKey, apiToken);
    } catch (error) {
      if (error.message.includes('Authentication')) {
        throw error; // Already tested, so this shouldn't happen
      }
      throw error;
    }
  }

  // Collect all image URLs
  const imageUrlMap = new Map(); // car.used_car_id -> [originalUrls]
  const allImageUrls = new Set();

  for (const car of carsToProcess) {
    if (!car.used_car_id) continue;
    const images = extractImages(car);
    if (images.length > 0) {
      imageUrlMap.set(car.used_car_id, images);
      for (const url of images) {
        if (!url.startsWith(publicBase + '/')) {
          allImageUrls.add(url);
        }
      }
    }
  }

  console.log(`Found ${allImageUrls.size} unique images to upload`);

  // Upload images
  let uploaded = 0;
  let failed = 0;

  if (apply && client) {
    const urlsToUpload = Array.from(allImageUrls).filter((u) => !cache[u]);
    console.log(
      `Uploading ${urlsToUpload.length} images (${
        allImageUrls.size - urlsToUpload.length
      } cached)...`
    );

    await mapWithConcurrency(urlsToUpload, concurrency, async (url) => {
      try {
        await ensureUploaded(url, client, bucket, publicBase, cache);
        uploaded++;
        if (uploaded % 50 === 0) {
          console.log(`Uploaded ${uploaded}/${urlsToUpload.length} images...`);
        }
      } catch (error) {
        failed++;
        console.warn(`Failed to upload ${url}:`, error.message);
      }
    });

    // Save cache
    await fs.writeFile(
      cachePath,
      JSON.stringify(cache, null, 2) + '\n',
      'utf8'
    );
    console.log(
      `Image upload complete. Uploaded: ${uploaded}, Failed: ${failed}`
    );
  }

  // Insert cars into D1
  if (apply) {
    console.log('Inserting cars into D1...');
    let inserted = 0;
    let insertFailed = 0;

    // D1 imports must be sequential - cannot run in parallel
    for (const car of carsToProcess) {
      if (!car.used_car_id) continue;

      try {
        const originalImages = imageUrlMap.get(car.used_car_id) || [];
        const uploadedImages = originalImages.map((url) => cache[url] || url);

        await insertCarIntoD1(
          accountId,
          databaseId,
          email,
          globalKey,
          apiToken,
          car,
          uploadedImages
        );
        inserted++;

        if (inserted % 100 === 0) {
          console.log(`Inserted ${inserted}/${carsToProcess.length} cars...`);
        }
      } catch (error) {
        insertFailed++;
        console.warn(`Failed to insert car ${car.used_car_id}:`, error.message);
      }
    }

    console.log(
      `Migration complete! Inserted: ${inserted}, Failed: ${insertFailed}`
    );
  } else {
    console.log('Dry-run complete. Use --apply to perform the migration.');
  }
}

await main().catch(console.error);
