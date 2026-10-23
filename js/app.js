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

  const panes = { routes: 410, trails: 405, walk: 420, stops: 610, buses: 640, me: 650, pins: 660 };
  for (const [k, z] of Object.entries(panes)) map.createPane(k).style.zIndex = z;

  const layers = {
    routes: L.layerGroup(), trails: L.layerGroup(),
    stops: L.layerGroup().addTo(map), buses: L.layerGroup().addTo(map), trip: L.layerGroup().addTo(map)
  };

  // Keep planner height in a CSS var so the chips sit right under it
  const setPlannerH = () => document.documentElement.style.setProperty('--planner-h', $('#planner').offsetHeight + 'px');
  new ResizeObserver(setPlannerH).observe($('#planner')); setPlannerH();

  // ---------- Static GTFS ----------
  const [stopsJ, routes, offsets] = await Promise.all([
    fetch('data/gtfs/stops.json').then(r => r.json()),
    fetch('data/gtfs/routes.json').then(r => r.json()),
    fetch('data/gtfs/route_offsets.json').then(r => r.json()).catch(() => ({}))   // ROW-based lane offsets
  ]);
  const stops = stopsJ.stops.map(([code, name, lat, lon, rids], i) => ({ i, code, name, lat, lon, routes: (rids || []).map(id => routes[id]).filter(Boolean) }));
  window.APP = { map, stops, routes, layers, offsets };

  // Route lines (official route colours), each direction drawn in its own lane with travel arrows
  for (const [rid, r] of Object.entries(routes)) {
    if (!/^\d/.test(r.n)) continue; // skip charters / specials
    const seen = new Set();
    r.shapes.forEach((s, k) => {
      const key = s.join(';'); if (seen.has(key)) return; seen.add(key);   // identical variants drawn once
      const off = shapeOffsets(rid, k);
      new L.OffsetLine(s, { pane: 'routes', color: r.c, weight: 3, opacity: .8, offsets: off, minPx: 2.5 }).addTo(layers.routes);
      new L.ArrowLine(s, { pane: 'routes', color: r.c, weight: 2, opacity: .95, offsets: off, minPx: 2.5, size: 3.5, spacing: 120, minZoom: 15 }).addTo(layers.routes);
    });
  }

  // Stops: green leaf pins when zoomed in, small green dots when zoomed out
  const stopPopup = s => `<div class="pop-title">${s.name}</div><span class="muted">Stop #${s.code} · next buses</span><div class="arrivals" data-stopidx="${s.i}"></div>`;
  function drawStops() {
    const pop = map._popup; // don't wipe the stop whose popup is open (popup autopan fires moveend)
    if (pop && map.hasLayer(pop) && pop._source && layers.stops.hasLayer(pop._source)) return;
    layers.stops.clearLayers();
    const z = map.getZoom(), b = map.getBounds().pad(0.2);
    if (z < 14) return; // keep the city-wide view clean
    for (const s of stops) {
      if (!b.contains([s.lat, s.lon])) continue;
      const m = z >= 16
        ? L.marker([s.lat, s.lon], { icon: Icons.stop(s.routes), pane: 'stops' })
        : L.marker([s.lat, s.lon], { icon: L.divIcon({ className: 'stop-dot', iconSize: [10, 10] }), pane: 'stops' });
      m.bindPopup(Icons.popEl(stopPopup(s))).addTo(layers.stops);
    }
  }
  map.on('zoomend moveend', drawStops); drawStops();

  // ---------- Realtime: live via Cloudflare Worker relay, snapshot as fallback ----------
  const liveBase = (new URLSearchParams(location.search).get('feed') || C.realtime.liveBase || '').replace(/\/$/, '');
  let feedTime = 0, alerts = [], isLive = false, lastOk = 0;
  const busMarkers = new Map();
  async function getFeed(kind) {
    if (liveBase) {
      try {
        const r = await fetch(`${liveBase}/${kind}`, { cache: 'no-store' });
        if (!r.ok) throw new Error(r.status);
        return { feed: GTFSRT.decode(await r.arrayBuffer()), live: true };
      } catch (e) { console.warn('Live feed unavailable, using snapshot', e); }
    }
    const r = await fetch(C.realtime.snapshot[kind], { cache: 'no-store' });
    return { feed: GTFSRT.decode(await r.arrayBuffer()), live: false };
  }
  const busPopup = (v, r) => `<div class="pop-title"><span class="badge" style="background:${r ? r.c : '#999'};color:#fff">${r ? r.n : '?'}</span> ${r ? r.name : 'Unknown route'}</div>
    <span class="muted">Bus ${v.label || v.id}${v.speed ? ' · ' + Math.round(v.speed * 3.6) + ' km/h' : ''}<br>Position at ${fmtTime(v.timestamp, true)}</span>`;
  function glide(m, to, ms = 1200) {
    const from = m.getLatLng(), t0 = performance.now();
    if (from.distanceTo(to) > 1500) { m.setLatLng(to); return; }
    const step = now => { const k = Math.min(1, (now - t0) / ms), e = k * (2 - k);
      m.setLatLng([from.lat + (to[0] - from.lat) * e, from.lng + (to[1] - from.lng) * e]); if (k < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }
  async function loadVehicles() {
    try {
      const { feed, live } = await getFeed('vehicles');
      feedTime = feed.timestamp; isLive = live; lastOk = Date.now(); APP.vehicles = feed.vehicles;
      const seen = new Set();
      for (const v of feed.vehicles) {
        const r = routes[v.routeId], key = v.id; seen.add(key);
        const sig = (r ? r.n : '?') + '|' + Math.round((v.bearing || 0) / 15);
        let m = busMarkers.get(key);
        if (!m) {
          m = L.marker([v.lat, v.lon], { icon: Icons.bus(r, v.bearing), pane: 'buses', zIndexOffset: 1000 }).addTo(layers.buses);
          busMarkers.set(key, m);
        } else {
          glide(m, [v.lat, v.lon]);
          if (m._sig !== sig) m.setIcon(Icons.bus(r, v.bearing));
        }
        m._sig = sig; m.bindPopup(busPopup(v, r));
      }
      for (const [k, m] of busMarkers) if (!seen.has(k)) { layers.buses.removeLayer(m); busMarkers.delete(k); }
      if (!APP.inTrip) status(feed.vehicles.length);
    } catch (e) { console.error(e); }
  }
  async function loadAlerts() {
    try { alerts = (await getFeed('alerts')).feed.alerts; } catch (e) { alerts = []; }
  }
  const fmtTime = (t, sec) => new Date(t * 1000).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit', ...(sec ? { second: '2-digit' } : {}), timeZone: 'America/Toronto' });
  function status(n) {
    $('#sheetBody').innerHTML = `<div class="status"><span class="live-dot${isLive ? ' pulse' : ''}" style="background:${isLive ? '#2EAD5E' : '#E8A33A'}"></span>
      <div><b>${n} buses</b> · ${isLive ? 'live' : 'snapshot'} ${fmtTime(feedTime, isLive)}${alerts.length ? ` · <a href="#" id="alertsLink">${alerts.length} service alerts</a>` : ''}<br>
      <span class="muted">${isLive ? `Updates every ${C.realtime.refreshSeconds} s. ` : ''}Enter a start and destination to plan a trip.</span></div></div>`;
    openSheet(true);
    const a = $('#alertsLink'); if (a) a.onclick = e => { e.preventDefault(); showAlerts(); };
    $('#feedInfo').textContent = `Bus positions: ${isLive ? 'live Guelph Transit feed' : 'snapshot from ' + new Date(feedTime * 1000).toLocaleString('en-CA', { timeZone: 'America/Toronto' })}.`;
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
  APP.sheet = (html, collapsed) => {
    APP.inTrip = true; document.body.classList.add('trip');
    $('#sheetBody').innerHTML = html; $('#sheet').classList.toggle('collapsed', !!collapsed); openSheet(true);
    const x = $('#clearTrip'); if (x) x.onclick = APP.clearTrip;
  };
  APP.clearTrip = () => {
    APP.inTrip = false; document.body.classList.remove('trip'); layers.trip.clearLayers(); APP.departSecs = null;
    $('#fromInput').value = $('#toInput').value = ''; sel.from = sel.to = null;
    $('#sheet').classList.remove('collapsed'); status(layers.buses.getLayers().length);
  };
  // tap the handle (or swipe) to expand / collapse trip details
  const toggleSheet = () => { if (!APP.inTrip) return; $('#sheet').classList.toggle('collapsed'); openSheet(true); };
  $('.grab').onclick = toggleSheet;
  let y0 = null; $('#sheet').addEventListener('touchstart', e => y0 = e.touches[0].clientY, { passive: true });
  $('#sheet').addEventListener('touchend', e => { if (y0 === null) return; const dy = e.changedTouches[0].clientY - y0; y0 = null;
    if (Math.abs(dy) > 40 && APP.inTrip) { $('#sheet').classList.toggle('collapsed', dy > 0); openSheet(true); } });
  // ---------- Refresh countdown (strip along the bottom of the screen) ----------
  const every = C.realtime.refreshSeconds * 1000;
  let nextAt = 0, polling = false, pollTimer = null;
  function tick() {
    const bar = $('#refreshBar'); if (!bar) return;
    let txt, frac;
    if (polling) { txt = 'Updating bus locations…'; frac = 0; }
    else if (!isLive) { txt = 'Live bus feed unavailable — showing snapshot positions'; frac = 0; }
    else if (document.hidden) { txt = 'Paused'; frac = 0; }
    else {
      const left = Math.max(0, Math.ceil((nextAt - Date.now()) / 1000));
      txt = `Bus locations refresh in <b>${left} s</b>`; frac = Math.max(0, Math.min(1, (nextAt - Date.now()) / every));
    }
    bar.classList.toggle('stale', !isLive);
    $('#refreshTxt').innerHTML = txt;
    $('#refreshFill').style.transform = `scaleX(${frac})`;
  }
  async function poll() {
    clearTimeout(pollTimer);
    if (document.hidden) return;                       // resumes on visibilitychange
    polling = true; tick();
    await loadVehicles();
    polling = false; nextAt = Date.now() + every; tick();
    pollTimer = setTimeout(poll, every);
  }
  await loadAlerts();
  if (liveBase && C.realtime.refreshSeconds > 0) {
    await poll();
    setInterval(tick, 250);
    setInterval(() => { if (!document.hidden) loadAlerts(); }, 120000);
    // refresh immediately when the phone comes back to the app
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { if (Date.now() - lastOk > 5000) poll(); else { clearTimeout(pollTimer); nextAt = lastOk + every; pollTimer = setTimeout(poll, Math.max(0, nextAt - Date.now())); } } tick(); });
  } else { await loadVehicles(); tick(); }

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

  // ---------- Search: addresses + City places (facilities, parks, schools, gardens, restrooms) ----------
  const sel = { from: null, to: null };
  const sug = $('#suggest'); let activeInput = null, timer;
  async function searchAddr(q) {
    q = q.trim().toUpperCase().replace(/'/g, "''");
    if (q.length < 3 || !/\d/.test(q)) return [];   // street addresses start with a number
    const where = encodeURIComponent(`UPPER(ADDRESS) LIKE '${q}%' AND (UNIT_NO IS NULL OR UNIT_NO = '')`);
    const url = `${C.gis.addresses}/query?where=${where}&outFields=ADDRESS,POSTCODE,LAT,LONG&orderByFields=ADDRESS&resultRecordCount=6&returnGeometry=false&f=json`;
    const j = await fetch(url).then(r => r.json());
    return (j.features || []).map(f => f.attributes).map(a => ({ kind: 'addr', name: a.ADDRESS, sub: `Guelph ${a.POSTCODE || ''}`, lat: a.LAT, lon: a.LONG }));
  }
  // Title-case City data names but keep school / agency acronyms ("ST. PAUL CS" → "St. Paul CS")
  const KEEP = new Set(['CS', 'PS', 'CVI', 'SS', 'CI', 'GRCA', 'YMCA', 'YWCA', 'II', 'III']);
  const nice = s => (s || '').trim().toLowerCase().replace(/[a-z0-9.'’-]+/g, w => KEEP.has(w.toUpperCase()) ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1))
    .replace(/\bMc([a-z])/g, (m, c) => 'Mc' + c.toUpperCase()).replace(/ (Rd|St|Dr|Ave|Cres|Pl|Blvd|Ct) ([nsew])\b/gi, (m, a, d) => ` ${a} ${d.toUpperCase()}`);
  let places = null;
  function loadPlaces() {
    if (places) return places;
    const get = (url, where, fields) => fetch(`${url}/query?where=${encodeURIComponent(where)}&outFields=${fields}&outSR=4326&geometryPrecision=6&f=geojson`)
      .then(r => r.json()).then(g => g.features || []).catch(e => { console.warn('place layer failed', url, e); return []; });
    const pt = f => f.geometry && f.geometry.type === 'Point' ? { lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0] } : null;
    // parks: route to the edge of the park closest to its middle (usually a street frontage), not the middle of a field
    const parkPt = f => {
      try {
        const c = turf.centroid(f), edge = turf.nearestPointOnLine(turf.polygonToLine(f.geometry.type === 'MultiPolygon' ? turf.polygon(f.geometry.coordinates[0]) : f), c);
        return { lat: edge.geometry.coordinates[1], lon: edge.geometry.coordinates[0], clat: c.geometry.coordinates[1], clon: c.geometry.coordinates[0] };
      } catch (e) { return null; }
    };
    const P = C.gis.places;
    places = Promise.all([
      get(P.facilities, '1=1', 'NAME,ADDRESS,CATEGORY').then(fs => fs.map(f => ({ kind: 'facility', name: nice(f.properties.NAME), sub: `${nice(f.properties.CATEGORY)} · ${nice(f.properties.ADDRESS)}`, tags: f.properties.CATEGORY, ...pt(f) }))),
      get(P.parks, "ParkStatus = 'IN-USE'", 'ParkName,Name,Address').then(fs => fs.map(f => ({ kind: 'park', name: f.properties.Name || nice(f.properties.ParkName), sub: `Park${f.properties.Address ? ' · ' + f.properties.Address : ''}`, tags: 'park', ...parkPt(f) }))),
      get(P.schools, '1=1', 'NAME,ADDRESS,TYPE,BOARD,STATUS').then(fs => fs.filter(f => /active/i.test(f.properties.STATUS || 'active')).map(f => ({ kind: 'school', name: nice(f.properties.NAME), sub: `${nice(f.properties.TYPE)} school · ${nice(f.properties.ADDRESS)}`, tags: 'school ' + (f.properties.BOARD || ''), ...pt(f) }))),
      get(P.gardens, "Status = 'IN-USE'", 'Name,Address,GardenType').then(fs => fs.filter(f => f.properties.Name).map(f => ({ kind: 'garden', name: nice(f.properties.Name), sub: `Community garden${f.properties.Address ? ' · ' + nice(f.properties.Address) : ''}`, tags: 'community garden ' + (f.properties.GardenType || ''), ...pt(f) }))),
      get(P.restrooms, "Status = 'IN-USE' AND OpenToPublic = 'Yes'", 'ParkName,RestroomType,LocationDescription').then(fs => fs.filter(f => f.properties.ParkName).map(f => ({ kind: 'restroom', name: `Restroom · ${nice(f.properties.ParkName)}`, sub: nice(f.properties.RestroomType) + (f.properties.LocationDescription ? ' · ' + f.properties.LocationDescription.toLowerCase() : ''), tags: 'restroom washroom toilet bathroom', ...pt(f) })))
    ]).then(all => {
      const seen = new Set();   // the source layers repeat some entries (e.g. one garden per plot)
      return all.flat().filter(p => p.lat != null && p.name && !seen.has(p.kind + p.name + p.sub) && seen.add(p.kind + p.name + p.sub))
        .map(p => ({ ...p, key: (p.name + ' ' + p.tags).toLowerCase() }));
    });
    return places;
  }
  const norm = s => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  async function searchPlaces(q) {
    q = norm(q); if (q.length < 2) return [];
    const words = q.split(' '), list = await loadPlaces(), out = [];
    for (const p of list) {
      const key = norm(p.key), name = norm(p.name);
      if (!words.every(w => key.includes(w))) continue;
      const score = (name.startsWith(q) ? 0 : 2) + (words.every(w => (' ' + key).includes(' ' + w)) ? 0 : 1);   // whole-name, then word-start matches first
      out.push([score, p]);
    }
    return out.sort((a, b) => a[0] - b[0] || a[1].name.localeCompare(b[1].name)).slice(0, 6).map(x => x[1]);
  }
  async function search(q) {
    const [pl, ad] = await Promise.all([searchPlaces(q).catch(() => []), searchAddr(q).catch(() => [])]);
    return /^\s*\d/.test(q) ? [...ad, ...pl] : [...pl, ...ad];
  }
  const KIND = { addr: 'Address', facility: 'City facility', park: 'Park', school: 'School', garden: 'Garden', restroom: 'Restroom' };
  function bindInput(input, key) {
    input.addEventListener('focus', () => loadPlaces(), { once: true });   // warm the place list
    input.addEventListener('input', () => {
      sel[key] = null; activeInput = { input, key }; clearTimeout(timer);
      timer = setTimeout(async () => {
        const res = await search(input.value);
        sug.innerHTML = res.map((a, i) => `<li role="option" data-i="${i}"><span class="sg-ico sg-${a.kind}" aria-hidden="true"></span><span class="sg-txt">${a.name}<br><small>${a.sub}</small></span><span class="sg-kind">${KIND[a.kind]}</span></li>`).join('');
        sug.hidden = !res.length;
        sug.querySelectorAll('li').forEach(li => li.onclick = () => choose(res[+li.dataset.i]));
      }, 180);
    });
    input.addEventListener('keydown', e => { if (e.key === 'Enter' && !sug.hidden) { e.preventDefault(); sug.querySelector('li')?.click(); } });
  }
  function choose(a) {
    const { input, key } = activeInput;
    input.value = a.name; sel[key] = { name: a.name, lat: a.lat, lon: a.lon };
    sug.hidden = true; input.blur(); drawEnds();
  }
  bindInput($('#fromInput'), 'from'); bindInput($('#toInput'), 'to');

  async function resolve(key, input) {
    if (sel[key]) return sel[key];
    const r = await search(input.value); if (!r.length) return null;
    return sel[key] = { name: r[0].name, lat: r[0].lat, lon: r[0].lon };
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
  // ---------- Live location: blue dot + accuracy ring that follows you ----------
  // Tap the locate button: start tracking, use your position as the trip start, and follow you.
  // Drag the map to stop following; tap the button again to re-centre and follow.
  const me = { watch: null, follow: false, dot: null, ring: null, last: null };
  function meIcon(heading) {
    const h = heading != null && !isNaN(heading) ? `<span class="me-head" style="transform:rotate(${heading}deg)"></span>` : '';
    return L.divIcon({ className: 'me', html: `${h}<span class="me-dot"></span>`, iconSize: [22, 22], iconAnchor: [11, 11] });
  }
  function onFix(p) {
    const ll = [p.coords.latitude, p.coords.longitude], first = !me.last;
    me.last = { lat: ll[0], lon: ll[1], acc: p.coords.accuracy, t: p.timestamp };
    if (!me.dot) {
      me.ring = L.circle(ll, { pane: 'me', radius: p.coords.accuracy, color: '#3A7AEB', weight: 1, fillColor: '#3A7AEB', fillOpacity: .12, interactive: false }).addTo(map);
      me.dot = L.marker(ll, { icon: meIcon(p.coords.heading), pane: 'me', zIndexOffset: 2000, keyboard: false })
        .bindPopup(() => `<div class="pop-title">You are here</div><span class="muted">±${Math.round(me.last.acc)} m · ${fmtTime(me.last.t / 1000, true)}</span>`).addTo(map);
    } else {
      glide(me.dot, ll, 800); me.ring.setLatLng(ll).setRadius(p.coords.accuracy);
      me.dot.setIcon(meIcon(p.coords.heading));
    }
    if (first) {
      sel.from = { name: 'My location', lat: ll[0], lon: ll[1] }; $('#fromInput').value = 'My location'; drawEnds();
      map.setView(ll, Math.max(map.getZoom(), 16));
    } else if (me.follow) map.panTo(ll, { animate: true });
    if (sel.from && sel.from.name === 'My location' && !APP.inTrip) { sel.from.lat = ll[0]; sel.from.lon = ll[1]; }
  }
  function onFixError(e) {
    $('#locateBtn').classList.remove('on', 'follow');
    if (me.watch !== null) navigator.geolocation.clearWatch(me.watch); me.watch = null;
    alertSheet(e.code === 1 ? 'Location is blocked. Allow location for this site in your browser settings, then tap the locate button again.'
      : 'Couldn\'t get your location right now. Try again in a moment.');
  }
  const setFollow = on => { me.follow = on; $('#locateBtn').classList.toggle('follow', on); };
  $('#locateBtn').onclick = () => {
    if (!('geolocation' in navigator)) return alertSheet('This browser can\'t share your location.');
    if (me.watch === null) {
      $('#locateBtn').classList.add('on');
      me.watch = navigator.geolocation.watchPosition(onFix, onFixError, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
    } else if (me.last) {
      sel.from = { name: 'My location', lat: me.last.lat, lon: me.last.lon }; $('#fromInput').value = 'My location';
      map.setView([me.last.lat, me.last.lon], Math.max(map.getZoom(), 16));
    }
    setFollow(true);
  };
  map.on('dragstart', () => setFollow(false));
  $('#goBtn').onclick = async () => {
    sug.hidden = true; clearTimeout(timer);
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
