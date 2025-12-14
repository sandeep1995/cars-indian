import type { APIRoute } from 'astro';

function absolute(site: URL | undefined, pathname: string): string {
	if (!site) return pathname;
	return new URL(pathname, site).toString();
}

export const GET: APIRoute = ({ site }) => {
	const lines = [
		'User-agent: *',
		'Allow: /',
		`Sitemap: ${absolute(site, '/sitemap.xml')}`,
		'',
	];

	return new Response(lines.join('\n'), {
		headers: { 'Content-Type': 'text/plain; charset=utf-8' },
	});
};


