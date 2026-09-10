import assert from "node:assert/strict";
import { test } from "node:test";
import worker, { normalizeMovie } from "./worker.mjs";

const env = { TMDB_READ_TOKEN: "test-token-not-a-credential", ALLOWED_ORIGINS: "https://alexriosj.github.io,http://localhost:8000" };
const origin = "https://alexriosj.github.io";
const upstreamMovie = (overrides = {}) => ({
  id: 42, title: "Movie", original_title: "Original", release_date: "2024-01-01",
  overview: "Synopsis", runtime: 123, poster_path: "/poster.jpg", adult: false,
  genre_ids: [878], vote_average: 8.4, vote_count: 100, ...overrides,
});
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers });
const request = (path = "/movies", options = {}) => new Request(`https://api.example.com${path}`, {
  headers: { Origin: origin }, ...options,
});
const list = (results = [upstreamMovie()], overrides = {}) => ({
  page: 1, total_pages: 1000, total_results: 20000, results, ...overrides,
});

test("discovery sends only approved parameters and the secret to TMDB", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push({ url, options });
    return json(list());
  });
  const response = await worker.fetch(request("/movies?genre=sci-fi"), env);
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(calls[0].url.origin, "https://api.themoviedb.org");
  assert.equal(calls[0].url.pathname, "/3/discover/movie");
  assert.equal(calls[0].url.searchParams.get("with_genres"), "878");
  assert.equal(calls[0].url.searchParams.get("include_adult"), "false");
  assert.equal(calls[0].url.searchParams.get("language"), "es-ES");
  assert.equal(calls[0].options.headers.Authorization, `Bearer ${env.TMDB_READ_TOKEN}`);
  assert.equal(calls[0].options.redirect, "manual");
  assert.equal(data.totalPages, 500);
  assert.equal(data.results[0].id, "tmdb-42");
  assert.equal(JSON.stringify(data).includes(env.TMDB_READ_TOKEN), false);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), origin);
  assert.equal(response.headers.get("Vary"), "Origin");
});

test("search encodes the exact title and does not silently limit it to a mood", async (t) => {
  t.mock.method(globalThis, "fetch", async (url) => {
    assert.equal(url.pathname, "/3/search/movie");
    assert.equal(url.searchParams.get("query"), "A & B");
    assert.equal(url.searchParams.has("with_genres"), false);
    return json(list());
  });
  const response = await worker.fetch(request("/movies?query=A%20%26%20B&genre=cozy"), env);
  assert.equal((await response.json()).results[0].genre, "sci-fi");
});

test("mood filters use TMDB genres/keywords including the general category", async (t) => {
  const actual = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    actual.push(url);
    return json(list());
  });
  for (const genre of ["spooky", "cozy", "fantasy", "christmas", "general"]) {
    const response = await worker.fetch(request(`/movies?genre=${genre}`), env);
    assert.equal((await response.json()).results[0].genre, genre);
  }
  assert.equal(actual[0].searchParams.get("with_genres"), "27|9648");
  assert.equal(actual[1].searchParams.get("with_genres"), "35|10749|10751");
  assert.equal(actual[2].searchParams.get("with_genres"), "14");
  assert.equal(actual[3].searchParams.get("with_keywords"), "207317");
  assert.equal(actual[4].searchParams.get("without_genres"), "27,9648,35,10749,10751,878,14");
});

test("details include cast photos, directors, genres, original title, rating, votes and synopsis", async (t) => {
  t.mock.method(globalThis, "fetch", async (url) => {
    assert.equal(url.pathname, "/3/movie/42");
    assert.equal(url.searchParams.get("append_to_response"), "credits,keywords");
    return json(upstreamMovie({
      credits: { cast: [{ name: "Actor", profile_path: "/actor.jpg" }], crew: [{ job: "Writer", name: "Writer" }, { job: "Director", name: "Director" }] },
      genres: [{ id: 878, name: "Ciencia ficci\u00f3n" }],
      keywords: { keywords: [{ id: 207317, name: "christmas" }] },
    }));
  });
  const response = await worker.fetch(request("/movies/42"), env);
  const { movie } = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(movie.cast, ["Actor"]);
  assert.deepEqual(movie.castProfiles, [{ name: "Actor", profilePath: "/actor.jpg" }]);
  assert.deepEqual(movie.directors, ["Director"]);
  assert.deepEqual(movie.genres, ["Ciencia ficci\u00f3n"]);
  assert.equal(movie.genre, "christmas");
  assert.equal(movie.originalTitle, "Original");
  assert.equal(movie.rating, 8.4);
  assert.equal(movie.voteCount, 100);
  assert.equal(movie.minutes, 123);
});

test("normalization bounds optional fields and missing metadata", () => {
  const result = normalizeMovie(upstreamMovie({
    title: "T".repeat(400), overview: "S".repeat(7000), release_date: "", runtime: 0,
    poster_path: "//evil.example/poster.jpg", vote_count: 0,
    credits: { cast: Array.from({ length: 30 }, (_, i) => ({ name: `Actor ${i}` })) },
  }));
  assert.equal(result.title.length, 300);
  assert.equal(result.description.length, 6000);
  assert.equal(result.cast.length, 12);
  assert.equal(result.castProfiles.length, 12);
  assert.deepEqual(result.castProfiles[0], { name: "Actor 0", profilePath: null });
  assert.equal(result.year, null);
  assert.equal(result.minutes, null);
  assert.equal(result.posterPath, null);
  assert.equal(result.rating, null);
  assert.equal(result.voteCount, 0);
  assert.equal(normalizeMovie({ id: 42, title: "Movie" }).description, "Sin sinopsis disponible.");
  for (const data of [null, {}, { id: -1, title: "No" }, upstreamMovie({ credits: "bad" }), upstreamMovie({ genres: ["bad"] })]) {
    assert.throws(() => normalizeMovie(data));
  }
});

test("cast profiles preserve principal cast order, deduplicate names, and sanitize image paths", () => {
  const result = normalizeMovie(upstreamMovie({ credits: { cast: [
    { name: " First ", profile_path: "/first.jpg" },
    { name: "Second", profile_path: null },
    { name: "First", profile_path: "/duplicate.jpg" },
    { name: "Third", profile_path: "https://evil.example/image.jpg" },
    { name: "Fourth", profile_path: "//evil.example/image.png" },
    { name: "", profile_path: "/unnamed.jpg" },
    { name: "Fifth", profile_path: "/fifth.PNG" },
  ] } }));
  assert.deepEqual(result.castProfiles, [
    { name: "First", profilePath: "/first.jpg" },
    { name: "Second", profilePath: null },
    { name: "Third", profilePath: null },
    { name: "Fourth", profilePath: null },
    { name: "Fifth", profilePath: "/fifth.PNG" },
  ]);
  assert.deepEqual(result.castProfiles.map((person) => person.name), result.cast);
  assert.deepEqual(normalizeMovie({ id: 42, title: "Movie" }).castProfiles, []);
  assert.throws(() => normalizeMovie(upstreamMovie({ credits: { cast: [null] } })));
});

test("user ratings require a valid vote count and retain genuine zero scores", () => {
  for (const vote_count of [undefined, null, "100", -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    const result = normalizeMovie(upstreamMovie({ vote_count }));
    assert.equal(result.voteCount, null);
    assert.equal(result.rating, null);
  }
  const result = normalizeMovie(upstreamMovie({ vote_average: 0, vote_count: 1 }));
  assert.equal(result.voteCount, 1);
  assert.equal(result.rating, 0);
});

test("invalid inputs, routes and HTTP methods never hit TMDB", async (t) => {
  const upstream = t.mock.method(globalThis, "fetch", async () => { throw new Error("Must not call upstream"); });
  for (const path of ["/movies?page=0", "/movies?page=501", "/movies?page=1.5", "/movies?page=01",
    "/movies?genre=unknown", "/movies?query=" + "a".repeat(121), "/movies?api_key=x",
    "/movies?page=1&page=2", "/movies?query=%00", "/movies/0", "/movies/42?append_to_response=account",
    "/account", "/https://evil.example", "/movies/9007199254740992"]) {
    assert.ok([400, 404].includes((await worker.fetch(request(path), env)).status), path);
  }
  assert.equal((await worker.fetch(request("/movies", { method: "POST", headers: { Origin: origin } }), env)).status, 405);
  assert.equal(upstream.mock.calls.length, 0);
});

test("CORS is origin-specific and preflight does not require the token", async () => {
  for (const denied of ["https://evil.example", "null", "https://alexriosj.github.io.evil.example"]) {
    const response = await worker.fetch(request("/movies", { headers: { Origin: denied } }), env);
    assert.equal(response.status, 403);
    assert.equal(response.headers.has("Access-Control-Allow-Origin"), false);
  }
  const response = await worker.fetch(request("/movies", {
    method: "OPTIONS", headers: { Origin: origin, "Access-Control-Request-Method": "GET" },
  }), { ALLOWED_ORIGINS: origin });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), origin);
  assert.equal(response.headers.get("Access-Control-Allow-Methods"), "GET, OPTIONS");
});

test("missing secret and upstream failures produce useful, noncached errors", async (t) => {
  const missing = await worker.fetch(request(), { ALLOWED_ORIGINS: origin });
  assert.equal(missing.status, 503);
  assert.equal(missing.headers.get("Access-Control-Allow-Origin"), origin);
  for (const [status, expected] of [[401, 502], [403, 502], [404, 404], [429, 429], [500, 502]]) {
    t.mock.method(globalThis, "fetch", async () => json({ secret: env.TMDB_READ_TOKEN }, status, { "Retry-After": "60" }));
    const response = await worker.fetch(request(), env);
    assert.equal(response.status, expected);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    if (status === 429) assert.equal(response.headers.get("Retry-After"), "60");
    assert.equal((await response.text()).includes(env.TMDB_READ_TOKEN), false);
    t.mock.restoreAll();
  }
});

test("upstream redirects fail without forwarding credentials or exposing the response", async (t) => {
  for (const path of ["/movies", "/movies?query=Movie", "/movies/42"]) {
    for (const status of [301, 302, 303, 307, 308]) {
      let calls = 0;
      t.mock.method(globalThis, "fetch", async (url, options) => {
        calls++;
        assert.equal(url.origin, "https://api.themoviedb.org");
        assert.equal(options.redirect, "manual");
        return new Response("Private upstream response", {
          status, headers: { Location: "https://redirect.example.com/" },
        });
      });
      const response = await worker.fetch(request(path), env);
      assert.equal(response.status, 502);
      assert.equal(calls, 1);
      assert.equal(response.headers.has("Location"), false);
      assert.equal(response.headers.get("Cache-Control"), "no-store");
      const body = await response.text();
      assert.equal(body.includes("Private upstream response"), false);
      assert.equal(body.includes(env.TMDB_READ_TOKEN), false);
      t.mock.restoreAll();
    }
  }
});

test("network timeouts, malformed responses and mismatched detail IDs fail explicitly", async (t) => {
  for (const [reply, status] of [
    [async () => { throw new DOMException("timeout", "TimeoutError"); }, 504],
    [async () => { throw new TypeError("network failed"); }, 502],
    [async () => new Response("<html>unavailable</html>"), 502],
    [async () => json(list([], { page: 2 })), 502],
    [async () => json(list([null])), 502],
  ]) {
    t.mock.method(globalThis, "fetch", reply);
    assert.equal((await worker.fetch(request(), env)).status, status);
    t.mock.restoreAll();
  }
  t.mock.method(globalThis, "fetch", async () => json(upstreamMovie({ id: 43 })));
  assert.equal((await worker.fetch(request("/movies/42"), env)).status, 502);
});

test("adult titles are excluded from lists and unavailable by ID", async (t) => {
  t.mock.method(globalThis, "fetch", async () => json(list([upstreamMovie({ adult: true }), upstreamMovie({ id: 43 })])));
  const data = await (await worker.fetch(request(), env)).json();
  assert.equal(data.results.length, 1);
  assert.equal(data.results[0].tmdbId, 43);
  t.mock.restoreAll();
  t.mock.method(globalThis, "fetch", async () => json(upstreamMovie({ adult: true })));
  assert.equal((await worker.fetch(request("/movies/42"), env)).status, 404);
});

test("cached public data does not leak one caller's CORS origin to another", async (t) => {
  const entries = new Map();
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "caches");
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, "caches", descriptor);
    else delete globalThis.caches;
  });
  globalThis.caches = { default: {
    match: async (key) => entries.get(key.url)?.clone(),
    put: async (key, response) => { entries.set(key.url, response); },
  } };
  const upstream = t.mock.method(globalThis, "fetch", async () => json(list()));
  const pending = [];
  const context = { waitUntil: (promise) => pending.push(promise) };
  const first = await worker.fetch(request(), env, context);
  await Promise.all(pending);
  const second = await worker.fetch(request("/movies", { headers: { Origin: "http://localhost:8000" } }), env, context);
  assert.equal(first.headers.get("Access-Control-Allow-Origin"), origin);
  assert.equal(second.headers.get("Access-Control-Allow-Origin"), "http://localhost:8000");
  assert.equal(upstream.mock.calls.length, 1);
  assert.equal([...entries.values()][0].headers.has("Access-Control-Allow-Origin"), false);
});
