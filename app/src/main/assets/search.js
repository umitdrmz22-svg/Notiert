"use strict";
const librarySearch = {
  query: "",
  field: "all",
  includeChildren: true,
  limit: 30,
};
const searchFields = [
  "all",
  "notes",
  "sections",
  "decisions",
  "tasks",
  "metadata",
];
const normalizeSearch = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/ı/g, "i")
    .replace(/ß/g, "ss");
const queryTerms = (q) => [
  ...new Set(normalizeSearch(q).trim().split(/\s+/).filter(Boolean)),
];

function noteContents(n) {
  const path = folderPath(n.folder)
    .map((f) => f.name)
    .join(" / ");
  const items = [
    ["notes", t("notes"), n.body],
    ["decisions", t("decisions"), n.decisions],
    ...(n.sections || []).map((s) => [
      "sections",
      s.label,
      [s.label, s.value].filter(Boolean).join(" · "),
    ]),
    ...(n.tasks || []).map((o) => [
      "tasks",
      t("tasks"),
      [o.text, o.owner, o.due].filter(Boolean).join(" · "),
    ]),
    ["metadata", t("title"), title(n)],
    ["metadata", t("folder"), path],
    ...["company", "dept", "area", "topic", "participants", "date"].map((k) => [
      "metadata",
      t(k),
      n[k],
    ]),
    ["metadata", t("followup"), n.followDate],
    [
      "metadata",
      t("templateLibrary"),
      n.type === "blank" ? "" : templateName(n.type),
    ],
  ];
  return items
    .filter((x) => x[2])
    .map(([field, label, value]) => ({ field, label, text: String(value) }));
}
function searchNote(n, terms, field) {
  const hits = new Set();
  let best,
    score = 0;
  for (const part of noteContents(n)) {
    if (field !== "all" && part.field !== field) continue;
    const normalized = normalizeSearch(part.text);
    const present = terms.filter((q) => normalized.includes(q));
    if (present.length > score) {
      best = part;
      score = present.length;
    }
    present.forEach((q) => hits.add(q));
  }
  return hits.size === terms.length ? best : null;
}
function searchExcerpt(value, terms) {
  const text = value.replace(/\s+/g, " ").trim(),
    offsets = [];
  let flat = "";
  for (let i = 0; i < text.length; ) {
    const ch = String.fromCodePoint(text.codePointAt(i)),
      norm = normalizeSearch(ch);
    flat += norm;
    for (let j = 0; j < norm.length; j++) offsets.push(i);
    i += ch.length;
  }
  offsets.push(text.length);
  const spans = [];
  for (const term of terms) {
    let pos = flat.indexOf(term);
    while (pos !== -1) {
      spans.push([offsets[pos], offsets[pos + term.length]]);
      pos = flat.indexOf(term, pos + term.length);
    }
  }
  spans.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const start = Math.max(0, (spans[0]?.[0] || 0) - 45),
    end = Math.min(text.length, start + 150);
  let result = start ? "…" : "",
    cursor = start;
  for (const [a, b] of spans) {
    if (a >= end) break;
    if (b <= cursor) continue;
    result +=
      esc(text.slice(cursor, Math.max(a, cursor))) +
      "<mark>" +
      esc(text.slice(Math.max(a, cursor), Math.min(b, end))) +
      "</mark>";
    cursor = Math.min(b, end);
  }
  return result + esc(text.slice(cursor, end)) + (end < text.length ? "…" : "");
}
function searchNoteRow(n, part, terms) {
  const path =
    folderPath(n.folder)
      .map((f) => f.name)
      .join(" / ") || t("rootFolder");
  return (
    '<button class="item hitrow" data-act="openPage" data-val="' +
    esc(n.id) +
    '"><span class="grow"><b>' +
    esc(title(n)) +
    "</b><small>" +
    esc([fmt(n.date), path].filter(Boolean).join(" · ")) +
    '</small><span class="excerpt"><strong>' +
    esc(part.label) +
    "</strong> · " +
    searchExcerpt(part.text, terms) +
    "</span></span>" +
    icon("next") +
    "</button>"
  );
}
function homeSearchMarkup() {
  const s = librarySearch,
    label = t(homeFolder ? "searchHere" : "searchNotebook");
  return (
    '<section class="notebooksearch"><label class="findbox">' +
    icon("search") +
    '<input type="search" id="homeQuery" aria-label="' +
    esc(label) +
    '" placeholder="' +
    esc(label) +
    '" value="' +
    esc(s.query) +
    '"></label><div id="homeSearchFilters"' +
    (s.query.trim() ? "" : " hidden") +
    '><select id="homeField" aria-label="' +
    t("searchField") +
    '">' +
    searchFields
      .map((k) => option(k, t(k === "all" ? "allFields" : k), s.field))
      .join("") +
    "</select>" +
    (homeFolder
      ? '<label class="deepcheck"><input type="checkbox" id="deepSearch" ' +
        (s.includeChildren ? "checked" : "") +
        ">" +
        t("subfolderSearch") +
        "</label>"
      : "") +
    '</div><div id="homeHits" aria-live="polite"></div></section>'
  );
}
function homeSearchResults() {
  const s = librarySearch,
    terms = queryTerms(s.query),
    rows = [],
    paths = new Map();
  const inside = (id) => {
    if (!homeFolder || id === homeFolder) return true;
    if (!s.includeChildren || !id) return false;
    if (!paths.has(id))
      paths.set(
        id,
        folderPath(id).some((f) => f.id === homeFolder),
      );
    return paths.get(id);
  };
  if (s.field === "all" || s.field === "metadata") {
    for (const f of folders) {
      if (
        f.id === homeFolder ||
        !inside(f.parent) ||
        !terms.every((q) => normalizeSearch(f.name).includes(q))
      )
        continue;
      rows.push(
        () =>
          '<button class="folderrow" data-act="orgFolder" data-val="' +
          esc(f.id) +
          '"><i class="foldericon">' +
          icon("folder") +
          '</i><span class="grow"><b>' +
          searchExcerpt(f.name, terms) +
          "</b><small>" +
          esc(
            folderPath(f.id)
              .map((o) => o.name)
              .join(" / "),
          ) +
          "</small></span>" +
          icon("next") +
          "</button>",
      );
    }
  }
  for (const n of sorted(notes)) {
    if (!inside(n.folder)) continue;
    const part = searchNote(n, terms, s.field);
    if (part) rows.push(() => searchNoteRow(n, part, terms));
  }
  return (
    '<p class="hitcount">' +
    rows.length +
    " · " +
    t("searchHits") +
    "</p>" +
    rows
      .slice(0, s.limit)
      .map((build) => build())
      .join("") +
    (rows.length > s.limit
      ? button("orgMoreHits", t("moreHits"), "plus", "soft")
      : "")
  );
}
function refreshHomeHits() {
  const active = Boolean(librarySearch.query.trim());
  $("#homeSearchFilters").hidden = !active;
  $("#homeShelves").hidden = active;
  $("#homeHits").innerHTML = active ? homeSearchResults() : "";
}
function bindHomeSearch() {
  const input = $("#homeQuery");
  if (!input) return;
  input.oninput = () => {
    librarySearch.query = input.value;
    librarySearch.limit = 30;
    refreshHomeHits();
  };
  $("#homeField").onchange = (e) => {
    librarySearch.field = e.target.value;
    librarySearch.limit = 30;
    refreshHomeHits();
  };
  if ($("#deepSearch"))
    $("#deepSearch").onchange = (e) => {
      librarySearch.includeChildren = e.target.checked;
      librarySearch.limit = 30;
      refreshHomeHits();
    };
  refreshHomeHits();
}
function resetHomeSearch() {
  Object.assign(librarySearch, {
    query: "",
    field: "all",
    includeChildren: true,
    limit: 30,
  });
}
