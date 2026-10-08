/*
 * VocAP core logic: no DOM access here, so it can be tested in Node.
 * Exposed as window.VocapCore in the browser and module.exports in Node.
 */
(function (root) {
  "use strict";

  const DAY = 24 * 60 * 60 * 1000;
  // Leitner boxes: days until the next review for each box.
  const INTERVALS = [0, 1, 2, 4, 8, 16, 32];
  const MASTERED_BOX = 4;
  const AGAIN_DELAY = 10 * 60 * 1000;

  function slug(s) {
    return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  }

  function tokens(term) {
    return String(term).toLowerCase().split(/[^a-z]+/).filter(Boolean);
  }

  /** Attach the word parts from `roots` that appear in `term`. */
  function matchRoots(term, roots) {
    const toks = tokens(term);
    const lower = String(term).toLowerCase();
    return roots.filter(function (r) {
      if (r.not && r.not.indexOf(lower) !== -1) return false;
      return r.forms.some(function (f) {
        return toks.some(function (t) {
          if (t.length <= f.length) return false; // a part is never the whole word
          if (r.type === "pre") return t.indexOf(f) === 0;
          if (r.type === "suf") return t.slice(-f.length) === f;
          return t.indexOf(f) !== -1;
        });
      });
    });
  }

  /** Flatten subjects into one word list with stable ids. */
  function buildIndex(subjects, roots) {
    const words = [];
    const byId = {};
    const bySubject = {};
    subjects.forEach(function (s) {
      bySubject[s.id] = [];
      s.words.forEach(function (w) {
        const word = Object.assign({}, w, {
          id: s.id + ":" + slug(w.t),
          subject: s.id,
          roots: matchRoots(w.t, roots || [])
        });
        words.push(word);
        byId[word.id] = word;
        bySubject[s.id].push(word);
      });
    });
    const rootIndex = (roots || []).map(function (r) {
      return Object.assign({}, r, {
        words: words.filter(function (w) { return w.roots.indexOf(r) !== -1; })
      });
    });
    // Point word.roots at the enriched copies.
    words.forEach(function (w) {
      w.roots = w.roots.map(function (r) { return rootIndex[roots.indexOf(r)]; });
    });
    return { subjects: subjects, words: words, byId: byId, bySubject: bySubject, roots: rootIndex };
  }

  /** "原函数；反导数（不定）" -> ["原函数", "反导数", "不定"] */
  function zhParts(zh) {
    return zh.split(/[；;，,、（）()]/).map(function (x) { return x.trim(); }).filter(Boolean);
  }

  /** Bilingual search: English term, Chinese meaning, or definition. */
  function search(index, query, limit) {
    const q = String(query || "").trim().toLowerCase();
    if (!q) return [];
    const scored = [];
    index.words.forEach(function (w) {
      const t = w.t.toLowerCase();
      let score = 0;
      if (t === q) score = 100;
      else if (zhParts(w.zh).indexOf(q) !== -1) score = 90;
      else if (t.indexOf(q) === 0) score = 80;
      else if (w.zh.indexOf(q) !== -1) score = 70;
      else if (t.indexOf(q) !== -1) score = 60;
      else if ((w.tip || "").indexOf(q) !== -1) score = 30;
      else if (w.d.toLowerCase().indexOf(q) !== -1) score = 20;
      if (score) scored.push({ w: w, score: score });
    });
    scored.sort(function (a, b) { return b.score - a.score || a.w.t.localeCompare(b.w.t); });
    return scored.slice(0, limit || 50).map(function (x) { return x.w; });
  }

  // ---------- progress state ----------

  function emptyState() {
    return {
      version: 1, cards: {}, starred: {}, mistakes: {}, streak: { last: null, count: 0 }, daily: {},
      slain: {},                          // id -> time the word was 斩'd (known, never shown again)
      checkins: {},                       // dayKey -> true when the daily plan was finished
      plan: { pool: "", daily: 20 },      // chosen word book + new words per day
      today: { day: null, ids: [], done: [] }
    };
  }

  function normalizeState(s) {
    const base = emptyState();
    if (!s || typeof s !== "object") return base;
    Object.keys(base).forEach(function (k) {
      if (s[k] && typeof s[k] === typeof base[k]) base[k] = s[k];
    });
    return base;
  }

  function dayKey(now) {
    const d = new Date(now);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  function touchStreak(state, now) {
    const today = dayKey(now);
    const yesterday = dayKey(now - DAY);
    if (state.streak.last === today) {
      // already counted
    } else if (state.streak.last === yesterday) {
      state.streak.count += 1;
    } else {
      state.streak.count = 1;
    }
    state.streak.last = today;
    state.daily[today] = (state.daily[today] || 0) + 1;
  }

  function currentStreak(state, now) {
    const last = state.streak.last;
    if (last === dayKey(now) || last === dayKey(now - DAY)) return state.streak.count;
    return 0;
  }

  /** grade: "again" | "good" | "easy" */
  function review(state, id, grade, now) {
    const c = state.cards[id] || { box: 0, due: now, seen: 0, right: 0, wrong: 0 };
    c.seen += 1;
    if (grade === "again") {
      c.box = 0;
      c.wrong += 1;
      c.due = now + AGAIN_DELAY;
    } else {
      c.box = Math.min(INTERVALS.length - 1, c.box + (grade === "easy" ? 2 : 1));
      c.right += 1;
      c.due = now + INTERVALS[c.box] * DAY;
    }
    state.cards[id] = c;
    touchStreak(state, now);
    return c;
  }

  function status(state, id) {
    if (state.slain[id]) return "mastered";
    const c = state.cards[id];
    if (!c) return "new";
    return c.box >= MASTERED_BOX ? "mastered" : "learning";
  }

  function isDue(state, id, now) {
    const c = state.cards[id];
    return !!c && !state.slain[id] && c.due <= now;
  }

  function recordQuizAnswer(state, id, correct, now) {
    if (correct) {
      if (state.mistakes[id]) {
        state.mistakes[id] -= 1;
        if (state.mistakes[id] <= 0) delete state.mistakes[id];
      }
    } else {
      state.mistakes[id] = (state.mistakes[id] || 0) + 1;
    }
    touchStreak(state, now);
  }

  // ---------- 斩词 daily plan ----------

  const DAILY_REVIEW_CAP = 60;

  /**
   * Today's task: due reviews first, then `plan.daily` new words from the plan's pool.
   * The list is fixed for the day (stored in state.today) so reloading doesn't reshuffle it.
   */
  function startDay(index, state, now, rand) {
    const today = dayKey(now);
    if (state.today.day === today) return state.today;
    const pool = resolvePool(index, state, state.plan.pool || "all", now);
    const due = pool.filter(function (w) { return isDue(state, w.id, now); })
      .sort(function (a, b) { return state.cards[a.id].due - state.cards[b.id].due; })
      .slice(0, DAILY_REVIEW_CAP);
    const fresh = studyQueue(pool, state, now, state.plan.daily, rand).filter(function (w) { return !state.cards[w.id]; });
    state.today = { day: today, ids: due.concat(fresh).map(function (w) { return w.id; }), done: [] };
    return state.today;
  }

  /** Ids from today's task that still need a correct answer (or a 斩). */
  function remainingToday(state) {
    return state.today.ids.filter(function (id) { return state.today.done.indexOf(id) === -1; });
  }

  function finishIfComplete(state, now) {
    if (state.today.ids.length && !remainingToday(state).length) state.checkins[dayKey(now)] = true;
  }

  /**
   * One answer in a 斩词 session. A wrong answer sends the word to the mistake notebook
   * and resets its review box; the word stays in today's task until answered correctly.
   * `retry` is true when re-asking a word already missed this session.
   */
  function zhanAnswer(state, id, correct, retry, now) {
    if (correct) {
      if (!retry) review(state, id, "good", now);
      if (state.today.done.indexOf(id) === -1) state.today.done.push(id);
      finishIfComplete(state, now);
    } else {
      review(state, id, "again", now);
    }
    // Getting a word right moments after missing it doesn't prove you know it,
    // so a same-session retry leaves it in the mistake notebook.
    if (!(correct && retry)) recordQuizAnswer(state, id, correct, now);
  }

  /** 斩: "I already know this word" — never schedule it again. */
  function slay(state, id, now) {
    state.slain[id] = now;
    delete state.mistakes[id];
    if (state.today.ids.indexOf(id) !== -1 && state.today.done.indexOf(id) === -1) state.today.done.push(id);
    finishIfComplete(state, now);
    touchStreak(state, now);
  }

  function unslay(state, id) {
    delete state.slain[id];
  }

  /** Number of consecutive check-in days ending today (or yesterday, if today isn't done yet). */
  function checkinStreak(state, now) {
    let t = state.checkins[dayKey(now)] ? now : now - DAY;
    let n = 0;
    while (state.checkins[dayKey(t)]) { n++; t -= DAY; }
    return n;
  }

  /**
   * Pool spec strings:
   *   all | due | starred | mistakes | slain | s:<subject> | s:<subject>:<unit>
   */
  function resolvePool(index, state, spec, now) {
    spec = spec || "all";
    if (spec === "all") return index.words.slice();
    if (spec === "due") return index.words.filter(function (w) { return isDue(state, w.id, now); });
    if (spec === "starred") return index.words.filter(function (w) { return state.starred[w.id]; });
    if (spec === "mistakes") return index.words.filter(function (w) { return state.mistakes[w.id]; });
    if (spec === "slain") return index.words.filter(function (w) { return state.slain[w.id]; });
    const m = /^s:([^:]+)(?::(.+))?$/.exec(spec);
    if (m && index.bySubject[m[1]]) {
      return index.bySubject[m[1]].filter(function (w) { return !m[2] || w.u === m[2]; });
    }
    return [];
  }

  function shuffle(arr, rand) {
    rand = rand || Math.random;
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  /** Cards for a flashcard session: due reviews first, then up to `newLimit` unseen words. */
  function studyQueue(pool, state, now, newLimit, rand) {
    const due = pool.filter(function (w) { return isDue(state, w.id, now); });
    due.sort(function (a, b) { return state.cards[a.id].due - state.cards[b.id].due; });
    const fresh = shuffle(pool.filter(function (w) { return !state.cards[w.id] && !state.slain[w.id]; }), rand).slice(0, newLimit);
    return due.concat(fresh);
  }

  // ---------- quiz ----------

  function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  /** Example sentence with the term blanked out, or null if the term is not found. */
  function cloze(word) {
    const re = new RegExp("\\b" + escapeRegExp(word.t) + "[a-z]*", "i");
    if (!re.test(word.ex)) return null;
    return word.ex.replace(re, "_____");
  }

  const QUIZ_MODES = ["en2zh", "zh2en", "def2en", "cloze", "spell"];

  function pickDistractors(word, pool, all, n, key, rand) {
    const seen = {};
    seen[word[key]] = true;
    const out = [];
    const sources = [shuffle(pool, rand), shuffle(all, rand)];
    for (let s = 0; s < sources.length && out.length < n; s++) {
      for (let i = 0; i < sources[s].length && out.length < n; i++) {
        const w = sources[s][i];
        if (!seen[w[key]]) { seen[w[key]] = true; out.push(w); }
      }
    }
    return out;
  }

  /**
   * Build quiz questions.
   * mode: one of QUIZ_MODES or "mixed".
   */
  function buildQuiz(pool, allWords, mode, count, rand) {
    rand = rand || Math.random;
    return shuffle(pool, rand).slice(0, count).map(function (w) {
      const m = mode === "mixed" ? QUIZ_MODES[Math.floor(rand() * QUIZ_MODES.length)] : mode;
      return question(w, pool, allWords, m, rand);
    });
  }

  /** One question about `w`; distractors come from the same subject in `pool` first. */
  function question(w, pool, allWords, m, rand) {
    rand = rand || Math.random;
    let prompt = null;
    if (m === "cloze") {
      prompt = cloze(w);
      if (!prompt) m = "def2en";
    }
    if (m === "spell") {
      return { word: w, mode: m, prompt: w.zh, hint: w.d, answer: w.t };
    }
    const key = m === "en2zh" ? "zh" : "t";
    const same = pool.filter(function (x) { return x.subject === w.subject; });
    const distract = pickDistractors(w, same, allWords, 3, key, rand);
    const options = shuffle([w].concat(distract), rand);
    return {
      word: w,
      mode: m,
      prompt: m === "en2zh" ? w.t : m === "zh2en" ? w.zh : m === "def2en" ? w.d : prompt,
      options: options.map(function (o) { return { id: o.id, label: o[key] }; }),
      answer: w.id
    };
  }

  function checkSpelling(input, term) {
    const norm = function (s) { return String(s).toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, " ").trim(); };
    return norm(input) === norm(term);
  }

  const api = {
    DAY: DAY,
    INTERVALS: INTERVALS,
    MASTERED_BOX: MASTERED_BOX,
    QUIZ_MODES: QUIZ_MODES,
    slug: slug,
    matchRoots: matchRoots,
    buildIndex: buildIndex,
    search: search,
    emptyState: emptyState,
    normalizeState: normalizeState,
    dayKey: dayKey,
    currentStreak: currentStreak,
    review: review,
    status: status,
    isDue: isDue,
    recordQuizAnswer: recordQuizAnswer,
    resolvePool: resolvePool,
    shuffle: shuffle,
    studyQueue: studyQueue,
    cloze: cloze,
    buildQuiz: buildQuiz,
    question: question,
    checkSpelling: checkSpelling,
    startDay: startDay,
    remainingToday: remainingToday,
    zhanAnswer: zhanAnswer,
    slay: slay,
    unslay: unslay,
    checkinStreak: checkinStreak
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.VocapCore = api;
})(typeof window !== "undefined" ? window : this);
