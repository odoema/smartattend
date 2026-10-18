// SmartAttend API — single edge function. All data lives in the private `smartattend` schema.
// Auth: own email/password accounts (bcrypt via pgcrypto) + opaque bearer tokens.
// Device binding + biometrics: WebAuthn platform authenticator with user verification required.
import postgres from "npm:postgres@3.4.4";
import {
  generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse,
} from "npm:@simplewebauthn/server@10.0.1";
import { isoBase64URL } from "npm:@simplewebauthn/server@10.0.1/helpers";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { max: 3, prepare: false });
const TZ = "Africa/Kampala";
const CHECKIN_EARLY_MIN = 15;   // check-in opens this many minutes before a slot starts
const CHECKOUT_GRACE_MIN = 45;  // check-out allowed until this long after slot end; class auto-closes then
const AUTO_CHECKOUT_AFTER_MIN = 15; // an open class switches to check-out this long after its timetabled end
const MAX_GPS_ACCURACY = 150;   // metres; weaker fixes are refused
const ACC_ALLOWANCE = 30;       // metres of GPS uncertainty forgiven on top of the radius

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-client-info, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
class HttpError extends Error { constructor(public status: number, msg: string, public extra?: unknown) { super(msg); } }
const fail = (status: number, msg: string, extra?: unknown) => { throw new HttpError(status, msg, extra); };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

async function sha256(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function randToken(n = 32) { return isoBase64URL.fromBuffer(crypto.getRandomValues(new Uint8Array(n))); }
function haversine(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371000, r = (x: number) => (x * Math.PI) / 180;
  const dLa = r(b.lat - a.lat), dLo = r(b.lng - a.lng);
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const str = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uid = (v: unknown, what = "Record") => { const x = str(v, 40); if (!UUID.test(x)) fail(404, what + " not found."); return x; };
const num = (v: unknown) => (typeof v === "number" && isFinite(v) ? v : null);
function joinCode() { const a = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; return [...crypto.getRandomValues(new Uint8Array(6))].map((b) => a[b % a.length]).join(""); }

async function setting(key: string) { const [r] = await sql`select value from smartattend.settings where key=${key}`; return r?.value ?? ""; }
async function originInfo(req: Request) {
  const origin = req.headers.get("origin") || "";
  let url: URL; try { url = new URL(origin); } catch { fail(400, "This request didn't come from a web page."); }
  const allowed = (await setting("allowed_origins")).split(",").map((s) => s.trim()).filter(Boolean);
  const local = url!.hostname === "localhost" || url!.hostname === "127.0.0.1";
  if (allowed.length ? !allowed.includes(origin) : !(url!.protocol === "https:" || local)) fail(403, "This website isn't allowed to use SmartAttend.");
  return { origin, rpID: url!.hostname };
}

/* ---------- auth ---------- */
async function currentUser(req: Request) {
  const h = req.headers.get("authorization") || "";
  const tok = h.startsWith("Bearer ") ? h.slice(7) : "";
  if (!tok || tok.split(".").length === 3) return null; // a JWT is the platform anon key, not our session
  const [u] = await sql`select u.id, u.role, u.full_name, u.email, u.reg_no from smartattend.tokens t join smartattend.users u on u.id=t.user_id
    where t.token_hash=${await sha256(tok)} and t.expires_at>now()`;
  return u || null;
}
function need(u: any, ...roles: string[]) { if (!u) fail(401, "Please sign in again."); if (roles.length && !roles.includes(u.role)) fail(403, "Your account can't do that."); return u; }
async function issue(userId: string) { const t = randToken(); await sql`insert into smartattend.tokens(token_hash,user_id) values(${await sha256(t)},${userId})`; return t; }

async function signup(b: any) {
  const role = ["student", "lecturer", "admin"].includes(b.role) ? b.role : "student";
  const full_name = str(b.full_name, 120), email = str(b.email, 160).toLowerCase(), password = typeof b.password === "string" ? b.password : "";
  const reg_no = role === "student" ? str(b.reg_no, 40).toUpperCase().replace(/\s+/g, "") : null;
  if (full_name.length < 3) fail(400, "Enter your full name.");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail(400, "Enter a valid email address.");
  if (password.length < 6) fail(400, "Use a password of at least 6 characters.");
  if (role === "student" && reg_no!.length < 4) fail(400, "Enter your registration number.");
  if (role !== "student") {
    const code = await setting(role === "admin" ? "admin_code" : "lecturer_code");
    if (str(b.code, 40).toUpperCase() !== code) fail(403, role === "admin" ? "That admin access code is wrong." : "That lecturer access code is wrong. Ask your ICT office for it.");
  }
  const dup = await sql`select email, reg_no from smartattend.users where email=${email} or (reg_no is not null and reg_no=${reg_no})`;
  if (dup.length) fail(409, dup[0].email === email ? "An account with this email already exists. Sign in instead." : "This registration number already has an account.");
  const [u] = await sql`insert into smartattend.users(role,full_name,email,reg_no,password_hash)
    values(${role},${full_name},${email},${reg_no},extensions.crypt(${password}, extensions.gen_salt('bf', 10))) returning id`;
  return { token: await issue(u.id) };
}
async function login(b: any) {
  const email = str(b.email, 160).toLowerCase(), password = typeof b.password === "string" ? b.password : "";
  const [u] = await sql`select id from smartattend.users where (email=${email} or reg_no=${email.toUpperCase()}) and password_hash=extensions.crypt(${password}, password_hash)`;
  if (!u) fail(401, "Email or password is wrong.");
  return { token: await issue(u.id) };
}

/* ---------- timetable helpers (Kampala time) ---------- */
async function slotState(courseId: string, kind: "in" | "out" | "open") {
  // returns the slot the current Kampala time falls in, with tolerances per action
  const early = kind === "out" ? 0 : CHECKIN_EARLY_MIN, late = kind === "out" ? CHECKOUT_GRACE_MIN : 0;
  const [r] = await sql`with n as (select (now() at time zone ${TZ}) as t)
    select s.weekday, to_char(s.start_time,'HH24:MI') st, to_char(s.end_time,'HH24:MI') en, to_char(n.t,'HH24:MI') now_hm
    from smartattend.slots s, n where s.course_id=${courseId} and s.weekday=extract(dow from n.t)::int
      and extract(epoch from n.t::time)/60 between extract(epoch from s.start_time)/60 - ${early} and extract(epoch from s.end_time)/60 + ${late}
    order by s.start_time limit 1`;
  const [n] = await sql`select to_char(now() at time zone ${TZ},'Dy HH24:MI') hm`;
  return { slot: r || null, now: n.hm };
}

/* timetable-driven housekeeping: classes move to check-out and close on their own after the slot ends */
let lastSweep = 0;
async function sweep() {
  if (Date.now() - lastSweep < 20000) return;
  lastSweep = Date.now();
  await sql`update smartattend.sessions set status='checkout', closed_at=coalesce(closed_at, now())
    where status='open' and ends_at is not null and now() > ends_at + make_interval(mins=>${AUTO_CHECKOUT_AFTER_MIN})`;
  await sql`update smartattend.sessions set status='closed', closed_at=coalesce(closed_at, now()), finalised_at=now()
    where status='checkout' and ends_at is not null and now() > ends_at + make_interval(mins=>${CHECKOUT_GRACE_MIN})`;
}
async function clock() {
  const [c] = await sql`select extract(dow from now() at time zone ${TZ})::int dow, to_char(now() at time zone ${TZ},'HH24:MI') hm,
    (extract(epoch from (now() at time zone ${TZ})::time)/60)::int mins, to_char(now() at time zone ${TZ},'YYYY-MM-DD') date`;
  return c;
}

/* ---------- device registration ---------- */
async function deviceOptions(req: Request, u: any) {
  const { rpID } = await originInfo(req);
  const [active] = await sql`select id from smartattend.devices where user_id=${u.id} and revoked_at is null`;
  if (active) fail(409, "This account already has a registered phone. Ask your lecturer to reset it if you changed phones.");
  const opts = await generateRegistrationOptions({
    rpName: "SmartAttend", rpID, userName: u.reg_no || u.email, userDisplayName: u.full_name,
    userID: new TextEncoder().encode(u.id), attestationType: "none", timeout: 60000,
    authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required", residentKey: "preferred" },
  });
  await sql`insert into smartattend.challenges(user_id,purpose,challenge) values(${u.id},'register',${opts.challenge})
    on conflict(user_id,purpose) do update set challenge=excluded.challenge, created_at=now(), context=null`;
  return opts;
}
async function deviceVerify(req: Request, u: any, b: any) {
  const { origin, rpID } = await originInfo(req);
  const [ch] = await sql`delete from smartattend.challenges where user_id=${u.id} and purpose='register' and created_at>now()-interval '5 minutes' returning challenge`;
  if (!ch) fail(400, "The phone registration timed out. Try again.");
  let v;
  try { v = await verifyRegistrationResponse({ response: b.credential, expectedChallenge: ch.challenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true }); }
  catch (e) { fail(400, "The phone couldn't be verified: " + (e as Error).message); }
  if (!v!.verified || !v!.registrationInfo) fail(400, "The phone couldn't be verified.");
  const info = v!.registrationInfo!;
  const taken = await sql`select 1 from smartattend.devices where credential_id=${info.credentialID}`;
  if (taken.length) fail(409, "This phone credential is already registered.");
  try {
    await sql`insert into smartattend.devices(user_id,credential_id,public_key,counter,transports,label,rp_id,origin)
      values(${u.id},${info.credentialID},${isoBase64URL.fromBuffer(info.credentialPublicKey)},${info.counter},${b.credential?.response?.transports || null},${str(b.label, 80) || null},${rpID},${origin})`;
  } catch { fail(409, "This account already has a registered phone."); }
  return { ok: true };
}

/* ---------- check-in / check-out ---------- */
async function logAttempt(sessionId: string | null, studentId: string, mode: string, stage: string, reason: string) {
  await sql`insert into smartattend.attempts(session_id,student_id,mode,stage,reason) values(${sessionId},${studentId},${mode},${stage},${reason})`;
}
type Check = { key: string; ok: boolean; note: string };
async function prechecks(req: Request, u: any, b: any) {
  const mode = b.mode === "out" ? "out" : "in";
  const checks: Check[] = [];
  const stop = async (key: string, note: string, sessionId: string | null, log = true) => {
    checks.push({ key, ok: false, note });
    if (log) await logAttempt(sessionId, u.id, mode, key, note);
    throw new HttpError(422, note, { checks });
  };
  const [s] = await sql`select s.*, c.code, c.title from smartattend.sessions s join smartattend.courses c on c.id=s.course_id where s.id=${uid(b.session_id, "Class session")}`;
  if (!s) await stop("session", "That class session doesn't exist.", null, false);
  const [en] = await sql`select status from smartattend.enrollments where course_id=${s.course_id} and student_id=${u.id}`;
  if (!en) await stop("account", `Your account isn't enrolled on ${s.code}.`, s.id);
  if (en.status !== "active") await stop("account", `Your request to join ${s.code} is still waiting for the lecturer's approval.`, s.id);
  const [rec] = await sql`select * from smartattend.attendance where session_id=${s.id} and student_id=${u.id}`;
  if (mode === "in" && rec) await stop("account", "You're already checked in to this class.", s.id, false);
  if (mode === "out" && !rec) await stop("account", "You didn't check in to this class, so you can't check out.", s.id);
  if (mode === "out" && rec?.check_out_at) await stop("account", "You've already checked out.", s.id, false);
  checks.push({ key: "account", ok: true, note: `${u.full_name} · enrolled on ${s.code}` });

  if (mode === "in" && s.status !== "open") await stop("session", s.status === "checkout" ? "Check-in has closed. The lecturer has ended the class." : "This class session has ended.", s.id);
  if (mode === "out" && s.status !== "checkout") await stop("session", s.status === "open" ? "Check-out starts when your lecturer closes the class." : "This class session has ended.", s.id, false);
  checks.push({ key: "session", ok: true, note: mode === "in" ? "Opened by your lecturer" : "Check-out window is open" });

  if (s.scheduled) {
    const t = await slotState(s.course_id, mode);
    if (!t.slot) await stop("timetable", `It's ${t.now}, outside the timetabled time for ${s.code}.`, s.id);
    checks.push({ key: "timetable", ok: true, note: `${t.slot.st}–${t.slot.en} · now ${t.now}` });
  } else checks.push({ key: "timetable", ok: true, note: "Make-up class approved by the lecturer" });

  const [dev] = await sql`select * from smartattend.devices where user_id=${u.id} and revoked_at is null`;
  if (!dev) await stop("device", "This account has no registered phone yet. Register your phone first.", s.id, false);
  checks.push({ key: "device", ok: true, note: "Registered phone on file" });

  const lat = num(b.lat), lng = num(b.lng), acc = num(b.acc);
  if (lat === null || lng === null) await stop("location", "Your location couldn't be read. Turn on location and allow it for this site.", s.id);
  if (acc !== null && acc > MAX_GPS_ACCURACY) await stop("location", `GPS signal is too weak (±${Math.round(acc!)} m). Move near a window and try again.`, s.id);
  const d = Math.round(haversine({ lat: s.lat, lng: s.lng }, { lat: lat!, lng: lng! }));
  const allowance = s.radius_m + Math.min(acc ?? 0, ACC_ALLOWANCE);
  if (d > allowance) await stop("location", `You're ${d >= 1000 ? (d / 1000).toFixed(1) + " km" : d + " m"} from the class. You need to be within ${s.radius_m} m.`, s.id);
  checks.push({ key: "location", ok: true, note: `${d} m from the class (limit ${s.radius_m} m)` });
  return { s, dev, mode, d, acc, checks };
}
async function checkOptions(req: Request, u: any, b: any) {
  await originInfo(req);
  const { s, dev, mode, checks } = await prechecks(req, u, b);
  const opts = await generateAuthenticationOptions({
    rpID: dev.rp_id, userVerification: "required", timeout: 60000,
    allowCredentials: [{ id: dev.credential_id, transports: dev.transports || undefined }],
  });
  await sql`insert into smartattend.challenges(user_id,purpose,challenge,context) values(${u.id},'attend',${opts.challenge},${sql.json({ session: s.id, mode })})
    on conflict(user_id,purpose) do update set challenge=excluded.challenge, context=excluded.context, created_at=now()`;
  return { options: opts, checks };
}
async function checkVerify(req: Request, u: any, b: any) {
  const { origin } = await originInfo(req);
  const { s, dev, mode, d, acc, checks } = await prechecks(req, u, b);
  const [ch] = await sql`delete from smartattend.challenges where user_id=${u.id} and purpose='attend' and created_at>now()-interval '3 minutes' returning challenge, context`;
  if (!ch || ch.context?.session !== s.id || ch.context?.mode !== mode) fail(400, "The fingerprint request timed out. Try again.", { checks });
  const bad = async (note: string) => { checks.push({ key: "biometric", ok: false, note }); await logAttempt(s.id, u.id, mode, "biometric", note); throw new HttpError(422, note, { checks }); };
  if (b.credential?.id !== dev.credential_id) await bad("This isn't the phone registered to your account.");
  if (origin !== dev.origin) await bad("This phone was registered on a different website.");
  let v;
  try {
    v = await verifyAuthenticationResponse({
      response: b.credential, expectedChallenge: ch.challenge, expectedOrigin: dev.origin, expectedRPID: dev.rp_id, requireUserVerification: true,
      authenticator: { credentialID: dev.credential_id, credentialPublicKey: isoBase64URL.toBuffer(dev.public_key), counter: Number(dev.counter), transports: dev.transports || undefined },
    });
  } catch (e) { await bad("Fingerprint check failed: " + (e as Error).message); }
  if (!v!.verified) await bad("Fingerprint check failed.");
  await sql`update smartattend.devices set counter=${v!.authenticationInfo.newCounter} where id=${dev.id}`;
  checks.push({ key: "biometric", ok: true, note: "Fingerprint confirmed on your registered phone" });
  const [row] = mode === "in"
    ? await sql`insert into smartattend.attendance(session_id,student_id,dist_in,acc_in) values(${s.id},${u.id},${d},${acc === null ? null : Math.round(acc)}) on conflict do nothing returning check_in_at as at`
    : await sql`update smartattend.attendance set check_out_at=now(), dist_out=${d} where session_id=${s.id} and student_id=${u.id} and check_out_at is null returning check_out_at as at`;
  return { ok: true, at: row?.at, checks, course: s.code };
}

/* ---------- student views ---------- */
async function studentHome(u: any) {
  const courses = await sql`select c.id, c.code, c.title, c.venue,
      (select json_agg(json_build_object('weekday',weekday,'start',to_char(start_time,'HH24:MI'),'end',to_char(end_time,'HH24:MI')) order by weekday,start_time) from smartattend.slots where course_id=c.id) slots,
      (select count(*) from smartattend.sessions where course_id=c.id and status='closed')::int held,
      (select count(*) from smartattend.attendance a join smartattend.sessions x on x.id=a.session_id where x.course_id=c.id and x.status='closed' and a.student_id=${u.id})::int attended,
      (select count(*) from smartattend.excusals e join smartattend.sessions x on x.id=e.session_id where x.course_id=c.id and x.status='closed' and e.student_id=${u.id})::int excused
    from smartattend.enrollments e join smartattend.courses c on c.id=e.course_id where e.student_id=${u.id} and e.status='active' order by c.code`;
  const pending = await sql`select c.code, c.title from smartattend.enrollments e join smartattend.courses c on c.id=e.course_id where e.student_id=${u.id} and e.status='pending' order by c.code`;
  const live = await sql`select s.id, s.course_id, s.status, s.opened_at, s.ends_at, s.radius_m, s.scheduled, c.code, c.title, c.venue,
      a.check_in_at, a.check_out_at
    from smartattend.sessions s join smartattend.courses c on c.id=s.course_id
    join smartattend.enrollments e on e.course_id=c.id and e.student_id=${u.id} and e.status='active'
    left join smartattend.attendance a on a.session_id=s.id and a.student_id=${u.id}
    where s.status<>'closed' order by s.opened_at desc`;
  const [dev] = await sql`select label, created_at from smartattend.devices where user_id=${u.id} and revoked_at is null`;
  const recent = await sql`select at, reason, mode from smartattend.attempts where student_id=${u.id} order by at desc limit 5`;
  const week = await sql`select c.id course_id, c.code, c.title, c.venue, s.weekday, to_char(s.start_time,'HH24:MI') start, to_char(s.end_time,'HH24:MI') "end",
      (extract(epoch from s.start_time)/60)::int smin, (extract(epoch from s.end_time)/60)::int emin
    from smartattend.slots s join smartattend.courses c on c.id=s.course_id join smartattend.enrollments e on e.course_id=c.id and e.student_id=${u.id} and e.status='active'
    order by s.weekday, s.start_time`;
  return { courses, pending, live, device: dev || null, recent, week, clock: await clock() };
}
async function joinCourse(u: any, b: any) {
  const code = str(b.join_code, 12).toUpperCase().replace(/\s/g, "");
  const [c] = await sql`select id, code, title from smartattend.courses where join_code=${code}`;
  if (!c) fail(404, "No course has that join code. Check it with your lecturer.");
  const [{ n }] = await sql`select count(*)::int n from smartattend.roster where course_id=${c.id}`;
  const listed = n === 0 || (await sql`select 1 from smartattend.roster where course_id=${c.id} and reg_no=${u.reg_no}`).length > 0;
  const status = listed ? "active" : "pending";
  const [e] = await sql`insert into smartattend.enrollments(course_id,student_id,status) values(${c.id},${u.id},${status})
    on conflict(course_id,student_id) do update set status=smartattend.enrollments.status returning status`;
  return { course: c, pending: e.status === "pending" };
}

/* ---------- lecturer ---------- */
async function ownCourse(u: any, id: string) {
  const [c] = await sql`select * from smartattend.courses where id=${uid(id, "Course")}`;
  if (!c) fail(404, "Course not found.");
  if (u.role !== "admin" && c.lecturer_id !== u.id) fail(403, "This isn't one of your courses.");
  return c;
}
function cleanSlots(slots: unknown) {
  if (!Array.isArray(slots) || !slots.length) fail(400, "Add at least one timetable slot.");
  return (slots as any[]).slice(0, 14).map((s) => {
    const w = Number(s.weekday), st = str(s.start, 5), en = str(s.end, 5);
    if (!(w >= 0 && w <= 6) || !/^\d\d:\d\d$/.test(st) || !/^\d\d:\d\d$/.test(en) || en <= st) fail(400, "Each timetable slot needs a day, a start time and a later end time.");
    return { weekday: w, start_time: st, end_time: en };
  });
}
async function saveCourse(u: any, b: any) {
  const code = str(b.code, 20).toUpperCase(), title = str(b.title, 120), venue = str(b.venue, 120) || null;
  if (code.length < 2 || title.length < 3) fail(400, "Enter the course code and title.");
  const radius = Math.max(15, Math.min(500, Math.round(num(b.radius_m) ?? 50)));
  const lat = num(b.lat), lng = num(b.lng);
  const facilitators = str(b.facilitators, 200) || null, group = str(b.group_name, 40) || null;
  const term = /^\d{4}-\d{2}-\d{2}$/.test(str(b.term_start, 10)) ? str(b.term_start, 10) : null;
  const slots = cleanSlots(b.slots);
  return await sql.begin(async (tx: any) => {
    let id = str(b.id, 40);
    if (id) {
      await ownCourse(u, id);
      await tx`update smartattend.courses set code=${code}, title=${title}, venue=${venue}, radius_m=${radius}, lat=${lat}, lng=${lng},
        facilitators=${facilitators}, group_name=${group}, term_start=${term} where id=${id}`;
      await tx`delete from smartattend.slots where course_id=${id}`;
    } else {
      const [dup] = await tx`select c.id, u.full_name, u.id uid from smartattend.courses c join smartattend.users u on u.id=c.lecturer_id
        where c.code=${code} and c.group_name is not distinct from ${group} and not c.is_demo limit 1`;
      if (dup) fail(409, dup.uid === u.id ? `${code}${group ? " " + group : ""} is already in your courses.` : `${code}${group ? " " + group : ""} already exists and is run by ${dup.full_name}. Ask the admin to assign it to you.`);
      const [c] = await tx`insert into smartattend.courses(code,title,lecturer_id,venue,radius_m,lat,lng,join_code,facilitators,group_name,term_start)
        values(${code},${title},${u.id},${venue},${radius},${lat},${lng},${joinCode()},${facilitators},${group},${term}) returning id`;
      id = c.id;
    }
    for (const s of slots) await tx`insert into smartattend.slots(course_id,weekday,start_time,end_time) values(${id},${s.weekday},${s.start_time},${s.end_time})`;
    return { id };
  });
}
async function lecturerCourses(u: any) {
  return await sql`select c.id, c.code, c.title, c.venue, c.join_code, c.radius_m, c.lat, c.lng, c.facilitators, c.group_name, to_char(c.term_start,'YYYY-MM-DD') term_start,
      (select json_agg(json_build_object('weekday',weekday,'start',to_char(start_time,'HH24:MI'),'end',to_char(end_time,'HH24:MI')) order by weekday,start_time) from smartattend.slots where course_id=c.id) slots,
      (select count(*) from smartattend.enrollments where course_id=c.id and status='active')::int students,
      (select count(*) from smartattend.enrollments where course_id=c.id and status='pending')::int pending,
      (select row_to_json(x) from (select id,status,opened_at,ends_at from smartattend.sessions where course_id=c.id and status<>'closed') x) live,
      exists(select 1 from smartattend.slots s where s.course_id=c.id and s.weekday=extract(dow from now() at time zone ${TZ})::int
        and extract(epoch from (now() at time zone ${TZ})::time)/60 between extract(epoch from s.start_time)/60 - 15 and extract(epoch from s.end_time)/60) due_now
    from smartattend.courses c where ${u.role === "admin" ? sql`true` : sql`c.lecturer_id=${u.id}`} order by c.code`;
}
async function courseDetail(u: any, b: any) {
  const c = await ownCourse(u, b.id);
  const slots = await sql`select weekday, to_char(start_time,'HH24:MI') as start, to_char(end_time,'HH24:MI') as end from smartattend.slots where course_id=${c.id} order by weekday,start_time`;
  const [live] = await sql`select * from smartattend.sessions where course_id=${c.id} and status<>'closed'`;
  const students = await sql`select u.id, u.full_name, u.reg_no, u.email,
      exists(select 1 from smartattend.devices d where d.user_id=u.id and d.revoked_at is null) has_device
    from smartattend.enrollments e join smartattend.users u on u.id=e.student_id where e.course_id=${c.id} and e.status='active' order by u.full_name`;
  const pending = await sql`select u.id, u.full_name, u.reg_no, u.email, e.joined_at from smartattend.enrollments e join smartattend.users u on u.id=e.student_id
    where e.course_id=${c.id} and e.status='pending' order by e.joined_at`;
  const roster = await sql`select r.reg_no, r.full_name,
      (select u.full_name from smartattend.users u join smartattend.enrollments e on e.student_id=u.id and e.course_id=r.course_id where u.reg_no=r.reg_no) joined_as
    from smartattend.roster r where r.course_id=${c.id} order by r.full_name nulls last, r.reg_no`;
  let register: any[] = [], attempts: any[] = [];
  if (live) {
    register = await sql`select student_id, check_in_at, check_out_at, dist_in, dist_out from smartattend.attendance where session_id=${live.id}`;
    attempts = await sql`select a.at, a.reason, a.stage, a.mode, u.full_name from smartattend.attempts a join smartattend.users u on u.id=a.student_id where a.session_id=${live.id} order by a.at desc limit 50`;
    const ex = await sql`select student_id from smartattend.excusals where session_id=${live.id}`;
    live.excused = ex.map((r: any) => r.student_id);
  }
  const [tf] = await sql`select to_char(${c.term_start}::date,'YYYY-MM-DD') t`;
  return { course: { ...c, term_start: c.term_start ? tf.t : null, slots }, live: live || null, students, pending, roster, register, attempts };
}
async function openSession(u: any, b: any) {
  const c = await ownCourse(u, b.course_id);
  const lat = num(b.lat) ?? c.lat, lng = num(b.lng) ?? c.lng;
  if (lat === null || lng === null) fail(400, "Set the class location first: allow location on your phone, or save the venue's location in course settings.");
  if (c.term_start) {
    const [ts] = await sql`select ${c.term_start}::date > (now() at time zone ${TZ})::date as early, to_char(${c.term_start}::date,'FMDay DD FMMonth YYYY') d`;
    if (ts.early) fail(409, `Teaching for ${c.code} starts on ${ts.d}.`);
  }
  const t = await slotState(c.id, "open");
  const makeup = !!b.makeup;
  if (!t.slot && !makeup) fail(409, `It's ${t.now}, outside ${c.code}'s timetable. Tick "Make-up class" to open it anyway.`);
  const [e] = t.slot
    ? await sql`select ((now() at time zone ${TZ})::date + ${t.slot.en}::time) at time zone ${TZ} as ends_at`
    : await sql`select now() + interval '2 hours' as ends_at`;
  try {
    const [s] = await sql`insert into smartattend.sessions(course_id,opened_by,lat,lng,radius_m,scheduled,ends_at) values(${c.id},${u.id},${lat},${lng},${c.radius_m},${!!t.slot},${e.ends_at}) returning id`;
    return { id: s.id };
  } catch { fail(409, "A session for this course is already running."); }
}
async function moveSession(u: any, b: any, to: "checkout" | "closed") {
  const [s] = await sql`select * from smartattend.sessions where id=${uid(b.session_id, "Class session")}`;
  if (!s) fail(404, "Session not found.");
  await ownCourse(u, s.course_id);
  if (to === "checkout") await sql`update smartattend.sessions set status='checkout', closed_at=now() where id=${s.id} and status='open'`;
  else await sql`update smartattend.sessions set status='closed', closed_at=coalesce(closed_at,now()), finalised_at=now() where id=${s.id} and status<>'closed'`;
  return { ok: true };
}
async function excuse(u: any, b: any) {
  const [s] = await sql`select * from smartattend.sessions where id=${uid(b.session_id, "Class session")}`;
  if (!s) fail(404, "Session not found.");
  await ownCourse(u, s.course_id);
  if (b.undo) await sql`delete from smartattend.excusals where session_id=${s.id} and student_id=${uid(b.student_id, "Student")}`;
  else await sql`insert into smartattend.excusals(session_id,student_id,excused_by) values(${s.id},${uid(b.student_id, "Student")},${u.id}) on conflict do nothing`;
  return { ok: true };
}
async function resetDevice(u: any, b: any) {
  const sid = uid(b.student_id, "Student");
  if (u.role !== "admin") {
    const [ok] = await sql`select 1 from smartattend.enrollments e join smartattend.courses c on c.id=e.course_id where e.student_id=${sid} and c.lecturer_id=${u.id}`;
    if (!ok) fail(403, "You can only reset phones for students on your courses.");
  }
  await sql`update smartattend.devices set revoked_at=now() where user_id=${sid} and revoked_at is null`;
  return { ok: true };
}
async function removeStudent(u: any, b: any) {
  const c = await ownCourse(u, b.course_id);
  await sql`delete from smartattend.enrollments where course_id=${c.id} and student_id=${uid(b.student_id, "Student")}`;
  return { ok: true };
}
async function report(u: any, b: any) {
  const c = await ownCourse(u, b.course_id);
  const sessions = await sql`select s.id, s.opened_at, s.scheduled,
      (select count(*) from smartattend.attendance a where a.session_id=s.id)::int present,
      (select count(*) from smartattend.attendance a where a.session_id=s.id and a.check_out_at is null)::int no_checkout,
      (select count(*) from smartattend.attempts a where a.session_id=s.id)::int blocked
    from smartattend.sessions s where s.course_id=${c.id} and s.status='closed' order by s.opened_at desc`;
  const students = await sql`select u.id, u.full_name, u.reg_no,
      (select count(*) from smartattend.attendance a join smartattend.sessions s on s.id=a.session_id where s.course_id=${c.id} and s.status='closed' and a.student_id=u.id)::int attended,
      (select count(*) from smartattend.attendance a join smartattend.sessions s on s.id=a.session_id where s.course_id=${c.id} and s.status='closed' and a.student_id=u.id and a.check_out_at is null)::int no_checkout,
      (select count(*) from smartattend.excusals x join smartattend.sessions s on s.id=x.session_id where s.course_id=${c.id} and s.status='closed' and x.student_id=u.id)::int excused
    from smartattend.enrollments e join smartattend.users u on u.id=e.student_id where e.course_id=${c.id} and e.status='active' order by u.full_name`;
  const attempts = await sql`select a.at, a.reason, a.stage, u.full_name from smartattend.attempts a join smartattend.users u on u.id=a.student_id
    join smartattend.sessions s on s.id=a.session_id where s.course_id=${c.id} order by a.at desc limit 100`;
  const marks = await sql`select a.session_id, a.student_id, a.check_in_at, a.check_out_at, a.dist_in from smartattend.attendance a
    join smartattend.sessions s on s.id=a.session_id where s.course_id=${c.id} and s.status='closed'`;
  const excused = await sql`select x.session_id, x.student_id from smartattend.excusals x join smartattend.sessions s on s.id=x.session_id where s.course_id=${c.id} and s.status='closed'`;
  return { course: { id: c.id, code: c.code, title: c.title }, sessions, students, attempts, marks, excused };
}
const normReg = (v: unknown) => str(v, 40).toUpperCase().replace(/\s+/g, "");
async function rosterSave(u: any, b: any) {
  const c = await ownCourse(u, b.course_id);
  const rows = (Array.isArray(b.entries) ? b.entries : []).slice(0, 2000)
    .map((e: any) => ({ reg_no: normReg(e?.reg_no), full_name: str(e?.full_name, 120) || null }))
    .filter((e: any) => e.reg_no.length >= 4);
  if (!rows.length && b.mode !== "replace") fail(400, "No registration numbers found. Put one student per line: registration number, then name.");
  const uniq = [...new Map(rows.map((r: any) => [r.reg_no, r])).values()] as any[];
  await sql.begin(async (tx: any) => {
    if (b.mode === "replace") await tx`delete from smartattend.roster where course_id=${c.id}`;
    for (const r of uniq) await tx`insert into smartattend.roster(course_id,reg_no,full_name) values(${c.id},${r.reg_no},${r.full_name})
      on conflict(course_id,reg_no) do update set full_name=coalesce(excluded.full_name, smartattend.roster.full_name)`;
    await tx`update smartattend.enrollments e set status='active' from smartattend.users u
      where e.student_id=u.id and e.course_id=${c.id} and e.status='pending'
        and exists(select 1 from smartattend.roster r where r.course_id=${c.id} and r.reg_no=u.reg_no)`;
  });
  return { saved: uniq.length };
}
async function rosterRemove(u: any, b: any) {
  const c = await ownCourse(u, b.course_id);
  await sql`delete from smartattend.roster where course_id=${c.id} and reg_no=${normReg(b.reg_no)}`;
  return { ok: true };
}
async function decideJoin(u: any, b: any, approve: boolean) {
  const c = await ownCourse(u, b.course_id);
  const sid = uid(b.student_id, "Student");
  if (approve) await sql`update smartattend.enrollments set status='active' where course_id=${c.id} and student_id=${sid}`;
  else await sql`delete from smartattend.enrollments where course_id=${c.id} and student_id=${sid} and status='pending'`;
  return { ok: true };
}
/* ---------- client-side biometric failures (cancelled / wrong phone) ---------- */
async function reportFail(u: any, b: any) {
  const sid = uid(b.session_id, "Class session");
  const [s] = await sql`select s.id from smartattend.sessions s join smartattend.enrollments e on e.course_id=s.course_id and e.student_id=${u.id} where s.id=${sid} and s.status<>'closed'`;
  if (!s) return { ok: true };
  const recent = await sql`select 1 from smartattend.attempts where session_id=${sid} and student_id=${u.id} and stage='biometric' and at>now()-interval '20 seconds'`;
  if (!recent.length) await logAttempt(sid, u.id, b.mode === "out" ? "out" : "in", "biometric", "Fingerprint not confirmed on this phone (cancelled, not recognised, or not the registered phone)");
  return { ok: true };
}

/* ---------- admin dashboard + exports ---------- */
const courseStatsSql = (where: any) => sql`
  with held as (select course_id, count(*)::int n from smartattend.sessions where status='closed' group by 1),
  st as (select e.course_id, e.student_id,
      (select count(*) from smartattend.attendance a join smartattend.sessions s on s.id=a.session_id where s.course_id=e.course_id and s.status='closed' and a.student_id=e.student_id)
    + (select count(*) from smartattend.excusals x join smartattend.sessions s on s.id=x.session_id where s.course_id=e.course_id and s.status='closed' and x.student_id=e.student_id) as att
    from smartattend.enrollments e where e.status='active')
  select c.id, c.code, c.title, c.venue, c.join_code, c.is_demo, l.full_name as lecturer, coalesce(h.n,0)::int held,
    count(st.student_id)::int students,
    case when coalesce(h.n,0)>0 and count(st.student_id)>0 then round(100.0*sum(st.att)/(h.n*count(st.student_id)))::int end avg_rate,
    count(st.student_id) filter (where coalesce(h.n,0)>0 and st.att*100.0/h.n < 75)::int at_risk,
    (select count(*) from smartattend.attempts a join smartattend.sessions s on s.id=a.session_id where s.course_id=c.id)::int blocked,
    (select count(*) from smartattend.enrollments where course_id=c.id and status='pending')::int pending,
    (select status from smartattend.sessions where course_id=c.id and status<>'closed' limit 1) live
  from smartattend.courses c join smartattend.users l on l.id=c.lecturer_id
  left join held h on h.course_id=c.id left join st on st.course_id=c.id
  where ${where} group by c.id, l.full_name, h.n order by c.code`;
async function adminDashboard() {
  const [t] = await sql`select
    (select count(*) from smartattend.users where role='student' and not is_demo)::int students,
    (select count(*) from smartattend.users where role='student' and is_demo)::int demo_students,
    (select count(*) from smartattend.users where role='lecturer')::int lecturers,
    (select count(*) from smartattend.devices where revoked_at is null)::int phones,
    (select count(*) from smartattend.courses)::int courses,
    (select count(*) from smartattend.sessions where status='closed')::int sessions,
    (select count(*) from smartattend.sessions where status<>'closed')::int live,
    (select count(*) from smartattend.attendance)::int checkins,
    (select count(*) from smartattend.attempts)::int blocked,
    (select count(*) from smartattend.attempts where at>now()-interval '7 days')::int blocked_week,
    (select count(*) from smartattend.enrollments where status='pending')::int pending`;
  const courses = await courseStatsSql(sql`true`);
  const recent = await sql`select s.id, s.opened_at, s.scheduled, c.code, c.is_demo,
      (select count(*) from smartattend.attendance a where a.session_id=s.id)::int present,
      (select count(*) from smartattend.enrollments e where e.course_id=s.course_id and e.status='active')::int enrolled
    from smartattend.sessions s join smartattend.courses c on c.id=s.course_id where s.status='closed' order by s.opened_at desc limit 12`;
  const attempts = await sql`select a.at, a.reason, a.stage, u.full_name, u.reg_no, c.code from smartattend.attempts a
    join smartattend.users u on u.id=a.student_id left join smartattend.sessions s on s.id=a.session_id left join smartattend.courses c on c.id=s.course_id
    order by a.at desc limit 15`;
  const reasons = await sql`select stage, count(*)::int n from smartattend.attempts group by stage order by n desc`;
  return { totals: t, courses, recent, attempts, reasons };
}
async function exportData(u: any, b: any) {
  // admin: everything (or one course); lecturer: only own courses
  const one = b.course_id ? uid(b.course_id, "Course") : null;
  if (one) await ownCourse(u, one);
  const scope = one ? sql`c.id=${one}` : u.role === "admin" ? sql`true` : sql`c.lecturer_id=${u.id}`;
  const courses = await courseStatsSql(scope);
  const ids = courses.map((c: any) => c.id);
  if (!ids.length) return { generated_at: new Date().toISOString(), courses: [], students: [], sessions: [], marks: [], excused: [], attempts: [], roster: [], users: [] };
  const students = await sql`select e.course_id, u.id, u.reg_no, u.full_name, u.email,
      exists(select 1 from smartattend.devices d where d.user_id=u.id and d.revoked_at is null) has_device,
      (select count(*) from smartattend.attendance a join smartattend.sessions s on s.id=a.session_id where s.course_id=e.course_id and s.status='closed' and a.student_id=u.id)::int attended,
      (select count(*) from smartattend.excusals x join smartattend.sessions s on s.id=x.session_id where s.course_id=e.course_id and s.status='closed' and x.student_id=u.id)::int excused,
      (select count(*) from smartattend.attendance a join smartattend.sessions s on s.id=a.session_id where s.course_id=e.course_id and s.status='closed' and a.student_id=u.id and a.check_out_at is null)::int no_checkout
    from smartattend.enrollments e join smartattend.users u on u.id=e.student_id where e.status='active' and e.course_id = any(${ids}::uuid[]) order by u.full_name`;
  const sessions = await sql`select s.id, s.course_id, s.opened_at, s.closed_at, s.scheduled, s.radius_m,
      (select count(*) from smartattend.attendance a where a.session_id=s.id)::int present,
      (select count(*) from smartattend.attendance a where a.session_id=s.id and a.check_out_at is null)::int no_checkout,
      (select count(*) from smartattend.attempts a where a.session_id=s.id)::int blocked
    from smartattend.sessions s where s.status='closed' and s.course_id = any(${ids}::uuid[]) order by s.opened_at`;
  const marks = await sql`select a.session_id, a.student_id, a.check_in_at, a.check_out_at, a.dist_in, a.dist_out, a.simulated
    from smartattend.attendance a join smartattend.sessions s on s.id=a.session_id where s.status='closed' and s.course_id = any(${ids}::uuid[])`;
  const excused = await sql`select x.session_id, x.student_id from smartattend.excusals x join smartattend.sessions s on s.id=x.session_id where s.status='closed' and s.course_id = any(${ids}::uuid[])`;
  const attempts = await sql`select a.at, s.course_id, u.full_name, u.reg_no, a.mode, a.stage, a.reason from smartattend.attempts a
    join smartattend.users u on u.id=a.student_id join smartattend.sessions s on s.id=a.session_id where s.course_id = any(${ids}::uuid[]) order by a.at desc`;
  const roster = await sql`select r.course_id, r.reg_no, r.full_name, exists(select 1 from smartattend.users u join smartattend.enrollments e on e.student_id=u.id and e.course_id=r.course_id where u.reg_no=r.reg_no) joined
    from smartattend.roster r where r.course_id = any(${ids}::uuid[]) order by r.reg_no`;
  const users = u.role === "admin" && !one ? await sql`select u.role, u.full_name, u.email, u.reg_no, u.is_demo, u.created_at,
      exists(select 1 from smartattend.devices d where d.user_id=u.id and d.revoked_at is null) has_device from smartattend.users u order by u.role, u.full_name` : [];
  return { generated_at: new Date().toISOString(), courses, students, sessions, marks, excused, attempts, roster, users };
}

/* ---------- test lab (admin only, demo data only) ---------- */
const DEMO_NAMES = ["Amina Nakato","Brian Okello","Grace Atim","Joel Mugisha","Sarah Akello","Daniel Ssempijja","Faith Nambi","Moses Opio","Ritah Achan","Ivan Kato","Esther Auma","Samuel Wasswa"];
async function demoStatus() {
  const [c] = await sql`select id, code, title, join_code from smartattend.courses where is_demo order by created_at limit 1`;
  if (!c) return { demo: null };
  const [x] = await sql`select (select count(*) from smartattend.enrollments where course_id=${c.id} and status='active')::int students,
    (select count(*) from smartattend.sessions where course_id=${c.id} and status='closed')::int held,
    (select row_to_json(s) from (select id, status from smartattend.sessions where course_id=${c.id} and status<>'closed') s) live`;
  return { demo: { ...c, ...x } };
}
async function demoSeed(u: any) {
  const ex = await sql`select 1 from smartattend.courses where is_demo`;
  if (ex.length) fail(409, "Demo data already exists. Remove it first to start fresh.");
  let seed = 7; const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const LAT = 0.33150, LNG = 32.56810;
  await sql.begin(async (tx: any) => {
    const [c] = await tx`insert into smartattend.courses(code,title,lecturer_id,venue,radius_m,lat,lng,join_code,is_demo)
      values('DEMO 101','SmartAttend Demo Class',${u.id},'Expo stand',100,${LAT},${LNG},${joinCode()},true) returning id`;
    for (let d = 0; d < 7; d++) await tx`insert into smartattend.slots(course_id,weekday,start_time,end_time) values(${c.id},${d},'00:00','23:59')`;
    const ids: string[] = [];
    for (let i = 0; i < DEMO_NAMES.length; i++) {
      const reg = `DEMO/2026/${String(i + 1).padStart(3, "0")}`;
      const [st] = await tx`insert into smartattend.users(role,full_name,email,reg_no,password_hash,is_demo)
        values('student',${DEMO_NAMES[i]},${"demo" + (i + 1) + "." + randToken(4).toLowerCase() + "@smartattend.demo"},${reg},extensions.crypt(${randToken(16)}, extensions.gen_salt('bf', 6)),true) returning id`;
      ids.push(st.id);
      await tx`insert into smartattend.roster(course_id,reg_no,full_name) values(${c.id},${reg},${DEMO_NAMES[i]})`;
      await tx`insert into smartattend.enrollments(course_id,student_id,status) values(${c.id},${st.id},'active')`;
    }
    for (let k = 6; k >= 1; k--) {
      const [s] = await tx`insert into smartattend.sessions(course_id,opened_by,opened_at,closed_at,finalised_at,status,lat,lng,radius_m,scheduled)
        values(${c.id},${u.id},now()-make_interval(days=>${k * 2}),now()-make_interval(days=>${k * 2})+interval '2 hours',now()-make_interval(days=>${k * 2})+interval '2 hours 10 minutes','closed',${LAT},${LNG},100,true) returning id, opened_at`;
      for (let i = 0; i < ids.length; i++) {
        const p = i === 3 || i === 9 ? 0.45 : 0.9;
        if (rnd() < p) {
          const inMin = Math.floor(rnd() * 15), out = rnd() < 0.92;
          const t0 = new Date(s.opened_at).getTime();
          await tx`insert into smartattend.attendance(session_id,student_id,check_in_at,check_out_at,dist_in,dist_out,simulated)
            values(${s.id},${ids[i]},${new Date(t0 + inMin * 60000)},${out ? new Date(t0 + 123 * 60000) : null},${5 + Math.floor(rnd() * 60)},${out ? 5 + Math.floor(rnd() * 60) : null},true)`;
        } else if (rnd() < 0.35) {
          const reasons = [["location", "You're 3.9 km from the class. You need to be within 100 m."], ["biometric", "Fingerprint not confirmed on this phone (cancelled, not recognised, or not the registered phone)"], ["timetable", "It's outside the timetabled time for DEMO 101."]];
          const r = reasons[Math.floor(rnd() * 3)];
          await tx`insert into smartattend.attempts(session_id,student_id,at,mode,stage,reason) values(${s.id},${ids[i]},${new Date(new Date(s.opened_at).getTime() + Math.floor(rnd() * 30) * 60000)},'in',${r[0]},${r[1]})`;
        }
      }
    }
  });
  return await demoStatus();
}
async function demoSimulate(u: any, b: any) {
  const [s] = await sql`select s.*, c.is_demo from smartattend.sessions s join smartattend.courses c on c.id=s.course_id where s.id=${uid(b.session_id, "Class session")}`;
  if (!s || !s.is_demo) fail(403, "Simulation only works on the demo class.");
  if (s.status === "closed") fail(409, "That class has finished. Start a new class first.");
  const kind = String(b.kind || "in");
  if (kind === "in") {
    if (s.status !== "open") fail(409, "Check-in has closed for this class.");
    const free = await sql`select u.id from smartattend.users u join smartattend.enrollments e on e.student_id=u.id and e.course_id=${s.course_id}
      where u.is_demo and not exists(select 1 from smartattend.attendance a where a.session_id=${s.id} and a.student_id=u.id) order by random() limit ${Math.min(12, Math.max(1, Number(b.count) || 5))}`;
    for (const f of free) await sql`insert into smartattend.attendance(session_id,student_id,dist_in,acc_in,simulated) values(${s.id},${f.id},${5 + Math.floor(Math.random() * 70)},${8 + Math.floor(Math.random() * 20)},true) on conflict do nothing`;
    return { done: free.length };
  }
  if (kind === "out") {
    if (s.status !== "checkout") fail(409, "End the class first, then simulate check-outs.");
    const r = await sql`update smartattend.attendance a set check_out_at=now(), dist_out=${10 + Math.floor(Math.random() * 50)} from smartattend.users u
      where a.student_id=u.id and u.is_demo and a.session_id=${s.id} and a.check_out_at is null and random() < 0.85 returning a.student_id`;
    return { done: r.length };
  }
  const [v] = await sql`select u.id from smartattend.users u join smartattend.enrollments e on e.student_id=u.id and e.course_id=${s.course_id} where u.is_demo order by random() limit 1`;
  if (!v) fail(409, "No demo students found.");
  const reasons = [["location", "You're 2.4 km from the class. You need to be within 100 m."], ["biometric", "This isn't the phone registered to your account."], ["biometric", "Fingerprint not confirmed on this phone (cancelled, not recognised, or not the registered phone)"]];
  const pick = reasons[Math.floor(Math.random() * reasons.length)];
  await logAttempt(s.id, v.id, "in", pick[0], pick[1]);
  return { done: 1 };
}
async function demoClear() {
  await sql.begin(async (tx: any) => {
    await tx`delete from smartattend.sessions where course_id in (select id from smartattend.courses where is_demo)`;
    await tx`delete from smartattend.courses where is_demo`;
    await tx`delete from smartattend.users where is_demo`;
  });
  return { ok: true };
}
async function selfTest(req: Request) {
  const out: { name: string; ok: boolean; detail: string }[] = [];
  const t = async (name: string, fn: () => Promise<string>) => { try { out.push({ name, ok: true, detail: await fn() }); } catch (e) { out.push({ name, ok: false, detail: (e as Error).message }); } };
  await t("Database connection", async () => { await sql`select 1`; return "Connected"; });
  await t("Kampala clock", async () => (await sql`select to_char(now() at time zone ${TZ},'Dy DD Mon YYYY HH24:MI') t`)[0].t);
  await t("This website is allowed", async () => { const o = await originInfo(req); return o.origin; });
  await t("Fingerprint (WebAuthn) engine", async () => { const o = await generateAuthenticationOptions({ rpID: "example.com", userVerification: "required" }); if (!o.challenge) throw new Error("No challenge produced"); return "Ready"; });
  await t("Distance calculation", async () => { const d = haversine({ lat: 0.3315, lng: 32.5681 }, { lat: 0.3324, lng: 32.5681 }); if (Math.abs(d - 100) > 3) throw new Error(`Expected ~100 m, got ${d.toFixed(1)} m`); return `100 m test point measured as ${d.toFixed(1)} m`; });
  await t("Timetable window", async () => { const [r] = await sql`select extract(epoch from time '09:05')/60 between extract(epoch from time '09:00')/60 - 15 and extract(epoch from time '11:00')/60 as ok, extract(epoch from time '00:05')/60 between extract(epoch from time '00:00')/60 - 15 and extract(epoch from time '01:00')/60 as ok2`; if (!r.ok || !r.ok2) throw new Error("Window check failed"); return "Start, end and early-entry rules work (incl. midnight)"; });
  await t("Access codes set", async () => { const lc = await setting("lecturer_code"), ac = await setting("admin_code"); if (!lc || !ac) throw new Error("Missing code"); return "Lecturer and admin codes present"; });
  await t("Data counts", async () => { const [c] = await sql`select (select count(*) from smartattend.users)::int u, (select count(*) from smartattend.courses)::int c, (select count(*) from smartattend.sessions)::int s, (select count(*) from smartattend.attendance)::int a`; return `${c.u} users · ${c.c} courses · ${c.s} classes · ${c.a} check-ins`; });
  return { results: out };
}

/* ---------- timetable (admin) ---------- */
async function timetableImport(u: any, b: any) {
  const term = /^\d{4}-\d{2}-\d{2}$/.test(str(b.term_start, 10)) ? str(b.term_start, 10) : null;
  const list = Array.isArray(b.courses) ? b.courses.slice(0, 60) : [];
  if (!list.length) fail(400, "The timetable has no courses.");
  let created = 0, updated = 0, claimed = 0;
  const taken: string[] = [];
  await sql.begin(async (tx: any) => {
    for (const x of list) {
      const code = str(x.code, 20).toUpperCase(), group = str(x.group, 40) || null, title = str(x.title, 120);
      const slots = cleanSlots(x.slots);
      const full = group ? `${title} — ${group}` : title;
      const [ex] = await tx`select c.id, c.lecturer_id, o.role owner_role, o.full_name owner from smartattend.courses c join smartattend.users o on o.id=c.lecturer_id
        where c.code=${code} and c.group_name is not distinct from ${group} and not c.is_demo limit 1`;
      let id: string;
      if (ex) {
        id = ex.id;
        if (u.role !== "admin" && ex.lecturer_id !== u.id) {
          // a lecturer can take over a timetabled course nobody has claimed yet (still held by an admin), never another lecturer's
          if (ex.owner_role !== "admin") { taken.push(`${code}${group ? " " + group : ""} (run by ${ex.owner})`); continue; }
          await tx`update smartattend.courses set lecturer_id=${u.id} where id=${id}`; claimed++;
        } else updated++;
        await tx`update smartattend.courses set title=${full}, venue=${str(x.venue, 120) || null}, facilitators=${str(x.facilitators, 200) || null}, term_start=${term} where id=${id}`;
        await tx`delete from smartattend.slots where course_id=${id}`;
      } else {
        const [c] = await tx`insert into smartattend.courses(code,title,lecturer_id,venue,radius_m,join_code,facilitators,group_name,term_start)
          values(${code},${full},${u.id},${str(x.venue, 120) || null},50,${joinCode()},${str(x.facilitators, 200) || null},${group},${term}) returning id`;
        id = c.id; created++;
      }
      for (const s of slots) await tx`insert into smartattend.slots(course_id,weekday,start_time,end_time) values(${id},${s.weekday},${s.start_time},${s.end_time})`;
    }
  });
  return { created, updated, claimed, taken };
}
async function timetableView() {
  const courses = await sql`select c.id, c.code, c.title, c.venue, c.group_name, c.facilitators, c.join_code, c.is_demo, c.lecturer_id, l.full_name lecturer, l.role lecturer_role,
      to_char(c.term_start,'YYYY-MM-DD') term_start,
      (select count(*) from smartattend.enrollments e where e.course_id=c.id and e.status='active')::int students,
      (select row_to_json(x) from (select id,status,ends_at from smartattend.sessions where course_id=c.id and status<>'closed') x) live,
      (select json_agg(json_build_object('weekday',weekday,'start',to_char(start_time,'HH24:MI'),'end',to_char(end_time,'HH24:MI'),
          'smin',(extract(epoch from start_time)/60)::int,'emin',(extract(epoch from end_time)/60)::int) order by weekday,start_time) from smartattend.slots where course_id=c.id) slots
    from smartattend.courses c join smartattend.users l on l.id=c.lecturer_id order by c.group_name nulls last, c.code`;
  const lecturers = await sql`select id, full_name, role from smartattend.users where role in ('lecturer','admin') order by role desc, full_name`;
  return { courses, lecturers, clock: await clock() };
}
async function assignLecturer(b: any) {
  const cid = uid(b.course_id, "Course"), lid = uid(b.lecturer_id, "Lecturer");
  const [l] = await sql`select role from smartattend.users where id=${lid}`;
  if (!l || !["lecturer", "admin"].includes(l.role)) fail(400, "Choose a lecturer account.");
  await sql`update smartattend.courses set lecturer_id=${lid} where id=${cid}`;
  return { ok: true };
}

async function adminOverview(u: any) {
  const users = await sql`select u.id, u.role, u.full_name, u.email, u.reg_no, u.created_at,
    exists(select 1 from smartattend.devices d where d.user_id=u.id and d.revoked_at is null) has_device from smartattend.users u order by u.role, u.full_name`;
  return { users, lecturer_code: await setting("lecturer_code"), allowed_origins: await setting("allowed_origins") };
}
async function adminSet(u: any, b: any) {
  if (typeof b.lecturer_code === "string") await sql`update smartattend.settings set value=${str(b.lecturer_code, 20).toUpperCase()} where key='lecturer_code'`;
  if (typeof b.allowed_origins === "string") await sql`update smartattend.settings set value=${str(b.allowed_origins, 500)} where key='allowed_origins'`;
  return { ok: true };
}
async function me(u: any) {
  const [dev] = await sql`select label, created_at from smartattend.devices where user_id=${u.id} and revoked_at is null`;
  return { user: u, device: dev || null };
}

/* ---------- router ---------- */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);
  try {
    const b = await req.json().catch(() => ({}));
    const a = String(b.action || "");
    if (a === "signup") return json(await signup(b));
    if (a === "login") return json(await login(b));
    if (a === "ping") return json({ ok: true, time: (await sql`select now() at time zone ${TZ} as t`)[0].t });
    const u = await currentUser(req);
    if (u) await sweep().catch((e) => console.error("sweep", e));
    switch (a) {
      case "clock": need(u); return json(await clock());
      case "timetable.import": return json(await timetableImport(need(u, "lecturer", "admin"), b));
      case "admin.timetable": need(u, "admin"); return json(await timetableView());
      case "admin.assignLecturer": need(u, "admin"); return json(await assignLecturer(b));
      case "logout": { const h = req.headers.get("authorization") || ""; await sql`delete from smartattend.tokens where token_hash=${await sha256(h.slice(7))}`; return json({ ok: true }); }
      case "me": return json(await me(need(u)));
      case "device.options": return json(await deviceOptions(req, need(u, "student")));
      case "device.verify": return json(await deviceVerify(req, need(u, "student"), b));
      case "student.home": return json(await studentHome(need(u, "student")));
      case "course.join": return json(await joinCourse(need(u, "student"), b));
      case "attend.options": return json(await checkOptions(req, need(u, "student"), b));
      case "attend.verify": return json(await checkVerify(req, need(u, "student"), b));
      case "course.save": return json(await saveCourse(need(u, "lecturer", "admin"), b));
      case "course.list": return json(await lecturerCourses(need(u, "lecturer", "admin")));
      case "course.detail": return json(await courseDetail(need(u, "lecturer", "admin"), b));
      case "course.removeStudent": return json(await removeStudent(need(u, "lecturer", "admin"), b));
      case "session.open": return json(await openSession(need(u, "lecturer", "admin"), b));
      case "session.close": return json(await moveSession(need(u, "lecturer", "admin"), b, "checkout"));
      case "session.finalise": return json(await moveSession(need(u, "lecturer", "admin"), b, "closed"));
      case "session.excuse": return json(await excuse(need(u, "lecturer", "admin"), b));
      case "device.reset": return json(await resetDevice(need(u, "lecturer", "admin"), b));
      case "report": return json(await report(need(u, "lecturer", "admin"), b));
      case "roster.save": return json(await rosterSave(need(u, "lecturer", "admin"), b));
      case "roster.remove": return json(await rosterRemove(need(u, "lecturer", "admin"), b));
      case "enrollment.approve": return json(await decideJoin(need(u, "lecturer", "admin"), b, true));
      case "enrollment.reject": return json(await decideJoin(need(u, "lecturer", "admin"), b, false));
      case "attend.reportFail": return json(await reportFail(need(u, "student"), b));
      case "export": return json(await exportData(need(u, "lecturer", "admin"), b));
      case "admin.dashboard": need(u, "admin"); return json(await adminDashboard());
      case "demo.status": need(u, "admin"); return json(await demoStatus());
      case "demo.seed": return json(await demoSeed(need(u, "admin")));
      case "demo.simulate": return json(await demoSimulate(need(u, "admin"), b));
      case "demo.clear": need(u, "admin"); return json(await demoClear());
      case "selftest": need(u, "admin"); return json(await selfTest(req));
      case "admin.overview": return json(await adminOverview(need(u, "admin")));
      case "admin.set": return json(await adminSet(need(u, "admin"), b));
      default: return json({ error: "Unknown action." }, 400);
    }
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message, ...(e.extra as object || {}) }, e.status);
    console.error(e);
    return json({ error: "Something went wrong on the server. Try again." }, 500);
  }
});
