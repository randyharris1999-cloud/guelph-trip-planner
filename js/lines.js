// Route lines drawn on the right-hand side of the street, with direction-of-travel arrows.
//
// L.OffsetLine  – a polyline shifted to the RIGHT of its direction of travel. `offsets` gives the
//                 shift in metres for each vertex (from the parcel-fabric ROW widths in
//                 data/gtfs/route_offsets.json); it is converted to screen pixels at every zoom so the
//                 line stays in its lane. minPx keeps the two directions apart when zoomed out.
// L.ArrowLine   – same geometry, drawn as small chevrons every `spacing` px pointing the way the bus goes.
(function () {
  const DEFAULT_M = 6;   // where the parcel fabric has no road parcel (terminals, intersections)
  const mPerPx = map => 40075016.686 * Math.cos(map.getCenter().lat * Math.PI / 180) / (256 * 2 ** map.getZoom());

  // shift a screen-space line to the right of travel (screen y points down, so right = (-uy, ux))
  function shift(pts, px) {
    const n = pts.length; if (n < 2) return pts;
    const nr = [];
    for (let i = 0; i < n - 1; i++) {
      const dx = pts[i + 1].x - pts[i].x, dy = pts[i + 1].y - pts[i].y, l = Math.hypot(dx, dy);
      nr.push(l > 1e-6 ? [-dy / l, dx / l] : (nr[i - 1] || null));
    }
    for (let i = nr.length - 1; i >= 0; i--) if (!nr[i]) nr[i] = nr[i + 1] || [0, 0];
    return pts.map((p, i) => {
      const a = nr[i - 1] || nr[i], b = nr[i] || nr[i - 1];
      let mx = a[0] + b[0], my = a[1] + b[1]; const ml = Math.hypot(mx, my);
      if (ml < 1e-6) { mx = b[0]; my = b[1]; } else { mx /= ml; my /= ml; }   // U-turn: use the outgoing side
      const k = Math.min(2, 1 / Math.max(.5, mx * b[0] + my * b[1]));        // miter, capped at sharp corners
      return L.point(p.x + mx * px[i] * k, p.y + my * px[i] * k);
    });
  }

  L.OffsetLine = L.Polyline.extend({
    options: { offsets: null, minPx: 0, maxPx: 40 },
    _project() {
      L.Polyline.prototype._project.call(this);
      const o = this.options, m = mPerPx(this._map);
      this._rings = this._rings.map(r => shift(r, r.map((_, i) => {
        const v = o.offsets && o.offsets[i] != null ? o.offsets[i] : DEFAULT_M;
        return Math.max(o.minPx, Math.min(o.maxPx, v / m));
      })));
      const b = new L.Bounds(); this._rings.forEach(r => r.forEach(p => b.extend(p)));
      if (b.isValid()) { const w = this._clickTolerance(), t = L.point(w, w); this._pxBounds = new L.Bounds(b.min.subtract(t), b.max.add(t)); }
    }
  });

  L.ArrowLine = L.OffsetLine.extend({
    options: { spacing: 90, size: 4, minZoom: 14, weight: 2, fill: false, interactive: false, lineCap: 'round', lineJoin: 'round' },
    _update() {
      if (!this._map) return;
      const o = this.options, parts = [], s = o.size, view = this._renderer._bounds;
      if (this._map.getZoom() >= o.minZoom) for (const r of this._rings) {
        let t = o.spacing / 2;
        for (let i = 0; i < r.length - 1; i++) {
          const a = r[i], dx = r[i + 1].x - a.x, dy = r[i + 1].y - a.y, len = Math.hypot(dx, dy);
          if (len < 1e-6) continue;
          const ux = dx / len, uy = dy / len;
          for (; t < len; t += o.spacing) {
            const px = a.x + ux * t, py = a.y + uy * t;
            if (view && !view.contains([px, py])) continue;
            parts.push([L.point(px - ux * s - uy * s * 1.1, py - uy * s + ux * s * 1.1), L.point(px + ux * s, py + uy * s),
                        L.point(px - ux * s + uy * s * 1.1, py - uy * s - ux * s * 1.1)]);
          }
          t -= len;
        }
      }
      this._parts = parts;
      this._updatePath();
    }
  });

  // per-vertex offsets (metres) for a route shape, from data/gtfs/route_offsets.json (decimetres)
  window.shapeOffsets = (routeId, shapeIdx) => ((window.APP && APP.offsets && APP.offsets[routeId] && APP.offsets[routeId][shapeIdx]) || [])
    .map(v => v == null ? null : v / 10);
})();
