const DEFAULT_ALLOWED_ORIGIN = 'https://mazemon-rin.github.io';
const DEFAULT_BBOX = [130.4, 32.6, 131.0, 33.1];
const API_URL = 'https://api.jartic-open-traffic.org/geoserver';
const CACHE_TTL = 300;

function corsHeaders(origin) {
  const headers = new Headers({
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });

  if (origin === DEFAULT_ALLOWED_ORIGIN) {
    headers.set(
      'Access-Control-Allow-Origin',
      DEFAULT_ALLOWED_ORIGIN,
    );
  }

  return headers;
}

function jsonResponse(
  body,
  status,
  origin,
  cacheControl = 'no-store',
) {
  const headers = corsHeaders(origin);

  headers.set(
    'Content-Type',
    'application/json; charset=utf-8',
  );

  headers.set(
    'Cache-Control',
    cacheControl,
  );

  return new Response(
    JSON.stringify(body),
    {
      status,
      headers,
    },
  );
}

function numberParam(url, name, fallback) {
  const raw = url.searchParams.get(name);

  if (raw === null || raw === '') {
    return fallback;
  }

  const value = Number(raw);

  return Number.isFinite(value)
    ? value
    : fallback;
}

function makeTimeCode() {
  /*
   * JARTICの5分値は観測直後ではなく、
   * おおむね20分後以降に取得可能。
   *
   * Cloudflare WorkersはUTC基準なので、
   * 25分前の時刻をJST（UTC+9）へ変換する。
   */
  const date = new Date(
    Date.now()
      - 25 * 60 * 1000
      + 9 * 60 * 60 * 1000,
  );

  // 5分単位に切り捨て
  date.setUTCMinutes(
    Math.floor(
      date.getUTCMinutes() / 5,
    ) * 5,
    0,
    0,
  );

  const pad = (value) =>
    String(value).padStart(2, '0');

  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
  ].join('');
}

function getBbox(url) {
  const bbox = [
    numberParam(
      url,
      'minX',
      DEFAULT_BBOX[0],
    ),
    numberParam(
      url,
      'minY',
      DEFAULT_BBOX[1],
    ),
    numberParam(
      url,
      'maxX',
      DEFAULT_BBOX[2],
    ),
    numberParam(
      url,
      'maxY',
      DEFAULT_BBOX[3],
    ),
  ];

  /*
   * 異常な座標・極端に広い範囲の取得を防ぐ。
   * 今回は九州・熊本周辺を想定。
   */
  const isValid =
    bbox[0] >= 129.5
    && bbox[2] <= 132.0
    && bbox[1] >= 31.5
    && bbox[3] <= 34.0
    && bbox[0] < bbox[2]
    && bbox[1] < bbox[3];

  return isValid
    ? bbox
    : DEFAULT_BBOX;
}

function buildApiRequest(url) {
  const bbox = getBbox(url);

  const requestedTime =
    url.searchParams.get('time') || '';

  const time =
    /^\d{12}$/.test(requestedTime)
      ? requestedTime
      : makeTimeCode();

  const requestedRoadType =
    url.searchParams.get('roadType');

  const roadType =
    ['1', '3'].includes(
      requestedRoadType,
    )
      ? requestedRoadType
      : '3';

  /*
   * JARTIC公式仕様書の例に近い形で
   * 3条件を1つのcql_filterへまとめる。
   */
  const cqlFilter = [
    `道路種別=${roadType}`,
    `時間コード=${time}`,
    `BBOX(ジオメトリ,${bbox.join(',')},'EPSG:4326')`,
  ].join(' AND ');

  const params =
    new URLSearchParams({
      service: 'WFS',
      version: '2.0.0',
      request: 'GetFeature',
      typeNames:
        't_travospublic_measure_5m',
      srsName: 'EPSG:4326',
      outputFormat:
        'application/json',
      exceptions:
        'application/json',
      cql_filter: cqlFilter,
    });

  return {
    url:
      `${API_URL}?${params.toString()}`,
    bbox,
    time,
    roadType,
  };
}

function cacheKey(url) {
  return new Request(
    url,
    {
      method: 'GET',
    },
  );
}

export default {
  async fetch(request, env, ctx) {
    const requestUrl =
      new URL(request.url);

    const origin =
      request.headers.get('Origin');

    const allowedOrigin =
      env.ALLOWED_ORIGIN
      || DEFAULT_ALLOWED_ORIGIN;

    /*
     * 設定値が想定外の場合は、
     * 意図せず別Originを許可しない。
     */
    if (
      allowedOrigin
      !== DEFAULT_ALLOWED_ORIGIN
    ) {
      console.error(
        'Invalid ALLOWED_ORIGIN configuration',
      );

      return jsonResponse(
        {
          error:
            'invalid_worker_configuration',
        },
        500,
        origin,
      );
    }

    /*
     * GitHub Pages以外のOriginは拒否。
     *
     * URL直接アクセスなど、
     * Origin自体が無い場合は
     * API接続確認用として許可する。
     */
    if (
      origin
      && origin !== allowedOrigin
    ) {
      console.warn(
        'Blocked origin:',
        origin,
      );

      return jsonResponse(
        {
          error:
            'origin_not_allowed',
        },
        403,
        origin,
      );
    }

    if (
      request.method === 'OPTIONS'
    ) {
      return new Response(
        null,
        {
          status: 204,
          headers:
            corsHeaders(origin),
        },
      );
    }

    if (
      request.method !== 'GET'
    ) {
      return jsonResponse(
        {
          error:
            'method_not_allowed',
        },
        405,
        origin,
      );
    }

    try {
      const apiRequest =
        buildApiRequest(
          requestUrl,
        );

      const key =
        cacheKey(
          apiRequest.url,
        );

      const cache =
        caches.default;

      const cached =
        await cache.match(key);

      if (cached) {
        console.log(
          'Traffic cache hit:',
          apiRequest.time,
        );

        const cachedData =
          await cached.json();

        return jsonResponse(
          cachedData,
          200,
          origin,
          `public, max-age=${CACHE_TTL}`,
        );
      }

      console.log(
        'Traffic API request:',
        {
          method: 'GET',
          time:
            apiRequest.time,
          roadType:
            apiRequest.roadType,
          bbox:
            apiRequest.bbox.join(','),
        },
      );

      /*
       * 実際にJARTICへ送るURLを
       * Cloudflare Consoleで確認可能。
       */
      console.log(
        'JARTIC request URL:',
        apiRequest.url,
      );

      /*
       * JARTICへは純粋なGET。
       *
       * request bodyなし
       * Content-Typeなし
       * Authorizationなし
       */
      const upstream =
        await fetch(
          apiRequest.url,
          {
            method: 'GET',
            headers: {
              Accept:
                'application/json',
            },
          },
        );

      const upstreamContentType =
        upstream.headers.get(
          'Content-Type',
        ) || '';

      if (!upstream.ok) {
        const errorText =
          await upstream.text();

        /*
         * HTTP 400等の場合、
         * 原因調査用としてConsoleに
         * レスポンスを最大1000文字表示。
         */
        console.error(
          'Traffic API error:',
          {
            status:
              upstream.status,
            contentType:
              upstreamContentType,
            url:
              apiRequest.url,
            body:
              errorText.slice(
                0,
                1000,
              ),
          },
        );

        return jsonResponse(
          {
            error:
              'upstream_error',
            status:
              upstream.status,
          },
          502,
          origin,
        );
      }

      let data;

      try {
        data =
          await upstream.json();
      } catch (error) {
        console.error(
          'Traffic API JSON parse error:',
          {
            contentType:
              upstreamContentType,
            message:
              error?.message
              || String(error),
          },
        );

        return jsonResponse(
          {
            error:
              'invalid_upstream_json',
          },
          502,
          origin,
        );
      }

      const featureCount =
        Array.isArray(
          data.features,
        )
          ? data.features.length
          : 0;

      console.log(
        'Traffic API success:',
        {
          status:
            upstream.status,
          contentType:
            upstreamContentType,
          featureCount,
          time:
            apiRequest.time,
          roadType:
            apiRequest.roadType,
          bbox:
            apiRequest.bbox.join(','),
        },
      );

      /*
       * Worker側で5分キャッシュ。
       */
      const cachedResponse =
        new Response(
          JSON.stringify(data),
          {
            status: 200,
            headers: {
              'Content-Type':
                'application/json; charset=utf-8',
              'Cache-Control':
                `public, max-age=${CACHE_TTL}`,
            },
          },
        );

      ctx.waitUntil(
        cache.put(
          key,
          cachedResponse,
        ),
      );

      return jsonResponse(
        data,
        200,
        origin,
        `public, max-age=${CACHE_TTL}`,
      );
    } catch (error) {
      console.error(
        'Traffic Worker failure:',
        error?.message
        || error,
      );

      /*
       * JARTICに障害があっても、
       * Worker自体を落とさない。
       */
      return jsonResponse(
        {
          error:
            'upstream_unavailable',
        },
        502,
        origin,
      );
    }
  },
};