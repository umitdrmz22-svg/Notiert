"use strict";
const tabs = [
  ["book", "book"],
  ["browse", "folder"],
  ["calendar", "calendar"],
  ["tasks", "tasks"],
  ["settings", "settings"],
];
const uid = () =>
  crypto.randomUUID
    ? crypto.randomUUID()
    : Array.from(crypto.getRandomValues(new Uint32Array(4)), (n) =>
        n.toString(16).padStart(8, "0"),
      ).join("");
let db,
  notes = [],
  tab = "book",
  editing = null,
  taskMode = "open",
  detailsOpen = false;
let filters = { q: "", company: "", dept: "", area: "", topic: "" },
  filtersOpen = false;
let recording = null,
  starting = false,
  startToken = 0,
  audioList = [],
  audioToken = 0,
  unsavedAudio = null;
const revisions = new Map(),
  dirty = new Set();
const clips = new Map();
const note = () => notes.find((x) => x.id === editing);
const tags = (s) =>
  (s || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
const title = (n) => n.title.trim() || t("untitled");
const desc = (n) =>
  [
    ...folderPath(n.folder).map((x) => x.name),
    n.company,
    n.dept,
    n.area,
    ...tags(n.topic),
  ]
    .filter(Boolean)
    .join(" · ");
const sorted = (items) =>
  items
    .slice()
    .sort(
      (a, b) =>
        Number(b.pin) - Number(a.pin) ||
        b.date.localeCompare(a.date) ||
        b.updated - a.updated,
    );
const byId = (id) => notes.find((n) => n.id === id);
function openDatabase() {
  return new Promise((ok, fail) => {
    const req = indexedDB.open("notiert.workbook", 2);
    req.onupgradeneeded = (event) => {
      const database = req.result;
      if (event.oldVersion < 1) {
        database.createObjectStore("pages", { keyPath: "id" });
        database
          .createObjectStore("audio", { keyPath: "id" })
          .createIndex("page", "page");
      }
      if (event.oldVersion < 2) {
        database
          .createObjectStore("folders", { keyPath: "id" })
          .createIndex("parentName", ["parent", "key"], { unique: true });
        database.createObjectStore("templates", { keyPath: "id" });
      }
    };
    req.onsuccess = () => ok(req.result);
    req.onerror = () => fail(req.error);
  });
}
function query(req) {
  return new Promise((ok, fail) => {
    req.onsuccess = () => ok(req.result);
    req.onerror = () => fail(req.error);
  });
}
function transaction(stores, fn) {
  return new Promise((ok, fail) => {
    const tx = db.transaction(stores, "readwrite");
    tx.oncomplete = ok;
    tx.onabort = () => fail(tx.error);
    tx.onerror = () => {};
    try {
      fn(tx);
    } catch (e) {
      tx.abort();
      fail(e);
    }
  });
}
function setStatus(msg) {
  const el = $("#saveStatus");
  if (el) el.textContent = msg;
}
async function persist(n) {
  const seq = (revisions.get(n.id) || 0) + 1;
  revisions.set(n.id, seq);
  n.updated = Date.now();
  dirty.add(n.id);
  setStatus(t("saving"));
  try {
    await transaction(["pages"], (tx) => tx.objectStore("pages").put(n));
    if (seq === revisions.get(n.id)) {
      dirty.delete(n.id);
      if (editing === n.id) setStatus(t("saved"));
    }
  } catch (err) {
    setStatus(t("error"));
    throw err;
  }
}
async function newPage(kind) {
  const sections = templateParts(kind),
    n = {
      id: uid(),
      title: "",
      type: kind,
      date: tab === "calendar" ? pickedDate : day(),
      folder: tab === "book" ? homeFolder : "",
      startTime: "",
      endTime: "",
      followDate: "",
      updated: Date.now(),
      company: "",
      dept: "",
      area: "",
      topic:
        kind === "assessment"
          ? t("safety") + ", GBU"
          : kind === "walk"
            ? t("safety")
            : "",
      participants: "",
      sections: sections.map((label) => ({ label, value: "" })),
      body: "",
      decisions: "",
      tasks: [],
      pin: false,
    };
  await persist(n);
  notes.unshift(n);
  await openPage(n.id, true);
}
function clearClips() {
  for (const url of clips.values()) URL.revokeObjectURL(url);
  clips.clear();
  audioList = [];
  audioToken++;
}
async function refreshClips(id) {
  const token = ++audioToken;
  const list = await query(
    db
      .transaction("audio")
      .objectStore("audio")
      .index("page")
      .getAll(IDBKeyRange.only(id)),
  );
  if (token !== audioToken || id !== editing) return;
  for (const url of clips.values()) URL.revokeObjectURL(url);
  clips.clear();
  audioList = list
    .sort((a, b) => a.created - b.created)
    .map((c) => {
      clips.set(c.id, URL.createObjectURL(c.blob));
      return { id: c.id, created: c.created, seconds: c.seconds };
    });
  const el = $("#audiolist");
  if (el) el.innerHTML = audioRows();
}
async function leaveEditor() {
  ++startToken;
  if (recording) await stopRecording();
  if (unsavedAudio) {
    notify(t("retryAudio"));
    return false;
  }
  if (editing && dirty.has(editing)) await persist(note());
  clearClips();
  editing = null;
  return true;
}
async function openPage(id, isNew = false) {
  if (editing && !(await leaveEditor())) return;
  editing = id;
  detailsOpen = false;
  navigate();
  await refreshClips(id);
}
function pageRow(n) {
  const date = new Date(n.date + "T12:00:00"),
    valid = !Number.isNaN(date.getTime());
  const month = valid
    ? new Intl.DateTimeFormat(ui, { month: "short" }).format(date)
    : "";
  const heading = valid ? date.getDate() : "—";
  return (
    '<button class="item pageitem color-' +
    folderColor(folderOf(n.folder)) +
    '" data-act="openPage" data-val="' +
    esc(n.id) +
    '"><span class="datestamp"><b>' +
    heading +
    "</b><small>" +
    esc(month) +
    '</small></span><span class="grow"><b>' +
    esc(title(n)) +
    "</b><small>" +
    esc([n.startTime, desc(n) || fmt(n.date)].filter(Boolean).join(" · ")) +
    "</small></span>" +
    icon(n.pin ? "pin" : "next") +
    "</button>"
  );
}
function values(key, pages = notes) {
  const items = pages
    .flatMap((n) => (key === "topic" ? tags(n.topic) : [n[key]?.trim()]))
    .filter(Boolean);
  return [...new Set(items)].sort((a, b) => a.localeCompare(b, ui));
}
const criteria = ["company", "dept", "area", "topic"];
function matches(n, k) {
  return (
    !filters[k] ||
    (k === "topic"
      ? tags(n.topic).includes(filters[k])
      : n[k].trim() === filters[k])
  );
}
function optionsFor(key) {
  const above = criteria.slice(0, criteria.indexOf(key));
  return values(
    key,
    notes.filter((n) => above.every((k) => matches(n, k))),
  );
}
function filtered() {
  return sorted(
    notes.filter(
      (n) =>
        (!filters.folder || n.folder === filters.folder) &&
        (!filters.start || n.date >= filters.start) &&
        (!filters.end || n.date <= filters.end) &&
        criteria.every((k) => matches(n, k)),
    ),
  );
}
function found() {
  const terms = queryTerms(filters.q);
  const rows = filtered()
    .map((n) => {
      if (!terms.length) return pageRow(n);
      const match = searchNote(n, terms, "all");
      return match ? searchNoteRow(n, match, terms) : "";
    })
    .filter(Boolean);
  return rows.join("") || '<p class="muted">' + t("none") + "</p>";
}
function indexView() {
  return (
    "<h1>" +
    t("browse") +
    "</h1>" +
    field(
      t("search"),
      '<input id="query" type="search" value="' + esc(filters.q) + '">',
    ) +
    '<details class="filterset" id="filterdetails"' +
    (filtersOpen ? " open" : "") +
    "><summary>" +
    t("filter") +
    '</summary><div class="grid">' +
    ["company", "dept", "area", "topic"]
      .map((k) =>
        field(
          t(k),
          '<select data-filter="' +
            k +
            '">' +
            option("", t("all"), filters[k]) +
            optionsFor(k)
              .map((s) => option(s, s, filters[k]))
              .join("") +
            "</select>",
        ),
      )
      .join("") +
    "</div>" +
    '<div class="grid">' +
    field(
      t("fromDate"),
      '<input type="date" data-range="start" value="' +
        esc(filters.start) +
        '">',
    ) +
    field(
      t("toDate"),
      '<input type="date" data-range="end" value="' + esc(filters.end) + '">',
    ) +
    "</div>" +
    (filters.folder
      ? '<p class="meta">' +
        t("folder") +
        " · " +
        esc(
          folderPath(filters.folder)
            .map((x) => x.name)
            .join(" / "),
        ) +
        "</p>"
      : "") +
    button("reset", t("clear"), "x", "soft") +
    '</details><div id="results">' +
    found() +
    "</div>"
  );
}
function taskRow(n, o, global = false) {
  return (
    '<div class="taskrow ' +
    (o.done ? "checked" : "") +
    '"><button class="checkbtn" data-act="toggle" data-val="' +
    n.id +
    "/" +
    o.id +
    '" aria-label="' +
    t(o.done ? "reopen" : "finish") +
    '" aria-pressed="' +
    o.done +
    '">' +
    icon(o.done ? "check" : "tasks") +
    '</button><button class="tasklabel" data-act="' +
    (global ? "openPage" : "editTask") +
    '" data-val="' +
    (global ? n.id : o.id) +
    '"><span>' +
    esc(o.text) +
    "</span><small>" +
    esc(
      [global ? title(n) : "", o.owner, o.due ? fmt(o.due) : ""]
        .filter(Boolean)
        .join(" · "),
    ) +
    "</small>" +
    (!o.done && o.due && o.due < day()
      ? '<small class="flag">' + t("overdue") + "</small>"
      : "") +
    "</button></div>"
  );
}
function tasksView() {
  const all = notes
    .flatMap((n) => n.tasks.map((o) => ({ n, o })))
    .filter(({ o }) => o.done === (taskMode === "done"))
    .sort(
      (a, b) =>
        (a.o.due || "9999").localeCompare(b.o.due || "9999") ||
        a.o.text.localeCompare(b.o.text, ui),
    );
  return (
    "<h1>" +
    t("tasks") +
    '</h1><div class="levels">' +
    ["open", "done"]
      .map((k) => button("taskMode", t(k), "", taskMode === k ? "on" : "", k))
      .join("") +
    '</div><section class="section">' +
    (all.length
      ? all.map(({ n, o }) => taskRow(n, o, true)).join("")
      : '<p class="muted">' + t("noTasks") + "</p>") +
    "</section>"
  );
}
function settingsView() {
  return (
    "<h1>" +
    t("settings") +
    "</h1>" +
    archiveSettings() +
    button("ui", t("interface") + " · " + names[ui], "globe", "rowbtn") +
    '<section class="section"><h2>' +
    t("storage") +
    "</h2><p>" +
    t("privacy") +
    "</p></section>"
  );
}
function textInput(k, n, extra = "") {
  return (
    '<input data-key="' +
    k +
    '" id="' +
    k +
    '" value="' +
    esc(n[k]) +
    '" ' +
    extra +
    ">"
  );
}
function dataField(k, n) {
  const list = values(k);
  return field(
    t(k),
    textInput(k, n, 'list="list-' + k + '"') +
      '<datalist id="list-' +
      k +
      '">' +
      list.map((s) => option(s, s, "")).join("") +
      "</datalist>",
  );
}
function audioRows() {
  return audioList
    .map(
      (c, i) =>
        '<div class="box"><div class="line"><strong>' +
        t("memo") +
        " " +
        (i + 1) +
        "</strong><small>" +
        Math.floor(c.seconds / 60) +
        ":" +
        String(c.seconds % 60).padStart(2, "0") +
        '</small></div><audio class="audio" controls preload="metadata" src="' +
        esc(clips.get(c.id)) +
        '"></audio>' +
        button("askDeleteAudio", t("delete"), "bin", "quiet", c.id) +
        "</div>",
    )
    .join("");
}
function recordControls() {
  return unsavedAudio
    ? button("retryAudio", t("retry"), "repeat", "danger")
    : recording
      ? button("stop", t("stop"), "stop", "rec") +
        ' <span class="meta" role="status">' +
        t("recording") +
        "</span>"
      : button("record", t("record"), "mic", "soft");
}
function carried(n) {
  if (!n.company.trim()) return "";
  const other = sorted(
    notes.filter(
      (p) =>
        p.id !== n.id &&
        p.company.trim().toLocaleLowerCase(ui) ===
          n.company.trim().toLocaleLowerCase(ui) &&
        p.date <= n.date,
    ),
  );
  const tasks = other.flatMap((p) =>
    p.tasks.filter((o) => !o.done).map((o) => taskRow(p, o, true)),
  );
  return tasks.length
    ? '<details class="box"><summary>' +
        t("carry") +
        " · " +
        tasks.length +
        "</summary>" +
        tasks.join("") +
        "</details>"
    : "";
}
function editor() {
  const n = note();
  return (
    '<div class="line pagehead">' +
    button("exit", t("back"), "back", "quiet") +
    button("more", t("more"), "settings", "quiet") +
    "</div>" +
    '<div class="noteheading color-' +
    folderColor(folderOf(n.folder)) +
    '">' +
    field(
      t("title"),
      textInput(
        "title",
        n,
        'class="page-title" placeholder="' + t("untitled") + '"',
      ),
    ) +
    '<span class="bookdate" id="pageDate">' +
    esc(showSchedule(n)) +
    '</span><p class="meta" id="pageTrail">' +
    esc(desc(n)) +
    "</p>" +
    "</div>" +
    '<details id="metadata" class="notemeta"' +
    (detailsOpen ? " open" : "") +
    "><summary>" +
    t("details") +
    "</summary>" +
    field(t("date"), textInput("date", n, 'type="date" required')) +
    scheduleFields(n) +
    organizationFields(n) +
    '<div class="grid">' +
    ["company", "dept", "area"].map((k) => dataField(k, n)).join("") +
    field(
      t("topic"),
      textInput("topic", n, 'placeholder="' + t("tagsHint") + '"'),
    ) +
    "</div>" +
    field(t("participants"), textInput("participants", n)) +
    "</details>" +
    (n.sections?.length
      ? '<details class="notemeta structured" open><summary>' +
        esc(templateName(n.type)) +
        " · " +
        t("sections") +
        "</summary>" +
        sectionFields(n) +
        "</details>"
      : "") +
    "<h2>" +
    t("notes") +
    '</h2><textarea aria-label="' +
    t("notes") +
    '" id="body" data-key="body" class="notespace" rows="6" placeholder="' +
    t("bodyHint") +
    '">' +
    esc(n.body) +
    '</textarea><span class="savedline" role="status" id="saveStatus">' +
    t(dirty.has(n.id) ? "saving" : "saved") +
    "</span>" +
    '<div class="section"><h2>' +
    t("voice") +
    '</h2><div id="recordcontrols">' +
    recordControls() +
    '</div><div id="audiolist">' +
    audioRows() +
    "</div></div>" +
    '<section class="section">' +
    field(
      t("decisions"),
      '<textarea id="decisions" data-key="decisions" rows="2">' +
        esc(n.decisions) +
        "</textarea>",
    ) +
    "</section>" +
    '<section class="section"><div class="split"><h2>' +
    t("nextSteps") +
    "</h2>" +
    button("addTask", t("newTask"), "plus", "soft") +
    '</div><div id="tasklist">' +
    n.tasks.map((o) => taskRow(n, o)).join("") +
    '</div><div id="carry">' +
    carried(n) +
    "</div></section>"
  );
}
function taskDialog(o = { id: "", text: "", owner: "", due: "" }) {
  pop(
    "<h2>" +
      t(o.id ? "editTask" : "newTask") +
      '</h2><form id="taskForm">' +
      field(
        t("taskDesc"),
        '<textarea id="tasktext" required rows="2">' +
          esc(o.text) +
          "</textarea>",
      ) +
      field(t("owner"), '<input id="owner" value="' + esc(o.owner) + '">') +
      field(
        t("due"),
        '<input id="due" type="date" value="' + esc(o.due) + '">',
      ) +
      '<div class="actions"><button class="primary" type="submit">' +
      t("save") +
      '</button><button type="button" data-act="close" class="quiet">' +
      t("cancel") +
      "</button></div></form>" +
      (o.id ? button("askDeleteTask", t("delete"), "bin", "quiet", o.id) : ""),
  );
  $("#taskForm").onsubmit = async (e) => {
    e.preventDefault();
    const text = $("#tasktext").value.trim();
    if (!text) {
      $("#tasktext").focus();
      return;
    }
    const n = note();
    const task = {
      id: o.id || uid(),
      text,
      owner: $("#owner").value.trim(),
      due: $("#due").value,
      done: !!o.done,
    };
    if (o.id) n.tasks = n.tasks.map((v) => (v.id === o.id ? task : v));
    else n.tasks.push(task);
    try {
      await persist(n);
      closePop();
      render();
    } catch {
      notify(t("error"));
    }
  };
}
function ask(label, action, id) {
  pop(
    "<h2>" +
      t(label) +
      '</h2><div class="actions">' +
      button(
        action,
        t(action === "deletePage" ? "arToBin" : "delete"),
        "bin",
        "danger",
        id,
      ) +
      button("close", t("cancel"), "", "quiet") +
      "</div>",
  );
}
function plain(n) {
  return [
    title(n),
    showSchedule(n),
    ...(n.followDate ? [t("followup") + " · " + fmt(n.followDate)] : []),
    ...folderPath(n.folder).map((x) => t("folder") + " · " + x.name),
    ...(n.sections || [])
      .filter((x) => x.value)
      .map((x) => x.label + "\n" + x.value),
    ...["company", "dept", "area", "topic", "participants"]
      .filter((k) => n[k])
      .map((k) => t(k) + " · " + n[k]),
    "",
    t("notes"),
    n.body,
    "",
    t("decisions"),
    n.decisions,
    "",
    t("nextSteps"),
    ...n.tasks.map(
      (o) =>
        "[" +
        (o.done ? "x" : " ") +
        "] " +
        [o.text, o.owner, o.due].filter(Boolean).join(" · "),
    ),
  ]
    .join("\n")
    .trim();
}
function render() {
  head("Notiert", tabs, tab);
  $("#nav").hidden = !!editing;
  $("#screen").innerHTML = editing
    ? editor()
    : {
        book: workspaceHome,
        browse: indexView,
        calendar: calendarView,
        tasks: tasksView,
        settings: settingsView,
      }[tab]();
  $("#screen").dataset.view = editing ? "editor" : tab;
  organizerBind();
  bindArchive();
  const meta = $("#metadata");
  if (meta)
    meta.ontoggle = () => {
      detailsOpen = meta.open;
    };
  const filter = $("#filterdetails");
  if (filter)
    filter.ontoggle = () => {
      filtersOpen = filter.open;
    };
  const q = $("#query");
  if (q)
    q.oninput = () => {
      filters.q = q.value;
      $("#results").innerHTML = found();
    };
  document.querySelectorAll("[data-filter]").forEach(
    (e) =>
      (e.onchange = () => {
        filters[e.dataset.filter] = e.value;
        for (const k of criteria.slice(
          criteria.indexOf(e.dataset.filter) + 1,
        )) {
          if (filters[k] && !optionsFor(k).includes(filters[k]))
            filters[k] = "";
        }
        filtersOpen = true;
        render();
      }),
  );
  document.querySelectorAll("[data-key]").forEach(
    (e) =>
      (e.oninput = () => {
        const n = note(),
          k = e.dataset.key;
        if (k === "date" && !e.value) {
          e.value = n.date;
          return;
        }
        if (
          (k === "startTime" && e.value && n.endTime && e.value >= n.endTime) ||
          (k === "endTime" && e.value && n.startTime && e.value <= n.startTime)
        ) {
          e.value = n[k] || "";
          notify(t("invalidRange"));
          return;
        }
        n[k] = e.value;
        if (
          [
            "company",
            "dept",
            "area",
            "topic",
            "date",
            "startTime",
            "endTime",
            "folder",
          ].includes(k)
        ) {
          $("#pageDate").textContent = showSchedule(n);
          $("#pageTrail").textContent = desc(n);
          $("#carry").innerHTML = carried(n);
        }
        persist(n).catch(() => notify(t("error")));
      }),
  );
}
async function saveClip(clip) {
  await transaction(["audio"], (tx) => tx.objectStore("audio").put(clip));
  unsavedAudio = null;
  if (editing === clip.page) await refreshClips(clip.page);
}
async function beginRecording() {
  closePop();
  if (recording || starting || unsavedAudio) return;
  const id = editing,
    token = ++startToken;
  starting = true;
  let stream = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (id !== editing || token !== startToken || document.hidden) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    const rec = new MediaRecorder(stream),
      chunks = [],
      since = Date.now();
    let resolve;
    const finished = new Promise((r) => (resolve = r));
    recording = { rec, finished };
    rec.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    rec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      if (chunks.length) {
        const clip = {
          id: uid(),
          page: id,
          created: since,
          seconds: Math.max(1, Math.round((Date.now() - since) / 1000)),
          blob: new Blob(chunks, { type: rec.mimeType || chunks[0].type }),
        };
        try {
          await saveClip(clip);
        } catch {
          unsavedAudio = clip;
          notify(t("retryAudio"));
        }
      } else notify(t("audioError"));
      recording = null;
      const c = $("#recordcontrols");
      if (c) c.innerHTML = recordControls();
      resolve();
    };
    rec.onerror = () => {
      notify(t("audioError"));
      if (rec.state === "recording") rec.stop();
    };
    rec.start(1000);
    $("#recordcontrols").innerHTML = recordControls();
  } catch {
    stream?.getTracks().forEach((t) => t.stop());
    recording = null;
    notify(t("audioError"));
  } finally {
    starting = false;
  }
}
function stopRecording() {
  if (!recording) return Promise.resolve();
  const { rec, finished } = recording;
  if (rec.state === "recording") rec.stop();
  return finished;
}
window.stopActiveRecording = () => {
  if (recording) stopRecording();
};
document.addEventListener("visibilitychange", () => {
  if (document.hidden) window.stopActiveRecording();
});
async function action(a, v) {
  if (a.startsWith("ar")) {
    await archiveAction(a, v);
    return;
  }
  if (a.startsWith("org")) {
    await organizerAction(a, v);
    return;
  }
  switch (a) {
    case "tab":
      if (editing && !(await leaveEditor())) return;
      tab = v;
      break;
    case "exit":
      if (!(await leaveEditor())) return;
      break;
    case "openPage":
      await openPage(v);
      return;
    case "create":
      await newPage(v);
      return;
    case "taskMode":
      taskMode = v;
      break;
    case "reset":
      filters = { q: "", company: "", dept: "", area: "", topic: "" };
      break;
    case "more": {
      const n = note();
      pop(
        "<h2>" +
          t("more") +
          "</h2>" +
          button("pin", t(n.pin ? "unpin" : "pin"), "pin", "rowbtn") +
          button("orgMove", t("moveMeeting"), "folder", "rowbtn") +
          button("share", t("share"), "share", "rowbtn") +
          button("askDelete", t("arToBin"), "bin", "rowbtn") +
          button("close", t("close"), "", "soft"),
      );
      return;
    }
    case "pin":
      note().pin = !note().pin;
      await persist(note());
      closePop();
      break;
    case "askDelete":
      ask("arDiscard", "deletePage", editing);
      return;
    case "deletePage":
      await discardMeeting(v);
      return;
    case "record":
      if (recording || starting) return;
      pop(
        "<h2>" +
          t("consentTitle") +
          "</h2><p>" +
          t("consent") +
          '</p><div class="actions tools">' +
          button("startRec", t("startRec"), "mic", "primary") +
          button("close", t("cancel"), "", "quiet") +
          "</div>",
      );
      return;
    case "startRec":
      await beginRecording();
      return;
    case "stop":
      await stopRecording();
      return;
    case "retryAudio":
      if (unsavedAudio) await saveClip(unsavedAudio);
      break;
    case "askDeleteAudio":
      ask("deleteAudio", "deleteAudio", v);
      return;
    case "deleteAudio":
      await transaction(["audio"], (tx) => tx.objectStore("audio").delete(v));
      closePop();
      await refreshClips(editing);
      return;
    case "addTask":
      taskDialog();
      return;
    case "editTask":
      taskDialog(note().tasks.find((o) => o.id === v));
      return;
    case "askDeleteTask":
      ask("deleteTask", "deleteTask", v);
      return;
    case "deleteTask":
      note().tasks = note().tasks.filter((o) => o.id !== v);
      await persist(note());
      closePop();
      break;
    case "toggle": {
      const [nid, tid] = v.split("/"),
        n = byId(nid),
        o = n.tasks.find((x) => x.id === tid);
      o.done = !o.done;
      await persist(n);
      render();
      return;
    }
    case "share":
      pop(
        "<h2>" +
          t("share") +
          "</h2><p>" +
          t("shareDesc") +
          '</p><div class="actions tools">' +
          button("shareNow", t("share"), "share", "primary") +
          button("close", t("cancel"), "", "quiet") +
          "</div>",
      );
      return;
    case "shareNow": {
      const n = note(),
        text = plain(n);
      closePop();
      if (window.Device) Device.shareText(title(n), text);
      else {
        const url = URL.createObjectURL(
          new Blob([text], { type: "text/plain" }),
        );
        const a = document.createElement("a");
        a.href = url;
        a.download = "Notiert-" + n.date + ".txt";
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      }
      return;
    }
  }
  navigate();
}
window.appBack = () => {
  if ($("#dialog").open) {
    closePop();
    return true;
  }
  if (editing) {
    action("exit").catch(() => notify(t("error")));
    return true;
  }
  if (tab === "book" && librarySearch.query) {
    resetHomeSearch();
    render();
    return true;
  }
  if (tab === "book" && (homeFolder || homeCategory)) {
    if (homeCategory) homeCategory = "";
    else homeFolder = folderOf(homeFolder)?.parent || "";
    navigate();
    return true;
  }
  if (tab !== "book") {
    action("tab", "book");
    return true;
  }
  return false;
};
(async () => {
  try {
    db = await openDatabase();
    await reloadNotebook();
    render();
  } catch (e) {
    $("#screen").textContent = t("error");
  }
})();
