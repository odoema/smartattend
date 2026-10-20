/* SmartAttend — admin dashboard, Excel export, print reports, test lab and Business Model Canvas. */
(function () {
"use strict";
const SA = window.SA;
const { api, esc, $, $$, toast, busy, hm, dt, pct, view } = SA;

/* ---------- shared bits ---------- */
// Four destinations is what fits a phone without scrolling; the demo and expo
// pages are visited once, so they sit in a Tools row on the dashboard instead of
// taking two of the six seats in the primary navigation.
const NAV = [["dashboard", "#/", "Dashboard"], ["courses", "#/admin/courses", "Courses"], ["timetable", "#/admin/timetable", "Timetable"], ["people", "#/admin/people", "People"]];
const TOOLS = [["test", "#/admin/test", "Test lab"], ["canvas", "#/admin/canvas", "Business model"]];
const nav = (active) => `<nav class="tabs admin-nav noprint" aria-label="Sections">${NAV.map(([k, h, t]) => `<a href="${h}" ${k === active ? 'aria-current="page"' : ""}>${esc(t)}</a>`).join("")}</nav>`;
const toolsRow = () => `<div class="row tools-row noprint">${TOOLS.map(([, h, t]) => `<a class="btn ghost small" href="${h}">${esc(t)}</a>`).join("")}</div>`;
const bar = (p) => `<div class="bar-meter"><i class="${p < 75 ? "low" : ""}" style="width:${Math.max(0, Math.min(100, p || 0))}%"></i></div>`;
const rateCell = (p) => (p == null ? `<span class="muted">—</span>` : `<div class="rate"><b class="mono">${p}%</b>${bar(p)}</div>`);
const fmtDate = (t) => new Date(t).toLocaleDateString([], { weekday: "short", day: "2-digit", month: "short", year: "numeric" });
const pad2 = (n) => String(n).padStart(2, "0");
function t12(hhmm) {
  const [h, m] = String(hhmm || "").split(":").map(Number);
  if (!Number.isFinite(h)) return String(hhmm || "");
  return `${h % 12 || 12}:${pad2(Number.isFinite(m) ? m : 0)} ${h >= 12 ? "pm" : "am"}`;
}
const fmtTime = (t) => { if (!t) return ""; const d = new Date(t); if (isNaN(d.getTime())) return ""; return t12(`${pad2(d.getHours())}:${pad2(d.getMinutes())}`); };

/* ---------- Business Model Canvas (from the team's expo document) ---------- */
const CANVAS = {
  abstract: "The Smart Student Attendance Management System is a secure, digital solution that eliminates unreliable paper registers and proxy signing. It verifies each student through their account, registered device, location and class time, uniquely identifies them with biometrics, and gives lecturers full control over attendance sessions. Automated tracking and reporting reduce workload, while accurate digital records strengthen accountability and save time for both institutions and staff.",
  blocks: [
    ["Key Partners", "kp", ["Colleges & universities", "ICT departments", "Lecturers & academic units", "GPS / location providers", "Cloud / database providers"]],
    ["Key Activities", "ka", ["Develop & maintain the app", "Register students, lecturers and courses", "Manage attendance sessions", "Verify device & location", "Record check-in / check-out", "Generate reports"]],
    ["Key Resources", "kr", ["Mobile app", "Student & lecturer database", "Attendance database", "Timetable information", "Device verification system", "GPS / geofencing technology", "Development & ICT team"]],
    ["Value Propositions", "vp", ["Replaces manual registers", "Prevents proxy signing", "Lecturer controls session timing", "Location-based validation", "Accurate, secure records", "Saves time & improves accuracy"]],
    ["Customer Relationships", "cr", ["Self-service registration", "Lecturer / admin support", "Training & technical support", "Feedback channels", "Access to reports"]],
    ["Channels", "ch", ["Mobile app", "ICT departments", "Academic units", "Student orientation", "Institutional communication"]],
    ["Customer Segments", "cs", ["Colleges & universities", "Lecturers", "Academic departments", "Administrators", "Students"]],
    ["Cost Structure", "co", ["App development & maintenance", "Cloud hosting & storage", "GPS / location services", "Cybersecurity", "Support & training", "Updates", "Staff / admin costs"]],
    ["Revenue Streams", "rs", ["Subscription fees", "Annual licence fees", "Setup & implementation fees", "Maintenance & support fees", "Customisation fees"]],
  ],
};

/* ---------- Excel export ---------- */
let xlsxLoading = null;
function loadXLSX() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (!xlsxLoading) xlsxLoading = new Promise((res, rej) => { const s = document.createElement("script"); s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"; s.onload = () => res(window.XLSX); s.onerror = () => { xlsxLoading = null; rej(new Error("The Excel tool couldn't load. Check your connection and try again.")); }; document.head.appendChild(s); });
  return xlsxLoading;
}
const sheetName = (n, used) => { let b = String(n).replace(/[\[\]\*\?\/\\:]/g, "-").slice(0, 31) || "Sheet"; let x = b, i = 2; while (used.has(x)) x = b.slice(0, 28) + " " + i++; used.add(x); return x; };
function addSheet(XLSX, wb, used, name, rows, widths) {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  if (widths) ws["!cols"] = widths.map((w) => ({ wch: w }));
  XLSX.utils.book_append_sheet(wb, ws, sheetName(name, used));
}
function registerMatrix(course, data) {
  const sess = data.sessions.filter((s) => s.course_id === course.id);
  const studs = data.students.filter((s) => s.course_id === course.id);
  const mk = new Map(data.marks.map((m) => [m.session_id + "|" + m.student_id, m]));
  const ex = new Set(data.excused.map((e) => e.session_id + "|" + e.student_id));
  const head = ["Reg. no.", "Name", ...sess.map((s) => new Date(s.opened_at).toLocaleDateString([], { day: "2-digit", month: "short" }) + " " + fmtTime(s.opened_at)), "Attended", "Excused", "Rate %"];
  const rows = studs.map((st) => {
    let a = 0, e = 0;
    const cells = sess.map((s) => { const k = s.id + "|" + st.id; if (mk.has(k)) { a++; return mk.get(k).check_out_at ? "P" : "P (no out)"; } if (ex.has(k)) { e++; return "E"; } return "A"; });
    return [st.reg_no || "", st.full_name, ...cells, a, e, sess.length ? Math.round((100 * (a + e)) / sess.length) : ""];
  });
  return { head, rows, sess, studs };
}
async function buildWorkbook(data, scopeLabel) {
  const XLSX = await loadXLSX();
  const wb = XLSX.utils.book_new(); const used = new Set();
  const code = Object.fromEntries(data.courses.map((c) => [c.id, c.code]));
  const gen = new Date(data.generated_at).toLocaleString();
  const totalHeld = data.courses.reduce((a, c) => a + c.held, 0);
  const rated = data.courses.filter((c) => c.avg_rate != null);
  const overall = rated.length ? Math.round(rated.reduce((a, c) => a + c.avg_rate * c.students, 0) / Math.max(1, rated.reduce((a, c) => a + c.students, 0))) : "";
  addSheet(XLSX, wb, used, "Summary", [
    ["SmartAttend — Attendance Report"], [scopeLabel], ["Generated", gen], [],
    ["Courses", data.courses.length], ["Classes held", totalHeld], ["Students enrolled", data.students.length], ["Average attendance %", overall],
    ["Students below 75%", data.courses.reduce((a, c) => a + c.at_risk, 0)], ["Blocked attempts", data.attempts.length], [],
    ["Course", "Title", "Lecturer", "Students", "Classes held", "Average attendance %", "Below 75%", "Blocked attempts", "Pending approvals", "Demo"],
    ...data.courses.map((c) => [c.code, c.title, c.lecturer, c.students, c.held, c.avg_rate ?? "", c.at_risk, c.blocked, c.pending, c.is_demo ? "Yes" : ""]),
  ], [26, 30, 22, 10, 12, 18, 10, 14, 14, 6]);
  addSheet(XLSX, wb, used, "Students", [
    ["Course", "Reg. no.", "Name", "Email", "Attended", "Excused", "Classes held", "Rate %", "Status", "No check-out", "Phone registered"],
    ...data.students.map((s) => { const held = data.sessions.filter((x) => x.course_id === s.course_id).length; const p = held ? Math.round((100 * (s.attended + s.excused)) / held) : ""; return [code[s.course_id], s.reg_no || "", s.full_name, s.email, s.attended, s.excused, held, p, held && p < 75 ? "At risk" : "OK", s.no_checkout, s.has_device ? "Yes" : "No"]; }),
  ], [12, 20, 24, 28, 9, 8, 12, 8, 9, 12, 15]);
  for (const c of data.courses) {
    const m = registerMatrix(c, data);
    if (!m.studs.length) continue;
    addSheet(XLSX, wb, used, `${c.code} register`, [[`${c.code} · ${c.title} — attendance register`], ["P = present, P (no out) = present but did not check out, E = excused, A = absent"], [], m.head, ...m.rows], [20, 24, ...m.sess.map(() => 12), 9, 8, 8]);
  }
  addSheet(XLSX, wb, used, "Classes", [
    ["Course", "Date", "Started", "Ended", "Type", "Present", "Enrolled", "Rate %", "No check-out", "Blocked attempts", "Zone (m)"],
    ...data.sessions.map((s) => { const en = data.students.filter((x) => x.course_id === s.course_id).length; return [code[s.course_id], fmtDate(s.opened_at), fmtTime(s.opened_at), fmtTime(s.closed_at), s.scheduled ? "Timetabled" : "Make-up", s.present, en, en ? Math.round((100 * s.present) / en) : "", s.no_checkout, s.blocked, s.radius_m]; }),
  ], [12, 18, 9, 9, 11, 8, 9, 8, 12, 15, 9]);
  const sname = Object.fromEntries(data.students.map((s) => [s.course_id + "|" + s.id, s]));
  const sinfo = Object.fromEntries(data.sessions.map((s) => [s.id, s]));
  addSheet(XLSX, wb, used, "Check-ins", [
    ["Course", "Date", "Reg. no.", "Name", "Checked in", "Checked out", "Distance in (m)", "Distance out (m)", "Demo data"],
    ...data.marks.map((m) => { const s = sinfo[m.session_id] || {}; const st = sname[s.course_id + "|" + m.student_id] || {}; return [code[s.course_id] || "", s.opened_at ? fmtDate(s.opened_at) : "", st.reg_no || "", st.full_name || "", fmtTime(m.check_in_at), fmtTime(m.check_out_at), m.dist_in ?? "", m.dist_out ?? "", m.simulated ? "Yes" : ""]; }),
  ], [12, 18, 20, 24, 11, 11, 14, 15, 10]);
  addSheet(XLSX, wb, used, "Blocked attempts", [["When", "Course", "Name", "Reg. no.", "Check", "Reason"], ...data.attempts.map((a) => [new Date(a.at).toLocaleString(), code[a.course_id] || "", a.full_name, a.reg_no || "", a.stage, a.reason])], [20, 12, 24, 20, 11, 70]);
  if (data.roster.length) addSheet(XLSX, wb, used, "Class lists", [["Course", "Reg. no.", "Name on list", "Joined SmartAttend"], ...data.roster.map((r) => [code[r.course_id], r.reg_no, r.full_name || "", r.joined ? "Yes" : "No"])], [12, 20, 26, 18]);
  if (data.users.length) addSheet(XLSX, wb, used, "Users", [["Role", "Name", "Email", "Reg. no.", "Phone registered", "Demo", "Joined"], ...data.users.map((u) => [u.role, u.full_name, u.email, u.reg_no || "", u.role === "student" ? (u.has_device ? "Yes" : "No") : "", u.is_demo ? "Yes" : "", fmtDate(u.created_at)])], [10, 24, 30, 20, 15, 6, 18]);
  if (SA.me()?.role === "admin" && !data.single) addSheet(XLSX, wb, used, "Business Model Canvas", [["SmartAttend — Business Model Canvas"], [], ["Abstract", CANVAS.abstract], [], ["Block", "Items"], ...CANVAS.blocks.map(([t, , items]) => [t, items.join("\n")])], [24, 90]);
  return { XLSX, wb };
}
async function excel(opts, btn) {
  busy(btn, true, "Preparing…");
  try {
    const data = await api("export", opts || {});
    if (!data.courses.length) { toast("There's nothing to export yet. Create a course first."); return; }
    data.single = !!opts?.course_id;
    const label = opts?.course_id ? `Course: ${data.courses[0].code} · ${data.courses[0].title}` : SA.me().role === "admin" ? "All courses" : `Courses taught by ${SA.me().full_name}`;
    const { XLSX, wb } = await buildWorkbook(data, label);
    const day = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `SmartAttend_${opts?.course_id ? data.courses[0].code.replace(/\W+/g, "") : "Report"}_${day}.xlsx`);
    toast("Excel report downloaded");
  } catch (x) { toast(x.message); }
  finally { busy(btn, false); }
}

/* ---------- Dashboard ---------- */
async function dashboard() {
  SA.stopPoll();
  view.innerHTML = `${nav("dashboard")}<p class="muted">Loading dashboard…</p>`;
  let d; try { d = await api("admin.dashboard"); } catch (x) { view.innerHTML = `${nav("dashboard")}<p class="err">${esc(x.message)}</p>`; return; }
  const t = d.totals;
  const rated = d.courses.filter((c) => c.avg_rate != null);
  const overall = rated.length ? Math.round(rated.reduce((a, c) => a + c.avg_rate * c.students, 0) / Math.max(1, rated.reduce((a, c) => a + c.students, 0))) : null;
  const atRisk = d.courses.reduce((a, c) => a + c.at_risk, 0);
  const maxReason = Math.max(1, ...d.reasons.map((r) => r.n));
  const RLABEL = { location: "Outside the classroom", biometric: "Fingerprint / wrong phone", timetable: "Outside class time", account: "Not enrolled / not approved", session: "Class not open", device: "No registered phone" };
  view.innerHTML = `${nav("dashboard")}${toolsRow()}
    <div class="row"><div><span class="eyebrow">Admin</span><h1>Dashboard</h1><p class="small muted">Live figures across every course</p></div><span class="spacer"></span>
      <button class="btn primary" id="dXls">Download Excel report</button><a class="btn" href="#/print">Print report</a></div>
    <div class="stats">
      <div class="stat"><b>${t.students}</b><span>Students${t.demo_students ? ` (+${t.demo_students} demo)` : ""}</span></div>
      <div class="stat"><b>${t.lecturers}</b><span>Lecturers</span></div>
      <div class="stat"><b>${t.courses}</b><span>Courses</span></div>
      <div class="stat"><b>${t.sessions}</b><span>Classes held${t.live ? ` · ${t.live} live now` : ""}</span></div>
      <div class="stat"><b>${overall == null ? "—" : overall + "%"}</b><span>Average attendance</span></div>
      <div class="stat"><b style="${atRisk ? "color:var(--warn)" : ""}">${atRisk}</b><span>Students below 75%</span></div>
      <div class="stat"><b style="${t.blocked_week ? "color:var(--bad)" : ""}">${t.blocked_week}</b><span>Blocked this week (${t.blocked} total)</span></div>
      <div class="stat"><b style="${t.pending ? "color:var(--warn)" : ""}">${t.pending}</b><span>Waiting for approval</span></div>
    </div>
    <div class="card stack"><div class="row"><h3>Courses</h3><span class="spacer"></span><a class="btn small" href="#/admin/courses">Manage courses</a></div>
      ${d.courses.length ? `<div class="tbl"><table><thead><tr><th>Course</th><th class="hide-sm">Lecturer</th><th>Students</th><th class="hide-sm">Held</th><th>Attendance</th><th class="hide-sm">Below 75%</th><th class="hide-sm">Blocked</th><th></th></tr></thead><tbody>
        ${d.courses.map((c) => `<tr><td><b>${esc(c.code)}</b> ${c.live ? `<span class="pill ok">Live</span>` : ""}${c.is_demo ? `<span class="pill mute">Demo</span>` : ""}<div class="small muted">${esc(c.title)}</div></td><td class="hide-sm">${esc(c.lecturer)}</td><td class="n">${c.students}${c.pending ? ` <span class="pill warn">+${c.pending}</span>` : ""}</td><td class="n hide-sm">${c.held}</td><td>${rateCell(c.avg_rate)}</td><td class="n hide-sm">${c.at_risk}</td><td class="n hide-sm">${c.blocked}</td>
          <td><div class="acts"><a class="btn ghost small" href="#/course/${c.id}/reports">Open</a><button class="btn ghost small" data-xls="${c.id}">Excel</button><a class="btn ghost small" href="#/print/${c.id}">Print</a></div></td></tr>`).join("")}</tbody></table></div>`
      : `<p class="muted">No courses yet. Lecturers create them, or open the <a href="#/admin/test">Test lab</a> to load a demo class.</p>`}</div>
    <div class="grid2">
      <div class="card stack"><h3>Recent classes</h3>${d.recent.length ? `<div class="list">${d.recent.map((s) => { const p = pct(s.present, s.enrolled); return `<div class="item" style="border-top:1px solid var(--line);padding-top:8px"><div><b>${esc(s.code)}</b>${s.is_demo ? ` <span class="pill mute">Demo</span>` : ""}<div class="small muted">${dt(s.opened_at)}${s.scheduled ? "" : " · make-up"}</div></div><div style="min-width:120px">${rateCell(p)}<div class="small muted" style="text-align:right">${s.present}/${s.enrolled} present</div></div></div>`; }).join("")}</div>` : `<p class="muted small">Finished classes appear here.</p>`}</div>
      <div class="card stack"><h3>Why attempts were blocked</h3>${d.reasons.length ? d.reasons.map((r) => `<div class="stack" style="gap:4px"><div class="row small"><span>${esc(RLABEL[r.stage] || r.stage)}</span><span class="spacer"></span><b class="mono">${r.n}</b></div><div class="bar-meter"><i style="width:${(100 * r.n) / maxReason}%;background:var(--bad)"></i></div></div>`).join("") : `<p class="muted small">No blocked attempts yet.</p>`}
        <h3 style="margin-top:8px">Latest blocked attempts</h3><div class="feed">${d.attempts.map((a) => `<div><time>${dt(a.at)}</time><b>${esc(a.full_name)}</b>${a.code ? ` · ${esc(a.code)}` : ""} · ${esc(a.reason)}</div>`).join("") || `<p class="muted small">None.</p>`}</div></div>
    </div>`;
  $("#dXls").onclick = (e) => excel({}, e.currentTarget);
  $$("[data-xls]").forEach((b) => (b.onclick = () => excel({ course_id: b.dataset.xls }, b)));
  SA.every(30000, () => { if ((location.hash || "#/") === "#/") dashboard(); });
}

/* ---------- Print report ---------- */
async function print(h) {
  SA.stopPoll();
  const courseId = (h.match(/^#\/print\/([\w-]+)/) || [])[1];
  view.innerHTML = `<p class="muted">Preparing the report…</p>`;
  let data; try { data = await api("export", courseId ? { course_id: courseId } : {}); } catch (x) { view.innerHTML = `<p class="err">${esc(x.message)}</p>`; return; }
  const me = SA.me();
  const back = courseId ? `#/course/${courseId}/reports` : me.role === "admin" ? "#/" : "#/";
  const sections = data.courses.map((c) => {
    const m = registerMatrix(c, data);
    const att = data.attempts.filter((a) => a.course_id === c.id).slice(0, 15);
    return `<section class="print-course">
      <h2>${esc(c.code)} · ${esc(c.title)}</h2>
      <p class="small muted">Lecturer: ${esc(c.lecturer)} · ${esc(c.venue || "")} · ${c.students} students · ${c.held} classes held · average attendance ${c.avg_rate == null ? "—" : c.avg_rate + "%"} · ${c.at_risk} below 75% · ${c.blocked} blocked attempts</p>
      ${m.studs.length && m.sess.length ? `<div class="tbl"><table class="matrix"><thead><tr>${m.head.map((x) => `<th>${esc(x)}</th>`).join("")}</tr></thead><tbody>
        ${m.rows.map((r) => `<tr>${r.map((v, i) => `<td class="${i >= 2 ? "n" : ""} ${v === "A" ? "abs" : ""} ${typeof r[r.length - 1] === "number" && r[r.length - 1] < 75 && i === r.length - 1 ? "low" : ""}">${esc(v)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
        <p class="small muted">P = present · P (no out) = didn't check out · E = excused · A = absent</p>` : `<p class="muted">No finished classes yet.</p>`}
      ${att.length ? `<h3>Recent blocked attempts</h3><table><thead><tr><th>When</th><th>Student</th><th>Reason</th></tr></thead><tbody>${att.map((a) => `<tr><td class="n">${esc(new Date(a.at).toLocaleString())}</td><td>${esc(a.full_name)}</td><td>${esc(a.reason)}</td></tr>`).join("")}</tbody></table>` : ""}
    </section>`;
  }).join("");
  view.innerHTML = `<div class="row noprint"><a class="btn" href="${back}">← Back</a><span class="spacer"></span><button class="btn primary" id="doPrint">Print / Save as PDF</button></div>
    <article class="print-doc">
      <header class="print-head"><img src="logo-mark.png" alt="" height="44"><div><h1>SmartAttend Attendance Report</h1><p class="small muted">${courseId && data.courses[0] ? esc(data.courses[0].code + " · " + data.courses[0].title) : "All courses"} · generated ${esc(new Date(data.generated_at).toLocaleString())} by ${esc(me.full_name)}</p></div></header>
      ${data.courses.length ? sections : `<p>No courses to report on yet.</p>`}
    </article>`;
  $("#doPrint").onclick = () => window.print();
}

/* ---------- Test lab ---------- */
const CHECKS = [
  ["Admin", [
    ["a1", "Run the system self-test", "Press 'Run self-test' below. Every line should be green."],
    ["a2", "Load the demo class", "Press 'Create demo data'. A course called DEMO 101 appears with 12 students and 6 past classes."],
    ["a3", "Open the dashboard", "Dashboard shows totals, the DEMO 101 row, recent classes and blocked-attempt reasons."],
    ["a4", "Download the Excel report", "Dashboard → Download Excel report. Open it: Summary, Students, DEMO 101 register, Classes, Check-ins, Blocked attempts, Class lists, Users, Business Model Canvas."],
    ["a5", "Print the report", "Dashboard → Print report. Choose 'Save as PDF' to keep a copy."],
    ["a6", "Change the lecturer access code", "People & settings → Lecturer access code → Save. A wrong code must then fail at lecturer sign-up."],
  ]],
  ["Lecturer (use the admin account on DEMO 101, or a lecturer account)", [
    ["l1", "Create a course with a timetable", "Courses → + New course. Add today's day and a time window that covers now."],
    ["l2", "Add a class list", "Course → Students → Add class list. Paste 'reg no, name' lines from Excel."],
    ["l3", "Start a class from the classroom", "Course → Live class → Start class. Allow location. Try it outside the timetable: it must ask for 'Make-up class'."],
    ["l4", "Watch the live register", "On DEMO 101, press 'Simulate 5 check-ins' below and watch the register fill within seconds."],
    ["l5", "See a blocked attempt", "Press 'Simulate a proxy attempt'. It appears under Blocked attempts in red."],
    ["l6", "Excuse an absent student", "Live class → Excuse next to an absent student, then Undo."],
    ["l7", "End class and run check-out", "End class & start check-out → 'Simulate check-outs' → Finish & save register."],
    ["l8", "Read the course report", "Reports tab: rates, 'At risk' flags, class history, Excel and Print."],
    ["l9", "Approve a student not on the list", "Join with a student account whose reg. no. isn't listed → Students → Approve."],
    ["l10", "Reset a student's phone", "Students → Reset phone. The student is asked to register again."],
  ]],
  ["Student (needs a real phone with fingerprint or face unlock)", [
    ["s1", "Create a student account", "Sign out → Create account → Student."],
    ["s2", "Register the phone", "Register this phone → confirm with fingerprint/face."],
    ["s3", "Join a course with its code", "Use the DEMO 101 join code shown below. You land in 'Waiting for approval' (you're not on the demo list) until approved."],
    ["s4", "Check in successfully", "With a class open and the phone in the room: Check in → all 6 checks turn green."],
    ["s5", "Get refused for distance", "Walk well outside the zone (or ask the lecturer to start the class elsewhere) → Location fails."],
    ["s6", "Get refused on another phone", "Sign in to the same student account on a second phone → Check in → fingerprint step fails and is logged."],
    ["s7", "Cancel the fingerprint", "Check in, then cancel the fingerprint prompt → 'Not confirmed' and a blocked attempt is logged."],
    ["s8", "Check out", "After the lecturer ends the class: Check out → green."],
    ["s9", "See your attendance rate", "Home → My attendance shows the percentage and the 75% warning."],
  ]],
];
function loadDone() { try { return JSON.parse(localStorage.getItem("sa.tests") || "{}"); } catch { return {}; } }
function saveDone(d) { try { localStorage.setItem("sa.tests", JSON.stringify(d)); } catch {} }
async function testLab() {
  SA.stopPoll();
  view.innerHTML = `${nav("test")}<p class="muted">Loading…</p>`;
  let st; try { st = await api("demo.status"); } catch (x) { view.innerHTML = `${nav("test")}<p class="err">${esc(x.message)}</p>`; return; }
  const d = st.demo, done = loadDone();
  const all = CHECKS.flatMap(([, items]) => items), n = all.filter(([k]) => done[k]).length;
  view.innerHTML = `${nav("test")}
    <div><span class="eyebrow">Admin</span><h1>Test lab</h1><p class="muted small">Everything you need to try every feature, with demo data you can remove at any time. Demo students can't sign in and are clearly marked in reports.</p></div>
    <div class="grid2">
      <div class="card stack"><h3>1 · Demo class</h3>
        ${d ? `<p><b>${esc(d.code)}</b> · ${esc(d.title)}<br><span class="small muted">${d.students} students · ${d.held} past classes · timetable open all day, every day · zone 100 m</span></p>
          <div class="row"><span class="small muted">Join code</span><span class="code-big" style="font-size:24px">${esc(d.join_code)}</span><button class="btn small" id="cpJoin">Copy</button></div>
          <div class="row"><a class="btn primary" href="#/course/${d.id}/live">Open live class</a><a class="btn" href="#/course/${d.id}/reports">Reports</a><button class="btn danger" id="demoClear">Remove demo data</button></div>`
        : `<p class="small muted">Creates DEMO 101 with 12 demo students, a class list, 6 finished classes with realistic attendance and some blocked attempts. You become its lecturer.</p><button class="btn primary" id="demoSeed">Create demo data</button>`}
      </div>
      <div class="card stack"><h3>2 · Simulate students</h3>
        ${!d ? `<p class="small muted">Create the demo class first.</p>` : !d.live ? `<p class="small muted">Start a class on DEMO 101 (Open live class → Start class), then come back here or keep this tab open on another device.</p><a class="btn" href="#/course/${d.id}/live">Start a demo class</a>`
        : `<p class="small muted">A demo class is <b>${d.live.status === "open" ? "open for check-in" : "in check-out"}</b>. Open the live register on another screen to watch it update.</p>
          <div class="row"><button class="btn" data-sim="in" ${d.live.status === "open" ? "" : "disabled"}>Simulate 5 check-ins</button><button class="btn" data-sim="attack">Simulate a proxy attempt</button><button class="btn" data-sim="out" ${d.live.status === "checkout" ? "" : "disabled"}>Simulate check-outs</button></div>
          <a class="btn ghost small" href="#/course/${d.id}/live">Go to live register →</a>`}
        <p class="small muted">Simulation only ever touches demo students. Real students always need their own phone, location and fingerprint.</p>
      </div>
    </div>
    <div class="card stack"><div class="row"><h3>3 · Full-cycle test</h3><span class="spacer"></span><button class="btn primary" id="e2eRun">Run full-cycle test</button></div>
      <p class="small muted">Runs a whole class on the live system with 4 virtual students and their virtual phones. Each phone has its own real security key, its fingerprint can be confirmed or cancelled, and you control where it is. Steps: sign-up, course and class list, joining, phone registration, start class, check-in (including far away, weak GPS, cancelled fingerprint, a friend's phone, a forged signature, late arrival), check-out, excusing, saving the register, reports and timetable rules. Every request goes through the same server checks a real phone does. The test accounts are deleted afterwards. It takes a few seconds.</p>
      <div id="e2eOut"></div></div>
    <div class="card stack"><div class="row"><h3>4 · System self-test</h3><span class="spacer"></span><button class="btn" id="selfTest">Run self-test</button></div><div id="stOut" class="list"></div></div>
    <div class="card stack"><div class="row"><h3>5 · Start fresh before going live</h3><span class="spacer"></span><button class="btn danger" id="resetAll">Delete all data…</button></div>
      <p class="small muted">Deletes every account, course, class and attendance record except <b>your</b> admin account. Access codes and allowed websites stay. Use this once, after testing and before real students join. It can't be undone.</p></div>
    <div class="card stack"><div class="row"><h3>6 · Full test checklist</h3><span class="spacer"></span><span class="small muted"><b>${n}</b> of ${all.length} done</span><button class="btn ghost small" id="resetChecks">Clear ticks</button></div>
      <div class="bar-meter"><i style="width:${(100 * n) / all.length}%"></i></div>
      ${CHECKS.map(([group, items]) => `<div class="stack" style="gap:8px"><span class="eyebrow" style="margin-top:8px">${esc(group)}</span>
        ${items.map(([k, title, how]) => `<label class="check test-item"><input type="checkbox" data-k="${k}" ${done[k] ? "checked" : ""}><span><b>${esc(title)}</b><br><span class="small muted">${esc(how)}</span></span></label>`).join("")}</div>`).join("")}
    </div>`;
  const s1 = $("#demoSeed"); if (s1) s1.onclick = async () => { busy(s1, true, "Creating…"); try { await api("demo.seed"); toast("Demo class created"); testLab(); } catch (x) { toast(x.message); busy(s1, false); } };
  const s2 = $("#demoClear"); if (s2) s2.onclick = async () => { if (!confirm("Remove the demo class, its demo students and all their records?")) return; busy(s2, true, "Removing…"); try { await api("demo.clear"); toast("Demo data removed"); testLab(); } catch (x) { toast(x.message); busy(s2, false); } };
  const cj = $("#cpJoin"); if (cj) cj.onclick = () => SA.copy(d.join_code);
  $$("[data-sim]").forEach((b) => (b.onclick = async () => { busy(b, true, "Simulating…"); try { const r = await api("demo.simulate", { session_id: d.live.id, kind: b.dataset.sim, count: 5 }); toast(b.dataset.sim === "attack" ? "Proxy attempt blocked and logged" : `${r.done} demo student${r.done === 1 ? "" : "s"} ${b.dataset.sim === "in" ? "checked in" : "checked out"}`); } catch (x) { toast(x.message); } busy(b, false); }));
  $("#selfTest").onclick = async (e) => { const b = e.currentTarget; busy(b, true, "Testing…"); try { const r = await api("selftest"); $("#stOut").innerHTML = r.results.map((x) => `<div class="item" style="border-top:1px solid var(--line);padding-top:6px"><div><b>${esc(x.name)}</b><div class="small muted">${esc(x.detail)}</div></div><span class="pill ${x.ok ? "ok" : "bad"}">${x.ok ? "Pass" : "Fail"}</span></div>`).join("") + `<div class="item" style="border-top:1px solid var(--line);padding-top:6px"><div><b>This phone/browser</b><div class="small muted">Secure page: ${window.isSecureContext ? "yes" : "no"} · Location: ${"geolocation" in navigator ? "available" : "missing"} · Fingerprint/passkeys: ${window.SimpleWebAuthnBrowser?.browserSupportsWebAuthn() ? "supported" : "not supported"}</div></div><span class="pill ${window.isSecureContext && window.SimpleWebAuthnBrowser?.browserSupportsWebAuthn() ? "ok" : "warn"}">${window.isSecureContext ? "Pass" : "Check"}</span></div>`; } catch (x) { toast(x.message); } busy(b, false); };
  $$("[data-k]").forEach((c) => (c.onchange = () => { const dd = loadDone(); dd[c.dataset.k] = c.checked; saveDone(dd); testLab(); }));
  $("#resetChecks").onclick = () => { saveDone({}); testLab(); };
  $("#e2eRun").onclick = async (e) => {
    const b = e.currentTarget, out = $("#e2eOut");
    busy(b, true, "Running…"); out.innerHTML = `<p class="small muted">Running a full class with 4 virtual students…</p>`;
    try {
      const r = await api("e2e.run");
      let g = "";
      out.innerHTML = `<div class="row" style="margin:6px 0"><span class="pill ${r.failed ? "bad" : "ok"}" style="font-size:14px">${r.failed ? `${r.failed} failed` : "All passed"}</span><span class="small muted">${r.passed} of ${r.passed + r.failed} steps passed · ${r.seconds}s · ${esc(new Date().toLocaleString())} · run ${esc(r.run)}</span><span class="spacer"></span><button class="btn small" id="e2eCopy">Copy results</button></div>
        <div class="list">${r.steps.map((s) => `${s.group !== g ? `<span class="eyebrow" style="margin-top:10px">${esc((g = s.group))}</span>` : ""}<div class="item" style="border-top:1px solid var(--line);padding-top:6px"><div><b>${esc(s.name)}</b><div class="small muted">Expected: ${esc(s.expect)} · Got: ${esc(s.got)}</div></div><span class="pill ${s.pass ? "ok" : "bad"}">${s.pass ? "Pass" : "Fail"}</span></div>`).join("")}</div>`;
      $("#e2eCopy").onclick = () => SA.copy(`SmartAttend full-cycle test · ${new Date().toLocaleString()} · ${r.passed}/${r.passed + r.failed} passed\n` + r.steps.map((s) => `${s.pass ? "PASS" : "FAIL"} · ${s.group} · ${s.name} · ${s.got}`).join("\n"));
      toast(r.failed ? `${r.failed} step(s) failed` : "Full cycle passed");
    } catch (x) { out.innerHTML = `<p class="err">${esc(x.message)}</p>`; try { await api("e2e.cleanup"); } catch {} }
    busy(b, false);
  };
  $("#resetAll").onclick = async (e) => {
    const typed = prompt("This deletes every account, course and attendance record except your own admin account.\n\nType RESET to confirm.");
    if (typed === null) return;
    const b = e.currentTarget; busy(b, true, "Deleting…");
    try { const r = await api("admin.reset", { confirm: typed.trim() }); toast(`Done: ${r.removed_users} accounts and ${r.removed_courses} courses deleted`); testLab(); }
    catch (x) { toast(x.message); busy(b, false); }
  };
}


/* ---------- Timetable ---------- */
// Makerere University · COBAMS · MBA Year One · Semester 1, 2026/2027 (from the official teaching timetable)
const E = ["17:30", "19:30"], L = ["19:30", "21:30"];
const FAC = { "MBD 7101": "Mr. Hussein Kintu (lead), Mr. John Ogema", "MBD 7102": "Dr. Henry Mbidde (lead), Dr. Sarah Bimbona", "MBD 7103": "Prof. Godfrey Akileng (lead), Dr. Diana L.K Sekiboobo", "MBD 7104": "Dr. Kasimu Sendawula (lead), Dr. Cathy Mbidde", "MBD 7105": "Prof. Umar Kakumba (lead), Dr. Christopher Muganga" };
const TITLE = { "MBD 7101": "Financial Accounting", "MBD 7102": "Marketing Management", "MBD 7103": "Quantitative Methods", "MBD 7104": "Entrepreneurship", "MBD 7105": "General Management" };
const GRID = {
  "Group A": { venue: "CTF2 Room 5.1", days: { 1: ["MBD 7104", "MBD 7103"], 2: ["MBD 7101", "MBD 7104"], 3: ["MBD 7103", "MBD 7105"], 4: ["MBD 7102", "MBD 7101"], 5: ["MBD 7105", "MBD 7102"] } },
  "Group B": { venue: "FEMA Block A, Room 2.2 (COBAMS)", days: { 1: ["MBD 7103", "MBD 7105"], 2: ["MBD 7103", "MBD 7101"], 3: ["MBD 7105", "MBD 7104"], 4: ["MBD 7101", "MBD 7102"], 5: ["MBD 7102", "MBD 7104"] } },
};
const MBA1_TERM_START = "2026-08-10";
function mba1Preset() {
  const out = [];
  for (const [group, g] of Object.entries(GRID)) for (const code of Object.keys(TITLE)) {
    const slots = [];
    for (const [d, pair] of Object.entries(g.days)) pair.forEach((cc, i) => { if (cc === code) slots.push({ weekday: +d, start: (i ? L : E)[0], end: (i ? L : E)[1] }); });
    out.push({ code, title: TITLE[code], group, venue: g.venue, facilitators: FAC[code], slots });
  }
  return out;
}
async function timetable() {
  SA.stopPoll();
  view.innerHTML = `${nav("timetable")}<p class="muted">Loading timetable…</p>`;
  let d; try { d = await api("admin.timetable"); } catch (x) { view.innerHTML = `${nav("timetable")}<p class="err">${esc(x.message)}</p>`; return; }
  const ck = d.clock;
  const real = d.courses.filter((c) => !c.is_demo);
  const groups = [...new Set(real.map((c) => c.group_name || "Ungrouped"))];
  const imported = real.some((c) => c.code === "MBD 7101" && c.group_name === "Group A");
  const lecturers = d.lecturers;
  const toMin = (h) => { const [a, b] = h.split(":").map(Number); return a * 60 + b; };
  const periods = (cs) => [...new Map(cs.flatMap((c) => c.slots || []).map((s) => [s.start + "-" + s.end, s])).values()].sort((a, b) => toMin(a.start) - toMin(b.start));
  const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const cell = (c, s) => {
    const isToday = s.weekday === ck.dow, now = isToday && ck.mins >= s.smin - 15 && ck.mins <= s.emin;
    const live = c.live && isToday && now;
    return `<div class="tt-cell ${live ? "live" : now ? "now" : ""}"><div class="row" style="gap:6px"><b>${esc(c.code)}</b>${live ? `<span class="pill ok"><span class="dot"></span>Live</span>` : now ? `<span class="pill warn">Due now</span>` : ""}</div>
      <span class="small">${esc(TITLE[c.code] || c.title.replace(/ — .*$/, ""))}</span>
      <span class="small muted">${esc(c.facilitators || "")}</span>
      <select data-assign="${c.id}" aria-label="Lecturer for ${esc(c.code)} ${esc(c.group_name || "")}">${lecturers.map((l) => `<option value="${l.id}" ${l.id === c.lecturer_id ? "selected" : ""}>${esc(l.full_name)}${l.role === "admin" ? " (admin)" : ""}</option>`).join("")}</select>
      <div class="row small" style="gap:8px"><span class="muted">Code <b class="mono">${esc(c.join_code)}</b></span><span class="muted">${c.students} students</span><a href="#/course/${c.id}/live">Open</a></div></div>`;
  };
  const groupGrid = (g) => {
    const cs = real.filter((c) => (c.group_name || "Ungrouped") === g);
    const per = periods(cs);
    const days = [1, 2, 3, 4, 5, 6, 0].filter((w) => cs.some((c) => (c.slots || []).some((s) => s.weekday === w)));
    if (!per.length) return "";
    return `<div class="card stack"><div class="row"><h3>${esc(g)}</h3><span class="small muted">${esc(cs[0]?.venue || "")}</span>${cs[0]?.term_start ? `<span class="pill mute">Teaching starts ${esc(fmtDate(cs[0].term_start))}</span>` : ""}</div>
      <div class="tbl"><div class="tt-grid" style="grid-template-columns:110px repeat(${per.length},minmax(170px,1fr))"><div class="h">Day</div>${per.map((p) => `<div class="h">${t12(p.start)}–${t12(p.end)}</div>`).join("")}
      ${days.map((w) => `<div class="tt-rowh ${w === ck.dow ? "today" : ""}">${DAYS[w]}${w === ck.dow ? "<br><span class='small'>today</span>" : ""}</div>${per.map((p) => { const c = cs.find((x) => (x.slots || []).some((s) => s.weekday === w && s.start === p.start)); const s = c && c.slots.find((x) => x.weekday === w && x.start === p.start); return c ? cell(c, s) : `<div class="tt-cell"><span class="muted small">—</span></div>`; }).join("")}`).join("")}
      </div></div></div>`;
  };
  view.innerHTML = `${nav("timetable")}
    <div class="row"><div><span class="eyebrow">Admin</span><h1>Timetable</h1><p class="small muted">It's ${DAYS[ck.dow]} ${t12(ck.hm)} in Kampala. Check-in only works during a course's timetabled slot (from 15 minutes before it starts), classes switch to check-out 15 minutes after the slot ends, and registers save themselves 45 minutes after it ends.</p></div></div>
    <div class="card stack"><div class="row"><h3>MBA Year One · Semester 1 (2026/2027)</h3><span class="spacer"></span>${imported ? `<span class="pill ok">Loaded</span>` : ""}</div>
      <p class="small muted">Creates the 10 course groups from the COBAMS teaching timetable: MBD 7101 to 7105 for Group A (CTF2 Room 5.1) and Group B (FEMA Block A, Room 2.2), 5:30–7:30 pm and 7:30–9:30 pm slots, facilitators, and teaching starting ${fmtDate(MBA1_TERM_START)}. ${imported ? "Loading it again updates times, venues and facilitators without touching students or records." : ""}</p>
      <div class="row"><button class="btn ${imported ? "" : "primary"}" id="ttImport">${imported ? "Reload timetable" : "Load this timetable"}</button>${imported ? `<button class="btn primary" id="ttAuto">Auto-assign lecturers by name</button>` : ""}</div>
      <p class="small muted">Give each course its lecturer from the drop-down in its box, or press <b>Auto-assign</b>: SmartAttend matches lecturer accounts to the facilitators on the timetable by surname (e.g. an account named "Dr. Henry Mbidde" gets MBD 7102 in both groups). Lecturers can also add their own timetabled courses from "+ New course".</p></div>
    ${groups.map(groupGrid).join("") || `<p class="muted">No timetabled courses yet.</p>`}`;
  $("#ttImport").onclick = async (e) => { const b = e.currentTarget; busy(b, true, "Loading…"); try { const r = await api("timetable.import", { term_start: window.SA_CATALOG.PROGRAMMES[0].term_start, courses: window.SA_CATALOG.all(window.SA_CATALOG.PROGRAMMES[0]) }); toast(`Timetable loaded: ${r.created} new, ${r.updated} updated`); timetable(); } catch (x) { toast(x.message); busy(b, false); } };
  const au = $("#ttAuto"); if (au) au.onclick = async () => {
    const C = window.SA_CATALOG; const lect = lecturers.filter((l) => l.role === "lecturer");
    const plan = [];
    for (const c of real) {
      const fac = (c.facilitators || "").split(",").map((x) => x.replace(/\(lead\)/i, "").trim()).filter(Boolean);
      const lead = fac[0];
      const hits = lect.filter((l) => fac.some((f) => C.nameMatch(l.full_name, f) >= 2)).sort((x, y) => Math.max(...fac.map((f) => C.nameMatch(y.full_name, f))) - Math.max(...fac.map((f) => C.nameMatch(x.full_name, f))));
      if (!hits.length) continue;
      const pick = hits.find((l) => C.nameMatch(l.full_name, lead) === 3) || hits.find((l) => fac.some((f) => C.nameMatch(l.full_name, f) === 3)) || hits.find((l) => C.nameMatch(l.full_name, lead) === 2) || hits[0];   // prefer the team leader
      if (pick.id !== c.lecturer_id) plan.push({ c, l: pick });
    }
    if (!plan.length) { toast(lect.length ? "No new matches. Lecturer names don't match any facilitator surnames yet." : "No lecturer accounts yet. Lecturers sign up with the lecturer access code first."); return; }
    if (!confirm(`Assign ${plan.length} course${plan.length > 1 ? "s" : ""}?\n\n` + plan.map((p) => `${p.c.code} ${p.c.group_name || ""} → ${p.l.full_name}`).join("\n"))) return;
    busy(au, true, "Assigning…");
    for (const p of plan) { try { await api("admin.assignLecturer", { course_id: p.c.id, lecturer_id: p.l.id }); } catch (x) { toast(x.message); } }
    toast(`${plan.length} course${plan.length > 1 ? "s" : ""} assigned`); timetable();
  };
  $$("[data-assign]").forEach((sel) => (sel.onchange = async () => { try { await api("admin.assignLecturer", { course_id: sel.dataset.assign, lecturer_id: sel.value }); toast("Lecturer assigned"); } catch (x) { toast(x.message); } }));
  SA.every(60000, () => { if (location.hash === "#/admin/timetable") timetable(); });
}

/* ---------- Business Model Canvas ---------- */
async function canvas() {
  SA.stopPoll();
  let d = null; try { d = await api("admin.dashboard"); } catch {}
  const t = d?.totals;
  const live = t ? { cs: `${t.students} students · ${t.lecturers} lecturers · ${t.courses} courses on SmartAttend`, vp: `${t.blocked} proxy / fraud attempts blocked · ${t.checkins} verified check-ins`, ka: `${t.sessions} classes run · ${t.phones} phones registered`, cr: t.pending ? `${t.pending} join requests waiting for approval` : "Self-service sign-up and join codes live" } : {};
  const block = ([title, key, items]) => `<div class="bmc-cell bmc-${key}"><h3>${esc(title)}</h3><ul>${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>${live[key] ? `<p class="bmc-live">${esc(live[key])}</p>` : ""}</div>`;
  const B = Object.fromEntries(CANVAS.blocks.map((b) => [b[1], b]));
  view.innerHTML = `${nav("canvas")}
    <div class="row"><div><span class="eyebrow">Expo</span><h1>Business Model Canvas</h1><p class="small muted">SmartAttend — Smart Student Attendance Management System</p></div><span class="spacer"></span><button class="btn noprint" id="bmcPrint">Print canvas</button></div>
    <div class="card"><p>${esc(CANVAS.abstract)}</p></div>
    <div class="bmc">
      ${block(B.kp)}${block(B.ka)}${block(B.vp)}${block(B.cr)}${block(B.cs)}${block(B.kr)}${block(B.ch)}${block(B.co)}${block(B.rs)}
    </div>
    <p class="small muted">Green lines show live figures from this system, so the canvas doubles as traction evidence at the expo.</p>`;
  $("#bmcPrint").onclick = () => window.print();
}

window.SAX = { nav, toolsRow, dashboard, excel, print, testLab, canvas, timetable };
})();
