const DEFAULT_BBOX = [130.4, 32.6, 131.0, 33.1];
const API_URL = 'https://api.jartic-open-traffic.org/geoserver';
const CACHE_TTL = 300;

function jsonResponse(body, status, origin) {
  const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': `public, max-age=${CACHE_TTL}` });
  if (origin) headers.set('Access-Control-Allow-Origin', origin);
  headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type');
  return new Response(JSON.stringify(body), { status, headers });
}

function numberParam(url, name, fallback) { const value = Number(url.searchParams.get(name)); return Number.isFinite(value) ? value : fallback; }
function makeTimeCode() { const date = new Date(Date.now() - 25 * 60 * 1000); date.setMinutes(Math.floor(date.getMinutes() / 5) * 5, 0, 0); const pad = (number) => String(number).padStart(2, '0'); return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}${pad(date.getHours())}${pad(date.getMinutes())}`; }
function allowedBounds(url) { const bbox = [numberParam(url, 'minX', DEFAULT_BBOX[0]), numberParam(url, 'minY', DEFAULT_BBOX[1]), numberParam(url, 'maxX', DEFAULT_BBOX[2]), numberParam(url, 'maxY', DEFAULT_BBOX[3])]; const isValid = bbox[0] >= 129.5 && bbox[2] <= 132.0 && bbox[1] >= 31.5 && bbox[3] <= 34.0 && bbox[0] < bbox[2] && bbox[1] < bbox[3]; return isValid ? bbox : DEFAULT_BBOX; }
function buildApiUrl(url) { const bbox = allowedBounds(url); const time = /^\d{12}$/.test(url.searchParams.get('time') || '') ? url.searchParams.get('time') : makeTimeCode(); const roadType = ['1', '3'].includes(url.searchParams.get('roadType')) ? url.searchParams.get('roadType') : '3'; const cql = `"道路種別" = '${roadType}' AND "時間コード" = ${time} AND BBOX("ジオメトリ",${bbox.join(',')},'EPSG:4326')`; const params = new URLSearchParams({ service: 'WFS', version: '2.0.0', request: 'GetFeature', typeNames: 't_travospublic_measure_5m', srsName: 'EPSG:4326', outputFormat: 'application/json', exceptions: 'application/json', cql_filter: cql }); return { url: `${API_URL}?${params.toString()}`, bbox, time, roadType }; }

export default {
  async fetch(request, env, ctx) {
    const requestUrl = new URL(request.url); const origin = request.headers.get('Origin'); const allowedOrigin = env.ALLOWED_ORIGIN || '';
    if (origin && origin !== allowedOrigin) return jsonResponse({ error: 'origin_not_allowed' }, 403, '');
    if (request.method === 'OPTIONS') return jsonResponse({ ok: true }, 204, origin === allowedOrigin ? origin : '');
    if (request.method !== 'GET') return jsonResponse({ error: 'method_not_allowed' }, 405, origin === allowedOrigin ? origin : '');
    if (!allowedOrigin) return jsonResponse({ error: 'ALLOWED_ORIGIN_not_configured' }, 500, '');
    const apiRequest = buildApiUrl(requestUrl); const cacheKey = new Request(apiRequest.url, { method: 'GET' }); const cache = caches.default; const cached = await cache.match(cacheKey); if (cached) return jsonResponse(await cached.json(), 200, origin === allowedOrigin ? origin : '');
    try {
      const upstream = await fetch(apiRequest.url, { method: 'GET', headers: { Accept: 'application/json' } });
      if (!upstream.ok) return jsonResponse({ error: 'upstream_error', status: upstream.status }, 502, origin === allowedOrigin ? origin : '');
      const data = await upstream.json();
      const cacheResponse = new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': `public, max-age=${CACHE_TTL}` } });
      ctx.waitUntil(cache.put(cacheKey, cacheResponse.clone()));
      return jsonResponse(data, 200, origin === allowedOrigin ? origin : '');
    } catch (error) { return jsonResponse({ error: 'upstream_unavailable' }, 502, origin === allowedOrigin ? origin : ''); }
  }
};
