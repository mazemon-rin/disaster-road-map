(() => {
  'use strict';

  const RECORDS_KEY = 'kumamoto-disaster-road-records';
  const FIRST_USE_KEY = 'kumamoto-disaster-road-first-use';
  const KUMAMOTO = [32.8031, 130.7079];
  const regions = {
    kumamoto: [32.8031, 130.7079, 11], mashiki: [32.795, 130.81, 13], kashima: [32.739, 130.757, 13],
    mifune: [32.713, 130.8, 13], uto: [32.687, 130.664, 13], uki: [32.647, 130.684, 12],
    aso: [32.95, 131.12, 10], yatsushiro: [32.51, 130.6, 11], hitoyoshi: [32.21, 130.76, 11]
  };
  const officialLinks = [
    ['JARTIC 道路交通情報', 'https://www.jartic.or.jp/'], ['NEXCO西日本 iHighway', 'https://ihighway.jp/pcsite/'],
    ['熊本県 防災情報', 'https://www.pref.kumamoto.jp/bousai/'], ['国土交通省 九州地方整備局', 'https://www.qsr.mlit.go.jp/'],
    ['熊本河川国道事務所 道路情報', 'https://www.qsr.mlit.go.jp/kumamoto/road/index.html'], ['国土交通省 道路情報提供システム', 'https://www.road-info-prvs.mlit.go.jp/roadinfo/sp/spTop_00_0.html'],
    ['Honda 通行実績情報マップ', 'https://disaster-map.its-mo.com/'], ['Toyota 通れた道マップ', 'https://www.toyota.co.jp/jpn/auto/passable_route/map/'],
    ['気象庁 防災情報', 'https://www.jma.go.jp/bosai/'], ['川の防災情報', 'https://www.river.go.jp/'],
    ['ハザードマップポータルサイト', 'https://disaportal.gsi.go.jp/']
  ];
  const fuelLinks = [
    ['資源エネルギー庁 住民拠点SS検索（災害時の営業状況）', 'https://www.enecho.meti.go.jp/category/resources_and_fuel/distribution/juminkyotenss/'],
    ['Google Maps ガソリンスタンド検索', 'https://www.google.com/maps/search/ガソリンスタンド/'],
    ['ガソナビ（価格比較）', 'https://gasonavi.app/'],
    ['gogo.gs（価格投稿・店舗情報）', 'https://www.gogo.gs/'],
    ['ENEOS サービスステーション検索', 'https://www.eneos-ss.com/search/ss/pc/top.php']
  ];
  const statusLabels = { passable: '通れた', caution: '注意', blocked: '通れなかった' };
  const trafficLabels = { road_closed: '通行止め', lane_restriction: '車線規制', alternating: '片側交互通行', other: 'その他規制' };
  const $ = (id) => document.getElementById(id);
  const toast = (message) => { const el = $('toast'); el.textContent = message; el.classList.add('is-visible'); window.setTimeout(() => el.classList.remove('is-visible'), 2600); };
  const formatDate = (value) => value ? new Intl.DateTimeFormat('ja-JP', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '未記録';
  const safeText = (value) => String(value || '').trim().slice(0, 50);
  const escapeHtml = (value) => String(value || '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  function loadRecords() { try { const data = JSON.parse(localStorage.getItem(RECORDS_KEY) || '[]'); return Array.isArray(data) ? data : []; } catch { return []; } }
  function saveRecords() { localStorage.setItem(RECORDS_KEY, JSON.stringify(records)); }

  const map = L.map('map', { zoomControl: true }).setView(KUMAMOTO, 11);
  L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '地理院タイル｜国土地理院' }).addTo(map);
  const layers = {
    flood: L.tileLayer('https://disaportaldata.gsi.go.jp/raster/01_flood_l2_shinsuishin_data/{z}/{x}/{y}.png', { opacity: .58, maxZoom: 17, attribution: 'ハザードマップポータルサイト' }),
    landslideSteep: L.tileLayer('https://disaportaldata.gsi.go.jp/raster/05_kyukeishakeikaikuiki/{z}/{x}/{y}.png', { opacity: .62, maxZoom: 17, attribution: 'ハザードマップポータルサイト' }),
    landslideDebris: L.tileLayer('https://disaportaldata.gsi.go.jp/raster/05_dosekiryukeikaikuiki/{z}/{x}/{y}.png', { opacity: .62, maxZoom: 17, attribution: 'ハザードマップポータルサイト' }),
    landslideSlide: L.tileLayer('https://disaportaldata.gsi.go.jp/raster/05_jisuberikeikaikuiki/{z}/{x}/{y}.png', { opacity: .62, maxZoom: 17, attribution: 'ハザードマップポータルサイト' })
  };
  const recordsLayer = L.layerGroup().addTo(map);
  const trafficLayer = L.layerGroup().addTo(map);
  const trafficVolumeLayer = L.layerGroup().addTo(map);
  let activeCategory = 'roads'; let pendingPoint = null; let pendingMarker = null; let editingId = null; let detailId = null; let deleteId = null;
  let records = loadRecords(); let trafficData = { updatedAt: null, source: '未接続', items: [] }; let trafficVolumePoints = [];

  function addMapLegend() {
    const mapLegend = L.control({ position: 'bottomleft' });
    mapLegend.onAdd = () => {
      const element = L.DomUtil.create('section', 'map-key');
      element.setAttribute('aria-label', '地図の見方');
      element.innerHTML = `<strong>地図の見方</strong><span><i class="map-key-dot volume"></i>青：交通量観測点</span><details><summary>記録の色</summary><span class="map-key-item"><i class="passable"></i>緑：通れた</span><span class="map-key-item"><i class="caution"></i>黄：注意</span><span class="map-key-item"><i class="blocked"></i>赤：通れなかった</span></details>`;
      L.DomEvent.disableClickPropagation(element);
      L.DomEvent.disableScrollPropagation(element);
      return element;
    };
    mapLegend.addTo(map);
  }

  function markerIcon(status) { const label = { passable: '通', caution: '注', blocked: '止' }[status] || '?'; const color = { passable: 'passable', caution: 'caution', blocked: 'blocked' }[status] || 'unknown'; return L.divIcon({ className: '', html: `<div class="record-marker ${color}"><span>${label}</span></div>`, iconSize: [32, 40], iconAnchor: [16, 40], popupAnchor: [0, -40] }); }
  function trafficIcon(category) { return L.divIcon({ className: '', html: `<div class="traffic-marker ${category}"><span>規</span></div>`, iconSize: [36, 36], iconAnchor: [18, 18], popupAnchor: [0, -18] }); }
  function renderRecords() { recordsLayer.clearLayers(); records.forEach((record) => { const marker = L.marker([record.latitude, record.longitude], { icon: markerIcon(record.status), title: `利用者記録：${statusLabels[record.status] || '不明'}` }).addTo(recordsLayer); marker.on('click', () => openRecordDetail(record)); }); }
  function renderTraffic() {
    trafficLayer.clearLayers();
    trafficData.items.forEach((item) => {
      if (!Number.isFinite(Number(item.latitude)) || !Number.isFinite(Number(item.longitude))) return;
      const marker = L.marker([item.latitude, item.longitude], { icon: trafficIcon(item.category), title: `公式交通規制：${item.title || '規制情報'}` }).addTo(trafficLayer);
      const source = item.sourceUrl ? `<a href="${escapeHtml(item.sourceUrl)}" target="_blank" rel="noopener noreferrer">公式情報を開く ↗</a>` : escapeHtml(item.source || trafficData.source);
      marker.bindPopup(`<strong>${escapeHtml(item.roadName || '道路名未登録')}</strong><br>${escapeHtml(item.title || trafficLabels[item.category] || '交通規制')}<br>${escapeHtml(item.detail || '')}<br><small>更新：${escapeHtml(formatDate(item.updatedAt))}<br>情報元：${escapeHtml(item.source || trafficData.source)}<br>${source}</small>`);
    });
  }
  function renderTrafficVolume() { trafficVolumeLayer.clearLayers(); if (!$('traffic-volume-toggle').checked) return; trafficVolumePoints.forEach((point) => TrafficVolume.createMarker(point).addTo(trafficVolumeLayer)); }
  function clearHazardLayers() { Object.values(layers).forEach((layer) => { if (map.hasLayer(layer)) map.removeLayer(layer); }); }
  function renderCategory(category) {
    activeCategory = category; clearHazardLayers(); if (map.hasLayer(trafficLayer)) map.removeLayer(trafficLayer);
    const legend = $('layer-legend'); const categoryNotice = $('category-notice'); legend.hidden = category === 'roads';
    if (category === 'roads') { trafficLayer.addTo(map); categoryNotice.textContent = '道路規制の公式データは未接続の場合があります。最新情報は公式サイトでも確認してください。'; legend.innerHTML = '<strong>地震・道路規制の凡例</strong><span><i class="legend-swatch traffic-swatch"></i>公式交通規制</span> <span><i class="legend-swatch volume-swatch"></i>交通量観測点</span> <span><i class="legend-swatch user-swatch"></i>利用者記録</span><br>交通量は参考情報です。規制データが未接続の場合は、公式サイトで確認してください。'; }
    else if (category === 'flood') { layers.flood.addTo(map); categoryNotice.textContent = 'リアルタイム情報ではありません。洪水浸水想定区域を表示しており、現在の冠水状況ではありません。'; legend.innerHTML = '<strong>洪水・冠水の凡例</strong><span><i class="legend-swatch" style="background:#83b9e5"></i>洪水浸水想定区域（想定最大規模）</span><br>現在の浸水状況や通行可能性を示すものではありません。<br><strong>※この情報はリアルタイムではありません。</strong>最新の状況は公式情報をご確認ください。'; }
    else { layers.landslideSteep.addTo(map); layers.landslideDebris.addTo(map); layers.landslideSlide.addTo(map); categoryNotice.textContent = 'リアルタイム情報ではありません。土砂災害の警戒区域を表示しており、現在の発生状況ではありません。'; legend.innerHTML = '<strong>土砂災害の凡例</strong><span><i class="legend-swatch" style="background:#f0c34a"></i>警戒区域</span> <span><i class="legend-swatch" style="background:#d94c4c"></i>特別警戒区域</span><br>急傾斜地の崩壊・土石流・地すべりを表示しています。<br><strong>※この情報はリアルタイムではありません。</strong>最新の状況は公式情報をご確認ください。'; }
  }
  function setStatus(message) { $('status-message').textContent = message; }
  function updateSelectionUi(message) {
    const hasSelection = Boolean(pendingPoint); const panel = $('selection-panel'); const recordButton = $('record-location-button');
    recordButton.disabled = !hasSelection; recordButton.textContent = hasSelection ? 'この選択地点を記録' : '地図で場所を選んでください';
    $('clear-selection-button').disabled = !hasSelection; panel.classList.toggle('is-empty', !hasSelection); $('selection-message').textContent = message;
    $('selection-guidance').textContent = hasSelection ? '地図で最後にタップした地点です。よければ記録ボタンを押してください。' : '地図上の記録したい地点をタップしてください。';
    $('selection-coordinates').hidden = !hasSelection;
    $('selection-coordinates').textContent = hasSelection ? `位置の目安：北緯 ${pendingPoint.lat.toFixed(5)} / 東経 ${pendingPoint.lng.toFixed(5)}` : '';
  }
  function removePendingMarker() { if (pendingMarker) { map.removeLayer(pendingMarker); pendingMarker = null; } }
  function setSelection(point) { pendingPoint = point; removePendingMarker(); updateSelectionUi('📍 場所を選択しました'); setStatus('選択地点を確認してください'); }
  function showPendingMarker() { if (!pendingPoint) return; removePendingMarker(); pendingMarker = L.circleMarker(pendingPoint, { radius: 9, color: '#a85027', fillColor: '#e99662', fillOpacity: .88, weight: 3, dashArray: '4 3', interactive: false }).addTo(map).bindTooltip('記録する場所', { direction: 'top' }); }
  function clearSelection() { pendingPoint = null; removePendingMarker(); updateSelectionUi('まだ選択されていません'); setStatus('場所の選択を解除しました'); }
  function resetRecordInput() { $('record-memo').value = ''; document.querySelectorAll('input[name="record-status"]').forEach((input) => { input.checked = false; }); $('record-save').disabled = true; }
  function beginRecord() { if (!pendingPoint) { toast('地図から場所を選んでください'); return; } showPendingMarker(); openRecordDialog(); }
  function openRecordDialog(record = null) { editingId = record ? record.id : null; $('record-dialog-title').textContent = record ? '通行記録を編集' : 'この場所を記録'; $('record-position').textContent = pendingPoint ? `選択した場所（緯度 ${pendingPoint.lat.toFixed(5)} / 経度 ${pendingPoint.lng.toFixed(5)}）` : record ? `位置：${record.latitude.toFixed(5)}, ${record.longitude.toFixed(5)}` : ''; $('record-memo').value = record?.memo || ''; document.querySelectorAll('input[name="record-status"]').forEach((input) => { input.checked = input.value === record?.status; }); $('record-save').disabled = !record; $('record-dialog').showModal(); }
  function closeRecordDialog() { if ($('record-dialog').open) $('record-dialog').close(); editingId = null; }
  function cancelRecordDialog() { const wasEditing = Boolean(editingId); resetRecordInput(); closeRecordDialog(); if (!wasEditing) clearSelection(); }
  function handleRecordSave() { const selected = document.querySelector('input[name="record-status"]:checked'); if (!selected) return; const now = new Date().toISOString(); if (editingId) { const target = records.find((record) => record.id === editingId); if (target) { target.status = selected.value; target.memo = safeText($('record-memo').value); target.updatedAt = now; } } else if (pendingPoint) { records.push({ id: `record-${Date.now()}`, latitude: pendingPoint.lat, longitude: pendingPoint.lng, status: selected.value, memo: safeText($('record-memo').value), createdAt: now, updatedAt: now }); } saveRecords(); renderRecords(); clearSelection(); closeRecordDialog(); toast('通行記録を保存しました'); }
  function openRecordDetail(record) { detailId = record.id; $('detail-status').textContent = statusLabels[record.status] || '不明'; $('detail-memo').textContent = record.memo || 'メモなし'; $('detail-created').textContent = formatDate(record.createdAt); $('detail-updated').textContent = formatDate(record.updatedAt); $('record-detail-dialog').showModal(); }
  function deleteRecord(recordId) { records = records.filter((record) => record.id !== recordId); saveRecords(); renderRecords(); toast('通行記録を削除しました'); }
  function requestLocation() { if (!navigator.geolocation) { setStatus('この端末では現在地を取得できません'); toast('現在地を取得できません'); return; } setStatus('現在地を取得しています…'); navigator.geolocation.getCurrentPosition((position) => { const point = [position.coords.latitude, position.coords.longitude]; map.setView(point, 14); L.circleMarker(point, { radius: 9, color: '#1769aa', fillColor: '#61a9df', fillOpacity: .9, weight: 3 }).addTo(map).bindPopup('現在地').openPopup(); setStatus('現在地へ移動しました'); toast('記録する場合は地図上の地点をタップしてください'); }, () => { setStatus('現在地を取得できませんでした'); toast('位置情報の利用を許可してください'); }, { enableHighAccuracy: true, timeout: 10000 }); }
  async function loadTrafficData() { const response = await fetch('data/traffic-restrictions.json', { cache: 'no-store' }); if (!response.ok) throw new Error('traffic data unavailable'); const data = await response.json(); trafficData = { updatedAt: data.updatedAt || null, source: data.source || '未接続', items: Array.isArray(data.items) ? data.items : [] }; renderTraffic(); updateTrafficMessage(); }
  async function loadTrafficVolume() { const status = $('traffic-volume-status'); if (!window.TrafficVolume) { status.textContent = '交通量API：未設定'; return; } status.textContent = '交通量情報を更新中…'; try { const result = await TrafficVolume.fetchTrafficVolume({ map }); trafficVolumePoints = result.points; renderTrafficVolume(); const observed = result.points.find((point) => point.observedAt !== 'データなし')?.observedAt || result.observedCode; status.textContent = `交通量観測：${result.points.length}地点 / 観測：${observed} / 取得：${formatDate(result.fetchedAt)}`; return result; } catch (error) { trafficVolumePoints = []; renderTrafficVolume(); const message = error?.message === 'WORKER_URL_REQUIRED' ? '交通量API：Worker URL未設定' : error?.message === 'HTTP_401' || error?.message === 'HTTP_403' ? '交通量API：認証設定が必要' : error?.message === 'NO_DATA' ? '交通量情報：該当データなし' : '交通量情報を取得できませんでした'; status.textContent = message; throw error; } }
  function updateTrafficMessage() { if (!trafficData.updatedAt && trafficData.items.length === 0) { $('last-updated').textContent = '公式情報：未取得'; $('data-message').textContent = '交通規制データは現在接続されていません。規制がないという意味ではありません。最新情報は公式サイトで確認してください。'; return; } $('last-updated').textContent = `公式情報の最終取得：${formatDate(trafficData.updatedAt)}`; $('data-message').textContent = trafficData.items.length ? `公式交通規制：${trafficData.items.length}件（${trafficData.source}）` : '交通規制データを取得しました。現在表示できる規制情報はありません。'; }
  async function refresh() { const button = $('refresh-button'); if (button.disabled) return; button.disabled = true; button.textContent = '更新中…'; setStatus('交通量情報・公式情報を確認しています…'); const results = await Promise.allSettled([loadTrafficData(), loadTrafficVolume()]); const success = results.some((result) => result.status === 'fulfilled'); if (success) { setStatus('地図情報を更新しました'); toast('地図情報を更新しました'); } else { setStatus('地図情報を更新できませんでした'); toast('地図情報を更新できませんでした。通信状態と公式情報をご確認ください。'); } button.disabled = false; button.textContent = '↻ 地図更新'; }

  addMapLegend();
  map.on('click', (event) => setSelection(event.latlng));
  $('record-location-button').addEventListener('click', beginRecord); $('clear-selection-button').addEventListener('click', clearSelection);
  $('record-form').addEventListener('submit', (event) => { event.preventDefault(); handleRecordSave(); }); $('record-cancel').addEventListener('click', cancelRecordDialog); $('record-dialog').addEventListener('cancel', (event) => { event.preventDefault(); cancelRecordDialog(); });
  document.querySelectorAll('input[name="record-status"]').forEach((input) => input.addEventListener('change', () => { $('record-save').disabled = false; }));
  $('detail-close').addEventListener('click', () => $('record-detail-dialog').close()); $('detail-edit').addEventListener('click', () => { const record = records.find((item) => item.id === detailId); $('record-detail-dialog').close(); if (record) openRecordDialog(record); }); $('detail-delete').addEventListener('click', () => { deleteId = detailId; $('record-detail-dialog').close(); $('delete-dialog').showModal(); });
  $('delete-cancel').addEventListener('click', () => $('delete-dialog').close()); $('delete-confirm').addEventListener('click', () => { if (deleteId) deleteRecord(deleteId); deleteId = null; $('delete-dialog').close(); });
  $('region-select').addEventListener('change', (event) => { const [lat, lng, zoom] = regions[event.target.value]; map.setView([lat, lng], zoom); setStatus(`${event.target.options[event.target.selectedIndex].text}を表示中`); });
  document.querySelectorAll('.category-button').forEach((button) => button.addEventListener('click', () => { document.querySelectorAll('.category-button').forEach((item) => item.classList.remove('is-active')); button.classList.add('is-active'); renderCategory(button.dataset.category); }));
  $('location-button').addEventListener('click', requestLocation); $('refresh-button').addEventListener('click', refresh);
  $('traffic-volume-toggle').addEventListener('change', renderTrafficVolume);
  $('delete-all-button').addEventListener('click', () => { if (!records.length) { toast('削除する記録はありません'); return; } if (!window.confirm('保存した記録をすべて削除しますか？')) return; if (!window.confirm('この操作は取り消せません。本当に削除しますか？')) return; records = []; saveRecords(); renderRecords(); toast('保存した記録をすべて削除しました'); });
  $('official-links-button').addEventListener('click', () => { const list = $('official-links-list'); list.replaceChildren(); officialLinks.forEach(([label, url]) => { const li = document.createElement('li'); const link = document.createElement('a'); link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = `${label} ↗`; li.appendChild(link); list.appendChild(li); }); $('links-dialog').showModal(); });
  $('fuel-links-button').addEventListener('click', () => { const list = $('fuel-links-list'); list.replaceChildren(); fuelLinks.forEach(([label, url]) => { const li = document.createElement('li'); const link = document.createElement('a'); link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = `${label} ↗`; li.appendChild(link); list.appendChild(li); }); $('fuel-links-dialog').showModal(); });
  document.querySelectorAll('.close-dialog').forEach((button) => button.addEventListener('click', () => $('links-dialog').close())); document.querySelectorAll('.close-fuel-dialog').forEach((button) => button.addEventListener('click', () => $('fuel-links-dialog').close())); $('first-use-close').addEventListener('click', () => { localStorage.setItem(FIRST_USE_KEY, 'shown'); $('first-use-dialog').close(); });
  renderRecords(); renderCategory('roads'); loadTrafficData().catch(() => updateTrafficMessage()); loadTrafficVolume().catch(() => {}); if (!localStorage.getItem(FIRST_USE_KEY)) $('first-use-dialog').showModal();
})();
