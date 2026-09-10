import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import worker from "./proxy/worker.mjs";
import { D1Database } from "./proxy/d1-fixture.mjs";

const source = readFileSync(new URL("./parties.js", import.meta.url), "utf8")
  + "\n" + readFileSync(new URL("./app.js", import.meta.url), "utf8");
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
    nodes, storage, context, errors, window, timers,
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
  assert.equal(rendered.querySelector(".cast-photo").src, undefined);
  assert.equal(rendered.querySelector(".cast-placeholder").hidden, false);
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

test("creating a party submits a name without uploading personal movies or drafts", async () => {
  const calls = [];
  const ui = app({ fetch: async (url, options) => {
    calls.push({ url, options });
    return json({ session: sharedSession(), snapshot: snapshot() });
  } });
  ui.set("personal", movie(99));
  ui.run("api.baseUrl = 'https://api.example.com'; catalog.loaded = true; saveApiMovie(personal); state.draft.place = 'Private'; persistState()");
  const original = ui.storage.get("movie-night:v1");
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
  ui.run("leaveParty()");
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
  ui.run("state.draft.place = 'Shared draft'; state.theme = 'cozy'; persistState()");
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
  assert.equal(ui.run("state.theme"), "cozy");
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
});
