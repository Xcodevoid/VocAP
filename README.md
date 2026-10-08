# VocAP · AP 学术词汇桥

**You already understand the knowledge. VocAP helps you say it in AP English.**

Many students who move from Chinese public schools into international departments already know the
science, math, and history — they learned it in 中文. What holds them back is the English vocabulary:
they know 有丝分裂 but not *mitosis*, and they lose points on an FRQ because they don't know what
*justify*, *negligible*, or *respectively* is asking for.

VocAP is a free, bilingual vocabulary site that bridges what students already know in Chinese to the
words they need for AP exams across every subject.

## Features

| | |
|---|---|
| **中 → EN bridge** | Search in Chinese or English (`导数`, `mitosis`). Every word has the Chinese term, a plain-English definition, an AP-style example sentence, and often a 💡 tip connecting it to the Chinese curriculum or warning about a trap (e.g. *concave up* vs 中国教材的「凹/凸」, *reduction* = 还原, not 减少). |
| **AP Exam Command Words** | identify / describe / explain / justify, *in terms of*, *respectively*, *negligible*, *the extent to which*… — the words that tell you what the question wants. |
| **14 subjects, ~380 words** | Biology, Chemistry, Physics, Calculus, Statistics, Psychology, U.S. History, World History, U.S. Government, Economics, Human Geography, Environmental Science, Computer Science, English Lang & Lit. |
| **Word parts 词根** | Greek/Latin roots, prefixes and suffixes (photo-, therm, -ism…) are matched automatically to every word, so students learn to decode words they have never seen. |
| **Flashcards with spaced repetition** | Leitner-box scheduling (1, 2, 4, 8, 16, 32 days). English-first or Chinese-first. Keyboard: Space to flip, 1/2/3 to grade. |
| **Quizzes** | 英→中, 中→英, definition → word, fill-in-the-blank from the example sentence, and spelling. Wrong answers go into the 错题本 (mistake notebook) and leave it after you get them right. |
| **Hide-Chinese self-test** | Blur the Chinese on any word list and tap to reveal. |
| **Pronunciation** | 🔊 uses the browser's built-in English speech. |
| **Private by default** | No account, no server. Progress lives in the browser (`localStorage`) and can be exported/imported as JSON from the Notebook page. |

## Running it

It is a static site with no build step and no external dependencies (no CDNs, no web fonts —
so it loads quickly from inside mainland China).

- Open `index.html` directly in a browser, **or**
- serve the folder: `npm start` (runs `python3 -m http.server 8000`) and visit <http://localhost:8000>.

### Deploy for free

Any static host works: GitHub Pages (Settings → Pages → deploy from branch, root folder), Gitee Pages,
Netlify, Vercel, or Cloudflare Pages. For the most reliable access from mainland China, consider a
domestic static host or a CDN mirror.

## Project layout

```
index.html          page shell; lists the data files to load
css/style.css       styles (light + dark mode, mobile-friendly)
js/core.js          pure logic: search, roots matching, spaced repetition, quiz generation
js/app.js           UI: hash router and views
data/*.js           word bank, one file per subject group
data/roots.js       Greek/Latin word parts
tests/core.test.js  data validation + logic tests
```

## Adding words or subjects

Each data file pushes subjects into `window.VOCAP_SUBJECTS`:

```js
(window.VOCAP_SUBJECTS = window.VOCAP_SUBJECTS || []).push({
  id: "bio", name: "AP Biology", zh: "AP 生物", icon: "🧬", color: "#2e9e5b",
  units: { cell: "Cells 细胞" },
  words: [
    { t: "osmosis",            // English term
      p: "n.",                 // part of speech
      zh: "渗透作用",            // Chinese meaning(s), separated by ；
      u: "cell",               // unit key from `units`
      d: "The diffusion of water across a selectively permeable membrane.",  // simple English definition
      ex: "A plant cell placed in salt water loses water by osmosis.",       // AP-style example (should contain the term)
      tip: "可选：中文提示、易混点、与国内课本的对应" }                         // optional
  ]
});
```

New files must also be added as a `<script>` in `index.html`. Then run the tests:

```
npm test
```

The tests check that every data file is loaded, every word has the required fields and a valid unit,
ids are unique, and every word part matches at least one word. If a root matches a word by spelling
but not by meaning (e.g. *tangent* is not from *gen*), add the term to that root's `not` list.

## Ideas for next steps

- More words per subject (aim for the full CED key-term lists) and AP Art History / Music Theory / Spanish.
- Teacher-made word lists that can be shared by link.
- Audio recordings for terms where browser speech is weak.
- Sync progress across devices (would need a small backend and accounts).
