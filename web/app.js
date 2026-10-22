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
// Everything shown is 12-hour Kampala time (Africa/Kampala), the way the
// timetable sheets people read are printed. Phone timezone must not leak in.
function t12(hhmm) {
  const [h, m] = String(hhmm || "").split(":").map(Number);
  if (!Number.isFinite(h)) return String(hhmm || "");
  return `${h % 12 || 12}:${pad2(Number.isFinite(m) ? m : 0)} ${h >= 12 ? "pm" : "am"}`;
}
const kampalaTimeFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Kampala", hour: "numeric", minute: "2-digit", hour12: true });
const kampalaDateFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Kampala", weekday: "short", day: "2-digit", month: "short" });
const hm = (t) => {
  if (!t) return "—";
  const d = new Date(t); if (isNaN(d.getTime())) return "—";
  return kampalaTimeFmt.format(d).replace(/\s?(am|pm)/i, (m) => m.toLowerCase());
};
const dt = (t) => {
  const d = new Date(t); if (isNaN(d.getTime())) return "—";
  return `${kampalaDateFmt.format(d)} · ${hm(d)}`;
};
/* ---------- campus clock ----------
   One clock in the header, always Kampala time: every rule in the app runs on
   Kampala time, so a phone set to another zone must not see a different clock.
   It takes its offset from the server once, then ticks locally. */
const kampalaFmt = kampalaTimeFmt;
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
        ${role !== "student" ? `<label class="f">Lecturer access code<input id="fCode" autocapitalize="characters" required></label>` : ""}
        ` : `
        <label class="f">Email or registration number<input id="fEmail" autocomplete="username" required></label>
        <label class="f">Password<input id="fPass" type="password" autocomplete="current-password" required></label>
        `}
        <p class="err" id="authErr" role="alert"></p>
        <button class="btn primary block big" type="submit">${mode === "signin" ? "Sign in" : "Create account"}</button>
      </form>
      ${mode === "signin" ? `<p class="small muted auth-links"><a href="#/forgot-password">Forgot password?</a> · <a href="#/reset-code">Have a reset code?</a></p>` : ""}
      ${mode === "signin" ? `<p class="small muted" style="margin-top:8px">Admin? <a href="#/admin-setup">Create an admin account</a></p>` : ""}
    </div>
  </section>`;
  // ... rest of file continues - THIS IS INCOMPLETE
}
