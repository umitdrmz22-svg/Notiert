"use strict";
/* NTBOOK01 + LE manifest length + SHA-256 of UTF-8 manifest + manifest + raw audio.
   The digest of every 1 MiB audio block lives inside the checksummed manifest. */
const archiveStores = ["pages", "folders", "templates", "audio"];
const blockBytes = 1024 * 1024,
  headerBytes = 44;
const encoder = new TextEncoder(),
  decoder = new TextDecoder("utf-8", { fatal: true });
let discarded = [],
  incoming = null,
  archiveBusy = false,
  saveRequest = null;
function requireArchive(ok) {
  if (!ok) throw new Error("Invalid notebook archive");
}
const digest = async (bytes) =>
  new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
const hex = (bytes) =>
  Array.from(bytes, (x) => x.toString(16).padStart(2, "0")).join("");
async function clipHashes(blob) {
  const list = [];
  for (let i = 0; i < blob.size; i += blockBytes)
    list.push(
      hex(await digest(await blob.slice(i, i + blockBytes).arrayBuffer())),
    );
  return list;
}
async function readNotebook() {
  const tx = db.transaction(archiveStores);
  const values = await Promise.all(
    archiveStores.map((k) => query(tx.objectStore(k).getAll())),
  );
  return Object.fromEntries(archiveStores.map((k, i) => [k, values[i]]));
}
async function reloadNotebook() {
  const tx = db.transaction(["pages", "folders", "templates"]);
  const [pages, allFolders, allTemplates] = await Promise.all(
    ["pages", "folders", "templates"].map((k) =>
      query(tx.objectStore(k).getAll()),
    ),
  );
  notes = pages.filter((n) => !n.trashedAt);
  discarded = pages.filter((n) => n.trashedAt);
  folders = allFolders;
  customTemplates = allTemplates;
}
async function buildArchive() {
  const all = await readNotebook(),
    pages = all.pages.filter((n) => !n.trashedAt),
    ids = new Set(pages.map((n) => n.id)),
    audio = [],
    blobs = [];
  for (const { blob, id, page, seconds, created } of all.audio) {
    if (!ids.has(page)) continue;
    audio.push({
      id,
      page,
      seconds,
      created,
      type: blob.type || "application/octet-stream",
      size: blob.size,
      hashes: await clipHashes(blob),
    });
    blobs.push(blob);
  }
  const meta = encoder.encode(
    JSON.stringify({
      version: 1,
      created: Date.now(),
      pages,
      folders: all.folders,
      templates: all.templates,
      audio,
    }),
  );
  requireArchive(meta.byteLength <= maxIndex);
  const header = new Uint8Array(headerBytes);
  header.set(encoder.encode("NTBOOK01"));
  new DataView(header.buffer).setUint32(8, meta.length, true);
  header.set(await digest(meta), 12);
  return new Blob([header, meta, ...blobs], {
    type: "application/octet-stream",
  });
}
const maxIndex = 64 * 1024 * 1024;
const validId = (x) =>
  typeof x === "string" && /^[A-Za-z0-9_-]{1,180}$/.test(x);
const real = (x) => Number.isFinite(x) && x >= 0;
const validDate = (x) =>
  typeof x === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(x) &&
  day(new Date(x + "T12:00:00")) === x;
const texts = (o, keys) => keys.every((k) => typeof o[k] === "string");
function uniqueList(rows) {
  requireArchive(Array.isArray(rows));
  const ids = new Set();
  for (const row of rows) {
    requireArchive(row && validId(row.id) && !ids.has(row.id));
    ids.add(row.id);
  }
  return ids;
}
function validateIndex(m) {
  requireArchive(m && m.version === 1 && real(m.created));
  const fid = uniqueList(m.folders),
    pid = uniqueList(m.pages),
    tid = uniqueList(m.templates);
  uniqueList(m.audio);
  const parents = new Map(),
    siblings = new Map();
  for (const f of m.folders) {
    requireArchive(
      texts(f, ["parent", "name"]) &&
        f.name.trim() &&
        (f.parent === "" || fid.has(f.parent)),
    );
    f.key = f.name.trim().toLocaleLowerCase();
    const key = JSON.stringify([f.parent, f.key]);
    requireArchive(!siblings.has(key));
    siblings.set(key, true);
    parents.set(f.id, f.parent);
  }
  const done = new Set();
  for (const f of m.folders) {
    let id = f.id;
    const chain = new Set();
    while (id && !done.has(id)) {
      requireArchive(!chain.has(id));
      chain.add(id);
      id = parents.get(id);
    }
    for (const item of chain) done.add(item);
  }
  for (const t of m.templates)
    requireArchive(
      t.id.startsWith("custom-") &&
        texts(t, ["name"]) &&
        Array.isArray(t.fields) &&
        t.fields.every((k) => typeof k === "string"),
    );
  for (const n of m.pages) {
    requireArchive(
      texts(n, [
        "title",
        "body",
        "decisions",
        "participants",
        "company",
        "dept",
        "area",
        "topic",
        "type",
      ]) &&
        (n.type === "blank" ||
          Object.hasOwn(outlines, n.type) ||
          tid.has(n.type)) &&
        validDate(n.date) &&
        real(n.updated) &&
        (n.folder === undefined || n.folder === "" || fid.has(n.folder)) &&
        !n.trashedAt &&
        (n.sections === undefined ||
          (Array.isArray(n.sections) &&
            n.sections.every((s) => s && texts(s, ["label", "value"])))) &&
        [n.startTime, n.endTime].every(
          (x) =>
            x === undefined || x === "" || /^([01]\d|2[0-3]):[0-5]\d$/.test(x),
        ) &&
        (!n.followDate || validDate(n.followDate)),
    );
    uniqueList(n.tasks);
    for (const o of n.tasks)
      requireArchive(
        texts(o, ["text", "owner", "due"]) &&
          typeof o.done === "boolean" &&
          (!o.due || validDate(o.due)),
      );
  }
  for (const a of m.audio)
    requireArchive(
      pid.has(a.page) &&
        real(a.created) &&
        real(a.seconds) &&
        typeof a.type === "string" &&
        /^(?:audio\/[a-z0-9+._-]+|video\/(?:webm|mp4)|application\/octet-stream)(?:;[a-z0-9="' .,;_-]+)?$/i.test(
          a.type,
        ) &&
        Number.isSafeInteger(a.size) &&
        a.size > 0 &&
        Array.isArray(a.hashes) &&
        a.hashes.length === Math.ceil(a.size / blockBytes) &&
        a.hashes.every((h) => /^[0-9a-f]{64}$/.test(h)),
    );
}
async function decodeArchive(file) {
  requireArchive(file.size >= headerBytes);
  const header = new Uint8Array(await file.slice(0, headerBytes).arrayBuffer()),
    length = new DataView(header.buffer).getUint32(8, true);
  requireArchive(
    decoder.decode(header.slice(0, 8)) === "NTBOOK01" &&
      length <= maxIndex &&
      file.size >= headerBytes + length,
  );
  const raw = await file.slice(headerBytes, headerBytes + length).arrayBuffer();
  requireArchive(hex(await digest(raw)) === hex(header.slice(12)));
  const data = JSON.parse(decoder.decode(raw));
  validateIndex(data);
  let pos = headerBytes + length;
  for (const a of data.audio) {
    requireArchive(a.size <= file.size - pos);
    a.blob = file.slice(pos, pos + a.size, a.type);
    pos += a.size;
    const actual = await clipHashes(a.blob);
    requireArchive(actual.every((v, i) => v === a.hashes[i]));
  }
  requireArchive(pos === file.size);
  return data;
}
// Build and apply the merge against one database snapshot. Existing identities win.
function mergePlan(data, local) {
  const add = { folders: [], templates: [], pages: [], audio: [] };
  const foldersById = new Map(local.folders.map((f) => [f.id, f]));
  const nameKey = (parent, name) =>
    JSON.stringify([parent, name.trim().toLocaleLowerCase()]);
  const byName = new Map(
    local.folders.map((f) => [nameKey(f.parent, f.name), f.id]),
  );
  const children = new Map();
  for (const f of data.folders) {
    if (!children.has(f.parent)) children.set(f.parent, []);
    children.get(f.parent).push(f);
  }
  const mapped = new Map([["", ""]]),
    parents = [""];
  for (let i = 0; i < parents.length; i++) {
    const parent = parents[i];
    for (const f of children.get(parent) || []) {
      const dest = mapped.get(parent),
        key = nameKey(dest, f.name),
        id = foldersById.has(f.id) ? f.id : byName.get(key) || f.id;
      mapped.set(f.id, id);
      parents.push(f.id);
      if (!foldersById.has(id)) {
        const copy = {
          ...f,
          parent: dest,
          key: f.name.trim().toLocaleLowerCase(),
        };
        add.folders.push(copy);
        foldersById.set(id, copy);
        byName.set(key, id);
      }
    }
  }
  for (const k of ["templates", "pages", "audio"]) {
    const existing = new Set(local[k].map((x) => x.id));
    for (const item of data[k]) {
      if (existing.has(item.id)) continue;
      if (k === "pages")
        add.pages.push({ ...item, folder: mapped.get(item.folder || "") });
      else if (k === "audio")
        add.audio.push({
          id: item.id,
          page: item.page,
          seconds: item.seconds,
          created: item.created,
          blob: item.blob,
        });
      else add.templates.push(item);
    }
  }
  return add;
}
function importArchive(data) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(archiveStores, "readwrite"),
      local = {};
    let pending = archiveStores.length,
      result;
    tx.oncomplete = () => resolve(result);
    tx.onabort = () => reject(tx.error || new Error("Import interrupted"));
    for (const k of archiveStores) {
      const req = tx.objectStore(k).getAll();
      req.onsuccess = () => {
        local[k] = req.result;
        if (--pending) return;
        try {
          result = mergePlan(data, local);
          for (const name of archiveStores)
            for (const item of result[name]) tx.objectStore(name).add(item);
        } catch {
          tx.abort();
        }
      };
    }
  });
}
function archiveCounts(source) {
  return (
    '<div class="archivecounts">' +
    [
      ["pages", "book"],
      ["folders", "folders"],
      ["templates", "templateLibrary"],
      ["audio", "voice"],
    ]
      .map(
        ([key, label]) =>
          "<div><b>" +
          source[key].length +
          "</b><span>" +
          t(key === "pages" ? "arMeetings" : label) +
          "</span></div>",
      )
      .join("") +
    "</div>"
  );
}
function archiveSettings() {
  return (
    '<section class="vault"><h2>' +
    t("arTitle") +
    "</h2><p>" +
    t("arInfo") +
    '</p><div class="actions">' +
    button("arExport", t("arSave"), "folder", "primary") +
    button("arOpen", t("arOpen"), "book", "soft") +
    '</div><input type="file" hidden id="archiveFile"></section>' +
    '<button class="item binlink" data-act="arTrash">' +
    icon("bin") +
    "<b>" +
    t("arTrash") +
    "</b><span>" +
    discarded.length +
    "</span>" +
    icon("next") +
    "</button>"
  );
}
document.querySelector("#dialog").addEventListener("close", () => {
  if (!document.querySelector("#dialog").open) incoming = null;
});
function transferProgress(msg) {
  pop("<h2>" + t("arTitle") + '</h2><p role="status">' + t(msg) + "</p>");
  const dialog = $("#dialog"),
    status = dialog.lastElementChild;
  return () => dialog.open && status.isConnected;
}
function bindArchive() {
  const input = $("#archiveFile");
  if (!input) return;
  input.onchange = async () => {
    const file = input.files[0];
    input.value = "";
    if (!file || archiveBusy) return;
    archiveBusy = true;
    incoming = null;
    const visible = transferProgress("arChecking");
    try {
      const candidate = await decodeArchive(file),
        add = mergePlan(candidate, await readNotebook());
      if (!visible()) return;
      incoming = candidate;
      pop(
        "<h2>" +
          t("arPreview") +
          "</h2><p>" +
          t("arKeep") +
          "</p>" +
          archiveCounts(add) +
          '<div class="actions">' +
          button("arImport", t("arImport"), "check", "primary") +
          button("arCancel", t("cancel"), "", "quiet") +
          "</div>",
      );
    } catch {
      if (!visible()) return;
      closePop();
      notify(t("arInvalid"));
    } finally {
      archiveBusy = false;
    }
  };
}
function blobBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result.split(",")[1]);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}
async function saveArchiveFile(blob) {
  if (!window.ArchiveDevice) {
    const url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = "Notiert-" + day() + ".notiert";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return true;
  }
  const token = uid();
  const ready = new Promise((resolve) => (saveRequest = { token, resolve }));
  try {
    ArchiveDevice.chooseDestination(
      token,
      "Notiert-" + day() + ".notiert",
      blob.size,
    );
    const status = await ready;
    if (status === "cancel") return false;
    requireArchive(status === "ready");
    for (let offset = 0; offset < blob.size; offset += 98304) {
      const chunk = await blobBase64(blob.slice(offset, offset + 98304));
      requireArchive(ArchiveDevice.append(token, chunk));
    }
    requireArchive(ArchiveDevice.finish(token));
    return true;
  } finally {
    ArchiveDevice.release(token);
    saveRequest = null;
  }
}
window.archiveDestination = (token, status) => {
  if (saveRequest?.token === token) saveRequest.resolve(status);
};
function trashView() {
  pop(
    "<h2>" +
      t("arTrash") +
      "</h2><p>" +
      t("arTrashHelp") +
      "</p>" +
      discarded
        .slice()
        .sort((a, b) => b.trashedAt - a.trashedAt)
        .map(
          (n) =>
            '<article class="trashentry"><b>' +
            esc(title(n)) +
            "</b><small>" +
            esc(
              [fmt(n.date), ...folderPath(n.folder).map((f) => f.name)].join(
                " · ",
              ),
            ) +
            '</small><div class="actions">' +
            button("arRestore", t("arRestore"), "repeat", "soft", n.id) +
            button("arPurgeAsk", t("arPurge"), "bin", "quiet", n.id) +
            "</div></article>",
        )
        .join("") +
      (discarded.length ? "" : '<p class="muted">' + t("arEmpty") + "</p>") +
      button("close", t("close"), "", "soft"),
  );
}
async function discardMeeting(id) {
  if (editing !== id || !id) return;
  const n = note();
  if (!(await leaveEditor())) return;
  try {
    await transaction(["pages"], (tx) =>
      tx.objectStore("pages").put({ ...n, trashedAt: Date.now() }),
    );
  } catch (error) {
    await openPage(id);
    throw error;
  }
  await reloadNotebook();
  closePop();
  navigate();
  notify(t("arMoved"));
}
async function archiveAction(a, v) {
  if (archiveBusy) return;
  if (a === "arOpen") {
    incoming = null;
    $("#archiveFile").click();
    return;
  }
  if (a === "arCancel") {
    incoming = null;
    closePop();
    return;
  }
  if (a === "arTrash") {
    trashView();
    return;
  }
  if (a === "arRestore" || a === "arPurgeAsk" || a === "arPurge") {
    const n = discarded.find((x) => x.id === v);
    if (!n) return;
    if (a === "arPurgeAsk") {
      pop(
        "<h2>" +
          esc(title(n)) +
          "</h2><p>" +
          t("arPurgeHelp") +
          "</p>" +
          button("arPurge", t("arPurge"), "bin", "danger", v) +
          button("arTrash", t("cancel"), "", "quiet"),
      );
      return;
    }
    if (a === "arRestore") {
      const restored = { ...n };
      delete restored.trashedAt;
      await transaction(["pages"], (tx) =>
        tx.objectStore("pages").put(restored),
      );
    } else
      await transaction(["pages", "audio"], (tx) => {
        tx.objectStore("pages").delete(v);
        const audio = tx.objectStore("audio"),
          cursor = audio.index("page").openKeyCursor(IDBKeyRange.only(v));
        cursor.onsuccess = () => {
          const c = cursor.result;
          if (c) {
            audio.delete(c.primaryKey);
            c.continue();
          }
        };
      });
    await reloadNotebook();
    render();
    trashView();
    return;
  }
  archiveBusy = true;
  try {
    if (a === "arExport") {
      const visible = transferProgress("arPreparing");
      const archive = await buildArchive();
      if (!visible()) return;
      const saved = await saveArchiveFile(archive);
      if (visible()) closePop();
      if (saved) notify(t("arExported"));
    } else if (a === "arImport" && incoming) {
      const data = incoming;
      incoming = null;
      transferProgress("arChecking");
      const added = await importArchive(data);
      await reloadNotebook();
      render();
      pop(
        "<h2>" +
          t("arImported") +
          "</h2>" +
          archiveCounts(added) +
          button("close", t("close"), "", "primary"),
      );
    }
  } catch {
    closePop();
    notify(t("error"));
  } finally {
    archiveBusy = false;
  }
}
