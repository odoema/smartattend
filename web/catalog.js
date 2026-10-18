/* Official programme timetables SmartAttend knows about. Add a new programme/semester here and every
   "New course" screen and the admin Timetable page pick it up automatically. */
(function () {
  const E = { start: "17:30", end: "19:30", label: "5:30–7:30 pm" };
  const L = { start: "19:30", end: "21:30", label: "7:30–9:30 pm" };
  const MBA1 = {
    id: "mak-mba1-2026-s1",
    name: "Makerere MBA Year One · Semester 1 (2026/2027)",
    institution: "Makerere University · COBAMS",
    term_start: "2026-08-10",
    periods: [E, L],
    courses: {
      "MBD 7101": { title: "Financial Accounting", facilitators: [{ name: "Mr. Hussein Kintu", lead: true }, { name: "Mr. John Ogema" }] },
      "MBD 7102": { title: "Marketing Management", facilitators: [{ name: "Dr. Henry Mbidde", lead: true }, { name: "Dr. Sarah Bimbona" }] },
      "MBD 7103": { title: "Quantitative Methods", facilitators: [{ name: "Prof. Godfrey Akileng", lead: true }, { name: "Dr. Diana L.K Sekiboobo" }] },
      "MBD 7104": { title: "Entrepreneurship", facilitators: [{ name: "Dr. Kasimu Sendawula", lead: true }, { name: "Dr. Cathy Mbidde" }] },
      "MBD 7105": { title: "General Management", facilitators: [{ name: "Prof. Umar Kakumba", lead: true }, { name: "Dr. Christopher Muganga" }] },
    },
    // day number (1 = Monday) -> [course in 5:30 slot, course in 7:30 slot]
    groups: {
      "Group A": { venue: "CTF2 Room 5.1", days: { 1: ["MBD 7104", "MBD 7103"], 2: ["MBD 7101", "MBD 7104"], 3: ["MBD 7103", "MBD 7105"], 4: ["MBD 7102", "MBD 7101"], 5: ["MBD 7105", "MBD 7102"] } },
      "Group B": { venue: "FEMA Block A, Room 2.2 (COBAMS)", days: { 1: ["MBD 7103", "MBD 7105"], 2: ["MBD 7103", "MBD 7101"], 3: ["MBD 7105", "MBD 7104"], 4: ["MBD 7101", "MBD 7102"], 5: ["MBD 7102", "MBD 7104"] } },
    },
  };
  const PROGRAMMES = [MBA1];
  const SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const fmt12 = (hhmm) => { let [h, m] = hhmm.split(":").map(Number); const ap = h >= 12 ? "pm" : "am"; h = h % 12 || 12; return `${h}:${String(m).padStart(2, "0")} ${ap}`; };

  function slotsFor(p, code, group) {
    const g = p.groups[group], out = [];
    for (const [d, pair] of Object.entries(g.days)) pair.forEach((cc, i) => { if (cc === code) out.push({ weekday: +d, start: p.periods[i].start, end: p.periods[i].end }); });
    return out.sort((a, b) => a.weekday - b.weekday || a.start.localeCompare(b.start));
  }
  const slotLabel = (slots) => slots.map((s) => `${SHORT[s.weekday]} ${fmt12(s.start)}`).join(", ");
  const facText = (list) => list.map((f) => f.name + (f.lead ? " (lead)" : "")).join(", ");
  function entry(p, code, group, chosenFac) {
    const c = p.courses[code];
    const fac = chosenFac && chosenFac.length ? c.facilitators.filter((f) => chosenFac.includes(f.name)) : c.facilitators;
    return { code, title: c.title, group, venue: p.groups[group].venue, facilitators: facText(fac), slots: slotsFor(p, code, group) };
  }
  function all(p) { const out = []; for (const g of Object.keys(p.groups)) for (const code of Object.keys(p.courses)) out.push(entry(p, code, g)); return out; }

  // "Smart" name matching: titles are ignored; a shared surname is a strong match, a shared first name only a weak one.
  const tokens = (n) => String(n || "").toLowerCase().replace(/\b(dr|prof|professor|mr|mrs|ms|miss|eng|rev|assoc)\.?\b/g, " ").replace(/[^a-z\s]/g, " ").split(/\s+/).filter((t) => t.length >= 3);
  function nameMatch(userName, facName) {
    const u = new Set(tokens(userName)), f = tokens(facName);
    if (!u.size || !f.length) return 0;
    if (u.has(f[f.length - 1])) return f.length > 1 && u.has(f[0]) ? 3 : 2;   // surname (+ first name = exact)
    return f.some((t) => u.has(t)) ? 1 : 0;              // only a first/middle name matches
  }
  function suggestFor(userName) {
    // exact (first name + surname) matches win; surname-only matches are used when there's no exact one
    const hits = [];
    for (const p of PROGRAMMES) for (const [code, c] of Object.entries(p.courses)) for (const f of c.facilitators) {
      const sc = nameMatch(userName, f.name);
      if (sc >= 2) hits.push({ p, code, sc, facilitator: f.name });
    }
    const top = Math.max(0, ...hits.map((h) => h.sc));
    const out = [];
    for (const h of hits.filter((h) => h.sc === top)) for (const g of Object.keys(h.p.groups)) if (!out.some((o) => o.code === h.code && o.group === g)) out.push({ p: h.p, code: h.code, group: g, facilitator: h.facilitator });
    return out;
  }
  const VENUES = [...new Set(PROGRAMMES.flatMap((p) => Object.values(p.groups).map((g) => g.venue)))];
  window.SA_CATALOG = { PROGRAMMES, VENUES, PERIODS: [E, L], slotsFor, slotLabel, entry, all, nameMatch, suggestFor, fmt12, facText };
})();
