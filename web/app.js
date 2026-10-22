/* SmartAttend web app — students, lecturers and admins. Talks to one API endpoint (config.js). */
(function () {
"use strict";
const API = window.SMARTATTEND_API;
const WA = window.SimpleWebAuthnBrowser;
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DSHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const view = $("#view");
let ME = null, poll = null;

/* ---------- storage, api, small ui helpers ---------- */
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
};
async function api(action, body = {}) {
  const t = store.get("sa.token");
  let r;
  try {
    r = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json", ...(t ? { Authorization: "Bearer " + t } : {}) }, body: JSON.stringify({ action, ...body }) });
  } catch { throw Object.assign(new Error("No internet connection. Check your data or Wi-Fi and try again."), { offline: true }); }
  const data = await r.json().catch(() => ({}));
  if (r.status === 401 && action !== "login") { store.set("sa.token", null); ME = null; location.hash = "#/"; }
  if (!r.ok) throw Object.assign(new Error(data.error || "Something went wrong."), { data, status: r.status });
  return data;
}
function toast(m) { const t = $("#toast"); t.textContent = m; t.hidden = false; clearTimeout(toast._); toast._ = setTimeout(() => (t.hidden = true), 3200); }
function sheet(html) { $("#sheet").innerHTML = html; $("#sheetBack").hidden = false; return $("#sheet"); }
function closeSheet() { $("#sheetBack").hidden = true; $("#sheet").innerHTML = ""; }
$("#sheetBack").addEventListener("click", (e) => { if (e.target.id === "sheetBack" && !$("#sheet").dataset.lock) closeSheet(); });
function busy(btn, on, label) { if (!btn) return; if (on) { btn.dataset.l = btn.innerHTML; btn.disabled = true; btn.innerHTML = `<span class="spin"></span> ${esc(label || "Working…")}`; } else { btn.disabled = false; if (btn.dataset.l) btn.innerHTML = btn.dataset.l; } }
const pad2 = (n) => String(n).padStart(2, "0");
// Everything shown is 12-hour, the way the timetable sheets people read are printed.
function t12(hhmm) {
  const [h, m] = String(hhmm || "").split(":").map(Number);
  if (!Number.isFinite(h)) return String(hhmm || "");
  return `${h % 12 || 12}:${pad2(Number.isFinite(m) ? m : 0)} ${h >= 12 ? "pm" : "am"}`;
}
const hm = (t) => {
  if (!t) return "—";
  const d = new Date(t); if (isNaN(d.getTime())) return "—";
  return t12(`${pad2(d.getHours())}:${pad2(d.getMinutes())}`);
};
const dt = (t) => {
  const d = new Date(t); if (isNaN(d.getTime())) return "—";
  return `${d.toLocaleDateString([], { weekday: "short", day: "2-digit", month: "short" })} · ${hm(d)}`;
};
/* ---------- campus clock ----------
   One clock in the header, always Kampala time: every rule in the app runs on
   Kampala time, so a phone set to another zone must not see a different clock.
   It takes its offset from the server once, then ticks locally. */
const kampalaFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Kampala", hour: "numeric", minute: "2-digit", hour12: true });
let clockSkew = 0, clockStarted = false;
function paintClock() {
  const el = document.getElementById("clock");
  if (el) el.textContent = kampalaFmt.format(new Date(Date.now() + clockSkew)).replace(/\s?(am|pm)/i, (m) => m.toLowerCase());
}
function startClock() {
  if (clockStarted) return;
  clockStarted = true;
  paintClock();
  setInterval(paintClock, 10000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) paintClock(); });
  api("ping").then((r) => { const t = Date.parse(r.time); if (!isNaN(t)) { clockSkew = t - Date.now(); paintClock(); } }).catch(() => {});
}
const pct = (a, b) => (b ? Math.round((100 * a) / b) : 0);
const slotText = (s) => (s || []).map((x) => `${DSHORT[x.weekday]} ${t12(x.start)}–${t12(x.end)}`).join(" · ") || "No timetable";
async function copy(text) { try { await navigator.clipboard.writeText(text); toast("Copied"); } catch { toast(text); } }
function stopPoll() { clearInterval(poll); poll = null; }
function addPasswordToggle(input) {
  if (!input || input.dataset.toggleReady) return;
  input.dataset.toggleReady = "true";
  const field = document.createElement("span"); field.className = "password-field";
  input.parentNode.insertBefore(field, input); field.append(input);
  const toggle = document.createElement("button"); toggle.type = "button"; toggle.className = "password-toggle";
  toggle.textContent = "Show"; toggle.setAttribute("aria-label", "Show password"); toggle.setAttribute("aria-pressed", "false");
  toggle.addEventListener("click", () => {
    const reveal = input.type === "password";
    input.type = reveal ? "text" : "password";
    toggle.textContent = reveal ? "Hide" : "Show";
    toggle.setAttribute("aria-label", reveal ? "Hide password" : "Show password");
    toggle.setAttribute("aria-pressed", String(reveal)); input.focus();
  });
  field.append(toggle);
}
function every(ms, fn) { stopPoll(); poll = setInterval(() => { if (!document.hidden && $("#sheetBack").hidden) fn(); }, ms); }

/* ---------- location ---------- */
function getLocation() {
  return new Promise((res, rej) => {
    if (!navigator.geolocation) return rej(new Error("This browser can't read your location."));
    navigator.geolocation.getCurrentPosition(
      (p) => res({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }),
      (e) => rej(new Error(e.code === 1 ? "Location is blocked for this site. Allow location in your browser settings, then try again." : "Your location couldn't be found. Turn on location (GPS) and try again.")),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
  });
}
function deviceLabel() {
  const ua = navigator.userAgent;
  const m = ua.match(/Android [\d.]+; ([^;)]+)/) || ua.match(/(iPhone|iPad)/);
  return (m ? m[1].replace(/Build.*/, "").trim() : /Windows/.test(ua) ? "Windows device" : /Mac/.test(ua) ? "Mac" : "Phone").slice(0, 60);
}

/* RESTORED_PARTIAL - FULL FILE CONTINUES BELOW VIA SECOND PUSH */
})}