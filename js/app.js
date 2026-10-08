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
  const prefs = Object.assign({ hideZh: false, reverse: false }, readJSON(PREFS_KEY) || {});

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

  function speakBtn(term) {
    if (!canSpeak) return "";
    return '<button class="icon-btn" data-speak="' + esc(term) + '" title="朗读 Pronounce" aria-label="Pronounce ' + esc(term) + '">🔊</button>';
  }

  function starBtn(id) {
    const on = !!state.starred[id];
    return '<button class="icon-btn star' + (on ? " on" : "") + '" data-star="' + esc(id) + '" title="加入生词本 Star" aria-pressed="' + on + '" aria-label="Star">' + (on ? "★" : "☆") + "</button>";
  }

  function statusBadge(id) {
    const st = C.status(state, id);
    const label = { new: "新词 New", learning: "学习中 Learning", mastered: "已掌握 Mastered" }[st];
    return '<span class="badge badge-' + st + '">' + label + "</span>";
  }

  function subjectTag(w) {
    const s = subjectById[w.subject];
    return '<a class="subject-tag" href="#/s/' + s.id + '" style="--c:' + s.color + '">' + esc(s.icon) + " " + esc(s.name) + "</a>";
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
        statusBadge(w.id) + starBtn(w.id) +
      "</div>" +
      '<p class="zh' + (hide ? " concealed" : "") + '"' + (hide ? ' tabindex="0" role="button" title="点击显示中文"' : "") + ">" + esc(w.zh) + "</p>" +
      '<p class="def">' + esc(w.d) + "</p>" +
      '<p class="ex">“' + highlight(w.ex, w.t) + "”</p>" +
      (w.tip ? '<p class="tip">💡 ' + esc(w.tip) + "</p>" : "") +
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
    const m = /^s:([^:]+)(?::(.+))?$/.exec(spec || "");
    if (m && subjectById[m[1]]) {
      const s = subjectById[m[1]];
      return s.icon + " " + s.name + (m[2] && s.units[m[2]] ? " · " + s.units[m[2]] : "");
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
    const streak = C.currentStreak(state, t);
    const featured = subjects.filter(function (s) { return s.featured; });

    const subjectCards = subjects.filter(function (s) { return !s.featured; }).map(function (s) {
      const p = progressFor(index.bySubject[s.id]);
      return '<a class="subject-card" href="#/s/' + s.id + '" style="--c:' + s.color + '">' +
        '<span class="subject-icon">' + esc(s.icon) + "</span>" +
        '<span class="subject-name">' + esc(s.name) + "</span>" +
        '<span class="subject-zh">' + esc(s.zh) + "</span>" +
        progressBar(p) +
        '<span class="subject-count">' + p.mastered + " / " + p.total + " 已掌握</span>" +
      "</a>";
    }).join("");

    const featuredHtml = featured.map(function (s) {
      const p = progressFor(index.bySubject[s.id]);
      return '<a class="featured" href="#/s/' + s.id + '" style="--c:' + s.color + '">' +
        '<span class="subject-icon">' + esc(s.icon) + "</span>" +
        '<span><b>先从这里开始 Start here：' + esc(s.zh) + "</b><br>" +
        '<span class="muted">identify, explain, justify, negligible, respectively… 看懂题目要求，是拿分的第一步。' +
        " (" + p.mastered + "/" + p.total + ")</span></span></a>";
    }).join("");

    render(
      '<section class="hero">' +
        '<h1>你已经懂了知识，<br>现在把它<span class="accent">翻译成 AP 的语言</span>。</h1>' +
        '<p class="lead">You already understand the science and math. VocAP bridges the words you know in 中文 to the English you need on the AP exam — across every subject.</p>' +
        '<div class="stats">' +
          '<div class="stat"><b>' + due + '</b><span>今日待复习<br>Due today</span></div>' +
          '<div class="stat"><b>' + all.mastered + '</b><span>已掌握<br>Mastered</span></div>' +
          '<div class="stat"><b>' + all.learning + '</b><span>学习中<br>Learning</span></div>' +
          '<div class="stat"><b>' + streak + '🔥</b><span>连续天数<br>Day streak</span></div>' +
        "</div>" +
        '<div class="actions">' +
          (due ? '<a class="btn primary" href="#/study?pool=due">复习 ' + due + ' 个到期单词 Review due</a>' : '<a class="btn primary" href="#/study">开始学习 Start studying</a>') +
          '<a class="btn" href="#/quiz">小测一下 Take a quiz</a>' +
        "</div>" +
      "</section>" +
      featuredHtml +
      '<h2 class="section-title">选择科目 Choose a subject <span class="muted">· ' + index.words.length + " words</span></h2>" +
      '<div class="subject-grid">' + subjectCards + "</div>" +
      '<section class="how">' +
        '<h2 class="section-title">怎么学 How it works</h2>' +
        '<div class="how-grid">' +
          '<div><b>① 搭桥 Bridge</b><p>用中文搜索你熟悉的概念（如「导数」「有丝分裂」），立刻找到 AP 用的英文术语和例句。</p></div>' +
          '<div><b>② 拆解 Decode</b><p>学习希腊/拉丁词根：photo-（光）+ synthesis（合成）。遇到生词也能猜出意思。</p></div>' +
          '<div><b>③ 记牢 Remember</b><p>间隔重复闪卡会在你快忘的时候提醒你复习；测验错题自动进入错题本。</p></div>' +
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
        '<span class="subject-icon big">' + esc(s.icon) + "</span>" +
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
      ["due", "⏰", "今日复习", "Due today"],
      ["all", "🎲", "全部混合", "All subjects"],
      ["starred", "★", "生词本", "Starred"],
      ["mistakes", "✗", "错题本", "Mistakes"]
    ].map(function (x) {
      const n = C.resolvePool(index, state, x[0], t).length;
      return '<a class="pool' + (n ? "" : " disabled") + '" href="#/' + route + "?pool=" + x[0] + '"' + (n ? "" : ' aria-disabled="true"') + ">" +
        '<span class="pool-icon">' + x[1] + "</span><b>" + x[2] + "</b><span>" + x[3] + " · " + n + "</span></a>";
    }).join("");
    const subj = subjects.map(function (s) {
      const ws = index.bySubject[s.id];
      const dueN = ws.filter(function (w) { return C.isDue(state, w.id, t); }).length;
      return '<a class="pool" href="#/' + route + "?pool=s:" + s.id + '" style="--c:' + s.color + '">' +
        '<span class="pool-icon">' + esc(s.icon) + "</span><b>" + esc(s.name) + "</b><span>" + esc(s.zh) + " · " + ws.length + (dueN ? " · " + dueN + " due" : "") + "</span></a>";
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
          "<h1>🎉 完成！Session complete</h1>" +
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
      (w.tip ? '<p class="tip">💡 ' + esc(w.tip) + "</p>" : "") +
      rootChips(w);
    const pct = s.total ? Math.round(100 * s.done / (s.done + s.queue.length)) : 0;

    render(
      '<div class="study-top">' +
        '<a class="muted" href="#/study">← ' + esc(poolLabel(s.spec)) + "</a>" +
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
    mixed: ["🎲 混合", "Mixed"],
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
        '<a class="muted" href="#/quiz">← 选择词组 Choose words</a>' +
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
          (a.correct ? "✓ 正确 Correct!" : "✗ 正确答案 Answer: <b>" + esc(q.word.t) + "</b> — " + esc(q.word.zh)) +
          '<div class="feedback-word">' + wordCard(q.word, { showZh: true }) + "</div>" +
          '<button class="btn primary wide" id="next-q">' + (quiz.i + 1 < quiz.qs.length ? "下一题 Next →" : "查看结果 See results") + "</button>" +
        "</div>"
      : "";
    render(
      '<div class="study-top"><a class="muted" href="#/quiz?pool=' + encodeURIComponent(quiz.spec) + '">← ' + esc(poolLabel(quiz.spec)) + "</a>" +
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
    const section = function (title, list, spec, emptyMsg) {
      return '<section class="nb-section"><div class="nb-head"><h2 class="section-title">' + title + ' <span class="muted">' + list.length + "</span></h2>" +
        (list.length ? '<div class="actions"><a class="btn small" href="#/study?pool=' + spec + '">闪卡 Study</a><a class="btn small" href="#/quiz?pool=' + spec + '">测验 Quiz</a></div>' : "") +
        "</div>" +
        (list.length ? '<div class="word-list">' + list.map(function (w) { return wordCard(w, { showSubject: true }); }).join("") + "</div>"
          : '<p class="empty">' + emptyMsg + "</p>") + "</section>";
    };
    render(
      '<h1 class="page-title">我的生词本 My Notebook</h1>' +
      section("★ 收藏 Starred", starred, "starred", "点击单词旁的 ☆ 收藏难词。Tap ☆ next to any word to save it here.") +
      section("✗ 错题本 Mistakes", mistakes, "mistakes", "测验中答错的词会出现在这里，答对后自动移除。Words you miss in quizzes appear here.") +
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
      '<button class="icon-btn close" data-close aria-label="Close">✕</button>' +
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
    const t = e.target.closest("[data-speak],[data-star],[data-open],[data-close],[data-choice],[data-grade],#flip,#next-q,#flashcard,.zh.concealed");
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
        b.textContent = on ? "★" : "☆";
        b.setAttribute("aria-pressed", on);
      });
      return;
    }
    if (t.hasAttribute("data-open")) { openWord(t.getAttribute("data-open")); return; }
    if (t.hasAttribute("data-close")) { closeWord(); return; }
    if (t.hasAttribute("data-choice")) { answer(t.getAttribute("data-choice")); return; }
    if (t.hasAttribute("data-grade")) { grade(t.getAttribute("data-grade")); return; }
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
    if (p[0] !== "search") document.getElementById("search-input").value = "";
    switch (p[0]) {
      case undefined: return viewHome();
      case "s": return viewSubject(p[1], h.params);
      case "search": return viewSearch(h.params);
      case "study": return viewStudy(h.params);
      case "quiz": return viewQuiz(h.params);
      case "roots": return viewRoots(h.params);
      case "notebook": return viewNotebook();
      default: return viewNotFound();
    }
  }

  window.addEventListener("hashchange", route);
  route();
})();
