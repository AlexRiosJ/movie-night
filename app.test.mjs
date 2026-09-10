import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import worker from "./proxy/worker.mjs";

const source = readFileSync(new URL("./app.js", import.meta.url), "utf8");
const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
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
  }
  querySelector(selector) {
    if (!this.nodes.has(selector)) this.nodes.set(selector, new Element());
    return this.nodes.get(selector);
  }
  querySelectorAll() { return []; }
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
  for (const id of ["movie-row-template", "plan-row-template", "catalog-row-template", "cast-member-template"]) {
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
  assert.equal(ui.nodes.get("movie-score").hidden, true);
  assert.equal(ui.nodes.get("movie-cast").hidden, true);
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
