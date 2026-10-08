/* VocAP UI: hash router + views. Logic lives in core.js. */
(function () {
  "use strict";

  const C = window.VocapCore;
  const STORE_KEY = "vocap.progress.v1";
  const PREFS_KEY = "vocap.prefs.v1";
  const NEW_PER_SESSION = 15;
  const QUIZ_LENGTH = 10;

  const subjects = (window.VOCAP_SUBJECTS || []).slice().sort(function (a, b) {
    return (b.featured ? 1 : 0) - (a.featured ? 1 : 0);
  });
  const index = C.buildIndex(subjects, window.VOCAP_ROOTS || []);
  const subjectById = {};
  subjects.forEach(function (s) { subjectById[s.id] = s; });

  const app = document.getElementById("app");
  const dialog = document.getElementById("word-dialog");
  const dialogBody = document.getElementById("word-dialog-body");

  // ---------- persistence ----------

  function readJSON(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; }
  }
  function writeJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* private mode: keep in memory */ }
  }

  let state = C.normalizeState(readJSON(STORE_KEY));
  const prefs = Object.assign({ hideZh: false, reverse: false, autoSpeak: true }, readJSON(PREFS_KEY) || {});

  function save() { writeJSON(STORE_KEY, state); }
  function savePrefs() { writeJSON(PREFS_KEY, prefs); }

  // ---------- helpers ----------

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function highlight(sentence, term) {
    const safe = esc(sentence);
    const re = new RegExp("\\b(" + esc(term).replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "[a-z]*)", "i");
    return safe.replace(re, "<mark>$1</mark>");
  }

  function now() { return Date.now(); }

  /** Navigate, re-rendering even when the hash is already the target. */
  function go(hash) {
    if (location.hash === hash) route();
    else location.hash = hash;
  }

  function parseHash() {
    const raw = location.hash.replace(/^#\/?/, "");
    const qi = raw.indexOf("?");
    const pathPart = qi === -1 ? raw : raw.slice(0, qi);
    const params = new URLSearchParams(qi === -1 ? "" : raw.slice(qi + 1));
    return { parts: pathPart.split("/").filter(Boolean).map(decodeURIComponent), params: params };
  }

  const canSpeak = "speechSynthesis" in window;
  function speak(text) {
    if (!canSpeak) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "en-US";
    u.rate = 0.9;
    const voice = window.speechSynthesis.getVoices().find(function (v) { return /^en(-|_)US/i.test(v.lang); });
    if (voice) u.voice = voice;
    window.speechSynthesis.speak(u);
  }

  // Inline SVG icons (stroke = currentColor) so the UI needs no icon font or emoji.
  function svg(paths, fill) {
    return '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" fill="' + (fill ? "currentColor" : "none") +
      '" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + paths + "</svg>";
  }
  const STAR = '<path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z"/>';
  const ICON = {
    speaker: svg('<path d="M11 5L6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 010 7M18.5 5.5a9 9 0 010 13"/>'),
    star: svg(STAR),
    starFill: svg(STAR, true),
    close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
    back: svg('<path d="M15 6l-6 6 6 6"/>'),
    check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
    cross: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
    clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
    shuffle: svg('<path d="M16 4h4v4M4 20L20 4M20 16v4h-4M15 15l5 5M4 4l5 5"/>'),
    alert: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5M12 16.5v.01"/>'),
    slash: svg('<path d="M5 19L19 5M14 5h5v5"/>')
  };

  function courseBadge(s, cls) {
    return '<span class="course-badge' + (cls ? " " + cls : "") + '" style="--c:' + s.color + '">' + esc(s.icon) + "</span>";
  }

  function tipHtml(w) {
    return w.tip ? '<p class="tip"><span class="tip-label">提示 Tip</span>' + esc(w.tip) + "</p>" : "";
  }

  function speakBtn(term) {
    if (!canSpeak) return "";
    return '<button class="icon-btn" data-speak="' + esc(term) + '" title="朗读 Pronounce" aria-label="Pronounce ' + esc(term) + '">' + ICON.speaker + "</button>";
  }

  function starBtn(id) {
    const on = !!state.starred[id];
    return '<button class="icon-btn star' + (on ? " on" : "") + '" data-star="' + esc(id) + '" title="加入生词本 Star" aria-pressed="' + on + '" aria-label="Star">' + (on ? ICON.starFill : ICON.star) + "</button>";
  }

  function statusBadge(id) {
    const st = C.status(state, id);
    if (st === "new") return ""; // most words are new; only show progress once there is some
    const label = { new: "新词 New", learning: "学习中 Learning", mastered: "已掌握 Mastered" }[st];
    return '<span class="badge badge-' + st + '">' + label + "</span>";
  }

  function subjectTag(w) {
    const s = subjectById[w.subject];
    return '<a class="subject-tag" href="#/s/' + s.id + '" style="--c:' + s.color + '">' + esc(s.name) + "</a>";
  }

  function rootChips(w) {
    if (!w.roots.length) return "";
    return '<div class="roots-line"><span class="muted">词根拆解 Word parts:</span> ' + w.roots.map(function (r) {
      return '<a class="chip" href="#/roots?r=' + encodeURIComponent(r.part) + '" title="' + esc(r.m) + '"><b>' + esc(r.part) + "</b> " + esc(r.zh) + "</a>";
    }).join(" ") + "</div>";
  }

  function wordCard(w, opts) {
    opts = opts || {};
    const hide = prefs.hideZh && !opts.showZh;
    return '<article class="word-card" data-word="' + esc(w.id) + '">' +
      '<div class="word-head">' +
        '<h3 class="term"><button class="link-btn" data-open="' + esc(w.id) + '">' + esc(w.t) + "</button></h3>" +
        '<span class="pos">' + esc(w.p) + "</span>" +
        speakBtn(w.t) +
        '<span class="spacer"></span>' +
        (state.mistakes[w.id] ? '<span class="badge badge-wrong" title="答错次数 Times missed">错 ×' + state.mistakes[w.id] + "</span>" : "") +
        statusBadge(w.id) + starBtn(w.id) +
      "</div>" +
      '<p class="zh' + (hide ? " concealed" : "") + '"' + (hide ? ' tabindex="0" role="button" title="点击显示中文"' : "") + ">" + esc(w.zh) + "</p>" +
      '<p class="def">' + esc(w.d) + "</p>" +
      '<p class="ex">“' + highlight(w.ex, w.t) + "”</p>" +
      tipHtml(w) +
      rootChips(w) +
      (opts.showSubject ? '<div class="card-foot">' + subjectTag(w) + "</div>" : "") +
    "</article>";
  }

  function progressFor(words) {
    let mastered = 0, learning = 0;
    words.forEach(function (w) {
      const st = C.status(state, w.id);
      if (st === "mastered") mastered++;
      else if (st === "learning") learning++;
    });
    return { mastered: mastered, learning: learning, total: words.length };
  }

  function progressBar(p) {
    const m = p.total ? (100 * p.mastered / p.total) : 0;
    const l = p.total ? (100 * p.learning / p.total) : 0;
    return '<div class="progress" role="img" aria-label="' + p.mastered + " of " + p.total + ' mastered">' +
      '<span class="p-mastered" style="width:' + m + '%"></span>' +
      '<span class="p-learning" style="width:' + l + '%"></span></div>';
  }

  function poolLabel(spec) {
    if (spec === "all") return "全部词汇 All words";
    if (spec === "due") return "今日复习 Due today";
    if (spec === "starred") return "生词本 Starred";
    if (spec === "mistakes") return "错题本 Mistakes";
    if (spec === "slain") return "已斩 Slain";
    const m = /^s:([^:]+)(?::(.+))?$/.exec(spec || "");
    if (m && subjectById[m[1]]) {
      const s = subjectById[m[1]];
      return s.name + (m[2] && s.units[m[2]] ? " · " + s.units[m[2]] : "");
    }
    return spec;
  }

  function setNav(name) {
    document.querySelectorAll("[data-nav]").forEach(function (a) {
      a.classList.toggle("active", a.getAttribute("data-nav") === name);
    });
  }

  function render(html, nav) {
    setNav(nav);
    app.innerHTML = html;
    window.scrollTo(0, 0);
  }

  // ---------- views ----------

  function viewHome() {
    const t = now();
    const due = C.resolvePool(index, state, "due", t).length;
    const all = progressFor(index.words);
    const streak = Math.max(C.currentStreak(state, t), C.checkinStreak(state, t));
    const checkedIn = !!state.checkins[C.dayKey(t)];

    const courseCards = subjects.filter(function (s) { return !s.featured; }).map(function (s) {
      const p = progressFor(index.bySubject[s.id]);
      return '<a class="course-card" href="#/s/' + s.id + '" style="--c:' + s.color + '">' +
        '<div class="course-top">' + courseBadge(s) +
          '<span class="course-count">' + p.total + " terms</span></div>" +
        '<span class="course-name">' + esc(s.name) + "</span>" +
        '<span class="course-zh">' + esc(s.zh) + "</span>" +
        progressBar(p) +
        '<span class="course-foot"><span>已掌握 ' + p.mastered + " / " + p.total + '</span><span class="more">Explore ›</span></span>' +
      "</a>";
    }).join("");

    const exam = subjects.filter(function (s) { return s.featured; })[0];
    const examP = exam ? progressFor(index.bySubject[exam.id]) : null;

    render(
      '<section class="band hero">' +
        '<p class="eyebrow">AP 学术词汇 · Academic Vocabulary for AP</p>' +
        '<h1>你已经懂了知识，<br>现在把它翻译成 <span class="hl">AP 的语言</span>。</h1>' +
        '<p class="lead">You already understand the science and math. VocAP bridges the words you know in 中文 to the English you need on the AP exam — across every course.</p>' +
        '<div class="actions">' +
          '<a class="btn btn-yellow" href="#/zhan">' + (checkedIn ? ICON.check + " 今日已打卡 · 继续练习" : "开始每日斩词 Start Daily Words") + "</a>" +
          (due ? '<a class="btn btn-ghost-light" href="#/study?pool=due">复习 ' + due + " 个到期单词 Review due</a>" : '<a class="btn btn-ghost-light" href="#/quiz">小测一下 Take a quiz</a>') +
        "</div>" +
      "</section>" +
      '<section class="stat-strip">' +
        '<div class="stat"><b>' + due + '</b><span>今日待复习 Due today</span></div>' +
        '<div class="stat"><b>' + all.mastered + '</b><span>已掌握 Mastered</span></div>' +
        '<div class="stat"><b>' + all.learning + '</b><span>学习中 Learning</span></div>' +
        '<div class="stat"><b>' + streak + '</b><span>连续天数 Day streak</span></div>' +
      "</section>" +
      (exam
        ? '<a class="callout" href="#/s/' + exam.id + '">' +
            '<span class="callout-label">先从这里开始 Start here</span>' +
            '<span class="callout-body"><b>' + esc(exam.zh) + " · " + esc(exam.name) + "</b>" +
            "<span>identify, explain, justify, negligible, respectively… 看懂题目要求，是拿分的第一步。</span></span>" +
            '<span class="callout-meta">' + examP.mastered + " / " + examP.total + " ›</span></a>"
        : "") +
      '<div class="section-head"><p class="eyebrow dark">Courses</p><h2>选择科目 Choose a course</h2>' +
        '<p class="muted">' + subjects.length + " 门课程 · " + index.words.length + " 个术语 terms</p></div>" +
      '<div class="course-grid">' + courseCards + "</div>" +
      '<section class="how">' +
        '<div class="section-head"><p class="eyebrow dark">How it works</p><h2>怎么学</h2></div>' +
        '<div class="how-grid">' +
          '<div><span class="step">01</span><b>搭桥 Bridge</b><p>用中文搜索你熟悉的概念（如「导数」「有丝分裂」），立刻找到 AP 用的英文术语和例句。</p></div>' +
          '<div><span class="step">02</span><b>拆解 Decode</b><p>学习希腊/拉丁词根：photo-（光）+ synthesis（合成）。遇到生词也能猜出意思。</p></div>' +
          '<div><span class="step">03</span><b>记牢 Remember</b><p>每日斩词：先复习、再学新词，认识的直接「斩」掉；答错的词自动进入错题本，直到你答对为止。</p></div>' +
        "</div>" +
      "</section>",
      "home"
    );
  }

  function viewSubject(id, params) {
    const s = subjectById[id];
    if (!s) return viewNotFound();
    const unit = params.get("u") || "";
    const filter = params.get("f") || "all";
    const words = index.bySubject[id].filter(function (w) {
      if (unit && w.u !== unit) return false;
      if (filter !== "all" && C.status(state, w.id) !== filter) return false;
      return true;
    });
    const p = progressFor(index.bySubject[id]);
    const pool = "s:" + id + (unit ? ":" + unit : "");
    const link = function (u, f) {
      const q = new URLSearchParams();
      if (u) q.set("u", u);
      if (f && f !== "all") q.set("f", f);
      const qs = q.toString();
      return "#/s/" + id + (qs ? "?" + qs : "");
    };
    const unitChips = '<a class="chip' + (!unit ? " active" : "") + '" href="' + link("", filter) + '">全部 All</a>' +
      Object.keys(s.units).map(function (u) {
        return '<a class="chip' + (unit === u ? " active" : "") + '" href="' + link(u, filter) + '">' + esc(s.units[u]) + "</a>";
      }).join("");
    const filters = [["all", "全部"], ["new", "新词"], ["learning", "学习中"], ["mastered", "已掌握"]].map(function (f) {
      return '<a class="chip small' + (filter === f[0] ? " active" : "") + '" href="' + link(unit, f[0]) + '">' + f[1] + "</a>";
    }).join("");

    render(
      '<section class="subject-hero" style="--c:' + s.color + '">' +
        courseBadge(s, "big") +
        '<div><h1>' + esc(s.name) + '</h1><p class="muted">' + esc(s.zh) + " · " + p.mastered + "/" + p.total + " 已掌握 mastered</p>" + progressBar(p) + "</div>" +
        '<div class="actions">' +
          '<a class="btn primary" href="#/study?pool=' + encodeURIComponent(pool) + '">闪卡 Study</a>' +
          '<a class="btn" href="#/quiz?pool=' + encodeURIComponent(pool) + '">测验 Quiz</a>' +
        "</div>" +
      "</section>" +
      '<div class="toolbar">' +
        '<div class="chips">' + unitChips + "</div>" +
        '<div class="chips">' + filters +
          '<label class="toggle"><input type="checkbox" id="hide-zh"' + (prefs.hideZh ? " checked" : "") + "> 遮住中文自测 Hide Chinese</label>" +
        "</div>" +
      "</div>" +
      (words.length ? '<div class="word-list">' + words.map(function (w) { return wordCard(w); }).join("") + "</div>"
        : '<p class="empty">这里还没有单词。No words match this filter.</p>'),
      ""
    );
    const hz = document.getElementById("hide-zh");
    hz.addEventListener("change", function () {
      prefs.hideZh = hz.checked;
      savePrefs();
      document.querySelectorAll(".word-card .zh").forEach(function (el) {
        el.classList.toggle("concealed", prefs.hideZh);
      });
    });
  }

  function viewSearch(params) {
    const q = params.get("q") || "";
    document.getElementById("search-input").value = q;
    const results = C.search(index, q, 60);
    render(
      '<h1 class="page-title">搜索 Search: “' + esc(q) + '”</h1>' +
      '<p class="muted">' + results.length + " 个结果 results · 支持英文、中文和释义搜索</p>" +
      (results.length ? '<div class="word-list">' + results.map(function (w) { return wordCard(w, { showSubject: true, showZh: true }); }).join("") + "</div>"
        : '<p class="empty">没有找到。试试别的说法，或用中文关键词。<br>No results — try a shorter word or a Chinese keyword.</p>'),
      ""
    );
  }

  // ----- pool picker shared by study & quiz -----

  function poolPicker(route, title, subtitle) {
    const t = now();
    const specials = [
      ["due", ICON.clock, "今日复习", "Due today"],
      ["all", ICON.shuffle, "全部混合", "All courses"],
      ["starred", ICON.starFill, "生词本", "Starred"],
      ["mistakes", ICON.alert, "错题本", "Mistakes"]
    ].map(function (x) {
      const n = C.resolvePool(index, state, x[0], t).length;
      return '<a class="pool' + (n ? "" : " disabled") + '" href="#/' + route + "?pool=" + x[0] + '"' + (n ? "" : ' aria-disabled="true"') + ">" +
        '<span class="pool-icon">' + x[1] + "</span><b>" + x[2] + "</b><span>" + x[3] + " · " + n + "</span></a>";
    }).join("");
    const subj = subjects.map(function (s) {
      const ws = index.bySubject[s.id];
      const dueN = ws.filter(function (w) { return C.isDue(state, w.id, t); }).length;
      return '<a class="pool" href="#/' + route + "?pool=s:" + s.id + '" style="--c:' + s.color + '">' +
        courseBadge(s) + "<b>" + esc(s.name) + "</b><span>" + esc(s.zh) + " · " + ws.length + (dueN ? " · " + dueN + " due" : "") + "</span></a>";
    }).join("");
    render(
      '<h1 class="page-title">' + title + "</h1><p class=\"muted\">" + subtitle + "</p>" +
      '<div class="pool-grid">' + specials + "</div>" +
      '<h2 class="section-title">按科目 By subject</h2>' +
      '<div class="pool-grid">' + subj + "</div>",
      route
    );
  }

  // ----- flashcards -----

  let session = null;

  function viewStudy(params) {
    const spec = params.get("pool");
    if (!spec) return poolPicker("study", "闪卡学习 Flashcards", "间隔重复：记得越牢，下次复习间隔越长。Spaced repetition shows each word right before you would forget it.");
    const pool = C.resolvePool(index, state, spec, now());
    const queue = spec === "due" || spec === "starred" || spec === "mistakes"
      ? C.studyQueue(pool, state, now(), pool.length).concat(pool.filter(function (w) { return state.cards[w.id] && !C.isDue(state, w.id, now()); }))
      : C.studyQueue(pool, state, now(), NEW_PER_SESSION);
    session = { spec: spec, queue: queue, done: 0, again: 0, flipped: false, total: queue.length };
    renderCard();
  }

  function renderCard() {
    const s = session;
    if (!s.queue.length) {
      const nextDue = C.resolvePool(index, state, s.spec, now()).filter(function (w) { return state.cards[w.id]; })
        .map(function (w) { return state.cards[w.id].due; }).sort(function (a, b) { return a - b; })[0];
      render(
        '<section class="done">' +
          "<h1>完成！Session complete</h1>" +
          "<p>" + esc(poolLabel(s.spec)) + "</p>" +
          (s.total ? "<p>本轮学习了 <b>" + s.done + "</b> 张卡片，其中 <b>" + s.again + "</b> 次选了「再来」。</p>"
            : "<p>这一组目前没有需要学习的卡片。Nothing to study here right now.</p>") +
          (nextDue ? '<p class="muted">下次复习时间 Next review: ' + new Date(nextDue).toLocaleString() + "</p>" : "") +
          '<div class="actions center">' +
            '<a class="btn primary" href="#/quiz?pool=' + encodeURIComponent(s.spec) + '">测验巩固 Quiz these words</a>' +
            '<a class="btn" href="#/study">换一组 Choose another set</a>' +
          "</div>" +
        "</section>",
        "study"
      );
      return;
    }
    const w = s.queue[0];
    const front = prefs.reverse
      ? '<p class="card-zh">' + esc(w.zh) + '</p><p class="muted">' + esc(subjectById[w.subject].name) + "</p>"
      : '<p class="card-term">' + esc(w.t) + ' <span class="pos">' + esc(w.p) + "</span></p>" + speakBtn(w.t);
    const back =
      (prefs.reverse ? '<p class="card-term">' + esc(w.t) + ' <span class="pos">' + esc(w.p) + "</span> " + speakBtn(w.t) + "</p>" : '<p class="card-zh">' + esc(w.zh) + "</p>") +
      '<p class="def">' + esc(w.d) + "</p>" +
      '<p class="ex">“' + highlight(w.ex, w.t) + "”</p>" +
      tipHtml(w) +
      rootChips(w);
    const pct = s.total ? Math.round(100 * s.done / (s.done + s.queue.length)) : 0;

    render(
      '<div class="study-top">' +
        '<a class="back" href="#/study">' + ICON.back + esc(poolLabel(s.spec)) + "</a>" +
        '<label class="toggle"><input type="checkbox" id="reverse"' + (prefs.reverse ? " checked" : "") + "> 中→英 Chinese first</label>" +
        '<span class="muted">剩余 ' + s.queue.length + " left</span>" +
      "</div>" +
      '<div class="progress thin"><span class="p-mastered" style="width:' + pct + '%"></span></div>' +
      '<div class="flashcard' + (s.flipped ? " flipped" : "") + '" id="flashcard" tabindex="0" role="button" aria-label="Flip card">' +
        '<div class="card-front">' + front + (s.flipped ? "" : '<p class="hint">点击或按空格翻面 · Tap or press Space</p>') + "</div>" +
        (s.flipped ? '<div class="card-back">' + back + "</div>" : "") +
      "</div>" +
      (s.flipped
        ? '<div class="grade-row">' +
            '<button class="btn grade again" data-grade="again">再来<small>Again · 1</small></button>' +
            '<button class="btn grade good" data-grade="good">记得<small>Good · 2</small></button>' +
            '<button class="btn grade easy" data-grade="easy">很简单<small>Easy · 3</small></button>' +
          "</div>"
        : '<div class="grade-row"><button class="btn primary wide" id="flip">显示答案 Show answer</button></div>'),
      "study"
    );
    document.getElementById("reverse").addEventListener("change", function (e) {
      prefs.reverse = e.target.checked;
      savePrefs();
      renderCard();
    });
  }

  function flip() {
    if (!session || session.flipped || !session.queue.length) return;
    session.flipped = true;
    renderCard();
  }

  function grade(g) {
    if (!session || !session.flipped) return;
    const w = session.queue.shift();
    C.review(state, w.id, g, now());
    C.recordQuizAnswer(state, w.id, g !== "again", now());
    save();
    session.done++;
    if (g === "again") {
      session.again++;
      session.queue.splice(Math.min(3, session.queue.length), 0, w);
    }
    session.flipped = false;
    renderCard();
  }

  // ----- quiz -----

  let quiz = null;

  const MODE_LABELS = {
    mixed: ["混合", "Mixed"],
    en2zh: ["英 → 中", "English → 中文"],
    zh2en: ["中 → 英", "中文 → English"],
    def2en: ["看释义选词", "Definition → word"],
    cloze: ["例句填空", "Fill in the blank"],
    spell: ["拼写", "Spelling"]
  };

  function viewQuiz(params) {
    const spec = params.get("pool");
    if (!spec) return poolPicker("quiz", "测验 Quiz", "每轮 " + QUIZ_LENGTH + " 题。答错的单词会自动进入错题本。Wrong answers go to your mistake notebook.");
    const mode = params.get("mode");
    const pool = C.resolvePool(index, state, spec, now());
    if (!mode) {
      render(
        '<a class="back" href="#/quiz">' + ICON.back + '选择词组 Choose words</a>' +
        '<h1 class="page-title">' + esc(poolLabel(spec)) + "</h1>" +
        '<p class="muted">' + pool.length + " 个单词 words · 选择题型 Choose a question type</p>" +
        '<div class="pool-grid">' + Object.keys(MODE_LABELS).map(function (m) {
          return '<a class="pool" href="#/quiz?pool=' + encodeURIComponent(spec) + "&mode=" + m + '"><b>' + MODE_LABELS[m][0] + "</b><span>" + MODE_LABELS[m][1] + "</span></a>";
        }).join("") + "</div>",
        "quiz"
      );
      return;
    }
    if (!pool.length) {
      render('<p class="empty">这一组没有单词。No words in this set.</p><p class="center"><a class="btn" href="#/quiz">返回 Back</a></p>', "quiz");
      return;
    }
    quiz = { spec: spec, mode: mode, qs: C.buildQuiz(pool, index.words, mode, QUIZ_LENGTH), i: 0, score: 0, answered: null, wrong: [] };
    renderQuestion();
  }

  function renderQuestion() {
    const q = quiz.qs[quiz.i];
    if (!q) return renderQuizResult();
    const a = quiz.answered;
    const promptLabel = {
      en2zh: "这个词的中文意思是？What does this mean?",
      zh2en: "对应的英文术语是？Which English term?",
      def2en: "哪个词符合这个释义？Which word matches?",
      cloze: "选词填空 Fill in the blank",
      spell: "拼写英文术语 Type the English term"
    }[q.mode];
    const promptClass = q.mode === "en2zh" ? "q-prompt term-like" : q.mode === "zh2en" || q.mode === "spell" ? "q-prompt zh-like" : "q-prompt";
    let body;
    if (q.mode === "spell") {
      body = '<p class="muted">' + esc(q.hint) + "</p>" +
        '<form id="spell-form" class="spell"><input id="spell-input" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="type the word…"' +
        (a ? " disabled" : "") + ' value="' + esc(a ? a.input : "") + '">' +
        (a ? "" : '<button class="btn primary">确定 Check</button>') + "</form>";
    } else {
      body = '<div class="options">' + q.options.map(function (o, i) {
        let cls = "option";
        if (a) {
          if (o.id === q.answer) cls += " correct";
          else if (o.id === a.choice) cls += " wrong";
        }
        return '<button class="' + cls + '" data-choice="' + esc(o.id) + '"' + (a ? " disabled" : "") + "><kbd>" + (i + 1) + "</kbd> " + esc(o.label) + "</button>";
      }).join("") + "</div>";
    }
    const feedback = a
      ? '<div class="feedback ' + (a.correct ? "ok" : "bad") + '">' +
          (a.correct ? ICON.check + " 正确 Correct!" : ICON.cross + " 正确答案 Answer: <b>" + esc(q.word.t) + "</b> — " + esc(q.word.zh)) +
          '<div class="feedback-word">' + wordCard(q.word, { showZh: true }) + "</div>" +
          '<button class="btn primary wide" id="next-q">' + (quiz.i + 1 < quiz.qs.length ? "下一题 Next →" : "查看结果 See results") + "</button>" +
        "</div>"
      : "";
    render(
      '<div class="study-top"><a class="back" href="#/quiz?pool=' + encodeURIComponent(quiz.spec) + '">' + ICON.back + esc(poolLabel(quiz.spec)) + "</a>" +
        '<span class="muted">' + (quiz.i + 1) + " / " + quiz.qs.length + " · 得分 " + quiz.score + "</span></div>" +
      '<div class="progress thin"><span class="p-mastered" style="width:' + (100 * quiz.i / quiz.qs.length) + '%"></span></div>' +
      '<section class="question">' +
        '<p class="muted">' + promptLabel + "</p>" +
        '<p class="' + promptClass + '">' + esc(q.prompt) + (q.mode === "en2zh" ? " " + speakBtn(q.word.t) : "") + "</p>" +
        body + feedback +
      "</section>",
      "quiz"
    );
    const input = document.getElementById("spell-input");
    if (input && !a) input.focus();
    const next = document.getElementById("next-q");
    if (next) next.focus();
  }

  function answer(choice, input) {
    const q = quiz.qs[quiz.i];
    if (quiz.answered) return;
    const correct = q.mode === "spell" ? C.checkSpelling(input, q.answer) : choice === q.answer;
    quiz.answered = { choice: choice, input: input, correct: correct };
    if (correct) quiz.score++;
    else quiz.wrong.push(q.word);
    C.recordQuizAnswer(state, q.word.id, correct, now());
    save();
    renderQuestion();
  }

  function nextQuestion() {
    quiz.i++;
    quiz.answered = null;
    renderQuestion();
  }

  function renderQuizResult() {
    const pct = Math.round(100 * quiz.score / quiz.qs.length);
    const msg = pct === 100 ? "满分！Perfect!" : pct >= 80 ? "很棒！Great job!" : pct >= 60 ? "不错，继续加油！Keep going!" : "多复习几次就会了。Practice makes perfect.";
    render(
      '<section class="done">' +
        "<h1>" + quiz.score + " / " + quiz.qs.length + "</h1>" +
        "<p>" + msg + "</p>" +
        (quiz.wrong.length
          ? '<h2 class="section-title">需要复习 Review these (已加入错题本)</h2><div class="word-list">' +
            quiz.wrong.map(function (w) { return wordCard(w, { showZh: true }); }).join("") + "</div>"
          : "") +
        '<div class="actions center">' +
          '<a class="btn primary" href="#/quiz?pool=' + encodeURIComponent(quiz.spec) + "&mode=" + quiz.mode + "&r=" + Date.now() + '">再来一轮 Again</a>' +
          (quiz.wrong.length ? '<a class="btn" href="#/study?pool=mistakes">闪卡复习错题 Study mistakes</a>' : "") +
          '<a class="btn" href="#/quiz">换一组 Other words</a>' +
        "</div>" +
      "</section>",
      "quiz"
    );
  }

  // ----- 斩词 daily mode (inspired by 百词斩) -----

  let zhan = null;
  const DAILY_OPTIONS = [10, 20, 30, 50];

  function planPoolLabel() {
    return poolLabel(state.plan.pool || "all");
  }

  function calendar(t) {
    // Last 5 weeks, Monday-first, ending with the current week.
    const today = new Date(t);
    const offset = (today.getDay() + 6) % 7;
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - offset - 28);
    let cells = "";
    for (let i = 0; i < 35; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const key = C.dayKey(d.getTime());
      const future = d.getTime() > t;
      const cls = state.checkins[key] ? "cal-day done" : state.daily[key] ? "cal-day active" : "cal-day";
      cells += '<span class="' + cls + (key === C.dayKey(t) ? " today" : "") + (future ? " future" : "") + '" title="' + key + '">' +
        (state.checkins[key] ? "✓" : d.getDate()) + "</span>";
    }
    return '<div class="calendar"><div class="cal-head">' + ["一", "二", "三", "四", "五", "六", "日"].map(function (x) { return "<span>" + x + "</span>"; }).join("") +
      '</div><div class="cal-grid">' + cells + "</div></div>";
  }

  function viewZhan(params) {
    if (!state.plan.pool || params.get("setup")) return viewZhanSetup();
    const t = now();
    C.startDay(index, state, t);
    save();
    if (params.get("go")) return startZhan();
    zhan = null;
    const total = state.today.ids.length;
    const left = C.remainingToday(state).length;
    const doneToday = !!state.checkins[C.dayKey(t)];
    const p = progressFor(C.resolvePool(index, state, state.plan.pool, t));
    render(
      '<section class="zhan-dash">' +
        '<div class="zhan-head"><div><p class="eyebrow dark">Daily Words</p><h1 class="page-title">每日斩词</h1>' +
          '<p class="muted">词书 ' + esc(planPoolLabel()) + " · 每天 " + state.plan.daily + ' 个新词 · <a href="#/zhan?setup=1">更换计划 Change plan</a></p></div></div>' +
        '<div class="today-box">' +
          '<div class="today-num"><b>' + (total - left) + "</b> / " + total + '<span>今日任务 Today</span></div>' +
          '<div class="progress"><span class="p-mastered" style="width:' + (total ? 100 * (total - left) / total : 0) + '%"></span></div>' +
          (doneToday
            ? '<p class="checked">' + ICON.check + ' 今日已打卡 Checked in today!</p><div class="actions"><button class="btn primary" id="zhan-more">加餐：再学 10 个 Learn 10 more</button><a class="btn" href="#/quiz?pool=mistakes">错词本测验 Quiz mistakes</a></div>'
            : total
              ? '<div class="actions"><a class="btn primary big" href="#/zhan?go=1">' + (left < total ? "继续斩词 Continue" : "开始斩词 Start") + " · 剩 " + left + "</a></div>"
              : '<p class="muted">这本词书已经全部学完或斩掉了！换一本吧。All words in this book are learned — choose another.</p>') +
        "</div>" +
        '<div class="stats">' +
          '<div class="stat"><b>' + C.checkinStreak(state, t) + '</b><span>连续打卡<br>Check-in streak</span></div>' +
          '<div class="stat"><b>' + Object.keys(state.slain).length + '</b><span>已斩<br>Slain</span></div>' +
          '<div class="stat"><b>' + Object.keys(state.mistakes).length + '</b><span>错词本<br>Mistakes</span></div>' +
          '<div class="stat"><b>' + p.mastered + "/" + p.total + '</b><span>本书掌握<br>Book mastered</span></div>' +
        "</div>" +
        '<h2 class="section-title">打卡日历 Check-in calendar</h2>' + calendar(t) +
        '<p class="muted small">玩法：看英文单词选中文意思。认识的词点「斩」，以后不再出现；答错的词进入错词本，本轮稍后会用「中→英」再考一次，直到答对。<br>' +
        "How it works: pick the Chinese meaning. Already know a word? Slay it (斩) and it never comes back. Miss one and it goes to your mistake notebook and returns later this session until you get it right.</p>" +
      "</section>",
      "zhan"
    );
    const more = document.getElementById("zhan-more");
    if (more) more.addEventListener("click", function () {
      const pool = C.resolvePool(index, state, state.plan.pool, now());
      const extra = C.studyQueue(pool, state, now(), 10).filter(function (w) {
        return !state.cards[w.id] && state.today.ids.indexOf(w.id) === -1;
      });
      if (!extra.length) { alert("这本词书没有新词了。No new words left in this book."); return; }
      extra.forEach(function (w) { state.today.ids.push(w.id); });
      save();
      go("#/zhan?go=1");
    });
  }

  function viewZhanSetup() {
    const t = now();
    const current = state.plan.pool || "all";
    const books = [{ spec: "all", icon: "ALL", name: "全部科目", sub: "All courses", color: "#1e1e1e" }].concat(subjects.map(function (s) {
      return { spec: "s:" + s.id, icon: s.icon, name: s.zh, sub: s.name, color: s.color };
    }));
    render(
      '<h1 class="page-title">选择词书 Choose your word book</h1>' +
      '<p class="muted">每天先复习到期的旧词，再学习新词。Each day: due reviews first, then new words.</p>' +
      '<form id="plan-form">' +
        '<div class="pool-grid">' + books.map(function (b) {
          const ws = C.resolvePool(index, state, b.spec, t);
          const fresh = ws.filter(function (w) { return !state.cards[w.id] && !state.slain[w.id]; }).length;
          return '<label class="pool pick" style="--c:' + (b.color || "var(--accent)") + '">' +
            '<input type="radio" name="book" value="' + b.spec + '"' + (b.spec === current ? " checked" : "") + ">" +
            courseBadge(b) + "<b>" + esc(b.name) + "</b><span>" + esc(b.sub) + " · " + fresh + " 新词</span></label>";
        }).join("") + "</div>" +
        '<h2 class="section-title">每天学几个新词？New words per day</h2>' +
        '<div class="chips">' + DAILY_OPTIONS.map(function (n) {
          return '<label class="chip radio"><input type="radio" name="daily" value="' + n + '"' + (n === state.plan.daily ? " checked" : "") + "> " + n + "</label>";
        }).join("") + "</div>" +
        '<div class="actions" style="margin-top:20px"><button class="btn primary">保存并开始 Save & start</button></div>' +
      "</form>",
      "zhan"
    );
    document.getElementById("plan-form").addEventListener("submit", function (e) {
      e.preventDefault();
      const f = new FormData(e.target);
      const pool = f.get("book") || "all";
      const daily = +f.get("daily") || 20;
      const changed = pool !== state.plan.pool || daily !== state.plan.daily;
      state.plan = { pool: pool, daily: daily };
      if (changed && !state.checkins[C.dayKey(now())]) state.today = { day: null, ids: [], done: [] };
      save();
      go("#/zhan");
    });
  }

  function startZhan() {
    zhan = { queue: C.remainingToday(state), retried: {}, q: null, answered: null, undo: null, hint: false, right: 0, wrong: 0, slain: 0 };
    nextZhan();
  }

  function nextZhan() {
    zhan.answered = null;
    zhan.hint = false;
    const id = zhan.queue[0];
    if (!id) return renderZhanDone();
    const w = index.byId[id];
    // First time: English -> 中文. A retry after a mistake flips it to 中文 -> English.
    zhan.q = C.question(w, index.bySubject[w.subject], index.words, zhan.retried[id] ? "zh2en" : "en2zh");
    renderZhan();
    if (prefs.autoSpeak && zhan.q.mode === "en2zh") speak(w.t);
  }

  function renderZhan() {
    const q = zhan.q;
    const w = q.word;
    const a = zhan.answered;
    const total = state.today.ids.length;
    const done = total - C.remainingToday(state).length;
    const undo = zhan.undo
      ? '<div class="toast"><span class="zhan-mark">斩</span> 已斩 <b>' + esc(index.byId[zhan.undo].t) + '</b> <button class="link-btn" id="zhan-undo">撤销 Undo</button></div>' : "";
    const prompt = q.mode === "en2zh"
      ? '<p class="card-term">' + esc(w.t) + ' <span class="pos">' + esc(w.p) + "</span></p>" + speakBtn(w.t)
      : '<p class="muted small">再考一次：选出英文 Try again — pick the English</p><p class="card-zh">' + esc(w.zh) + "</p>";
    const hint = q.mode === "en2zh"
      ? (zhan.hint || a ? '<p class="ex">“' + highlight(w.ex, w.t) + "”</p>" : '<button class="btn small ghost" id="zhan-hint">看例句提示 Show example (H)</button>')
      : "";
    const options = '<div class="options">' + q.options.map(function (o, i) {
      let cls = "option";
      if (a) {
        if (o.id === q.answer) cls += " correct";
        else if (o.id === a.choice) cls += " wrong";
      }
      return '<button class="' + cls + '" data-zchoice="' + esc(o.id) + '"' + (a ? " disabled" : "") + "><kbd>" + (i + 1) + "</kbd> " + esc(o.label) + "</button>";
    }).join("") + "</div>";
    const feedback = a
      ? '<div class="feedback ' + (a.correct ? "ok" : "bad") + '">' +
          (a.correct ? ICON.check + " 正确 Correct!" : ICON.cross + " 答错了，已加入错词本，稍后再考一次。Added to your mistakes — it will come back.") +
          '<div class="feedback-word">' + wordCard(w, { showZh: true }) + "</div>" +
          '<button class="btn primary wide" id="zhan-next">下一个 Next →</button></div>'
      : "";
    render(
      '<div class="study-top"><a class="back" href="#/zhan">' + ICON.back + '每日斩词</a>' +
        '<label class="toggle"><input type="checkbox" id="auto-speak"' + (prefs.autoSpeak ? " checked" : "") + "> 自动发音 Auto-speak</label>" +
        '<span class="muted">' + done + " / " + total + "</span></div>" +
      '<div class="progress thin"><span class="p-mastered" style="width:' + (total ? 100 * done / total : 0) + '%"></span></div>' +
      undo +
      '<section class="question zhan">' +
        '<div class="zhan-card">' +
          (a ? "" : '<button class="slay" id="zhan-slay" title="我认识，以后不再出现 I know this — never show again">斩 Slay<small>S</small></button>') +
          prompt + hint +
        "</div>" +
        options + feedback +
      "</section>",
      "zhan"
    );
    document.getElementById("auto-speak").addEventListener("change", function (e) {
      prefs.autoSpeak = e.target.checked;
      savePrefs();
    });
    const next = document.getElementById("zhan-next");
    if (next) next.focus();
  }

  function zhanChoose(choice) {
    if (!zhan || zhan.answered) return;
    const q = zhan.q;
    const id = q.word.id;
    const correct = choice === q.answer;
    const retry = !!zhan.retried[id];
    C.zhanAnswer(state, id, correct, retry, now());
    save();
    zhan.queue.shift();
    zhan.undo = null;
    if (correct) {
      zhan.right++;
    } else {
      zhan.wrong++;
      zhan.retried[id] = true;
      zhan.queue.splice(Math.min(4, zhan.queue.length), 0, id);
    }
    zhan.answered = { choice: choice, correct: correct };
    renderZhan();
    if (!correct && prefs.autoSpeak) speak(q.word.t);
  }

  function zhanSlay() {
    if (!zhan || zhan.answered || !zhan.q) return;
    const id = zhan.q.word.id;
    C.slay(state, id, now());
    save();
    zhan.queue = zhan.queue.filter(function (x) { return x !== id; });
    zhan.undo = id;
    zhan.slain++;
    nextZhan();
  }

  function zhanUndo() {
    const id = zhan && zhan.undo;
    if (!id) return;
    C.unslay(state, id);
    state.today.done = state.today.done.filter(function (x) { return x !== id; });
    if (C.remainingToday(state).length) delete state.checkins[C.dayKey(now())];
    save();
    zhan.undo = null;
    zhan.slain--;
    zhan.queue.unshift(id);
    nextZhan();
  }

  function renderZhanDone() {
    const t = now();
    const finished = !!state.checkins[C.dayKey(t)];
    render(
      '<section class="done">' +
        (zhan.undo ? '<div class="toast"><span class="zhan-mark">斩</span> 已斩 <b>' + esc(index.byId[zhan.undo].t) + '</b> <button class="link-btn" id="zhan-undo">撤销 Undo</button></div>' : "") +
        (finished ? "<h1>今日打卡成功！</h1><p>Checked in · 连续 <b>" + C.checkinStreak(state, t) + "</b> 天 day streak</p>"
          : "<h1>本轮完成 Round complete</h1>") +
        '<p class="muted">答对 ' + zhan.right + " · 答错 " + zhan.wrong + " · 斩 " + zhan.slain + "</p>" +
        calendar(t) +
        '<div class="actions center">' +
          '<a class="btn primary" href="#/zhan">返回 Back</a>' +
          (Object.keys(state.mistakes).length ? '<a class="btn" href="#/quiz?pool=mistakes">错词本测验 Quiz mistakes</a>' : "") +
        "</div>" +
      "</section>",
      "zhan"
    );
  }

  // ----- roots -----

  function viewRoots(params) {
    const focus = params.get("r");
    const roots = index.roots.filter(function (r) { return r.words.length; })
      .sort(function (a, b) { return b.words.length - a.words.length; });
    render(
      '<h1 class="page-title">词根词缀 Word Parts</h1>' +
      '<p class="muted">很多学术词汇来自希腊语和拉丁语。认识这些「零件」，遇到生词也能猜出大意。<br>Most academic words are built from Greek and Latin parts. Learn the parts and you can decode new words.</p>' +
      '<input class="filter-input" id="root-filter" type="search" placeholder="筛选 Filter… (e.g. therm, 热)">' +
      '<div class="root-grid">' + roots.map(function (r) {
        return '<article class="root-card' + (focus === r.part ? " focus" : "") + '" id="root-' + C.slug(r.part) + '" data-filter="' + esc((r.part + " " + r.m + " " + r.zh).toLowerCase()) + '">' +
          '<h3>' + esc(r.part) + ' <span class="muted">' + esc(r.m) + "</span></h3>" +
          '<p class="root-zh">' + esc(r.zh) + "</p>" +
          '<div class="chips">' + r.words.map(function (w) {
            return '<button class="chip" data-open="' + esc(w.id) + '" title="' + esc(w.zh) + '">' + esc(w.t) + "</button>";
          }).join("") + "</div></article>";
      }).join("") + "</div>",
      "roots"
    );
    const f = document.getElementById("root-filter");
    f.addEventListener("input", function () {
      const q = f.value.trim().toLowerCase();
      document.querySelectorAll(".root-card").forEach(function (el) {
        el.hidden = q && el.getAttribute("data-filter").indexOf(q) === -1 &&
          el.textContent.toLowerCase().indexOf(q) === -1;
      });
    });
    if (focus) {
      const el = document.getElementById("root-" + C.slug(focus));
      if (el) el.scrollIntoView({ block: "center" });
    }
  }

  // ----- notebook -----

  function viewNotebook() {
    const t = now();
    const starred = C.resolvePool(index, state, "starred", t);
    const mistakes = C.resolvePool(index, state, "mistakes", t).sort(function (a, b) {
      return state.mistakes[b.id] - state.mistakes[a.id];
    });
    const slain = C.resolvePool(index, state, "slain", t).sort(function (a, b) { return state.slain[b.id] - state.slain[a.id]; });
    const section = function (title, list, spec, emptyMsg) {
      return '<section class="nb-section"><div class="nb-head"><h2 class="section-title">' + title + ' <span class="muted">' + list.length + "</span></h2>" +
        (list.length ? '<div class="actions"><a class="btn small" href="#/study?pool=' + spec + '">闪卡 Study</a><a class="btn small" href="#/quiz?pool=' + spec + '">测验 Quiz</a></div>' : "") +
        "</div>" +
        (list.length ? '<div class="word-list">' + list.map(function (w) { return wordCard(w, { showSubject: true }); }).join("") + "</div>"
          : '<p class="empty">' + emptyMsg + "</p>") + "</section>";
    };
    render(
      '<h1 class="page-title">我的生词本 My Notebook</h1>' +
      section("收藏 Starred", starred, "starred", "点击单词旁的星标收藏难词。Tap the star next to any word to save it here.") +
      section("错题本 Mistakes", mistakes, "mistakes", "斩词、测验答错或闪卡选「再来」的词会出现在这里，答对后自动移除。Words you miss appear here and leave once you get them right.") +
      '<section class="nb-section"><h2 class="section-title">已斩 Slain <span class="muted">' + slain.length + "</span></h2>" +
        (slain.length ? '<p class="muted small">这些词不会再出现在复习中。点「恢复」可重新加入复习。These words are skipped in reviews — tap Restore to bring one back.</p><div class="chips">' +
          slain.map(function (w) {
            return '<span class="chip slain-chip"><button class="link-btn" data-open="' + esc(w.id) + '">' + esc(w.t) + '</button> <button class="link-btn" data-unslay="' + esc(w.id) + '" title="恢复 Restore">恢复</button></span>';
          }).join("") + "</div>"
          : '<p class="empty">在「每日斩词」里点「斩」掉已经认识的词。Slay words you already know in Daily Words.</p>') +
      "</section>" +
      '<section class="nb-section backup"><h2 class="section-title">备份进度 Backup</h2>' +
        '<p class="muted">进度只保存在当前浏览器。换设备前请先导出。Progress is stored only in this browser — export it before switching devices.</p>' +
        '<div class="actions"><button class="btn small" id="export">导出 Export</button>' +
        '<label class="btn small">导入 Import<input type="file" id="import" accept="application/json" hidden></label>' +
        '<button class="btn small danger" id="reset">清空进度 Reset</button></div>' +
      "</section>",
      "notebook"
    );
    document.getElementById("export").addEventListener("click", function () {
      const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "vocap-progress-" + C.dayKey(now()) + ".json";
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    });
    document.getElementById("import").addEventListener("change", function (e) {
      const file = e.target.files[0];
      if (!file) return;
      file.text().then(function (txt) {
        let parsed;
        try { parsed = JSON.parse(txt); } catch (err) { alert("文件格式不正确 Invalid file"); return; }
        state = C.normalizeState(parsed);
        save();
        alert("导入成功 Imported!");
        route();
      });
    });
    document.getElementById("reset").addEventListener("click", function () {
      if (!confirm("确定清空所有学习进度？此操作不可撤销。\nReset all progress? This cannot be undone.")) return;
      state = C.emptyState();
      save();
      route();
    });
  }

  function viewNotFound() {
    render('<p class="empty">页面不存在。Page not found.</p><p class="center"><a class="btn" href="#/">首页 Home</a></p>', "");
  }

  // ---------- word dialog ----------

  function openWord(id) {
    const w = index.byId[id];
    if (!w) return;
    const c = state.cards[id];
    dialogBody.innerHTML =
      '<button class="icon-btn close" data-close aria-label="Close">' + ICON.close + "</button>" +
      wordCard(w, { showSubject: true, showZh: true }) +
      (c ? '<p class="muted small">复习 ' + c.seen + " 次 · 记得 " + c.right + " · 忘记 " + c.wrong + " · 下次 " + new Date(c.due).toLocaleDateString() + "</p>" : "");
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
  }

  function closeWord() {
    if (typeof dialog.close === "function") dialog.close();
    else dialog.removeAttribute("open");
  }

  // ---------- events ----------

  document.addEventListener("click", function (e) {
    const t = e.target.closest("[data-speak],[data-star],[data-open],[data-close],[data-choice],[data-zchoice],[data-grade],[data-unslay],#flip,#next-q,#flashcard,#zhan-slay,#zhan-hint,#zhan-next,#zhan-undo,.zh.concealed");
    if (!t) {
      if (e.target === dialog) closeWord(); // backdrop click
      return;
    }
    if (t.hasAttribute("data-speak")) { e.stopPropagation(); speak(t.getAttribute("data-speak")); return; }
    if (t.hasAttribute("data-star")) {
      const id = t.getAttribute("data-star");
      if (state.starred[id]) delete state.starred[id]; else state.starred[id] = true;
      save();
      document.querySelectorAll('[data-star="' + CSS.escape(id) + '"]').forEach(function (b) {
        const on = !!state.starred[id];
        b.classList.toggle("on", on);
        b.innerHTML = on ? ICON.starFill : ICON.star;
        b.setAttribute("aria-pressed", on);
      });
      return;
    }
    if (t.hasAttribute("data-open")) { openWord(t.getAttribute("data-open")); return; }
    if (t.hasAttribute("data-close")) { closeWord(); return; }
    if (t.hasAttribute("data-choice")) { answer(t.getAttribute("data-choice")); return; }
    if (t.hasAttribute("data-grade")) { grade(t.getAttribute("data-grade")); return; }
    if (t.hasAttribute("data-zchoice")) { zhanChoose(t.getAttribute("data-zchoice")); return; }
    if (t.hasAttribute("data-unslay")) { C.unslay(state, t.getAttribute("data-unslay")); save(); route(); return; }
    if (t.id === "zhan-slay") { zhanSlay(); return; }
    if (t.id === "zhan-hint") { zhan.hint = true; renderZhan(); return; }
    if (t.id === "zhan-next") { nextZhan(); return; }
    if (t.id === "zhan-undo") { zhanUndo(); return; }
    if (t.id === "next-q") { nextQuestion(); return; }
    if (t.id === "flip" || t.id === "flashcard") { flip(); return; }
    if (t.classList.contains("concealed")) { t.classList.remove("concealed"); }
  });

  document.addEventListener("submit", function (e) {
    if (e.target.id === "spell-form") {
      e.preventDefault();
      answer(null, document.getElementById("spell-input").value);
    } else if (e.target.id === "search-form") {
      e.preventDefault();
      const q = document.getElementById("search-input").value.trim();
      if (q) location.hash = "#/search?q=" + encodeURIComponent(q);
    }
  });

  document.addEventListener("keydown", function (e) {
    if (dialog.open) return;
    const tag = (e.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea") return;
    const r = parseHash().parts[0];
    if (r === "study" && session && session.queue.length) {
      if (e.key === " " || e.key === "Enter") { e.preventDefault(); if (session.flipped) grade("good"); else flip(); }
      else if (session.flipped && e.key === "1") grade("again");
      else if (session.flipped && e.key === "2") grade("good");
      else if (session.flipped && e.key === "3") grade("easy");
    } else if (r === "zhan" && zhan && zhan.q && zhan.queue.length + (zhan.answered ? 1 : 0)) {
      if (zhan.answered && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); nextZhan(); }
      else if (!zhan.answered && /^[1-4]$/.test(e.key)) zhanChoose(zhan.q.options[+e.key - 1].id);
      else if (!zhan.answered && (e.key === "s" || e.key === "S")) zhanSlay();
      else if (!zhan.answered && (e.key === "h" || e.key === "H") && zhan.q.mode === "en2zh") { zhan.hint = true; renderZhan(); }
    } else if (r === "quiz" && quiz && quiz.qs[quiz.i]) {
      const q = quiz.qs[quiz.i];
      if (quiz.answered && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); nextQuestion(); }
      else if (!quiz.answered && q.options && /^[1-4]$/.test(e.key)) answer(q.options[+e.key - 1].id);
    }
  });

  // ---------- router ----------

  function route() {
    closeWord();
    const h = parseHash();
    const p = h.parts;
    session = p[0] === "study" ? session : null;
    if (p[0] !== "zhan") zhan = null;
    if (p[0] !== "search") document.getElementById("search-input").value = "";
    switch (p[0]) {
      case undefined: return viewHome();
      case "s": return viewSubject(p[1], h.params);
      case "search": return viewSearch(h.params);
      case "study": return viewStudy(h.params);
      case "quiz": return viewQuiz(h.params);
      case "zhan": return viewZhan(h.params);
      case "roots": return viewRoots(h.params);
      case "notebook": return viewNotebook();
      default: return viewNotFound();
    }
  }

  window.addEventListener("hashchange", route);
  route();
})();
