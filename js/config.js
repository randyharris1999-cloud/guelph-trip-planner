window.CONFIG = {
  center: [43.5432, -80.2475],   // downtown Guelph (St. George's Square)
  zoom: 15,
  // City of Guelph open data (ArcGIS REST) — see "Guelph GeoServices.txt"
  gis: {
    addresses: 'https://gismaps.guelph.ca/hosting/rest/services/OpenData/OpenData1/FeatureServer/0',
    streets:   'https://gismaps.guelph.ca/hosting/rest/services/OpenData/OpenData1/FeatureServer/1',
    trails:    'https://gismaps.guelph.ca/hosting/rest/services/OpenData/OpenData1/FeatureServer/21'
  },
  // GTFS-Realtime. Guelph Transit's live feed blocks browsers (no CORS header), so it is read
  // through a tiny Cloudflare Worker relay (see worker/). Paste the Worker's address into
  // liveBase, e.g. 'https://guelph-transit-feed.yourname.workers.dev'. Leave it empty to use the
  // snapshot files in data/realtime/. A ?feed=<url> query parameter overrides liveBase for testing.
  realtime: {
    liveBase: '',
    snapshot: { vehicles: 'data/realtime/vehiclepositions.pb', alerts: 'data/realtime/alerts.pb' },
    refreshSeconds: 15
  },
  walkSpeedKmh: 4.8,
  walkshedMinutes: 5
};
