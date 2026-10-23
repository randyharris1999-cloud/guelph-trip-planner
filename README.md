# Guelph Trip Planner

Mobile web app (Leaflet) for planning walk + bus trips in Guelph, Ontario.

* **Streets, trails, addresses** – City of Guelph Open Data (ArcGIS REST, loaded live).
* **Transit** – Guelph Transit GTFS (`data/gtfs/*.json`, built with `scripts/build_gtfs.py`).
* **Bus positions & alerts** – GTFS-Realtime snapshot in `data/realtime/*.pb` (decoded in the browser by `js/gtfsrt.js`). To go live, point `CONFIG.realtime` in `js/config.js` at a CORS proxy for the Guelph Transit feed and set `refreshSeconds`.

## Rebuild the GTFS data
```
unzip google_transit.zip -d gtfs
python3 scripts/build_gtfs.py gtfs data/gtfs
```

Deep link example: `?from=149 Harvard Road&to=1 Carden Street`

Basemap © OpenStreetMap contributors. Created by Randy Harris.
