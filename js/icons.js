// Map symbology
//  bus stop  – green stop sign on a post (Stop A), with chips for the routes that stop there
//  bus       – route-coloured bus with its number on the body; pointer on the rim shows heading (Bus A)
//  dark-green teardrop + tree   (trail)          body #136935, halo #D8F0E0
//  blue teardrop + walker       (start / you)    body #3A7AEB, halo #D0E6FF
(function (g) {
  const PIN = 'M17 2.5C8.7 2.5 2.5 8.9 2.5 17c0 6.2 3.9 10.6 8.4 14.6L17 41.5l6.1-9.9C27.6 27.6 31.5 23.2 31.5 17 31.5 8.9 25.3 2.5 17 2.5z';
  const GLYPH = {
    leaf: '<path d="M10.5 22.5c0-7 5-11.8 13-12-0.2 8-5 13-12 13-.4 0-.7-.4-1-1z" fill="#fff"/><path d="M11.5 22.5c3.2-4.1 6.6-7.2 10.5-10.3" stroke="VAR" stroke-width="1.4" fill="none" stroke-linecap="round"/>',
    tree: '<path d="M17 8.5l-5 6h2.8l-3.8 4.8h3.4L10.5 24h5.3v3h2.4v-3h5.3l-3.9-4.7h3.4l-3.8-4.8h2.8z" fill="#fff"/>',
    walk: '<circle cx="17.6" cy="9.6" r="2.2" fill="#fff"/><path d="M15.4 12.8l-2.6 1.5-.9 4 1.7.4.7-2.9 1-.5-1.2 5.6-.9 5.3h2l.8-4.3 1.6 2v4.3h1.9v-5.3l-1.8-2.4.5-2.7.6 1.3 2.6 1.6.9-1.4-2.3-1.5-1.1-2.6c-.4-.9-1.2-1.4-2.1-1.4-.4 0-.7.1-1.2.3z" fill="#fff"/>',
    flag: '<path d="M12.5 8.5v18h2v-7h7.5l-1.8-3.6L22 12.4h-7.5V8.5z" fill="#fff"/>'
  };
  const STYLE = {
    stop:  { hi: '#3EC36D', mid: '#2EAD5E', lo: '#1A9546', halo: '#C8F6D9', glyph: 'leaf' },
    dest:  { hi: '#3EC36D', mid: '#2EAD5E', lo: '#1A9546', halo: '#C8F6D9', glyph: 'flag' },
    trail: { hi: '#1C7A42', mid: '#136935', lo: '#0C5A2D', halo: '#D8F0E0', glyph: 'tree' },
    walk:  { hi: '#4A88F2', mid: '#3A7AEB', lo: '#2F6AD8', halo: '#D0E6FF', glyph: 'walk' }
  };
  // bus glyph (front view) in a 24×24 box
  const BUS = (c, hole) => `<rect x="4" y="3" width="16" height="15" rx="3.2" fill="${c}"/><rect x="6.3" y="5.3" width="11.4" height="6" rx="1.2" fill="${hole}"/>
    <circle cx="8.2" cy="14.6" r="1.2" fill="${hole}"/><circle cx="15.8" cy="14.6" r="1.2" fill="${hole}"/><rect x="6" y="17" width="3.2" height="3.6" rx="1" fill="${c}"/><rect x="14.8" y="17" width="3.2" height="3.6" rx="1" fill="${c}"/>`;
  // stop sign on a post, 30×40, foot of the post at (15, 40)
  const stopSvg = (w = 30, h = 40) => `<svg viewBox="0 0 30 40" width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
    <rect x="13.5" y="27" width="3" height="10" fill="#5f6661"/><rect x="10.5" y="36.6" width="9" height="3" rx="1.5" fill="#5f6661"/>
    <rect x="2.25" y="1.25" width="25.5" height="25.5" rx="7" fill="#2EAD5E" stroke="#fff" stroke-width="2.5"/>
    <g transform="translate(6.5 5.5) scale(.71)">${BUS('#fff', '#2EAD5E')}</g></svg>`;
  const label = r => r.n.replace(/\s+/g, '').replace('Lite', 'L');
  const fgFor = c => luminance(c) > 0.62 ? '#1b1b1b' : '#fff';
  const chip = r => `<span class="rchip" style="background:${r.c};color:${fgFor(r.c)}">${label(r)}</span>`;
  // stop marker: sign + the routes that serve it (first 4, then "+n")
  function stop(routes = []) {
    const rs = routes.filter(Boolean), more = rs.length > 4 ? `<span class="rchip more">+${rs.length - 4}</span>` : '';
    const chips = rs.length ? `<span class="rchips">${rs.slice(0, 4).map(chip).join('')}${more}</span>` : '';
    return L.divIcon({ className: 'stopmk', html: stopSvg() + chips, iconSize: [30, 40], iconAnchor: [15, 39], popupAnchor: [0, -36], tooltipAnchor: [14, -26] });
  }
  let n = 0;
  function svg(kind, w = 34, h = 44) {
    if (kind === 'stop') return stopSvg(Math.round(h * 30 / 40), h);
    const s = STYLE[kind], id = 'pg' + (n++);
    return `<svg viewBox="0 0 34 44" width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
      <defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${s.hi}"/><stop offset=".55" stop-color="${s.mid}"/><stop offset="1" stop-color="${s.lo}"/></linearGradient></defs>
      <path d="${PIN}" fill="url(#${id})" stroke="${s.halo}" stroke-width="3" stroke-linejoin="round"/>
      ${GLYPH[s.glyph].replace('VAR', s.mid)}</svg>`;
  }
  function pin(kind) {
    if (kind === 'stop') return stop();
    return L.divIcon({ className: 'pin', html: svg(kind), iconSize: [34, 44], iconAnchor: [17, 42], popupAnchor: [0, -38] });
  }
  // Bus A: route-coloured bus, number on the body, heading pointer on the rim
  function bus(route, bearing) {
    const c = route ? route.c : '#4F832E', fg = fgFor(c), txt = route ? label(route) : '?';
    const head = bearing != null ? `<svg class="hd" viewBox="0 0 52 52" style="transform:rotate(${bearing}deg)"><path d="M26 0 L32.5 7.5 L19.5 7.5 Z" fill="${c}" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>` : '';
    return L.divIcon({ className: 'busmk', html: `${head}<span class="bd" style="background:${c};color:${fg}"><i class="sg"></i><b${txt.length > 2 ? ' class="sm"' : ''}>${txt}</b></span><span class="wh"><i></i><i></i></span>`,
      iconSize: [52, 52], iconAnchor: [26, 26], popupAnchor: [0, -16] });
  }
  function luminance(hex) {
    const v = parseInt(hex.slice(1), 16), r = v >> 16, gg = (v >> 8) & 255, b = v & 255;
    return (0.299 * r + 0.587 * gg + 0.114 * b) / 255;
  }
  // popup content as a DOM node, so Leaflet's popup.update() keeps live content injected later
  const popEl = html => { const d = document.createElement('div'); d.innerHTML = html; return d; };
  g.Icons = { pin, bus, stop, svg, popEl };
})(window);
