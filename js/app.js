(async function () {
  const C = window.CONFIG;
  const $ = s => document.querySelector(s);

  // ---------- Map ----------
  const map = L.map('map', { zoomControl: false, center: C.center, zoom: C.zoom, minZoom: 11, maxZoom: 19 });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, className: 'basemap',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors | City of Guelph Open Data'
  }).addTo(map);
  L.control.zoom({ position: 'bottomright' }).addTo(map);

  const panes = { routes: 410, trails: 405, walk: 420, stops: 610, buses: 640, pins: 660 };
  for (const [k, z] of Object.entries(panes)) map.createPane(k).style.zIndex = z;

  const layers = {
    routes: L.layerGroup(), trails: L.layerGroup(),
    stops: L.layerGroup().addTo(map), buses: L.layerGroup().addTo(map), trip: L.layerGroup().addTo(map)
  };

  // Keep planner height in a CSS var so the chips sit right under it
  const setPlannerH = () => document.documentElement.style.setProperty('--planner-h', $('#planner').offsetHeight + 'px');
  new ResizeObserver(setPlannerH).observe($('#planner')); setPlannerH();

  // ---------- Static GTFS ----------
  const [stopsJ, routes] = await Promise.all([
    fetch('data/gtfs/stops.json').then(r => r.json()),
    fetch('data/gtfs/routes.json').then(r => r.json())
  ]);
  const stops = stopsJ.stops.map(([code, name, lat, lon], i) => ({ i, code, name, lat, lon }));
  window.APP = { map, stops, routes, layers };

  // Route lines (official route colours)
  for (const r of Object.values(routes)) {
    if (!/^\d/.test(r.n)) continue; // skip charters / specials
    r.shapes.forEach(s => L.polyline(s, { pane: 'routes', color: r.c, weight: 3, opacity: .75 }).addTo(layers.routes));
  }

  // Stops: green leaf pins when zoomed in, small green dots when zoomed out
  const stopPopup = s => `<div class="pop-title">${s.name}</div><span class="muted">Stop #${s.code}</span>`;
  function drawStops() {
    layers.stops.clearLayers();
    const z = map.getZoom(), b = map.getBounds().pad(0.2);
    for (const s of stops) {
      if (!b.contains([s.lat, s.lon])) continue;
      const m = z >= 16
        ? L.marker([s.lat, s.lon], { icon: Icons.pin('stop'), pane: 'stops' })
        : L.marker([s.lat, s.lon], { icon: L.divIcon({ className: 'stop-dot', iconSize: [10, 10] }), pane: 'stops' });
      m.bindPopup(stopPopup(s)).addTo(layers.stops);
    }
  }
  map.on('zoomend moveend', drawStops); drawStops();

  // ---------- Realtime (snapshot now, live later) ----------
  let feedTime = 0, alerts = [];
  async function loadVehicles() {
    try {
      const buf = await fetch(C.realtime.vehicles, { cache: 'no-store' }).then(r => r.arrayBuffer());
      const feed = GTFSRT.decode(buf); feedTime = feed.timestamp;
      layers.buses.clearLayers();
      for (const v of feed.vehicles) {
        const r = routes[v.routeId];
        L.marker([v.lat, v.lon], { icon: Icons.bus(r, v.bearing), pane: 'buses', zIndexOffset: 1000 })
          .bindPopup(`<div class="pop-title"><span class="badge" style="background:${r ? r.c : '#999'};color:#fff">${r ? r.n : '?'}</span> ${r ? r.name : 'Unknown route'}</div>
            <span class="muted">Bus ${v.label || v.id}${v.speed ? ' · ' + Math.round(v.speed * 3.6) + ' km/h' : ''}<br>Updated ${fmtTime(v.timestamp)}</span>`)
          .addTo(layers.buses);
      }
      status(feed.vehicles.length);
    } catch (e) { console.error(e); }
  }
  async function loadAlerts() {
    try { alerts = GTFSRT.decode(await fetch(C.realtime.alerts).then(r => r.arrayBuffer())).alerts; } catch (e) { alerts = []; }
  }
  const fmtTime = t => new Date(t * 1000).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Toronto' });
  function status(n) {
    const live = C.realtime.refreshSeconds > 0;
    $('#sheetBody').innerHTML = `<div class="status"><span class="live-dot" style="background:${live ? '#2EAD5E' : '#E8A33A'}"></span>
      <div><b>${n} buses</b> · ${live ? 'live' : 'snapshot'} ${fmtTime(feedTime)}${alerts.length ? ` · <a href="#" id="alertsLink">${alerts.length} service alerts</a>` : ''}<br>
      <span class="muted">Enter a start and destination to plan a trip.</span></div></div>`;
    openSheet(true);
    const a = $('#alertsLink'); if (a) a.onclick = e => { e.preventDefault(); showAlerts(); };
    $('#feedInfo').textContent = `Bus positions: ${live ? 'live feed' : 'snapshot from ' + new Date(feedTime * 1000).toLocaleString('en-CA', { timeZone: 'America/Toronto' })}.`;
  }
  function showAlerts() {
    const seen = new Set();
    const items = alerts.filter(a => !seen.has(a.header) && seen.add(a.header)).map(a => {
      const rs = a.routes.map(id => routes[id]).filter(Boolean).map(r => `<span class="badge" style="background:${r.c};color:#fff">${r.n}</span>`).join(' ');
      return `<li style="margin:8px 0">${rs} ${a.header}</li>`;
    }).join('');
    $('#sheetBody').innerHTML = `<b>Service alerts</b><ul style="padding-left:0;list-style:none">${items}</ul><button class="go-btn" id="closeAlerts">Back</button>`;
    $('#closeAlerts').onclick = () => status(layers.buses.getLayers().length);
  }
  function openSheet(on) {
    $('#sheet').classList.toggle('open', on);
    requestAnimationFrame(() => document.documentElement.style.setProperty('--sheet-h', on ? $('#sheet').offsetHeight + 'px' : '0px'));
  }
  await loadAlerts(); await loadVehicles();
  if (C.realtime.refreshSeconds > 0) setInterval(loadVehicles, C.realtime.refreshSeconds * 1000);

  // ---------- Trails (City of Guelph, live service) ----------
  let trailsLoaded = false;
  async function loadTrails() {
    if (trailsLoaded) return; trailsLoaded = true;
    const url = C.gis.trails + '/query?where=1%3D1&outFields=Trail_Name,Surface_Type&outSR=4326&geometryPrecision=5&f=geojson';
    const gj = await fetch(url).then(r => r.json());
    L.geoJSON(gj, { pane: 'trails', style: { color: '#136935', weight: 2.5, dashArray: '5 4', opacity: .9 },
      onEachFeature: (f, l) => l.bindPopup(`<div class="pop-title">${f.properties.Trail_Name || 'Trail'}</div><span class="muted">${f.properties.Surface_Type || ''}</span>`) })
      .addTo(layers.trails);
  }

  // ---------- Layer chips ----------
  document.querySelectorAll('.chip').forEach(ch => ch.onclick = async () => {
    const k = ch.dataset.layer, on = !ch.classList.contains('on');
    ch.classList.toggle('on', on);
    if (k === 'trails' && on) await loadTrails();
    on ? layers[k].addTo(map) : map.removeLayer(layers[k]);
  });

  // ---------- Address search (City of Guelph Addresses layer) ----------
  const sel = { from: null, to: null };
  const sug = $('#suggest'); let activeInput = null, timer;
  async function searchAddr(q) {
    q = q.trim().toUpperCase().replace(/'/g, "''");
    if (q.length < 3) return [];
    const where = encodeURIComponent(`UPPER(ADDRESS) LIKE '${q}%' AND (UNIT_NO IS NULL OR UNIT_NO = '')`);
    const url = `${C.gis.addresses}/query?where=${where}&outFields=ADDRESS,POSTCODE,LAT,LONG&orderByFields=ADDRESS&resultRecordCount=8&returnGeometry=false&f=json`;
    const j = await fetch(url).then(r => r.json());
    return (j.features || []).map(f => f.attributes);
  }
  function bindInput(input, key) {
    input.addEventListener('input', () => {
      sel[key] = null; activeInput = { input, key }; clearTimeout(timer);
      timer = setTimeout(async () => {
        const res = await searchAddr(input.value).catch(() => []);
        sug.innerHTML = res.map((a, i) => `<li role="option" data-i="${i}">${a.ADDRESS}<br><small>Guelph ${a.POSTCODE || ''}</small></li>`).join('');
        sug.hidden = !res.length;
        sug.querySelectorAll('li').forEach(li => li.onclick = () => choose(res[+li.dataset.i]));
      }, 200);
    });
    input.addEventListener('keydown', e => { if (e.key === 'Enter' && !sug.hidden) { e.preventDefault(); sug.querySelector('li')?.click(); } });
  }
  function choose(a) {
    const { input, key } = activeInput;
    input.value = a.ADDRESS; sel[key] = { name: a.ADDRESS, lat: a.LAT, lon: a.LONG };
    sug.hidden = true; input.blur(); drawEnds();
  }
  bindInput($('#fromInput'), 'from'); bindInput($('#toInput'), 'to');

  async function resolve(key, input) {
    if (sel[key]) return sel[key];
    const r = await searchAddr(input.value); if (!r.length) return null;
    return sel[key] = { name: r[0].ADDRESS, lat: r[0].LAT, lon: r[0].LONG };
  }
  function drawEnds() {
    layers.trip.clearLayers();
    if (sel.from) L.marker([sel.from.lat, sel.from.lon], { icon: Icons.pin('walk'), pane: 'pins' }).bindPopup(sel.from.name).addTo(layers.trip);
    if (sel.to) L.marker([sel.to.lat, sel.to.lon], { icon: Icons.pin('dest'), pane: 'pins' }).bindPopup(sel.to.name).addTo(layers.trip);
    const pts = [sel.from, sel.to].filter(Boolean).map(p => [p.lat, p.lon]);
    if (pts.length === 2) map.fitBounds(pts, { padding: [40, 40], paddingTopLeft: [20, $('#planner').offsetHeight + 70] });
    else if (pts.length) map.setView(pts[0], 16);
  }

  $('#swapBtn').onclick = () => {
    const f = $('#fromInput').value; $('#fromInput').value = $('#toInput').value; $('#toInput').value = f;
    [sel.from, sel.to] = [sel.to, sel.from]; drawEnds();
  };
  $('#locateBtn').onclick = () => map.locate({ setView: true, maxZoom: 16 });
  map.on('locationfound', e => { sel.from = { name: 'My location', lat: e.latlng.lat, lon: e.latlng.lng }; $('#fromInput').value = 'My location'; drawEnds(); });
  $('#goBtn').onclick = async () => {
    const a = await resolve('from', $('#fromInput')), b = await resolve('to', $('#toInput'));
    if (!a || !b) { alertSheet('Choose a start and a destination address in Guelph.'); return; }
    drawEnds();
    if (window.planTrip) window.planTrip(a, b); // routing module (next step)
  };
  function alertSheet(msg) { $('#sheetBody').innerHTML = `<div class="status">${msg}</div>`; openSheet(true); }

  // Info dialog + legend
  $('#infoBtn').onclick = () => $('#infoDlg').showModal();
  document.querySelectorAll('.lg-pin').forEach(el => el.innerHTML = Icons.svg(el.dataset.k, 22, 28));

  // Deep-link: ?from=149 Harvard Road&to=1 Carden Street
  const qs = new URLSearchParams(location.search);
  if (qs.get('from')) $('#fromInput').value = qs.get('from');
  if (qs.get('to')) $('#toInput').value = qs.get('to');
  if (qs.get('from') && qs.get('to')) $('#goBtn').click();
})();
