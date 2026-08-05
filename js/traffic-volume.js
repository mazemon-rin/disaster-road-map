(() => {
  'use strict';

  const RETRIES = 3;
  const LOOKBACK_MINUTES = [25, 30, 35];
  const THRESHOLDS = { low: 20, normal: 50 };
  const fieldNames = {
    upSmall: ['上り・小型交通量'],
    upLarge: ['上り・大型交通量'],
    upUnknown: ['上り・車種判別不能交通量'],
    downSmall: ['下り・小型交通量'],
    downLarge: ['下り・大型交通量'],
    downUnknown: ['下り・車種判別不能交通量'],
    date: ['観測年月日'],
    time: ['時間帯'],
    timeCode: ['時間コード'],
    station: ['常時観測点コード'],
    upPower: ['上り・停電'],
    upLoop: ['上り・ループ異常'],
    upUltrasonic: ['上り・超音波異常'],
    upMissing: ['上り・欠測'],
    downPower: ['下り・停電'],
    downLoop: ['下り・ループ異常'],
    downUltrasonic: ['下り・超音波異常'],
    downMissing: ['下り・欠測'],
  };

  function workerUrl() {
    return String(window.APP_CONFIG?.trafficVolumeWorkerUrl || '').trim().replace(/\/$/, '');
  }

  function value(properties, names) {
    const key = names.find((name) => Object.prototype.hasOwnProperty.call(properties || {}, name));
    return key ? properties[key] : null;
  }

  function metric(raw) {
    if (raw === null || raw === undefined || String(raw).trim() === '') return null;
    const number = Number(raw);
    return Number.isFinite(number) ? number : null;
  }

  function isFlagged(raw) {
    return raw === true || ['1', 'true', '異常', '欠測'].includes(String(raw).trim().toLowerCase());
  }

  function timeCode(minutesAgo) {
    const date = new Date(Date.now() - minutesAgo * 60 * 1000);
    date.setMinutes(Math.floor(date.getMinutes() / 5) * 5, 0, 0);
    const pad = (number) => String(number).padStart(2, '0');
    return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}${pad(date.getHours())}${pad(date.getMinutes())}`;
  }

  function bboxFromMap(map) {
    const bounds = map.getBounds();
    return [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()];
  }

  function buildUrl({ bbox, time, roadType = '3' }) {
    const params = new URLSearchParams({
      minX: bbox[0],
      minY: bbox[1],
      maxX: bbox[2],
      maxY: bbox[3],
      time,
      roadType,
    });
    return `${workerUrl()}?${params.toString()}`;
  }

  function formatObservedAt(dateValue, timeValue, codeValue) {
    const code = String(codeValue || '').replace(/\D/g, '');
    if (/^\d{12}$/.test(code)) {
      return `${code.slice(0, 4)}/${code.slice(4, 6)}/${code.slice(6, 8)} ${code.slice(8, 10)}:${code.slice(10, 12)}`;
    }

    const date = String(dateValue || '').replace(/\D/g, '');
    const time = String(timeValue || '').replace(/\D/g, '').padStart(4, '0');
    if (/^\d{8}$/.test(date) && /^\d{4}$/.test(time)) {
      return `${date.slice(0, 4)}/${date.slice(4, 6)}/${date.slice(6, 8)} ${time.slice(0, 2)}:${time.slice(2, 4)}`;
    }
    return 'データなし';
  }

  function directionValues(properties, direction) {
    const prefix = direction === 'up' ? 'up' : 'down';
    const missing = isFlagged(value(properties, fieldNames[`${prefix}Missing`]));
    const values = {
      small: metric(value(properties, fieldNames[`${prefix}Small`])),
      large: metric(value(properties, fieldNames[`${prefix}Large`])),
      unknown: metric(value(properties, fieldNames[`${prefix}Unknown`])),
      missing,
    };
    return missing ? { ...values, small: null, large: null, unknown: null } : values;
  }

  function parseFeature(feature, fetchedAt) {
    const properties = feature.properties || {};
    const geometry = feature.geometry || {};
    const coordinates = geometry.type === 'MultiPoint'
      ? geometry.coordinates
      : geometry.type === 'Point'
        ? [geometry.coordinates]
        : [];
    const up = directionValues(properties, 'up');
    const down = directionValues(properties, 'down');
    const anomalies = {
      upPower: isFlagged(value(properties, fieldNames.upPower)),
      upLoop: isFlagged(value(properties, fieldNames.upLoop)),
      upUltrasonic: isFlagged(value(properties, fieldNames.upUltrasonic)),
      upMissing: up.missing,
      downPower: isFlagged(value(properties, fieldNames.downPower)),
      downLoop: isFlagged(value(properties, fieldNames.downLoop)),
      downUltrasonic: isFlagged(value(properties, fieldNames.downUltrasonic)),
      downMissing: down.missing,
    };
    const numericValues = [up.small, up.large, up.unknown, down.small, down.large, down.unknown]
      .filter((item) => item !== null);
    const total = numericValues.length ? numericValues.reduce((sum, item) => sum + item, 0) : null;
    const hasAnomaly = Object.values(anomalies).some(Boolean);

    return coordinates
      .filter((point) => Array.isArray(point) && point.length >= 2)
      .map((point) => ({
        latitude: Number(point[1]),
        longitude: Number(point[0]),
        station: value(properties, fieldNames.station) || 'データなし',
        observedAt: formatObservedAt(value(properties, fieldNames.date), value(properties, fieldNames.time), value(properties, fieldNames.timeCode)),
        fetchedAt,
        up,
        down,
        total,
        anomalies,
        level: total === null ? 'no-data' : total <= THRESHOLDS.low ? 'low' : total <= THRESHOLDS.normal ? 'normal' : 'high',
      }));
  }

  function parseGeoJson(data, fetchedAt) {
    if (data?.type !== 'FeatureCollection' || !Array.isArray(data.features)) {
      throw new Error('INVALID_GEOJSON');
    }
    return data.features
      .flatMap((feature) => parseFeature(feature, fetchedAt))
      .filter((item) => Number.isFinite(item.latitude) && Number.isFinite(item.longitude));
  }

  async function fetchJson(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!response.ok) {
        const error = new Error(`HTTP_${response.status}`);
        error.status = response.status;
        throw error;
      }
      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  }

  async function fetchTrafficVolume({ map, roadType = '3' } = {}) {
    if (!workerUrl()) throw new Error('WORKER_URL_REQUIRED');
    if (!map) throw new Error('MAP_REQUIRED');

    const bbox = bboxFromMap(map);
    let lastError;

    for (let index = 0; index < Math.min(RETRIES, LOOKBACK_MINUTES.length); index += 1) {
      const requestedCode = timeCode(LOOKBACK_MINUTES[index]);
      try {
        const data = await fetchJson(buildUrl({ bbox, time: requestedCode, roadType }));
        const fetchedAt = new Date().toISOString();
        const points = parseGeoJson(data, fetchedAt);
        if (points.length) {
          return { points, observedCode: requestedCode, fetchedAt, bbox, source: '国土交通省交通量API（xROAD/JARTIC）' };
        }
        lastError = new Error('NO_DATA');
      } catch (error) {
        lastError = error;
        if (error.status === 401 || error.status === 403 || error.message === 'INVALID_GEOJSON') break;
      }
    }
    throw lastError || new Error('NO_DATA');
  }

  function createPopup(point) {
    const display = (number, missing) => missing ? '欠測' : number === null ? 'データなし' : `${number}台`;
    const anomalyNames = [
      ['upPower', '上り停電'], ['upLoop', '上りループ異常'], ['upUltrasonic', '上り超音波異常'], ['upMissing', '上り欠測'],
      ['downPower', '下り停電'], ['downLoop', '下りループ異常'], ['downUltrasonic', '下り超音波異常'], ['downMissing', '下り欠測'],
    ];
    const anomalies = anomalyNames.filter(([key]) => point.anomalies[key]).map(([, label]) => label);
    const anomalyText = anomalies.length ? `<br><strong>データ異常：</strong>${anomalies.join('、')}` : '';
    const level = point.level === 'low' ? '少なめ' : point.level === 'normal' ? '普通' : point.level === 'high' ? '多め' : '判定不可';
    const total = point.total === null ? 'データなし' : `${point.total}台 / 5分`;

    return `<strong>交通量情報</strong><br>観測時刻：${point.observedAt}<hr><strong>上り</strong><br>小型：${display(point.up.small, point.up.missing)}　大型：${display(point.up.large, point.up.missing)}　その他：${display(point.up.unknown, point.up.missing)}<br><strong>下り</strong><br>小型：${display(point.down.small, point.down.missing)}　大型：${display(point.down.large, point.down.missing)}　その他：${display(point.down.unknown, point.down.missing)}<br><strong>5分間合計：${total}</strong><br>交通量参考：${level}${anomalyText}<br><small>観測点コード：${point.station}<br>情報元：国土交通省交通量API（xROAD/JARTIC）<br>アプリ取得時刻：${new Intl.DateTimeFormat('ja-JP', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(point.fetchedAt))}<br>※交通量は参考値です。道路の通行可否・安全性を保証するものではありません。</small>`;
  }

  function createMarker(point) {
    return L.circleMarker([point.latitude, point.longitude], {
      radius: 5,
      color: '#1769aa',
      fillColor: '#55a9d6',
      fillOpacity: 0.9,
      weight: 2,
      // 青い観測点を押したときは、地図クリックとして扱わず交通量ポップアップだけを開く。
      bubblingMouseEvents: false,
    }).bindPopup(createPopup(point));
  }

  // 観測地点の近接関係だけを参考線で表示する。実際の道路形状や渋滞を示す線ではない。
  function createReferenceLines(points) {
    const maxDistance = 0.08;
    const lines = [];
    const linked = new Set();
    const color = (first, second) => {
      const levels = [first.level, second.level];
      if (levels.includes('high')) return '#c64a4a';
      if (levels.includes('normal')) return '#d39721';
      if (levels.includes('low')) return '#3f8f68';
      return '#7a9bb0';
    };
    const distance = (first, second) => Math.hypot(
      (first.latitude - second.latitude) * 1.1,
      (first.longitude - second.longitude) * 0.92,
    );

    points.forEach((point, index) => {
      const candidates = points
        .map((other, otherIndex) => ({ other, otherIndex, distance: distance(point, other) }))
        .filter(({ otherIndex, distance: value }) => otherIndex !== index && value <= maxDistance)
        .sort((first, second) => first.distance - second.distance)
        .slice(0, 2);
      candidates.forEach(({ other, otherIndex }) => {
        const key = index < otherIndex ? `${index}-${otherIndex}` : `${otherIndex}-${index}`;
        if (linked.has(key)) return;
        linked.add(key);
        lines.push(L.polyline(
          [[point.latitude, point.longitude], [other.latitude, other.longitude]],
          { color: color(point, other), weight: 3, opacity: 0.68, dashArray: '7 7', interactive: false },
        ));
      });
    });
    return lines;
  }

  window.TrafficVolume = { fetchTrafficVolume, createMarker, createReferenceLines, buildUrl, timeCode, THRESHOLDS };
})();
