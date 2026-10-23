window.CONFIG = {
  center: [43.5432, -80.2475],   // downtown Guelph (St. George's Square)
  zoom: 15,
  // City of Guelph open data (ArcGIS REST) — see "Guelph GeoServices.txt"
  gis: {
    addresses: 'https://gismaps.guelph.ca/hosting/rest/services/OpenData/OpenData1/FeatureServer/0',
    streets:   'https://gismaps.guelph.ca/hosting/rest/services/OpenData/OpenData1/FeatureServer/1',
    trails:    'https://gismaps.guelph.ca/hosting/rest/services/OpenData/OpenData1/FeatureServer/21',
    // searchable places in the From / To boxes
    places: {
      facilities: 'https://gismaps.guelph.ca/hosting/rest/services/OpenData/OpenData1/FeatureServer/32',
      parks:      'https://gismaps.guelph.ca/hosting/rest/services/OpenData/OpenData1/FeatureServer/5',
      schools:    'https://gismaps.guelph.ca/hosting/rest/services/OpenData/OpenData1/FeatureServer/36',
      gardens:    'https://gismaps.guelph.ca/hosting/rest/services/OpenData/OpenData1/FeatureServer/18',
      restrooms:  'https://gismaps.guelph.ca/hosting/rest/services/OpenData/OpenData1/FeatureServer/20'
    },
    // extra walking paths joined into the walk network
    paths: [
      { url: 'https://gismaps.guelph.ca/hosting/rest/services/OpenData/OpenData2/FeatureServer/0',   // Sidewalks (incl. walkways)
        where: "STATUS = 'BUILT'", fields: 'STATUS' }
    ]
  },
  // GTFS-Realtime. Guelph Transit's live feed blocks browsers (no CORS header), so it is read
  // through a tiny Cloudflare Worker relay (see worker/). Paste the Worker's address into
  // liveBase, e.g. 'https://guelph-transit-feed.yourname.workers.dev'. Leave it empty to use the
  // snapshot files in data/realtime/. A ?feed=<url> query parameter overrides liveBase for testing.
  realtime: {
    liveBase: 'https://guelph-trip-planner.randyharris1999.workers.dev',
    snapshot: { vehicles: 'data/realtime/vehiclepositions.pb', alerts: 'data/realtime/alerts.pb' },
    refreshSeconds: 15
  },
  walkSpeedKmh: 4.8,
  walkshedMinutes: 5
};

// Fetch every feature of an ArcGIS layer as GeoJSON, paging past the layer's record limit.
window.arcgisAll = async function (url, where, fields, precision = 6) {
  const base = `${url}/query?where=${encodeURIComponent(where)}`;
  const { count } = await fetch(`${base}&returnCountOnly=true&f=json`).then(r => r.json());
  const page = 1000, pages = [];
  for (let off = 0; off < count; off += page) {
    pages.push(fetch(`${base}&outFields=${fields}&outSR=4326&geometryPrecision=${precision}&orderByFields=OBJECTID&resultOffset=${off}&resultRecordCount=${page}&f=geojson`)
      .then(r => r.json()));
  }
  const all = await Promise.all(pages);
  return { type: 'FeatureCollection', features: all.flatMap(g => g.features || []) };
};
