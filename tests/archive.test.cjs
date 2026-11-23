const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { createContext, runInContext } = require("node:vm");
const { webcrypto } = require("node:crypto");

function notebook() {
  const fixture = {
    pages: [
      {
        id: "meeting",
        type: "blank",
        title: "Shift",
        body: "Notes",
        decisions: "",
        company: "",
        dept: "",
        area: "",
        topic: "",
        participants: "",
        updated: 1,
        date: "2027-12-31",
        folder: "incoming",
        tasks: [],
      },
    ],
    folders: [
      { id: "incoming", name: "Production", parent: "", key: "production" },
    ],
    templates: [],
    audio: [
      {
        id: "clip",
        page: "meeting",
        seconds: 3,
        created: 1,
        blob: new Blob([new Uint8Array(1024 * 1024 + 7)], {
          type: "audio/webm",
        }),
      },
    ],
  };
  const context = createContext({
    Blob,
    TextEncoder,
    TextDecoder,
    crypto: webcrypto,
    fixture,
    window: {},
    document: { querySelector: () => ({ addEventListener() {} }) },
  });
  for (const file of ["ui.js", "archive.js"]) {
    if (file === "ui.js")
      Object.assign(context, {
        localStorage: { getItem: () => "en" },
        document: { ...context.document, addEventListener() {} },
      });
    runInContext(
      readFileSync(resolve(__dirname, "../app/src/main/assets", file), "utf8"),
      context,
    );
  }
  runInContext(
    "const outlines = {}; readNotebook = async () => fixture",
    context,
  );
  return context;
}

test("audio round-trip and rejection of altered or truncated files", async () => {
  const ctx = notebook();
  ctx.saved = await ctx.buildArchive();
  const data = await ctx.decodeArchive(ctx.saved);
  assert.equal(data.audio[0].hashes.length, 2);
  assert.deepEqual(
    Buffer.from(await data.audio[0].blob.arrayBuffer()),
    Buffer.from(await ctx.fixture.audio[0].blob.arrayBuffer()),
  );
  const bytes = new Uint8Array(await ctx.saved.arrayBuffer());
  for (const position of [1, 45, bytes.length - 1]) {
    const bad = bytes.slice();
    bad[position] ^= 1;
    await assert.rejects(ctx.decodeArchive(new Blob([bad])));
  }
  await assert.rejects(ctx.decodeArchive(ctx.saved.slice(0, -1)));
});

test("reuse an existing folder and preserve a newer version on re-import", async () => {
  const ctx = notebook(),
    data = await ctx.decodeArchive(await ctx.buildArchive());
  const local = {
    pages: [],
    audio: [],
    templates: [],
    folders: [{ ...ctx.fixture.folders[0], id: "local" }],
  };
  const first = ctx.mergePlan(data, local);
  assert.equal(first.pages[0].folder, "local");
  assert.equal(first.folders.length, 0);
  local.pages.push({ ...first.pages[0], title: "Updated locally" });
  local.audio.push(...first.audio);
  assert.equal(ctx.mergePlan(data, local).pages.length, 0);
  assert.equal(ctx.mergePlan(data, local).audio.length, 0);
  assert.equal(local.pages[0].title, "Updated locally");
  data.folders[0].parent = data.folders[0].id;
  assert.throws(() => ctx.validateIndex(data));
});
