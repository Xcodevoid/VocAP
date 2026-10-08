/* Run with: node --test tests/ */
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const core = require("../js/core.js");

const ROOT = path.join(__dirname, "..");

/** Load the data <script> files in the order index.html lists them. */
function loadData() {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const files = [...html.matchAll(/<script src="(data\/[^"]+)"/g)].map((m) => m[1]);
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  files.forEach((f) => vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), sandbox, { filename: f }));
  return { files, subjects: sandbox.window.VOCAP_SUBJECTS, roots: sandbox.window.VOCAP_ROOTS };
}

const data = loadData();
const index = core.buildIndex(data.subjects, data.roots);

test("index.html loads every data file", () => {
  const onDisk = fs.readdirSync(path.join(ROOT, "data")).map((f) => "data/" + f).sort();
  assert.deepStrictEqual([...data.files].sort(), onDisk);
});

test("subjects and words are well-formed", () => {
  const ids = new Set();
  for (const s of data.subjects) {
    assert.ok(s.id && s.name && s.zh && s.icon && s.color, `subject fields: ${s.id}`);
    assert.ok(!ids.has(s.id), `duplicate subject ${s.id}`);
    ids.add(s.id);
    for (const w of s.words) {
      for (const k of ["t", "p", "zh", "d", "ex", "u"]) {
        assert.ok(typeof w[k] === "string" && w[k].trim(), `${s.id}/${w.t}: missing ${k}`);
      }
      assert.ok(s.units[w.u], `${s.id}/${w.t}: unknown unit ${w.u}`);
    }
    for (const u of Object.keys(s.units)) {
      assert.ok(s.words.some((w) => w.u === u), `${s.id}: unit ${u} has no words`);
    }
  }
});

test("word ids are unique", () => {
  assert.strictEqual(Object.keys(index.byId).length, index.words.length);
});

test("every root part matches at least one word, and `not` lists are real terms", () => {
  const terms = new Set(index.words.map((w) => w.t.toLowerCase()));
  for (const r of index.roots) {
    assert.ok(r.words.length > 0, `root ${r.part} matches no words`);
    for (const n of r.not || []) assert.ok(terms.has(n), `root ${r.part}: 'not' term ${n} is not in the word bank`);
  }
});

test("root matching uses prefix / suffix / contains rules", () => {
  const roots = [
    { part: "photo-", type: "pre", forms: ["photo"] },
    { part: "-ism", type: "suf", forms: ["ism"] },
    { part: "therm", type: "root", forms: ["therm"] },
    { part: "de-", type: "pre", forms: ["de"], not: ["density"] }
  ];
  const parts = (t) => core.matchRoots(t, roots).map((r) => r.part);
  assert.deepStrictEqual(parts("photosynthesis"), ["photo-"]);
  assert.deepStrictEqual(parts("photochemical smog"), ["photo-"]);
  assert.deepStrictEqual(parts("nationalism"), ["-ism"]);
  assert.deepStrictEqual(parts("endothermic"), ["therm"]);
  assert.deepStrictEqual(parts("density"), []);
  assert.deepStrictEqual(parts("denature"), ["de-"]);
});

test("search finds words by English, Chinese, and definition", () => {
  assert.strictEqual(core.search(index, "mitosis")[0].t, "mitosis");
  assert.strictEqual(core.search(index, "有丝分裂")[0].t, "mitosis");
  assert.strictEqual(core.search(index, "导数")[0].t, "derivative");
  assert.ok(core.search(index, "MITO").some((w) => w.t === "mitochondrion"));
  assert.deepStrictEqual(core.search(index, "   "), []);
});

test("spaced repetition moves cards between boxes", () => {
  const s = core.emptyState();
  const now = Date.UTC(2026, 9, 8, 12);
  const id = index.words[0].id;
  assert.strictEqual(core.status(s, id), "new");
  core.review(s, id, "good", now);
  assert.strictEqual(s.cards[id].box, 1);
  assert.strictEqual(s.cards[id].due, now + core.DAY);
  assert.ok(!core.isDue(s, id, now));
  assert.ok(core.isDue(s, id, now + core.DAY));
  core.review(s, id, "easy", now);
  assert.strictEqual(s.cards[id].box, 3);
  core.review(s, id, "good", now);
  assert.strictEqual(core.status(s, id), "mastered");
  core.review(s, id, "again", now);
  assert.strictEqual(s.cards[id].box, 0);
  assert.strictEqual(core.status(s, id), "learning");
  for (let i = 0; i < 20; i++) core.review(s, id, "easy", now);
  assert.strictEqual(s.cards[id].box, core.INTERVALS.length - 1);
});

test("streak counts consecutive days", () => {
  const s = core.emptyState();
  const d0 = new Date(2026, 9, 8, 12).getTime();
  const id = index.words[0].id;
  core.review(s, id, "good", d0);
  core.review(s, id, "good", d0 + 1000);
  assert.strictEqual(core.currentStreak(s, d0), 1);
  core.review(s, id, "good", d0 + core.DAY);
  assert.strictEqual(core.currentStreak(s, d0 + core.DAY), 2);
  assert.strictEqual(core.currentStreak(s, d0 + 2 * core.DAY), 2, "streak survives until the end of the next day");
  assert.strictEqual(core.currentStreak(s, d0 + 3 * core.DAY), 0);
  core.review(s, id, "good", d0 + 3 * core.DAY);
  assert.strictEqual(core.currentStreak(s, d0 + 3 * core.DAY), 1);
});

test("mistake notebook adds on wrong and clears after correct answers", () => {
  const s = core.emptyState();
  const id = index.words[0].id;
  core.recordQuizAnswer(s, id, false, 0);
  core.recordQuizAnswer(s, id, false, 0);
  assert.strictEqual(s.mistakes[id], 2);
  core.recordQuizAnswer(s, id, true, 0);
  assert.strictEqual(s.mistakes[id], 1);
  core.recordQuizAnswer(s, id, true, 0);
  assert.ok(!(id in s.mistakes));
});

test("pools resolve by subject, unit, starred, mistakes and due", () => {
  const s = core.emptyState();
  const now = 1e12;
  assert.strictEqual(core.resolvePool(index, s, "all", now).length, index.words.length);
  const bio = core.resolvePool(index, s, "s:bio", now);
  assert.ok(bio.length > 0 && bio.every((w) => w.subject === "bio"));
  const cell = core.resolvePool(index, s, "s:bio:cell", now);
  assert.ok(cell.length > 0 && cell.length < bio.length && cell.every((w) => w.u === "cell"));
  assert.deepStrictEqual(core.resolvePool(index, s, "s:nope", now), []);
  s.starred[bio[0].id] = true;
  assert.deepStrictEqual(core.resolvePool(index, s, "starred", now).map((w) => w.id), [bio[0].id]);
  core.review(s, bio[1].id, "again", now);
  assert.strictEqual(core.resolvePool(index, s, "due", now).length, 0);
  assert.strictEqual(core.resolvePool(index, s, "due", now + core.DAY).length, 1);
});

test("study queue puts due cards first and limits new cards", () => {
  const s = core.emptyState();
  const now = 1e12;
  const pool = core.resolvePool(index, s, "s:calc", now);
  core.review(s, pool[0].id, "good", now - 2 * core.DAY);
  const q = core.studyQueue(pool, s, now, 5);
  assert.strictEqual(q[0].id, pool[0].id);
  assert.strictEqual(q.length, 6);
});

test("quizzes have one correct answer among unique options", () => {
  const pool = core.resolvePool(index, core.emptyState(), "s:chem", 0);
  for (const mode of ["en2zh", "zh2en", "def2en", "cloze", "mixed"]) {
    const qs = core.buildQuiz(pool, index.words, mode, 10);
    assert.strictEqual(qs.length, 10);
    for (const q of qs) {
      if (q.mode === "spell") continue;
      assert.strictEqual(q.options.length, 4, mode);
      assert.strictEqual(q.options.filter((o) => o.id === q.answer).length, 1);
      assert.strictEqual(new Set(q.options.map((o) => o.label)).size, 4, `duplicate labels in ${mode}`);
      if (q.mode === "cloze") assert.ok(q.prompt.includes("_____"));
    }
  }
});

test("cloze blanks the term including simple inflections", () => {
  assert.strictEqual(core.cloze({ t: "denature", ex: "High temperatures denature enzymes." }), "High temperatures _____ enzymes.");
  assert.strictEqual(core.cloze({ t: "converge", ex: "The series converges because |r| < 1." }), "The series _____ because |r| < 1.");
  assert.strictEqual(core.cloze({ t: "mitochondrion", ex: "Cells contain many mitochondria." }), null);
  assert.strictEqual(core.cloze({ t: "result from", ex: "Anemia results from a mutation." }), "Anemia _____ a mutation.");
  assert.strictEqual(core.cloze({ t: "increase by", ex: "The price increased by $5." }), "The price _____ $5.");
});

test("spelling check ignores case and extra spaces", () => {
  assert.ok(core.checkSpelling("  Le  Chatelier's principle ", "Le Chatelier's principle"));
  assert.ok(core.checkSpelling("le chatelier’s principle", "Le Chatelier's principle"));
  assert.ok(!core.checkSpelling("mitosis", "meiosis"));
});

test("normalizeState tolerates missing or corrupt saved data", () => {
  assert.deepStrictEqual(core.normalizeState(null), core.emptyState());
  assert.deepStrictEqual(core.normalizeState("garbage"), core.emptyState());
  const s = core.normalizeState({ cards: { a: { box: 1 } }, starred: "bad" });
  assert.deepStrictEqual(s.cards, { a: { box: 1 } });
  assert.deepStrictEqual(s.starred, {});
});

test("daily plan: reviews first, then new words, fixed for the day", () => {
  const s = core.emptyState();
  s.plan = { pool: "s:phys", daily: 5 };
  const t0 = new Date(2026, 9, 8, 9).getTime();
  const phys = core.resolvePool(index, s, "s:phys", t0);
  core.review(s, phys[0].id, "good", t0 - 2 * core.DAY);
  const day = core.startDay(index, s, t0);
  assert.strictEqual(day.ids[0], phys[0].id, "due review comes first");
  assert.strictEqual(day.ids.length, 6);
  assert.ok(day.ids.every((id) => id.startsWith("phys:")));
  const again = core.startDay(index, s, t0 + 3600e3);
  assert.deepStrictEqual(again.ids, day.ids, "same list later the same day");
  assert.notDeepStrictEqual(core.startDay(index, s, t0 + core.DAY).ids, day.ids, "new list tomorrow");
});

test("zhan: wrong answer goes to the mistake notebook and the word stays until answered right", () => {
  const s = core.emptyState();
  s.plan = { pool: "s:bio", daily: 2 };
  const t = new Date(2026, 9, 8, 9).getTime();
  const [a, b] = core.startDay(index, s, t).ids;
  core.zhanAnswer(s, a, false, false, t);
  assert.strictEqual(s.mistakes[a], 1);
  assert.strictEqual(s.cards[a].box, 0);
  assert.deepStrictEqual(core.remainingToday(s), [a, b]);
  core.zhanAnswer(s, a, true, true, t);
  assert.strictEqual(s.cards[a].box, 0, "a retry in the same session does not promote the word");
  assert.strictEqual(s.mistakes[a], 1, "...and does not clear it from the mistake notebook");
  assert.deepStrictEqual(core.remainingToday(s), [b]);
  assert.ok(!s.checkins[core.dayKey(t)]);
  core.zhanAnswer(s, b, true, false, t);
  assert.strictEqual(s.cards[b].box, 1);
  assert.ok(s.checkins[core.dayKey(t)], "finishing the task checks in");
  assert.strictEqual(core.checkinStreak(s, t), 1);
});

test("slay removes a word from all future reviews and the mistake notebook", () => {
  const s = core.emptyState();
  const t = 1e12;
  const w = index.bySubject.chem[0];
  core.review(s, w.id, "again", t);
  s.mistakes[w.id] = 2;
  core.slay(s, w.id, t);
  assert.strictEqual(core.status(s, w.id), "mastered");
  assert.ok(!core.isDue(s, w.id, t + 100 * core.DAY));
  assert.ok(!(w.id in s.mistakes));
  assert.ok(!core.studyQueue(index.bySubject.chem, s, t, 1000).some((x) => x.id === w.id));
  assert.deepStrictEqual(core.resolvePool(index, s, "slain", t).map((x) => x.id), [w.id]);
  core.unslay(s, w.id);
  assert.ok(core.isDue(s, w.id, t + core.DAY));
});

test("check-in streak counts consecutive finished days", () => {
  const s = core.emptyState();
  const t = new Date(2026, 9, 8, 12).getTime();
  for (const d of [1, 2, 3, 5]) s.checkins[core.dayKey(t - d * core.DAY)] = true;
  assert.strictEqual(core.checkinStreak(s, t), 3, "today not done yet still shows yesterday's streak");
  s.checkins[core.dayKey(t)] = true;
  assert.strictEqual(core.checkinStreak(s, t), 4);
  assert.strictEqual(core.checkinStreak(s, t + 2 * core.DAY), 0);
});

test("old saved progress without the new fields still loads", () => {
  const s = core.normalizeState({ version: 1, cards: {}, starred: {}, mistakes: {}, streak: { last: null, count: 0 }, daily: {} });
  assert.deepStrictEqual(s.slain, {});
  assert.deepStrictEqual(s.today, { day: null, ids: [], done: [] });
  assert.strictEqual(s.plan.daily, 20);
});
