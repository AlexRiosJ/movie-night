import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import worker from "./proxy/worker.mjs";

const source = readFileSync(new URL("./app.js", import.meta.url), "utf8");
const translations = readFileSync(new URL("./i18n.js", import.meta.url), "utf8");
const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
const movie = (id = 42, overrides = {}) => ({
  id: `tmdb-${id}`, tmdbId: id, title: `Movie ${id}`, genre: "sci-fi",
  year: 2024, minutes: 123, description: "A movie synopsis.", posterPath: "/poster.jpg",
  cast: ["Actor One", "Actor Two"], directors: ["Director"], genres: ["Science Fiction"],
  originalTitle: `Original ${id}`, rating: 8.4, language: "es-MX", ...overrides,
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
  addEventListener(name, callback) { this.listeners[name] = callback; }
  setAttribute(name, value) { this.attributes[name] = value; }
  getAttribute(name) { return this.attributes[name] ?? null; }
  hasAttribute(name) { return Object.hasOwn(this.attributes, name); }
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
  vm.runInContext(translations, context);
  vm.runInContext(source, context);
  return {
    nodes, storage, context, errors, window,
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
  assert.equal(requests[0].url.searchParams.get("language"), "es-MX");
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

const homeAlone = (language) => movie(771, {
  language, year: 1990, originalTitle: "Home Alone",
  title: language === "es-MX" ? "Mi pobre angelito" : "Home Alone",
  posterPath: language === "es-MX" ? "/latam.jpg" : "/english.jpg",
  description: language === "es-MX" ? "Un ni\u00f1o se queda solo en casa." : "A boy is left home alone.",
});

test("switching language updates the same movie in picker, collection and plans, and persists both locales", async () => {
  const requests = [];
  const ui = app({ fetch: async (url) => {
    requests.push(url);
    return json({ movie: homeAlone(url.searchParams.get("language")) });
  } });
  ui.set("english", homeAlone("en-US"));
  ui.run(`activeLanguage = "en-US"; state.preferences.language = "en-US"; state.preferences.view = "plans";
    saveApiMovie(english).watched = true; selectMovie(english.id);
    state.preferences.movieTab = "watched"; api.baseUrl = "https://api.example.com";`);
  ui.nodes.get("plan-date").value = "2026-12-24";
  ui.nodes.get("plan-place").value = "Casa de Ana";
  ui.run("savePlan()");
  const draft = ui.run("JSON.stringify(state.draft)");
  await ui.run("changeLanguage('es-MX')");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].pathname, "/movies/771");
  assert.equal(requests[0].searchParams.get("language"), "es-MX");
  assert.equal(ui.nodes.get("movie-title").textContent, "Mi pobre angelito");
  assert.equal(ui.nodes.get("movie-poster").src, "https://image.tmdb.org/t/p/w500/latam.jpg");
  assert.equal(ui.nodes.get("movie-list").children[0].querySelector(".movie-row-title").textContent, "Mi pobre angelito");
  assert.equal(ui.nodes.get("plan-list").children[0].querySelector(".plan-movie-title").textContent, "Mi pobre angelito");
  assert.equal(ui.run("JSON.stringify(state.draft)"), draft);
  assert.equal(ui.run("state.movies.length"), 1);
  assert.equal(ui.run("state.movies[0].watched"), true);
  assert.equal(ui.run("state.plans[0].movieId"), "tmdb-771");
  assert.equal(ui.run("state.plans[0].place"), "Casa de Ana");
  await ui.run("changeLanguage('en-US')");
  assert.equal(requests.length, 1, "the previously loaded locale should work from cache");
  assert.equal(ui.nodes.get("movie-title").textContent, "Home Alone");
  assert.equal(ui.nodes.get("movie-poster").src, "https://image.tmdb.org/t/p/w500/english.jpg");
  assert.equal(ui.nodes.get("food-name").textContent, ui.run("foodById(state.draft.foodId).name"));
  assert.equal(ui.run("document.documentElement.lang"), "en-US");
  assert.equal(ui.nodes.get("language").value, "en-US");
  assert.match(ui.nodes.get("plan-list").children[0].querySelector("time").textContent, /Dec/);
  assert.equal(ui.run("isValidState(state)"), true);
  const reloaded = app({ raw: ui.storage.get("movie-night:v1") });
  assert.equal(reloaded.nodes.get("movie-title").textContent, "Home Alone");
  assert.equal(reloaded.run("activeLanguage"), "en-US");
  await reloaded.run("changeLanguage('es-MX')");
  assert.equal(reloaded.nodes.get("movie-title").textContent, "Mi pobre angelito");
  assert.equal(reloaded.nodes.get("language-status").hidden, true);
});

test("saved-only movie selection and random picks use the active cached locale", async () => {
  const ui = app();
  ui.set("spanish", homeAlone("es-MX"));
  ui.set("english", homeAlone("en-US"));
  ui.run("saveApiMovie(spanish); saveApiMovie(english); state.preferences.source = 'collection'");
  await ui.run("changeLanguage('es-MX')");
  ui.run("randomMovie()");
  assert.equal(ui.nodes.get("movie-title").textContent, "Mi pobre angelito");
  await ui.run("changeLanguage('en-US')");
  ui.run("selectMovie('tmdb-771')");
  assert.equal(ui.nodes.get("movie-title").textContent, "Home Alone");
  assert.match(ui.nodes.get("toast").textContent, /Home Alone: ready/);
});

test("locale refresh failures keep all saved data, show a retry, and recover without duplicates", async () => {
  const ui = app({ fetch: async () => { throw new TypeError("offline"); } });
  ui.set("spanish", homeAlone("es-MX"));
  ui.run(`state.preferences.view = "plans"; saveApiMovie(spanish); selectMovie(spanish.id);
    api.baseUrl = "https://api.example.com";`);
  await ui.run("changeLanguage('en-US')");
  assert.equal(ui.nodes.get("movie-title").textContent, "Mi pobre angelito");
  assert.equal(ui.nodes.get("language-retry").hidden, false);
  assert.match(ui.nodes.get("language-status").textContent, /Available details have been kept/);
  assert.equal(ui.run("state.movies[0].localizations['en-US']"), undefined);
  ui.set("fetch", async () => json({ movie: homeAlone("en-US") }));
  await ui.nodes.get("language-retry").listeners.click();
  assert.equal(ui.nodes.get("movie-title").textContent, "Home Alone");
  assert.equal(ui.nodes.get("language-retry").hidden, true);
  assert.equal(ui.run("state.movies.length"), 1);
});

test("rapid locale changes cannot apply stale movie metadata or selection results", async () => {
  const pending = deferred();
  const ui = app({ fetch: async () => pending.promise });
  ui.set("spanish", homeAlone("es-MX"));
  ui.run(`state.preferences.view = "plans"; saveApiMovie(spanish); selectMovie(spanish.id);
    api.baseUrl = "https://api.example.com";`);
  const refresh = ui.run("changeLanguage('en-US')");
  await ui.run("changeLanguage('es-MX')");
  pending.resolve(json({ movie: homeAlone("en-US") }));
  await refresh;
  assert.equal(ui.nodes.get("movie-title").textContent, "Mi pobre angelito");
  assert.equal(ui.run("state.movies[0].localizations['en-US']"), undefined);
  assert.equal(ui.nodes.get("language-retry").hidden, true);

  const oldSelection = deferred();
  ui.set("fetch", async () => oldSelection.promise);
  ui.set("another", movie(43));
  const selection = ui.run("chooseCatalogMovie(another)");
  // Cached metadata makes this change independent of the pending selection.
  ui.set("english", homeAlone("en-US"));
  ui.run("saveApiMovie(english)");
  await ui.run("changeLanguage('en-US')");
  oldSelection.resolve(json({ movie: movie(43) }));
  await selection;
  assert.equal(ui.run("state.draft.movieId"), "tmdb-771");
  assert.equal(ui.run("state.movies.length"), 1);
  assert.equal(ui.nodes.get("movie-title").textContent, "Home Alone");
});

test("changing language reloads catalog search and pagination without stale results", async () => {
  const stale = deferred();
  const ui = app({ fetch: async () => stale.promise });
  ui.run("api.baseUrl = 'https://api.example.com'; catalog.query = 'Home Alone'; catalog.genre = 'all'");
  const old = ui.run("loadCatalog(2)");
  const requests = [];
  ui.set("fetch", async (url) => {
    requests.push(url);
    return json(page([homeAlone(url.searchParams.get("language"))], Number(url.searchParams.get("page")), 3));
  });
  await ui.run("changeLanguage('en-US')");
  await ui.run("loadCatalog(2)");
  stale.resolve(json(page([homeAlone("es-MX")], 2, 3)));
  await old;
  assert.ok(requests.every((url) => url.searchParams.get("language") === "en-US"));
  assert.ok(requests.every((url) => url.searchParams.get("query") === "Home Alone"));
  assert.equal(ui.run("catalog.results[0].title"), "Home Alone");
  assert.equal(ui.nodes.get("catalog-page").textContent, "Page 2 of 3");
  assert.match(ui.nodes.get("catalog-status").textContent, /results on TMDB/);
});

test("random catalog discovery and details request English after switching", async () => {
  const requests = [];
  const ui = app({ fetch: async (url) => {
    requests.push(url);
    return json(url.pathname === "/movies" ? page([homeAlone("en-US")]) : { movie: homeAlone("en-US") });
  } });
  await ui.run("changeLanguage('en-US')");
  ui.run("api.baseUrl = 'https://api.example.com'");
  await ui.run("randomMovie()");
  assert.equal(requests.length, 2);
  assert.ok(requests.every((url) => url.searchParams.get("language") === "en-US"));
  assert.equal(ui.nodes.get("movie-title").textContent, "Home Alone");
});

test("untranslated legacy metadata is preserved and refreshed by TMDB ID without relinking plans", async () => {
  const old = app();
  old.set("legacy", homeAlone("es-MX"));
  old.run(`delete legacy.language; saveApiMovie(legacy); state.movies[0].id = "legacy-home";
    state.movies[0].watched = true; state.draft.movieId = "legacy-home"; state.preferences.view = "plans";
    delete state.preferences.language;
    state.plans.push({ id: "night", movieId: "legacy-home", foodId: "pizza", date: "2026-12-24", place: "Home", completed: true });
    persistState();`);
  const ui = app({ raw: old.storage.get("movie-night:v1"), fetch: async () => json({ movie: homeAlone("es-MX") }) });
  assert.equal(ui.run("activeLanguage"), "es-MX");
  assert.equal(ui.run("state.movies[0].localizations['es-MX']"), undefined);
  ui.run("api.baseUrl = 'https://api.example.com'");
  await ui.run("refreshMovieLanguages()");
  assert.equal(ui.run("state.movies[0].id"), "legacy-home");
  assert.equal(ui.run("state.movies[0].watched"), true);
  assert.equal(ui.run("state.plans[0].movieId"), "legacy-home");
  assert.equal(ui.run("state.plans[0].completed"), true);
  assert.equal(ui.run("isValidState(state)"), true);
});

test("manual titles and plan locations are never translated or sent to TMDB", async () => {
  const ui = app();
  ui.nodes.get("new-movie-title").value = "Mi pel\u00edcula casera";
  ui.nodes.get("new-movie-genre").value = "cozy";
  ui.run("addMovie(); selectMovie(state.movies[0].id)");
  ui.nodes.get("plan-date").value = "2026-12-24";
  ui.nodes.get("plan-place").value = "Sala de mi casa";
  ui.run("savePlan()");
  await ui.run("changeLanguage('en-US')");
  assert.equal(ui.nodes.get("movie-title").textContent, "Mi pel\u00edcula casera");
  assert.equal(ui.nodes.get("plan-list").children[0].querySelector(".plan-location").textContent, "Sala de mi casa");
  assert.match(ui.nodes.get("movie-description").textContent, /One of your picks/);
  assert.equal(ui.nodes.get("language-status").hidden, true);
});

test("unsupported stored locales and corrupted localized metadata do not overwrite saved data", () => {
  const original = app();
  original.set("spanish", homeAlone("es-MX"));
  original.run("saveApiMovie(spanish); persistState()");
  const base = original.storage.get("movie-night:v1");
  for (const mutate of [
    (state) => { state.preferences.language = "fr-FR"; },
    (state) => { state.movies[0].localizations["es-MX"].tmdbId = 42; },
    (state) => { state.movies[0].localizations["es-MX"].language = "en-US"; },
    (state) => { state.movies[0].localizations["es-MX"].posterPath = "//evil.example/a.jpg"; },
  ]) {
    const state = JSON.parse(base);
    mutate(state);
    const raw = JSON.stringify(state);
    const ui = app({ raw });
    ui.run("persistState()");
    assert.equal(ui.storage.get("movie-night:v1"), raw);
    assert.equal(ui.run("storageWritable"), false);
  }
});

test("API responses in the wrong language cannot poison localized caches", async () => {
  for (const language of ["es-MX", undefined]) {
    const ui = app({ fetch: async () => json({ movie: homeAlone(language) }) });
    await ui.run("changeLanguage('en-US')");
    ui.run("api.baseUrl = 'https://api.example.com'");
    ui.set("result", homeAlone("en-US"));
    await ui.run("chooseCatalogMovie(result)");
    assert.equal(ui.run("state.movies.length"), 0);
    assert.equal(ui.nodes.get("retry-movie").hidden, false);
    assert.match(ui.nodes.get("picker-status").textContent, /selected language/);
  }
});

test("cross-tab language changes re-render cached titles and cannot be overwritten by an older refresh", async () => {
  const pending = deferred();
  const ui = app({ fetch: async () => pending.promise });
  ui.set("spanish", homeAlone("es-MX"));
  ui.run(`saveApiMovie(spanish); selectMovie(spanish.id); state.preferences.view = "plans";
    api.baseUrl = "https://api.example.com"; persistState();`);
  const spanishState = ui.storage.get("movie-night:v1");
  const refresh = ui.run("changeLanguage('en-US')");
  ui.window.listeners.storage({ key: "movie-night:v1", newValue: spanishState });
  pending.resolve(json({ movie: homeAlone("en-US") }));
  await refresh;
  assert.equal(ui.run("activeLanguage"), "es-MX");
  assert.equal(ui.nodes.get("movie-title").textContent, "Mi pobre angelito");
  assert.equal(ui.run("state.movies[0].localizations['en-US']"), undefined);
});

test("static translations preserve controls, user input and original attributes across round trips", () => {
  const ui = app();
  const label = new Element();
  label.dataset.en = "Preferences";
  label.textContent = "Preferencias";
  const input = new Element();
  input.setAttribute("placeholder", "Mi sof\u00e1");
  input.setAttribute("data-en-placeholder", "My couch");
  input.value = "My own words";
  const root = new Element();
  root.querySelectorAll = (selector) => selector === "[data-en]" ? [label]
    : selector === "[data-en-placeholder]" ? [input] : [];
  ui.set("translationRoot", root);
  ui.run("activeLanguage = 'en-US'; translateInterface(translationRoot)");
  assert.equal(label.textContent, "Preferences");
  assert.equal(input.getAttribute("placeholder"), "My couch");
  ui.run("activeLanguage = 'es-MX'; translateInterface(translationRoot)");
  assert.equal(label.textContent, "Preferencias");
  assert.equal(input.getAttribute("placeholder"), "Mi sof\u00e1");
  assert.equal(input.value, "My own words");
});

test("localized original-title matching enriches legacy IDs but never guesses custom movies", () => {
  const ui = app();
  ui.set("spanish", homeAlone("es-MX"));
  ui.run(`state.movies.push({ id: "legacy", title: "Home Alone", genre: "christmas", year: 1990,
    minutes: 103, description: "Legacy", watched: true, custom: false });
    saveApiMovie(spanish);`);
  assert.equal(ui.run("state.movies.length"), 1);
  assert.equal(ui.run("state.movies[0].id"), "legacy");
  assert.equal(ui.run("state.movies[0].watched"), true);
  const custom = app();
  custom.set("spanish", homeAlone("es-MX"));
  custom.run(`state.movies.push({ id: "custom", title: "Home Alone", genre: "christmas", year: 1990,
    minutes: 103, description: "My own synopsis", watched: false, custom: true });
    saveApiMovie(spanish);`);
  assert.equal(custom.run("state.movies.length"), 2);
  assert.equal(custom.run("movieDisplay(state.movies[0]).description"), "My own synopsis");
});

test("partial translation failures retry only the missing locale without replacing successful details", async () => {
  const requests = [];
  const ui = app({ fetch: async (url) => {
    requests.push(url.pathname);
    return url.pathname === "/movies/771" ? json({ movie: homeAlone("en-US") }) : json({ error: "Try again" }, 503);
  } });
  ui.set("spanish", homeAlone("es-MX"));
  ui.set("second", movie(42));
  ui.run("state.preferences.view = 'plans'; saveApiMovie(spanish); saveApiMovie(second); api.baseUrl = 'https://api.example.com'");
  await ui.run("changeLanguage('en-US')");
  assert.equal(ui.run("movieDisplay(state.movies[0]).title"), "Home Alone");
  assert.equal(ui.nodes.get("language-retry").hidden, false);
  ui.set("fetch", async (url) => {
    requests.push(url.pathname);
    return json({ movie: movie(42, { language: "en-US" }) });
  });
  await ui.run("refreshMovieLanguages()");
  assert.deepEqual(requests, ["/movies/771", "/movies/42", "/movies/42"]);
  assert.equal(ui.nodes.get("language-status").hidden, true);
  assert.equal(ui.run("state.movies.length"), 2);
});

test("a persistent storage warning follows language changes without overwriting damaged data", async () => {
  const raw = "invalid saved JSON";
  const ui = app({ raw });
  await ui.run("changeLanguage('en-US')");
  assert.match(ui.nodes.get("storage-notice").textContent, /Your saved data could not be read/);
  assert.equal(ui.storage.get("movie-night:v1"), raw);
});

test("the actual proxy localizes Home Alone and preserves its identity through a round trip", async (t) => {
  const upstreamCalls = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    upstreamCalls.push(url);
    const language = url.searchParams.get("language");
    const localized = homeAlone(language);
    const data = {
      id: 771, title: localized.title, original_title: "Home Alone", release_date: "1990-11-16",
      overview: localized.description, runtime: 103, genre_ids: [35, 10751],
      poster_path: localized.posterPath,
      images: { posters: [
        { file_path: "/english.jpg", iso_639_1: "en" },
        { file_path: "/latam.jpg", iso_639_1: "es" },
      ] },
    };
    return json(url.pathname === "/3/movie/771" ? data : {
      page: 1, total_pages: 1, total_results: 1, results: [data],
    });
  });
  const ui = app({ fetch: (url, options) => worker.fetch(new Request(url, options), {
    TMDB_READ_TOKEN: "test-only", ALLOWED_ORIGINS: "https://alexriosj.github.io",
  }) });
  ui.run("state.preferences.view = 'plans'");
  await ui.run("changeLanguage('en-US')");
  ui.run("api.baseUrl = 'https://api.example.com'");
  await ui.run("loadCatalog()");
  await ui.run("chooseCatalogMovie(catalog.results[0])");
  ui.run("toggleWatched('tmdb-771')");
  assert.equal(ui.nodes.get("movie-title").textContent, "Home Alone");
  await ui.run("changeLanguage('es-MX')");
  assert.equal(ui.nodes.get("movie-title").textContent, "Mi pobre angelito");
  assert.equal(ui.nodes.get("movie-poster").src, "https://image.tmdb.org/t/p/w500/latam.jpg");
  await ui.run("loadCatalog()");
  await ui.run("chooseCatalogMovie(catalog.results[0])");
  assert.equal(ui.run("state.movies.length"), 1);
  assert.equal(ui.run("state.movies[0].watched"), true);
  await ui.run("changeLanguage('en-US')");
  assert.equal(ui.nodes.get("movie-title").textContent, "Home Alone");
  assert.equal(ui.nodes.get("movie-poster").src, "https://image.tmdb.org/t/p/w500/english.jpg");
  assert.ok(upstreamCalls.some((url) => url.searchParams.get("language") === "es-MX"));
  assert.equal(ui.run("isValidState(state)"), true);
});
