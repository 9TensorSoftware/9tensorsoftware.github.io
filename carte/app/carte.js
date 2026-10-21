// Carte: a free map for KML, KMZ, GeoJSON, GPX and CSV files. Files are read in the browser only.
(() => {
  const $ = (id) => document.getElementById(id);
  const KEY = "carte.layers.v1";
  const PALETTE = ["#2F6FD0", "#D4572A", "#1F8A70", "#8E5BC9", "#C2185B", "#B7950B", "#00838F", "#5D6D7E"];

  const map = L.map("map", { zoomControl: true, worldCopyJump: true, minZoom: 2 }).setView([30, 10], 2);
  const bases = {
    streets: L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }),
    satellite: L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
      maxZoom: 19, attribution: "Imagery &copy; Esri, Maxar, Earthstar Geographics",
    }),
  };
  let base = bases.streets.addTo(map);
  $("basemap").addEventListener("change", (e) => { map.removeLayer(base); base = bases[e.target.value].addTo(map); base.bringToBack(); });

  const hint = (text, ms) => { $("hint").textContent = text; if (ms) setTimeout(() => { if ($("hint").textContent === text) $("hint").textContent = ""; }, ms); };
  map.on("mousemove", (e) => { $("coords").textContent = `${e.latlng.lat.toFixed(5)}, ${e.latlng.lng.toFixed(5)}`; });

  // ── Layers ──

  const layers = []; // { id, name, color, data (GeoJSON), group, visible }
  let seq = 0;

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const strip = (s) => String(s).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

  function popup(feature) {
    const p = feature.properties || {};
    const title = p.name || p.Name || p.title || p.NAME || "";
    const rows = Object.entries(p)
      .filter(([k, v]) => v !== null && v !== "" && typeof v !== "object" && !/^(name|styleUrl|styleHash|styleMapHash|stroke|stroke-opacity|stroke-width|fill|fill-opacity|icon|_layer)$/i.test(k))
      .slice(0, 30)
      .map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(strip(v)).slice(0, 400)}</td></tr>`)
      .join("");
    return `${title ? `<h3>${esc(title)}</h3>` : ""}${rows ? `<table class="props">${rows}</table>` : title ? "" : "<em>No attributes</em>"}`;
  }

  function build(layer) {
    if (layer.group) map.removeLayer(layer.group);
    layer.group = L.geoJSON(layer.data, {
      style: () => ({ color: layer.color, weight: 2.5, fillOpacity: 0.18 }),
      pointToLayer: (_, latlng) => L.circleMarker(latlng, { radius: 6, color: "#fff", weight: 1.5, fillColor: layer.color, fillOpacity: 0.95 }),
      onEachFeature: (f, l) => l.bindPopup(() => popup(f), { maxWidth: 320 }),
    });
    if (layer.visible) layer.group.addTo(map);
  }

  function count(data) {
    return (data.features || []).length;
  }

  function addLayer(name, data, { fit = true, color } = {}) {
    if (!count(data)) { hint(`${name}: no map features found`, 4000); return; }
    const layer = { id: ++seq, name, color: color || PALETTE[(seq - 1) % PALETTE.length], data, visible: true };
    layers.push(layer);
    build(layer);
    renderList();
    if (fit) zoomTo(layer);
    save();
    return layer;
  }

  function zoomTo(layer) {
    const b = layer.group.getBounds();
    if (b.isValid()) map.fitBounds(b, { padding: [40, 40], maxZoom: 15 });
  }

  function removeLayer(layer) {
    map.removeLayer(layer.group);
    layers.splice(layers.indexOf(layer), 1);
    if (layer === mine) mine = null;
    renderList();
    save();
  }

  function renderList() {
    $("no-layers").hidden = layers.length > 0;
    $("layers").replaceChildren(...layers.map((layer) => {
      const row = document.createElement("div");
      row.className = "layer";
      const color = document.createElement("input");
      color.type = "color";
      color.value = layer.color;
      color.title = "Colour";
      color.addEventListener("input", () => { layer.color = color.value; build(layer); save(); });
      const name = document.createElement("div");
      name.className = "layer__name";
      name.textContent = layer.name;
      const small = document.createElement("small");
      const n = count(layer.data);
      small.textContent = `${n} feature${n === 1 ? "" : "s"}`;
      name.append(small);
      const actions = document.createElement("div");
      actions.className = "layer__actions";
      const btn = (label, title, fn) => {
        const b = document.createElement("button");
        b.className = "icon-btn";
        b.type = "button";
        b.textContent = label;
        b.title = title;
        b.setAttribute("aria-label", `${title}: ${layer.name}`);
        b.addEventListener("click", fn);
        return b;
      };
      actions.append(
        btn(layer.visible ? "◉" : "○", layer.visible ? "Hide" : "Show", () => { layer.visible = !layer.visible; build(layer); renderList(); save(); }),
        btn("⤢", "Zoom to", () => zoomTo(layer)),
        btn("✕", "Remove", () => removeLayer(layer)),
      );
      row.append(color, name, actions);
      return row;
    }));
  }

  // ── Reading files ──

  const xml = (text) => new DOMParser().parseFromString(text, "text/xml");

  function fromCSV(text) {
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    const split = (l) => {
      const out = []; let cur = "", q = false;
      for (let i = 0; i < l.length; i++) {
        const c = l[i];
        if (q) { if (c === '"' && l[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
        else if (c === '"') q = true; else if (c === "," || c === ";" || c === "\t") { out.push(cur); cur = ""; } else cur += c;
      }
      out.push(cur);
      return out.map((s) => s.trim());
    };
    const head = split(lines.shift() || "");
    const find = (names) => head.findIndex((h) => names.includes(h.toLowerCase()));
    const la = find(["lat", "latitude", "y"]), lo = find(["lon", "lng", "long", "longitude", "x"]);
    if (la < 0 || lo < 0) throw new Error("The CSV needs latitude and longitude columns (lat, lon).");
    const features = [];
    for (const l of lines) {
      const c = split(l), lat = parseFloat(c[la]), lon = parseFloat(c[lo]);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const properties = {};
      head.forEach((h, i) => { if (i !== la && i !== lo) properties[h] = c[i]; });
      features.push({ type: "Feature", properties, geometry: { type: "Point", coordinates: [lon, lat] } });
    }
    return { type: "FeatureCollection", features };
  }

  function normalise(g) {
    if (g.type === "FeatureCollection") return g;
    if (g.type === "Feature") return { type: "FeatureCollection", features: [g] };
    if (g.type && g.coordinates) return { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: g }] };
    throw new Error("That JSON isn't GeoJSON.");
  }

  async function read(file) {
    const ext = file.name.split(".").pop().toLowerCase();
    if (ext === "kmz") {
      const zip = await JSZip.loadAsync(file);
      const kml = Object.values(zip.files).find((f) => /\.kml$/i.test(f.name));
      if (!kml) throw new Error("No KML inside that KMZ.");
      return toGeoJSON.kml(xml(await kml.async("text")));
    }
    const text = await file.text();
    if (ext === "kml") return toGeoJSON.kml(xml(text));
    if (ext === "gpx") return toGeoJSON.gpx(xml(text));
    if (ext === "csv" || ext === "txt") return fromCSV(text);
    return normalise(JSON.parse(text));
  }

  async function open(files) {
    for (const f of files) {
      try { addLayer(f.name, await read(f)); }
      catch (err) { hint(`${f.name}: ${err.message || "couldn't read this file"}`, 5000); }
    }
  }

  $("files").addEventListener("change", (e) => { open([...e.target.files]); e.target.value = ""; });
  const stage = document.querySelector(".stage");
  stage.addEventListener("dragover", (e) => { e.preventDefault(); stage.classList.add("is-dragging"); });
  stage.addEventListener("dragleave", (e) => { if (!stage.contains(e.relatedTarget)) stage.classList.remove("is-dragging"); });
  stage.addEventListener("drop", (e) => { e.preventDefault(); stage.classList.remove("is-dragging"); open([...e.dataTransfer.files]); });

  // ── Tools: add point, measure ──

  let mode = null, mine = null;
  let measurePts = [], measureLine = null, measureTip = null;

  function setMode(next) {
    if (mode === "measure" && next !== "measure") finishMeasure();
    mode = mode === next ? null : next;
    $("point").setAttribute("aria-pressed", String(mode === "point"));
    $("measure").setAttribute("aria-pressed", String(mode === "measure"));
    map.getContainer().style.cursor = mode ? "crosshair" : "";
    if (mode === "point") hint("Click the map to drop a point");
    else if (mode === "measure") { clearMeasure(); hint("Click to add points. Double-click or press Esc to finish"); }
    else hint("");
    if (mode === "measure") map.doubleClickZoom.disable(); else map.doubleClickZoom.enable();
  }

  const fmtDist = (m) => (m >= 1000 ? `${(m / 1000).toFixed(m >= 100000 ? 0 : 2)} km` : `${Math.round(m)} m`);
  function total() {
    let d = 0;
    for (let i = 1; i < measurePts.length; i++) d += measurePts[i - 1].distanceTo(measurePts[i]);
    return d;
  }
  function clearMeasure() {
    measurePts = [];
    if (measureLine) map.removeLayer(measureLine);
    if (measureTip) map.removeLayer(measureTip);
    measureLine = measureTip = null;
  }
  function finishMeasure() {
    if (measurePts.length > 1) $("measure-out").textContent = `Last measurement: ${fmtDist(total())} over ${measurePts.length} points.`;
  }

  map.on("click", (e) => {
    if (mode === "point") {
      if (!mine) {
        mine = { id: ++seq, name: "My points", color: "#C2185B", data: { type: "FeatureCollection", features: [] }, visible: true };
        layers.push(mine);
      }
      const n = mine.data.features.length + 1;
      mine.data.features.push({ type: "Feature", properties: { name: `Point ${n}`, latitude: +e.latlng.lat.toFixed(6), longitude: +e.latlng.lng.toFixed(6) }, geometry: { type: "Point", coordinates: [+e.latlng.lng.toFixed(6), +e.latlng.lat.toFixed(6)] } });
      build(mine);
      renderList();
      save();
    } else if (mode === "measure") {
      measurePts.push(e.latlng);
      if (!measureLine) measureLine = L.polyline(measurePts, { color: "#111214", weight: 3, dashArray: "6 6" }).addTo(map);
      else measureLine.setLatLngs(measurePts);
      if (measureTip) map.removeLayer(measureTip);
      measureTip = L.tooltip({ permanent: true, direction: "right", className: "measure-label", offset: [10, 0] }).setLatLng(e.latlng).setContent(fmtDist(total())).addTo(map);
      $("measure-out").textContent = `${fmtDist(total())} so far.`;
    }
  });
  map.on("dblclick", () => { if (mode === "measure") { finishMeasure(); setMode(null); } });

  $("point").addEventListener("click", () => setMode("point"));
  $("measure").addEventListener("click", () => setMode("measure"));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && mode) { if (mode === "measure") finishMeasure(); setMode(null); } });

  // ── Export, example, clear ──

  $("export").addEventListener("click", () => {
    const features = layers.flatMap((l) => l.data.features.map((f) => ({ ...f, properties: { ...f.properties, _layer: l.name } })));
    if (!features.length) { hint("Nothing on the map to export yet", 3000); return; }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify({ type: "FeatureCollection", features })], { type: "application/geo+json" }));
    a.download = "carte-export.geojson";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  const EXAMPLE = {
    type: "FeatureCollection",
    features: [
      ["Port of Rotterdam", 4.05, 51.95], ["Port of Singapore", 103.84, 1.26], ["Port of Shanghai", 121.8, 30.63],
      ["Port of Jebel Ali", 55.03, 25.01], ["Port of Los Angeles", -118.27, 33.73], ["Port of Santos", -46.3, -23.97],
    ].map(([name, lon, lat]) => ({ type: "Feature", properties: { name, kind: "Container port" }, geometry: { type: "Point", coordinates: [lon, lat] } }))
      .concat([{ type: "Feature", properties: { name: "Example route", kind: "Shipping lane (illustrative)" }, geometry: { type: "LineString", coordinates: [[4.05, 51.95], [-5.6, 36.0], [32.3, 31.3], [43.4, 12.6], [55.03, 25.01], [80, 6], [103.84, 1.26], [121.8, 30.63]] } }]),
  };
  $("example").addEventListener("click", () => addLayer("Example: ports and a route", JSON.parse(JSON.stringify(EXAMPLE))));
  $("clear").addEventListener("click", () => {
    if (layers.length && !confirm("Remove every layer from the map?")) return;
    for (const l of [...layers]) map.removeLayer(l.group);
    layers.length = 0;
    mine = null;
    clearMeasure();
    renderList();
    save();
  });

  // ── Remember layers in this browser ──

  let saveTimer;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        const out = JSON.stringify(layers.map(({ name, color, data, visible }) => ({ name, color, data, visible })));
        if (out.length < 4_000_000) localStorage.setItem(KEY, out); else localStorage.removeItem(KEY);
      } catch { /* storage full or blocked: keep working unsaved */ }
    }, 400);
  }

  let saved = [];
  try { saved = JSON.parse(localStorage.getItem(KEY)) || []; } catch { /* none */ }
  for (const s of saved) {
    const l = addLayer(s.name, s.data, { fit: false, color: s.color });
    if (!l) continue;
    if (s.visible === false) { l.visible = false; build(l); }
    if (s.name === "My points") mine = l;
  }
  renderList();
  if (!saved.length) hint("Open or drop a KML, KMZ, GeoJSON, GPX or CSV file, or try the example", 7000);
})();
