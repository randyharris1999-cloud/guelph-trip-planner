# Guelph Trip Planner

Mobile web app (Leaflet) for planning walk + bus trips in Guelph, Ontario.

* **Streets, trails, addresses** – City of Guelph Open Data (ArcGIS REST, loaded live).
* **Transit** – Guelph Transit GTFS (`data/gtfs/*.json`, built with `scripts/build_gtfs.py`).
* **Bus positions & alerts** – live Guelph Transit GTFS-Realtime feed via a Cloudflare Worker relay (`worker/`), refreshed every 15 s and decoded in the browser by `js/gtfsrt.js`. Falls back to the snapshot in `data/realtime/*.pb` if the relay isn't set or is unreachable.
* **Live location** – tap the locate button for a blue "you are here" dot with an accuracy ring and heading
  that follows you as you move (and becomes the trip start). Drag the map to stop following; tap again to re-centre.
* **Walk area** – 5-minute walkshed over the street + trail network (`walkshedMinutes` in `js/config.js`).

## Rebuild the GTFS data
```
unzip google_transit.zip -d gtfs
python3 scripts/build_gtfs.py gtfs data/gtfs
```

Deep link example: `?from=149 Harvard Road&to=1 Carden Street`

Basemap © OpenStreetMap contributors. Created by Randy Harris.
