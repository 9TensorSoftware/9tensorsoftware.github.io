// The free sample browser: search and filter media-outlets-sample.json, 50 rows at a time.
(async () => {
  const $ = (id) => document.getElementById(id);
  const q = $("q"), country = $("country"), type = $("type"), rows = $("rows"), count = $("count"), more = $("more");
  const fmt = new Intl.NumberFormat("en");
  const PAGE = 50;
  let shown = PAGE;

  let data;
  try {
    data = await (await fetch("/kiosque/media-outlets-sample.json")).json();
  } catch {
    count.textContent = "The sample couldn't load. Download the CSV instead.";
    return;
  }
  const all = data.rows; // [name, type, country, website, wikidata]

  const fill = (select, values) => {
    for (const v of [...new Set(values)].sort((a, b) => a.localeCompare(b))) select.add(new Option(v, v));
  };
  fill(country, all.map((r) => r[2]));
  fill(type, all.map((r) => r[1]));

  const cell = (text) => {
    const td = document.createElement("td");
    td.textContent = text;
    return td;
  };

  function render() {
    const needle = q.value.trim().toLowerCase();
    const hits = all.filter((r) =>
      (!country.value || r[2] === country.value) &&
      (!type.value || r[1] === type.value) &&
      (!needle || r[0].toLowerCase().includes(needle) || r[3].toLowerCase().includes(needle)));

    rows.replaceChildren(...hits.slice(0, shown).map(([name, kind, place, web]) => {
      const tr = document.createElement("tr");
      const site = document.createElement("td");
      const a = document.createElement("a");
      a.href = web;
      a.rel = "noopener nofollow";
      a.textContent = web.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");
      site.append(a);
      tr.append(cell(name), cell(kind), cell(place), site);
      return tr;
    }));

    const n = Math.min(shown, hits.length);
    count.textContent = hits.length ? `Showing ${fmt.format(n)} of ${fmt.format(hits.length)} outlets` : "No outlets match.";
    more.hidden = hits.length <= shown;
  }

  const reset = () => { shown = PAGE; render(); };
  q.addEventListener("input", reset);
  country.addEventListener("change", reset);
  type.addEventListener("change", reset);
  more.addEventListener("click", () => { shown += PAGE; render(); });
  render();
})();
