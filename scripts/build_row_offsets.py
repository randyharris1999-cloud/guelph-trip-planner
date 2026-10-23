"""Right-hand lane offsets for every bus route shape, from the City of Guelph parcel fabric.

Run in the QGIS Python console (needs internet). For each shape segment it casts a line
perpendicular to the direction of travel across the ROAD PARCEL / LANEWAY polygons (the
right-of-way), measures the ROW on each side, and stores how far to the RIGHT of the GTFS line
the centre of the right-hand half of the road sits:  offset = (dR - dL)/2 + ROW/4.
Output: data/gtfs/route_offsets.json  {route_id: [[offset_decimetres | null per vertex], ...]}
(null = no road parcel found there, e.g. inside a terminal or across an intersection; the app
uses a default of 6 m.)  Re-run whenever routes.json is rebuilt.
"""
import urllib.request, json, math, statistics, sys
from qgis.core import (QgsGeometry, QgsPointXY, QgsSpatialIndex, QgsFeature, QgsCoordinateTransform,
                       QgsCoordinateReferenceSystem, QgsProject)

ROUTES = "https://raw.githubusercontent.com/randyharris1999-cloud/guelph-trip-planner/main/data/gtfs/routes.json"
PARCELS = ("https://gismaps.guelph.ca/hosting/rest/services/OpenData/OpenData1/FeatureServer/16/query?"
           "where=PARCELTYPE%3D%27ROAD+PARCEL%27+OR+PARCELTYPE%3D%27LANEWAY%27&outFields=OBJECTID"
           "&outSR=26917&geometryPrecision=2&f=json&resultRecordCount=100000")
OUT = sys.argv[1] if len(sys.argv) > 1 else "route_offsets.json"

routes = json.load(urllib.request.urlopen(ROUTES, timeout=60))
j = json.load(urllib.request.urlopen(PARCELS, timeout=120))
polys, idx = [], QgsSpatialIndex()
for k, f in enumerate(j["features"]):
    g = QgsGeometry.fromPolygonXY([[QgsPointXY(x, y) for x, y in r] for r in f["geometry"]["rings"]])
    if not g.isGeosValid(): g = g.makeValid()
    polys.append(g); ft = QgsFeature(k); ft.setGeometry(g); idx.addFeature(ft)
tr = QgsCoordinateTransform(QgsCoordinateReferenceSystem("EPSG:4326"), QgsCoordinateReferenceSystem("EPSG:26917"), QgsProject.instance())

def probe(px, py, nx, ny, R=40):
    """(left, right) distance in m from the point to the ROW edge, or None."""
    ray = QgsGeometry.fromPolylineXY([QgsPointXY(px - nx * R, py - ny * R), QgsPointXY(px + nx * R, py + ny * R)])
    ids = idx.intersects(ray.boundingBox())
    if not ids: return None
    U = QgsGeometry.unaryUnion([polys[i] for i in ids]); P = QgsGeometry.fromPointXY(QgsPointXY(px, py))
    if U.distance(P) > 1.5: return None
    for part in ray.intersection(U).asGeometryCollection():
        if part.type() != 1 or part.distance(P) > 1.5: continue
        pts = [q for l in (part.asMultiPolyline() if part.isMultipart() else [part.asPolyline()]) for q in l]
        if not pts: continue
        ts = [(q.x() - px) * nx + (q.y() - py) * ny for q in pts]; dR, dL = max(ts), -min(ts)
        if dR >= R - .5 or dL >= R - .5 or dR + dL > 50 or dR < 0 or dL < 0: return None
        return dL, dR
    return None

out = {}
for rid, r in routes.items():
    res = []
    for sh in r["shapes"]:
        P = [tr.transform(QgsPointXY(lon, lat)) for lat, lon in sh]; seg = []
        for i in range(len(P) - 1):
            x1, y1, x2, y2 = P[i].x(), P[i].y(), P[i + 1].x(), P[i + 1].y(); L = math.hypot(x2 - x1, y2 - y1)
            if L < 1: seg.append(None); continue
            dx, dy = (x2 - x1) / L, (y2 - y1) / L; nx, ny = dy, -dx   # right of travel
            vals = []
            for k in range(int((L - 16) // 15) + 1 if L > 16 else 1):
                t = (8 + k * 15) / L if L > 16 else .5
                v = probe(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, nx, ny)
                if v: vals.append(v)
            if vals:
                dL = statistics.median(v[0] for v in vals); dR = statistics.median(v[1] for v in vals)
                seg.append(max(1.0, min((dR - dL) / 2 + (dL + dR) / 4, dR - 1.5)))
            else: seg.append(None)
        vtx = []
        for i in range(len(P)):
            nb = [s for s in (seg[i - 1] if i > 0 else None, seg[i] if i < len(seg) else None) if s is not None]
            vtx.append(round(sum(nb) / len(nb) * 10) if nb else None)
        res.append(vtx)
    out[rid] = res
open(OUT, "w").write(json.dumps(out, separators=(',', ':')))
print("saved", OUT)
