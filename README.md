# Arabic Scrabble Integrated Version

A two-player, local Arabic Scrabble game that runs entirely in the browser.

This project evolved from the original repository, [DAXEI08/update-version](https://github.com/DAXEI08/update-version), and merges its two Arabic tile-set variants into one shared game engine, with a selectable visual theme system on top.

> **One game engine, one ruleset, two tile sets, multiple visual themes.**

## Features

- Two-player local Arabic Scrabble on the classic 15×15 board
- **Expanded** and **Basic** tile modes (chosen when a game starts)
- Selectable visual themes, applied instantly and remembered on the device
- Per-player timer (the clock starts after the first move)
- Undo of the last move
- Tile swap
- **Unlimited pass**: there is no pass or skip limit
- **Automatic word validation**: every word of a move is checked against a built-in Arabic lexicon (with regular morphology and prefix/suffix handling) before the move is committed; invalid words are rejected on the spot
- Human **tahkim** (judging): the challenger rules the last move **✔ صحيح** or **✖ خطأ** (still available, and the fallback for words the lexicon cannot confirm)
- Move history with words, scores, bingos, passes, swaps and tahkim verdicts, with a show/hide toggle (إخفاء السجل / إظهار السجل) that never moves the racks, buttons or board
- Blank tiles (always worth 0)
- Responsive layout for desktop, tablet and mobile, portrait and landscape
- Adjustable interface dimensions (board, racks, buttons, history)

## Automatic word validation (فحص الكلمات)

When a player presses **تأكيد**, every word the move forms is validated *before* anything is committed. A rejected move changes nothing (board, racks, scores, clock): the toast says which word failed and why, and the player can fix or take back the tiles.

A word is accepted only with evidence, in this order: **lexicon** (listed form) → **morphology** (regular inflection of a trusted stem: verb conjugations, participles, dual, sound plurals, masdars…) → **clitics** (و ف ب ل ك س ال and pronoun suffixes such as ـه ـها ـهم). There is no loose "looks Arabic" guessing.

- **Expanded mode** compares the exact orthography: `أ ≠ ا`, `ة ≠ ه`, `ى ≠ ي`. **Basic mode** has no `أ إ آ ؤ ئ ة ى` tiles, so a word is compared by what the 28 tiles can spell (`مدينه`, `اكل`, `علي`); words that need a stand-alone `ء` cannot be played in Basic mode.
- **الإعدادات → فحص الكلمات** (stored on the device, `scrabble.wordcheck`):
  - **تلقائي** (default): unknown words are rejected.
  - **تلقائي + تحكيم**: unknown words are accepted provisionally, shown with **؟**, and can be challenged with Tahkim.
  - **إيقاف**: no automatic check, Tahkim only (the original behaviour).
- If the dictionary cannot be loaded (offline, blocked file) the game silently falls back to Tahkim-only play and retries on the next move.
- **Coverage:** a hand-written lexicon (~1,600 nouns/adjectives, ~720 verbs, ~240 function words, with full passive voice and every supported verb form) **plus a 5.6-million-word bank** compiled into a compact automaton and **3,230 verb / 68,186 noun stems mined from it** and completed by the grammar. Words that only the weak part of the bank (or the bank alone, at ≤4 letters) vouches for are *provisional*: accepted with ؟ and open to Tahkim. About 2.9 MB (gzipped) is downloaded in the background after the page opens; until it arrives, unknown words are provisional rather than rejected. See [`docs/validator-audit.md`](docs/validator-audit.md) for the measurements and [`docs/word-validation.md`](docs/word-validation.md) for the architecture, data formats and how to rebuild or extend it.

## Online game (two devices, any network)

The cover offers **LOCAL GAME** (unchanged, fully offline) and **ONLINE GAME**: one player creates a room and gets a 6-character code (e.g. `K7Q4P2`, or a `?room=K7Q4P2` link), the other joins with it, the host sets the rules (tile mode, clock, word-check mode) and starts. The match is **server-authoritative** (Supabase: Postgres + RLS + Realtime + one Edge Function): the server holds the bag and both racks, validates every move with the same rules/validator as local play, scores it, runs the clock and decides the winner. Each browser only ever receives its own rack. Refreshing or reconnecting restores the match.

- Setup from zero: [`docs/ONLINE_MULTIPLAYER_SETUP.md`](docs/ONLINE_MULTIPLAYER_SETUP.md) · design: [`docs/ONLINE_ARCHITECTURE.md`](docs/ONLINE_ARCHITECTURE.md) · what was built and verified: [`docs/ONLINE_IMPLEMENTATION_REPORT.md`](docs/ONLINE_IMPLEMENTATION_REPORT.md)
- Online differs from local only where hot-seat assumptions cannot be secure: no **Undo** (Tahkim takes a move back), the clock is the server's, the opponent's rack is hidden, **New game** becomes **Resign / Rematch**.
- Words the dictionary could not check (not loaded yet, or failed to load) are now always marked **؟ / "تعذّر التحقق"** and stay open to Tahkim, in local play as well. They are never presented as verified.
- Shared code: `js/rules.js` (legality + scoring), `js/wordpolicy.js` (what a validator result means), `js/validator.js` run in the browser and in the Edge Function (`supabase/functions/_shared/game/` is a generated mirror: `node tools/sync-edge-shared.mjs`).
- **TODO: Confirm external Arabic word-bank provenance and redistribution license before public/commercial distribution.** (`js/dictionary/data/bank*.bin.gz`; see `docs/validator-audit.md`.) The online server serves/loads the same files.

## Modes

Both modes use the same engine, gameplay, board, scoring, timer, tahkim, UI, and features. **The only difference is the tile distribution and the blank-tile alphabet.**

| Mode | Arabic label | Tiles | Blank tile can become |
|---|---|---|---|
| Expanded | الحروف الموسعة | the 28 basic letters plus `أ إ آ ء ؤ ئ ة ى` (101 tiles incl. 2 blanks) | any of those 36 letters |
| Basic | الحروف الأساسية | the 28 basic letters only (84 tiles incl. 2 blanks) | only the 28 basic letters |

- The mode is picked at game setup: **PLAY → tile mode → duration → confirmation → game**. It cannot change while a game is running; **New game** goes back through mode selection.
- Tiles are never normalised (`أ` stays `أ`, `ة` stays `ة`, …). The letter `ه` is stored as plain `ه`; the `هـ` face on the tile is display-only (`FACE` in `config.js`).
- Both tile sets, their values and counts, and the blank alphabets live in `js/modes.js` as plain data. The engine just reads `TILE_MODES[app.mode]`.

## Themes

Themes only change presentation. They never affect the mode, tile distribution, scoring, timer, tahkim, board coordinates, placement, game state, history or dimensions. Choose one in **الإعدادات → المظهر**; it applies immediately without reloading and never resets the game.

| Theme | Arabic | Character |
|---|---|---|
| Classic | كلاسيكي | wood tones, cream tiles, dark green lettering (default) |
| Dark | داكن | charcoal panels, high-contrast light tiles, amber accents |
| Emerald | زمردي | emerald green, cream and gold |
| Desert | صحراوي | a light theme: sand, terracotta, warm brown, ivory, muted gold |

The selected theme is stored in `localStorage` under `scrabble.theme`. If the value is missing, unreadable, or not a known theme id, the game falls back to Classic. Interface dimensions are stored separately under `scrabble.dims`, so resetting one never affects the other.

### How themes work

`js/themes.js` only sets `<html data-theme="id">`. All colours are CSS custom properties defined once per theme in `css/themes.css`; there is no per-element styling from JavaScript and no duplicated stylesheet. To add a theme, add a block in `themes.css` that defines every token, and an entry in `THEMES` in `themes.js`.

## History toggle

The history panel has a small button in its corner: **إخفاء السجل** (hide) / **إظهار السجل** (show).

- **Strict layout stability.** The panel keeps its exact size, grid area and border width. Hiding only makes its surface and contents invisible (the `history-hidden` class); the element is never removed or `display:none`, and no grid rule changes. The racks, player panels, buttons and board stay exactly where they are in portrait and landscape.
- **The history keeps recording** while hidden, and shows the latest entries immediately when revealed.
- The button is a native `<button>` (Enter / Space) with `aria-expanded`; it stays visible and clickable while the content is hidden.
- The choice is a device preference stored in `localStorage` under `scrabble.historyVisible` (default: visible; a missing, invalid or unreadable value means visible). It is separate from `scrabble.theme` and `scrabble.dims`.
- Known limit: with the history text set to its maximum (160%) in a very narrow history column in tight landscape layouts, the title can wrap under the button.

## Layout (الإعدادات → التخطيط)

Device preferences stored in `localStorage` under `scrabble.layout`; they only set `data-layout`, `data-swap` and `data-hist` on `<html>` (`js/layout.js`).

- **التخطيط**: *كلاسيكي* (original) or *مواجهة* (player panels on either side of the board, buttons underneath). Short landscape phones always use the classic arrangement.
- **موضع اللاعب الأول**: left or right (duel only).
- **ارتفاع لوحات اللاعبين**: top / middle / bottom (default) position of the two panels beside the board (duel only). In duel on landscape screens (≥700×560) the board is sized from the real vertical overhead, so everything fits the viewport without scrolling.
- **أزرار التحكم**: icons only (default; labels remain for screen readers and as tooltips, تأكيد/احتساب keeps its text), icon over label, or the original text. Icons are inline SVG using `currentColor`, mirrored where direction matters (RTL). Icon-only mode needs one button row instead of two, which the duel board-size budget accounts for.
- **Floating windows** (`js/float.js`): the settings panel (non-modal, game frozen behind it) and the word-log drawer are draggable windows with identical behaviour: drag the title, or focus it and use the arrow keys (Shift = larger step); double-click the title or use *إعادة مواضع النوافذ العائمة* to reset. Positions are clamped to the viewport and remembered per device. Esc closes either window.
- **سجل الكلمات**: *عند الطلب* (default) keeps the log out of the layout and opens it from a button as a drawer (close with the button or Esc); *مثبّت* keeps the original always-visible panel with its hide/show toggle.

Note: `tests/layout/history-toggle*.mjs` assume the docked log, so set `scrabble.layout` to `{"hist":"docked"}` before they run.

## Technology

HTML, CSS, vanilla JavaScript (ES Modules). No framework, no build step, no dependencies, no audio subsystem. Fonts (Amiri for Arabic, Tinos for Latin and digits) are bundled locally.

## Running

ES modules need to be served over HTTP (opening `index.html` from `file://` is blocked by browsers). From the project folder:

```sh
python3 -m http.server 8000
```

then open <http://localhost:8000>. Any static host (GitHub Pages, Netlify, …) works as-is.

## Folder structure

```
index.html
README.md

css/
  style.css       layout and components (colours come from theme tokens)
  cover.css       cover screen
  themes.css      theme palettes (CSS custom properties)

js/
  config.js       global constants: board size, durations, premium layout, glyph/label maps, dimension limits
  modes.js        Expanded and Basic tile data, blank alphabets, mode metadata
  themes.js       theme metadata, load/save/apply, theme selector
  histview.js     history show/hide toggle and its saved preference
  state.js        game state, tile bag, snapshots (undo / tahkim)
  game.js         turns, placement, submit, undo, swap, pass, game over
  scoring.js      word finding and scoring
  judge.js        tahkim
  validator.js    automatic word validation: validateWord / validateWords, dictionary loading
  wordcheck.js    validation policy (تلقائي / تحكيم / إيقاف), its settings row, messages shown to players
  dictionary/
    normalize.js    harakat/tatweel removal, strict / lookup / Basic spellings, orthography rules
    morphology.js   rule-based generation of forms from lexicon lines (nouns, all verb forms, participles)
    clitics.js      prefix / article / pronoun-suffix grammar (data-driven)
    lexicon.js      parses the data files and builds the lookup index
    dawg.js         query side of the packed word automaton (exact lookup, Basic-letter lookup)
    mined.js        runtime of the mined stems (same clitic grammar, no per-entry memory)
    data/           rules.json, affixes.json, core.json (function words), nouns-*.txt, verbs*.txt, extra.txt,
                    bank.bin.gz / bank-weak.bin.gz (word bank), mined-*.txt + mined.bin.gz (mined stems)
  ui.js           rendering and dialogs (including mode and duration selection, blank picker)
  input.js        click/tap, keyboard, drag and drop, buttons, dialog flow
  dims.js         interface dimension settings
  cover.js        cover screen (title in game tiles)
  main.js         start-up

docs/
  word-validation.md   how the validator works and how to extend the lexicon

tools/            dev-only: validate-dictionary.mjs (lint), import-wordlist.mjs (add words), build-bank.mjs / mine-bank.mjs / build-mined.mjs (word bank pipeline)

tests/            dev-only tests (not needed to play; see "Tests")
  package.json
  run-all.mjs     runs every suite below
  contrast.py     WCAG contrast and distinctness audit of css/themes.css
  logic/
    harness.mjs   loads the real modules in jsdom
    engine.mjs    modes, scoring, blanks, undo, tahkim, pass, themes, dimensions
    validator.mjs        the validator on its own: normalisation, evidence sources, reasons, modes, strictness, policy
    grammar.mjs          the grammar engine alone (rules only): passive voice, taṣrīf, hamza orthography, defective nouns, Form IX
    bank.mjs             the word bank, mined stems, automaton, false-acceptance ceilings, performance
    validation-flow.mjs  validation inside the game: rejected moves change nothing, the three policies, settings row
    validation-fallback.mjs  dictionary unavailable: Tahkim-only fallback and recovery
    startup.mjs   real main.js start-up, cover, setup flow, Settings
  layout/
    lib.mjs       real-browser helpers (viewports, geometry, pixel checks)
    serve.mjs     tiny static server used by the tests
    baseline.mjs  regenerates baseline.json
    baseline.json layout measured before the history toggle existed
    history-toggle.mjs        bounding boxes before/after hide and show in 8 viewports
    history-toggle-extra.mjs  keyboard, persistence, extreme dimensions, all themes

assets/
  fonts/
    Amiri-Regular.woff2
    Amiri-Bold.woff2
    Tinos-Regular.woff2
    Tinos-Bold.woff2
```

## Tests

Dev-only; the game itself has no dependencies. From the `tests/` folder:

```sh
npm install
npm test          # all suites; or: node run-all.mjs "extra.mjs b" to run one
```

- `logic/*` run the real modules against jsdom. `tools/validate-dictionary.mjs` lints the lexicon data as part of `npm test`.
- `layout/*` drive a real Chromium (the Linux build bundled with `@sparticuz/chromium`; set `CHROME_PATH` to use your own Chrome) and compare the bounding boxes of the racks, buttons, panels, board and history before and after toggling, in portrait and landscape phone, tablet and desktop viewports. Hidden state is also checked pixel-wise, with a positive control showing that visible history would be detected.
- `layout/baseline.json` is the layout of the app before the toggle existed. If you change the layout on purpose, regenerate it from the previous version (see the comment in `baseline.mjs`).

## Credits

By esbepe. Evolved from [DAXEI08/update-version](https://github.com/DAXEI08/update-version).
