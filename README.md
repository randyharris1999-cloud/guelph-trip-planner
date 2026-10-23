# Guelph Trip Planner

Mobile web app (Leaflet) for planning walk + bus trips in Guelph, Ontario.

* **Streets, trails, addresses** – City of Guelph Open Data (ArcGIS REST, loaded live).
* **Transit** – Guelph Transit GTFS (`data/gtfs/*.json`, built with `scripts/build_gtfs.py`).
* **Bus positions & alerts** – live Guelph Transit GTFS-Realtime feed via a Cloudflare Worker relay (`worker/`), refreshed every 15 s and decoded in the browser by `js/gtfsrt.js`. Falls back to the snapshot in `data/realtime/*.pb` if the relay isn't set or is unreachable.
* **Live location** – tap the locate button for a blue "you are here" dot with an accuracy ring and heading
  that follows you as you move (and becomes the trip start). Drag the map to stop following; tap again to re-centre.
* **Bus lines** – each ride and the Routes layer are drawn in the bus's own lane (right-hand side of the street) with
  arrows showing the direction of travel. Lane offsets come from the City parcel fabric's road-parcel ROW widths
  (`data/gtfs/route_offsets.json`, built in QGIS with `scripts/build_row_offsets.py`).
* **Search** – the From / To boxes find street addresses plus City facilities, parks, schools, community gardens and
  public restrooms (City of Guelph open data, loaded live).
* **Refresh countdown** – strip along the bottom of the screen counting down to the next bus-location update.
* **Walk area** – 5-minute walkshed over the street + trail network (`walkshedMinutes` in `js/config.js`).

## Rebuild the GTFS data
```
unzip google_transit.zip -d gtfs
python3 scripts/build_gtfs.py gtfs data/gtfs
```
Then re-run `scripts/build_row_offsets.py` in the QGIS Python console so the lane offsets match the new shapes.

Deep link example: `?from=149 Harvard Road&to=1 Carden Street`

Basemap © OpenStreetMap contributors. Created by Randy Harris.
