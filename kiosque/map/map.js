// Kiosque map (MAP.md): outlets + administrative regions + borders on one map.
//
// Data (all built locally, none in git):
//   data/map/outlets.json   export_map.py         free fields only, one row per outlet
//   data/map/adm0.json      ingest/boundaries.py  countries, keyed by ISO alpha-2
//   data/map/adm1.json      ingest/boundaries.py  states, keyed "<cc>.<GeoNames admin1 code>"
//   data/map/adm2/<CC>.json ingest/counties.py    counties of one country (loaded with it), keyed "<state>|<county>"
//   data/regions/*          export_regions_ui.py  GeoNames places (world overview + per country)
//
// Outlet row after decode:
//   [lon, lat, prec, type, scope, name, url, cc, a1key, place, ix, county]
//   prec 0 P point · 1 L locality · 2 D district · 3 R state only · 4 C country only · 5 N none
//   scope 0 untagged · 1 local · 2 regional · 3 national
// Place row after decode (see export_regions_ui.py):
//   [lon, lat, level, pop, outlets, seat, name, local, cc, admin1Name, admin2Name, geonameid]
"use strict";
const { createApp } = Vue;
// Public build (build_public_map.py sets this): places + borders only. No outlet data is
// fetched and every outlet control is hidden; the data files ship with outlet counts zeroed.
const PUBLIC = window.KIOSQUE_PUBLIC === true;

// ---------- constants ----------
const SCOPE = ["", "local", "regional", "national"];
const SCOPE_LABEL = { local: "Local", regional: "Statewide / regional", national: "National", "": "Reach not tagged" };
const TYPE_LABEL = { newspaper: "Newspaper", radio: "Radio", tv: "TV", online: "Online", magazine: "Magazine",
  press_agency: "Press agency", broadcast: "Broadcast (TV or radio)", other: "Other" };
const PRO_FILTERS = ["Owner / parent company", "State control & funding", "Political leaning", "Topic", "Language", "Has RSS feed"];
const PRO_FIELDS = ["Owner & parent company", "State control / public funding", "Political leaning", "Topic",
  "Language", "RSS feeds", "Contact page", "Editions & parent title", "Liveness · first & last seen", "Sources & confidence per fact"];
const PINNED = 2; // prec <= 2 gets a pin

const LV = ["adm1", "adm2", "adm3", "adm4", "adm5", "admd", "city", "town", "village", "neighbourhood"];
const LABEL = {
  adm1: "State / province", adm2: "County / district", adm3: "Admin level 3", adm4: "Admin level 4",
  adm5: "Admin level 5", admd: "Other admin division", city: "City (100k+)", town: "Town (5k–100k)",
  village: "Village (<5k or unknown)", neighbourhood: "Neighbourhood",
};
const HINT = {
  adm3: "sub-district / township / municipality, depending on the country",
  adm4: "commune / Gemeinde / village tract, depending on the country",
  village: "population under 5,000 or not recorded",
};
const SEAT_LABEL = ["", "capital", "seat of government", "state seat", "county seat", "admin-3 seat", "admin-4 seat", "admin-5 seat"];
const COLOR = {
  adm1: "#6b5aa8", adm2: "#c27c2c", adm3: "#2f8f86", adm4: "#7d9a2e", adm5: "#8c8c8c",
  admd: "#a8957a", city: "#b0302a", town: "#8a5a2b", village: "#7f8c99", neighbourhood: "#c95f9a",
};
const COVER = { yes: "#2e9e5b", no: "#e0623a" };
const WEIGHT = { adm1: 1, adm2: 0.55, adm3: 0.32, adm4: 0.22, adm5: 0.18, admd: 0.18,
                 town: 0.3, village: 0.06, neighbourhood: 0.06 };
const WORLD_LEVELS = ["adm1", "adm2", "city", "town"];
const AREA_MAX = 5; // level index <= 5 is an admin area (ring), above is a settlement (dot)
const CSS = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

// ---------- big data lives outside Vue reactivity ----------
let O = [], T = [], NAMEL = [], HOSTL = [], SK = [];  // outlets (SK: sort key, leading punctuation dropped)
let A0 = new Map(), A1 = new Map(), A1BYNAME = new Map(); // boundaries
let C2 = new Map(), C2INDEX = {}, C2CC = "";              // county borders of the selected country
let ROWS = [], VROWS = [], PMATCH = [], A1IX = new Map(); // places
let IV = { rows: [], total: 0 };                     // outlets in view
let KIDS = [];                                       // places drawn as drill-down markers
let MAP = null, PTIMER = null, OTIMER = null, STIMER = null, RESTORING = false, DRILL = false;
let PLOAD = null, VLOAD = null; // in-flight place / village loads
const SETTLEMENT = new Set([6, 7, 8, 9]); // city, town, village, neighbourhood

const host = (u) => { try { return new URL(u).host.replace(/^www\./, ""); } catch { return u || ""; } };
function decodePlaces(data) {
  const { cc, a1, a2, rows } = data;
  for (const r of rows) { r[8] = cc[r[8]]; r[9] = a1[r[9]]; r[10] = a2[r[10]]; }
  return rows;
}
const weight = (r) => {
  const l = LV[r[2]];
  if (l === "city") return 0.6 + Math.min(0.4, Math.sqrt(r[3]) / 8000);
  return WEIGHT[l];
};
// bounding box of a GeoJSON geometry; across the antimeridian, shift west lons by 360
function bbox(geom) {
  const b = [Infinity, Infinity, -Infinity, -Infinity], s = [Infinity, -Infinity];
  const walk = (c) => {
    if (typeof c[0] === "number") {
      b[0] = Math.min(b[0], c[0]); b[1] = Math.min(b[1], c[1]);
      b[2] = Math.max(b[2], c[0]); b[3] = Math.max(b[3], c[1]);
      const x = c[0] < 0 ? c[0] + 360 : c[0]; s[0] = Math.min(s[0], x); s[1] = Math.max(s[1], x);
    } else c.forEach(walk);
  };
  walk(geom.coordinates);
  if (b[2] - b[0] > 180 && s[1] - s[0] < b[2] - b[0]) return [[s[0], b[1]], [s[1], b[3]]];
  return [[b[0], b[1]], [b[2], b[3]]];
}
// screen box for a boundary feature: the precomputed main-landmass box when there is one
const frame = (f) => f.properties.fb ? [[f.properties.fb[0], f.properties.fb[1]], [f.properties.fb[2], f.properties.fb[3]]] : bbox(f.geometry);
const fc = (features) => ({ type: "FeatureCollection", features });
const pt = (lon, lat, properties) => ({ type: "Feature", geometry: { type: "Point", coordinates: [lon, lat] }, properties });

createApp({
  data() {
    return {
      ready: false, busy: PUBLIC ? "loading map…" : "loading outlets…", generated: "", countries: [], ccName: {},
      cc: "", q: "", sOpen: false, sActive: 0, sugg: [],
      sideOpen: false, legendOpen: true,
      show: { outlets: !PUBLIC, places: PUBLIC, borders: true, areaCounts: !PUBLIC },
      types: [], scopes: [], typeOpts: [], scopeOpts: [], stats: { match: 0, pinned: 0 },
      mode: "list", tab: PUBLIC ? "places" : "outlets", bq: "", cur: null, here: null, listLimit: 200, ver: 0, history: [],
      // places
      levels: ["city"], pq: "", pout: "all", minPop: 0, seatsOnly: false,
      admin1: [], a1q: "", a1limit: 40, colorBy: "level", plimit: 200, pver: 0,
      villagesLoaded: false, levelCount: {}, a1Counts: [],
      outletOpts: [{ v: "all", label: "All" }, { v: "no", label: "None yet" }, { v: "yes", label: "Has outlets" }],
      popOpts: [0, 1000, 5000, 10000, 50000, 100000, 1000000].map((v) =>
        ({ v, label: v ? "≥ " + v.toLocaleString() : "Any (incl. unknown)" })),
      SCOPE, SCOPE_LABEL, TYPE_LABEL, PRO_FILTERS, PRO_FIELDS, LV, LABEL, COVER, T, PUBLIC,
    };
  },
  computed: {
    country() { return this.countries.find((c) => c.cc === this.cc); },
    inView() { this.ver; return IV; },
    browse() {
      const q = this.bq.trim().toLowerCase();
      return this.countries.map((c) => ({ cc: c.cc, name: c.name, o: A0.get(c.cc)?.properties.o || 0 }))
        .filter((c) => (PUBLIC || c.o || q) && (!q || c.name.toLowerCase().includes(q)))
        .sort((a, b) => b.o - a.o || a.name.localeCompare(b.name));
    },
    kidsShown() {
      const k = this.here?.kids;
      if (!k) return [];
      const q = k.q.trim().toLowerCase();
      let rows = q ? k.rows.filter((r) => r[6].toLowerCase().includes(q) || (r[7] && r[7].toLowerCase().includes(q))) : k.rows.slice();
      if (k.sort === "outlets") rows.sort((a, b) => b[4] - a[4] || b[3] - a[3]);
      else if (k.sort === "name") rows.sort((a, b) => a[6].localeCompare(b[6]));
      return rows; // "pop": rows arrive biggest first
    },
    // places
    levelOpts() {
      return LV.map((v) => {
        const available = this.cc ? (this.country?.n[v] || 0) > 0 : WORLD_LEVELS.includes(v);
        return { v, label: LABEL[v], hint: HINT[v] || "", available };
      });
    },
    villageNote() {
      const n = this.country?.n.village || 0;
      return !n || this.villagesLoaded ? "" : `Villages (${n.toLocaleString()}) load when you tick the level.`;
    },
    admin1Filtered() {
      const q = this.a1q.trim().toLowerCase();
      return q ? this.a1Counts.filter((o) => o.v.toLowerCase().includes(q)) : this.a1Counts;
    },
    admin1Visible() { return this.admin1Filtered.slice(0, this.a1limit); },
    pmatches() { this.pver; return PMATCH; },
    pshown() { this.pver; return PMATCH.slice(0, this.plimit); },
    outletKey() { return JSON.stringify([this.cc, this.types, this.scopes, this.show.areaCounts]); },
    placeKey() { return JSON.stringify([this.levels, this.pout, this.minPop, this.seatsOnly, this.admin1, this.pq]); },
  },
  watch: {
    outletKey() { clearTimeout(OTIMER); OTIMER = setTimeout(() => this.renderOutlets(), 60); },
    placeKey() { clearTimeout(PTIMER); PTIMER = setTimeout(() => this.recomputePlaces(), 120); },
    colorBy() { this.paintPlaces(); },
    q() { clearTimeout(STIMER); STIMER = setTimeout(() => this.suggest(), 90); },
    "show.outlets"(v) { this.vis(["clusters", "cluster-count", "points", "national", "areacounts", "areacount-label", "sel"], v); },
    "show.areaCounts"(v) { this.vis(["areacounts", "areacount-label"], v && this.show.outlets); },
    "show.borders"(v) { this.vis(["adm0-line", "adm1-line", "adm2-line"], v); },
    "show.places"(v) {
      this.vis(["places", "villages", "place-labels", "hits"], v);
      if (!v && this.tab === "places") this.tab = PUBLIC ? "browse" : "outlets";
      if (v) { this.tab = "places"; this.recomputePlaces(); }
    },
    cc(v) {
      history.replaceState(null, "", v ? "#" + v : location.pathname);
      this.admin1 = []; this.a1q = ""; this.a1limit = 40;
      this.levels = v ? ["adm2", "city", "town"].filter((l) => (this.country?.n[l] || 0) > 0) : ["city"];
      this.loadPlaces();
      this.loadCounties(v);
      if (DRILL) { DRILL = false; return; } // drill-down picked the country: keep its panel and view
      this.fitCountry();
      this.mode = "list";
      this.setFocus(null);
      this.setKids([]);
    },
  },
  async mounted() {
    const get = (u) => fetch(u, { cache: "no-cache" }).then((r) => r.json());
    const [index, outlets, adm0, adm1] = await Promise.all([
      get("data/regions/index.json"),
      PUBLIC ? { types: [], cc: [], a1: [], place: [], a2: [], rows: [], generated: "" } : get("data/map/outlets.json"), get("data/map/adm0.json"), get("data/map/adm1.json")]);
    C2INDEX = await get("data/map/adm2/index.json").catch(() => ({}));
    // countries: GeoNames names; the select lists only countries that have outlets or places
    this.countries = index.countries;
    const ccName = {};
    for (const f of adm0.features) { A0.set(f.properties.cc, f); ccName[f.properties.cc] = f.properties.n; }
    for (const c of index.countries) ccName[c.cc] = c.name;
    this.ccName = ccName;
    for (const f of adm1.features) {
      A1.set(f.properties.k, f);
      A1BYNAME.set(f.properties.cc + "|" + f.properties.n, f.properties.k);
    }
    // outlets
    T.push(...outlets.types);
    const { cc, a1, place, a2 } = outlets;
    O = outlets.rows;
    for (let i = 0; i < O.length; i++) {
      const r = O[i];
      r[11] = a2[r[10]]; r[7] = cc[r[7]]; r[8] = a1[r[8]]; r[9] = place[r[9]]; r[10] = i;
      NAMEL.push(r[5].toLowerCase()); HOSTL.push(host(r[6]).toLowerCase());
      SK.push(NAMEL[i].replace(/^[^\p{L}\p{N}]+/u, ""));
    }
    this.generated = outlets.generated;
    const h = location.hash.slice(1).toUpperCase();
    this.initMap(async () => {
      this.ready = true; this.busy = "";
      this.renderOutlets();
      if (h && this.countries.some((c) => c.cc === h)) this.cc = h; else await this.loadPlaces();
    });
  },
  methods: {
    fmt(n) { return (n || 0).toLocaleString("en-US"); },
    toggle(key, v) { this[key] = this[key].includes(v) ? this[key].filter((x) => x !== v) : [...this[key], v]; },
    vis(ids, on) { for (const id of ids) if (MAP?.getLayer(id)) MAP.setLayoutProperty(id, "visibility", on ? "visible" : "none"); },
    closeSoon() { setTimeout(() => { this.sOpen = false; }, 150); },
    stateName(k) { return A1.get(k)?.properties.n || ""; },
    rowWhere(r) {
      const parts = [r[9], this.stateName(r[8]), this.cc ? "" : this.ccName[r[7]] || r[7]];
      return [...new Set(parts.filter(Boolean))].join(", ");
    },

    // ================= outlets =================
    pass(r, skip) {
      if (this.cc && r[7] !== this.cc) return false;
      if (skip !== "types" && this.types.length && !this.types.includes(T[r[3]])) return false;
      if (skip !== "scopes" && this.scopes.length && !this.scopes.includes(SCOPE[r[4]])) return false;
      return true;
    },
    renderOutlets() {
      if (!MAP?.getSource("outlets")) return;
      const pins = [], nat = [], agg = new Map(), tc = {}, sc = {};
      let match = 0, pinned = 0;
      const types = new Set(this.types), scopes = new Set(this.scopes), cc = this.cc;
      for (const r of O) {
        if (cc && r[7] !== cc) continue;
        const okT = !types.size || types.has(T[r[3]]), okS = !scopes.size || scopes.has(SCOPE[r[4]]);
        if (okS) tc[T[r[3]]] = (tc[T[r[3]]] || 0) + 1;     // facet counts ignore their own facet
        if (okT) sc[SCOPE[r[4]]] = (sc[SCOPE[r[4]]] || 0) + 1;
        if (!okT || !okS) continue;
        match++;
        if (r[2] <= PINNED) {
          pinned++;
          if (r[4] === 3) nat.push(pt(r[0], r[1], { i: r[10], n: r[5] }));
          else pins.push(pt(r[0], r[1], { i: r[10], s: r[4] }));
        } else if (r[2] <= 4 && this.show.areaCounts) {
          const key = r[2] === 3 && A1.has(r[8]) ? "R|" + r[8] : "C|" + r[7];
          const a = agg.get(key) || { n: 0, r };
          a.n++; agg.set(key, a);
        }
      }
      const areas = [];
      for (const [key, a] of agg) {
        const [lvl, k] = key.split("|");
        const f = lvl === "R" ? A1.get(k) : A0.get(k);
        const [x, y] = f ? [f.properties.lx, f.properties.ly] : [a.r[0], a.r[1]];
        areas.push(pt(x, y, { key: k, lvl, n: a.n, label: f?.properties.n || k }));
      }
      MAP.getSource("outlets").setData(fc(pins));
      MAP.getSource("national").setData(fc(nat));
      MAP.getSource("areas").setData(fc(areas));
      this.typeOpts = T.map((v) => ({ v, label: TYPE_LABEL[v] || v, n: tc[v] || 0 }))
        .filter((t) => t.n || this.types.includes(t.v)).sort((a, b) => b.n - a.n);
      this.scopeOpts = ["national", "regional", "local", ""].map((v) => ({ v, label: SCOPE_LABEL[v], n: sc[v] || 0 }));
      this.stats = { match, pinned };
      this.updateInView();
      if (this.mode === "here" && this.here) this.openHere(this.here.args, true);
    },
    updateInView() {
      if (!MAP) return;
      const b = MAP.getBounds(), w = b.getWest(), e = b.getEast(), s = b.getSouth(), n = b.getNorth();
      const wrap = e - w >= 360;
      const rows = [];
      for (const r of O) {
        if (r[2] > PINNED || r[1] < s || r[1] > n) continue;
        if (!wrap && !(r[0] >= w && r[0] <= e) && !(r[0] + 360 >= w && r[0] + 360 <= e)) continue;
        if (!this.pass(r)) continue;
        rows.push(r);
      }
      rows.sort((a, b) => b[4] - a[4] || SK[a[10]].localeCompare(SK[b[10]]));
      IV = { rows, total: rows.length };
      this.listLimit = 200;
      this.ver++;
    },
    selectOutlet(r, { fly = true } = {}) {
      if (this.mode !== "outlet" || this.cur?.ix !== r[10]) this.pushHistory();
      const scope = SCOPE[r[4]], st = this.stateName(r[8]), cn = this.ccName[r[7]] || r[7];
      const precNote = [
        "own coordinates", "pinned to its town", "pinned to its district",
        `location known only to ${st || "its state"}: no pin`, `location known only to ${cn || "its country"}: no pin`,
        "no location yet"][r[2]];
      let covers = "", foot = null, kind = "cover";
      if (r[4] === 3) { covers = cn; foot = A0.get(r[7]); }
      else if (r[4] === 2) { covers = st || cn; foot = A1.get(r[8]) || A0.get(r[7]); }
      else if (r[2] === 3) { foot = A1.get(r[8]); kind = "unknown"; }
      else if (r[2] === 4) { foot = A0.get(r[7]); kind = "unknown"; }
      this.cur = {
        ix: r[10], row: r, name: r[5], url: r[6], host: host(r[6]), type: T[r[3]], scope,
        where: [...new Set([r[9], st, cn].filter(Boolean))].join(", "), precNote, covers, cc: r[7],
      };
      this.mode = "outlet";
      this.setFocus(foot, kind, r[2] <= PINNED ? r : null);
      if (!fly) return;
      if (foot && (kind === "unknown" || r[4] >= 2)) MAP.fitBounds(frame(foot), { padding: 50, maxZoom: 8, duration: 700 });
      else if (r[2] <= PINNED) MAP.flyTo({ center: [r[0], r[1]], zoom: Math.max(MAP.getZoom(), 9) });
    },
    hereForOutlet() {
      const r = this.cur.row;
      this.openHere({ lng: r[2] <= PINNED ? r[0] : null, lat: r[1], cc: r[7], a1: A1.has(r[8]) ? r[8] : "", a2: r[11] || "" });
    },

    // One panel for every level of the drill-down, World › country › state › county › town:
    // breadcrumb, what's inside this area, then who covers it (outlets in it, statewide,
    // national, and the "somewhere in…" outlets whose town isn't known).
    // args: { lng, lat (a spot, or null for an area), cc, a1 (state key), a2 (county name), place (place row) }
    openHere(args, refresh = false) {
      const { lng, lat, cc, a1 = "", a2 = "", place = null } = args;
      if (!refresh && (this.mode !== "here" || JSON.stringify(this.here?.args) !== JSON.stringify(args))) this.pushHistory();
      const plv = place ? place[2] : -1;
      const isSettle = SETTLEMENT.has(plv);
      const st = this.stateName(a1) || (plv === 0 ? place[6] : place ? place[9] : "") || "";
      const cn = this.ccName[cc] || cc || "";
      const z = MAP.getZoom(), radius = isSettle ? 15 : z < 5 ? 60 : z < 8 ? 30 : 12;
      const cos = Math.cos(((lat || 0) * Math.PI) / 180);
      const inPlace = [], inCounty = [], local = [], state = [], stateOnly = [], nat = [], ccOnly = [];
      const sameArea = (r) => (a1 ? r[8] === a1 : r[7] === cc);
      for (const r of O) {
        if (!this.pass(r)) continue;
        if (isSettle && r[9] === place[6] && sameArea(r)) inPlace.push(r);
        else if (lng != null && r[2] <= PINNED) {
          const dx = (r[0] - lng) * cos, dy = r[1] - lat;
          if (Math.abs(dy) * 111 < radius && Math.sqrt(dx * dx + dy * dy) * 111 <= radius) local.push(r);
        }
        if (a2 && r[11] === a2 && sameArea(r)) inCounty.push(r);
        if (a1 && r[8] === a1) {
          if (r[4] === 2) state.push(r);
          else if (r[2] === 3 && r[4] < 2) stateOnly.push(r);
        }
        if (cc && r[7] === cc) {
          if (r[4] === 3) nat.push(r);
          else if (r[2] === 4) ccOnly.push(r);
        }
      }
      const d = (r) => { const dx = (r[0] - lng) * cos, dy = r[1] - lat; return dx * dx + dy * dy; };
      local.sort((a, b) => d(a) - d(b));
      const byName = (a, b) => SK[a[10]].localeCompare(SK[b[10]]);
      for (const l of [inPlace, inCounty, state, stateOnly, nat, ccOnly]) l.sort((a, b) => (a[2] <= PINNED ? 0 : 1) - (b[2] <= PINNED ? 0 : 1) || byName(a, b));
      const sec = (key, title, mk, rows, note, open = true, dist = false) => ({ key, title, mk, rows, note, open, dist, limit: 50 });
      const sections = [];
      if (isSettle) sections.push(sec("inPlace", `In ${place[6]}`, "mk-local", inPlace, "Outlets geocoded to this town."));
      if (lng != null) sections.push(sec("local", isSettle ? "Nearby" : "Local, nearest first", "mk-local", local,
        `Pinned within ${radius} km${isSettle ? ", outside the town itself" : " of this spot"}.`, !isSettle || inPlace.length < 5, true));
      if (a2) sections.push(sec("county", `In ${a2}`, "mk-local", inCounty, "Outlets whose town lies in this county / district.", !isSettle));
      if (a1) {
        sections.push(sec("state", `Statewide · ${st}`, "mk-regional", state, `Tagged regional and based in ${st}: taken to cover the state.`));
        sections.push(sec("stateOnly", `Somewhere in ${st}`, "mk-area-r", stateOnly, `Registry knows the state but not the town yet. No pin until we do.`, !a2 && stateOnly.length <= 30));
      }
      if (cc) {
        sections.push(sec("nat", `National · ${cn}`, "mk-national", nat, `Tagged national: they cover this spot wherever their newsroom is.`, !a2 && !isSettle));
        sections.push(sec("ccOnly", `Somewhere in ${cn}`, "mk-area-c", ccOnly, `Registry knows the country but not the town yet.`, false));
      }
      let placeInfo = null;
      if (place) {
        const term = place[7] || place[6];
        placeInfo = {
          gid: place[11], pop: place[3], outlets: place[4], levelLabel: LABEL[LV[place[2]]], seat: SEAT_LABEL[place[5]] || "",
          g: (extra) => "https://www.google.com/search?q=" + encodeURIComponent(`"${term}" ${place[9] || ""} ${extra}`.trim()),
        };
      }
      // breadcrumb
      const crumbs = [{ label: "World", go: { world: true } }];
      if (cc) crumbs.push({ label: cn, go: { cc } });
      if (st) crumbs.push({ label: st, go: { cc, a1, a1n: st } });
      if (a2) crumbs.push({ label: a2, go: { cc, a1, a1n: st, a2 } });
      if (place && plv > 1) crumbs.push({ label: place[6] });
      else if (lng != null && !place) crumbs.push({ label: "This spot" });
      const kids = this.childrenOf(cc, st, a2, place);
      const prevKids = refresh && this.here?.kids;
      const title = place ? place[6] + (this.localName(place) ? ` · ${place[7]}` : "") : (lng != null ? "This spot" : a2 || st || cn);
      this.here = { args, title, place: placeInfo, sections, lng, lat, crumbs,
        kids: kids && { ...kids, q: prevKids?.q || "", sort: prevKids?.sort || "pop", limit: 100, open: true } };
      this.mode = "here";
      this.setKids(kids ? kids.rows.slice(0, 1500) : []);
      if (!refresh) {
        const f = (a2 && C2.get(st + "|" + a2)) || (a1 && A1.get(a1)) || (cc && A0.get(cc));
        this.setFocus(f || null, "here", lng != null ? [lng, lat] : null);
      }
    },
    // what's one level down: country -> states, state -> counties, county -> towns
    childrenOf(cc, st, a2, place) {
      if (!cc || (place && place[2] >= 2)) return null; // municipalities and towns: the bottom
      const all = VROWS.length ? [ROWS, VROWS] : [ROWS];
      const pick = (f) => { const out = []; for (const rows of all) for (const r of rows) if (r[8] === cc && f(r)) out.push(r); return out.sort((a, b) => b[3] - a[3]); };
      const cn = this.ccName[cc] || cc;
      if (a2) {
        let rows = pick((r) => r[9] === st && r[10] === a2 && SETTLEMENT.has(r[2]) && r[2] !== 9);
        let what = "Towns & villages";
        if (!rows.length) { rows = pick((r) => r[9] === st && r[10] === a2 && r[2] >= 2 && r[2] <= 5); what = "Municipalities"; }
        const note = !this.cc ? "Pick the country (breadcrumb) for villages and smaller towns."
          : !this.villagesLoaded && this.country?.n.village
            ? (this.country.n.village > 300000 ? "Villages: tick the Village level under Places to add them (large file)." : "Loading villages…") : "";
        return { title: `${what} in ${a2}`, rows, note };
      }
      if (st) {
        let rows = pick((r) => r[9] === st && r[2] === 1), what = "Counties / districts";
        if (!rows.length) { rows = pick((r) => r[9] === st && (r[2] === 6 || r[2] === 7)); what = "Cities & towns"; }
        return { title: `${what} in ${st}`, rows, note: "" };
      }
      return { title: `States / provinces of ${cn}`, rows: pick((r) => r[2] === 0), note: "" };
    },
    kidSub(r) {
      const parts = [LABEL[LV[r[2]]].split(" (")[0], r[3] ? "pop " + this.fmt(r[3]) : ""];
      return parts.filter(Boolean).join(" · ");
    },
    // open any place row at its own level of the drill-down
    openPlace(r, { fly = true } = {}) {
      const cc = r[8], lv = r[2];
      this.ensureCountry(cc);
      if (lv === 0) return this.goArea({ cc, a1: A1BYNAME.get(cc + "|" + r[6]) || "", a1n: r[6] }, fly, r);
      const a1 = A1BYNAME.get(cc + "|" + r[9]) || "";
      if (lv === 1) return this.goArea({ cc, a1, a1n: r[9], a2: r[6] }, fly, r);
      const settle = SETTLEMENT.has(lv);
      this.openHere({ lng: settle ? r[0] : null, lat: settle ? r[1] : null, cc, a1, a2: r[10] || "", place: r });
      if (fly) MAP.flyTo({ center: [r[0], r[1]], zoom: Math.max(MAP.getZoom(), lv === 6 ? 10 : 11) });
    },
    // an area of the drill-down: country, state, or county (by name)
    goArea(go, fly = true, row = null) {
      if (go.world) { this.history = []; this.cc = ""; return; }
      this.ensureCountry(go.cc);
      const { cc, a1 = "", a2 = "" } = go;
      let place = row;
      if (!place && a2) place = ROWS.find((r) => r[2] === 1 && r[8] === cc && r[6] === a2 && r[9] === go.a1n) || null;
      else if (!place && go.a1n) place = ROWS.find((r) => r[2] === 0 && r[8] === cc && r[6] === go.a1n) || null;
      this.openHere({ lng: null, lat: null, cc, a1, a2, place });
      if (a2) this.autoVillages();
      if (!fly) return;
      if (a2) { this.fitCounty(go.a1n || this.stateName(a1), a2, place); return; }
      const f = (a1 && A1.get(a1)) || A0.get(cc);
      if (f) MAP.fitBounds(frame(f), { padding: 40, duration: 700 });
      else if (place) MAP.flyTo({ center: [place[0], place[1]], zoom: 6 });
    },
    goCrumb(c) { this.goArea(c.go); },
    // a county's towns-and-villages list is thin without villages: load them when the country's
    // file is small enough (TR 50k, DE 77k fine; CN 898k, IN 547k stay on request)
    autoVillages() {
      const n = this.country?.n.village || 0;
      if (this.cc && n && n <= 300000 && !this.villagesLoaded) this.loadVillages();
    },
    // counties have no polygon: frame the towns inside them (or the county's own point)
    fitKids(place) {
      const pts = KIDS.length ? KIDS : place ? [place] : [];
      if (!pts.length) return;
      if (pts.length === 1) { MAP.flyTo({ center: [pts[0][0], pts[0][1]], zoom: 10 }); return; }
      const xs = pts.map((r) => r[0]).sort((a, b) => a - b), ys = pts.map((r) => r[1]).sort((a, b) => a - b);
      const q = (a, p) => a[Math.min(a.length - 1, Math.floor(p * a.length))];
      MAP.fitBounds([[q(xs, 0.03), q(ys, 0.03)], [q(xs, 0.97), q(ys, 0.97)]], { padding: 60, maxZoom: 11, duration: 700 });
    },
    // drilling below the world view selects the country: its own place file has the lower levels
    ensureCountry(cc) {
      if (!cc || cc === this.cc || !this.countries.some((c) => c.cc === cc)) return;
      DRILL = true;
      this.cc = cc;
    },
    setKids(rows) {
      KIDS = rows;
      if (!MAP?.getSource("kids")) return;
      MAP.getSource("kids").setData(fc(rows.map((r, i) => pt(r[0], r[1], { i, n: r[6], o: r[4], w: Math.min(1, Math.sqrt(r[3]) / 1500) }))));
    },
    distLabel(r) {
      const h = this.here; if (!h || h.lng == null) return "";
      const cos = Math.cos((h.lat * Math.PI) / 180), dx = (r[0] - h.lng) * cos, dy = r[1] - h.lat;
      const km = Math.sqrt(dx * dx + dy * dy) * 111;
      return km < 1 ? "here" : `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
    },
    // which state/country is under a screen point (fill layers are invisible but queryable)
    areaAt(point) {
      const fs = MAP.queryRenderedFeatures(point, { layers: ["adm2-fill", "adm1-fill", "adm0-fill"] });
      const s = fs.find((f) => f.layer.id === "adm1-fill"), c = fs.find((f) => f.layer.id === "adm0-fill");
      const k = fs.find((f) => f.layer.id === "adm2-fill");
      const st = s ? s.properties.n : "";
      return { a1: s?.properties.k || "", cc: s?.properties.cc || c?.properties.cc || "",
               a2: k && (!st || k.properties.s === st) ? k.properties.n : "" };
    },
    pushHistory() {
      if (RESTORING) return;
      if (this.mode === "outlet" && this.cur) this.history.push({ mode: "outlet", row: this.cur.row });
      else if (this.mode === "here" && this.here) this.history.push({ mode: "here", args: this.here.args });
      if (this.history.length > 30) this.history.shift();
    },
    back() {
      const h = this.history.pop();
      if (!h) { this.mode = "list"; this.setFocus(null); this.setKids([]); return; }
      RESTORING = true;
      try {
        if (h.mode === "outlet") this.selectOutlet(h.row, { fly: false });
        else this.openHere(h.args);
      } finally { RESTORING = false; }
    },
    setFocus(feature, kind = "cover", point = null) {
      if (!MAP?.getSource("focus")) return;
      MAP.getSource("focus").setData(fc(feature ? [{ type: "Feature", geometry: feature.geometry, properties: { kind } }] : []));
      // point: an outlet row or [lng, lat]; both start with lon, lat
      MAP.getSource("sel").setData(fc(point ? [pt(point[0], point[1], {})] : []));
    },

    // ================= search =================
    suggest() {
      const q = this.q.trim().toLowerCase();
      this.sActive = 0;
      if (q.length < 2) { this.sugg = []; return; }
      const gO = [], gA = [], gP = [];
      // outlets by name or website
      const cand = [];
      for (let i = 0; i < O.length; i++) {
        const n = NAMEL[i], h = HOSTL[i];
        let s = -1;
        if (n === q || h === q) s = 0;
        else if (n.startsWith(q)) s = 1;
        else if (h.startsWith(q)) s = 1.5;
        else if (n.includes(" " + q)) s = 2;
        else if (n.includes(q)) s = 3;
        else if (h.includes(q)) s = 4;
        if (s >= 0 && (!this.cc || O[i][7] === this.cc)) cand.push([s, i]);
      }
      cand.sort((a, b) => a[0] - b[0] || O[b[1]][4] - O[a[1]][4] || NAMEL[a[1]].length - NAMEL[b[1]].length);
      if (cand.length) gO.push({ head: `Outlets · ${cand.length.toLocaleString()}` });
      for (const [, i] of cand.slice(0, 7)) {
        const r = O[i];
        gO.push({ kind: "outlet", ref: r, label: r[5], sub: host(r[6]) || this.rowWhere(r), cls: "mk mk-" + (SCOPE[r[4]] || "none") });
      }
      // states and countries
      const areas = [];
      for (const [cc, f] of A0) if ((this.ccName[cc] || f.properties.n).toLowerCase().includes(q)) areas.push({ kind: "country", cc, label: this.ccName[cc] || f.properties.n, sub: "Country" });
      for (const [k, f] of A1) {
        if ((!this.cc || f.properties.cc === this.cc) && f.properties.n.toLowerCase().includes(q))
          areas.push({ kind: "state", k, cc: f.properties.cc, label: f.properties.n, sub: "State / province · " + (this.ccName[f.properties.cc] || f.properties.cc) });
      }
      areas.sort((a, b) => (a.label.toLowerCase().startsWith(q) ? 0 : 1) - (b.label.toLowerCase().startsWith(q) ? 0 : 1));
      if (areas.length) gA.push({ head: "States & countries" });
      for (const a of areas.slice(0, 4)) gA.push({ ...a, cls: "mk " + (a.kind === "state" ? "mk-area-r" : "mk-area-c") });
      // places (current scope: world overview, or the selected country incl. villages if loaded)
      const places = [];
      for (const rows of [ROWS, VROWS]) {
        for (const r of rows) {
          if (r[2] === 0) continue; // states come from the boundaries above
          if (r[6].toLowerCase().includes(q) || (r[7] && r[7].toLowerCase().includes(q))) places.push(r);
          if (places.length >= 300) break;
        }
      }
      places.sort((a, b) => (a[6].toLowerCase().startsWith(q) ? 0 : 1) - (b[6].toLowerCase().startsWith(q) ? 0 : 1) || b[3] - a[3]);
      if (places.length) gP.push({ head: "Places" });
      for (const r of places.slice(0, 6)) {
        gP.push({ kind: "place", ref: r, label: r[6] + (this.localName(r) ? " · " + r[7] : ""), sub: [LABEL[LV[r[2]]].split(" (")[0], r[9], this.cc ? "" : r[8]].filter(Boolean).join(" · "),
                   style: this.swatch(LV[r[2]]), cls: "sw" });
      }
      // "ohio", "texas", "turkey": the area is what you mean; otherwise outlets lead
      const areaFirst = areas.length && areas[0].label.toLowerCase().startsWith(q);
      const out = areaFirst ? [...gA, ...gO, ...gP] : [...gO, ...gA, ...gP];
      this.sugg = out;
      this.sActive = out.findIndex((s) => !s.head);
    },
    moveSugg(d) {
      if (!this.sugg.length) return;
      let k = this.sActive;
      do { k = (k + d + this.sugg.length) % this.sugg.length; } while (this.sugg[k].head);
      this.sActive = k;
    },
    pickSugg(k = this.sActive) {
      const s = this.sugg[k];
      if (!s || s.head) return;
      this.sOpen = false;
      if (s.kind === "outlet") this.selectOutlet(s.ref);
      else if (s.kind === "country") this.goArea({ cc: s.cc });
      else if (s.kind === "state") this.goArea({ cc: s.cc, a1: s.k, a1n: A1.get(s.k).properties.n });
      else if (s.kind === "place") this.openPlace(s.ref);
      document.activeElement?.blur();
    },

    // ================= places (GeoNames, from the regions build) =================
    swatch(l) {
      const c = COLOR[l];
      return LV.indexOf(l) <= AREA_MAX ? { border: `2px solid ${c}`, background: "transparent" } : { background: c };
    },
    // native/local name, only when it says something the primary name doesn't (横浜市 vs Yokohama)
    localName(r) {
      if (!r[7]) return "";
      const norm = (s) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase(); // İstanbul ~ Istanbul
      return norm(r[6]).includes(norm(r[7])) ? "" : r[7];
    },
    placeParents(r) { return [r[10], r[9], this.cc ? "" : r[8]].filter(Boolean).join(", "); },
    toggleLevel(l) {
      this.toggle("levels", l);
      if (l === "village" && this.levels.includes("village") && !this.villagesLoaded) this.loadVillages();
    },
    loadPlaces() {
      PLOAD = this.loadPlacesNow().finally(() => { PLOAD = null; });
      return PLOAD;
    },
    async loadPlacesNow() {
      const url = this.cc ? `data/regions/c/${this.cc}.json` : "data/regions/world.json";
      const cc = this.cc;
      const rows = decodePlaces(await (await fetch(url, { cache: "no-cache" })).json());
      if (cc !== this.cc) return;
      ROWS = rows; VROWS = []; this.villagesLoaded = false;
      A1IX = new Map();
      for (const r of ROWS) if (!A1IX.has(r[9])) A1IX.set(r[9], A1IX.size);
      this.setPlaceSource("places", ROWS, true);
      this.setPlaceSource("villages", [], false);
      if (this.levels.includes("village")) await this.loadVillagesNow(true); else this.recomputePlaces();
      if (this.mode === "here" && this.here) this.refreshDrill();
    },
    refreshDrill() {
      const a = this.here.args;
      this.openHere(a, true);
      if (a.a2 && a.lng == null) this.fitCounty(this.stateName(a.a1) || a.place?.[9], a.a2, a.place);
    },
    // a county: its border when we have one, else the towns inside it
    fitCounty(st, a2, place) {
      const f = C2.get(st + "|" + a2);
      if (f) MAP.fitBounds(frame(f), { padding: 40, maxZoom: 11, duration: 700 });
      else this.fitKids(place);
    },
    async loadCounties(cc) {
      C2 = new Map(); C2CC = cc;
      MAP?.getSource("adm2")?.setData(fc([]));
      if (!cc || !C2INDEX[cc]) return;
      const data = await (await fetch(`data/map/adm2/${cc}.json`, { cache: "no-cache" })).json();
      if (cc !== C2CC) return;
      for (const f of data.features) C2.set(f.properties.s + "|" + f.properties.n, f);
      MAP.getSource("adm2").setData(data);
      // a county opened before its border arrived: outline and frame it now
      const h = this.mode === "here" && this.here?.args;
      if (h && h.a2) {
        const st = this.stateName(h.a1) || h.place?.[9];
        const f = C2.get(st + "|" + h.a2);
        if (f) {
          this.setFocus(f, "here", h.lng != null ? [h.lng, h.lat] : null);
          if (h.lng == null) MAP.fitBounds(frame(f), { padding: 40, maxZoom: 11, duration: 700 });
        }
      }
    },
    loadVillages() {
      if (!VLOAD) VLOAD = this.loadVillagesNow().finally(() => { VLOAD = null; });
      return VLOAD;
    },
    async loadVillagesNow(fromPlaces = false) {
      if (PLOAD && !fromPlaces) await PLOAD; // the country's own file first: it resets the village list
      if (!this.cc || !this.country?.n.village || this.villagesLoaded) return;
      this.busy = `loading ${this.country.n.village.toLocaleString()} villages…`;
      const cc = this.cc;
      const rows = decodePlaces(await (await fetch(`data/regions/c/${cc}_v.json`, { cache: "no-cache" })).json());
      if (cc !== this.cc) { this.busy = ""; return; }
      for (const r of rows) if (!A1IX.has(r[9])) A1IX.set(r[9], A1IX.size);
      VROWS = rows; this.villagesLoaded = true;
      this.setPlaceSource("villages", VROWS, false);
      // the map tiles the points in a worker: China's 900k take ~10 s to appear, keep saying so
      this.busy = `drawing ${rows.length.toLocaleString()} villages…`;
      const done = () => {
        if (cc !== this.cc || MAP.isSourceLoaded("villages")) { this.busy = ""; MAP.off("idle", done); MAP.off("sourcedata", done); }
      };
      MAP.on("idle", done); MAP.on("sourcedata", done);
      this.recomputePlaces();
      if (this.mode === "here" && this.here) this.openHere(this.here.args, true);
    },
    recomputePlaces() {
      const lv = new Set(this.levels.map((l) => LV.indexOf(l)));
      const a1 = new Set(this.admin1), useA1 = a1.size > 0;
      const minPop = this.minPop, seats = this.seatsOnly, out = this.pout, q = this.pq.trim().toLowerCase();
      const lc = {}, ac = new Map();
      const pick = (rows) => {
        const res = [];
        for (const r of rows) {
          if (minPop && r[3] < minPop) continue;
          if (seats && !r[5]) continue;
          if (out === "yes" ? !r[4] : out === "no" ? r[4] : false) continue;
          if (q && !(r[6].toLowerCase().includes(q) || (r[7] && r[7].toLowerCase().includes(q)))) continue;
          const inLv = lv.has(r[2]), inA1 = !useA1 || a1.has(r[9]);
          if (inA1) lc[LV[r[2]]] = (lc[LV[r[2]]] || 0) + 1;
          if (inLv) ac.set(r[9], (ac.get(r[9]) || 0) + 1);
          if (inLv && inA1) res.push(r);
        }
        return res;
      };
      const a = pick(ROWS), b = pick(VROWS);
      const m = new Array(a.length + b.length); // both sorted by population desc: merge
      let i = 0, j = 0, k = 0;
      while (i < a.length && j < b.length) m[k++] = a[i][3] >= b[j][3] ? a[i++] : b[j++];
      while (i < a.length) m[k++] = a[i++];
      while (j < b.length) m[k++] = b[j++];
      PMATCH = m;
      this.levelCount = lc;
      if (this.cc) {
        const opts = [...ac].map(([v, n]) => ({ v, n }));
        for (const v of this.admin1) if (!ac.has(v)) opts.push({ v, n: 0 });
        this.a1Counts = opts.sort((x, y) => y.n - x.n || x.v.localeCompare(y.v));
      } else this.a1Counts = [];
      this.plimit = 200;
      this.pver++;
      this.applyPlaceFilter(q ? m.slice(0, 3000) : []);
    },
    setPlaceSource(name, rows, withName) {
      const features = new Array(rows.length);
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const p = { i, l: r[2], p: r[3], o: r[4], s: r[5], a: A1IX.get(r[9]), w: weight(r), v: name === "villages" ? 1 : 0 };
        if (withName) p.n = r[6];
        features[i] = pt(r[0], r[1], p);
      }
      MAP.getSource(name).setData(fc(features));
    },
    applyPlaceFilter(hits) {
      if (!MAP?.getLayer("places")) return;
      const f = ["all", ["in", ["get", "l"], ["literal", this.levels.map((l) => LV.indexOf(l))]]];
      if (this.minPop) f.push([">=", ["get", "p"], this.minPop]);
      if (this.seatsOnly) f.push([">", ["get", "s"], 0]);
      if (this.pout === "yes") f.push([">", ["get", "o"], 0]);
      if (this.pout === "no") f.push(["==", ["get", "o"], 0]);
      if (this.admin1.length) f.push(["in", ["get", "a"], ["literal", this.admin1.map((v) => A1IX.get(v))]]);
      for (const id of ["places", "place-labels", "villages"]) MAP.setFilter(id, f);
      MAP.getSource("hits").setData(fc(hits.map((r) => pt(r[0], r[1], { gid: r[11] }))));
    },
    paintPlaces() {
      if (!MAP?.getLayer("places")) return;
      const color = this.colorBy === "cover"
        ? ["case", [">", ["get", "o"], 0], COVER.yes, COVER.no]
        : ["match", ["get", "l"], ...LV.flatMap((l, i) => [i, COLOR[l]]), "#888"];
      MAP.setPaintProperty("places", "circle-color", color);
      MAP.setPaintProperty("places", "circle-stroke-color", ["case", ["<=", ["get", "l"], AREA_MAX], color, "#ffffff"]);
      MAP.setPaintProperty("villages", "circle-color", this.colorBy === "cover" ? color : COLOR.village);
      MAP.setPaintProperty("villages", "circle-opacity", this.colorBy === "cover" ? 0.8 : 0.6);
    },
    focusPlace(r) { this.openPlace(r); },
    exportPlaces() {
      const esc = (v) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
      const SEATS = ["", "capital", "seat-of-government", "adm1-seat", "adm2-seat", "adm3-seat", "adm4-seat", "adm5-seat"];
      const lines = [PUBLIC ? "geonameid,cc,level,seat,name,local_name,admin1,admin2,population,lat,lon"
                            : "geonameid,cc,level,seat,name,local_name,admin1,admin2,population,outlets,lat,lon"];
      for (const r of PMATCH) lines.push((PUBLIC ? [r[11], r[8], LV[r[2]], SEATS[r[5]] || "", r[6], r[7], r[9], r[10], r[3], r[1], r[0]]
        : [r[11], r[8], LV[r[2]], SEATS[r[5]] || "", r[6], r[7], r[9], r[10], r[3], r[4], r[1], r[0]]).map(esc).join(","));
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob(["﻿" + lines.join("\n")], { type: "text/csv" }));
      a.download = `places_${this.cc || "world"}_${PMATCH.length}.csv`;
      a.click();
    },
    fitCountry() {
      if (!this.cc) { MAP.flyTo({ center: [15, 25], zoom: 1.4 }); return; }
      const f = A0.get(this.cc);
      if (f) MAP.fitBounds(frame(f), { padding: 30, duration: 800 });
    },

    // ================= map =================
    initMap(ready) {
      const vm = this;
      MAP = new maplibregl.Map({ container: "map", style: "https://tiles.openfreemap.org/styles/positron",
        center: [15, 25], zoom: 1.4, attributionControl: { compact: true,
          customAttribution: "Places © GeoNames (CC BY 4.0) · Borders: Natural Earth, geoBoundaries (CC BY 4.0), ISTAT, Statistics Canada" } });
      MAP.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
      MAP.addControl(new maplibregl.ScaleControl(), "bottom-right");
      MAP.once("style.load", () => {
        const empty = fc([]);
        MAP.addSource("adm0", { type: "geojson", data: "data/map/adm0.json" });
        MAP.addSource("adm1", { type: "geojson", data: "data/map/adm1.json" });
        MAP.addSource("adm2", { type: "geojson", data: fc([]) });
        for (const s of ["focus", "sel", "areas", "national", "places", "villages", "hits", "kids"]) MAP.addSource(s, { type: "geojson", data: empty });
        MAP.addSource("outlets", { type: "geojson", data: empty, cluster: true, clusterRadius: 42, clusterMaxZoom: 11 });
        // square marker for national outlets
        const sz = 14, c = document.createElement("canvas"); c.width = c.height = sz * 2;
        const g = c.getContext("2d"); g.scale(2, 2);
        g.fillStyle = "#fff"; g.fillRect(0, 0, sz, sz); g.fillStyle = CSS("--o-national"); g.fillRect(2, 2, sz - 4, sz - 4);
        MAP.addImage("sq", g.getImageData(0, 0, sz * 2, sz * 2), { pixelRatio: 2 });

        const local = CSS("--o-local"), regional = CSS("--o-regional"), national = CSS("--o-national");
        // invisible fills: hit-testing "which state/country is this click in"
        MAP.addLayer({ id: "adm0-fill", type: "fill", source: "adm0", paint: { "fill-color": "#000", "fill-opacity": 0.001 } });
        MAP.addLayer({ id: "adm1-fill", type: "fill", source: "adm1", paint: { "fill-color": "#000", "fill-opacity": 0.001 } });
        MAP.addLayer({ id: "adm2-fill", type: "fill", source: "adm2", paint: { "fill-color": "#000", "fill-opacity": 0.001 } });
        MAP.addLayer({ id: "focus-fill", type: "fill", source: "focus", paint: {
          "fill-color": ["match", ["get", "kind"], "cover", "#b05c2a", "unknown", "#8b5cc4", "#b05c2a"],
          "fill-opacity": ["match", ["get", "kind"], "cover", 0.16, "unknown", 0.1, 0.04] } });
        MAP.addLayer({ id: "adm2-line", type: "line", source: "adm2", minzoom: 4.5, paint: {
          "line-color": "#c2bab0", "line-width": ["interpolate", ["linear"], ["zoom"], 5, 0.25, 10, 0.9], "line-dasharray": [1, 1.5] } });
        MAP.addLayer({ id: "adm1-line", type: "line", source: "adm1", minzoom: 2.5, paint: {
          "line-color": "#a49c90", "line-width": ["interpolate", ["linear"], ["zoom"], 3, 0.3, 8, 1], "line-dasharray": [3, 2] } });
        MAP.addLayer({ id: "adm0-line", type: "line", source: "adm0", paint: {
          "line-color": "#7d766c", "line-width": ["interpolate", ["linear"], ["zoom"], 1, 0.4, 6, 1.3] } });
        MAP.addLayer({ id: "focus-line", type: "line", source: "focus", filter: ["!=", ["get", "kind"], "unknown"],
          paint: { "line-color": "#b05c2a", "line-width": 2 } });
        MAP.addLayer({ id: "focus-line-dash", type: "line", source: "focus", filter: ["==", ["get", "kind"], "unknown"],
          paint: { "line-color": "#8b5cc4", "line-width": 2, "line-dasharray": [2, 2] } });
        // places
        MAP.addLayer({ id: "villages", type: "circle", source: "villages", layout: { visibility: "none" }, paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 1, 9, 2.5, 13, 5], "circle-stroke-width": 0 } });
        MAP.addLayer({ id: "places", type: "circle", source: "places", layout: { visibility: "none", "circle-sort-key": ["get", "w"] }, paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, ["+", 1, ["*", ["get", "w"], 5]], 10, ["+", 3, ["*", ["get", "w"], 14]]],
          "circle-opacity": ["case", ["<=", ["get", "l"], AREA_MAX], 0.06, 0.75],
          "circle-stroke-width": ["case", ["<=", ["get", "l"], AREA_MAX], 1.6, 0.6] } });
        MAP.addLayer({ id: "place-labels", type: "symbol", source: "places", minzoom: 4, layout: { visibility: "none",
          "text-field": ["get", "n"], "text-font": ["Noto Sans Regular"], "text-size": ["interpolate", ["linear"], ["get", "w"], 0, 10, 1, 13],
          "symbol-sort-key": ["-", 1, ["get", "w"]], "text-offset": [0, 0.9], "text-anchor": "top", "text-optional": true },
          paint: { "text-color": "#444", "text-halo-color": "#fff", "text-halo-width": 1.4 } });
        MAP.addLayer({ id: "hits", type: "circle", source: "hits", layout: { visibility: "none" }, paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, 4, 10, 9],
          "circle-color": "transparent", "circle-stroke-width": 2.2, "circle-stroke-color": "#111" } });
        // outlets known only to a state (R, from zoom 3) or a country (C)
        MAP.addLayer({ id: "areacounts", type: "circle", source: "areas",
          filter: ["any", ["==", ["get", "lvl"], "C"], [">=", ["zoom"], 3]], paint: {
          "circle-radius": ["interpolate", ["linear"], ["sqrt", ["get", "n"]], 1, 6, 30, 22, 120, 38],
          "circle-color": ["match", ["get", "lvl"], "R", "rgba(217,138,28,0.16)", "rgba(139,92,196,0.14)"],
          "circle-stroke-color": ["match", ["get", "lvl"], "R", CSS("--area-r"), CSS("--area-c")], "circle-stroke-width": 1.6 } });
        MAP.addLayer({ id: "areacount-label", type: "symbol", source: "areas",
          filter: ["any", ["==", ["get", "lvl"], "C"], [">=", ["zoom"], 3]], layout: {
          "text-field": ["to-string", ["get", "n"]], "text-font": ["Noto Sans Regular"], "text-size": 11, "text-allow-overlap": false },
          paint: { "text-color": "#4a3b62", "text-halo-color": "#fff", "text-halo-width": 1.2 } });
        // pinned outlets
        MAP.addLayer({ id: "clusters", type: "circle", source: "outlets", filter: ["has", "point_count"], paint: {
          "circle-color": local, "circle-opacity": 0.82, "circle-stroke-color": "#fff", "circle-stroke-width": 1.5,
          "circle-radius": ["step", ["get", "point_count"], 11, 50, 15, 500, 20, 5000, 26] } });
        MAP.addLayer({ id: "cluster-count", type: "symbol", source: "outlets", filter: ["has", "point_count"], layout: {
          "text-field": ["get", "point_count_abbreviated"], "text-font": ["Noto Sans Regular"], "text-size": 11 },
          paint: { "text-color": "#fff" } });
        MAP.addLayer({ id: "points", type: "circle", source: "outlets", filter: ["!", ["has", "point_count"]], paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"],
            4, ["case", ["==", ["get", "s"], 2], 5, 3.5], 12, ["case", ["==", ["get", "s"], 2], 6.5, 5.5]],
          "circle-color": ["case", ["==", ["get", "s"], 2], "#fff", ["==", ["get", "s"], 0], "#5f86c9", local],
          "circle-stroke-color": ["case", ["==", ["get", "s"], 2], regional, "#fff"],
          "circle-stroke-width": ["case", ["==", ["get", "s"], 2], 2.5, 1] } });
        // national outlets: never clustered, so each country's national titles show at world zoom
        MAP.addLayer({ id: "national", type: "symbol", source: "national", layout: {
          "icon-image": "sq", "icon-allow-overlap": true, "symbol-sort-key": 1,
          "text-field": ["step", ["zoom"], "", 4.5, ["get", "n"]], "text-font": ["Noto Sans Regular"], "text-size": 11,
          "text-offset": [0, 0.9], "text-anchor": "top", "text-optional": true },
          paint: { "text-color": national, "text-halo-color": "#fff", "text-halo-width": 1.4 } });
        // drill-down: the places one level down, clickable
        MAP.addLayer({ id: "kids", type: "circle", source: "kids", layout: { "circle-sort-key": ["get", "o"] }, paint: {
          "circle-radius": ["+", 4, ["*", ["get", "w"], 6]], "circle-color": "#fff",
          "circle-stroke-color": ["case", [">", ["get", "o"], 0], "#2e9e5b", "#b05c2a"], "circle-stroke-width": 2 } });
        MAP.addLayer({ id: "kid-labels", type: "symbol", source: "kids", layout: {
          "text-field": ["get", "n"], "text-font": ["Noto Sans Regular"], "text-size": ["+", 11, ["*", ["get", "w"], 3]],
          "text-offset": [0, 0.8], "text-anchor": "top", "text-optional": true, "symbol-sort-key": ["-", 0, ["get", "o"]] },
          paint: { "text-color": "#3b2a1c", "text-halo-color": "#fff", "text-halo-width": 1.6 } });
        MAP.addLayer({ id: "sel", type: "circle", source: "sel", paint: {
          "circle-radius": 11, "circle-color": "transparent", "circle-stroke-color": "#b05c2a", "circle-stroke-width": 2.5 } });

        const INTERACTIVE = ["kids", "national", "points", "clusters", "areacounts", "places", "villages", "hits"];
        MAP.on("click", async (e) => {
          const layers = INTERACTIVE.filter((id) => MAP.getLayer(id) && MAP.getLayoutProperty(id, "visibility") !== "none");
          const fs = MAP.queryRenderedFeatures([[e.point.x - 3, e.point.y - 3], [e.point.x + 3, e.point.y + 3]], { layers });
          fs.sort((a, b) => INTERACTIVE.indexOf(a.layer.id) - INTERACTIVE.indexOf(b.layer.id));
          const f = fs[0];
          vm.sideOpen = false;
          if (!f) {
            const { a1, cc, a2 } = vm.areaAt(e.point);
            if (cc) vm.openHere({ lng: e.lngLat.lng, lat: e.lngLat.lat, cc, a1, a2 });
            return;
          }
          const id = f.layer.id;
          if (id === "kids") { const r = KIDS[f.properties.i]; if (r) vm.openPlace(r); return; }
          if (id === "clusters") {
            const z = await MAP.getSource("outlets").getClusterExpansionZoom(f.properties.cluster_id);
            MAP.easeTo({ center: f.geometry.coordinates, zoom: z });
          } else if (id === "points" || id === "national") vm.selectOutlet(O[f.properties.i], { fly: false });
          else if (id === "areacounts") {
            const p = f.properties;
            vm.openHere(p.lvl === "R" ? { lng: null, lat: null, cc: p.key.split(".")[0], a1: p.key } : { lng: null, lat: null, cc: p.key, a1: "" });
          } else {
            const r = id === "hits" ? PMATCH.find((x) => x[11] === f.properties.gid) : (f.properties.v ? VROWS : ROWS)[f.properties.i];
            if (r) vm.openPlace(r, { fly: false });
          }
        });
        MAP.on("mousemove", (e) => {
          const layers = INTERACTIVE.filter((id) => MAP.getLayer(id) && MAP.getLayoutProperty(id, "visibility") !== "none");
          MAP.getCanvas().style.cursor = MAP.queryRenderedFeatures(e.point, { layers }).length ? "pointer" : "";
        });
        let mvTimer = null;
        MAP.on("moveend", () => { clearTimeout(mvTimer); mvTimer = setTimeout(() => vm.updateInView(), 150); });
        vm.paintPlaces();
        // layers are added hidden; the watchers only fire on change, so apply the starting state
        // (the public build opens with places on and outlets off)
        vm.vis(["places", "villages", "place-labels", "hits"], vm.show.places);
        vm.vis(["clusters", "cluster-count", "points", "national", "areacounts", "areacount-label", "sel"], vm.show.outlets);
        ready();
      });
    },
  },
}).mount("#app");
