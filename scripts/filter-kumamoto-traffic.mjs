#!/usr/bin/env node

/**
 * 全国分の交通規制データから熊本県周辺だけを抽出し、
 * アプリが読み込めるJSONへ変換します。
 *
 * 入力は、JSON配列またはCSVです。JARTICの実ファイルを使う場合は、
 * 公式の利用規約と列名を確認したうえで、列名の対応を追加してください。
 */
import fs from 'node:fs';
import path from 'node:path';

const [inputPath, outputPath = 'data/traffic-restrictions.json'] = process.argv.slice(2);
if (!inputPath) {
  console.error('Usage: node scripts/filter-kumamoto-traffic.mjs INPUT [OUTPUT]');
  process.exit(1);
}

const KUMAMOTO_BOUNDS = { minLat: 32.0, maxLat: 33.2, minLng: 130.0, maxLng: 131.5 };
const text = fs.readFileSync(inputPath, 'utf8').replace(/^\uFEFF/, '');
const normalize = (value) => String(value ?? '').trim();
const aliases = {
  id: ['id', 'ID', '規制ID'], latitude: ['latitude', 'lat', '緯度'], longitude: ['longitude', 'lng', 'lon', '経度'],
  category: ['category', '種別', '規制種別'], title: ['title', '名称', '規制内容'], detail: ['detail', '詳細', '規制原因'],
  roadName: ['roadName', 'road_name', '路線名', '道路名'], updatedAt: ['updatedAt', '更新日時', '更新時刻'],
  source: ['source', '情報元', '出典'], sourceUrl: ['sourceUrl', 'source_url', '情報元URL', '出典URL']
};

function findValue(row, key) {
  const names = aliases[key];
  const found = names.find((name) => Object.prototype.hasOwnProperty.call(row, name));
  return found ? normalize(row[found]) : '';
}

function parseCsv(value) {
  const rows = []; let row = []; let cell = ''; let quoted = false;
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i]; const next = value[i + 1];
    if (char === '"' && quoted && next === '"') { cell += '"'; i += 1; continue; }
    if (char === '"') { quoted = !quoted; continue; }
    if (char === ',' && !quoted) { row.push(cell); cell = ''; continue; }
    if ((char === '\n' || char === '\r') && !quoted) { if (char === '\r' && next === '\n') i += 1; row.push(cell); if (row.some((item) => item.trim())) rows.push(row); row = []; cell = ''; continue; }
    cell += char;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const headers = rows.shift()?.map(normalize) || [];
  return rows.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] || ''])));
}

function categoryFor(item) {
  const value = `${item.category} ${item.title} ${item.detail}`;
  if (value.includes('通行止')) return 'road_closed';
  if (value.includes('車線')) return 'lane_restriction';
  if (value.includes('片側交互')) return 'alternating';
  return 'other';
}

const parsed = text.trim().startsWith('[') ? JSON.parse(text) : parseCsv(text);
const rows = Array.isArray(parsed) ? parsed : Array.isArray(parsed.items) ? parsed.items : [];
const items = rows.map((row, index) => {
  const latitude = Number(findValue(row, 'latitude')); const longitude = Number(findValue(row, 'longitude'));
  const item = { id: findValue(row, 'id') || `jartic-${index + 1}`, latitude, longitude, category: categoryFor({ category: findValue(row, 'category'), title: findValue(row, 'title'), detail: findValue(row, 'detail') }), title: findValue(row, 'title') || '交通規制', detail: findValue(row, 'detail'), roadName: findValue(row, 'roadName') || '道路名未登録', updatedAt: findValue(row, 'updatedAt') || null, source: findValue(row, 'source') || 'JARTIC公開データ', sourceUrl: findValue(row, 'sourceUrl') || 'https://www.jartic.or.jp/' };
  return item;
}).filter((item) => Number.isFinite(item.latitude) && Number.isFinite(item.longitude) && item.latitude >= KUMAMOTO_BOUNDS.minLat && item.latitude <= KUMAMOTO_BOUNDS.maxLat && item.longitude >= KUMAMOTO_BOUNDS.minLng && item.longitude <= KUMAMOTO_BOUNDS.maxLng);
const dates = items.map((item) => item.updatedAt).filter(Boolean).sort();
const output = { updatedAt: dates.at(-1) || null, source: items.length ? 'JARTIC公開データ（熊本県内抽出）' : '未接続', items };
fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
console.log(`熊本県内の交通規制 ${items.length}件を ${outputPath} に出力しました。`);
