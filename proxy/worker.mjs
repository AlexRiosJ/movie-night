const TMDB_BASE = "https://api.themoviedb.org/3";
const DEFAULT_LANGUAGE = "es-MX";
const CACHE_VERSION = "v2";
const CHRISTMAS_KEYWORD = 207317;
const MOOD_FILTERS = {
  all: {},
  spooky: { with_genres: "27|9648" },
  cozy: { with_genres: "35|10749|10751" },
  "sci-fi": { with_genres: "878" },
  fantasy: { with_genres: "14" },
  christmas: { with_keywords: String(CHRISTMAS_KEYWORD) },
  general: { without_genres: "27,9648,35,10749,10751,878,14", without_keywords: String(CHRISTMAS_KEYWORD) },
};
const GENRE_NAMES = {
  "es-MX": {
    28: "Acci\u00f3n", 12: "Aventura", 16: "Animaci\u00f3n", 35: "Comedia", 80: "Crimen",
    99: "Documental", 18: "Drama", 10751: "Familia", 14: "Fantas\u00eda", 36: "Historia",
    27: "Terror", 10402: "M\u00fasica", 9648: "Misterio", 10749: "Romance",
    878: "Ciencia ficci\u00f3n", 10770: "Pel\u00edcula de TV", 53: "Suspense", 10752: "B\u00e9lica", 37: "Western",
  },
  "en-US": {
    28: "Action", 12: "Adventure", 16: "Animation", 35: "Comedy", 80: "Crime",
    99: "Documentary", 18: "Drama", 10751: "Family", 14: "Fantasy", 36: "History",
    27: "Horror", 10402: "Music", 9648: "Mystery", 10749: "Romance",
    878: "Science Fiction", 10770: "TV Movie", 53: "Thriller", 10752: "War", 37: "Western",
  },
};
const MESSAGES = {
  "es-MX": {
    invalidUpstream: "TMDB devolvi\u00f3 datos no compatibles. Int\u00e9ntalo de nuevo.",
    unavailableMovie: "Esta pel\u00edcula no est\u00e1 disponible en el cat\u00e1logo.",
    missingSynopsis: "Sin sinopsis disponible.",
    invalidParameters: "Par\u00e1metros de b\u00fasqueda no v\u00e1lidos.",
    invalidSearch: "El t\u00edtulo, universo o n\u00famero de p\u00e1gina no es v\u00e1lido.",
    invalidLanguage: "Idioma no v\u00e1lido. Usa es-MX o en-US una sola vez.",
    unavailableRoute: "Ruta no disponible.",
    timeout: "TMDB est\u00e1 tardando demasiado. Int\u00e9ntalo de nuevo.",
    connectionFailed: "No se pudo conectar con TMDB. Int\u00e9ntalo de nuevo.",
    rateLimited: "TMDB ha recibido demasiadas solicitudes. Espera un momento y vuelve a intentarlo.",
    notFound: "No se encontr\u00f3 la pel\u00edcula en TMDB.",
    invalidCredential: "La credencial TMDB del proxy no es v\u00e1lida. Contacta con quien administra la app.",
    upstreamUnavailable: "TMDB no est\u00e1 disponible en este momento. Int\u00e9ntalo de nuevo.",
    forbiddenOrigin: "Este origen no tiene permiso para consultar el cat\u00e1logo.",
    missingOrigins: "El proxy necesita configurar ALLOWED_ORIGINS.",
    methodNotAllowed: "Solo se permiten consultas GET.",
    missingToken: "El proxy necesita configurar el secreto TMDB_READ_TOKEN.",
  },
  "en-US": {
    invalidUpstream: "TMDB returned unsupported data. Please try again.",
    unavailableMovie: "This movie is not available in the catalog.",
    missingSynopsis: "No synopsis available.",
    invalidParameters: "Invalid search parameters.",
    invalidSearch: "The title, mood, or page number is invalid.",
    invalidLanguage: "Invalid language. Use es-MX or en-US exactly once.",
    unavailableRoute: "Route not available.",
    timeout: "TMDB is taking too long. Please try again.",
    connectionFailed: "Could not connect to TMDB. Please try again.",
    rateLimited: "TMDB has received too many requests. Wait a moment and try again.",
    notFound: "The movie was not found on TMDB.",
    invalidCredential: "The proxy's TMDB credential is invalid. Contact the app administrator.",
    upstreamUnavailable: "TMDB is currently unavailable. Please try again.",
    forbiddenOrigin: "This origin is not allowed to access the catalog.",
    missingOrigins: "The proxy needs ALLOWED_ORIGINS configured.",
    methodNotAllowed: "Only GET requests are allowed.",
    missingToken: "The proxy needs the TMDB_READ_TOKEN secret configured.",
  },
};

class HttpError extends Error {
  constructor(status, messageKey, retryAfter = null) {
    super(MESSAGES[DEFAULT_LANGUAGE][messageKey]);
    this.status = status;
    this.messageKey = messageKey;
    this.retryAfter = retryAfter;
  }
}

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value, max) => typeof value === "string" ? value.trim().slice(0, max) : "";
const positiveId = (value) => Number.isSafeInteger(value) && value > 0;
const invalidUpstream = () => new HttpError(502, "invalidUpstream");
const safePosterPath = (value) => typeof value === "string" && value.trim() === value
  && /^\/[a-zA-Z0-9_-]+\.(jpg|png)$/i.test(value) ? value : null;
const imageLanguage = (value) => typeof value === "string" && value.length === 2 && /^[a-z]{2}$/.test(value);

function optionalArray(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw invalidUpstream();
  return value;
}

function optionalRecord(value) {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) throw invalidUpstream();
  return value;
}

function names(items, limit, length) {
  const unique = new Set();
  for (const item of items) {
    if (!isRecord(item)) throw invalidUpstream();
    const name = text(item.name, length);
    if (name) unique.add(name);
    if (unique.size >= limit) break;
  }
  return [...unique];
}

function localizedPoster(data, language) {
  const posters = optionalArray(optionalRecord(data.images).posters);
  if (posters.some((poster) => !isRecord(poster)
    || (poster.file_path !== undefined && poster.file_path !== null && typeof poster.file_path !== "string")
    || (poster.iso_639_1 !== undefined && poster.iso_639_1 !== null
      && !imageLanguage(poster.iso_639_1)))) {
    throw invalidUpstream();
  }
  const candidates = posters.filter((poster) => safePosterPath(poster.file_path));
  const originalLanguage = imageLanguage(data.original_language) ? data.original_language : null;
  const poster = candidates.find((image) => image.iso_639_1 === language.slice(0, 2))
    ?? candidates.find((image) => image.iso_639_1 === null)
    ?? (originalLanguage ? candidates.find((image) => image.iso_639_1 === originalLanguage) : null);
  return poster?.file_path ?? safePosterPath(data.poster_path);
}

function movieMood(genreIds, keywords) {
  if (keywords.some((keyword) => keyword.id === CHRISTMAS_KEYWORD)) return "christmas";
  if (genreIds.includes(878)) return "sci-fi";
  if (genreIds.includes(14)) return "fantasy";
  if (genreIds.some((id) => [27, 9648].includes(id))) return "spooky";
  if (genreIds.some((id) => [35, 10749, 10751].includes(id))) return "cozy";
  return "general";
}

export function normalizeMovie(data, mood = null, language = DEFAULT_LANGUAGE) {
  if (!isRecord(data) || !positiveId(data.id) || !text(data.title, 300)
    || (data.adult !== undefined && typeof data.adult !== "boolean")) throw invalidUpstream();
  if (data.adult) throw new HttpError(404, "unavailableMovie");
  const genres = optionalArray(data.genres);
  if (genres.some((genre) => !isRecord(genre) || !positiveId(genre.id))) throw invalidUpstream();
  const genreIds = data.genre_ids === undefined ? genres.map((genre) => genre.id) : optionalArray(data.genre_ids);
  if (!genreIds.every(positiveId)) throw invalidUpstream();
  const credits = optionalRecord(data.credits);
  const cast = optionalArray(credits.cast);
  const crew = optionalArray(credits.crew);
  if (crew.some((person) => !isRecord(person))) throw invalidUpstream();
  const keywords = optionalArray(optionalRecord(data.keywords).keywords);
  if (keywords.some((keyword) => !isRecord(keyword) || !positiveId(keyword.id))) throw invalidUpstream();
  const year = typeof data.release_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(data.release_date)
    ? Number(data.release_date.slice(0, 4)) : null;
  const genreNames = genres.length
    ? genres.map((genre) => text(genre.name, 80) || GENRE_NAMES[language][genre.id])
    : genreIds.map((id) => GENRE_NAMES[language][id]);
  return {
    id: `tmdb-${data.id}`,
    tmdbId: data.id,
    language,
    title: text(data.title, 300),
    genre: mood ?? movieMood(genreIds, keywords),
    year: year >= 1888 && year <= 2200 ? year : null,
    minutes: Number.isInteger(data.runtime) && data.runtime > 0 && data.runtime <= 1000 ? data.runtime : null,
    description: text(data.overview, 6000) || MESSAGES[language].missingSynopsis,
    posterPath: safePosterPath(data.poster_path),
    cast: names(cast, 12, 120),
    directors: names(crew.filter((person) => person.job === "Director"), 6, 120),
    genres: [...new Set(genreNames.filter(Boolean))].slice(0, 20),
    originalTitle: text(data.original_title, 300),
    rating: Number.isFinite(data.vote_average) && data.vote_average >= 0 && data.vote_average <= 10
      && data.vote_count > 0 ? data.vote_average : null,
  };
}

function parseRoute(url) {
  const language = url.searchParams.get("language") ?? DEFAULT_LANGUAGE;
  if (!Object.hasOwn(MESSAGES, language) || url.searchParams.getAll("language").length > 1) {
    throw new HttpError(400, "invalidLanguage");
  }
  if (url.pathname === "/movies") {
    const permitted = new Set(["query", "genre", "page", "language"]);
    for (const key of url.searchParams.keys()) {
      if (!permitted.has(key) || url.searchParams.getAll(key).length !== 1) {
        throw new HttpError(400, "invalidParameters");
      }
    }
    const rawQuery = url.searchParams.get("query") ?? "";
    const query = rawQuery.trim();
    const genre = url.searchParams.get("genre") ?? "all";
    const rawPage = url.searchParams.get("page") ?? "1";
    if (rawQuery.length > 120 || /[\u0000-\u001f\u007f]/.test(query)
      || !Object.hasOwn(MOOD_FILTERS, genre) || !/^[1-9]\d{0,2}$/.test(rawPage) || Number(rawPage) > 500) {
      throw new HttpError(400, "invalidSearch");
    }
    return { type: "list", query, genre: query ? "all" : genre, page: Number(rawPage), language };
  }
  const match = /^\/movies\/([1-9]\d*)$/.exec(url.pathname);
  if (match && positiveId(Number(match[1]))
    && [...url.searchParams.keys()].every((key) => key === "language")) {
    return { type: "detail", id: Number(match[1]), language };
  }
  throw new HttpError(404, "unavailableRoute");
}

async function tmdbRequest(route, token) {
  const url = new URL(`${TMDB_BASE}${route.type === "detail" ? `/movie/${route.id}` : route.query ? "/search/movie" : "/discover/movie"}`);
  url.searchParams.set("language", route.language);
  if (route.type === "detail") {
    url.searchParams.set("append_to_response", "credits,keywords,images");
    // TMDB images have language tags, not regional variants such as Latin America.
    url.searchParams.set("include_image_language", `${route.language.slice(0, 2)},null`);
  } else {
    url.searchParams.set("page", route.page);
    url.searchParams.set("include_adult", "false");
    if (route.query) url.searchParams.set("query", route.query);
    else {
      const filters = {
        include_video: "false", sort_by: "popularity.desc", "vote_count.gte": "50",
        "primary_release_date.lte": new Date().toISOString().slice(0, 10), ...MOOD_FILTERS[route.genre],
      };
      for (const [key, value] of Object.entries(filters)) url.searchParams.set(key, value);
    }
  }
  let response;
  try {
    // Workers requires "manual" to avoid forwarding the credential on redirects.
    response = await fetch(url, {
      method: "GET", headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(10000), redirect: "manual",
    });
  } catch (error) {
    if (["TimeoutError", "AbortError"].includes(error.name)) throw new HttpError(504, "timeout");
    if (error instanceof TypeError) throw new HttpError(502, "connectionFailed");
    throw error;
  }
  if (response.status === 429) {
    const retry = response.headers.get("Retry-After");
    throw new HttpError(429, "rateLimited",
      retry && /^\d{1,5}$/.test(retry) ? retry : "30");
  }
  if (response.status === 404) throw new HttpError(404, "notFound");
  if ([401, 403].includes(response.status)) throw new HttpError(502, "invalidCredential");
  if (!response.ok) throw new HttpError(502, "upstreamUnavailable");
  try {
    return await response.json();
  } catch (error) {
    if (["TimeoutError", "AbortError"].includes(error.name)) throw new HttpError(504, "timeout");
    if (error instanceof SyntaxError || error instanceof TypeError) throw invalidUpstream();
    throw error;
  }
}

async function movieResponse(route, token) {
  const data = await tmdbRequest(route, token);
  if (route.type === "detail") {
    if (!isRecord(data) || data.id !== route.id) throw invalidUpstream();
    return { movie: { ...normalizeMovie(data, null, route.language), posterPath: localizedPoster(data, route.language) } };
  }
  if (!isRecord(data) || !Array.isArray(data.results) || data.results.length > 20
    || data.page !== route.page || !Number.isSafeInteger(data.total_pages) || data.total_pages < 0
    || !Number.isSafeInteger(data.total_results) || data.total_results < 0) throw invalidUpstream();
  return {
    page: data.page,
    totalPages: Math.min(data.total_pages, 500),
    totalResults: data.total_results,
    results: data.results.filter((movie) => {
      if (!isRecord(movie)) throw invalidUpstream();
      return movie.adult !== true;
    }).map((movie) => normalizeMovie(movie, route.genre === "all" ? null : route.genre, route.language)),
  };
}

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
  });
}

function withCors(response, origin) {
  const result = new Response(response.body, response);
  result.headers.set("Vary", "Origin");
  result.headers.set("X-Content-Type-Options", "nosniff");
  if (origin) {
    result.headers.set("Access-Control-Allow-Origin", origin);
    result.headers.set("Access-Control-Expose-Headers", "Retry-After");
  }
  return result;
}

export default {
  async fetch(request, env, context) {
    const url = new URL(request.url);
    const languages = url.searchParams.getAll("language");
    const language = languages.length === 1 && Object.hasOwn(MESSAGES, languages[0]) ? languages[0] : DEFAULT_LANGUAGE;
    const origin = request.headers.get("Origin");
    const allowed = typeof env.ALLOWED_ORIGINS === "string" ? env.ALLOWED_ORIGINS.split(",").map((value) => value.trim()).filter(Boolean) : [];
    // Do not reflect arbitrary origins, including the opaque "null" origin of file:// pages.
    const allowedOrigin = origin && origin !== "null" && allowed.includes(origin) ? origin : null;
    if (origin && !allowedOrigin) return withCors(jsonResponse({ error: MESSAGES[language].forbiddenOrigin }, 403), null);
    try {
      if (!allowed.length) throw new HttpError(503, "missingOrigins");
      const route = parseRoute(url);
      if (request.method === "OPTIONS") {
        const requestedMethod = request.headers.get("Access-Control-Request-Method");
        if (requestedMethod && requestedMethod !== "GET") throw new HttpError(405, "methodNotAllowed");
        return withCors(new Response(null, {
          status: 204, headers: {
            "Access-Control-Allow-Methods": "GET, OPTIONS",
            "Access-Control-Allow-Headers": "Accept",
            "Access-Control-Max-Age": "600",
            "Cache-Control": "no-store",
          },
        }), allowedOrigin);
      }
      if (request.method !== "GET") throw new HttpError(405, "methodNotAllowed");
      if (typeof env.TMDB_READ_TOKEN !== "string" || !env.TMDB_READ_TOKEN.trim()) {
        throw new HttpError(503, "missingToken");
      }
      const cacheUrl = new URL(request.url);
      // A new namespace prevents serving pre-localization, untagged cached movies.
      cacheUrl.pathname = `/__movie_cache/${CACHE_VERSION}${url.pathname}`;
      cacheUrl.search = "";
      cacheUrl.searchParams.set("language", route.language);
      if (route.type === "list") {
        cacheUrl.searchParams.set("query", route.query);
        cacheUrl.searchParams.set("genre", route.genre);
        cacheUrl.searchParams.set("page", route.page);
      }
      const cacheKey = new Request(cacheUrl);
      const cache = globalThis.caches?.default;
      const cached = cache ? await cache.match(cacheKey) : null;
      if (cached) return withCors(cached, allowedOrigin);
      const body = await movieResponse(route, env.TMDB_READ_TOKEN.trim());
      const response = jsonResponse(body, 200, { "Cache-Control": "public, max-age=300" });
      // Store only normalized public data; add caller-specific CORS headers after reading the cache.
      if (cache && context?.waitUntil) context.waitUntil(cache.put(cacheKey, response.clone()));
      return withCors(response, allowedOrigin);
    } catch (error) {
      if (!(error instanceof HttpError)) throw error;
      const headers = error.status === 405 ? { Allow: "GET, OPTIONS" } : {};
      if (error.retryAfter) headers["Retry-After"] = error.retryAfter;
      return withCors(jsonResponse({ error: MESSAGES[language][error.messageKey] }, error.status, headers), allowedOrigin);
    }
  },
};
