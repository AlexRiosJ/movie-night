import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import worker from "./proxy/worker.mjs";
import { D1Database } from "./proxy/d1-fixture.mjs";

const source = readFileSync(new URL("./parties.js", import.meta.url), "utf8")
  + "\n" + readFileSync(new URL("./app.js", import.meta.url), "utf8");
const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
const themeNames = ["movie", "arcade", "zine"];
const colorModes = ["light", "dark"];
const movie = (id = 42, overrides = {}) => ({
  id: `tmdb-${id}`, tmdbId: id, title: `Movie ${id}`, genre: "sci-fi",
  year: 2024, minutes: 123, description: "A movie synopsis.", posterPath: "/poster.jpg",
  cast: ["Actor One", "Actor Two"], directors: ["Director"], genres: ["Science Fiction"],
  castProfiles: [{ name: "Actor One", profilePath: "/actor-one.jpg" }, { name: "Actor Two", profilePath: null }],
  originalTitle: `Original ${id}`, rating: 8.4, voteCount: 1250, ...overrides,
});
const page = (results, number = 1, totalPages = 1) => ({
  page: number, totalPages, totalResults: results.length * totalPages, results,
});
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "Content-Type": "application/json" },
});
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

// Minimal DOM boundary: application rendering runs unchanged, without installing a browser library.
class Element {
  constructor() {
    this.children = [];
    this.nodes = new Map();
    this.dataset = {};
    this.listeners = {};
    this.attributes = {};
    this.value = "";
    this.textContent = "";
    this.hidden = false;
    this.disabled = false;
    this.open = false;
  }
  querySelector(selector) {
    if (!this.nodes.has(selector)) this.nodes.set(selector, new Element());
    return this.nodes.get(selector);
  }
  querySelectorAll() { return []; }
  matches(selector) { return selector === 'input[name="theme"]' && this.name === "theme"; }
  addEventListener(name, callback) { this.listeners[name] = callback; }
  setAttribute(name, value) { this.attributes[name] = value; }
  removeAttribute(name) { delete this[name]; }
  append(...children) { this.children.push(...children); }
  replaceChildren(fragment) { this.children = fragment.children; }
  cloneNode() { return new Element(); }
  closest() { return null; }
  contains() { return false; }
  focus() { if (this.ownerDocument) this.ownerDocument.activeElement = this; }
  showModal() { this.open = true; }
  close() { this.open = false; this.listeners.close?.(); }
  getBoundingClientRect() { return { left: 10, top: 10, right: 490, bottom: 590 }; }
  scrollIntoView() {}
  select() {}
  reportValidity() { return true; }
  setCustomValidity() {}
  reset() {}
}

function app({
  raw = null, partyRaw = null, config = "", href = "https://alexriosj.github.io/movie-night/",
  fetch = async () => { throw new Error("Unexpected request"); },
} = {}) {
  const nodes = new Map([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => [match[1], new Element()]));
  for (const id of ["movie-row-template", "plan-row-template", "catalog-row-template", "cast-member-template"]) {
    nodes.get(id).content = { firstElementChild: new Element() };
  }
  const document = new Element();
  document.documentElement = new Element();
  document.activeElement = new Element();
  const themes = [...html.matchAll(/<input type="radio" name="theme" value="([^"]+)"/g)].map((match) => {
    const input = new Element();
    input.name = "theme";
    input.value = match[1];
    return input;
  });
  document.querySelectorAll = (selector) => selector === 'input[name="theme"]' ? themes : [];
  nodes.forEach((node) => { node.ownerDocument = document; });
  document.getElementById = (id) => {
    assert.ok(nodes.has(id), `Element #${id} must exist in index.html`);
    return nodes.get(id);
  };
  document.createDocumentFragment = () => new Element();
  document.createElement = () => new Element();
  const storage = new Map(raw === null ? [] : [["movie-night:v1", raw]]);
  if (partyRaw !== null) storage.set("movie-night:parties:v1", partyRaw);
  const window = new Element();
  window.MOVIE_NIGHT_CONFIG = { apiBaseUrl: config };
  window.location = new URL(href);
  window.history = { replaceState: (_state, _title, url) => { window.location = new URL(url, window.location); } };
  window.confirm = () => true;
  const errors = [];
  const timers = new Map();
  let timerId = 0;
  const context = vm.createContext({
    document, window, localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    },
    URL, Response, TypeError, SyntaxError, AbortController, AbortSignal, navigator: {},
    fetch, crypto,
    setTimeout: (callback, delay) => { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
    clearTimeout: (id) => timers.delete(id),
    getComputedStyle: () => ({ getPropertyValue: () => "#fff" }),
    console: { error: (...args) => errors.push(args) },
  });
  vm.runInContext(source, context);
  return {
    nodes, storage, context, errors, window, document, themes, timers,
    run: (code) => vm.runInContext(code, context),
    set(name, value) { context[name] = value; },
  };
}

test("fresh users get no fixed movie list and a clear setup state", () => {
  const ui = app();
  assert.equal(ui.run("state.movies.length"), 0);
  assert.equal(ui.run("movieSource()"), "collection");
  assert.equal(ui.nodes.get("api-setup-notice").hidden, false);
  assert.equal(ui.nodes.get("catalog-search").disabled, true);
  assert.equal(ui.nodes.get("random-movie").disabled, true);
  assert.equal(ui.nodes.get("movie-score").hidden, true);
  assert.equal(ui.nodes.get("movie-cast").hidden, true);
});

test("the interface defaults to Movie in light mode and separates style from color mode", () => {
  const ui = app();
  assert.equal(ui.run("state.theme"), "movie");
  assert.equal(ui.run("state.colorMode"), "light");
  assert.equal(ui.document.documentElement.dataset.theme, "movie");
  assert.equal(ui.document.documentElement.dataset.colorMode, "light");
  assert.equal(ui.nodes.get("theme-label").textContent, "Movie");
  assert.equal(ui.nodes.get("color-mode-label").textContent, "Claro");
  assert.equal(ui.nodes.get("color-mode-toggle").attributes["aria-pressed"], "false");
  assert.deepEqual(ui.themes.map((input) => input.value), themeNames);
  assert.deepEqual(Array.from(ui.run("Object.keys(THEMES)")), themeNames);
  assert.deepEqual(Array.from(ui.run("Object.keys(COLOR_MODES)")), colorModes);
  assert.deepEqual(ui.themes.filter((input) => input.checked).map((input) => input.value), ["movie"]);
  assert.match(html, /<html lang="es" data-theme="movie" data-color-mode="light">/);
  assert.doesNotMatch(styles, /data-theme="(?:light|night|dark)"/);
  assert.match(html, /class="movie-illustration"/);
  assert.doesNotMatch(html, /Spooky season|Cozy|oto&ntilde;o|Navidad|mood-art|Universo|universos/);
  assert.doesNotMatch(styles, /spooky|cozy|sci-fi|fantasy|christmas/);
  for (const id of ["movie-genre", "catalog-genre", "new-movie-genre"]) {
    const options = html.match(new RegExp(`<select id="${id}"[^>]*>([\\s\\S]*?)</select>`))[1];
    const values = [...options.matchAll(/value="([^"]+)"/g)].map((match) => match[1]);
    assert.deepEqual(values.filter((value) => value !== "all").sort(),
      Array.from(ui.run("Object.keys(MOVIE_GENRES)")).sort());
  }
});

test("theme changes update controls, persist, and reload without changing movie preferences", () => {
  const ui = app();
  ui.set("result", movie());
  ui.run(`saveApiMovie(result); state.draft.movieId = result.id; state.draft.foodId = "pizza";
    state.preferences.genre = "fantasy";
    state.plans.push({ id: "night", movieId: result.id, foodId: "pizza", date: "2026-09-09", place: "Home", completed: true });`);
  const before = JSON.parse(ui.run("JSON.stringify(state)"));
  for (const colorMode of colorModes) {
    if (ui.run("state.colorMode") !== colorMode) ui.nodes.get("color-mode-toggle").listeners.click();
    for (const input of ui.themes) {
      ui.nodes.get("theme-menu").listeners.change({ target: input });
      assert.equal(ui.document.documentElement.dataset.theme, input.value);
      assert.equal(ui.nodes.get("theme-label").textContent, input.value[0].toUpperCase() + input.value.slice(1));
      assert.deepEqual(ui.themes.filter((radio) => radio.checked).map((radio) => radio.value), [input.value]);
      const saved = JSON.parse(ui.storage.get("movie-night:v1"));
      assert.deepEqual(saved, { ...before, theme: input.value, colorMode });
      const reloaded = app({ raw: JSON.stringify(saved) });
      assert.equal(reloaded.document.documentElement.dataset.theme, input.value);
      assert.equal(reloaded.run("storageWritable"), true);
      assert.deepEqual(JSON.parse(reloaded.run("JSON.stringify(state)")), saved);
      const otherTab = app();
      otherTab.window.listeners.storage({ key: "movie-night:v1", newValue: JSON.stringify(saved) });
      assert.deepEqual(JSON.parse(otherTab.run("JSON.stringify(state)")), saved);
      assert.equal(otherTab.nodes.get("theme-label").textContent, ui.nodes.get("theme-label").textContent);
      assert.deepEqual(otherTab.themes.filter((radio) => radio.checked).map((radio) => radio.value), [input.value]);
      for (const tab of [ui, reloaded, otherTab]) {
        assert.equal(tab.document.documentElement.dataset.colorMode, colorMode);
        assert.equal(tab.nodes.get("color-mode-label").textContent, colorMode === "dark" ? "Oscuro" : "Claro");
        assert.equal(tab.nodes.get("color-mode-toggle").attributes["aria-pressed"], String(colorMode === "dark"));
      }
    }
  }
  ui.nodes.get("theme-menu").listeners.change({ target: { value: "spooky", matches: () => true } });
  assert.equal(ui.run("state.theme"), "zine");
  assert.match(ui.nodes.get("toast").textContent, /tema de interfaz/);
});

test("the mode toggle is reversible in every style and never changes the selected theme", () => {
  const ui = app();
  for (const input of ui.themes) {
    ui.nodes.get("theme-menu").listeners.change({ target: input });
    const before = JSON.parse(ui.run("JSON.stringify(state)"));
    for (const colorMode of ["dark", "light"]) {
      ui.nodes.get("color-mode-toggle").listeners.click();
      assert.deepEqual(JSON.parse(ui.run("JSON.stringify(state)")), { ...before, colorMode });
      assert.deepEqual(JSON.parse(ui.storage.get("movie-night:v1")), { ...before, colorMode });
      assert.equal(ui.nodes.get("color-mode-toggle").title, colorMode === "dark" ? "Cambiar a modo claro" : "Cambiar a modo oscuro");
    }
  }
});

test("older appearance settings migrate to a style and mode without altering saved content", () => {
  const seed = app();
  seed.set("result", movie());
  seed.run(`saveApiMovie(result).watched = true; state.draft.movieId = result.id;
    state.plans.push({ id: "night", movieId: result.id, foodId: "pizza", date: "2026-09-09", place: "Home", completed: true });`);
  const original = JSON.parse(seed.run("JSON.stringify(state)"));
  delete original.colorMode;
  for (const [oldTheme, theme, colorMode] of [
    ["light", "movie", "light"], ["night", "movie", "dark"],
    ["movie", "movie", "dark"], ["arcade", "arcade", "dark"], ["zine", "zine", "light"],
  ]) {
    const raw = JSON.stringify({ ...original, theme: oldTheme });
    const ui = app({ raw });
    const expected = { ...original, theme, colorMode };
    assert.deepEqual(JSON.parse(ui.run("JSON.stringify(state)")), expected);
    assert.equal(ui.storage.get("movie-night:v1"), raw);
    ui.run("persistState()");
    assert.deepEqual(JSON.parse(ui.storage.get("movie-night:v1")), expected);
    ui.window.listeners.storage({ key: "movie-night:v1", newValue: raw });
    assert.deepEqual(JSON.parse(ui.run("JSON.stringify(state)")), expected);
  }
});

test("all retired themes migrate without losing collections, watched status, plans, or drafts", () => {
  const seed = app();
  seed.set("result", movie(42, { genre: "christmas" }));
  seed.run(`state.movies.push({ ...result, watched: true, custom: false });
    state.plans.push({ id: "night", movieId: result.id, foodId: "pizza", date: "2026-09-09", place: "Home", completed: true });
    state.draft = { movieId: result.id, foodId: "pizza", date: "2026-09-09", place: "Home" };
    state.preferences.genre = "christmas"`);
  const original = JSON.parse(seed.run("JSON.stringify(state)"));
  delete original.colorMode;
  for (const theme of ["spooky", "cozy", "sci-fi", "fantasy", "christmas"]) {
    const raw = JSON.stringify({ ...original, theme });
    const ui = app({ raw });
    const migrated = JSON.parse(ui.run("JSON.stringify(state)"));
    assert.deepEqual(migrated, {
      ...original, theme: "movie", colorMode: "light",
      movies: original.movies.map((item) => ({ ...item, genre: "general" })),
      preferences: { ...original.preferences, genre: "all" },
    });
    assert.equal(ui.run("isValidState(state)"), true);
    assert.equal(ui.storage.get("movie-night:v1"), raw);
    assert.equal(ui.nodes.get("movie-genre").value, "all");
    assert.equal(ui.nodes.get("movie-badge").textContent, "OTROS G\u00c9NEROS");
    ui.run("persistState()");
    const reloaded = app({ raw: ui.storage.get("movie-night:v1") });
    assert.deepEqual(JSON.parse(reloaded.run("JSON.stringify(state)")), migrated);
    ui.window.listeners.storage({ key: "movie-night:v1", newValue: raw });
    assert.deepEqual(JSON.parse(ui.run("JSON.stringify(state)")), migrated);
  }
});

test("unknown themes and damaged legacy states remain protected instead of being migrated", () => {
  const seed = app();
  const original = JSON.parse(seed.run("JSON.stringify(state)"));
  for (const data of [
    { ...original, theme: "unknown" },
    { ...original, theme: { toString: "light" } },
    { ...original, theme: "cozy", movies: "broken" },
    { ...original, colorMode: "unknown" },
    { ...original, colorMode: null },
    { ...original, colorMode: { toString: "dark" } },
  ]) {
    const raw = JSON.stringify(data);
    const ui = app({ raw });
    ui.run("persistState()");
    assert.equal(ui.storage.get("movie-night:v1"), raw);
    assert.equal(ui.run("storageWritable"), false);
    assert.equal(ui.nodes.get("storage-notice").hidden, false);
  }
});

test("manual additions default to the movie filter, never the interface theme", () => {
  for (const theme of themeNames) {
    for (const genre of ["all", "spooky", "cozy", "sci-fi", "fantasy", "general"]) {
      const ui = app();
      ui.set("theme", theme);
      ui.set("genre", genre);
      ui.run("state.theme = theme; state.preferences.genre = genre");
      ui.nodes.get("add-movie-form").hidden = true;
      ui.nodes.get("show-add-movie").listeners.click();
      assert.equal(ui.nodes.get("new-movie-genre").value, genre === "all" ? "general" : genre);
      ui.nodes.get("new-movie-title").value = "My movie";
      ui.run("addMovie()");
      assert.equal(ui.run("state.movies.length"), 1);
      assert.equal(ui.run("isValidState(state)"), true);
      assert.equal(ui.run("state.theme"), theme);
    }
  }
});

test("retired proxy categories normalize in catalog, details, and saved collection", async () => {
  const data = movie(42, { genre: "christmas" });
  const ui = app({ fetch: async (url) => json(url.pathname === "/movies" ? page([data]) : { movie: data }) });
  ui.run("api.baseUrl = 'https://api.example.com'");
  await ui.run("loadCatalog()");
  assert.equal(ui.run("catalog.results[0].genre"), "general");
  assert.match(ui.nodes.get("catalog-list").children[0].querySelector(".catalog-meta").textContent, /Otros g\u00e9neros/);
  await ui.run("chooseCatalogMovie(catalog.results[0])");
  assert.equal(ui.run("state.movies[0].genre"), "general");
  assert.equal(ui.nodes.get("movie-badge").textContent, "OTROS G\u00c9NEROS");
  assert.equal(ui.run("isValidState(state)"), true);
});

test("all palettes keep readable text and buttons in light and dark modes", () => {
  const colors = (css) => Object.fromEntries([...css.matchAll(/(--[\w-]+):\s*(#[\da-f]{6})/g)]
    .map((match) => [match[1], match[2]]));
  const luminance = (hex) => hex.slice(1).match(/../g).map((channel) => {
    const value = parseInt(channel, 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
  const pairs = [
    ["--ink", "--page"], ["--ink", "--surface"],
    ["--muted", "--page"], ["--muted", "--surface"], ["--muted", "--border"],
    ["--accent", "--page"], ["--accent", "--surface"], ["--accent", "--accent-soft"],
    ["--on-accent", "--accent"], ["--on-accent", "--accent-hover"],
    ["--secondary-ink", "--page"], ["--secondary-ink", "--surface"], ["#ffffff", "--dark"], ["#ffffff", "--dark-hover"],
    ["--art-ink", "--art-bg"],
  ];
  const themePalette = (theme) => colors(styles.match(new RegExp(`:root\\[data-theme="${theme}"\\]\\s*\\{([^}]+)\\}`))[1]);
  assert.match(styles, /:root\s*\{\s*color-scheme: light;/);
  assert.match(styles, /:root\[data-color-mode="dark"\] \{ color-scheme: dark; \}/);
  for (const theme of themeNames) {
    for (const colorMode of colorModes) {
      const overrides = colorMode === "light" ? "" : styles.match(new RegExp(`:root\\[data-theme="${theme}"\\]\\[data-color-mode="dark"\\]\\s*\\{([^}]+)\\}`))[1];
      const palette = { ...themePalette(theme), ...colors(overrides) };
      const themePairs = theme === "movie" ? [
        ...pairs, ["--ticket-ink", "--ticket-bg"], ["--ticket-muted", "--ticket-bg"],
        ["--ticket-ink", "--ticket-surface"], ["--ticket-muted", "--ticket-surface"],
        ["--ticket-accent", "--ticket-bg"], ["--ticket-surface", "--ticket-button-hover"],
        ["--ink", "--screen-top"], ["--muted", "--screen-top"], ["--accent", "--screen-top"],
        ["--ink", "--screen-bottom"], ["--muted", "--screen-bottom"], ["--accent", "--screen-bottom"],
      ] : theme === "zine" ? [...pairs, ["--ink", "--art-accent"]] : pairs;
      for (const [foreground, background] of themePairs) {
        const values = [foreground, background].map((key) => luminance(palette[key] ?? key)).sort((a, b) => b - a);
        const contrast = (values[0] + 0.05) / (values[1] + 0.05);
        assert.ok(contrast >= 4.5, `${theme}/${colorMode}: ${foreground} on ${background} has ${contrast.toFixed(2)} contrast`);
      }
    }
  }
  assert.match(html, new RegExp(`<meta name="theme-color" content="${themePalette("movie")["--page"]}">`));
});

test("proxy config accepts HTTPS or loopback HTTP, never URL credentials or query tokens", () => {
  for (const config of ["javascript:alert(1)", "http://example.com", "https://user:secret@example.com", "https://api.example.com?token=secret"]) {
    const ui = app({ config });
    assert.equal(ui.run("api.baseUrl"), "");
    assert.notEqual(ui.run("api.error"), "");
  }
  const ui = app();
  ui.window.MOVIE_NIGHT_CONFIG.apiBaseUrl = "https://api.example.com/";
  assert.equal(ui.run("readApiConfig().baseUrl"), "https://api.example.com");
});

test("TMDB details render, persist, and reload with long metadata and safe posters", async () => {
  const data = movie(42, { title: "Long ".repeat(50), description: "Synopsis ".repeat(600) });
  const ui = app({ fetch: async () => json({ movie: data }) });
  ui.run("api.baseUrl = 'https://api.example.com'");
  ui.set("result", data);
  await ui.run("chooseCatalogMovie(result)");
  assert.equal(ui.run("state.movies.length"), 1);
  assert.equal(ui.nodes.get("movie-title").textContent, data.title);
  const cast = ui.nodes.get("movie-cast").children;
  assert.deepEqual(cast.map((row) => row.querySelector(".cast-name").textContent), data.cast);
  assert.equal(cast[0].querySelector(".cast-photo").src, "https://image.tmdb.org/t/p/w185/actor-one.jpg");
  assert.equal(cast[0].querySelector(".cast-photo").hidden, false);
  assert.equal(cast[0].querySelector(".cast-placeholder").hidden, true);
  assert.equal(cast[1].querySelector(".cast-photo").src, undefined);
  assert.equal(cast[1].querySelector(".cast-photo").hidden, true);
  assert.equal(cast[1].querySelector(".cast-placeholder").hidden, false);
  assert.equal(ui.nodes.get("movie-directors").textContent, "Director");
  assert.match(ui.nodes.get("movie-meta").textContent, /2024.*123 min/);
  assert.equal(ui.nodes.get("movie-score").hidden, false);
  assert.equal(ui.nodes.get("movie-score-value").textContent, "84%");
  assert.equal(ui.nodes.get("movie-score-votes").textContent, `TMDB \u00b7 ${(1250).toLocaleString("es")} votos`);
  assert.equal(ui.nodes.get("movie-poster").src, "https://image.tmdb.org/t/p/w500/poster.jpg");
  assert.equal(ui.run("isValidState(state)"), true);
  const reloaded = app({ raw: ui.storage.get("movie-night:v1") });
  assert.equal(reloaded.nodes.get("movie-title").textContent, data.title);
  assert.equal(reloaded.run("state.movies[0].tmdbId"), 42);
  assert.equal(reloaded.nodes.get("movie-cast").children[0].querySelector(".cast-photo").src, cast[0].querySelector(".cast-photo").src);
  assert.equal(reloaded.nodes.get("movie-score-value").textContent, "84%");
});

test("missing metadata and failed posters have explicit fallbacks", () => {
  const ui = app();
  ui.set("result", movie(42, { cast: [], directors: [], genres: [], minutes: null, year: null, rating: null }));
  ui.run("saveApiMovie(result); state.draft.movieId = result.id; renderPicker()");
  assert.equal(ui.nodes.get("movie-cast").hidden, true);
  assert.equal(ui.nodes.get("movie-cast-empty").hidden, false);
  assert.equal(ui.nodes.get("movie-score-value").textContent, "\u2014");
  assert.equal(ui.nodes.get("movie-score-votes").textContent, "Sin puntuaci\u00f3n en TMDB");
  assert.match(ui.nodes.get("movie-meta").textContent, /no disponible/);
  ui.nodes.get("movie-poster").listeners.error();
  assert.equal(ui.nodes.get("movie-poster").hidden, true);
  assert.equal(ui.nodes.get("movie-art").hidden, false);
  ui.set("unsafe", movie(43, { posterPath: "//evil.example/image.jpg" }));
  assert.equal(ui.run("isTmdbData(unsafe)"), false);
});

test("broken cast photos retain the name and a stable placeholder across re-renders", () => {
  const ui = app();
  ui.set("result", movie());
  ui.run("saveApiMovie(result); selectMovie(result.id)");
  const row = ui.nodes.get("movie-cast").children[0];
  row.querySelector(".cast-photo").listeners.error();
  assert.equal(row.querySelector(".cast-photo").hidden, true);
  assert.equal(row.querySelector(".cast-placeholder").hidden, false);
  assert.equal(row.querySelector(".cast-name").textContent, "Actor One");
  ui.run("randomFood()");
  const rendered = ui.nodes.get("movie-cast").children[0];
  assert.equal(rendered, row);
  assert.equal(rendered.querySelector(".cast-photo").hidden, true);
  assert.equal(rendered.querySelector(".cast-placeholder").hidden, false);
});

test("a transient cast photo failure is retried when returning to the movie", () => {
  const ui = app();
  ui.set("result", movie());
  ui.set("other", movie(43));
  ui.run("saveApiMovie(result); saveApiMovie(other); selectMovie(result.id)");
  const photo = ui.nodes.get("movie-cast").children[0].querySelector(".cast-photo");
  photo.listeners.error();
  ui.run("selectMovie(other.id); selectMovie(result.id)");
  const retried = ui.nodes.get("movie-cast").children[0].querySelector(".cast-photo");
  assert.notEqual(retried, photo);
  assert.equal(retried.hidden, false);
  assert.equal(retried.src, "https://image.tmdb.org/t/p/w185/actor-one.jpg");
});

test("enriching the same selected movie updates its cast photos", () => {
  const ui = app();
  ui.set("legacy", movie(42, { castProfiles: undefined }));
  ui.set("result", movie());
  ui.run("saveApiMovie(legacy); selectMovie(legacy.id)");
  const oldRow = ui.nodes.get("movie-cast").children[0];
  assert.equal(oldRow.querySelector(".cast-photo").hidden, true);
  ui.run("saveApiMovie(result); renderPicker()");
  const row = ui.nodes.get("movie-cast").children[0];
  assert.notEqual(row, oldRow);
  assert.equal(row.querySelector(".cast-photo").hidden, false);
  assert.equal(row.querySelector(".cast-photo").src, "https://image.tmdb.org/t/p/w185/actor-one.jpg");
});

test("selection loading uses an in-button spinner without changing visible copy or recreating cast", async () => {
  const pending = deferred();
  const ui = app({ fetch: async () => pending.promise });
  ui.set("existing", movie(41));
  ui.set("result", movie(42));
  ui.run("api.baseUrl = 'https://api.example.com'; saveApiMovie(existing); selectMovie(existing.id)");
  const cast = ui.nodes.get("movie-cast").children;
  const hint = ui.nodes.get("plan-hint").textContent;
  const candidateCount = ui.nodes.get("candidate-count").textContent;
  const selection = ui.run("chooseCatalogMovie(result)");
  assert.equal(ui.nodes.get("random-movie").attributes["aria-busy"], "true");
  assert.equal(ui.nodes.get("random-movie").disabled, true);
  assert.equal(ui.nodes.get("random-movie-spinner").hidden, false);
  assert.equal(ui.nodes.get("random-movie-icon").hidden, true);
  assert.equal(ui.nodes.get("picker-status").className, "sr-only");
  assert.equal(ui.nodes.get("picker-status").hidden, false);
  assert.match(ui.nodes.get("picker-status").textContent, /Cargando/);
  assert.equal(ui.nodes.get("plan-hint").textContent, hint);
  assert.equal(ui.nodes.get("candidate-count").textContent, candidateCount);
  assert.equal(ui.nodes.get("movie-cast").children, cast);
  pending.resolve(json({ movie: movie(42) }));
  await selection;
  assert.equal(ui.nodes.get("random-movie").attributes["aria-busy"], "false");
  assert.equal(ui.nodes.get("random-movie-spinner").hidden, true);
  assert.equal(ui.nodes.get("random-movie-icon").hidden, false);
  assert.equal(ui.nodes.get("picker-status").hidden, true);
});

test("cancelling a selection clears the spinner and ignores the late response", async () => {
  const pending = deferred();
  const ui = app({ fetch: async () => pending.promise });
  ui.set("result", movie());
  ui.run("api.baseUrl = 'https://api.example.com'");
  const selection = ui.run("chooseCatalogMovie(result)");
  ui.nodes.get("movie-genre").listeners.change({ target: { value: "cozy" } });
  assert.equal(ui.nodes.get("random-movie").attributes["aria-busy"], "false");
  assert.equal(ui.nodes.get("random-movie-spinner").hidden, true);
  assert.equal(ui.nodes.get("random-movie-icon").hidden, false);
  assert.equal(ui.nodes.get("picker-status").hidden, true);
  pending.resolve(json({ movie: movie() }));
  await selection;
  assert.equal(ui.run("state.draft.movieId"), null);
});

test("score handles zero, rounding, a single vote, and manual selections without stale details", () => {
  const ui = app();
  for (const [rating, score] of [[0, "0%"], [8.46, "85%"], [10, "100%"]]) {
    ui.set("result", movie(42, { rating, voteCount: 1 }));
    ui.run("saveApiMovie(result); selectMovie(result.id)");
    assert.equal(ui.nodes.get("movie-score-value").textContent, score);
    assert.equal(ui.nodes.get("movie-score-votes").textContent, "TMDB \u00b7 1 voto");
  }
  ui.run(`state.movies.push({ id: "custom", title: "My movie", genre: "cozy", year: null,
    minutes: null, description: "My pick", watched: false, custom: true }); selectMovie("custom");`);
  assert.equal(ui.nodes.get("movie-score").hidden, true);
  assert.equal(ui.nodes.get("movie-credits").hidden, true);
  assert.equal(ui.nodes.get("movie-cast").children.length, 0);
});

test("saved TMDB entries without profiles or vote counts still load and work offline", () => {
  const ui = app();
  ui.set("result", movie(42, { castProfiles: undefined, voteCount: undefined }));
  ui.run("saveApiMovie(result); selectMovie(result.id)");
  const reloaded = app({ raw: ui.storage.get("movie-night:v1") });
  assert.equal(reloaded.run("isValidState(state)"), true);
  assert.equal(reloaded.run("storageWritable"), true);
  assert.equal(reloaded.nodes.get("movie-cast").children.length, 2);
  assert.equal(reloaded.nodes.get("movie-cast").children[0].querySelector(".cast-placeholder").hidden, false);
  assert.equal(reloaded.nodes.get("movie-score-value").textContent, "84%");
  assert.equal(reloaded.nodes.get("movie-score-votes").textContent, "TMDB \u00b7 Votos no disponibles");
});

test("choosing an older saved movie in the catalog enriches profiles without losing watched status", async () => {
  let requests = 0;
  const ui = app({ fetch: async () => { requests++; return json({ movie: movie() }); } });
  ui.set("legacy", movie(42, { castProfiles: undefined, voteCount: undefined }));
  ui.set("result", movie());
  ui.run("api.baseUrl = 'https://api.example.com'; saveApiMovie(legacy).watched = true; selectMovie(legacy.id)");
  await ui.run("chooseCatalogMovie(result)");
  assert.equal(requests, 1);
  assert.equal(ui.run("state.movies.length"), 1);
  assert.equal(ui.run("state.movies[0].watched"), true);
  assert.equal(ui.run("state.movies[0].castProfiles[0].profilePath"), "/actor-one.jpg");
  assert.equal(ui.run("isValidState(state)"), true);
  await ui.run("chooseCatalogMovie(result)");
  assert.equal(requests, 1);
});

test("invalid cast profiles and vote counts are rejected, including unsafe image paths", () => {
  const ui = app();
  for (const overrides of [
    { castProfiles: null }, { castProfiles: "invalid" }, { castProfiles: [null] },
    { castProfiles: [{ name: "Actor", profilePath: "//evil.example/photo.jpg" }] },
    { castProfiles: [{ name: "", profilePath: "/photo.jpg" }] },
    { castProfiles: Array.from({ length: 13 }, () => ({ name: "Actor", profilePath: null })) },
    { voteCount: -1 }, { voteCount: 1.5 }, { voteCount: "100" },
  ]) {
    ui.set("result", movie(42, overrides));
    assert.equal(ui.run("isTmdbData(result)"), false);
  }
});

test("legacy collections, watched state, and plan references survive enrichment", () => {
  const ui = app();
  ui.run(`state.movies.push({ id: "legacy", title: "Movie 42", genre: "cozy", year: 2024,
    minutes: 100, description: "Legacy synopsis", watched: true, custom: false });
    state.plans.push({ id: "night", movieId: "legacy", foodId: "pizza", date: "2026-09-09", place: "Home", completed: true });
    state.draft.movieId = "legacy";`);
  assert.equal(ui.run("isValidState(state)"), true);
  ui.set("result", movie());
  ui.run("saveApiMovie(result); saveApiMovie(result); persistState()");
  assert.equal(ui.run("state.movies.length"), 1);
  assert.equal(ui.run("state.movies[0].id"), "legacy");
  assert.equal(ui.run("state.movies[0].genre"), "cozy");
  assert.equal(ui.run("state.movies[0].watched"), true);
  const reloaded = app({ raw: ui.storage.get("movie-night:v1") });
  assert.equal(reloaded.run("state.plans[0].movieId"), "legacy");
  assert.equal(reloaded.run("isValidState(state)"), true);
});

test("remakes keep separate TMDB IDs and custom titles are not guessed", () => {
  const ui = app();
  ui.set("original", movie(42));
  ui.set("remake", movie(43, { title: "Movie 42", year: 2025 }));
  ui.run(`state.movies.push({ id: "custom", title: "Movie 42", genre: "cozy", year: null,
    minutes: null, description: "My movie", watched: false, custom: true });
    saveApiMovie(original); saveApiMovie(remake);`);
  assert.equal(ui.run("state.movies.length"), 3);
  assert.equal(ui.run("isValidState(state)"), true);
});

test("malformed saved metadata is preserved without overwriting", () => {
  const raw = '{"version":1,"movies":"invalid"}';
  const ui = app({ raw });
  ui.run("persistState()");
  assert.equal(ui.storage.get("movie-night:v1"), raw);
  assert.equal(ui.run("storageWritable"), false);
  assert.equal(ui.nodes.get("storage-notice").hidden, false);
});

test("catalog requests encode queries and render paginated and empty results", async () => {
  const requests = [];
  const ui = app({ fetch: async (url, options) => {
    requests.push({ url, options });
    return json(page([movie()], 2, 3));
  } });
  ui.run("api.baseUrl = 'https://api.example.com'; catalog.query = 'A & B'; catalog.genre = 'fantasy'");
  await ui.run("loadCatalog(2)");
  assert.equal(requests[0].url.searchParams.get("query"), "A & B");
  assert.equal(requests[0].options.credentials, "omit");
  assert.equal(requests[0].options.headers.Authorization, undefined);
  assert.equal(ui.nodes.get("catalog-list").children.length, 1);
  assert.equal(ui.nodes.get("catalog-page").textContent, "P\u00e1gina 2 de 3");
  ui.set("fetch", async () => json(page([], 1, 0)));
  await ui.run("loadCatalog()");
  assert.match(ui.nodes.get("catalog-status").textContent, /No encontramos/);
  assert.equal(ui.nodes.get("catalog-pagination").hidden, true);
});

test("HTTP errors, invalid JSON and incompatible API responses surface retry states", async () => {
  for (const response of [
    () => json({ error: "Rate limited" }, 429),
    () => new Response("<html>not a proxy</html>"),
    () => json(page([{ ...movie(), cast: "invalid" }])),
  ]) {
    const ui = app({ fetch: async () => response() });
    ui.run("api.baseUrl = 'https://api.example.com'");
    await ui.run("loadCatalog()");
    assert.equal(ui.nodes.get("catalog-retry").hidden, false);
    assert.equal(ui.run("catalog.results.length"), 0);
    assert.equal(ui.run("catalog.loading"), false);
  }
});

test("random catalog picks sample pages beyond the first and exclude watched/current movies", async () => {
  const requests = [];
  const ui = app({ fetch: async (url) => {
    requests.push(url.pathname + url.search);
    if (url.pathname === "/movies/43") return json({ movie: movie(43) });
    const number = Number(url.searchParams.get("page"));
    return json(page(number === 2 ? [movie(41), movie(42), movie(43)] : [movie(41)], number, 2));
  } });
  ui.set("watched", movie(41));
  ui.set("current", movie(42));
  ui.run(`api.baseUrl = 'https://api.example.com'; Math.random = () => 0.75;
    saveApiMovie(watched).watched = true; saveApiMovie(current);
    state.draft.movieId = current.id;`);
  await ui.run("randomMovie()");
  assert.equal(ui.run("state.draft.movieId"), "tmdb-43");
  assert.ok(requests.some((url) => url.includes("page=2")));
  assert.equal(ui.run("state.movies.find(movie => movie.tmdbId === 41).watched"), true);
  assert.equal(ui.run("isValidState(state)"), true);
});

test("a random pick with no prior selection accepts a new catalog result", async () => {
  const ui = app({ fetch: async (url) => json(url.pathname === "/movies" ? page([movie()]) : { movie: movie() }) });
  ui.run("api.baseUrl = 'https://api.example.com'");
  await ui.run("randomMovie()");
  assert.equal(ui.run("state.draft.movieId"), "tmdb-42");
});

test("older searches and selections cannot overwrite newer requests or local selections", async () => {
  const oldPage = deferred();
  const ui = app({ fetch: async () => oldPage.promise });
  ui.run("api.baseUrl = 'https://api.example.com'");
  const first = ui.run("loadCatalog()");
  ui.set("fetch", async () => json(page([movie(43)])));
  await ui.run("loadCatalog()");
  oldPage.resolve(json(page([movie(42)])));
  await first;
  assert.equal(ui.run("catalog.results[0].tmdbId"), 43);

  const oldDetails = deferred();
  ui.set("fetch", async () => oldDetails.promise);
  ui.set("result", movie(42));
  const selection = ui.run("chooseCatalogMovie(result)");
  ui.set("localMovie", movie(44));
  ui.run("saveApiMovie(localMovie); selectMovie(localMovie.id)");
  oldDetails.resolve(json({ movie: movie(42) }));
  await selection;
  assert.equal(ui.run("state.draft.movieId"), "tmdb-44");
  assert.equal(ui.run("state.movies.length"), 1);
});

test("selection failures keep the previous draft and cannot save a plan while loading", async () => {
  const pending = deferred();
  const ui = app({ fetch: async () => pending.promise });
  ui.set("existing", movie(41));
  ui.set("result", movie(42));
  ui.run("api.baseUrl = 'https://api.example.com'; saveApiMovie(existing); selectMovie(existing.id)");
  const selection = ui.run("chooseCatalogMovie(result)");
  assert.equal(ui.nodes.get("save-plan").disabled, true);
  assert.equal(ui.nodes.get("random-movie").disabled, true);
  ui.run("savePlan()");
  assert.equal(ui.run("state.plans.length"), 0);
  pending.resolve(json({ error: "TMDB unavailable" }, 503));
  await selection;
  assert.equal(ui.run("state.draft.movieId"), "tmdb-41");
  assert.equal(ui.nodes.get("retry-movie").hidden, false);
  assert.equal(ui.nodes.get("picker-status").textContent, "TMDB unavailable");
  assert.equal(ui.nodes.get("picker-status").className, "helper");
  assert.equal(ui.nodes.get("picker-status").hidden, false);
  assert.equal(ui.nodes.get("random-movie").attributes["aria-busy"], "false");
  assert.equal(ui.nodes.get("random-movie-spinner").hidden, true);
  assert.equal(ui.nodes.get("random-movie-icon").hidden, false);
  assert.equal(ui.nodes.get("random-movie").disabled, false);
});

test("cached collection choices and plan completion work without API access", () => {
  const ui = app();
  ui.set("result", movie());
  ui.run("saveApiMovie(result); selectMovie(result.id)");
  ui.nodes.get("plan-date").value = "2026-09-09";
  ui.nodes.get("plan-place").value = "Home";
  ui.run("savePlan(); togglePlan(state.plans[0].id)");
  assert.equal(ui.run("state.movies[0].watched"), true);
  assert.equal(ui.run("state.plans[0].completed"), true);
  ui.run("togglePlan(state.plans[0].id)");
  assert.equal(ui.run("state.movies[0].watched"), true);
  assert.equal(ui.run("state.plans[0].completed"), false);
});

test("the real proxy response contract works from catalog through saved movie details", async (t) => {
  t.mock.method(globalThis, "fetch", async (url) => {
    const data = {
      id: 42, title: "Live-shaped title", overview: "A synopsis", release_date: "2024-06-01",
      genre_ids: [878], poster_path: null, runtime: 120,
      vote_average: 7.6, vote_count: 321,
      credits: { cast: [{ name: "An actor", profile_path: "/actor.jpg" }], crew: [{ name: "A director", job: "Director" }] },
    };
    return json(url.pathname === "/3/movie/42" ? data : {
      page: 1, total_pages: 1, total_results: 1, results: [data],
    });
  });
  const ui = app({ fetch: (url, options) => worker.fetch(new Request(url, {
    ...options, headers: { Origin: "https://alexriosj.github.io" },
  }), { TMDB_READ_TOKEN: "test-only", ALLOWED_ORIGINS: "https://alexriosj.github.io" }) });
  ui.run("api.baseUrl = 'https://api.example.com'");
  await ui.run("loadCatalog()");
  await ui.run("chooseCatalogMovie(catalog.results[0])");
  assert.equal(ui.run("state.movies[0].title"), "Live-shaped title");
  const actor = ui.nodes.get("movie-cast").children[0];
  assert.equal(actor.querySelector(".cast-name").textContent, "An actor");
  assert.equal(actor.querySelector(".cast-photo").src, "https://image.tmdb.org/t/p/w185/actor.jpg");
  assert.equal(ui.nodes.get("movie-score-value").textContent, "76%");
  assert.equal(ui.nodes.get("movie-score-votes").textContent, "TMDB \u00b7 321 votos");
  assert.equal(ui.run("isValidState(state)"), true);
});

const sharedSession = () => ({
  partyId: "00000000-0000-4000-8000-000000000001",
  memberId: "00000000-0000-4000-8000-000000000002",
  token: "a".repeat(64), inviteToken: "b".repeat(64), apiBaseUrl: "https://api.example.com",
});
const sharedMovie = (id = 42, overrides = {}) => ({
  ...movie(id), watched: false, custom: false,
  addedBy: sharedSession().memberId, addedByName: "Alex", ...overrides,
});
const sharedPlan = (overrides = {}) => ({
  id: "00000000-0000-4000-8000-000000000003", movieId: "tmdb-42",
  foodId: "pizza", date: "2026-09-09", place: "Home", completed: false,
  createdBy: sharedSession().memberId, createdByName: "Alex", ...overrides,
});
const snapshot = ({ movies = [], plans = [], revision = 0, members = [] } = {}) => ({
  party: { id: sharedSession().partyId, name: "Friday movies" }, revision, movies, plans,
  members: [{ id: sharedSession().memberId, name: "Alex", role: "host" }, ...members],
});
function enterParty(ui, data = snapshot()) {
  ui.set("session", sharedSession());
  ui.set("snapshot", data);
  ui.run("api.baseUrl = session.apiBaseUrl; catalog.loaded = true; activateParty(session, snapshot)");
}

test("party appearance inherits, saves, and restores both style and mode without changing personal settings", () => {
  for (const theme of themeNames) {
    for (const colorMode of colorModes) {
      const ui = app();
      ui.set("theme", theme);
      ui.set("colorMode", colorMode);
      ui.run("state.theme = theme; state.colorMode = colorMode; persistState()");
      const personal = ui.storage.get("movie-night:v1");
      enterParty(ui);
      assert.equal(ui.run("state.theme"), theme);
      assert.equal(ui.run("state.colorMode"), colorMode);
      ui.nodes.get("color-mode-toggle").listeners.click();
      const changedMode = colorMode === "light" ? "dark" : "light";
      const view = JSON.parse(ui.storage.get(`movie-night:party-view:${sharedSession().partyId}`));
      assert.equal(view.theme, theme);
      assert.equal(view.colorMode, changedMode);
      assert.equal(ui.storage.get("movie-night:v1"), personal);
      ui.run("leaveParty()");
      assert.equal(ui.run("state.colorMode"), colorMode);
      enterParty(ui);
      assert.equal(ui.document.documentElement.dataset.colorMode, changedMode);
      assert.equal(ui.document.documentElement.dataset.theme, theme);
    }
  }
});

test("legacy party views and shared categories migrate before rendering", () => {
  for (const [oldTheme, theme, colorMode] of [
    ["light", "movie", "light"], ["night", "movie", "dark"], ["spooky", "movie", "light"],
    ["movie", "movie", "dark"], ["arcade", "arcade", "dark"], ["zine", "zine", "light"],
  ]) {
    const ui = app();
    const saved = JSON.parse(ui.run("JSON.stringify(state)"));
    ui.storage.set(`movie-night:party-view:${sharedSession().partyId}`, JSON.stringify({
      theme: oldTheme, preferences: { ...saved.preferences, genre: "christmas" }, draft: saved.draft,
    }));
    enterParty(ui, snapshot({ movies: [sharedMovie(42, { genre: "christmas" })] }));
    assert.equal(ui.run("state.theme"), theme);
    assert.equal(ui.run("state.colorMode"), colorMode);
    assert.equal(ui.run("state.preferences.genre"), "all");
    assert.equal(ui.run("state.movies[0].genre"), "general");
    assert.equal(ui.errors.length, 0);
    ui.set("updated", snapshot({ revision: 1, movies: [sharedMovie(43, { genre: "christmas" })] }));
    ui.run("applyPartySnapshot(updated)");
    assert.equal(ui.run("state.movies[0].genre"), "general");
    assert.equal(ui.run("state.colorMode"), colorMode);
  }
});

test("party controls stay in a modal and the header describes personal mode", () => {
  const ui = app();
  assert.equal(ui.nodes.get("party-dialog").open, false);
  assert.equal(ui.nodes.get("party-trigger-name").textContent, "Modo personal");
  assert.equal(ui.nodes.get("party-trigger").dataset.active, "false");
  assert.equal(ui.nodes.get("party-notice").hidden, true);
  assert.equal(ui.nodes.get("party-setup-notice").hidden, false);
  assert.equal(ui.nodes.get("party-create").disabled, true);
  assert.equal(ui.nodes.get("party-options-summary").hidden, true);
  assert.match(html, /<dialog id="party-dialog"[^>]+aria-labelledby="party-title"/);
  assert.equal(html.includes('class="party-panel"'), false);
  assert.ok(html.indexOf('id="party-form"') > html.indexOf("</main>"));
  ui.nodes.get("party-trigger").listeners.click();
  assert.equal(ui.nodes.get("party-dialog").open, true);
  assert.equal(ui.nodes.get("party-trigger").attributes["aria-expanded"], "true");
  ui.nodes.get("party-close").listeners.click();
  assert.equal(ui.nodes.get("party-dialog").open, false);
  assert.equal(ui.nodes.get("party-trigger").attributes["aria-expanded"], "false");
  assert.equal(ui.run("document.activeElement === $('party-trigger')"), true);
});

test("backdrop dismisses the modal without treating its content or padding as backdrop", () => {
  const ui = app();
  const dialog = ui.nodes.get("party-dialog");
  ui.run("openPartyDialog()");
  dialog.listeners.click({ target: ui.nodes.get("party-form"), clientX: 0, clientY: 0 });
  assert.equal(dialog.open, true);
  dialog.listeners.click({ target: dialog, clientX: 50, clientY: 50 });
  assert.equal(dialog.open, true);
  dialog.listeners.click({ target: dialog, clientX: 0, clientY: 0 });
  assert.equal(dialog.open, false);
});

test("switching create/join modes disables hidden required fields and preserves drafts", () => {
  const ui = app();
  ui.nodes.get("party-name").value = "Friday movies";
  ui.nodes.get("party-mode-join").listeners.click();
  assert.equal(ui.nodes.get("party-name-field").hidden, true);
  assert.equal(ui.nodes.get("party-name").disabled, true);
  assert.equal(ui.nodes.get("party-name").required, false);
  assert.equal(ui.nodes.get("party-join-field").hidden, false);
  assert.equal(ui.nodes.get("party-join-link").disabled, false);
  assert.equal(ui.nodes.get("party-join-link").required, true);
  assert.equal(ui.nodes.get("party-mode-join").attributes["aria-pressed"], "true");
  ui.nodes.get("party-mode-create").listeners.click();
  assert.equal(ui.nodes.get("party-name").value, "Friday movies");
  assert.equal(ui.nodes.get("party-name").disabled, false);
  assert.equal(ui.nodes.get("party-name").required, true);
  assert.equal(ui.nodes.get("party-join-link").disabled, true);
  assert.equal(ui.nodes.get("party-join-link").required, false);
});

test("pasted invitations join through the configured API and close the modal", async () => {
  const calls = [];
  const ui = app({ fetch: async (url, options) => {
    calls.push({ url, options });
    return json({ session: sharedSession(), snapshot: snapshot() });
  } });
  ui.run("api.baseUrl = 'https://api.example.com'; catalog.loaded = true; openPartyDialog(); setPartyMode('join')");
  ui.nodes.get("party-join-link").value = `https://alexriosj.github.io/movie-night/#party=${"b".repeat(64)}`;
  ui.nodes.get("party-display-name").value = "Alex";
  await ui.nodes.get("party-form").listeners.submit({ preventDefault() {} });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.origin, "https://api.example.com");
  assert.equal(calls[0].url.pathname, "/parties/join");
  assert.deepEqual(JSON.parse(calls[0].options.body), { inviteToken: "b".repeat(64), displayName: "Alex" });
  assert.equal(ui.nodes.get("party-dialog").open, false);
  assert.equal(ui.nodes.get("party-trigger-name").textContent, "Friday movies");
  assert.equal(ui.nodes.get("party-trigger").dataset.active, "true");
  assert.match(ui.nodes.get("party-trigger").attributes["aria-label"], /Friday movies/);
  assert.equal(ui.run("document.activeElement === $('party-trigger')"), true);
});

test("invalid pasted invitations never fall through to creating a party", async () => {
  for (const value of ["not a link", "https://example.com/#party=broken", "https://example.com/",
    `javascript:alert(1)#party=${"b".repeat(64)}`]) {
    let calls = 0;
    const ui = app({ fetch: async () => { calls += 1; } });
    ui.run("api.baseUrl = 'https://api.example.com'; openPartyDialog(); setPartyMode('join')");
    ui.nodes.get("party-join-link").value = value;
    ui.nodes.get("party-display-name").value = "Alex";
    await ui.run("submitParty({ preventDefault() {} })");
    assert.equal(calls, 0);
    assert.equal(ui.nodes.get("party-dialog").open, true);
    assert.equal(ui.nodes.get("party-status").attributes.role, "alert");
    assert.equal(ui.nodes.get("party-status").hidden, false);
  }
});

test("pasting a remembered invitation reuses membership without creating a participant", async () => {
  const calls = [];
  const ui = app({ fetch: async (url, options) => {
    calls.push({ url, options });
    return json(snapshot());
  } });
  ui.set("remembered", sharedSession());
  ui.run("api.baseUrl = remembered.apiBaseUrl; catalog.loaded = true; party.sessions = [remembered]; openPartyDialog(); setPartyMode('join')");
  ui.nodes.get("party-join-link").value = `https://alexriosj.github.io/movie-night/#party=${"b".repeat(64)}`;
  ui.nodes.get("party-display-name").value = "Name will not replace identity";
  await ui.run("submitParty({ preventDefault() {} })");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.method, "GET");
  assert.equal(ui.run("party.session.memberId"), sharedSession().memberId);
  assert.equal(ui.nodes.get("party-dialog").open, false);
});

test("copy feedback stays inside the modal, including the manual-copy fallback", async () => {
  const ui = app();
  enterParty(ui);
  ui.run("openPartyDialog(); navigator.clipboard = { writeText: async (value) => { window.copied = value; } }");
  await ui.nodes.get("party-copy").listeners.click();
  assert.equal(ui.window.copied, ui.nodes.get("party-link").value);
  assert.equal(ui.nodes.get("party-copy-status").hidden, false);
  assert.match(ui.nodes.get("party-copy-status").textContent, /Enlace copiado/);
  ui.run("navigator.clipboard.writeText = async () => { throw new TypeError('Permission denied'); }");
  await ui.nodes.get("party-copy").listeners.click();
  assert.match(ui.nodes.get("party-copy-status").textContent, /Copia el enlace seleccionado/);
  assert.equal(ui.run("document.activeElement === $('party-link')"), true);
});

test("connection and storage warnings remain visible outside the closed modal", () => {
  const ui = app();
  enterParty(ui);
  ui.run("party.error = 'Connection lost'; party.storageError = 'Storage denied'; renderParty()");
  assert.equal(ui.nodes.get("party-notice").hidden, false);
  assert.match(ui.nodes.get("party-notice").textContent, /Connection lost.*Storage denied/);
  assert.equal(ui.nodes.get("party-trigger-warning").hidden, false);
  ui.run("openPartyDialog()");
  assert.equal(ui.nodes.get("party-notice").hidden, true);
  assert.equal(ui.nodes.get("party-status").textContent, "Connection lost");
  assert.equal(ui.nodes.get("party-storage-notice").hidden, false);
  ui.run("closePartyDialog()");
  assert.equal(ui.nodes.get("party-notice").hidden, false);
  ui.run("party.error = ''; party.storageError = ''; renderParty()");
  assert.equal(ui.nodes.get("party-notice").hidden, true);
  assert.equal(ui.nodes.get("party-trigger-warning").hidden, true);
});

test("the party modal preserves all interface styles and modes without hiding appearance controls", () => {
  for (const theme of themeNames) {
    for (const colorMode of colorModes) {
      const ui = app();
      ui.set("theme", theme);
      ui.set("colorMode", colorMode);
      ui.run("state.theme = theme; state.colorMode = colorMode; renderTheme(); closeThemeMenu()");
      ui.nodes.get("theme-toggle").listeners.click();
      assert.equal(ui.nodes.get("theme-menu").hidden, false);
      ui.nodes.get("party-trigger").listeners.click();
      assert.equal(ui.nodes.get("theme-menu").hidden, true);
      assert.equal(ui.nodes.get("party-dialog").open, true);
      assert.equal(ui.document.documentElement.dataset.theme, theme);
      assert.equal(ui.document.documentElement.dataset.colorMode, colorMode);
      ui.nodes.get("party-close").listeners.click();
      ui.nodes.get("color-mode-toggle").listeners.click();
      assert.equal(ui.run("state.colorMode"), colorMode === "light" ? "dark" : "light");
    }
  }
  assert.doesNotMatch(styles, /var\(--secondary\)/);
  assert.match(styles, /\.party-trigger-warning\s*\{[^}]*color: var\(--on-accent\)/);
});

test("creating a party submits a name without uploading personal movies or drafts", async () => {
  const calls = [];
  const ui = app({ fetch: async (url, options) => {
    calls.push({ url, options });
    return json({ session: sharedSession(), snapshot: snapshot() });
  } });
  ui.set("personal", movie(99));
  ui.run("api.baseUrl = 'https://api.example.com'; catalog.loaded = true; saveApiMovie(personal); state.draft.place = 'Private'; persistState()");
  const original = ui.storage.get("movie-night:v1");
  ui.run("openPartyDialog()");
  ui.nodes.get("party-name").value = "Friday movies";
  ui.nodes.get("party-display-name").value = "Alex";
  await ui.run("submitParty({ preventDefault() {} })");
  assert.equal(calls[0].url.pathname, "/parties");
  assert.deepEqual(JSON.parse(calls[0].options.body), { name: "Friday movies", displayName: "Alex" });
  assert.equal(calls[0].options.headers.Authorization, undefined);
  assert.equal(ui.run("state.movies.length"), 0);
  assert.equal(ui.run("state.draft.place"), "");
  assert.equal(ui.storage.get("movie-night:v1"), original);
  assert.equal(ui.run("party.session.name"), "Friday movies");
  assert.match(ui.nodes.get("party-link").value, /\/movie-night\/#party=b{64}$/);
  assert.equal(ui.nodes.get("party-dialog").open, true);
  assert.equal(ui.nodes.get("party-options").open, false);
  assert.equal(ui.nodes.get("party-current").hidden, false);
  assert.equal(ui.run("document.activeElement === $('party-copy')"), true);
  ui.run("leaveParty()");
  assert.equal(ui.nodes.get("party-dialog").open, false);
  assert.equal(ui.nodes.get("party-trigger-name").textContent, "Modo personal");
  assert.equal(ui.run("state.movies[0].id"), "tmdb-99");
  assert.equal(ui.run("state.draft.place"), "Private");
});

test("invitation fragments prompt for a name and join without an existing bearer", async () => {
  const calls = [];
  const ui = app({ href: `https://alexriosj.github.io/movie-night/#party=${"b".repeat(64)}`,
    fetch: async (url, options) => {
      calls.push({ url, options });
      return json({ session: sharedSession(), snapshot: snapshot() });
    } });
  await ui.run("partyReady");
  assert.equal(ui.nodes.get("party-options").open, true);
  assert.equal(ui.nodes.get("party-dialog").open, true);
  assert.equal(ui.run("document.activeElement === $('party-display-name')"), true);
  assert.equal(ui.nodes.get("party-name-field").hidden, true);
  ui.run("api.baseUrl = 'https://api.example.com'; catalog.loaded = true");
  ui.nodes.get("party-display-name").value = "Alex";
  await ui.run("submitParty({ preventDefault() {} })");
  assert.equal(calls[0].url.pathname, "/parties/join");
  assert.deepEqual(JSON.parse(calls[0].options.body), { inviteToken: "b".repeat(64), displayName: "Alex" });
  assert.equal(calls[0].options.referrerPolicy, "no-referrer");
  assert.equal(ui.window.location.hash, "");
});

test("remembered membership resumes on reload and invitation reuse never creates another participant", async () => {
  const current = sharedSession();
  const stored = JSON.stringify({ version: 1, activeId: current.partyId, sessions: [current] });
  for (const hash of ["", `#party=${current.inviteToken}`]) {
    const calls = [];
    const ui = app({ config: current.apiBaseUrl, partyRaw: stored,
      href: `https://alexriosj.github.io/movie-night/${hash}`,
      fetch: async (url, options) => {
        calls.push({ url, options });
        return json(url.pathname === "/movies" ? page([]) : snapshot({ movies: [sharedMovie()] }));
      } });
    await ui.run("partyReady");
    const requests = calls.filter((call) => call.url.pathname.startsWith("/parties"));
    assert.equal(requests.length, 1);
    assert.equal(requests[0].options.method, "GET");
    assert.equal(requests[0].options.headers.Authorization, `Bearer ${current.token}`);
    assert.equal(ui.run("state.movies[0].addedByName"), "Alex");
    assert.equal(ui.run("party.loading"), false);
    assert.equal(ui.nodes.get("party-dialog").open, false);
  }
});

test("shared TMDB selection writes one movie and keeps original server attribution", async () => {
  const calls = [];
  const authorId = "00000000-0000-4000-8000-000000000004";
  const data = snapshot({ revision: 1, movies: [sharedMovie(42, { addedBy: authorId, addedByName: "Sam", watched: true })],
    members: [{ id: authorId, name: "Sam", role: "member" }] });
  const ui = app({ fetch: async (url, options) => {
    calls.push({ url, options });
    return json(url.pathname === "/movies/42" ? { movie: movie() } : data);
  } });
  enterParty(ui);
  ui.set("choice", movie());
  await ui.run("chooseCatalogMovie(choice)");
  assert.equal(calls[1].url.pathname, `/parties/${sharedSession().partyId}/movies`);
  assert.equal(JSON.parse(calls[1].options.body).movie.tmdbId, 42);
  assert.equal(ui.run("state.movies[0].watched"), true);
  assert.equal(ui.run("state.draft.movieId"), "tmdb-42");
  assert.match(ui.nodes.get("movie-meta").textContent, /Sam/);
  assert.equal(ui.nodes.get("movie-list").children.length, 0);
  assert.equal(ui.storage.has("movie-night:v1"), false);
});

test("custom additions use shared storage and record server-supplied authors", async () => {
  let sent;
  const ui = app({ fetch: async (_url, options) => {
    sent = JSON.parse(options.body).movie;
    return json(snapshot({ revision: 1, movies: [{ ...sent, addedBy: sharedSession().memberId, addedByName: "Alex" }] }));
  } });
  enterParty(ui);
  ui.nodes.get("new-movie-title").value = "Our film";
  ui.nodes.get("new-movie-genre").value = "cozy";
  await ui.run("addMovie()");
  assert.equal(sent.title, "Our film");
  assert.equal(sent.custom, true);
  assert.equal(ui.run("state.movies[0].addedByName"), "Alex");
  assert.match(ui.nodes.get("movie-list").children[0].querySelector(".movie-row-meta").textContent, /Alex/);
  assert.equal(ui.run("isValidState(state)"), true);
});

test("movie delete controls are limited to the author or host in both group lists, never the personal list", () => {
  const other = "00000000-0000-4000-8000-000000000004";
  for (const watched of [false, true]) {
    const ui = app();
    ui.set("personal", movie());
    ui.run("saveApiMovie(personal); renderMovies()");
    assert.equal(ui.nodes.get("movie-list").children[0].querySelector(".delete-movie").hidden, true);
    const data = snapshot({ movies: [sharedMovie(42, { watched }), sharedMovie(43, { watched, addedBy: other, addedByName: "Sam" })],
      members: [{ id: other, name: "Sam", role: "host" }] });
    data.members[0].role = "member";
    enterParty(ui, data);
    ui.set("tab", watched ? "watched" : "pending");
    ui.run("state.preferences.movieTab = tab; renderMovies()");
    const buttons = () => ui.nodes.get("movie-list").children.map((row) => row.querySelector(".delete-movie"));
    assert.deepEqual(buttons().map((button) => button.hidden), [false, true]);
    assert.equal(buttons()[0].dataset.id, "tmdb-42");
    assert.match(buttons()[0].attributes["aria-label"], /Eliminar Movie 42.*grupo/);
    ui.run("party.snapshot.members[0].role = 'host'; renderMovies()");
    assert.deepEqual(buttons().map((button) => button.hidden), [false, false]);
    ui.run("party.writing = true; renderMovies()");
    assert.equal(buttons().every((button) => button.disabled), true);
    ui.run("party.writing = false; leaveParty()");
    assert.equal(buttons()[0].hidden, true);
  }
  assert.match(html, /class="icon-button delete-movie"[^>]*hidden/);
});

test("movie deletion warns about all shared nights and cancellation preserves the collection and draft", async () => {
  const ui = app();
  enterParty(ui, snapshot({ movies: [sharedMovie()], plans: [sharedPlan()] }));
  ui.run("selectMovie('tmdb-42')");
  const before = ui.run("JSON.stringify(state)");
  const prompts = [];
  ui.window.confirm = (message) => { prompts.push(message); return false; };
  await ui.run("deleteMovie('tmdb-42')");
  assert.equal(prompts.length, 1);
  assert.match(prompts[0], /Movie 42/);
  assert.match(prompts[0], /noches programadas y completadas/);
  assert.match(prompts[0], /otros miembros/);
  assert.match(prompts[0], /no se puede deshacer/);
  assert.equal(ui.run("JSON.stringify(state)"), before);
  assert.equal(ui.run("party.writing"), false);
  assert.equal(ui.errors.length, 0);
});

test("movie deletion clears its selected draft and shared nights while preserving personal data", async () => {
  const calls = [];
  const ui = app({ fetch: async (url, options) => {
    calls.push({ url, options });
    return json(snapshot({ revision: 3 }));
  } });
  ui.set("personal", movie());
  ui.run("saveApiMovie(personal); selectMovie(personal.id)");
  const personal = ui.storage.get("movie-night:v1");
  enterParty(ui, snapshot({ movies: [sharedMovie(42, { watched: true })], plans: [
    sharedPlan(), sharedPlan({ id: "00000000-0000-4000-8000-000000000005", completed: true }),
  ] }));
  ui.run("selectMovie('tmdb-42'); state.preferences.movieTab = 'watched'; renderMovies()");
  const row = ui.nodes.get("movie-list").children[0];
  const remove = row.querySelector(".delete-movie");
  ui.set("focused", remove);
  ui.run("document.activeElement = focused");
  row.contains = (element) => element === remove;
  ui.set("didFocus", false);
  ui.run("document.querySelector('[data-movie-tab=\"watched\"]').focus = () => { didFocus = true; }");
  await ui.run("deleteMovie('tmdb-42')");
  assert.equal(ui.run("didFocus"), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.pathname, `/parties/${sharedSession().partyId}/movies/tmdb-42`);
  assert.equal(calls[0].options.method, "DELETE");
  assert.equal(calls[0].options.body, undefined);
  assert.equal(ui.run("state.movies.length"), 0);
  assert.equal(ui.run("state.plans.length"), 0);
  assert.equal(ui.run("state.draft.movieId"), null);
  assert.equal(ui.nodes.get("collection-total").textContent, 0);
  assert.equal(ui.nodes.get("nights-total").textContent, 0);
  assert.equal(ui.nodes.get("movie-empty").hidden, false);
  assert.equal(ui.nodes.get("save-plan").disabled, true);
  assert.match(ui.nodes.get("toast").textContent, /noches asociadas se eliminaron/);
  const view = JSON.parse(ui.storage.get(`movie-night:party-view:${sharedSession().partyId}`));
  assert.equal(view.draft.movieId, null);
  assert.equal(ui.storage.get("movie-night:v1"), personal);
  ui.run("leaveParty()");
  assert.equal(ui.run("state.movies[0].id"), "tmdb-42");
  assert.equal(ui.run("state.draft.movieId"), "tmdb-42");
});

test("failed movie deletions keep the list and selection, disable controls and prevent double submits", async () => {
  const pending = deferred();
  let writes = 0;
  const ui = app({ fetch: async () => { writes += 1; return pending.promise; } });
  enterParty(ui, snapshot({ movies: [sharedMovie()], plans: [sharedPlan()] }));
  ui.run("selectMovie('tmdb-42')");
  const before = ui.run("JSON.stringify(state)");
  const remove = ui.nodes.get("movie-list").children[0].querySelector(".delete-movie");
  ui.set("deleteButtons", [remove]);
  ui.run("document.querySelectorAll = (selector) => selector.includes('.delete-movie') ? deleteButtons : []");
  const deletion = ui.run("deleteMovie('tmdb-42')");
  assert.equal(remove.disabled, true);
  await ui.run("deleteMovie('tmdb-42')");
  assert.equal(writes, 1);
  assert.equal(ui.run("JSON.stringify(state)"), before);
  pending.resolve(json({ error: "Database unavailable" }, 503));
  await deletion;
  assert.equal(ui.run("JSON.stringify(state)"), before);
  assert.equal(remove.disabled, false);
  assert.equal(ui.nodes.get("party-status").textContent, "Database unavailable");
  assert.equal(ui.run("party.writing"), false);
});

test("missing or unauthorized movie deletions never request confirmation or mutate the collection", async () => {
  const other = "00000000-0000-4000-8000-000000000004";
  const ui = app();
  const data = snapshot({ movies: [sharedMovie(42, { addedBy: other, addedByName: "Sam" })],
    members: [{ id: other, name: "Sam", role: "host" }] });
  data.members[0].role = "member";
  enterParty(ui, data);
  ui.window.confirm = () => assert.fail("Only authorized, existing movies can be deleted");
  await ui.run("deleteMovie('tmdb-42')");
  assert.match(ui.nodes.get("toast").textContent, /anfitri\u00f3n/);
  await ui.run("deleteMovie('tmdb-99')");
  assert.match(ui.nodes.get("toast").textContent, /No se encontr\u00f3/);
  assert.equal(ui.run("state.movies.length"), 1);
  assert.equal(ui.errors.length, 0);
});

test("older polls and in-flight catalog selections cannot restore a movie after its deletion", async () => {
  const poll = deferred();
  const details = deferred();
  let writes = 0;
  const ui = app({ fetch: async (url, options) => {
    if (options.method === "DELETE") { writes += 1; return json(snapshot({ revision: 3 })); }
    if (url.pathname === "/movies/42") return details.promise;
    assert.equal(options.method, "GET");
    return poll.promise;
  } });
  enterParty(ui, snapshot({ revision: 1, movies: [sharedMovie()] }));
  ui.set("choice", movie());
  const selection = ui.run("chooseCatalogMovie(choice)");
  const refresh = ui.run("refreshParty()");
  await ui.run("deleteMovie('tmdb-42')");
  poll.resolve(json(snapshot({ revision: 2, movies: [sharedMovie()] })));
  details.resolve(json({ movie: movie() }));
  await Promise.all([selection, refresh]);
  assert.equal(writes, 1);
  assert.equal(ui.run("party.revision"), 3);
  assert.equal(ui.run("state.movies.length"), 0);
  assert.equal(ui.run("selectionController"), null);
});

test("movie list clicks delegate the delete button and its nested icon to movie deletion", () => {
  const ui = app();
  enterParty(ui, snapshot({ movies: [sharedMovie()] }));
  const remove = ui.nodes.get("movie-list").children[0].querySelector(".delete-movie");
  ui.set("deletedId", null);
  ui.run("deleteMovie = (id) => { deletedId = id; }");
  ui.nodes.get("movie-list").listeners.click({
    target: { closest: (selector) => selector === ".delete-movie" ? remove : null },
  });
  assert.equal(ui.run("deletedId"), "tmdb-42");
});

test("shared plan operations use separate endpoints and preserve personal draft fields on polling", async () => {
  const calls = [];
  let current = snapshot({ movies: [sharedMovie()] });
  const ui = app({ fetch: async (url, options) => {
    calls.push({ url, options });
    if (options.method === "POST") current = snapshot({ revision: 1, movies: [sharedMovie()],
      plans: [{ ...JSON.parse(options.body).plan, createdBy: sharedSession().memberId, createdByName: "Alex" }] });
    if (options.method === "PATCH") current = snapshot({ revision: 2, movies: [sharedMovie(42, { watched: true })],
      plans: [{ ...current.plans[0], completed: true }] });
    if (options.method === "DELETE") current = snapshot({ revision: 3, movies: [sharedMovie(42, { watched: true })] });
    return json(current);
  } });
  enterParty(ui, current);
  ui.run("selectMovie('tmdb-42')");
  ui.nodes.get("plan-date").value = "2026-09-09";
  ui.nodes.get("plan-place").value = "Our couch";
  await ui.run("savePlan()");
  assert.equal(calls[0].options.method, "POST");
  assert.equal(ui.run("state.plans[0].createdByName"), "Alex");
  assert.equal(ui.nodes.get("plan-list").children[0].querySelector(".plan-author").textContent, "Plan de Alex");
  await ui.run("togglePlan(state.plans[0].id)");
  assert.equal(ui.run("state.movies[0].watched"), true);
  assert.equal(ui.run("state.plans[0].completed"), true);
  ui.nodes.get("plan-place").value = "Typing an unfinished draft";
  await ui.run("refreshParty()");
  assert.equal(ui.nodes.get("plan-place").value, "Typing an unfinished draft");
  await ui.run("deletePlan(state.plans[0].id)");
  assert.equal(calls.at(-1).options.method, "DELETE");
  assert.equal(ui.run("state.plans.length"), 0);
  assert.equal(ui.run("state.movies[0].watched"), true);
});

test("older snapshots cannot undo a concurrent saved change", async () => {
  const poll = deferred();
  const ui = app({ fetch: async (_url, options) => options.method === "PATCH"
    ? json(snapshot({ revision: 3, movies: [sharedMovie(42, { watched: true })] })) : poll.promise });
  enterParty(ui, snapshot({ revision: 1, movies: [sharedMovie()] }));
  const refresh = ui.run("refreshParty()");
  await ui.run("toggleWatched('tmdb-42')");
  poll.resolve(json(snapshot({ revision: 2, movies: [sharedMovie(), sharedMovie(43)] })));
  await refresh;
  assert.equal(ui.run("party.revision"), 3);
  assert.equal(ui.run("state.movies[0].watched"), true);
  assert.equal(ui.run("state.movies.length"), 1);
});

test("failed writes never become local-only shared changes and block double submits", async () => {
  const pending = deferred();
  let writes = 0;
  const ui = app({ fetch: async () => { writes += 1; return pending.promise; } });
  enterParty(ui, snapshot({ movies: [sharedMovie()] }));
  const write = ui.run("toggleWatched('tmdb-42')");
  await ui.run("toggleWatched('tmdb-42')");
  assert.equal(writes, 1);
  assert.equal(ui.run("state.movies[0].watched"), false);
  pending.resolve(json({ error: "Database unavailable" }, 503));
  await write;
  assert.equal(ui.run("state.movies[0].watched"), false);
  assert.equal(ui.nodes.get("party-status").textContent, "Database unavailable");
  assert.equal(ui.run("party.writing"), false);
  assert.equal(ui.storage.has("movie-night:v1"), false);
});

test("late polls cannot replace the personal list after leaving a party", async () => {
  const pending = deferred();
  const ui = app({ fetch: async () => pending.promise });
  ui.set("personal", movie(99));
  ui.run("saveApiMovie(personal); persistState()");
  enterParty(ui);
  const refresh = ui.run("refreshParty()");
  ui.run("leaveParty()");
  pending.resolve(json(snapshot({ revision: 1, movies: [sharedMovie()] })));
  await refresh;
  assert.equal(ui.run("party.session"), null);
  assert.equal(ui.run("state.movies[0].id"), "tmdb-99");
});

test("invalid snapshots and authors never replace a valid party list", async () => {
  for (const data of [
    { ...snapshot(), movies: "invalid" },
    snapshot({ movies: [sharedMovie(42, { addedBy: "unknown" })], revision: 1 }),
    { ...snapshot({ revision: 1 }), party: { id: "another-party", name: "Other" } },
  ]) {
    const ui = app({ fetch: async () => json(data) });
    enterParty(ui, snapshot({ movies: [sharedMovie()] }));
    await ui.run("refreshParty()");
    assert.equal(ui.run("state.movies.length"), 1);
    assert.equal(ui.run("party.revision"), 0);
    assert.notEqual(ui.run("party.error"), "");
  }
});

test("party draft preferences persist separately and local storage events only update the personal backup", () => {
  const ui = app();
  enterParty(ui, snapshot({ movies: [sharedMovie()] }));
  ui.run("state.draft.place = 'Shared draft'; state.theme = 'zine'; state.colorMode = 'dark'; persistState()");
  const viewKey = `movie-night:party-view:${sharedSession().partyId}`;
  const view = JSON.parse(ui.storage.get(viewKey));
  assert.equal(view.movies, undefined);
  assert.equal(view.draft.place, "Shared draft");
  const local = ui.run("JSON.stringify(freshState())");
  ui.window.listeners.storage({ key: "movie-night:v1", newValue: local });
  assert.equal(ui.run("state.movies.length"), 1);
  ui.run("leaveParty()");
  assert.equal(ui.run("state.movies.length"), 0);
  enterParty(ui, snapshot({ movies: [sharedMovie()] }));
  assert.equal(ui.run("state.draft.place"), "Shared draft");
  assert.equal(ui.run("state.theme"), "zine");
  assert.equal(ui.run("state.colorMode"), "dark");
});

test("broken invitation links never create a party by accident", async () => {
  let calls = 0;
  const ui = app({ href: "https://alexriosj.github.io/movie-night/#party=broken", fetch: async () => { calls += 1; } });
  ui.run("api.baseUrl = 'https://api.example.com'");
  ui.nodes.get("party-name").value = "Unexpected";
  ui.nodes.get("party-display-name").value = "Alex";
  await ui.run("submitParty({ preventDefault() {} })");
  assert.equal(calls, 0);
  assert.match(ui.run("party.error"), /no es v/);
});

test("changed API origins never receive saved member credentials", async () => {
  const stored = JSON.stringify({ version: 1, activeId: sharedSession().partyId, sessions: [sharedSession()] });
  const calls = [];
  const ui = app({ config: "https://different.example.com", partyRaw: stored,
    fetch: async (_url, options) => { calls.push(options); return json(page([])); } });
  await ui.run("partyReady");
  assert.equal(ui.run("party.session"), null);
  assert.equal(calls.every((options) => options.headers.Authorization === undefined), true);
  assert.equal(ui.storage.get("movie-night:parties:v1"), stored);
});

test("automatic polling runs every five seconds and survives a failed attempt to create another party", async () => {
  const pending = deferred();
  let reads = 0;
  const ui = app({ fetch: async (_url, options) => {
    if (options.method === "POST") return pending.promise;
    reads += 1;
    return json(snapshot({ revision: reads, movies: [sharedMovie()] }));
  } });
  enterParty(ui);
  const timer = ui.timers.get(ui.run("party.timer"));
  assert.equal(timer.delay, 5000);
  await timer.callback();
  assert.equal(ui.run("state.movies.length"), 1);
  ui.nodes.get("party-name").value = "Another party";
  ui.nodes.get("party-display-name").value = "Alex";
  const creating = ui.run("submitParty({ preventDefault() {} })");
  await ui.timers.get(ui.run("party.timer")).callback();
  assert.equal(reads, 1);
  pending.resolve(json({ error: "Try again" }, 503));
  await creating;
  await ui.timers.get(ui.run("party.timer")).callback();
  assert.equal(reads, 2);
});

test("restoring an unavailable party blocks writes instead of modifying the personal collection", async () => {
  const pending = deferred();
  const stored = JSON.stringify({ version: 1, activeId: sharedSession().partyId, sessions: [sharedSession()] });
  const ui = app({ config: sharedSession().apiBaseUrl, partyRaw: stored,
    fetch: async (url) => url.pathname === "/movies" ? json(page([])) : pending.promise });
  assert.equal(ui.run("party.loading"), true);
  ui.nodes.get("new-movie-title").value = "Do not store locally";
  ui.nodes.get("new-movie-genre").value = "cozy";
  await ui.run("addMovie()");
  assert.equal(ui.run("state.movies.length"), 0);
  assert.equal(ui.storage.has("movie-night:v1"), false);
  pending.resolve(json({ error: "Party unavailable" }, 503));
  await ui.run("partyReady");
  assert.equal(ui.run("party.loading"), true);
  assert.equal(ui.nodes.get("save-plan").disabled, true);
  ui.run("leaveParty()");
  assert.equal(ui.run("party.loading"), false);
});

test("members can only see delete controls for their own plans while host sees all", () => {
  const other = "00000000-0000-4000-8000-000000000004";
  const ui = app();
  const data = snapshot({ movies: [sharedMovie()], plans: [sharedPlan({ createdBy: other, createdByName: "Sam" })],
    members: [{ id: other, name: "Sam", role: "host" }] });
  data.members[0].role = "member";
  enterParty(ui, data);
  assert.equal(ui.nodes.get("plan-list").children[0].querySelector(".delete-plan").hidden, true);
  ui.run("party.snapshot.members[0].role = 'host'; renderPlans()");
  assert.equal(ui.nodes.get("plan-list").children[0].querySelector(".delete-plan").hidden, false);
});

test("unavailable browser storage surfaces a session warning without losing server-saved movies", async () => {
  const ui = app({ fetch: async () => json(snapshot({ revision: 1, movies: [sharedMovie(42, { watched: true })] })) });
  enterParty(ui, snapshot({ movies: [sharedMovie()] }));
  ui.run("localStorage.setItem = () => { throw new TypeError('Storage denied'); }");
  await ui.run("toggleWatched('tmdb-42')");
  assert.equal(ui.run("state.movies[0].watched"), true);
  assert.equal(ui.nodes.get("party-storage-notice").hidden, false);
  assert.equal(ui.run("party.writing"), false);
});

test("two independent browser sessions share attributed movies and plans through the real Worker and SQLite", async (t) => {
  const db = new D1Database();
  t.after(() => db.sqlite.close());
  const fetch = (url, options) => worker.fetch(new Request(url, {
    ...options, headers: { ...options.headers, Origin: "https://alexriosj.github.io" },
  }), { PARTY_DB: db, ALLOWED_ORIGINS: "https://alexriosj.github.io" });
  const host = app({ fetch });
  host.run("api.baseUrl = 'https://api.example.com'; catalog.loaded = true");
  host.nodes.get("party-name").value = "Shared night";
  host.nodes.get("party-display-name").value = "Alex";
  await host.run("submitParty({ preventDefault() {} })");
  assert.equal(host.run("party.error"), "");
  const guest = app({ fetch, href: host.nodes.get("party-link").value });
  guest.run("api.baseUrl = 'https://api.example.com'; catalog.loaded = true");
  guest.nodes.get("party-display-name").value = "Sam";
  await guest.run("submitParty({ preventDefault() {} })");
  assert.equal(guest.run("party.error"), "");
  assert.equal(guest.run("party.snapshot.members.length"), 2);
  assert.notEqual(host.run("party.session.memberId"), guest.run("party.session.memberId"));

  for (const [client, title] of [[host, "Alex's movie"], [guest, "Sam's movie"]]) {
    client.nodes.get("new-movie-title").value = title;
    client.nodes.get("new-movie-genre").value = "cozy";
  }
  await Promise.all([host.run("addMovie()"), guest.run("addMovie()")]);
  await Promise.all([host.run("refreshParty()"), guest.run("refreshParty()")]);
  for (const client of [host, guest]) {
    assert.equal(client.run("state.movies.length"), 2);
    assert.equal(client.run("state.movies.find(movie => movie.title === \"Alex's movie\").addedByName"), "Alex");
    assert.equal(client.run("state.movies.find(movie => movie.title === \"Sam's movie\").addedByName"), "Sam");
    assert.equal(client.run("isValidState(state)"), true);
  }
  guest.run("selectMovie(state.movies[0].id)");
  guest.nodes.get("plan-date").value = "2026-09-10";
  guest.nodes.get("plan-place").value = "Our couch";
  await guest.run("savePlan()");
  await host.run("refreshParty()");
  assert.equal(host.run("state.plans[0].createdByName"), "Sam");
  await host.run("togglePlan(state.plans[0].id)");
  await guest.run("refreshParty()");
  assert.equal(guest.run("state.plans[0].completed"), true);
  assert.equal(guest.run("state.movies.find(movie => movie.id === state.plans[0].movieId).watched"), true);
  const stored = guest.storage.get("movie-night:parties:v1");
  const reloaded = app({ fetch, config: "https://api.example.com", partyRaw: stored });
  await reloaded.run("partyReady");
  assert.equal(reloaded.run("party.error"), "");
  assert.equal(reloaded.run("party.session.memberId"), guest.run("party.session.memberId"));
  assert.equal(reloaded.run("state.plans.length"), 1);
  assert.equal(db.sqlite.prepare("SELECT count(*) AS count FROM party_members").get().count, 2);

  host.set("deletedMovieId", guest.run("state.plans[0].movieId"));
  await host.run("deleteMovie(deletedMovieId)");
  assert.equal(host.run("party.error"), "");
  await Promise.all([guest.run("refreshParty()"), reloaded.run("refreshParty()")]);
  for (const client of [host, guest, reloaded]) {
    assert.equal(client.run("state.movies.length"), 1);
    assert.equal(client.run("state.plans.length"), 0);
    assert.equal(client.run("state.draft.movieId"), null);
    assert.equal(client.run("isValidState(state)"), true);
  }
  const restored = app({ fetch, config: "https://api.example.com", partyRaw: stored });
  await restored.run("partyReady");
  assert.equal(restored.run("state.movies.length"), 1);
  assert.equal(restored.run("state.plans.length"), 0);
});
