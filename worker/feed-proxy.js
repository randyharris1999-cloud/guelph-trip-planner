// Cloudflare Worker: relays Guelph Transit's GTFS-Realtime feeds to the browser with CORS headers.
// Endpoints: /vehicles  /alerts  /tripupdates
// Responses are edge-cached for 10 s, so many phones share one upstream request.
const UPSTREAM = {
  vehicles:    'https://glphprdtmgtfs.glphtrpcloud.com/tmgtfsrealtimewebservice/vehicle/vehiclepositions.pb',
  alerts:      'https://glphprdtmgtfs.glphtrpcloud.com/tmgtfsrealtimewebservice/alert/alerts.pb',
  tripupdates: 'https://glphprdtmgtfs.glphtrpcloud.com/tmgtfsrealtimewebservice/tripupdate/tripupdates.pb'
};
// Sites allowed to read the relay (your GitHub Pages site + local testing).
const ALLOWED = [
  'https://randyharris1999-cloud.github.io',
  'https://raw.githack.com',
  'http://localhost:8000'
];

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin') || '';
    const cors = {
      'Access-Control-Allow-Origin': ALLOWED.includes(origin) ? origin : ALLOWED[0],
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Vary': 'Origin'
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

    const kind = new URL(request.url).pathname.replace(/^\/+|\/+$/g, '');
    const upstream = UPSTREAM[kind];
    if (!upstream) return new Response('Use /vehicles, /alerts or /tripupdates', { status: 404, headers: cors });

    const r = await fetch(upstream, { cf: { cacheTtl: 10, cacheEverything: true } });
    if (!r.ok) return new Response('Upstream error ' + r.status, { status: 502, headers: cors });
    // trip updates are ~550 KB raw / ~80 KB gzipped — compress for phones
    const gz = (request.headers.get('Accept-Encoding') || '').includes('gzip');
    const body = gz ? r.body.pipeThrough(new CompressionStream('gzip')) : r.body;
    const headers = { ...cors, 'Content-Type': 'application/x-protobuf', 'Cache-Control': 'public, max-age=10' };
    if (gz) headers['Content-Encoding'] = 'gzip';
    return new Response(body, { headers, encodeBody: gz ? 'manual' : 'automatic' });
  }
};
