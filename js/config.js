window.CONFIG = {
  center: [43.5448, -80.2482],   // downtown Guelph
  zoom: 13,
  // City of Guelph open data (ArcGIS REST) — see "Guelph GeoServices.txt"
  gis: {
    addresses: 'https://gismaps.guelph.ca/hosting/rest/services/OpenData/OpenData1/FeatureServer/0',
    streets:   'https://gismaps.guelph.ca/hosting/rest/services/OpenData/OpenData1/FeatureServer/1',
    trails:    'https://gismaps.guelph.ca/hosting/rest/services/OpenData/OpenData1/FeatureServer/21'
  },
  // GTFS-Realtime. Snapshot files in the repo for now; point these at a CORS proxy
  // in front of Guelph Transit's live feed later and set refreshSeconds (e.g. 20).
  realtime: {
    vehicles: 'data/realtime/vehiclepositions.pb',
    alerts:   'data/realtime/alerts.pb',
    refreshSeconds: 0
  },
  walkSpeedKmh: 4.8,
  walkshedMinutes: 10
};
