"use strict";
const $ = (selector, parent = document) => parent.querySelector(selector);
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (ch) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        ch
      ],
  );
const codes = ["en", "de", "tr", "es"];
const names = { en: "English", de: "Deutsch", tr: "Türkçe", es: "Español" };
let ui = localStorage.getItem("interface") || "en";
if (!codes.includes(ui)) ui = "en";
const t = (key) => strings[key][codes.indexOf(ui)];
const paths = {
  book: "M3 4q5-2 9 1 4-3 9-1v15q-5-2-9 1-4-3-9-1z M12 5v15",
  globe:
    "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M3 12h18 M12 3q-8 9 0 18 8-9 0-18",
  pen: "m4 16-1 5 5-1L20 8l-4-4z M14 6l4 4",
  repeat:
    "M4 10a8 8 0 0 1 14-4l2 2 M20 3v5h-5 M20 14a8 8 0 0 1-14 4l-2-2 M4 21v-5h5",
  arrow: "M4 12h15 M13 6l6 6-6 6",
  back: "M20 12H5 M11 6l-6 6 6 6",
  settings: "M4 7h7m4 0h5 M4 17h2m4 0h10 M11 4v6 M7 14v6",
  volume: "M3 9h4l5-4v14l-5-4H3z M15 8q4 4 0 8 M18 5q7 7 0 14",
  check: "m4 12 5 5L20 6",
  list: "M8 6h12 M8 12h12 M8 18h12 M3 6h1 M3 12h1 M3 18h1",
  tasks: "m3 7 2 2 4-5 M12 7h9 m-18 9 2 2 4-5 M12 16h9",
  mic: "M9 5a3 3 0 0 1 6 0v6a3 3 0 0 1-6 0z M5 11a7 7 0 0 0 14 0 M12 18v3 M8 21h8",
  plus: "M12 4v16 M4 12h16",
  search: "M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0 M15 15l6 6",
  folder: "M3 6h6l2 3h10v11H3z",
  clock: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M12 6v6l4 2",
  share: "M12 15V3 m-5 5 5-5 5 5 M5 13v7h14v-7",
  x: "m5 5 14 14 M19 5 5 19",
  next: "m9 5 7 7-7 7",
  layers: "m3 8 9-5 9 5-9 5z M3 12l9 5 9-5 M3 16l9 5 9-5",
  bin: "M4 6h16 M8 6V3h8v3 M6 6l1 15h10l1-15",
  tag: "m3 4 8-1 10 10-8 8L3 11z M7 7h1",
  pin: "M7 3h10l-2 7 3 4H6l3-4z M12 14v7",
  stop: "M6 6h12v12H6z",
};
const icon = (key) =>
  '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="' +
  paths[key] +
  '"/></svg>';
const button = (action, label, ic = "", cls = "", val = "") =>
  '<button class="' +
  cls +
  '" data-act="' +
  esc(action) +
  '" data-val="' +
  esc(val) +
  '">' +
  (ic ? icon(ic) : "") +
  "<span>" +
  esc(label) +
  "</span></button>";
const option = (value, label, current) =>
  '<option value="' +
  esc(value) +
  '"' +
  (value === current ? " selected" : "") +
  ">" +
  esc(label) +
  "</option>";
const field = (label, html) =>
  '<label class="field"><span>' + esc(label) + "</span>" + html + "</label>";
const day = (d = new Date()) =>
  [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
const fmt = (value) =>
  new Intl.DateTimeFormat(ui, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value.length === 10 ? value + "T12:00:00" : value));
function head(name, tabs, active) {
  document.documentElement.lang = ui;
  $("#top").innerHTML =
    '<div class="brand"><span class="mark">' +
    icon("book") +
    "</span>" +
    esc(name) +
    "</div>" +
    button("ui", names[ui], "globe", "quiet");
  $("#nav").innerHTML = tabs
    .map(([key, ic]) =>
      button("tab", t(key), ic, key === active ? "on" : "", key),
    )
    .join("");
}
function pop(html) {
  const d = $("#dialog");
  d.innerHTML = html;
  if (!d.open) d.showModal();
}
function closePop() {
  const d = $("#dialog");
  if (d.open) d.close();
}
function languagePicker() {
  pop(
    "<h2>" +
      t("interface") +
      "</h2>" +
      codes
        .map((code) =>
          button(
            "setui",
            names[code],
            code === ui ? "check" : "",
            "rowbtn",
            code,
          ),
        )
        .join("") +
      button("close", t("close"), "", "soft"),
  );
}
let toastTimer;
function notify(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 3800);
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("button[data-act]");
  if (!b || b.disabled) return;
  const a = b.dataset.act,
    v = b.dataset.val;
  if (a === "close") {
    closePop();
    return;
  }
  if (a === "ui") {
    languagePicker();
    return;
  }
  if (a === "setui") {
    ui = v;
    localStorage.setItem("interface", v);
    closePop();
    render();
    return;
  }
  Promise.resolve(action(a, v, b)).catch((err) => {
    console.error(err);
    notify(t("error"));
  });
});
function navigate() {
  render();
  $("#screen").scrollTop = 0;
}
