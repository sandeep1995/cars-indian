import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

const DEFAULT_DB_NAME = 'used-cars-db';

function pickArg(flag, fallback) {
	const idx = process.argv.indexOf(flag);
	if (idx === -1) return fallback;
	return process.argv[idx + 1] ?? fallback;
}

async function main() {
	const dbName = process.env.D1_DATABASE_NAME || pickArg('--db', DEFAULT_DB_NAME);
	
	console.log(`Creating D1 database: ${dbName}...`);
	
	try {
		const { stdout, stderr } = await execAsync(`npx wrangler d1 create ${dbName}`);
		console.log(stdout);
		if (stderr) console.warn(stderr);
		
		console.log('\nDatabase created successfully!');
		console.log('Next steps:');
		console.log('1. Copy the database_id from the output above');
		console.log('2. Update wrangler.jsonc with the database_id in d1_databases section');
		console.log('3. Run: npm run d1:migrate:apply');
	} catch (error) {
		console.error('Error creating database:', error.message);
		process.exit(1);
	}
}

await main();

