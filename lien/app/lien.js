// Lien: a free network canvas. Built on Cytoscape.js; the graph lives in this browser only.
(() => {
  const $ = (id) => document.getElementById(id);
  const KEY = "lien.graph.v1";
  const TYPES = { person: "#5FD8B4", company: "#8C96FF", account: "#F5753F", place: "#C49BFF", other: "#8A8F99" };
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  let nextId = 1;
  const newId = () => {
    while (cy && cy.getElementById(`n${nextId}`).length) nextId++;
    return `n${nextId++}`;
  };

  const style = () => [
    {
      selector: "node",
      style: {
        "background-color": (n) => TYPES[n.data("type")] || TYPES.other,
        width: (n) => 22 + Math.min(n.degree(), 10) * 3,
        height: (n) => 22 + Math.min(n.degree(), 10) * 3,
        label: "data(label)",
        color: css("--ink"),
        "font-size": 13,
        "font-family": css("--font"),
        "text-valign": "bottom",
        "text-margin-y": 6,
        "text-wrap": "ellipsis",
        "text-max-width": 140,
        "border-width": 2,
        "border-color": css("--bg"),
      },
    },
    {
      selector: "edge",
      style: {
        width: 1.6,
        "curve-style": "bezier",
        "line-color": css("--ink-3"),
        "target-arrow-color": css("--ink-3"),
        "target-arrow-shape": "triangle",
        "arrow-scale": 0.9,
        label: "data(label)",
        "font-size": 10,
        "font-family": css("--font"),
        color: css("--ink-2"),
        "text-rotation": "autorotate",
        "text-background-color": css("--bg"),
        "text-background-opacity": 1,
        "text-background-padding": 2,
      },
    },
    { selector: ":selected", style: { "border-color": css("--accent"), "border-width": 4, "line-color": css("--accent"), "target-arrow-color": css("--accent") } },
    { selector: ".source", style: { "border-color": css("--accent"), "border-width": 4, "border-style": "dashed" } },
  ];

  const cy = cytoscape({ container: $("cy"), style: style(), wheelSensitivity: 0.3, minZoom: 0.1, maxZoom: 4 });

  // ── Saving and loading ──

  const toLien = () => ({
    format: "lien/1",
    nodes: cy.nodes().map((n) => ({ id: n.id(), label: n.data("label"), type: n.data("type"), x: Math.round(n.position("x")), y: Math.round(n.position("y")) })),
    edges: cy.edges().map((e) => ({ source: e.data("source"), target: e.data("target"), label: e.data("label") || "" })),
  });

  let saveTimer;
  const save = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { localStorage.setItem(KEY, JSON.stringify(toLien())); } catch { /* private mode: keep working unsaved */ }
    }, 300);
  };

  function load(graph, { replace = false } = {}) {
    if (replace) cy.elements().remove();
    const ids = new Map();
    const nodes = graph.nodes || [];
    const placed = nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y));
    cy.batch(() => {
      for (const n of nodes) {
        const id = cy.getElementById(n.id).length || !n.id ? newId() : String(n.id);
        ids.set(String(n.id ?? id), id);
        // Unplaced nodes start scattered, so the force layout has room to work.
        const position = placed ? { x: n.x, y: n.y } : { x: Math.random() * 400, y: Math.random() * 400 };
        cy.add({ group: "nodes", data: { id, label: n.label ?? String(n.id), type: TYPES[n.type] ? n.type : "other" }, position });
      }
      for (const e of graph.edges || []) {
        const s = ids.get(String(e.source)) || String(e.source), t = ids.get(String(e.target)) || String(e.target);
        if (cy.getElementById(s).length && cy.getElementById(t).length) cy.add({ group: "edges", data: { source: s, target: t, label: e.label || "" } });
      }
    });
    if (!placed && nodes.length) runLayout("cose", { fresh: cy.nodes().length === nodes.length });
    else fitView();
    refresh();
  }

  const EX_POS = [[60, 90], [820, 110], [700, 430], [250, 170], [470, 110], [290, 360], [660, 230], [500, 450], [600, 0], [840, 300], [380, 560]];
  const EXAMPLE = {
    nodes: [
      ["Ana Ruiz", "person"], ["Tom Becker", "person"], ["Lena Novak", "person"],
      ["Harbor Holdings", "company"], ["Bluefin Trading", "company"], ["Coral Logistics", "company"], ["Northwind Imports", "company"], ["Atlas Freight", "company"],
      ["Account 4471", "account"], ["Account 9032", "account"], ["Port of Valen", "place"],
    ].map(([label, type], i) => ({ id: `e${i}`, label, type, x: EX_POS[i][0] * 0.55, y: EX_POS[i][1] * 0.6 })),
    edges: [
      [0, 3, "directs"], [3, 4, "owns"], [3, 5, "owns"], [1, 6, "directs"], [4, 6, "pays"], [5, 10, "ships via"],
      [7, 10, "ships via"], [4, 8, "holds"], [6, 9, "holds"], [8, 9, "transfers"], [2, 7, "directs"], [2, 1, "knows"], [5, 7, "leases"],
    ].map(([s, t, label]) => ({ source: `e${s}`, target: `e${t}`, label })),
  };

  // ── Analysis panel ──

  function rank(list, items) {
    list.replaceChildren(...items.map(([node, score]) => {
      const li = document.createElement("li");
      const b = document.createElement("button");
      b.type = "button";
      const name = document.createElement("span"), val = document.createElement("span");
      name.textContent = node.data("label") || node.id();
      val.textContent = score;
      b.append(name, val);
      b.addEventListener("click", () => {
        cy.$(":selected").unselect();
        node.select();
        cy.animate({ center: { eles: node }, zoom: Math.max(cy.zoom(), 1) }, { duration: 300 });
      });
      li.append(b);
      return li;
    }));
    if (!items.length) list.innerHTML = '<li style="color:var(--ink-3);font-size:14px">Nothing yet</li>';
  }

  let refreshTimer;
  function refresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      $("n-nodes").textContent = cy.nodes().length;
      $("n-edges").textContent = cy.edges().length;
      $("n-groups").textContent = cy.nodes().length ? cy.elements().components().length : 0;
      const nodes = cy.nodes().toArray();
      rank($("by-degree"), nodes.map((n) => [n, n.degree()]).filter(([, d]) => d > 0).sort((a, b) => b[1] - a[1]).slice(0, 5));
      if (nodes.length > 2) {
        const bc = cy.elements().betweennessCentrality({ directed: false });
        rank($("by-between"), nodes.map((n) => [n, Math.round(bc.betweenness(n) * 10) / 10]).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 5));
      } else rank($("by-between"), []);
      showSelection();
      cy.style().update();
    }, 120);
    save();
  }

  // ── Selection form ──

  function showSelection() {
    const sel = cy.$(":selected");
    const node = sel.length === 1 && sel.isNode() ? sel : null;
    const edge = sel.length === 1 && sel.isEdge() ? sel : null;
    $("nothing").hidden = !!(node || edge);
    $("node-form").hidden = !node;
    $("edge-form").hidden = !edge;
    if (node) {
      if (document.activeElement !== $("node-label")) $("node-label").value = node.data("label") || "";
      $("node-type").value = node.data("type") || "other";
      const d = node.degree();
      $("node-degree").textContent = `${d} link${d === 1 ? "" : "s"}`;
    }
    if (edge && document.activeElement !== $("edge-label")) $("edge-label").value = edge.data("label") || "";
  }

  $("node-label").addEventListener("input", (e) => { cy.$("node:selected").data("label", e.target.value); save(); });
  $("node-type").addEventListener("change", (e) => { cy.$("node:selected").data("type", e.target.value); cy.style().update(); save(); });
  $("edge-label").addEventListener("input", (e) => { cy.$("edge:selected").data("label", e.target.value); save(); });

  // ── Drawing ──

  const hint = (text) => { $("hint").textContent = text; };
  let connecting = false, source = null;

  function addNode(pos) {
    const id = newId();
    const n = cy.add({ group: "nodes", data: { id, label: `Node ${cy.nodes().length + 1}`, type: "other" }, position: pos || { x: (cy.width() / 2 - cy.pan().x) / cy.zoom(), y: (cy.height() / 2 - cy.pan().y) / cy.zoom() } });
    cy.$(":selected").unselect();
    n.select();
    refresh();
    setTimeout(() => { $("node-label").focus(); $("node-label").select(); }, 140);
  }

  function setConnecting(on) {
    connecting = on;
    $("connect").setAttribute("aria-pressed", String(on));
    if (source) source.removeClass("source");
    source = null;
    hint(on ? "Click the node to link from" : "");
  }

  cy.on("dbltap", (e) => { if (e.target === cy) addNode(e.position); });
  cy.on("tap", "node", (e) => {
    if (!connecting) return;
    const n = e.target;
    if (!source) { source = n; n.addClass("source"); hint("Now click the node to link to"); return; }
    if (n !== source) {
      const edge = cy.add({ group: "edges", data: { source: source.id(), target: n.id(), label: "" } });
      source.removeClass("source");
      source = null;
      cy.$(":selected").unselect();
      edge.select();
      hint("Linked. Click another node to start the next link, or press Esc");
      refresh();
    }
  });
  cy.on("select unselect", showSelection);
  cy.on("dragfree", "node", save);

  // Fit the graph on screen, but don't blow a small graph up past 1.2×.
  function fitView() {
    cy.fit(undefined, 60);
    if (cy.zoom() > 1.2) { cy.zoom(1.2); cy.center(); }
  }

  function runLayout(name, { fresh = false } = {}) {
    // Force-directed layout runs to the end first and then animates there in one move.
    const opts = { name, animate: name === "cose" ? "end" : true, animationDuration: 500, fit: true, padding: 60 };
    if (name === "cose") Object.assign(opts, { nodeRepulsion: () => 400000, idealEdgeLength: () => 120, edgeElasticity: () => 100, gravity: 0.25, numIter: 2500, randomize: fresh });
    if (name === "concentric") Object.assign(opts, { concentric: (n) => n.degree(), levelWidth: () => 2 });
    const layout = cy.layout(opts);
    layout.one("layoutstop", () => { if (cy.zoom() > 1.2) { cy.animate({ zoom: 1.2, center: { eles: cy.elements() } }, { duration: 200 }); } save(); });
    layout.run();
  }

  // ── Import ──

  function parseCSV(text) {
    const rows = [];
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const cells = [];
      let cur = "", q = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (q) {
          if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
          else if (c === '"') q = false;
          else cur += c;
        } else if (c === '"') q = true;
        else if (c === "," || c === "\t" || c === ";") { cells.push(cur.trim()); cur = ""; }
        else cur += c;
      }
      cells.push(cur.trim());
      rows.push(cells);
    }
    if (!rows.length) throw new Error("There's nothing to import.");
    const head = rows[0].map((h) => h.toLowerCase());
    let si = head.indexOf("source"), ti = head.indexOf("target"), li = head.indexOf("label");
    if (si === -1 || ti === -1) { si = 0; ti = 1; li = 2; } else rows.shift();
    const byLabel = new Map(cy.nodes().map((n) => [n.data("label"), n.id()]));
    const nodes = [], edges = [];
    const idFor = (label) => {
      if (!byLabel.has(label)) { const id = `i${byLabel.size}_${Date.now() % 1e6}`; byLabel.set(label, id); nodes.push({ id, label, type: "other" }); }
      return byLabel.get(label);
    };
    for (const r of rows) {
      if (!r[si] || !r[ti]) continue;
      edges.push({ source: idFor(r[si]), target: idFor(r[ti]), label: li >= 0 ? r[li] || "" : "" });
    }
    if (!edges.length) throw new Error("No links found. Each row needs a source and a target.");
    return { nodes, edges };
  }

  function parse(text) {
    const t = text.trim();
    if (t.startsWith("{") || t.startsWith("[")) {
      let g;
      try { g = JSON.parse(t); } catch { throw new Error("That JSON doesn't parse."); }
      if (Array.isArray(g) || g.elements) {
        const els = Array.isArray(g) ? g : [...(g.elements.nodes || []), ...(g.elements.edges || [])];
        return {
          nodes: els.filter((e) => !e.data?.source).map((e) => ({ id: e.data.id, label: e.data.label || e.data.name || e.data.id, type: e.data.type })),
          edges: els.filter((e) => e.data?.source).map((e) => ({ source: e.data.source, target: e.data.target, label: e.data.label || "" })),
        };
      }
      if (!Array.isArray(g.nodes)) throw new Error("JSON needs a nodes list.");
      return g;
    }
    return parseCSV(t);
  }

  const dialog = $("import-dialog");
  const importError = (msg) => { $("import-error").hidden = !msg; $("import-error").textContent = msg || ""; };
  $("import").addEventListener("click", () => { importError(""); dialog.showModal(); $("import-text").focus(); });
  $("import-file").addEventListener("change", async (e) => { const f = e.target.files[0]; if (f) $("import-text").value = await f.text(); e.target.value = ""; });
  $("import-text").addEventListener("input", () => importError(""));
  $("import-go").addEventListener("click", (e) => {
    e.preventDefault();
    if (!$("import-text").value.trim()) { importError("Paste some data or choose a file first."); return; }
    try {
      const g = parse($("import-text").value);
      load(g);
      dialog.close();
      $("import-text").value = "";
    } catch (err) { importError(err.message); }
  });

  const stage = document.querySelector(".stage");
  stage.addEventListener("dragover", (e) => { e.preventDefault(); stage.classList.add("is-dragging"); });
  stage.addEventListener("dragleave", (e) => { if (!stage.contains(e.relatedTarget)) stage.classList.remove("is-dragging"); });
  stage.addEventListener("drop", async (e) => {
    e.preventDefault();
    stage.classList.remove("is-dragging");
    const f = e.dataTransfer.files[0];
    if (!f) return;
    try { load(parse(await f.text())); }
    catch (err) { hint(err.message); setTimeout(() => hint(""), 4000); }
  });

  // ── Toolbar ──

  const download = (blob, name) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  $("add").addEventListener("click", () => addNode());
  $("connect").addEventListener("click", () => setConnecting(!connecting));
  $("remove").addEventListener("click", () => { cy.$(":selected").remove(); refresh(); });
  $("layout").addEventListener("change", (e) => { if (e.target.value) runLayout(e.target.value); e.target.value = ""; });
  $("fit").addEventListener("click", () => fitView());
  $("save-json").addEventListener("click", () => download(new Blob([JSON.stringify(toLien(), null, 2)], { type: "application/json" }), "lien-graph.json"));
  $("save-png").addEventListener("click", () => download(cy.png({ output: "blob", full: true, scale: 2, bg: css("--bg") }), "lien-graph.png"));
  $("example").addEventListener("click", () => { if (!cy.nodes().length || confirm("Replace the canvas with the example network?")) load(EXAMPLE, { replace: true }); });
  $("clear").addEventListener("click", () => { if (!cy.elements().length || confirm("Clear the whole canvas?")) { cy.elements().remove(); setConnecting(false); refresh(); } });

  document.addEventListener("keydown", (e) => {
    if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) || dialog.open) return;
    if (e.key === "Delete" || e.key === "Backspace") { cy.$(":selected").remove(); refresh(); }
    if (e.key === "Escape") setConnecting(false);
  });

  // ── Start: the last graph from this browser, or the example ──

  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(KEY)); } catch { /* none */ }
  load(saved && saved.nodes && saved.nodes.length ? saved : EXAMPLE);
  if (!saved || !saved.nodes || !saved.nodes.length) hint("An example network. Double-click to add a node, or Clear to start fresh");
})();
