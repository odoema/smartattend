// Post-deploy smoke test: checks the things that have actually broken before.
// Run by .github/workflows/smoke.yml after a deploy, or by hand:
//   node scripts/smoke.mjs
import vm from "node:vm";

const SITE = process.env.SMOKE_SITE || "https://smartattend.live";
const API = process.env.SMOKE_API || "https://gbyvlotgjrtrnogtbemi.supabase.co/functions/v1/smartattend-api";
const bust = "?smoke=" + Date.now();

let failed = 0;
const ok = (m) => console.log("  ok    " + m);
const bad = (m) => { failed++; console.log("  FAIL  " + m); };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// A gate that flakes is worse than no gate: retry the transient failures
// (connection resets, 5xx from the CDN) before declaring the deploy broken.
async function get(url, timeout = 25000) {
  let last;
  for (let i = 1; i <= 3; i++) {
    try {
      const r = await fetch(url, { headers: { "user-agent": "smartattend-smoke" }, signal: AbortSignal.timeout(timeout) });
      if (r.status >= 500 && i < 3) { await sleep(1500 * i); continue; }
      return { status: r.status, text: r.status === 200 ? await r.text() : "" };
    } catch (e) { last = e; if (i < 3) await sleep(1500 * i); }
  }
  throw last;
}

function parses(code) {
  try { new vm.Script(code); return true; } catch { return false; }
}

async function main() {
  console.log("SmartAttend smoke test\n  site " + SITE + "\n  api  " + API + "\n");

  try {
    const page = await get(SITE + "/" + bust);
    page.status === 200 && page.text.includes('id="view"') ? ok("site serves the app shell") : bad("site did not serve the app shell (HTTP " + page.status + ")");

    const app = await get(SITE + "/app.js" + bust);
    if (app.status !== 200) bad("app.js is not reachable (HTTP " + app.status + ")");
    else {
      parses(app.text) ? ok("app.js parses") : bad("app.js does not parse - the site is broken for everyone");
      // the exact regression that stopped everyone signing in
      app.text.includes('$$("[data-m]")') ? ok("sign-in mode toggle is bound") : bad('app.js has no $$("[data-m]") - the Create account / Sign in toggle will not work');
      app.text.includes("addPasswordToggle") ? ok("password show/hide is present") : bad("password show/hide is missing");
    }

    const admin = await get(SITE + "/admin.js" + bust);
    admin.status === 200 && parses(admin.text) ? ok("admin.js parses") : bad("admin.js missing or does not parse");

    const logo = await get(SITE + "/logo-mark.png" + bust);
    logo.status === 200 ? ok("logo is served") : bad("logo is not served (HTTP " + logo.status + ")");
  } catch (e) {
    bad("site checks threw: " + e.message);
  }

  try {
    let last = null;
    for (let i = 1; i <= 3; i++) {
      try {
        const r = await fetch(API, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "ping" }), signal: AbortSignal.timeout(25000) });
        const body = await r.text();
        if (r.status === 200 && body.includes('"ok":true')) { last = null; ok("api answers ping"); break; }
        last = "HTTP " + r.status + " " + body.slice(0, 80);
        if (i < 3) await sleep(1500 * i);
      } catch (e) { last = e.message; if (i < 3) await sleep(1500 * i); }
    }
    if (last) bad("api ping failed: " + last);
  } catch (e) {
    bad("api unreachable: " + e.message);
  }

  console.log("\n" + (failed ? failed + " check(s) failed" : "all checks passed"));
  process.exit(failed ? 1 : 0);
}

await main();