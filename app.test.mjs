import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import worker from "./proxy/worker.mjs";

const source = readFileSync(new URL("./app.js", import.meta.url), "utf8");
const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
const themeNames = ["movie", "arcade", "zine"];
const colorModes = ["light", "dark"];
const movie = (id = 42, overrides = {}) => ({
  id: `tmdb-${id}`, tmdbId: id, title: `Movie ${id}`, genre: "sci-fi",
  year: 2024, minutes: 123, description: "A movie synopsis.", posterPath: "/poster.jpg",
  cast: ["Actor One", "Actor Two"], directors: ["Director"], genres: ["Science Fiction"],
  originalTitle: `Original ${id}`, rating: 8.4, ...overrides,
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
  focus() {}
  scrollIntoView() {}
  reportValidity() { return true; }
  setCustomValidity() {}
  reset() {}
}

function app({ raw = null, config = "", fetch = async () => { throw new Error("Unexpected request"); } } = {}) {
  const nodes = new Map([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => [match[1], new Element()]));
  for (const id of ["movie-row-template", "plan-row-template", "catalog-row-template"]) {
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
  document.getElementById = (id) => {
    assert.ok(nodes.has(id), `Element #${id} must exist in index.html`);
    return nodes.get(id);
  };
  document.createDocumentFragment = () => new Element();
  const storage = new Map(raw === null ? [] : [["movie-night:v1", raw]]);
  const window = new Element();
  window.MOVIE_NIGHT_CONFIG = { apiBaseUrl: config };
  const errors = [];
  const context = vm.createContext({
    document, window, localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    },
    URL, Response, TypeError, SyntaxError, AbortController, AbortSignal,
    fetch, crypto, setTimeout: () => 0, clearTimeout() {},
    getComputedStyle: () => ({ getPropertyValue: () => "#fff" }),
    console: { error: (...args) => errors.push(args) },
  });
  vm.runInContext(source, context);
  return {
    nodes, storage, context, errors, window, document, themes,
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
  assert.equal(ui.nodes.get("movie-cast").textContent, "Actor One, Actor Two");
  assert.equal(ui.nodes.get("movie-directors").textContent, "Director");
  assert.match(ui.nodes.get("movie-meta").textContent, /2024.*123 min.*8.4/);
  assert.equal(ui.nodes.get("movie-poster").src, "https://image.tmdb.org/t/p/w500/poster.jpg");
  assert.equal(ui.run("isValidState(state)"), true);
  const reloaded = app({ raw: ui.storage.get("movie-night:v1") });
  assert.equal(reloaded.nodes.get("movie-title").textContent, data.title);
  assert.equal(reloaded.run("state.movies[0].tmdbId"), 42);
});

test("missing metadata and failed posters have explicit fallbacks", () => {
  const ui = app();
  ui.set("result", movie(42, { cast: [], directors: [], genres: [], minutes: null, year: null, rating: null }));
  ui.run("saveApiMovie(result); state.draft.movieId = result.id; renderPicker()");
  assert.equal(ui.nodes.get("movie-cast").textContent, "Reparto no disponible");
  assert.match(ui.nodes.get("movie-meta").textContent, /no disponible/);
  ui.nodes.get("movie-poster").listeners.error();
  assert.equal(ui.nodes.get("movie-poster").hidden, true);
  assert.equal(ui.nodes.get("movie-art").hidden, false);
  ui.set("unsafe", movie(43, { posterPath: "//evil.example/image.jpg" }));
  assert.equal(ui.run("isTmdbData(unsafe)"), false);
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
  ui.run("savePlan()");
  assert.equal(ui.run("state.plans.length"), 0);
  pending.resolve(json({ error: "TMDB unavailable" }, 503));
  await selection;
  assert.equal(ui.run("state.draft.movieId"), "tmdb-41");
  assert.equal(ui.nodes.get("retry-movie").hidden, false);
  assert.equal(ui.nodes.get("picker-status").textContent, "TMDB unavailable");
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
      credits: { cast: [{ name: "An actor" }], crew: [{ name: "A director", job: "Director" }] },
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
  assert.equal(ui.nodes.get("movie-cast").textContent, "An actor");
  assert.equal(ui.run("isValidState(state)"), true);
});
