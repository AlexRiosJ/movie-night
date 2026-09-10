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
const languages = ["es-MX", "en-US"];
const homeAlone = (language, overrides = {}) => upstreamMovie({
  id: 771, title: language === "es-MX" ? "Mi pobre angelito" : "Home Alone",
  original_title: "Home Alone", original_language: "en", release_date: "1990-11-16",
  poster_path: language === "es-MX" ? "/home-alone-es.jpg" : "/home-alone-en.jpg",
  genre_ids: [35, 10751], ...overrides,
});
function mockCache(t, entries = new Map()) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "caches");
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, "caches", descriptor);
    else delete globalThis.caches;
  });
  globalThis.caches = { default: {
    match: async (key) => entries.get(key.url)?.clone(),
    put: async (key, response) => { entries.set(key.url, response); },
  } };
  return entries;
}

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
  assert.equal(calls[0].url.searchParams.get("language"), "es-MX");
  assert.equal(calls[0].options.headers.Authorization, `Bearer ${env.TMDB_READ_TOKEN}`);
  assert.equal(calls[0].options.redirect, "manual");
  assert.equal(data.totalPages, 500);
  assert.equal(data.results[0].id, "tmdb-42");
  assert.equal(data.results[0].language, "es-MX");
  assert.equal(JSON.stringify(data).includes(env.TMDB_READ_TOKEN), false);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), origin);
  assert.equal(response.headers.get("Vary"), "Origin");
});

test("search encodes the exact title and does not silently limit it to a mood", async (t) => {
  t.mock.method(globalThis, "fetch", async (url) => {
    assert.equal(url.pathname, "/3/search/movie");
    assert.equal(url.searchParams.get("query"), "A & B");
    assert.equal(url.searchParams.get("language"), "es-MX");
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
    assert.equal(url.searchParams.get("append_to_response"), "credits,keywords,images");
    assert.equal(url.searchParams.get("language"), "es-MX");
    assert.equal(url.searchParams.get("include_image_language"), "es,null");
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
  assert.equal(movie.language, "es-MX");
});

test("search, discovery and details localize Home Alone without changing its TMDB identity", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    calls.push(url);
    const language = url.searchParams.get("language");
    assert.ok(languages.includes(language));
    const movie = homeAlone(language);
    if (url.pathname === "/3/movie/771") {
      assert.equal(url.searchParams.get("append_to_response"), "credits,keywords,images");
      assert.equal(url.searchParams.get("include_image_language"), `${language.slice(0, 2)},null`);
      return json({
        ...movie, poster_path: "/tmdb-fallback.jpg",
        genres: [{ id: 35, name: language === "es-MX" ? "Comedia" : "Comedy" }],
        images: { posters: [
          { iso_639_1: null, file_path: "/neutral.jpg" },
          { iso_639_1: "en", file_path: "/home-alone-en.jpg" },
          { iso_639_1: "es", file_path: "/home-alone-es.jpg" },
        ] },
      });
    }
    assert.equal(url.searchParams.has("append_to_response"), false);
    assert.equal(url.searchParams.has("include_image_language"), false);
    if (url.pathname === "/3/search/movie") assert.equal(url.searchParams.get("query"), movie.title);
    return json(list([movie]));
  });
  for (const language of languages) {
    for (const path of [
      `/movies?language=${language}&genre=cozy`,
      `/movies?language=${language}&query=${encodeURIComponent(homeAlone(language).title)}`,
      `/movies/771?language=${language}`,
    ]) {
      const response = await worker.fetch(request(path), env);
      assert.equal(response.status, 200);
      const body = await response.json();
      const movie = body.movie ?? body.results[0];
      assert.equal(movie.id, "tmdb-771");
      assert.equal(movie.tmdbId, 771);
      assert.equal(movie.language, language);
      assert.equal(movie.title, homeAlone(language).title);
      assert.equal(movie.originalTitle, "Home Alone");
      assert.equal(movie.posterPath, homeAlone(language).poster_path);
      assert.equal(movie.genres[0], language === "es-MX" ? "Comedia" : "Comedy");
      assert.equal(movie.year, 1990);
    }
  }
  assert.deepEqual(calls.map((url) => url.pathname), [
    "/3/discover/movie", "/3/search/movie", "/3/movie/771",
    "/3/discover/movie", "/3/search/movie", "/3/movie/771",
  ]);
});

test("missing metadata uses localized fallbacks without inventing movie translations", async (t) => {
  t.mock.method(globalThis, "fetch", async (url) => {
    const movie = { id: 771, title: "Home Alone" };
    return json(url.pathname === "/3/movie/771" ? movie : list([movie]));
  });
  for (const language of languages) {
    for (const path of ["/movies", "/movies/771"]) {
      const response = await worker.fetch(request(`${path}?language=${language}`), env);
      assert.equal(response.status, 200);
      const body = await response.json();
      const movie = body.movie ?? body.results[0];
      assert.equal(movie.title, "Home Alone");
      assert.equal(movie.language, language);
      assert.equal(movie.description, language === "es-MX" ? "Sin sinopsis disponible." : "No synopsis available.");
      for (const field of ["cast", "directors", "genres"]) assert.deepEqual(movie[field], []);
      for (const field of ["posterPath", "year", "minutes", "rating"]) assert.equal(movie[field], null);
      assert.equal(movie.originalTitle, "");
    }
    for (const metadata of [
      { genre_ids: [878, 35, 10751, 999999, 878] },
      { genres: [{ id: 878 }, { id: 35, name: "" }, { id: 10751, name: null }, { id: 999999 }, { id: 878 }] },
    ]) {
      const movie = normalizeMovie({ id: 42, title: "Movie", ...metadata }, null, language);
      assert.deepEqual(movie.genres, language === "es-MX" ? ["Ciencia ficci\u00f3n", "Comedia", "Familia"] : ["Science Fiction", "Comedy", "Family"]);
    }
  }
});

test("detail posters prefer the requested ISO language, then neutral, original and TMDB fallback", async (t) => {
  let movie;
  t.mock.method(globalThis, "fetch", async () => json(movie));
  const poster = (iso_639_1, file_path) => ({ iso_639_1, file_path });
  for (const language of languages) {
    const selected = poster(language.slice(0, 2), "/selected.jpg");
    const neutral = poster(null, "/neutral.png");
    const original = poster("ja", "/original.jpg");
    const other = poster("fr", "/other.jpg");
    const cases = [
      [[original, neutral, selected], "/selected.jpg"],
      [[neutral, selected, poster(language.slice(0, 2), "/another-region.jpg")], "/selected.jpg"],
      [[original, neutral], "/neutral.png"],
      [[other, original], "/original.jpg"],
      [[other], "/tmdb-fallback.jpg"],
      [[], "/tmdb-fallback.jpg"],
      [[poster(undefined, "/untagged.jpg")], "/tmdb-fallback.jpg"],
      [[poster(language.slice(0, 2), "//evil.example/image.jpg"), neutral], "/neutral.png"],
      [[poster(null, "/unsafe.svg"), original], "/original.jpg"],
      [[poster(language.slice(0, 2), null), neutral], "/neutral.png"],
    ];
    for (const [posters, expected] of cases) {
      movie = upstreamMovie({ original_language: "ja", poster_path: "/tmdb-fallback.jpg", images: { posters } });
      const response = await worker.fetch(request(`/movies/42?language=${language}`), env);
      assert.equal(response.status, 200);
      assert.equal((await response.json()).movie.posterPath, expected);
    }
    for (const images of [undefined, null, {}, { posters: null }, { posters: [] }]) {
      for (const poster_path of ["/tmdb-fallback.jpg", null, undefined, "//evil.example/poster.jpg"]) {
        movie = upstreamMovie({ images, poster_path });
        const response = await worker.fetch(request(`/movies/42?language=${language}`), env);
        assert.equal(response.status, 200);
        assert.equal((await response.json()).movie.posterPath, poster_path === "/tmdb-fallback.jpg" ? poster_path : null);
      }
    }
  }
});

test("unsafe image paths are never returned and catalog posters use TMDB poster_path", async (t) => {
  let movie;
  t.mock.method(globalThis, "fetch", async (url) => json(url.pathname === "/3/movie/42" ? movie : list([movie])));
  for (const file_path of [
    "https://evil.example/poster.jpg", "//evil.example/poster.jpg", "/../poster.jpg",
    "/poster.jpg?redirect=evil", "/poster.jpg#fragment", "/poster.svg", "/foo\\poster.jpg",
    "/%2fposter.jpg", "/poster.jpg\n", "/poster.jpg\r", "",
  ]) {
    movie = upstreamMovie({ poster_path: file_path, images: { posters: [{ iso_639_1: "en", file_path }] } });
    for (const path of ["/movies", "/movies/42"]) {
      const response = await worker.fetch(request(`${path}?language=en-US`), env);
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal((body.movie ?? body.results[0]).posterPath, null, file_path);
    }
  }
  movie = upstreamMovie({
    poster_path: "/catalog-localized.jpg",
    images: { posters: [{ iso_639_1: "en", file_path: "/detail-only.jpg" }] },
  });
  const body = await (await worker.fetch(request("/movies?language=en-US"), env)).json();
  assert.equal(body.results[0].posterPath, "/catalog-localized.jpg");
});

test("malformed nested detail metadata fails with a localized, noncached upstream error", async (t) => {
  let metadata;
  t.mock.method(globalThis, "fetch", async () => json(upstreamMovie(metadata)));
  const malformed = [
    { images: "bad" }, { images: [] }, { images: { posters: {} } }, { images: { posters: [null] } },
    { images: { posters: ["/poster.jpg"] } },
    ...[{}, [], 42, "en-US", "es\n"].map((iso_639_1) => ({ images: { posters: [{ file_path: "/poster.jpg", iso_639_1 }] } })),
    { images: { posters: [{ file_path: { path: "/poster.jpg" }, iso_639_1: "es" }] } },
    { credits: [] }, { credits: { cast: {} } }, { credits: { cast: [null] } },
    { credits: { crew: ["bad"] } }, { keywords: [] }, { keywords: { keywords: [null] } },
    { genres: [{ id: "35" }] }, { genre_ids: ["35"] },
  ];
  for (const language of languages) {
    for (metadata of malformed) {
      const response = await worker.fetch(request(`/movies/42?language=${language}`), env);
      assert.equal(response.status, 502, JSON.stringify(metadata));
      assert.equal(response.headers.get("Cache-Control"), "no-store");
      assert.deepEqual(await response.json(), {
        error: language === "es-MX" ? "TMDB devolvi\u00f3 datos no compatibles. Int\u00e9ntalo de nuevo." : "TMDB returned unsupported data. Please try again.",
      });
    }
  }
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

test("both routes strictly reject unsupported or duplicate language parameters before cache or TMDB", async (t) => {
  mockCache(t);
  const cache = t.mock.method(globalThis.caches.default, "match", async () => { throw new Error("Must not read cache"); });
  const upstream = t.mock.method(globalThis, "fetch", async () => { throw new Error("Must not call upstream"); });
  for (const path of ["/movies", "/movies/42"]) {
    for (const language of [
      "", "es", "en", "es-ES", "es-mx", "EN-US", "fr-FR", "es_MX",
      " en-US", "es-MX ", "es-MX\u0000", "en-US,es-MX", "constructor", "__proto__", "toString",
    ]) {
      const response = await worker.fetch(request(`${path}?language=${encodeURIComponent(language)}`), env);
      assert.equal(response.status, 400, `${path} language=${language}`);
      assert.equal(response.headers.get("Cache-Control"), "no-store");
      assert.deepEqual(await response.json(), { error: "Idioma no v\u00e1lido. Usa es-MX o en-US una sola vez." });
    }
    for (const parameters of [
      "language=en-US&language=es-MX", "language=es-MX&language=es-MX",
      "language=en-US&%6canguage=en-US", "language=&language=en-US",
    ]) {
      assert.equal((await worker.fetch(request(`${path}?${parameters}`), env)).status, 400);
    }
    for (const parameters of ["language=en-US&api_key=x", "language=en-US&append_to_response=account", "language=en-US&include_image_language=fr"]) {
      assert.ok([400, 404].includes((await worker.fetch(request(`${path}?${parameters}`), env)).status));
    }
  }
  assert.equal(cache.mock.calls.length, 0);
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

test("missing secret and upstream failures produce localized, noncached errors", async (t) => {
  const missing = await worker.fetch(request(), { ALLOWED_ORIGINS: origin });
  assert.equal(missing.status, 503);
  assert.equal(missing.headers.get("Access-Control-Allow-Origin"), origin);
  const invalidCredential = [
    "La credencial TMDB del proxy no es v\u00e1lida. Contacta con quien administra la app.",
    "The proxy's TMDB credential is invalid. Contact the app administrator.",
  ];
  const failures = [
    [401, 502, invalidCredential], [403, 502, invalidCredential],
    [404, 404, ["No se encontr\u00f3 la pel\u00edcula en TMDB.", "The movie was not found on TMDB."]],
    [429, 429, [
      "TMDB ha recibido demasiadas solicitudes. Espera un momento y vuelve a intentarlo.",
      "TMDB has received too many requests. Wait a moment and try again.",
    ]],
    [500, 502, ["TMDB no est\u00e1 disponible en este momento. Int\u00e9ntalo de nuevo.", "TMDB is currently unavailable. Please try again."]],
  ];
  for (const [index, language] of languages.entries()) {
    for (const [status, expected, messages] of failures) {
      t.mock.method(globalThis, "fetch", async () => json({ secret: env.TMDB_READ_TOKEN }, status, { "Retry-After": "60" }));
      for (const path of ["/movies", "/movies/42"]) {
        const response = await worker.fetch(request(`${path}?language=${language}`), env);
        assert.equal(response.status, expected);
        assert.equal(response.headers.get("Cache-Control"), "no-store");
        if (status === 429) assert.equal(response.headers.get("Retry-After"), "60");
        assert.deepEqual(await response.json(), { error: messages[index] });
      }
      t.mock.restoreAll();
    }
  }
});

test("validation, configuration, CORS and method errors use the requested locale", async (t) => {
  const upstream = t.mock.method(globalThis, "fetch", async () => { throw new Error("Must not call upstream"); });
  const cases = [
    ["/movies", {}, { ALLOWED_ORIGINS: origin }, 503, [
      "El proxy necesita configurar el secreto TMDB_READ_TOKEN.", "The proxy needs the TMDB_READ_TOKEN secret configured.",
    ]],
    ["/movies", { headers: {} }, {}, 503, ["El proxy necesita configurar ALLOWED_ORIGINS.", "The proxy needs ALLOWED_ORIGINS configured."]],
    ["/movies", { headers: { Origin: "https://evil.example" } }, env, 403, [
      "Este origen no tiene permiso para consultar el cat\u00e1logo.", "This origin is not allowed to access the catalog.",
    ]],
    ["/account", {}, env, 404, ["Ruta no disponible.", "Route not available."]],
    ["/movies?api_key=x", {}, env, 400, ["Par\u00e1metros de b\u00fasqueda no v\u00e1lidos.", "Invalid search parameters."]],
    ["/movies?page=0", {}, env, 400, [
      "El t\u00edtulo, universo o n\u00famero de p\u00e1gina no es v\u00e1lido.", "The title, mood, or page number is invalid.",
    ]],
    ["/movies", { method: "POST" }, env, 405, ["Solo se permiten consultas GET.", "Only GET requests are allowed."]],
    ["/movies/42", { method: "OPTIONS", headers: { Origin: origin, "Access-Control-Request-Method": "POST" } },
      env, 405, ["Solo se permiten consultas GET.", "Only GET requests are allowed."]],
  ];
  for (const [index, language] of languages.entries()) {
    for (const [path, options, config, status, messages] of cases) {
      const response = await worker.fetch(request(`${path}${path.includes("?") ? "&" : "?"}language=${language}`, options), config);
      assert.equal(response.status, status);
      assert.deepEqual(await response.json(), { error: messages[index] });
      assert.equal(response.headers.get("Cache-Control"), "no-store");
      if (status === 405) assert.equal(response.headers.get("Allow"), "GET, OPTIONS");
    }
    const preflight = await worker.fetch(request(`/movies/42?language=${language}`, {
      method: "OPTIONS", headers: { Origin: origin, "Access-Control-Request-Method": "GET" },
    }), { ALLOWED_ORIGINS: origin });
    assert.equal(preflight.status, 204);
  }
  assert.equal(upstream.mock.calls.length, 0);
});

test("rate limits keep a safe Retry-After value in either language", async (t) => {
  let retry;
  t.mock.method(globalThis, "fetch", async () => json({}, 429, retry === null ? {} : { "Retry-After": retry }));
  for (const language of languages) {
    for (retry of [null, "later", "-1", "999999", "https://evil.example"]) {
      const response = await worker.fetch(request(`/movies?language=${language}`), env);
      assert.equal(response.status, 429);
      assert.equal(response.headers.get("Retry-After"), "30");
      assert.equal(response.headers.get("Access-Control-Expose-Headers"), "Retry-After");
    }
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
  const invalidData = ["TMDB devolvi\u00f3 datos no compatibles. Int\u00e9ntalo de nuevo.", "TMDB returned unsupported data. Please try again."];
  const timeout = ["TMDB est\u00e1 tardando demasiado. Int\u00e9ntalo de nuevo.", "TMDB is taking too long. Please try again."];
  for (const [index, language] of languages.entries()) {
    for (const [reply, status, messages] of [
      [async () => { throw new DOMException("timeout", "TimeoutError"); }, 504, timeout],
      [async () => { throw new DOMException("aborted", "AbortError"); }, 504, timeout],
      [async () => ({ ok: true, json: async () => { throw new DOMException("timeout", "TimeoutError"); } }), 504, timeout],
      [async () => { throw new TypeError("network failed"); }, 502, [
        "No se pudo conectar con TMDB. Int\u00e9ntalo de nuevo.", "Could not connect to TMDB. Please try again.",
      ]],
      [async () => new Response("<html>unavailable</html>"), 502, invalidData],
      [async () => json(list([], { page: 2 })), 502, invalidData],
      [async () => json(list([null])), 502, invalidData],
    ]) {
      t.mock.method(globalThis, "fetch", reply);
      const response = await worker.fetch(request(`/movies?language=${language}`), env);
      assert.equal(response.status, status);
      assert.deepEqual(await response.json(), { error: messages[index] });
      assert.equal(response.headers.get("Cache-Control"), "no-store");
      t.mock.restoreAll();
    }
    t.mock.method(globalThis, "fetch", async () => json(upstreamMovie({ id: 43 })));
    const response = await worker.fetch(request(`/movies/42?language=${language}`), env);
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: invalidData[index] });
    t.mock.restoreAll();
  }
});

test("adult titles are excluded from lists and unavailable by ID", async (t) => {
  t.mock.method(globalThis, "fetch", async () => json(list([upstreamMovie({ adult: true }), upstreamMovie({ id: 43 })])));
  const data = await (await worker.fetch(request(), env)).json();
  assert.equal(data.results.length, 1);
  assert.equal(data.results[0].tmdbId, 43);
  t.mock.restoreAll();
  t.mock.method(globalThis, "fetch", async () => json(upstreamMovie({ adult: true })));
  for (const language of languages) {
    const response = await worker.fetch(request(`/movies/42?language=${language}`), env);
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), {
      error: language === "es-MX" ? "Esta pel\u00edcula no est\u00e1 disponible en el cat\u00e1logo." : "This movie is not available in the catalog.",
    });
  }
});

test("cached public data does not leak one caller's CORS origin to another", async (t) => {
  const entries = mockCache(t);
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

test("cache entries separate locales and routes, canonicalize equivalent URLs, and bypass legacy Spanish data", async (t) => {
  const entries = mockCache(t, new Map([
    ["https://api.example.com/movies?query=&genre=all&page=1", json(list([{ id: "legacy", title: "Old Spanish title" }]))],
    ["https://api.example.com/movies/771", json({ movie: { id: "legacy", title: "Old Spanish title" } })],
  ]));
  const upstream = t.mock.method(globalThis, "fetch", async (url) => {
    const movie = homeAlone(url.searchParams.get("language"));
    return json(url.pathname === "/3/movie/771" ? movie : list([movie]));
  });
  const pending = [];
  const context = { waitUntil: (promise) => pending.push(promise) };
  const groups = [
    ["es-MX", ["/movies", "/movies?language=es-MX", "/movies?page=1&genre=all&language=es-MX&query=%20"]],
    ["en-US", ["/movies?language=en-US", "/movies?genre=all&query=&page=1&language=en-US"]],
    ["es-MX", ["/movies?query=%20Home%20Alone%20", "/movies?genre=spooky&page=1&language=es-MX&query=Home+Alone"]],
    ["en-US", ["/movies?query=Home+Alone&language=en-US", "/movies?language=en-US&genre=cozy&query=Home%20Alone&page=1"]],
    ["es-MX", ["/movies/771", "/movies/771?language=es-MX"]],
    ["en-US", ["/movies/771?language=en-US", "/movies/771?language=%65n-US"]],
  ];
  for (const [index, [language, paths]] of groups.entries()) {
    for (const path of paths) {
      const response = await worker.fetch(request(path), env, context);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("Cache-Control"), "public, max-age=300");
      const body = await response.json();
      const movie = body.movie ?? body.results[0];
      assert.equal(movie.language, language);
      assert.equal(movie.title, homeAlone(language).title);
      assert.equal(movie.posterPath, homeAlone(language).poster_path);
      assert.equal(movie.id, "tmdb-771");
      await Promise.all(pending);
      assert.equal(upstream.mock.calls.length, index + 1);
    }
  }
  assert.equal(entries.size, 2 + groups.length);
  for (const [key, response] of [...entries].slice(2)) {
    const url = new URL(key);
    assert.ok(url.pathname.startsWith("/__movie_cache/v2/movies"));
    assert.ok(languages.includes(url.searchParams.get("language")));
    const body = await response.clone().json();
    assert.equal((body.movie ?? body.results[0]).language, url.searchParams.get("language"));
    assert.equal(response.headers.has("Access-Control-Allow-Origin"), false);
  }
});
