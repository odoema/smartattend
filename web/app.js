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
const kampalaDateFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Kampala", weekday: "short", day: "2-digit", month: "short" });
const kampalaTimePartsFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Kampala", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const hm = (t) => {
  if (!t) return "—";
  const d = new Date(t); if (isNaN(d.getTime())) return "—";
  return t12(kampalaTimePartsFmt.format(d));
};
const dt = (t) => {
  const d = new Date(t); if (isNaN(d.getTime())) return "—";
  return `${kampalaDateFmt.format(d)} · ${hm(d)}`;
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

/* ---------- auth screens ---------- */
// every facilitator on the official timetables, for the lecturer sign-up dropdown
function timetableLecturers() { return [...new Set((window.SA_CATALOG?.PROGRAMMES || []).flatMap((p) => Object.values(p.courses).flatMap((c) => c.facilitators.map((f) => f.name))))].sort((a, b) => a.replace(/^(Dr|Prof|Mr|Mrs|Ms)\.?\s+/, "").localeCompare(b.replace(/^(Dr|Prof|Mr|Mrs|Ms)\.?\s+/, ""))); }
function renderForgotPassword() {
  $("#bar").hidden = true; stopPoll();
  view.innerHTML = `<section class="auth stack"><a href="#/" class="small">← Back to sign in</a><div class="card stack">
    <h1>Reset your password</h1><p class="muted">Enter the email or registration number on your account. If it matches, we’ll send a reset link.</p>
    <form id="forgotForm" class="stack" novalidate><label class="f">Email or registration number<input id="resetIdentity" autocomplete="username" required></label>
      <p class="err" id="forgotErr" role="status"></p><button class="btn primary block big" type="submit">Send reset link</button></form>
    <p class="small muted" id="forgotNotice" hidden>If an account matches, a password reset email will arrive shortly. Check your spam folder too.</p>
  </div></section>`;
  $("#forgotForm").addEventListener("submit", async (e) => {
    e.preventDefault(); const b = e.submitter || $("#forgotForm button[type=submit]"); const err = $("#forgotErr"); err.textContent = "";
    busy(b, true, "Sending…");
    try { await api("password.reset.request", { identifier: $("#resetIdentity").value.trim() }); $("#forgotNotice").hidden = false; $("#resetIdentity").disabled = true; busy(b, false); b.disabled = true; }
    catch (x) { err.textContent = x.message; busy(b, false); }
  });
}
function renderResetPassword() {
  $("#bar").hidden = true; stopPoll();
  const query = location.hash.includes("?") ? location.hash.slice(location.hash.indexOf("?") + 1) : "";
  const token = new URLSearchParams(query).get("token") || "";
  if (!token) { view.innerHTML = `<section class="auth stack"><div class="card stack"><h1>Reset link expired</h1><p class="muted">Request a new password reset link and open it within 30 minutes.</p><a class="btn primary" href="#/forgot-password">Request a new link</a></div></section>`; return; }
  view.innerHTML = `<section class="auth stack"><div class="card stack"><h1>Choose a new password</h1><form id="resetForm" class="stack" method="post" novalidate>
    <label class="f">New password<input id="newPass" type="password" autocomplete="new-password" minlength="8" required></label>
    <label class="f">Confirm new password<input id="confirmPass" type="password" autocomplete="new-password" minlength="8" required></label>
    <p class="err" id="resetErr" role="alert"></p><button class="btn primary block big" type="submit">Save new password</button></form></div></section>`;
  addPasswordToggle($("#newPass")); addPasswordToggle($("#confirmPass"));
  $("#resetForm").addEventListener("submit", async (e) => {
    e.preventDefault(); const b = e.submitter || $("#resetForm button[type=submit]"); const err = $("#resetErr"); err.textContent = "";
    const password = $("#newPass").value;
    if (password.length < 8) { err.textContent = "Use at least 8 characters for your new password."; return; }
    if (password !== $("#confirmPass").value) { err.textContent = "The passwords do not match."; return; }
    busy(b, true, "Saving…");
    try { await api("password.reset.complete", { token, password }); store.set("sa.token", null); ME = null; location.hash = "#/"; toast("Password updated. Sign in with your new password."); }
    catch (x) { err.textContent = x.message; busy(b, false); }
  });
}
function renderResetCode() {
  $("#bar").hidden = true; stopPoll();
  view.innerHTML = `<section class="auth stack"><a href="#/" class="small">← Back to sign in</a><div class="card stack">
    <h1>Enter a reset code</h1>
    <p class="muted">Your lecturer or the admin can give you a 6-digit code. It works once and expires after 15 minutes.</p>
    <form id="codeForm" class="stack" method="post" novalidate>
      <label class="f">Email or registration number<input id="rcWho" autocomplete="username" required></label>
      <label class="f">6-digit code<input id="rcCode" inputmode="numeric" maxlength="6" autocomplete="one-time-code" required></label>
      <label class="f">New password<input id="rcPass" type="password" autocomplete="new-password" minlength="8" required></label>
      <p class="err" id="rcErr"></p>
      <button class="btn primary block big" type="submit">Set new password</button>
    </form>
    <p class="small muted">No code yet? <a href="#/forgot-password">Ask for an email link instead</a>.</p>
  </div></section>`;
  addPasswordToggle($("#rcPass"));
  $("#codeForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const b = $("#codeForm button[type=submit]"); busy(b, true, "Saving…"); $("#rcErr").textContent = "";
    try {
      const r = await api("password.reset.code", { identifier: $("#rcWho").value, code: $("#rcCode").value, password: $("#rcPass").value });
      closeSheet(); store.set("sa.token", r.token); toast("Password changed. You're signed in.");
      location.hash = "#/"; await boot();
    } catch (x) { $("#rcErr").textContent = x.message; busy(b, false); }
  });
}
// The lecturer or admin creates the code and reads it out privately.
async function giveResetCode(userId, btn) {
  busy(btn, true, "Making code…");
  try {
    const r = await api("password.resetCode", { user_id: userId });
    busy(btn, false);
    const s = sheet(`<h2>Reset code for ${esc(r.name)}</h2>
      <p class="muted small">Read this to them privately. It works once and expires in ${r.minutes} minutes.</p>
      <div class="row"><span class="code-big">${esc(r.code)}</span><span class="spacer"></span><button class="btn" id="cpCode">Copy</button></div>
      <p class="small muted">They open SmartAttend → <b>Have a reset code?</b>, enter their email or registration number, this code and a new password. Every existing sign-in of theirs ends when they do.</p>
      <button class="btn ghost" id="closeCode">Close</button>`);
    $("#cpCode", s).onclick = () => copy(String(r.code));
    $("#closeCode", s).onclick = closeSheet;
  } catch (x) { busy(btn, false); toast(x.message); }
}

function renderAuth(mode = "signin", role = "student") {
  $("#bar").hidden = true; stopPoll();
  view.innerHTML = `<section class="auth auth-shell">
    <div class="auth-brand">
      <span class="logo-tile big"><img src="logo-mark.png" alt="SmartAttend logo" width="92" height="72"></span>
      <h1 class="wordmark">SmartAttend</h1>
      <p class="muted auth-tag">Class attendance that checks who you are, which phone you're on, where you are and when — in one tap and a fingerprint.</p>
    </div>
    <div class="card auth-card stack">
      <div class="seg" role="group" aria-label="Sign in or create account">
        <button data-m="signin" aria-pressed="${mode === "signin"}">Sign in</button>
        <button data-m="signup" aria-pressed="${mode === "signup"}">Create account</button>
      </div>
      <h2 class="auth-title">${mode === "signin" ? "Welcome back" : "Create your account"}</h2>
      <form id="authForm" class="stack" method="post" novalidate>
        ${mode === "signup" ? `
        <div class="stack"><span class="f" style="font-size:13px;font-weight:600;color:var(--muted)">I am a</span>
          <div class="seg" role="group" aria-label="Account type"><button type="button" data-r="student" aria-pressed="${role === "student"}">Student</button><button type="button" data-r="lecturer" aria-pressed="${role === "lecturer"}">Lecturer</button></div></div>
        ${role === "student" ? `<label class="f">Full name<input id="fName" autocomplete="name" required></label>`
          : `<label class="f">Your name<select id="fPick"><option value="">Choose your name from the timetable…</option>${timetableLecturers().map((n) => `<option>${esc(n)}</option>`).join("")}<option value="__other">My name isn't listed</option></select></label>
             <label class="f" id="fNameWrap" hidden>Full name<input id="fName" autocomplete="name" placeholder="e.g. Dr. Jane Akello"></label>`}
        ${role === "student" ? `<label class="f">Registration number<input id="fReg" autocapitalize="characters" placeholder="e.g. 2026/HD06/28758U" required></label>` : ""}
        <label class="f">Email<input id="fEmail" type="email" autocomplete="email" required></label>
        <label class="f">Password<input id="fPass" type="password" autocomplete="new-password" minlength="6" required></label>
        ${role !== "student" ? `<label class="f">Lecturer access code<input id="fCode" autocapitalize="characters" placeholder="From your ICT office" required></label>` : ""}
        ` : `
        <label class="f">Email or registration number<input id="fEmail" autocomplete="username" required></label>
        <label class="f">Password<input id="fPass" type="password" autocomplete="current-password" required></label>
        <div class="auth-links"><a href="#/forgot-password" id="forgot">Forgot password?</a><span aria-hidden="true">·</span><a href="#/reset-code">Have a reset code?</a></div>`}
        <p class="err" id="authErr"></p>
        <button class="btn primary block big" type="submit">${mode === "signup" ? "Create account" : "Sign in"}</button>
      </form>
      <p class="auth-note small muted">Only your registered phone can mark your attendance.</p>
    </div>
    <p class="small muted" style="text-align:center;grid-column:1/-1">Admin? <a href="#/admin-signup">Create an admin account</a></p>
  </section>`;
  addPasswordToggle($("#fPass"));
  $$("[data-m]").forEach((b) => b.addEventListener("click", () => renderAuth(b.dataset.m, role)));
  $$("[data-r]").forEach((b) => b.addEventListener("click", () => renderAuth("signup", b.dataset.r)));
  const fp = $("#fPick"); if (fp) fp.addEventListener("change", () => { const other = fp.value === "__other"; $("#fNameWrap").hidden = !other; $("#fName").value = other ? "" : fp.value; if (other) $("#fName").focus(); });
  $("#authForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = e.submitter || $("#authForm button[type=submit]"); const err = $("#authErr"); err.textContent = "";
    const v = (id) => ($("#" + id) ? $("#" + id).value.trim() : "");
    busy(btn, true, mode === "signup" ? "Creating account…" : "Signing in…");
    try {
      const r = mode === "signup"
        ? await api("signup", { role, full_name: v("fName"), reg_no: v("fReg"), email: v("fEmail"), password: $("#fPass").value, code: v("fCode") })
        : await api("login", { email: v("fEmail"), password: $("#fPass").value });
      store.set("sa.token", r.token); await boot();
    } catch (x) { err.textContent = x.message; busy(btn, false); }
  });
}
function renderAdminSignup() {
  $("#bar").hidden = true;
  view.innerHTML = `<section class="auth stack"><a href="#/" class="small">← Back</a><h1>Admin account</h1>
    <p class="muted small">This page creates the <b>first</b> admin only. If an admin already exists, ask them to add you from People &amp; settings.</p>
    <form id="admForm" class="card stack" novalidate>
      <label class="f">Full name<input id="aName" required></label>
      <label class="f">Email<input id="aEmail" type="email" required></label>
      <label class="f">Password<input id="aPass" type="password" minlength="6" required></label>
      <label class="f">Admin access code<input id="aCode" autocapitalize="characters" required></label>
      <p class="err" id="aErr"></p><button class="btn primary block big">Create admin account</button></form></section>`;
  addPasswordToggle($("#aPass"));
  $("#admForm").addEventListener("submit", async (e) => {
    e.preventDefault(); const b = $("#admForm button"); busy(b, true);
    try { const r = await api("signup", { role: "admin", full_name: $("#aName").value, email: $("#aEmail").value, password: $("#aPass").value, code: $("#aCode").value }); store.set("sa.token", r.token); location.hash = "#/"; await boot(); }
    catch (x) { $("#aErr").textContent = x.message; busy(b, false); }
  });
}


/* ---------- timetable awareness (Kampala time from the server) ---------- */
const toMin = (hhmm) => { const [h, m] = String(hhmm).split(":").map(Number); return h * 60 + m; };
const inText = (m) => (m < 60 ? `in ${m} min` : m < 1440 ? `in ${Math.floor(m / 60)} h ${m % 60 ? (m % 60) + " min" : ""}`.trim() : `in ${Math.round(m / 1440)} day${Math.round(m / 1440) > 1 ? "s" : ""}`);
function slotState(e, clock, live) {
  const smin = e.smin ?? toMin(e.start), emin = e.emin ?? toMin(e.end);
  if (live) return live.status === "open" ? { k: "live", label: "In session", cls: "ok" } : { k: "checkout", label: "Check-out time", cls: "warn" };
  if (e.weekday !== clock.dow) return { k: "other", label: "", cls: "mute" };
  if (clock.mins < smin - 15) return { k: "soon", label: `Starts ${inText(smin - clock.mins)}`, cls: "mute" };
  if (clock.mins <= emin) return { k: "due", label: "Due now", cls: "warn" };
  return { k: "done", label: "Finished", cls: "mute" };
}
function nextSlot(entries, clock) {
  let best = null;
  for (const e of entries) {
    const smin = e.smin ?? toMin(e.start);
    let d = ((e.weekday - clock.dow + 7) % 7) * 1440 + smin - clock.mins;
    if (d <= 0) d += 7 * 1440;
    if (!best || d < best.d) best = { e, d };
  }
  return best;
}

/* ================= STUDENT ================= */
async function studentHome() {
  let d;
  try { d = await api("student.home"); } catch (x) { view.innerHTML = `<div class="card"><p class="err">${esc(x.message)}</p><button class="btn" onclick="location.reload()">Try again</button></div>`; return; }
  const hasDevice = !!d.device, hasCourse = d.courses.length > 0;
  const setupDone = hasDevice && hasCourse;
  const first = ME.full_name.split(" ")[0];
  let liveHtml = "";
  if (setupDone) {
    if (!d.live.length) {
      const due = (d.week || []).find((e) => slotState(e, d.clock).k === "due");
      const nx = nextSlot(d.week || [], d.clock);
      liveHtml = due
        ? `<div class="card hero stack"><span class="pill warn" style="justify-self:start">Due now</span><h2>${esc(due.code)} · ${esc(due.title)}</h2><p class="muted small">${t12(due.start)}–${t12(due.end)} · ${esc(due.venue || "")}</p><p>Waiting for your lecturer to start the class. The Check in button appears here as soon as they do.</p></div>`
        : `<div class="card stack"><span class="eyebrow">Right now</span><h2>No class right now</h2>${nx ? `<p>Next: <b>${esc(nx.e.code)}</b> · ${esc(nx.e.title)}<br><span class="muted small">${DAYS[nx.e.weekday]} ${nx.e.start}–${nx.e.end} · ${esc(nx.e.venue || "")} · ${inText(nx.d)}</span></p>` : `<p class="muted">Your timetable is empty.</p>`}</div>`;
    }
    else liveHtml = d.live.map((s) => {
      let action;
      if (s.check_out_at) action = `<div class="result ok"><h2>All done</h2><p>In ${hm(s.check_in_at)} · Out ${hm(s.check_out_at)}</p></div>`;
      else if (s.check_in_at && s.status === "checkout") action = `<button class="btn primary block big" data-attend="${s.id}" data-mode="out">Check out</button>`;
      else if (s.check_in_at) action = `<div class="result ok"><h2>You're checked in</h2><p>at ${hm(s.check_in_at)}. Check out here when your lecturer ends the class.</p></div>`;
      else if (s.status === "open") action = `<button class="btn primary block big" data-attend="${s.id}" data-mode="in">Check in</button>`;
      else action = `<div class="result bad"><h2>Check-in has closed</h2><p>The lecturer has ended this class.</p></div>`;
      return `<div class="card hero stack"><div class="row"><span class="pill ${s.status === "open" ? "ok" : "warn"}"><span class="dot"></span>${s.status === "open" ? "Class in session" : "Check-out time"}</span>${s.scheduled ? "" : `<span class="pill mute">Make-up class</span>`}</div>
        <div><h2>${esc(s.code)} · ${esc(s.title)}</h2><p class="muted small">${esc(s.venue || "")} · started ${hm(s.opened_at)}${s.ends_at ? ` · ends ${hm(s.ends_at)}` : ""} · be within ${s.radius_m} m</p></div>${action}</div>`;
    }).join("");
  }
  const steps = `<div class="card stack"><span class="eyebrow">Get set up · 2 quick steps</span>
    <div class="steps">
      <div class="step ${hasDevice ? "done" : "cur"}"><span class="n">${hasDevice ? "✓" : "1"}</span><div class="stack" style="gap:6px"><h3>Register this phone</h3>
        <p class="muted small">${hasDevice ? `Registered${d.device.label ? " · " + esc(d.device.label) : ""}. Only this phone can mark your attendance.` : "Links your account to this phone and your fingerprint (or Face ID). You do this once."}</p>
        ${hasDevice ? "" : `<button class="btn primary" id="regDev">Register this phone</button>`}</div></div>
      <div class="step ${hasCourse ? "done" : hasDevice ? "cur" : ""}"><span class="n">${hasCourse ? "✓" : "2"}</span><div class="stack" style="gap:6px"><h3>Join your course</h3>
        <p class="muted small">${hasCourse ? `You're on ${d.courses.length} course${d.courses.length > 1 ? "s" : ""}. Add more below.` : "Pick your group, lecturer and course unit, or type the 6-letter join code your lecturer gives you."}</p>
        ${hasCourse ? "" : joinPicker("j1")}</div></div>
    </div></div>`;
  const courses = hasCourse ? `<div class="card stack"><div class="row"><h3>My attendance</h3><span class="spacer"></span><button class="btn small" id="addCourse">+ Join a course</button></div>
    <div class="list">${d.courses.map((c) => { const p = pct(c.attended - (c.no_checkout || 0) + c.excused, c.held); return `<div class="stack" style="gap:6px;padding-block:6px;border-top:1px solid var(--line)">
      <div class="item"><div><b>${esc(c.code)}</b> · ${esc(c.title)}<div class="small muted">${esc(slotText(c.slots))}</div></div>
      <div style="text-align:right"><b class="mono">${c.held ? p + "%" : "—"}</b><div class="small muted">${c.attended}/${c.held} classes since ${esc(c.joined || "")}</div></div></div>
      ${c.held ? `<div class="bar-meter"><i class="${p < 75 ? "low" : ""}" style="width:${p}%"></i></div>${p < 75 ? `<span class="small" style="color:var(--warn);font-weight:600">Below 75% — you may not be allowed to sit exams.</span>` : ""}` : ""}</div>`; }).join("")}</div></div>` : "";
  const pend = (d.pending || []).length ? `<div class="card stack"><div class="row"><h3>Waiting for approval</h3><span class="pill warn">${d.pending.length}</span></div><p class="small muted">Your registration number isn't on the class list for ${d.pending.map((p) => `<b>${esc(p.code)}</b>`).join(", ")}. Your lecturer will approve you, or check that your registration number is typed exactly as on your student ID.</p></div>` : "";
  const liveBy = Object.fromEntries((d.live || []).map((l) => [l.course_id, l]));
  const week = (d.week || []).length ? `<div class="card stack"><h3>My timetable</h3><div class="list">${[1, 2, 3, 4, 5, 6, 0].filter((w) => d.week.some((e) => e.weekday === w)).map((w) => `<div class="tt-day ${w === d.clock.dow ? "today" : ""}"><span class="tt-dname">${DSHORT[w]}${w === d.clock.dow ? " · today" : ""}</span><div class="stack" style="gap:4px">${d.week.filter((e) => e.weekday === w).sort((x, y) => x.smin - y.smin).map((e) => { const st = slotState(e, d.clock, w === d.clock.dow ? liveBy[e.course_id] : null); return `<div class="tt-slot"><span class="mono small">${t12(e.start)}–${t12(e.end)}</span><span><b>${esc(e.code)}</b> <span class="small muted">${esc(e.title)} · ${esc(e.venue || "")}</span></span>${st.label ? `<span class="pill ${st.cls}">${st.label}</span>` : ""}</div>`; }).join("")}</div></div>`).join("")}</div></div>` : "";
  const recent = d.recent.length ? `<div class="card stack"><h3>Recent refused attempts</h3><div class="feed">${d.recent.map((r) => `<div><time>${dt(r.at)}</time>${esc(r.reason)}</div>`).join("")}</div></div>` : "";
  view.innerHTML = `<div><span class="eyebrow">Student</span><h1>Hello, ${esc(first)}</h1><p class="muted small mono">${esc(ME.reg_no || "")}</p></div>
    ${setupDone ? liveHtml : steps}${pend}${week}${courses}${setupDone ? "" : ""}${recent}`;
  const rd = $("#regDev"); if (rd) rd.addEventListener("click", registerDevice);
  bindPicker("j1");
  const ac = $("#addCourse"); if (ac) ac.addEventListener("click", () => { const s = sheet(`<h2>Join a course</h2><p class="muted">Pick your course unit from the timetable, or use the join code from your lecturer.</p>${joinPicker("j2")}<button class="btn ghost" id="cx">Cancel</button>`); bindPicker("j2"); $("#cx", s).onclick = closeSheet; });
  $$("[data-attend]").forEach((b) => b.addEventListener("click", () => attend(b.dataset.attend, b.dataset.mode)));
  every(6000, () => { if ((location.hash === "" || location.hash === "#/") && !uiBusy()) studentHome(); });
}
// don't refresh the screen under someone who is choosing a course or typing
function uiBusy() { const a = document.activeElement; return window.__picking || (a && view.contains(a) && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName)); }

/* ---------- course picker: group → lecturer → course unit, with the timetable ---------- */
let CATALOG = null;
const fmt12 = (t) => window.SA_CATALOG ? SA_CATALOG.fmt12(t) : t;
// timetable facilitators plus the lecturer account running the course (not an admin who is only holding it)
const facNames = (c) => [...new Set([...(c.facilitators || "").split(",").map((s) => s.replace(/\(lead\)/i, "").trim()), c.lecturer_role === "lecturer" ? c.lecturer : null].filter(Boolean))];
const withGroup = (x) => x.group_name && !String(x.title).includes(x.group_name) ? ` · ${x.group_name}` : "";
function joinPicker(id) {
  return `<div class="stack" id="${id}" style="gap:10px">
    <label class="f">Group<select id="${id}g"><option value="">All groups</option></select></label>
    <label class="f">Lecturer<select id="${id}l"><option value="">All lecturers</option></select></label>
    <label class="f">Course unit<select id="${id}c"><option value="">Loading courses…</option></select></label>
    <div id="${id}i"></div>
    <button class="btn primary" type="button" id="${id}go" disabled>Join this course</button>
    <p class="err" id="${id}e"></p>
    <details><summary class="small" style="cursor:pointer">Have a 6-letter join code instead?</summary><div style="margin-top:8px">${joinForm(id + "k")}</div></details>
  </div>`;
}
async function bindPicker(id) {
  if (!$("#" + id)) return;
  bindJoin(id + "k");
  try { if (!CATALOG || Date.now() - CATALOG.t > 60000) CATALOG = { ...(await api("course.catalog")), t: Date.now() }; }
  catch (x) { const e = $("#" + id + "e"); if (e) e.textContent = x.message; return; }
  const root = $("#" + id); if (!root) return;
  const all = CATALOG.courses, clk = CATALOG.clock;
  const g = $("#" + id + "g"), l = $("#" + id + "l"), c = $("#" + id + "c"), info = $("#" + id + "i"), go = $("#" + id + "go");
  const groups = [...new Set(all.map((x) => x.group_name).filter(Boolean))].sort();
  g.innerHTML = `<option value="">All groups</option>` + groups.map((x) => `<option>${esc(x)}</option>`).join("");
  const show = () => {
    const x = all.find((y) => y.id === c.value);
    go.disabled = !x;
    if (!x) { info.innerHTML = ""; return; }
    const slots = (x.slots || []).map((s) => { const today = s.weekday === clk.dow, on = today && clk.hm >= s.start && clk.hm < s.end;
      return `<div class="tt-slot"><span class="mono small">${DSHORT[s.weekday]} ${fmt12(s.start)}–${fmt12(s.end)}</span><span></span>${on ? `<span class="pill ok">On now</span>` : today ? `<span class="pill warn">Today</span>` : ""}</div>`; }).join("");
    info.innerHTML = `<div class="card stack" style="gap:6px"><b>${esc(x.code)} · ${esc(x.title)}</b><span class="small muted">${esc(facNames(x).join(", "))}${x.venue ? " · " + esc(x.venue) : ""}${esc(withGroup(x))}</span>${slots || `<span class="small muted">No timetable set yet</span>`}</div>`;
  };
  const fill = () => {
    const inG = all.filter((x) => !g.value || x.group_name === g.value);
    const lects = [...new Set(inG.flatMap(facNames))].sort();
    const keepL = lects.includes(l.value) ? l.value : "";
    l.innerHTML = `<option value="">All lecturers</option>` + lects.map((n) => `<option ${n === keepL ? "selected" : ""}>${esc(n)}</option>`).join("");
    const list = inG.filter((x) => !keepL || facNames(x).includes(keepL));
    const keepC = list.some((x) => x.id === c.value && !x.my_status) ? c.value : "";
    c.innerHTML = list.length
      ? `<option value="">Choose your course unit…</option>` + list.map((x) => `<option value="${x.id}" ${x.my_status ? "disabled" : ""} ${x.id === keepC ? "selected" : ""}>${esc(x.code)} · ${esc(x.title)}${!g.value ? esc(withGroup(x)) : ""}${x.my_status === "active" ? " (joined)" : x.my_status === "pending" ? " (waiting for approval)" : ""}</option>`).join("")
      : `<option value="">No courses yet. Use the join code from your lecturer.</option>`;
    show();
  };
  g.onchange = l.onchange = () => { window.__picking = true; fill(); };
  c.onchange = () => { window.__picking = true; show(); };
  fill();
  go.onclick = async () => {
    busy(go, true, "Joining…");
    try { const r = await api("course.join", { course_id: c.value }); window.__picking = false; CATALOG = null; closeSheet();
      toast(r.pending ? `Request sent. Your lecturer will approve you for ${r.course.code}.` : `Joined ${r.course.code}`); studentHome(); }
    catch (x) { $("#" + id + "e").textContent = x.message; busy(go, false); }
  };
}
function joinForm(id) { return `<form class="row" id="${id}" style="flex-wrap:nowrap"><input id="${id}c" placeholder="Join code" autocapitalize="characters" maxlength="8" style="text-transform:uppercase;font-family:var(--f-mono);letter-spacing:.1em" aria-label="Join code"><button class="btn primary">Join</button></form><p class="err" id="${id}e"></p>`; }
function bindJoin(id) {
  const f = $("#" + id); if (!f) return;
  f.addEventListener("submit", async (e) => { e.preventDefault(); const b = $("button", f); busy(b, true, "Joining");
    try { const r = await api("course.join", { join_code: $("#" + id + "c").value }); window.__picking = false; CATALOG = null; closeSheet(); toast(r.pending ? `Request sent. Your lecturer must approve you for ${r.course.code}.` : `Joined ${r.course.code}`); studentHome(); }
    catch (x) { $("#" + id + "e").textContent = x.message; busy(b, false); } });
}
async function registerDevice() {
  if (!WA || !WA.browserSupportsWebAuthn()) { sheet(`<h2>This browser can't use fingerprints</h2><p>Open SmartAttend in Chrome (Android) or Safari (iPhone) and try again.</p><button class="btn" onclick="this.closest('.sheet-back').hidden=true">OK</button>`); return; }
  const avail = await WA.platformAuthenticatorIsAvailable().catch(() => false);
  const s = sheet(`<h2>Register this phone</h2>
    <p>Your phone will ask for your <b>fingerprint, face or screen lock</b>. This links your account to this phone only.</p>
    ${avail ? "" : `<p class="pill warn" style="white-space:normal">This phone didn't report a fingerprint sensor. Make sure a fingerprint or screen lock is set up in your phone's settings.</p>`}
    <ul class="small muted" style="margin:0;padding-left:18px"><li>Use your own phone — you can't switch phones without your lecturer.</li><li>Nobody else's finger will work on your account.</li></ul>
    <p class="err" id="rdErr"></p>
    <button class="btn primary big block" id="rdGo">Continue</button><button class="btn ghost" id="rdCancel">Cancel</button>`);
  $("#rdCancel", s).onclick = closeSheet;
  $("#rdGo", s).onclick = async () => {
    const b = $("#rdGo", s); busy(b, true, "Waiting for your fingerprint…"); $("#rdErr", s).textContent = "";
    try {
      const opts = await api("device.options");
      const cred = await WA.startRegistration(opts);
      await api("device.verify", { credential: cred, label: deviceLabel() });
      closeSheet(); toast("Phone registered"); studentHome();
    } catch (x) {
      busy(b, false);
      $("#rdErr", s).textContent = x.name === "NotAllowedError" ? "The fingerprint request was cancelled or timed out. Tap Continue to try again." : x.name === "InvalidStateError" ? "This phone is already registered for SmartAttend." : x.message;
    }
  };
}
const CHECK_LABELS = { account: "Account", session: "Class session", timetable: "Timetable", device: "Registered phone", location: "Location", biometric: "Fingerprint" };
function flowSheet(mode, items, tail) {
  const order = mode === "in" ? ["location", "account", "session", "timetable", "device", "biometric"] : ["location", "account", "session", "timetable", "device", "biometric"];
  const byKey = Object.fromEntries(items.map((i) => [i.key, i]));
  const s = $("#sheet");
  s.dataset.lock = "1";
  s.innerHTML = `<div><span class="eyebrow">${mode === "in" ? "Checking in" : "Checking out"}</span><h2>Verifying you</h2></div>
    <div class="card"><ul class="checks">${order.map((k) => { const i = byKey[k] || { st: "" }; return `<li class="${i.st || ""}"><span class="ic">${i.st === "ok" ? "✓" : i.st === "bad" ? "✕" : i.st === "run" ? "…" : ""}</span><span><b>${CHECK_LABELS[k]}</b><small>${esc(i.note || "")}</small></span></li>`; }).join("")}</ul></div>${tail || ""}`;
  $("#sheetBack").hidden = false;
}
async function attend(sessionId, mode) {
  let items = [{ key: "location", st: "run", note: "Getting your GPS position…" }];
  flowSheet(mode, items);
  const finish = (ok, title, msg) => {
    flowSheet(mode, items, `<div class="result ${ok ? "ok" : "bad"}"><h2>${esc(title)}</h2><p>${esc(msg)}</p></div><button class="btn block big ${ok ? "primary" : ""}" id="flowDone">${ok ? "Done" : "Close"}</button>`);
    $("#flowDone").onclick = () => { delete $("#sheet").dataset.lock; closeSheet(); studentHome(); };
  };
  const merge = (checks) => { const loc = items.find((i) => i.key === "location"); items = [loc, ...(checks || []).filter((c) => c.key !== "location").map((c) => ({ key: c.key, st: c.ok ? "ok" : "bad", note: c.note }))]; const l = (checks || []).find((c) => c.key === "location"); if (l) Object.assign(loc, { st: l.ok ? "ok" : "bad", note: l.note }); };
  let pos;
  try { pos = await getLocation(); items[0] = { key: "location", st: "run", note: `Found you (±${Math.round(pos.acc)} m). Checking…` }; flowSheet(mode, items); }
  catch (x) { items[0] = { key: "location", st: "bad", note: x.message }; return finish(false, "Location needed", x.message); }
  let opt;
  try { opt = await api("attend.options", { session_id: sessionId, mode, ...pos }); }
  catch (x) { merge(x.data?.checks); return finish(false, "Attendance refused", x.message); }
  merge(opt.checks); items.push({ key: "biometric", st: "run", note: "Confirm with your fingerprint or face…" }); flowSheet(mode, items);
  let cred;
  try { cred = await WA.startAuthentication(opt.options); }
  catch (x) {
    api("attend.reportFail", { session_id: sessionId, mode }).catch(() => {});
    items[items.length - 1] = { key: "biometric", st: "bad", note: x.name === "NotAllowedError" ? "Not confirmed. Either the fingerprint was cancelled or not recognised, or this isn't the phone registered to your account." : x.message };
    return finish(false, "Not confirmed", "Use your own registered phone and try the fingerprint again.");
  }
  try {
    const r = await api("attend.verify", { session_id: sessionId, mode, ...pos, credential: cred });
    merge(r.checks); finish(true, mode === "in" ? "You're checked in" : "You're checked out", `${r.course} · ${hm(r.at || Date.now())}`);
  } catch (x) { merge(x.data?.checks); finish(false, "Attendance refused", x.message); }
}

/* ================= LECTURER ================= */
async function lecturerHome() {
  let list, clock;
  try { [list, clock] = await Promise.all([api("course.list"), api("clock")]); } catch (x) { view.innerHTML = `<p class="err">${esc(x.message)}</p>`; return; }
  const first = ME.full_name.split(" ").slice(-1)[0];
  myCourses = list;
  const sugg = ME.role === "lecturer" ? suggestionsFor(ME.full_name) : [];
  const suggHtml = sugg.length ? `<div class="card hero stack"><h3>Add your timetabled courses</h3><p class="small muted">Your name matches ${esc([...new Set(sugg.map((x) => x.facilitator))].join(", "))} on the ${esc(sugg[0].p.name)} timetable.</p>
    <div class="stack" style="gap:4px">${sugg.map((x) => `<span class="small">• <b>${esc(x.code)}</b> ${esc(x.p.courses[x.code].title)} — ${esc(x.group)} <span class="muted">(${esc(CAT().slotLabel(CAT().slotsFor(x.p, x.code, x.group)))} · ${esc(x.p.groups[x.group].venue)})</span></span>`).join("")}</div>
    <div class="row"><button class="btn primary" id="suggAdd">Add ${sugg.length === 1 ? "it" : `all ${sugg.length}`}</button><button class="btn ghost" id="suggPick">Choose myself</button></div></div>` : "";
  const todays = list.flatMap((c) => (c.slots || []).filter((sl) => sl.weekday === clock.dow).map((sl) => ({ ...sl, c }))).sort((a, b) => toMin(a.start) - toMin(b.start));
  const nx = nextSlot(list.flatMap((c) => (c.slots || []).map((sl) => ({ ...sl, code: c.code, title: c.title, venue: c.venue }))), clock);
  const today = list.length ? `<div class="card stack"><div class="row"><h3>Today · ${DAYS[clock.dow]}</h3><span class="spacer"></span><span class="small muted mono">${t12(clock.hm)} Kampala</span></div>
    ${todays.length ? todays.map((t) => { const st = slotState(t, clock, t.c.live); return `<div class="tt-slot"><span class="mono small">${t12(t.start)}–${t12(t.end)}</span><span><b>${esc(t.c.code)}</b> <span class="small muted">${esc(t.c.title)} · ${esc(t.c.venue || "")}</span></span><span class="row" style="flex-wrap:nowrap;gap:6px">${st.label ? `<span class="pill ${st.cls}">${st.label}</span>` : ""}${st.k === "due" || st.k === "live" || st.k === "checkout" ? `<a class="btn small primary" href="#/course/${t.c.id}/live">${st.k === "due" ? "Start" : "Open"}</a>` : ""}</span></div>`; }).join("")
      : `<p class="muted small">No classes today.${nx ? ` Next: <b>${esc(nx.e.code)}</b> ${DAYS[nx.e.weekday]} ${nx.e.start} · ${esc(nx.e.venue || "")} (${inText(nx.d)}).` : ""}</p>`}</div>` : "";
  view.innerHTML = `${ME.role === "admin" ? window.SAX.nav("courses") : ""}<div class="row"><div><span class="eyebrow">${ME.role === "admin" ? "Admin" : "Lecturer"}</span><h1>${ME.role === "admin" ? "All courses" : "Good to see you, " + esc(first)}</h1></div><span class="spacer"></span>
      ${list.length ? `<button class="btn" id="xlsAll">Download Excel</button>` : ""}<button class="btn primary" id="newCourse">+ New course</button></div>
    ${suggHtml}${today}
    ${list.length ? `<div class="grid2">${list.map((c) => `<div class="card stack ${c.live ? "hero" : ""}">
        <div class="row"><div style="min-width:0"><h3>${esc(c.code)}</h3><p class="muted small">${esc(c.title)}</p></div><span class="spacer"></span>
          ${c.live ? `<span class="pill ok"><span class="dot"></span>${c.live.status === "open" ? "Live" : "Check-out"}</span>` : c.due_now ? `<span class="pill warn">Due now</span>` : ""}</div>
        <p class="small muted">${esc(slotText(c.slots))}<br>${esc(c.venue || "No venue set")} · ${c.students} student${c.students === 1 ? "" : "s"}</p>
        <div class="row"><a class="btn ${c.live || c.due_now ? "primary" : ""}" href="#/course/${c.id}/live">${c.live ? "Open live register" : "Start class"}</a><a class="btn ghost small" href="#/course/${c.id}/students">${c.pending ? `<span class="pill warn">${c.pending} to approve</span>` : `Join code <span class="mono">${esc(c.join_code)}</span>`}</a></div></div>`).join("")}</div>`
    : `<div class="card stack"><h2>Create your first course</h2><p class="muted">Pick your course and group from the official timetable, and the days, times, venue and facilitators fill in for you. You'll get a join code to share with students.</p><button class="btn primary" id="newCourse2">+ New course</button></div>`}`;
  $("#newCourse").onclick = () => courseForm();
  const xa = $("#xlsAll"); if (xa) xa.onclick = () => window.SAX.excel({}, xa);
  const n2 = $("#newCourse2"); if (n2) n2.onclick = () => courseForm();
  const sa = $("#suggAdd"); if (sa) sa.onclick = (e) => { const p = sugg[0].p; addFromTimetable(p, sugg.map((x) => CAT().entry(p, x.code, x.group)), e.currentTarget); };
  const sp = $("#suggPick"); if (sp) sp.onclick = () => smartAddCourse();
  every(15000, () => { if (location.hash === "" || location.hash === "#/") lecturerHome(); });
}
let myCourses = [];
function courseForm(c) { return c ? manualCourseForm(c) : smartAddCourse(); }
const CAT = () => window.SA_CATALOG;
const haveCourse = (code, group) => myCourses.some((m) => m.code === code && (m.group_name || "") === (group || ""));
async function addFromTimetable(p, picks, btn) {
  busy(btn, true, "Adding…");
  try {
    const r = await api("timetable.import", { term_start: p.term_start, courses: picks });
    const parts = [];
    if (r.created) parts.push(`${r.created} added`);
    if (r.claimed) parts.push(`${r.claimed} assigned to you`);
    if (r.updated) parts.push(`${r.updated} updated`);
    closeSheet();
    toast(parts.join(" · ") || "Nothing changed");
    if (r.taken?.length) setTimeout(() => toast(`Not added: ${r.taken.join("; ")}. Ask the admin.`), 3300);
    route();
  } catch (x) { toast(x.message); busy(btn, false); }
}
function suggestionsFor(name) { return CAT().suggestFor(name).filter((x) => !haveCourse(x.code, x.group)); }
function smartAddCourse() {
  const C = CAT(), P = C.PROGRAMMES;
  const sugg = suggestionsFor(ME.full_name);
  const s = sheet(`<h2>Add a course</h2>
    <div class="seg" role="group" aria-label="How to add"><button type="button" data-mode="tt" aria-pressed="true">From the timetable</button><button type="button" data-mode="custom" aria-pressed="false">Custom course</button></div>
    ${sugg.length ? `<div class="card hero stack" style="padding:12px"><b>We think you teach these</b><p class="small muted">Your name matches ${esc([...new Set(sugg.map((x) => x.facilitator))].join(", "))} on the timetable.</p>
      <div class="stack" style="gap:4px">${sugg.map((x) => `<span class="small">• <b>${esc(x.code)}</b> ${esc(x.p.courses[x.code].title)} — ${esc(x.group)} <span class="muted">(${esc(C.slotLabel(C.slotsFor(x.p, x.code, x.group)))})</span></span>`).join("")}</div>
      <button type="button" class="btn primary" id="addSugg">Add ${sugg.length === 1 ? "this course" : `all ${sugg.length}`}</button></div>` : ""}
    <div class="stack" id="ttForm">
      <label class="f">Programme<select id="aProg">${P.map((p, i) => `<option value="${i}">${esc(p.name)}</option>`).join("")}</select></label>
      <label class="f">Course<select id="aCourse"></select></label>
      <label class="f">Group<select id="aGroup"></select></label>
      <label class="check"><input type="checkbox" id="aBoth"> <span>Also add the same course for the other group</span></label>
      <div class="stack" style="gap:6px"><span class="f" style="font-size:13px;font-weight:600;color:var(--muted)">Facilitators</span><div id="aFac" class="stack" style="gap:6px"></div></div>
      <div class="card" id="aPrev" style="padding:12px"></div>
      <p class="err" id="aErr"></p>
      <button type="button" class="btn primary big block" id="aAdd">Add course</button>
    </div>
    <button type="button" class="btn ghost" id="aCancel">Cancel</button>`);
  const prog = () => P[+$("#aProg", s).value];
  const fillCourses = () => {
    const p = prog(), groups = Object.keys(p.groups);
    $("#aCourse", s).innerHTML = Object.entries(p.courses).map(([code, c]) => { const all = groups.every((g) => haveCourse(code, g)); return `<option value="${code}" ${all ? "disabled" : ""}>${code} · ${esc(c.title)}${all ? " (already added)" : ""}</option>`; }).join("");
    const firstFree = [...$("#aCourse", s).options].find((o) => !o.disabled); if (firstFree) $("#aCourse", s).value = firstFree.value;
    fillGroups();
  };
  // Only what the person explicitly ticked is remembered; everyone else keeps the
  // sensible default for that course. Remembering by position would empty the
  // list whenever the course changed and the names no longer matched.
  const manualFac = new Map();
  function renderFacilitators() {
    const p = prog(), code = $("#aCourse", s).value;
    const fac = p.courses[code]?.facilitators || [];
    const strong = fac.filter((f) => C.nameMatch(ME.full_name, f.name) >= 2).map((f) => f.name);
    $("#aFac", s).innerHTML = fac.map((f) => {
      const on = manualFac.has(f.name) ? manualFac.get(f.name) : (!strong.length || strong.includes(f.name) || f.lead);
      return `<label class="check"><input type="checkbox" value="${esc(f.name)}" ${on ? "checked" : ""}> <span>${esc(f.name)}${f.lead ? ' <span class="pill mute">Team leader</span>' : ""}${strong.includes(f.name) ? ' <span class="pill ok">You</span>' : ""}</span></label>`;
    }).join("");
    $$("#aFac input", s).forEach((i) => (i.onchange = () => { manualFac.set(i.value, i.checked); preview(); }));
  }
  // Changing the group only affects the "other group" offer and the preview. It
  // must not rebuild the group list: doing that reset the selection to the first
  // option every time, which is why Group B could never be chosen.
  function syncGroup() {
    const p = prog(), code = $("#aCourse", s).value, g = $("#aGroup", s).value;
    const others = Object.keys(p.groups).filter((x) => x !== g && !haveCourse(code, x));
    $("#aBoth", s).closest("label").hidden = !others.length;
    if (!others.length) $("#aBoth", s).checked = false;
    preview();
  }
  const fillGroups = () => {
    const p = prog(), code = $("#aCourse", s).value, keepGroup = $("#aGroup", s).value;
    $("#aGroup", s).innerHTML = Object.entries(p.groups).map(([g, info]) => { const mine = haveCourse(code, g); return `<option value="${esc(g)}" ${mine ? "disabled" : ""}>${esc(g)} — ${esc(C.slotLabel(C.slotsFor(p, code, g)))} · ${esc(info.venue)}${mine ? " (already yours)" : ""}</option>`; }).join("");
    const opts = [...$("#aGroup", s).options];
    const pick = opts.some((o) => o.value === keepGroup && !o.disabled) ? keepGroup : (opts.find((o) => !o.disabled)?.value || "");
    if (pick) $("#aGroup", s).value = pick;
    renderFacilitators();
    syncGroup();
  };
  const picks = () => {
    const p = prog(), code = $("#aCourse", s).value, g = $("#aGroup", s).value;
    const chosen = $$("#aFac input:checked", s).map((i) => i.value);
    const groups = [g, ...($("#aBoth", s).checked ? Object.keys(p.groups).filter((x) => x !== g && !haveCourse(code, x)) : [])];
    return groups.filter((x) => x && !haveCourse(code, x)).map((x) => C.entry(p, code, x, chosen));
  };
  const preview = () => {
    const p = prog(), list = picks();
    $("#aAdd", s).disabled = !list.length;
    $("#aAdd", s).textContent = list.length > 1 ? `Add ${list.length} courses` : "Add course";
    $("#aPrev", s).innerHTML = list.length ? list.map((e) => `<div class="stack" style="gap:2px"><b>${esc(e.code)} · ${esc(e.title)} — ${esc(e.group)}</b><span class="small muted">${esc(C.slotLabel(e.slots))} · ${esc(e.venue)}</span><span class="small muted">${esc(e.facilitators)} · teaching starts ${esc(new Date(p.term_start).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" }))}</span></div>`).join('<hr style="border:0;border-top:1px solid var(--line);margin:8px 0">') : `<span class="small muted">You already have every group of this course.</span>`;
  };
  $("#aProg", s).onchange = fillCourses; $("#aCourse", s).onchange = fillGroups; $("#aGroup", s).onchange = syncGroup; $("#aBoth", s).onchange = preview;
  fillCourses();
  $("#aAdd", s).onclick = (e) => addFromTimetable(prog(), picks(), e.currentTarget);
  const sb = $("#addSugg", s); if (sb) sb.onclick = (e) => { const p = sugg[0].p; addFromTimetable(p, sugg.map((x) => C.entry(p, x.code, x.group)), e.currentTarget); };
  $$("[data-mode]", s).forEach((b) => (b.onclick = () => { if (b.dataset.mode === "custom") manualCourseForm(null); }));
  $("#aCancel", s).onclick = closeSheet;
}
function manualCourseForm(c) {
  const slots = c?.slots?.length ? c.slots : [{ weekday: 1, start: CAT().PERIODS[0].start, end: CAT().PERIODS[0].end }];
  let loc = c && c.lat != null ? { lat: c.lat, lng: c.lng } : null;
  const s = sheet(`<h2>${c ? "Course settings" : "Custom course"}</h2>
    <form id="cf" class="stack" novalidate>
      <div class="grid2" style="grid-template-columns:repeat(auto-fit,minmax(140px,1fr))"><label class="f">Course code<input id="cCode" list="dlCodes" value="${esc(c?.code || "")}" placeholder="MBA 7101" autocomplete="off" required></label>
      <label class="f">Course title<input id="cTitle" value="${esc(c?.title || "")}" placeholder="Strategic Management" required></label></div>
      <label class="f">Venue<input id="cVenue" list="dlVenues" value="${esc(c?.venue || "")}" placeholder="Choose or type a venue" autocomplete="off"></label>
      <datalist id="dlCodes">${Object.entries(Object.assign({}, ...CAT().PROGRAMMES.map((p) => p.courses))).map(([k, v]) => `<option value="${k}">${esc(v.title)}</option>`).join("")}</datalist>
      <datalist id="dlVenues">${CAT().VENUES.map((v) => `<option value="${esc(v)}"></option>`).join("")}</datalist>
      <datalist id="dlGroups"><option value="Group A"></option><option value="Group B"></option></datalist>
      <div class="grid2" style="grid-template-columns:repeat(auto-fit,minmax(140px,1fr))"><label class="f">Group (optional)<input id="cGroup" list="dlGroups" value="${esc(c?.group_name || "")}" placeholder="Group A" autocomplete="off"></label>
      <label class="f">Teaching starts (optional)<input id="cTerm" type="date" value="${esc(c?.term_start || "")}"></label></div>
      <label class="f">Facilitators (optional)<input id="cFac" value="${esc(c?.facilitators || "")}" placeholder="Mr. Hussein Kintu (lead), Mr. John Ogema"></label>
      <div class="card stack" style="padding:12px"><div class="row"><b>Classroom location</b><span class="spacer"></span><span class="small muted" id="locTxt">${loc ? "Saved" : "Not set"}</span></div>
        <p class="small muted">Optional. Each time you start class, your phone's location is used. Saving it here is a fallback for when your location is unavailable.</p>
        <button type="button" class="btn small" id="locBtn">Use my current location</button></div>
      <label class="f">How close students must be: <span id="radTxt" class="mono">${c?.radius_m || 50} m</span><input type="range" id="cRad" min="15" max="300" step="5" value="${c?.radius_m || 50}"></label>
      <div class="stack"><b>Timetable</b><div id="slots" class="stack"></div><button type="button" class="btn small" id="addSlot">+ Add another time</button></div>
      <p class="err" id="cErr"></p>
      <button class="btn primary big block">${c ? "Save changes" : "Create course"}</button><button type="button" class="btn ghost" id="cCancel">Cancel</button>
    </form>`);
  const slotsBox = $("#slots", s);
  const PER = CAT().PERIODS;
  const addSlot = (x) => {
    const d = document.createElement("div"); d.className = "slotrow slotrow4";
    const pi = PER.findIndex((p) => p.start === x.start && p.end === x.end);
    d.innerHTML = `<label class="f">Day<select>${DAYS.map((n, i) => `<option value="${i}" ${i === x.weekday ? "selected" : ""}>${n}</option>`).join("")}</select></label>
      <label class="f">Time<select class="per">${PER.map((p, i) => `<option value="${i}" ${i === pi ? "selected" : ""}>${p.label}</option>`).join("")}<option value="c" ${pi < 0 ? "selected" : ""}>Custom…</option></select></label>
      <label class="f cust" ${pi < 0 ? "" : "hidden"}>Starts<input type="time" value="${x.start}"></label><label class="f cust" ${pi < 0 ? "" : "hidden"}>Ends<input type="time" value="${x.end}"></label>
      <button type="button" class="btn ghost small" aria-label="Remove time">✕</button>`;
    $(".per", d).onchange = (e) => { const v = e.target.value; $$(".cust", d).forEach((el) => (el.hidden = v !== "c")); if (v !== "c") { $$("input", d)[0].value = PER[+v].start; $$("input", d)[1].value = PER[+v].end; } };
    $("button", d).onclick = () => { if ($$(".slotrow", slotsBox).length > 1) d.remove(); };
    slotsBox.appendChild(d);
  };
  // picking a known course code fills the title and facilitators for you
  const codeIn = $("#cCode", s);
  if (codeIn) codeIn.addEventListener("change", () => { const code = codeIn.value.trim().toUpperCase(); for (const p of CAT().PROGRAMMES) { const k = p.courses[code]; if (k) { if (!$("#cTitle", s).value) $("#cTitle", s).value = k.title; if (!$("#cFac", s).value) $("#cFac", s).value = CAT().facText(k.facilitators); if (!$("#cTerm", s).value) $("#cTerm", s).value = p.term_start; } } });
  slots.forEach(addSlot);
  $("#addSlot", s).onclick = () => addSlot({ weekday: 1, start: PER[0].start, end: PER[0].end });
  $("#cRad", s).oninput = (e) => ($("#radTxt", s).textContent = e.target.value + " m");
  $("#cCancel", s).onclick = closeSheet;
  $("#locBtn", s).onclick = async (e) => { busy(e.target, true, "Finding you…"); try { const p = await getLocation(); loc = p; $("#locTxt", s).textContent = `Saved (±${Math.round(p.acc)} m)`; } catch (x) { $("#cErr", s).textContent = x.message; } busy(e.target, false); };
  $("#cf", s).addEventListener("submit", async (e) => {
    e.preventDefault(); const b = $("#cf button.primary", s); busy(b, true, "Saving…");
    const sl = $$(".slotrow", slotsBox).map((r) => ({ weekday: +$("select", r).value, start: $$("input", r)[0].value, end: $$("input", r)[1].value }));
    try {
      const r = await api("course.save", { id: c?.id, code: $("#cCode", s).value, title: $("#cTitle", s).value, venue: $("#cVenue", s).value, group_name: $("#cGroup", s).value, term_start: $("#cTerm", s).value, facilitators: $("#cFac", s).value, radius_m: +$("#cRad", s).value, lat: loc?.lat ?? null, lng: loc?.lng ?? null, slots: sl });
      closeSheet(); toast(c ? "Course saved" : "Course created"); location.hash = `#/course/${r.id}/${c ? "settings" : "students"}`; route();
    } catch (x) { $("#cErr", s).textContent = x.message; busy(b, false); }
  });
}
async function coursePage(id, tab) {
  let d;
  try { d = await api("course.detail", { id }); } catch (x) { view.innerHTML = `<a href="#/">← Courses</a><p class="err">${esc(x.message)}</p>`; return; }
  const c = d.course;
  const tabs = ["live", "students", "reports", "settings"].map((t) => `<a href="#/course/${id}/${t}" ${t === tab ? 'aria-current="page"' : ""}>${{ live: "Live class", students: `Students (${d.students.length})`, reports: "Reports", settings: "Settings" }[t]}</a>`).join("");
  view.innerHTML = `<div><a href="#/" class="small">← All courses</a><h1 style="margin-top:6px">${esc(c.code)} <span class="muted" style="font-weight:600">· ${esc(c.title)}</span></h1><p class="small muted">${esc(slotText(c.slots))} · ${esc(c.venue || "")}</p></div>
    <nav class="tabs">${tabs}</nav><div id="tabBody" class="stack"></div>`;
  const body = $("#tabBody");
  if (tab === "live") return liveTab(body, d);
  stopPoll();
  if (tab === "students") return studentsTab(body, d);
  if (tab === "reports") return reportsTab(body, c);
  if (tab === "settings") { body.innerHTML = `<div class="card stack"><p>Course code, venue, classroom location, distance limit and timetable.</p><div class="row"><button class="btn primary" id="edit">Edit course settings</button></div></div>`; $("#edit").onclick = () => courseForm(c); }
}
function liveTab(body, d) {
  const c = d.course, s = d.live;
  if (!s) {
    body.innerHTML = `<div class="card hero stack"><h2>Start today's class</h2>
      <p class="muted">Stand in the classroom and tap Start. Your phone's location becomes the centre of the check-in zone (${c.radius_m} m).</p>
      <label class="check"><input type="checkbox" id="useLoc" checked> <span>Use my current location as the classroom${c.lat != null ? "" : " (no saved venue location)"}</span></label>
      <label class="check"><input type="checkbox" id="makeup"> <span>Make-up class (outside the timetable)</span></label>
      <p class="err" id="openErr"></p><button class="btn primary big block" id="openBtn">Start class &amp; open check-in</button></div>
      ${d.students.length ? "" : `<div class="card"><p>No students have joined yet. Share join code <b class="mono">${esc(c.join_code)}</b> with your class.</p></div>`}`;
    $("#openBtn").onclick = async (e) => {
      const b = e.target; busy(b, true, "Starting…"); $("#openErr").textContent = "";
      try {
        let pos = {};
        if ($("#useLoc").checked) { try { pos = await getLocation(); if (pos.acc > 150) toast(`Weak GPS (±${Math.round(pos.acc)} m). Consider moving near a window.`); } catch (x) { if (c.lat == null) throw x; toast("Using the saved venue location"); } }
        await api("session.open", { course_id: c.id, lat: pos.lat, lng: pos.lng, makeup: $("#makeup").checked });
        toast("Class started. Students can check in now."); route();
      } catch (x) { $("#openErr").textContent = x.message; busy(b, false); }
    };
    every(20000, () => route());
    return;
  }
  const reg = Object.fromEntries(d.register.map((r) => [r.student_id, r]));
  const present = d.register.length, out = d.register.filter((r) => r.check_out_at).length;
  const rows = d.students.map((st) => {
    const r = reg[st.id], ex = (s.excused || []).includes(st.id);
    const status = r ? (r.check_out_at ? `<span class="pill ok">Present</span>` : s.status === "checkout" ? `<span class="pill warn">Not checked out</span>` : `<span class="pill ok">In class</span>`)
      : ex ? `<span class="pill mute">Excused</span> <button class="btn ghost small" data-unex="${st.id}">Undo</button>` : `<span class="pill bad">Absent</span> <button class="btn ghost small" data-ex="${st.id}">Excuse</button>`;
    return `<tr><td>${esc(st.full_name)}<div class="small muted mono">${esc(st.reg_no || "")}</div></td><td class="n">${hm(r?.check_in_at)}</td><td class="n hide-sm">${hm(r?.check_out_at)}</td><td class="n hide-sm">${r ? r.dist_in + " m" : "—"}</td><td>${status}</td></tr>`;
  }).join("");
  body.innerHTML = `<div class="card ${s.status === "open" ? "hero" : ""} stack">
      <div class="row"><span class="pill ${s.status === "open" ? "ok" : "warn"}"><span class="dot"></span>${s.status === "open" ? "Check-in open" : "Check-out open"}</span><span class="small muted">Started ${hm(s.opened_at)}${s.ends_at ? ` · timetable ends ${hm(s.ends_at)}` : ""} · zone ${s.radius_m} m${s.scheduled ? "" : " · make-up class"}</span></div>
      ${s.ends_at ? `<p class="small muted">${s.status === "open" ? `Check-out opens automatically at ${hm(new Date(new Date(s.ends_at).getTime() + 15 * 60000))} if you don't end the class first.` : `The register saves automatically at ${hm(new Date(new Date(s.ends_at).getTime() + 45 * 60000))}.`}</p>` : ""}
      <div class="stats"><div class="stat"><b>${present}<small class="muted" style="font-size:14px">/${d.students.length}</small></b><span>Checked in</span></div><div class="stat"><b>${d.students.length - present}</b><span>Not in yet</span></div><div class="stat"><b>${out}</b><span>Checked out</span></div><div class="stat"><b style="${d.attempts.length ? "color:var(--bad)" : ""}">${d.attempts.length}</b><span>Blocked attempts</span></div></div>
      ${s.status === "open" ? `<button class="btn danger block big" id="closeBtn">End class &amp; start check-out</button><p class="small muted">Students check out on their phones after you end the class.</p>`
        : `<button class="btn primary block big" id="finBtn">Finish &amp; save register</button><p class="small muted">Anyone who hasn't checked out will be flagged in reports.</p>`}
    </div>
    <div class="card stack"><div class="row"><h3>Register</h3><span class="spacer"></span><span class="small muted">Updates every few seconds</span></div>
      ${d.students.length ? `<div class="tbl"><table><thead><tr><th>Student</th><th>In</th><th class="hide-sm">Out</th><th class="hide-sm">Distance</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div>` : `<p class="muted">No students on this course yet. Join code: <b class="mono">${esc(c.join_code)}</b></p>`}</div>
    <div class="card stack"><h3>Blocked attempts</h3><div class="feed">${d.attempts.map((a) => `<div><time>${hm(a.at)}</time><b>${esc(a.full_name)}</b> · ${esc(a.reason)}</div>`).join("") || `<p class="muted small">None so far.</p>`}</div></div>`;
  const cb = $("#closeBtn"); if (cb) cb.onclick = async () => { if (!confirm("End the class? Check-in closes and check-out opens.")) return; busy(cb, true); try { await api("session.close", { session_id: s.id }); toast("Check-out is open"); route(); } catch (x) { toast(x.message); busy(cb, false); } };
  const fb = $("#finBtn"); if (fb) fb.onclick = async () => { if (!confirm("Finish and save this register?")) return; busy(fb, true); try { await api("session.finalise", { session_id: s.id }); toast("Register saved to reports"); location.hash = `#/course/${c.id}/reports`; } catch (x) { toast(x.message); busy(fb, false); } };
  $$("[data-ex]").forEach((b) => b.onclick = async () => { await api("session.excuse", { session_id: s.id, student_id: b.dataset.ex }).catch((x) => toast(x.message)); route(); });
  $$("[data-unex]").forEach((b) => b.onclick = async () => { await api("session.excuse", { session_id: s.id, student_id: b.dataset.unex, undo: true }).catch((x) => toast(x.message)); route(); });
  every(4000, () => route());
}
function studentsTab(body, d) {
  const c = d.course;
  const joined = d.roster.filter((r) => r.joined_as).length;
  body.innerHTML = `<div class="card stack"><span class="eyebrow">Join code</span><div class="row"><span class="code-big">${esc(c.join_code)}</span><span class="spacer"></span><button class="btn" id="cp">Copy</button></div>
      <p class="small muted">Students open SmartAttend, choose "Join a course" and type this code.${d.roster.length ? " Only students on your class list join straight away; anyone else waits for your approval." : ""}</p></div>
    ${d.pending.length ? `<div class="card hero stack"><div class="row"><h3>Waiting for your approval</h3><span class="pill warn">${d.pending.length}</span></div>
      <p class="small muted">These students used the join code but their registration number isn't on your class list.</p>
      <div class="list">${d.pending.map((p) => `<div class="item" style="border-top:1px solid var(--line);padding-top:8px"><div><b>${esc(p.full_name)}</b><div class="small muted mono">${esc(p.reg_no || "")} · ${esc(p.email)}</div></div>
        <div class="row" style="flex-wrap:nowrap"><button class="btn primary small" data-ok="${p.id}">Approve</button><button class="btn ghost small" data-no="${p.id}" data-n="${esc(p.full_name)}">Decline</button></div></div>`).join("")}</div></div>` : ""}
    <div class="card stack"><div class="row"><h3>Class list</h3><span class="spacer"></span>${d.roster.length ? `<span class="small muted">${joined} of ${d.roster.length} have joined</span>` : ""}<button class="btn small primary" id="rosterAdd">${d.roster.length ? "Add names" : "Add class list"}</button></div>
      ${d.roster.length ? `<div class="tbl"><table><thead><tr><th>Reg. no.</th><th>Name on list</th><th>Status</th><th></th></tr></thead><tbody>
        ${d.roster.map((r) => `<tr><td class="n">${esc(r.reg_no)}</td><td>${esc(r.full_name || "—")}</td><td>${r.joined_as ? `<span class="pill ok">Joined</span>` : `<span class="pill mute">Not yet</span>`}</td><td><button class="btn ghost small" data-unlist="${esc(r.reg_no)}" aria-label="Remove ${esc(r.reg_no)} from the list">✕</button></td></tr>`).join("")}</tbody></table></div>`
      : `<p class="muted small">No class list yet, so anyone with the join code can join. Add the official list to stop outsiders and fake registration numbers.</p>`}</div>
    <div class="card stack"><h3>Students on this course</h3>${d.students.length ? `<div class="tbl"><table><thead><tr><th>Name</th><th class="hide-sm">Reg. no.</th><th>Phone</th><th></th></tr></thead><tbody>
      ${d.students.map((s) => `<tr><td>${esc(s.full_name)}<div class="small muted">${esc(s.email)}</div></td><td class="n hide-sm">${esc(s.reg_no || "")}</td><td>${s.has_device ? `<span class="pill ok">Registered</span>` : `<span class="pill warn">Not yet</span>`}</td>
      <td><div class="acts">${s.has_device ? `<button class="btn ghost small" data-reset="${s.id}" data-n="${esc(s.full_name)}">Reset phone</button>` : ""}<button class="btn ghost small" data-rm="${s.id}" data-n="${esc(s.full_name)}">Remove</button><button class="btn ghost small" data-pwcode="${s.id}" data-n="${esc(s.full_name)}">Reset code</button></div></td></tr>`).join("")}</tbody></table></div>` : `<p class="muted">Nobody has joined yet.</p>`}</div>`;
  $("#cp").onclick = () => copy(c.join_code);
  $("#rosterAdd").onclick = () => rosterSheet(c, d.roster.length > 0);
  $$("[data-ok]").forEach((b) => b.onclick = async () => { try { await api("enrollment.approve", { course_id: c.id, student_id: b.dataset.ok }); toast("Approved"); route(); } catch (x) { toast(x.message); } });
  $$("[data-no]").forEach((b) => b.onclick = async () => { if (!confirm(`Decline ${b.dataset.n}'s request to join ${c.code}?`)) return; try { await api("enrollment.reject", { course_id: c.id, student_id: b.dataset.no }); toast("Declined"); route(); } catch (x) { toast(x.message); } });
  $$("[data-unlist]").forEach((b) => b.onclick = async () => { if (!confirm(`Remove ${b.dataset.unlist} from the class list? Students already on the course stay on it.`)) return; try { await api("roster.remove", { course_id: c.id, reg_no: b.dataset.unlist }); route(); } catch (x) { toast(x.message); } });
  $$("[data-reset]").forEach((b) => b.onclick = async () => { if (!confirm(`Reset ${b.dataset.n}'s phone? They'll register their new phone next time they sign in.`)) return; try { await api("device.reset", { student_id: b.dataset.reset }); toast("Phone reset"); route(); } catch (x) { toast(x.message); } });
  $$("[data-rm]").forEach((b) => b.onclick = async () => { if (!confirm(`Remove ${b.dataset.n} from ${c.code}?`)) return; try { await api("course.removeStudent", { course_id: c.id, student_id: b.dataset.rm }); toast("Removed"); route(); } catch (x) { toast(x.message); } });
  $$("[data-pwcode]").forEach((b) => b.onclick = () => giveResetCode(b.dataset.pwcode, b));
}
function parseRoster(text) {
  const out = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim(); if (!line) continue;
    const parts = line.split(/\t|,|;/).map((p) => p.trim().replace(/^"|"$/g, "")).filter(Boolean);
    let i = parts.findIndex((p) => /\d/.test(p) && /[\/\-]/.test(p));
    if (i < 0) i = parts.findIndex((p) => /\d{4,}/.test(p));
    if (i < 0) continue;                                   // header rows and lines without a reg. no. are skipped
    const reg = parts[i].toUpperCase().replace(/\s+/g, "");
    const name = parts.filter((_, k) => k !== i && !/^\d+$/.test(parts[k])).join(" ").trim();
    out.push({ reg_no: reg, full_name: name });
  }
  return out;
}
function rosterSheet(c, hasList) {
  const s = sheet(`<h2>${hasList ? "Add to class list" : "Add class list"}</h2>
    <p class="muted small">Paste from Excel or type one student per line: <b>registration number</b> and <b>name</b>. Columns can be separated by tabs or commas. Header rows are skipped.</p>
    <textarea id="rText" rows="9" style="font:13px/1.5 var(--f-mono);width:100%;border:1px solid var(--line);border-radius:10px;padding:10px;background:var(--surface);color:var(--ink)" placeholder="2026/HD06/28758U, Brian Odoch&#10;2026/HD06/28761U, Grace Atim"></textarea>
    <label class="f">Or choose a CSV file<input type="file" id="rFile" accept=".csv,.txt,text/csv,text/plain"></label>
    ${hasList ? `<label class="check"><input type="checkbox" id="rReplace"> <span>Replace the whole list instead of adding</span></label>` : ""}
    <p class="small" id="rCount" style="font-weight:600"></p><p class="err" id="rErr"></p>
    <button class="btn primary big block" id="rSave" disabled>Save class list</button><button class="btn ghost" id="rCancel">Cancel</button>`);
  const update = () => { const n = parseRoster($("#rText", s).value).length; $("#rCount", s).textContent = n ? `${n} student${n > 1 ? "s" : ""} found` : ""; $("#rSave", s).disabled = !n; };
  $("#rText", s).oninput = update;
  $("#rFile", s).onchange = async (e) => { const f = e.target.files[0]; if (f) { $("#rText", s).value = await f.text(); update(); } };
  $("#rCancel", s).onclick = closeSheet;
  $("#rSave", s).onclick = async () => {
    const b = $("#rSave", s); busy(b, true, "Saving…");
    try { const r = await api("roster.save", { course_id: c.id, entries: parseRoster($("#rText", s).value), mode: $("#rReplace", s)?.checked ? "replace" : "append" }); closeSheet(); toast(`Class list saved (${r.saved})`); route(); }
    catch (x) { $("#rErr", s).textContent = x.message; busy(b, false); }
  };
}
async function reportsTab(body, c) {
  body.innerHTML = `<p class="muted">Loading report…</p>`;
  let r; try { r = await api("report", { course_id: c.id }); } catch (x) { body.innerHTML = `<p class="err">${esc(x.message)}</p>`; return; }
  const held = r.sessions.length;
  const rows = r.students.map((s) => ({ ...s, p: pct(s.attended - (s.no_checkout || 0) + s.excused, held) })).sort((a, b) => a.p - b.p);
  const avg = rows.length ? Math.round(rows.reduce((a, s) => a + s.p, 0) / rows.length) : 0;
  const risk = rows.filter((s) => held && s.p < 75).length;
  body.innerHTML = `<div class="stats"><div class="stat"><b>${held}</b><span>Classes held</span></div><div class="stat"><b>${held ? avg + "%" : "—"}</b><span>Average attendance</span></div><div class="stat"><b style="${risk ? "color:var(--warn)" : ""}">${risk}</b><span>Below 75%</span></div><div class="stat"><b style="${r.attempts.length ? "color:var(--bad)" : ""}">${r.attempts.length}</b><span>Blocked attempts</span></div></div>
    <div class="card stack"><div class="row"><h3>By student</h3><span class="spacer"></span><button class="btn small primary" id="xls">Download Excel</button><a class="btn small" href="#/print/${c.id}">Print</a><button class="btn small" id="csv">CSV</button></div>
      ${rows.length ? `<div class="tbl"><table><thead><tr><th>Student</th><th>Attended</th><th>Rate</th><th class="hide-sm"></th><th>Flags</th></tr></thead><tbody>${rows.map((s) => `<tr><td>${esc(s.full_name)}<div class="small muted mono">${esc(s.reg_no || "")}</div></td><td class="n">${s.attended - (s.no_checkout || 0)}${s.excused ? ` +${s.excused} exc.` : ""}/${held}</td><td class="n">${held ? s.p + "%" : "—"}</td><td class="hide-sm" style="width:28%"><div class="bar-meter"><i class="${s.p < 75 ? "low" : ""}" style="width:${s.p}%"></i></div></td><td>${held && s.p < 75 ? `<span class="pill warn">At risk</span> ` : ""}${s.no_checkout ? `<span class="pill mute">${s.no_checkout} no check-out</span>` : ""}</td></tr>`).join("")}</tbody></table></div>` : `<p class="muted">No students yet.</p>`}</div>
    <div class="grid2"><div class="card stack"><h3>Class history</h3>${held ? `<div class="tbl"><table><thead><tr><th>Date</th><th>Present</th><th>Blocked</th></tr></thead><tbody>${r.sessions.map((s) => `<tr><td class="n">${dt(s.opened_at)}${s.scheduled ? "" : " · make-up"}</td><td class="n">${s.present}/${r.students.length}</td><td class="n">${s.blocked}</td></tr>`).join("")}</tbody></table></div>` : `<p class="muted small">Finished classes appear here.</p>`}</div>
    <div class="card stack"><h3>Blocked attempts</h3><div class="feed">${r.attempts.map((a) => `<div><time>${dt(a.at)}</time><b>${esc(a.full_name)}</b> · ${esc(a.reason)}</div>`).join("") || `<p class="muted small">None recorded.</p>`}</div></div></div>`;
  $("#xls").onclick = (e) => window.SAX.excel({ course_id: c.id }, e.currentTarget);
  $("#csv").onclick = () => {
    const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [["Reg No", "Name", "Course", "Classes held", "Attended", "Excused", "Rate %", "No check-out"].map(q).join(",")]
      .concat(rows.map((s) => [s.reg_no, s.full_name, r.course.code, held, s.attended, s.excused, s.p, s.no_checkout].map(q).join(",")));
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
    a.download = `attendance_${r.course.code.replace(/\W+/g, "")}_${new Date().toISOString().slice(0, 10)}.csv`; document.body.appendChild(a); a.click(); a.remove();
  };
}

/* ================= ADMIN ================= */
async function adminPage() {
  stopPoll();
  let d; try { d = await api("admin.overview"); } catch (x) { view.innerHTML = `<p class="err">${esc(x.message)}</p>`; return; }
  let fb = []; try { fb = (await api("feedback.list")).items; } catch { fb = []; }
  let sch = null; try { sch = await api("schema.status"); } catch { sch = null; }
  const n = (r) => d.users.filter((u) => u.role === r).length;
  view.innerHTML = `${window.SAX.nav("people")}<div><h1>People &amp; settings</h1></div>
    <div class="stats"><div class="stat"><b>${n("student")}</b><span>Students</span></div><div class="stat"><b>${n("lecturer")}</b><span>Lecturers</span></div><div class="stat"><b>${d.users.filter((u) => u.has_device).length}</b><span>Phones registered</span></div><div class="stat"><b>${n("admin")}</b><span>Admins</span></div></div>
    <div class="card stack"><h3>Lecturer access code</h3><p class="small muted">Lecturers need this code to create an account. Change it to stop new sign-ups.</p>
      <form class="row" id="lc" style="flex-wrap:nowrap"><input id="lcv" value="${esc(d.lecturer_code)}" class="mono" style="text-transform:uppercase"><button class="btn primary">Save</button></form></div>
    <div class="card stack"><h3>Admin access code</h3><p class="small muted">Used once to create the very first admin. After that, admins are created below. Rotate this if it has ever been shared.</p>
      <form class="row" id="ac" style="flex-wrap:nowrap"><input id="acv" value="${esc(d.admin_code || "")}" class="mono" style="text-transform:uppercase"><button class="btn primary">Save</button></form></div>
    <div class="card stack"><h3>Add another admin</h3><p class="small muted">They sign in with the email and password you set here. You stay signed in as yourself.</p>
      <form id="aa" class="stack" novalidate>
        <label class="f">Full name<input id="aaName" autocomplete="off" required></label>
        <label class="f">Email<input id="aaEmail" type="email" autocomplete="off" required></label>
        <label class="f">Password<input id="aaPass" type="password" autocomplete="new-password" minlength="6" required></label>
        <p class="err" id="aaErr"></p><button class="btn primary">Create admin</button>
      </form></div>
    <div class="card stack"><h3>Allowed website addresses</h3><p class="small muted">Leave empty to allow any https address. For a live rollout, put the app's address here, e.g. https://smartattend.netlify.app</p>
      <form class="row" id="ao" style="flex-wrap:nowrap"><input id="aov" value="${esc(d.allowed_origins)}" placeholder="https://your-site.netlify.app"><button class="btn primary">Save</button></form></div>
    <div class="card stack"><div class="row"><h3>Database</h3><span class="spacer"></span>${!sch ? `<span class="pill mute">Unknown</span>` : sch.complete ? `<span class="pill ok">Up to date</span>` : `<span class="pill bad">Migration missing</span>`}</div>
      ${!sch ? `<p class="small muted">Could not read the schema.</p>` : sch.complete ? `<p class="small muted">All ${sch.expected} tables the app expects are present.</p>` : `<p class="small muted">Missing: <b>${esc(sch.missing.join(", "))}</b>. Run the matching file in <span class="mono">supabase/migrations</span>, then reload this page.</p>`}</div>
    <div class="card stack"><div class="row"><h3>Feedback</h3><span class="spacer"></span><span class="small muted">${fb.length} open</span></div>
      ${fb.length ? `<div class="list">${fb.map((f) => `<div class="item" style="border-top:1px solid var(--line);padding-top:8px"><div><b>${esc(f.full_name || "Removed account")}</b> <span class="small muted">${esc(f.role || "")} · ${dt(f.created_at)}${f.page ? ` · ${esc(f.page)}` : ""}</span><div class="small">${esc(f.message)}</div></div><button class="btn ghost small" data-fbdone="${f.id}">Done</button></div>`).join("")}</div>`
        : `<p class="muted small">No open messages. The Help screen sends them here.</p>`}</div>
    <div class="card stack"><h3>Everyone</h3><input id="q" placeholder="Search name, email or reg. no." aria-label="Search people">
      <div class="tbl"><table><thead><tr><th>Name</th><th>Role</th><th>Reg. no.</th><th>Phone</th><th></th></tr></thead><tbody id="ub"></tbody></table></div></div>`;
  const draw = (q = "") => { $("#ub").innerHTML = d.users.filter((u) => (u.full_name + u.email + (u.reg_no || "")).toLowerCase().includes(q.toLowerCase())).map((u) => `<tr><td>${esc(u.full_name)}<div class="small muted">${esc(u.email)}</div></td><td>${u.role}</td><td class="n">${esc(u.reg_no || "")}</td><td>${u.role === "student" ? (u.has_device ? `<span class="pill ok">Yes</span>` : `<span class="pill mute">No</span>`) : ""}</td><td>${u.has_device ? `<button class="btn ghost small" data-reset="${u.id}">Reset phone</button>` : ""}<button class="btn ghost small" data-pwcode="${u.id}">Reset code</button></td></tr>`).join(""); $$("[data-reset]").forEach((b) => b.onclick = async () => { if (!confirm("Reset this student's phone?")) return; await api("device.reset", { student_id: b.dataset.reset }).then(() => toast("Phone reset")).catch((x) => toast(x.message)); adminPage(); }); $$("[data-pwcode]").forEach((b) => b.onclick = () => giveResetCode(b.dataset.pwcode, b)); };
  draw(); $("#q").oninput = (e) => draw(e.target.value);
  $("#lc").onsubmit = async (e) => { e.preventDefault(); await api("admin.set", { lecturer_code: $("#lcv").value }).then(() => toast("Saved")).catch((x) => toast(x.message)); };
  $("#ac").onsubmit = async (e) => { e.preventDefault(); await api("admin.set", { admin_code: $("#acv").value }).then(() => { toast("Admin code saved"); adminPage(); }).catch((x) => toast(x.message)); };
  $("#aa").onsubmit = async (e) => {
    e.preventDefault(); const btn = $("#aa button"); busy(btn, true, "Creating…"); $("#aaErr").textContent = "";
    try {
      // the reply carries a token for the NEW admin - it is deliberately not stored,
      // so creating an account does not sign you out of your own
      await api("signup", { role: "admin", full_name: $("#aaName").value, email: $("#aaEmail").value, password: $("#aaPass").value });
      toast("Admin account created"); adminPage();
    } catch (x) { $("#aaErr").textContent = x.message; busy(btn, false); }
  };
  $("#ao").onsubmit = async (e) => { e.preventDefault(); await api("admin.set", { allowed_origins: $("#aov").value }).then(() => toast("Saved")).catch((x) => toast(x.message)); };
  $$("[data-fbdone]").forEach((b) => b.onclick = async () => { await api("feedback.done", { id: b.dataset.fbdone }).then(() => adminPage()).catch((x) => toast(x.message)); });
}

/* ---------- router ---------- */
// A tab/window title tells you where you are in history, in tab lists and to a
// screen reader, none of which the app was doing before.
// Help, orientation and feedback in one place. It works without signing in,
// because the people who most need it are the ones who cannot get in.
function renderHelp() {
  // the header is the only way back to the app, so restore it for signed-in users
  $("#bar").hidden = !ME;
  if (ME) $("#who").innerHTML = `<b>${esc(ME.full_name)}</b>${esc(ME.role)}`;
  view.innerHTML = `<div class="stack" style="display:grid;gap:14px">
    <a href="#/" class="small">← Back to SmartAttend</a>
    <div><span class="eyebrow">Help</span><h1>How SmartAttend works</h1></div>
    <div class="card stack"><h2>New here? Five steps</h2>
      <ol class="small muted" style="margin:0;padding-left:18px;display:grid;gap:6px">
        <li>Create an account with your own name, email and registration number.</li>
        <li>Register this phone. Only that phone can mark your attendance.</li>
        <li>Join your course with the six-letter code from your lecturer.</li>
        <li>When the lecturer starts the class, tap Check in and allow location.</li>
        <li>When the class ends, tap Check out. Attendance counts only when both are done.</li>
      </ol></div>
    <div class="card stack"><h2>Something not working?</h2>
      <div class="stack small" style="gap:10px">
        <div><b>Location is refused.</b> Turn on GPS, allow location for this site, and stand near a window. Fixes weaker than ±150 m are refused.</div>
        <div><b>No fingerprint prompt.</b> Set a screen lock, fingerprint or face unlock in the phone's settings, then open SmartAttend in Chrome on Android or Safari on iPhone.</div>
        <div><b>The Check in button is missing.</b> The lecturer has not opened the class yet, or it is outside the timetabled slot.</div>
        <div><b>Waiting for approval.</b> Your registration number may not match the class list. Tell your lecturer — do not keep resubmitting.</div>
        <div><b>Cannot sign in.</b> Use Forgot password?, or ask your lecturer or the admin for a six-digit reset code.</div>
        <div><b>Wrong course or ended up in the wrong group.</b> Ask your lecturer to remove you, then join again with the correct code.</div>
      </div></div>
    ${ME ? `<div class="card stack"><h2>Send feedback</h2><p class="small muted">Tell the team what was confusing or broken. It goes to the administrator with your name and this screen.</p>
      <form id="fbForm" class="stack" novalidate>
        <label class="f">Your message<textarea id="fbMsg" rows="4" style="font:inherit;width:100%;border:1px solid var(--line);border-radius:10px;padding:10px;background:var(--surface);color:var(--ink)" placeholder="What happened, and what did you expect?"></textarea></label>
        <p class="err" id="fbErr"></p><button class="btn primary">Send feedback</button>
      </form></div>`
    : `<div class="card stack"><p class="muted">You are not signed in.</p><a class="btn primary" href="#/">Go to sign in</a></div>`}
    <p class="small muted">Institutions: SmartAttend is licensed per semester. Ask your ICT department or the administrator about a departmental licence.</p>
  </div>`;
  const fb = $("#fbForm");
  if (fb) fb.addEventListener("submit", async (e) => {
    e.preventDefault();
    const b = $("#fbForm button"); busy(b, true, "Sending…"); $("#fbErr").textContent = "";
    try {
      await api("feedback.send", { message: $("#fbMsg").value, page: location.hash || "#/" });
      $("#fbMsg").value = ""; busy(b, false); toast("Thank you — sent to the administrator");
    } catch (x) { $("#fbErr").textContent = x.message; busy(b, false); }
  });
}

function pageTitle(h, me) {
  if (h.startsWith("#/reset-password")) return "Choose a new password";
  if (h === "#/reset-code") return "Enter a reset code";
  if (h === "#/help") return "Help";
  if (h === "#/forgot-password") return "Reset your password";
  if (h === "#/admin-signup") return "Admin account";
  if (h.startsWith("#/print")) return "Report";
  if (h.startsWith("#/course/")) return "Course";
  if (h === "#/admin/test") return "Test lab";
  if (h === "#/admin/timetable") return "Timetable";
  if (h === "#/admin/canvas") return "Business model";
  if (h === "#/admin/people" || h === "#/admin") return "People";
  if (h === "#/admin/courses") return "Courses";
  if (!me) return "Sign in";
  return me.role === "admin" ? "Dashboard" : me.role === "lecturer" ? "Courses" : "Attendance";
}
// An unknown address used to fall through to the dashboard, which quietly told
// people they were somewhere they were not.
function notFound(h) {
  stopPoll();
  view.innerHTML = `<div class="card stack"><span class="eyebrow">Nothing here</span><h1>That page does not exist</h1>
    <p class="muted small mono">${esc(h)}</p><a class="btn primary" href="#/">Go to the start</a></div>`;
}
async function route() {
  const h = location.hash || "#/";
  document.title = "SmartAttend · " + pageTitle(h, ME);
  if (h === "#/forgot-password") return renderForgotPassword();
  if (h === "#/reset-code") return renderResetCode();
  if (h === "#/help") return renderHelp();
  if (h.startsWith("#/reset-password")) return renderResetPassword();
  if (h === "#/admin-signup" && !ME) return renderAdminSignup();
  if (!ME) return renderAuth();
  $("#bar").hidden = false;
  $("#who").innerHTML = `<b>${esc(ME.full_name)}</b>${esc(ME.role)}`;
  const m = h.match(/^#\/course\/([\w-]+)\/(live|students|reports|settings)$/);
  if (ME.role === "student") { if (h !== "#/") { stopPoll(); location.hash = "#/"; return; } return studentHome(); }
  if (h.startsWith("#/print")) return window.SAX.print(h);
  if (m) return coursePage(m[1], m[2]);
  if (ME.role === "admin") {
    if (h === "#/admin/courses") return lecturerHome();
    if (h === "#/admin/people" || h === "#/admin") return adminPage();
    if (h === "#/admin/test") return window.SAX.testLab();
    if (h === "#/admin/timetable") return window.SAX.timetable();
    if (h === "#/admin/canvas") return window.SAX.canvas();
    if (h === "#/" || h === "") return window.SAX.dashboard();
    return notFound(h);
  }
  if (h === "#/" || h === "") return lecturerHome();
  return notFound(h);
}
window.addEventListener("hashchange", async () => {
  stopPoll(); closeSheet(); await route();
  const h1 = view.querySelector("h1");
  if (h1) { h1.setAttribute("tabindex", "-1"); h1.focus(); }
});
$("#signout").onclick = async () => { stopPoll(); await api("logout").catch(() => {}); store.set("sa.token", null); ME = null; location.hash = "#/"; route(); };
async function boot() {
  if (!store.get("sa.token")) { ME = null; return route(); }
  view.innerHTML = `<p class="muted">Loading…</p>`;
  try { ME = (await api("me")).user; } catch (x) { if (x.offline) { view.innerHTML = `<div class="card stack"><p class="err">${esc(x.message)}</p><button class="btn" onclick="location.reload()">Try again</button></div>`; return; } ME = null; }
  route();
}
window.SA = { api, esc, $, $$, toast, sheet, closeSheet, busy, hm, dt, pct, slotText, view, stopPoll, every, route, copy, me: () => ME };
if (!window.isSecureContext) toast("Open SmartAttend over https so location and fingerprint work.");
startClock();
boot();
})();
