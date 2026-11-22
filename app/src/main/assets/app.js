"use strict";
const tabs = [
  ["book", "book"],
  ["browse", "folder"],
  ["tasks", "tasks"],
  ["settings", "settings"],
];
const templates = {
  blank: [],
  handover: ["completed", "pending"],
  walk: ["location", "observations"],
  assessment: ["location", "observations", "existing"],
  client: ["requests", "pending"],
};
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
  [n.company, n.dept, n.area, ...tags(n.topic)].filter(Boolean).join(" · ");
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
    const req = indexedDB.open("notiert.workbook", 1);
    req.onupgradeneeded = () => {
      const database = req.result;
      database.createObjectStore("pages", { keyPath: "id" });
      database
        .createObjectStore("audio", { keyPath: "id" })
        .createIndex("page", "page");
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
  const sections = templates[kind] || [],
    n = {
      id: uid(),
      title: "",
      type: kind,
      date: day(),
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
      body: sections.map((k) => t(k) + "\n").join("\n"),
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
  if (isNew) $("#title")?.focus();
}
function pageRow(n) {
  return (
    '<button class="item" data-act="openPage" data-val="' +
    n.id +
    '"><span class="listicon">' +
    icon(n.pin ? "pin" : "book") +
    '</span><span class="grow">' +
    esc(title(n)) +
    "<small>" +
    esc([fmt(n.date), desc(n)].filter(Boolean).join(" · ")) +
    "</small></span>" +
    icon("next") +
    "</button>"
  );
}
function book() {
  const list = sorted(notes);
  return (
    "<h1>" +
    t("meetings") +
    '</h1><div class="cover"><span class="meta">' +
    esc(fmt(day())) +
    "</span><h2>" +
    t("startPage") +
    "</h2>" +
    button("create", t("new"), "plus", "primary", "blank") +
    "</div><h2>" +
    t("recent") +
    "</h2>" +
    (list.length
      ? list.slice(0, 6).map(pageRow).join("")
      : '<p class="muted">' + t("empty") + "</p>") +
    '<section class="section"><h2>' +
    t("templates") +
    '</h2><div class="templates">' +
    Object.keys(templates)
      .filter((k) => k !== "blank")
      .map((k) => button("create", t(k), "pen", "template", k))
      .join("") +
    "</div></section>"
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
  const needle = filters.q.trim().toLocaleLowerCase(ui);
  return sorted(
    notes.filter(
      (n) =>
        ["company", "dept", "area"].every(
          (k) => !filters[k] || n[k].trim() === filters[k],
        ) &&
        (!filters.topic || tags(n.topic).includes(filters.topic)) &&
        (!needle ||
          [
            title(n),
            desc(n),
            n.participants,
            n.body,
            n.decisions,
            ...n.tasks.flatMap((o) => [o.text, o.owner]),
          ]
            .join(" ")
            .toLocaleLowerCase(ui)
            .includes(needle)),
    ),
  );
}
function found() {
  let list = filtered();
  return list.length
    ? list.map(pageRow).join("")
    : '<p class="muted">' + t("none") + "</p>";
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
    field(
      t("title"),
      textInput(
        "title",
        n,
        'class="page-title" placeholder="' + t("untitled") + '"',
      ),
    ) +
    '<span class="bookdate" id="pageDate">' +
    esc(fmt(n.date)) +
    '</span><p class="meta" id="pageTrail">' +
    esc(desc(n)) +
    "</p>" +
    '<details id="metadata" class="notemeta"' +
    (detailsOpen ? " open" : "") +
    "><summary>" +
    t("details") +
    "</summary>" +
    field(t("date"), textInput("date", n, 'type="date" required')) +
    '<div class="grid">' +
    ["company", "dept", "area"].map((k) => dataField(k, n)).join("") +
    field(
      t("topic"),
      textInput("topic", n, 'placeholder="' + t("tagsHint") + '"'),
    ) +
    "</div>" +
    field(t("participants"), textInput("participants", n)) +
    "</details>" +
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
      button(action, t("delete"), "bin", "danger", id) +
      button("close", t("cancel"), "", "quiet") +
      "</div>",
  );
}
function plain(n) {
  return [
    title(n),
    fmt(n.date),
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
    : { book, browse: indexView, tasks: tasksView, settings: settingsView }[
        tab
      ]();
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
        if (k === "date" && !e.value) return;
        n[k] = e.value;
        if (["company", "dept", "area", "topic", "date"].includes(k)) {
          $("#pageDate").textContent = fmt(n.date);
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
          button("share", t("share"), "share", "rowbtn") +
          button("askDelete", t("delete"), "bin", "rowbtn") +
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
      ask("deleteMeeting", "deletePage", editing);
      return;
    case "deletePage": {
      if (recording) await stopRecording();
      ++startToken;
      const id = editing;
      await transaction(["pages", "audio"], (tx) => {
        tx.objectStore("pages").delete(id);
        const store = tx.objectStore("audio");
        store.index("page").openKeyCursor(IDBKeyRange.only(id)).onsuccess = (
          e,
        ) => {
          const c = e.target.result;
          if (c) {
            store.delete(c.primaryKey);
            c.continue();
          }
        };
      });
      notes = notes.filter((n) => n.id !== id);
      dirty.delete(id);
      unsavedAudio = null;
      clearClips();
      editing = null;
      closePop();
      break;
    }
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
  if (tab !== "book") {
    action("tab", "book");
    return true;
  }
  return false;
};
(async () => {
  try {
    db = await openDatabase();
    notes = await query(db.transaction("pages").objectStore("pages").getAll());
    render();
  } catch (e) {
    $("#screen").textContent = t("error");
  }
})();
