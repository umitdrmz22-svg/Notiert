"use strict";
const outlines = {
  handover: ["shiftData", "completed", "deviations", "handoverNext", "pending"],
  walk: ["location", "people", "hazard", "evidence", "priority", "effect"],
  assessment: ["scope", "people", "hazard", "existing", "priority", "effect"],
  client: ["scope", "requests", "deliver", "dependencies", "pending"],
  maintenance: ["condition", "deviations", "resources", "releaseCheck"],
  audit: ["criteria", "finding", "correction", "owner", "effect"],
  project: ["scope", "milestones", "risks", "dependencies", "nextSteps"],
  team: ["agenda", "feedback", "pending", "nextSteps"],
};
const folderIcons = {
  company: "office",
  dept: "layers",
  area: "tool",
  topic: "tag",
};
const folderColors = ["ochre", "fig", "jade", "clay", "iris", "sea"];
function folderColor(folder) {
  if (folderColors.includes(folder?.color)) return folder.color;
  const key = folder?.id || "";
  return folderColors[
    Array.from(key).reduce((sum, ch) => sum + ch.charCodeAt(0), 0) %
      folderColors.length
  ];
}
function folderTile(folder) {
  const count = notes.filter((n) => n.folder === folder.id).length,
    nested = folders.filter((f) => f.parent === folder.id).length;
  return (
    '<button class="dossier color-' +
    folderColor(folder) +
    '" data-act="orgFolder" data-val="' +
    esc(folder.id) +
    '"><span class="dossiername">' +
    esc(folder.name) +
    '</span><span class="dosmeta">' +
    icon("book") +
    count +
    '<span class="sr">' +
    t("notes") +
    "</span>" +
    icon("folder") +
    nested +
    '<span class="sr">' +
    t("folders") +
    "</span></span></button>"
  );
}
function colorPicker(selected) {
  return (
    '<fieldset class="inkpicker"><legend>' +
    t("folderColor") +
    "</legend>" +
    folderColors
      .map(
        (c) =>
          '<label class="inkswatch color-' +
          c +
          '"><input type="radio" name="foldercolor" value="' +
          c +
          '" ' +
          (c === selected ? "checked" : "") +
          "><span>" +
          esc(t(c)) +
          "</span></label>",
      )
      .join("") +
    "</fieldset>"
  );
}
let showAllFolders = false;
let folders = [],
  customTemplates = [],
  homeFolder = "",
  homeCategory = "",
  calendarSpan = 1,
  pickedDate = day(),
  monthShown = pickedDate.slice(0, 7);
const folderOf = (id) => folders.find((f) => f.id === id);
const namedTemplate = (id) => customTemplates.find((x) => x.id === id);
function folderPath(id) {
  const path = [],
    seen = new Set();
  while (id && !seen.has(id)) {
    const f = folderOf(id);
    if (!f) break;
    seen.add(id);
    path.unshift(f);
    id = f.parent;
  }
  return path;
}
function templateName(id) {
  return namedTemplate(id)?.name || (strings[id] ? t(id) : t("blank"));
}
function templateParts(id) {
  return namedTemplate(id)?.fields || (outlines[id] || []).map(t);
}
function workspaceHome() {
  const f = folderOf(homeFolder);
  const pages = f ? notes.filter((n) => n.folder === f.id) : notes;
  const children = folders
    .filter((x) => x.parent === homeFolder)
    .sort((a, b) => a.name.localeCompare(b.name, ui));
  const trail = folderPath(homeFolder);
  const categorised = homeCategory ? values(homeCategory, pages) : [];
  const folderList = children
    .slice(0, showAllFolders ? children.length : 3)
    .map(folderTile)
    .join("");
  return (
    '<div class="mast color-' +
    folderColor(f) +
    '"><div class="spine" aria-hidden="true"></div><div class="mastcopy"><p class="dateline">' +
    esc(new Intl.DateTimeFormat(ui, { weekday: "long" }).format(new Date())) +
    "</p><h1>" +
    esc(f?.name || t("book")) +
    '</h1></div><button type="button" class="coverdate" data-act="orgAgenda" aria-label="' +
    esc(t("calendar") + " · " + fmt(day())) +
    '"><span>' +
    esc(new Intl.DateTimeFormat(ui, { month: "short" }).format(new Date())) +
    "</span><b>" +
    new Date().getDate() +
    "</b></button>" +
    button("orgNew", t("new"), "pen", "primary") +
    "</div>" +
    '<div class="quicktools">' +
    button("orgTemplates", t("templateLibrary"), "layers", "shortcut") +
    button(
      "orgOpenTasks",
      t("openTaskCount") +
        " · " +
        notes.reduce(
          (n, page) => n + page.tasks.filter((task) => !task.done).length,
          0,
        ),
      "tasks",
      "shortcut",
    ) +
    "</div>" +
    homeSearchMarkup() +
    '<div id="homeShelves">' +
    '<section class="shelf"><div class="split"><h2>' +
    t("folders") +
    "</h2>" +
    button(
      "orgAddFolder",
      t(f ? "newSubfolder" : "newFolder"),
      "plus",
      "textbtn",
    ) +
    "</div>" +
    (f
      ? '<div class="crumbs">' +
        button("orgFolder", t("rootFolder"), "folder", "quiet", "") +
        trail
          .slice(0, -1)
          .map((x) => button("orgFolder", x.name, "next", "quiet", x.id))
          .join("") +
        button("orgRename", t("rename"), "pen", "quiet") +
        "</div>"
      : "") +
    '<div class="dossiers">' +
    (folderList ||
      (!f
        ? button("orgAddFolder", t("createFirst"), "folder", "emptyfolder")
        : button("orgAddFolder", t("newSubfolder"), "folder", "emptyfolder"))) +
    "</div>" +
    (children.length > 3
      ? button(
          "orgShowFolders",
          t(showAllFolders ? "lessFolders" : "allFolders"),
          "folder",
          "textbtn",
        )
      : "") +
    "</section>" +
    '<section class="shelf"><h2>' +
    t("categories") +
    '</h2><div class="catgrid">' +
    ["company", "dept", "area", "topic"]
      .map(
        (k) =>
          '<button class="cat cat-' +
          k +
          (homeCategory === k ? " active" : "") +
          '" data-act="orgCategory" data-val="' +
          k +
          '" aria-expanded="' +
          (homeCategory === k) +
          '"><i>' +
          icon(folderIcons[k]) +
          "</i><span>" +
          t(k) +
          "</span><b>" +
          values(k, pages).length +
          "</b></button>",
      )
      .join("") +
    "</div>" +
    (homeCategory
      ? '<div class="categoryvalues">' +
        categorised
          .map((x) => button("orgFilter", x, "tag", "chip", x))
          .join("") +
        button("orgCategoryNew", t("new"), "plus", "textbtn") +
        "</div>"
      : "") +
    "</section>" +
    '<section class="shelf"><div class="split"><h2>' +
    t(f ? "inFolder" : "recent") +
    '</h2><span class="meta">' +
    pages.length +
    "</span></div>" +
    (pages.length
      ? sorted(pages)
          .slice(0, f ? pages.length : 6)
          .map(pageRow)
          .join("")
      : '<p class="muted">' + t("empty") + "</p>") +
    "</section></div>"
  );
}
function folderForm(edit) {
  const f = edit ? folderOf(homeFolder) : null;
  pop(
    "<h2>" +
      t(edit ? "rename" : "newFolder") +
      '</h2><p class="meta">' +
      esc(
        [
          t("rootFolder"),
          ...folderPath(edit ? f.parent : homeFolder).map((x) => x.name),
        ].join(" / "),
      ) +
      '</p><form id="folderform">' +
      field(
        t("folderName"),
        '<input id="foldername" required maxlength="100" value="' +
          esc(f?.name || "") +
          '">',
      ) +
      colorPicker(
        f
          ? folderColor(f)
          : folderColors[
              folders.filter((o) => o.parent === homeFolder).length %
                folderColors.length
            ],
      ) +
      '<div class="actions"><button class="primary">' +
      t("save") +
      "</button>" +
      button("close", t("cancel"), "", "quiet") +
      "</div></form>",
  );
  $("#folderform").onsubmit = async (e) => {
    e.preventDefault();
    const name = $("#foldername").value.trim();
    if (!name) return;
    const parent = f ? f.parent : homeFolder,
      key = name.toLocaleLowerCase();
    if (
      folders.some(
        (o) => o.parent === parent && o.key === key && o.id !== f?.id,
      )
    ) {
      notify(t("duplicate"));
      return;
    }
    const item = {
      id: f?.id || uid(),
      parent,
      name,
      key,
      color: $("#folderform input[name=foldercolor]:checked").value,
    };
    try {
      await transaction(["folders"], (tx) =>
        tx.objectStore("folders").put(item),
      );
      folders = folders.filter((o) => o.id !== item.id).concat(item);
      homeFolder = item.id;
      resetHomeSearch();
      showAllFolders = false;
      closePop();
      navigate();
    } catch {
      notify(t("error"));
    }
  };
}
function templateList() {
  const options = [
    ...Object.keys(outlines),
    ...customTemplates.map((x) => x.id),
  ];
  pop(
    "<h2>" +
      t("templateLibrary") +
      "</h2>" +
      options
        .map(
          (k) =>
            '<button class="item tpl color-' +
            folderColors[options.indexOf(k) % folderColors.length] +
            '" data-act="orgPreview" data-val="' +
            esc(k) +
            '"><i>' +
            icon("layers") +
            '</i><span class="grow">' +
            esc(templateName(k)) +
            "<small>" +
            templateParts(k).length +
            " · " +
            t("sections") +
            "</small></span>" +
            icon("next") +
            "</button>",
        )
        .join("") +
      '<div class="actions tools">' +
      button("orgCustom", t("newTemplate"), "plus", "primary") +
      button("close", t("close"), "", "quiet") +
      "</div>",
  );
}
function templatePreview(id) {
  pop(
    '<span class="badge">' +
      t("templateLibrary") +
      "</span><h2>" +
      esc(templateName(id)) +
      '</h2><ul class="outline">' +
      templateParts(id)
        .map((x) => "<li>" + esc(x) + "</li>")
        .join("") +
      '</ul><div class="actions">' +
      button("orgUse", t("useTemplate"), "pen", "primary", id) +
      button("orgTemplates", t("back"), "back", "quiet") +
      "</div>",
  );
}
function customForm() {
  pop(
    "<h2>" +
      t("newTemplate") +
      '</h2><form id="templateform">' +
      field(
        t("templateName"),
        '<input id="tplname" required maxlength="100">',
      ) +
      field(
        t("templateFields"),
        '<textarea id="tplfields" required rows="5" maxlength="3500"></textarea>',
      ) +
      '<div class="actions"><button class="primary">' +
      t("save") +
      "</button>" +
      button("close", t("cancel"), "", "quiet") +
      "</div></form>",
  );
  $("#templateform").onsubmit = async (e) => {
    e.preventDefault();
    const name = $("#tplname").value.trim(),
      fields = [
        ...new Set(
          $("#tplfields")
            .value.split("\n")
            .map((x) => x.trim())
            .filter(Boolean),
        ),
      ];
    if (!name || !fields.length) return;
    const tpl = { id: "custom-" + uid(), name, fields };
    try {
      await transaction(["templates"], (tx) =>
        tx.objectStore("templates").add(tpl),
      );
      customTemplates.push(tpl);
      templatePreview(tpl.id);
    } catch {
      notify(t("error"));
    }
  };
}
function eventMap() {
  const events = new Map(),
    append = (d, e) => {
      if (!d) return;
      if (!events.has(d)) events.set(d, []);
      events.get(d).push(e);
    };
  for (const n of notes) {
    append(n.date, {
      n,
      key: "meetingEvent",
      label: title(n),
      time: n.startTime || "",
    });
    append(n.followDate, { n, key: "followup", label: title(n), time: "" });
    for (const o of n.tasks)
      if (!o.done)
        append(o.due, {
          n,
          key: "due",
          label: o.text,
          owner: o.owner,
          time: "",
        });
  }
  return events;
}
function dateFrom(s) {
  return new Date(s + "T12:00:00");
}
function monthMove(delta) {
  const d = dateFrom(monthShown + "-01");
  d.setMonth(d.getMonth() + delta);
  monthShown = day(d).slice(0, 7);
  pickedDate = monthShown + "-01";
}
function calendarView() {
  const first = dateFrom(monthShown + "-01"),
    last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const shift = (first.getDay() + 6) % 7,
    events = eventMap();
  const weekdays = Array.from(
    { length: 7 },
    (_, i) =>
      "<span>" +
      esc(
        new Intl.DateTimeFormat(ui, { weekday: "narrow" }).format(
          new Date(2024, 0, 1 + i),
        ),
      ) +
      "</span>",
  ).join("");
  const cells = Array.from({ length: last }, (_, i) => {
    const d = monthShown + "-" + String(i + 1).padStart(2, "0"),
      n = events.get(d)?.length || 0;
    return (
      '<button aria-label="' +
      esc(fmt(d)) +
      " · " +
      n +
      '" aria-pressed="' +
      (d === pickedDate) +
      '" data-act="orgDay" data-val="' +
      d +
      '" class="calday ' +
      (d === pickedDate ? "selected " : "") +
      (d === day() ? "now" : "") +
      '"><span>' +
      (i + 1) +
      "</span>" +
      (n ? "<i></i>" : "") +
      "</button>"
    );
  }).join("");
  return (
    '<div class="split"><h1>' +
    t("calendar") +
    "</h1>" +
    button("orgToday", t("todayDate"), "calendar", "soft") +
    '</div><section class="monthpanel"><div class="monthbar">' +
    '<button class="iconbtn" aria-label="' +
    t("previousMonth") +
    '" data-act="orgMonth" data-val="-1">' +
    icon("back") +
    "</button><label><span>" +
    esc(
      new Intl.DateTimeFormat(ui, { month: "long", year: "numeric" }).format(
        first,
      ),
    ) +
    '</span><input id="calmonth" type="month" aria-label="' +
    t("month") +
    '" value="' +
    monthShown +
    '"></label><button class="iconbtn" aria-label="' +
    t("nextMonth") +
    '" data-act="orgMonth" data-val="1">' +
    icon("arrow") +
    '</button></div><div class="weekgrid">' +
    weekdays +
    '</div><div class="monthgrid">' +
    "<span></span>".repeat(shift) +
    cells +
    "</div></section>" +
    '<div class="split shelf"><h2>' +
    esc(fmt(pickedDate)) +
    "</h2>" +
    button("orgNew", t("new"), "plus", "textbtn") +
    "</div>" +
    '<div class="agendatabs" role="group" aria-label="' +
    esc(t("calendar")) +
    '">' +
    [1, 7]
      .map(
        (span) =>
          '<button data-act="orgSpan" data-val="' +
          span +
          '" aria-pressed="' +
          (span === calendarSpan) +
          '">' +
          t(span === 1 ? "agendaDay" : "agendaWeek") +
          "</button>",
      )
      .join("") +
    "</div>" +
    agendaEntries(events)
  );
}
function agendaEntries(events) {
  let result = "";
  const date = dateFrom(pickedDate);
  for (
    let index = 0;
    index < calendarSpan;
    index++, date.setDate(date.getDate() + 1)
  ) {
    const key = day(date);
    const entries = (events.get(key) || []).sort(
      (a, b) =>
        (a.time || "24").localeCompare(b.time || "24") ||
        a.label.localeCompare(b.label, ui),
    );
    if (!entries.length) continue;
    if (calendarSpan > 1) {
      const weekday = new Intl.DateTimeFormat(ui, {
        weekday: "long",
        day: "numeric",
        month: "short",
      }).format(date);
      result += '<h3 class="agendadate">' + esc(weekday) + "</h3>";
    }
    result += entries
      .map((e) => {
        const details = [
          t(e.key),
          e.time,
          e.owner,
          e.n.company || folderPath(e.n.folder)[0]?.name,
        ];
        return (
          '<button class="item agendaevent" data-act="openPage" data-val="' +
          esc(e.n.id) +
          '"><i class="eventicon">' +
          icon(
            e.key === "due"
              ? "tasks"
              : e.key === "followup"
                ? "repeat"
                : "calendar",
          ) +
          '</i><span class="grow">' +
          esc(e.label) +
          "<small>" +
          esc(details.filter(Boolean).join(" · ")) +
          "</small></span>" +
          icon("next") +
          "</button>"
        );
      })
      .join("");
  }
  return (
    result ||
    '<p class="muted">' +
      t(calendarSpan === 1 ? "noEvents" : "noWeekEvents") +
      "</p>"
  );
}
function sectionFields(n) {
  return (n.sections || [])
    .map((s, i) =>
      field(
        s.label,
        '<textarea data-section="' +
          i +
          '" rows="2">' +
          esc(s.value) +
          "</textarea>",
      ),
    )
    .join("");
}
function folderDestinations() {
  return folders
    .map((f) => ({
      id: f.id,
      path: folderPath(f.id)
        .map((x) => x.name)
        .join(" / "),
    }))
    .sort((a, b) => a.path.localeCompare(b.path, ui));
}
function chooseMeetingFolder() {
  const n = note();
  if (!n) return;
  const destinations = [
    { id: "", path: t("noFolder") },
    ...folderDestinations(),
  ];
  pop(
    "<h2>" +
      t("moveMeeting") +
      "</h2>" +
      field(t("searchFolders"), '<input type="search" id="moveSearch">') +
      '<div id="moveDestinations"></div>' +
      button("close", t("cancel"), "", "quiet"),
  );
  const list = $("#moveDestinations"),
    search = $("#moveSearch");
  function updateList() {
    const terms = normalizeSearch(search.value)
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    const matches = destinations.filter((f) =>
      terms.every((w) => normalizeSearch(f.path).includes(w)),
    );
    list.innerHTML =
      matches
        .map((f) =>
          button(
            "orgMoveTo",
            f.path,
            f.id === (n.folder || "") ? "check" : "folder",
            "rowbtn",
            f.id,
          ),
        )
        .join("") || '<p class="muted">' + t("noFolderMatch") + "</p>";
  }
  search.oninput = updateList;
  updateList();
}
function organizationFields(n) {
  const opts = folderDestinations();
  return field(
    t("folder"),
    '<select data-key="folder">' +
      option("", t("noFolder"), n.folder || "") +
      opts.map((f) => option(f.id, f.path, n.folder)).join("") +
      "</select>",
  );
}
function scheduleFields(n) {
  return (
    '<div class="grid">' +
    field(t("starts"), textInput("startTime", n, 'type="time"')) +
    field(t("ends"), textInput("endTime", n, 'type="time"')) +
    "</div>" +
    field(t("followup"), textInput("followDate", n, 'type="date"'))
  );
}
function showSchedule(n) {
  return [fmt(n.date), [n.startTime, n.endTime].filter(Boolean).join("–")]
    .filter(Boolean)
    .join(" · ");
}
function organizerBind() {
  bindHomeSearch();
  const month = $("#calmonth");
  if (month)
    month.onchange = () => {
      if (/^\d{4}-\d{2}$/.test(month.value)) {
        monthShown = month.value;
        pickedDate = monthShown + "-01";
        navigate();
      }
    };
  for (const el of document.querySelectorAll("[data-section]"))
    el.oninput = () => {
      const n = note();
      n.sections[Number(el.dataset.section)].value = el.value;
      persist(n).catch(() => notify(t("error")));
    };
  for (const el of document.querySelectorAll("[data-range]"))
    el.onchange = () => {
      const next = { ...filters, [el.dataset.range]: el.value };
      if (next.start && next.end && next.start > next.end) {
        el.value = filters[el.dataset.range] || "";
        notify(t("invalidRange"));
        return;
      }
      filters = next;
      $("#results").innerHTML = found();
    };
}
async function organizerAction(a, v) {
  switch (a) {
    case "orgShowFolders":
      showAllFolders = !showAllFolders;
      render();
      break;
    case "orgMoreHits":
      librarySearch.limit += 30;
      refreshHomeHits();
      break;
    case "orgMove":
      chooseMeetingFolder();
      return;
    case "orgMoveTo": {
      const n = note();
      if (!n || (v && !folderOf(v))) return;
      const old = n.folder;
      n.folder = v;
      try {
        await persist(n);
      } catch (error) {
        n.folder = old;
        throw error;
      }
      closePop();
      render();
      notify(t("folder") + " · " + (folderOf(v)?.name || t("noFolder")));
      return;
    }
    case "orgFolder":
      resetHomeSearch();
      showAllFolders = false;
      homeFolder = v;
      homeCategory = "";
      navigate();
      break;
    case "orgAddFolder":
      folderForm(false);
      break;
    case "orgRename":
      folderForm(true);
      break;
    case "orgCategory":
      homeCategory = homeCategory === v ? "" : v;
      render();
      break;
    case "orgCategoryNew":
      await newPage("blank");
      detailsOpen = true;
      render();
      $("#" + homeCategory)?.focus();
      break;
    case "orgFilter":
      filters = {
        q: "",
        company: "",
        dept: "",
        area: "",
        topic: "",
        folder: homeFolder,
        [homeCategory]: v,
      };
      filtersOpen = true;
      tab = "browse";
      navigate();
      break;
    case "orgNew":
      await newPage("blank");
      break;
    case "orgTemplates":
      templateList();
      break;
    case "orgCustom":
      customForm();
      break;
    case "orgPreview":
      templatePreview(v);
      break;
    case "orgUse":
      closePop();
      await newPage(v);
      break;
    case "orgSpan":
      calendarSpan = v === "7" ? 7 : 1;
      render();
      break;
    case "orgDay":
      pickedDate = v;
      render();
      break;
    case "orgMonth":
      monthMove(Number(v));
      render();
      break;
    case "orgOpenTasks":
      taskMode = "open";
      tab = "tasks";
      navigate();
      break;
    case "orgAgenda":
      tab = "calendar";
      pickedDate = day();
      monthShown = pickedDate.slice(0, 7);
      navigate();
      break;
    case "orgToday":
      pickedDate = day();
      monthShown = pickedDate.slice(0, 7);
      navigate();
      break;
  }
}
