"use strict";

const STORAGE_KEY = "movie-night:v1";
const THEMES = { movie: "Movie", arcade: "Arcade", zine: "Zine" };
const COLOR_MODES = { light: "Claro", dark: "Oscuro" };
const CATALOG_LANGUAGES = { "es-ES": "Espa\u00f1ol", "en-US": "English" };
const LEGACY_THEMES = ["light", "night", "spooky", "cozy", "sci-fi", "fantasy", "christmas"];
// Category IDs stay compatible with saved collections and the deployed TMDB proxy.
const MOVIE_GENRES = {
  spooky: "Terror y misterio",
  cozy: "Comedia, romance y familia",
  "sci-fi": "Ciencia ficci\u00f3n",
  fantasy: "Fantas\u00eda",
  general: "Otros g\u00e9neros",
};
const ENGLISH_GENRES = {
  spooky: "Horror and mystery", cozy: "Comedy, romance, and family",
  "sci-fi": "Science fiction", fantasy: "Fantasy", general: "Other genres",
};
const FOODS = [
  { id: "pizza", name: "Pizza para compartir", description: "Tu favorita, reci\u00e9n hecha. La \u00faltima porci\u00f3n se negocia." },
  { id: "popcorn", name: "Palomitas de cine", description: "Dulces o saladas. El cl\u00e1sico que nunca falla." },
  { id: "pasta", name: "Un buen plato de pasta", description: "Tu salsa favorita y una noche sin complicaciones." },
  { id: "snacks", name: "Tabla de snacks", description: "Un poco de queso, fruta, galletas y lo que m\u00e1s te guste." },
  { id: "nachos", name: "Nachos con guacamole", description: "Crujientes, para compartir y con extra de guacamole." },
  { id: "burgers", name: "Hamburguesas caseras", description: "Unas patatas al lado y ya tenemos un plan redondo." },
  { id: "hot-chocolate", name: "Chocolate y galletas", description: "Chocolate caliente y galletas para compartir." },
  { id: "sandwiches", name: "S\u00e1ndwiches a la plancha", description: "Pan crujiente, queso fundido y comodidad en cada bocado." },
];
const ENGLISH_FOODS = {
  pizza: ["Pizza to share", "Your favorite, fresh from the oven. The last slice is negotiable."],
  popcorn: ["Movie popcorn", "Sweet or salty. A classic that never fails."],
  pasta: ["A good plate of pasta", "Your favorite sauce and an easy night in."],
  snacks: ["Snack board", "Some cheese, fruit, crackers, and whatever you love."],
  nachos: ["Nachos with guacamole", "Crunchy, made for sharing, with extra guacamole."],
  burgers: ["Homemade burgers", "Add some fries and the plan is complete."],
  "hot-chocolate": ["Hot chocolate and cookies", "Hot chocolate and cookies to share."],
  sandwiches: ["Grilled sandwiches", "Crispy bread, melted cheese, and comfort in every bite."],
};
const CUSTOM_MOVIE_DESCRIPTIONS = [
  "Una de tus elegidas. El mejor motivo para reservar una noche de pel\u00edcula.",
  "One of your picks. The best reason to set aside a movie night.",
];

function genreName(genre) {
  return t(MOVIE_GENRES[genre], ENGLISH_GENRES[genre]);
}

const $ = (id) => document.getElementById(id);
let storageWritable = true;
let toastTimer;
let storageMessages;
let toastMessages;
const api = readApiConfig();
const catalog = { query: "", genre: "all", language: "es-ES", page: 1, totalPages: 0, results: [], loaded: false, loading: false, error: "" };
let catalogController;
let selectionController;
let selectionRetry;
let previewMovie = null;
let pickerMessage = "";
let failedPosterPath = null;
let renderedCastKey;
const localizedMovies = new Map();
let localizationController;
let localizationPromise;
let localizationContext = "";
let localizationMessage = "";
const localizationFailures = new Map();

function readApiConfig() {
  const base = window.MOVIE_NIGHT_CONFIG?.apiBaseUrl;
  if (!base) return { baseUrl: "", error: "" };
  try {
    const url = new URL(base);
    const local = ["localhost", "127.0.0.1"].includes(url.hostname);
    if ((url.protocol !== "https:" && !(local && url.protocol === "http:"))
      || url.username || url.password || url.search || url.hash) throw new TypeError("Invalid API URL");
    return { baseUrl: url.href.replace(/\/+$/, ""), error: "" };
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    return { baseUrl: "", error: [
      "La URL del proxy en config.js no es v\u00e1lida. Usa HTTPS (o HTTP en localhost).",
      "The proxy URL in config.js is invalid. Use HTTPS (or HTTP on localhost).",
    ] };
  }
}

function localToday() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function freshState() {
  return {
    version: 1,
    movies: [],
    plans: [],
    theme: "movie",
    colorMode: "light",
    draft: { movieId: null, foodId: null, date: localToday(), place: "" },
    preferences: { genre: "all", language: "es-ES", pendingOnly: true, autoFood: true, movieTab: "pending", planTab: "scheduled", view: "catalog" },
  };
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isText(value, maxLength) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength;
}

// Parse date-only values at local noon, not UTC midnight, to avoid changing the day.
function isValidDate(value) {
  if (typeof value !== "string" || !/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00`);
  return !Number.isNaN(date.getTime())
    && date.getFullYear() === Number(value.slice(0, 4))
    && date.getMonth() + 1 === Number(value.slice(5, 7))
    && date.getDate() === Number(value.slice(8, 10));
}

function isGenre(value) {
  return typeof value === "string" && Object.hasOwn(MOVIE_GENRES, value);
}

function normalizeMovieGenre(movie) {
  return movie.genre === "christmas" ? { ...movie, genre: "general" } : movie;
}

function isStringList(value, count, length) {
  return Array.isArray(value) && value.length <= count && value.every((item) => isText(item, length));
}

function isImagePath(value) {
  return value === null || (typeof value === "string" && /^\/[a-zA-Z0-9_-]+\.(jpg|png)$/i.test(value));
}

function isMovieData(movie) {
  return isRecord(movie) && isText(movie.id, 100) && isText(movie.title, 300)
    && (isGenre(movie.genre) || movie.genre === "christmas")
    && (movie.year === null || (Number.isInteger(movie.year) && movie.year >= 1888 && movie.year <= 2200))
    && (movie.minutes === null || (Number.isInteger(movie.minutes) && movie.minutes > 0 && movie.minutes <= 1000))
    && isText(movie.description, 6000);
}

function isTmdbData(movie) {
  return isMovieData(movie) && Number.isSafeInteger(movie.tmdbId) && movie.tmdbId > 0
    && (movie.language === undefined || isCatalogLanguage(movie.language))
    && isImagePath(movie.posterPath) && isStringList(movie.cast, 12, 120)
    && (movie.castProfiles === undefined || (Array.isArray(movie.castProfiles) && movie.castProfiles.length <= 12
      && movie.castProfiles.every((person) => isRecord(person) && isText(person.name, 120) && isImagePath(person.profilePath))))
    && isStringList(movie.directors, 6, 120) && isStringList(movie.genres, 20, 80)
    && typeof movie.originalTitle === "string" && movie.originalTitle.length <= 300
    && (movie.voteCount === undefined || movie.voteCount === null || (Number.isSafeInteger(movie.voteCount) && movie.voteCount >= 0))
    && (movie.rating === null || (Number.isFinite(movie.rating) && movie.rating >= 0 && movie.rating <= 10));
}

// Validate stored data and references before rendering. Damaged data is never overwritten.
function isValidState(value) {
  if (!isRecord(value) || value.version !== 1 || typeof value.theme !== "string"
    || !(Object.hasOwn(THEMES, value.theme) || LEGACY_THEMES.includes(value.theme))
    || (value.colorMode !== undefined && (typeof value.colorMode !== "string" || !Object.hasOwn(COLOR_MODES, value.colorMode)))
    || !Array.isArray(value.movies) || !Array.isArray(value.plans)
    || !isRecord(value.draft) || !isRecord(value.preferences)) return false;

  const validMovies = value.movies.every((movie) => isMovieData(movie)
    && typeof movie.watched === "boolean" && typeof movie.custom === "boolean"
    && (movie.tmdbId === undefined || isTmdbData(movie)));
  if (!validMovies) return false;

  const movieIds = new Set(value.movies.map((movie) => movie.id));
  if (movieIds.size !== value.movies.length) return false;
  const tmdbIds = value.movies.filter((movie) => movie.tmdbId !== undefined).map((movie) => movie.tmdbId);
  if (new Set(tmdbIds).size !== tmdbIds.length) return false;
  const foodExists = (id) => FOODS.some((food) => food.id === id);
  const validPlans = value.plans.every((plan) => isRecord(plan)
    && isText(plan.id, 100) && movieIds.has(plan.movieId) && foodExists(plan.foodId)
    && isValidDate(plan.date) && isText(plan.place, 120) && typeof plan.completed === "boolean");
  if (!validPlans || new Set(value.plans.map((plan) => plan.id)).size !== value.plans.length) return false;

  const { draft, preferences } = value;
  return (draft.movieId === null || movieIds.has(draft.movieId))
    && (draft.foodId === null || foodExists(draft.foodId))
    && (draft.date === "" || isValidDate(draft.date))
    && typeof draft.place === "string" && draft.place.length <= 120
    && (preferences.genre === "all" || isGenre(preferences.genre) || preferences.genre === "christmas")
    && (preferences.language === undefined || isCatalogLanguage(preferences.language))
    && typeof preferences.pendingOnly === "boolean" && typeof preferences.autoFood === "boolean"
    && ["pending", "watched"].includes(preferences.movieTab)
    && ["scheduled", "completed"].includes(preferences.planTab)
    && (preferences.view === undefined || ["plans", "movies", "catalog"].includes(preferences.view))
    && (preferences.source === undefined || ["catalog", "collection"].includes(preferences.source));
}

function storageWarning(message, error) {
  storageMessages = message;
  $("storage-notice").textContent = localizedText(message);
  $("storage-notice").hidden = false;
  if (error) console.error("Movie Night: localStorage", error);
}

function decodeState(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    storageWritable = false;
    storageWarning(["No se pudieron leer tus datos guardados. Para no sobrescribirlos, los cambios de esta sesi\u00f3n no se guardar\u00e1n.",
      "Your saved data could not be read. To avoid overwriting it, changes in this session will not be saved."], error);
    return null;
  }
  if (!isValidState(parsed)) {
    storageWritable = false;
    storageWarning(["Tus datos guardados tienen un formato no compatible. Se han conservado intactos; los cambios de esta sesi\u00f3n no se guardar\u00e1n.",
      "Your saved data has an unsupported format. It has been kept intact; changes in this session will not be saved."]);
    return null;
  }
  return migrateStoredState(parsed);
}

// Personal and party preferences share the same migration after validation.
function migrateStoredState(value) {
  if (value.colorMode === undefined) {
    value.colorMode = ["night", "movie", "arcade"].includes(value.theme) ? "dark" : "light";
  }
  if (LEGACY_THEMES.includes(value.theme)) value.theme = "movie";
  value.movies = value.movies.map(normalizeMovieGenre);
  if (value.preferences.genre === "christmas") value.preferences.genre = "all";
  value.preferences.language ??= "es-ES";
  return value;
}

function loadState() {
  let raw;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch (error) {
    storageWarning(["Este navegador no permite leer el almacenamiento local. Tus cambios podr\u00edan perderse al cerrar la p\u00e1gina.",
      "This browser does not allow access to local storage. Your changes may be lost when you close the page."], error);
    return freshState();
  }
  return raw === null ? freshState() : (decodeState(raw) ?? freshState());
}

let state = loadState();

function persistState() {
  if (party.session) return party.loading ? false : persistPartyView();
  if (!storageWritable) return false;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    storageWarning(["No se pudieron guardar los cambios en este navegador. Por ahora solo est\u00e1n en esta pesta\u00f1a. Revisa el espacio o los permisos de almacenamiento.",
      "Changes could not be saved in this browser. For now they are only in this tab. Check storage space or permissions."], error);
    return false;
  }
  $("storage-notice").hidden = true;
  return true;
}

function notify(message) {
  clearTimeout(toastTimer);
  toastMessages = message;
  $("toast").textContent = localizedText(message);
  $("toast").hidden = false;
  toastTimer = setTimeout(() => { $("toast").hidden = true; }, 4800);
}

function movieById(id) {
  return state.movies.find((movie) => movie.id === id);
}

function foodById(id) {
  const food = FOODS.find((food) => food.id === id);
  if (!food) return food;
  const [name, description] = ENGLISH_FOODS[id];
  return { ...food, name: t(food.name, name), description: t(food.description, description) };
}

function candidates() {
  return state.movies.filter((movie) =>
    (state.preferences.genre === "all" || movie.genre === state.preferences.genre)
    && (!state.preferences.pendingOnly || !movie.watched));
}

function movieSource() {
  return state.preferences.source ?? (api.baseUrl ? "catalog" : "collection");
}

function isCatalogLanguage(value) {
  return typeof value === "string" && Object.hasOwn(CATALOG_LANGUAGES, value);
}

function catalogLanguage() {
  return state.preferences.language ?? "es-ES";
}

// Alternate metadata is a local presentation, never a write to another member's movie.
function moviePresentation(movie) {
  if (movie?.custom && !movie.tmdbId && CUSTOM_MOVIE_DESCRIPTIONS.includes(movie.description)) {
    return { ...movie, description: t(...CUSTOM_MOVIE_DESCRIPTIONS) };
  }
  if (!movie?.tmdbId || (movie.language ?? "es-ES") === catalogLanguage()) return movie;
  const localized = localizedMovies.get(`${movie.tmdbId}:${catalogLanguage()}`);
  if (!localized) return movie;
  const { title, description, posterPath, genres, language } = localized;
  return { ...movie, title, description, posterPath, genres, language };
}

function syncCatalogLanguage() {
  $("catalog-language").value = catalogLanguage();
  if (catalog.language === catalogLanguage()) return;
  cancelSelection({ preserveMessage: true });
  catalogController?.abort();
  catalogController = null;
  Object.assign(catalog, { language: catalogLanguage(), page: 1, totalPages: 0,
    results: [], loaded: false, loading: false });
}

function syncLocalizationContext() {
  const context = `${party.epoch}:${party.session?.partyId ?? "personal"}:${catalogLanguage()}`;
  if (context !== localizationContext) {
    localizationController?.abort();
    localizationController = null;
    localizationPromise = null;
    localizationFailures.clear();
    localizationMessage = "";
    localizationContext = context;
  }
  return context;
}

function renderLanguageStatus() {
  const status = $("language-status");
  status.hidden = !localizationMessage;
  status.textContent = localizedText(localizationMessage);
  $("language-retry").hidden = !localizationFailures.size || Boolean(localizationController);
}

// Refresh the preview as well as saved collections and plans.
async function refreshSelectedLanguage({ retry = false } = {}) {
  const context = syncLocalizationContext();
  if (localizationController) {
    await localizationPromise;
    if (context !== localizationContext) return;
    return refreshSelectedLanguage({ retry });
  }
  if (retry) localizationFailures.clear();
  const language = catalogLanguage();
  const movies = previewMovie ? [previewMovie, ...state.movies.filter((movie) => movie.tmdbId !== previewMovie.tmdbId)] : state.movies;
  const missing = movies.filter((movie) => movie.tmdbId
    && (moviePresentation(movie).language ?? "es-ES") !== language);
  const missingIds = new Set(missing.map((movie) => movie.tmdbId));
  for (const id of localizationFailures.keys()) {
    if (!missingIds.has(id)) localizationFailures.delete(id);
  }
  const pending = missing.filter((movie) => !localizationFailures.has(movie.tmdbId))
    .sort((a, b) => Number(b.id === state.draft.movieId) - Number(a.id === state.draft.movieId));
  const showFailures = () => {
    if (localizationFailures.size) {
      const error = localizationFailures.values().next().value;
      localizationMessage = [
        `No se pudieron actualizar todas las traducciones. Se conservan los datos disponibles. ${error.messages[0]}`,
        `Not all translations could be updated. Available details have been kept. ${error.messages[1]}`,
      ];
    } else localizationMessage = "";
    renderLanguageStatus();
  };
  if (!pending.length) { showFailures(); return; }
  if (!api.baseUrl) {
    const error = new MovieApiError(
      "Conecta el proxy para traducir las pel\u00edculas guardadas.",
      "Connect the proxy to translate saved movies.");
    pending.forEach((movie) => localizationFailures.set(movie.tmdbId, error));
    showFailures();
    return;
  }
  const controller = new AbortController();
  localizationController = controller;
  localizationMessage = ["Actualizando t\u00edtulos y p\u00f3sters de tu colecci\u00f3n\u2026",
    "Updating titles and posters in your collection\u2026"];
  renderLanguageStatus();
  const current = () => !controller.signal.aborted && context === syncLocalizationContext();
  let index = 0;
  const translateNext = async () => {
    while (index < pending.length && current()) {
      const movie = pending[index++];
      try {
        const details = await fetchMovieDetails(movie.tmdbId, controller.signal, language);
        if (!current()) return;
        if (movieById(movie.id)?.tmdbId === movie.tmdbId || previewMovie?.tmdbId === movie.tmdbId) {
          localizedMovies.set(`${details.tmdbId}:${language}`, details);
          preserveRenderedFocus(() => {
            renderPicker();
            renderMovies();
            renderPlans();
          });
        }
      } catch (error) {
        if (!current()) return;
        if (movieById(movie.id)?.tmdbId === movie.tmdbId || previewMovie?.tmdbId === movie.tmdbId) {
          localizationFailures.set(movie.tmdbId, apiErrorMessage(error));
        }
      }
    }
  };
  localizationPromise = Promise.all(Array.from({ length: Math.min(3, pending.length) }, translateNext));
  await localizationPromise;
  if (!current()) return;
  localizationController = null;
  localizationPromise = null;
  showFailures();
}

function changeCatalogLanguage(language) {
  if (!isCatalogLanguage(language)) {
    $("catalog-language").value = catalogLanguage();
    notify(["Elige un idioma v\u00e1lido para la app.", "Choose a valid app language."]);
    return;
  }
  if (sharedBusy()) {
    $("catalog-language").value = catalogLanguage();
    notify(["Espera a que termine la operaci\u00f3n de la party.", "Wait for the party operation to finish."]);
    return;
  }
  if (language === catalogLanguage()) return;
  state.preferences.language = language;
  persistState();
  renderAll({ preserveFormValues: true });
  return refreshSelectedLanguage();
}

class MovieApiError extends LocalizedError {}

async function apiRequest(path, params, signal, language = catalogLanguage()) {
  signal?.throwIfAborted();
  if (!api.baseUrl) throw new MovieApiError("Configura la URL del proxy para conectar el cat\u00e1logo TMDB.",
    "Configure the proxy URL to connect to the TMDB catalog.");
  const url = new URL(`${api.baseUrl}${path}`);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, String(value)));
  url.searchParams.set("language", language);
  let response;
  try {
    response = await fetch(url, {
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
      credentials: "omit",
      referrerPolicy: "no-referrer",
      headers: { Accept: "application/json" },
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    if (error.name === "TimeoutError") throw new MovieApiError("TMDB est\u00e1 tardando demasiado. Vuelve a intentarlo.", "TMDB is taking too long. Try again.");
    if (error instanceof TypeError) throw new MovieApiError("No se pudo conectar con el cat\u00e1logo. Revisa la conexi\u00f3n y la configuraci\u00f3n del proxy.",
      "Could not connect to the catalog. Check your connection and proxy configuration.");
    throw error;
  }
  let data;
  try {
    data = await response.json();
  } catch (error) {
    if (signal?.aborted) throw error;
    if (["TimeoutError", "AbortError"].includes(error.name)) throw new MovieApiError("TMDB est\u00e1 tardando demasiado. Vuelve a intentarlo.", "TMDB is taking too long. Try again.");
    if (error instanceof TypeError) throw new MovieApiError("Se interrumpi\u00f3 la descarga de la ficha. Vuelve a intentarlo.", "The movie download was interrupted. Try again.");
    if (!(error instanceof SyntaxError)) throw error;
    throw new MovieApiError("El proxy no devolvi\u00f3 datos v\u00e1lidos. Revisa su URL y vuelve a intentarlo.", "The proxy returned invalid data. Check its URL and try again.");
  }
  if (!response.ok) {
    if (isRecord(data) && isText(data.error, 500)) throw new MovieApiError(data.error);
    throw new MovieApiError(`No se pudo consultar TMDB (HTTP ${response.status}). Int\u00e9ntalo de nuevo.`,
      `Could not query TMDB (HTTP ${response.status}). Try again.`);
  }
  return data;
}

async function fetchCatalogPage(query, genre, page, signal, language = catalogLanguage()) {
  const data = await apiRequest("/movies", { query, genre, page }, signal, language);
  if (!isRecord(data) || data.page !== page || !Number.isInteger(data.totalPages)
    || data.totalPages < 0 || data.totalPages > 500 || !Number.isInteger(data.totalResults) || data.totalResults < 0
    || !Array.isArray(data.results) || data.results.length > 20
    || !data.results.every((movie) => isTmdbData(movie) && movie.id === `tmdb-${movie.tmdbId}`
      && (movie.language ?? "es-ES") === language)) {
    throw new MovieApiError("El cat\u00e1logo devolvi\u00f3 un formato no compatible.", "The catalog returned an incompatible format.");
  }
  return { ...data, results: data.results.map(normalizeMovieGenre) };
}

async function fetchMovieDetails(tmdbId, signal, language = catalogLanguage()) {
  const data = await apiRequest(`/movies/${tmdbId}`, {}, signal, language);
  if (!isRecord(data) || !isTmdbData(data.movie) || data.movie.tmdbId !== tmdbId
    || (data.movie.language !== undefined && data.movie.language !== language)
    || data.movie.id !== `tmdb-${tmdbId}`) throw new MovieApiError("No se pudo leer la ficha de esta pel\u00edcula.", "Could not read this movie's details.");
  if (data.movie.language === undefined && language !== "es-ES") {
    throw new MovieApiError("El proxy no confirm\u00f3 el idioma de la ficha. Actual\u00edzalo para habilitar las traducciones.",
      "The proxy did not confirm the movie language. Update it to enable translations.");
  }
  return { ...normalizeMovieGenre(data.movie), language };
}

function apiErrorMessage(error) {
  if (error instanceof LocalizedError) return error;
  console.error("Movie Night: catalog", error);
  return new MovieApiError("No se pudo cargar la pel\u00edcula. Int\u00e9ntalo de nuevo.", "Could not load the movie. Try again.");
}

async function loadCatalog(page = 1) {
  catalogController?.abort();
  const controller = new AbortController();
  catalogController = controller;
  Object.assign(catalog, { page, loading: true, loaded: true, error: "", results: [], totalPages: 0 });
  renderCatalog();
  try {
    const data = await fetchCatalogPage(catalog.query, catalog.genre, page, controller.signal);
    if (controller.signal.aborted) return;
    Object.assign(catalog, data);
  } catch (error) {
    if (controller.signal.aborted) return;
    catalog.error = apiErrorMessage(error);
  } finally {
    if (catalogController === controller) {
      catalog.loading = false;
      renderCatalog();
    }
  }
}

function renderCatalog() {
  const configured = Boolean(api.baseUrl);
  $("catalog-search").disabled = !configured;
  $("catalog-list").setAttribute("aria-busy", String(catalog.loading));
  $("catalog-status").textContent = !configured ? (api.error ? localizedText(api.error)
    : t("Conecta el proxy TMDB para explorar pel\u00edculas. Consulta el aviso de configuraci\u00f3n.",
      "Connect the TMDB proxy to explore movies. See the setup notice."))
    : catalog.loading ? t("Buscando pel\u00edculas en TMDB\u2026", "Searching TMDB for movies\u2026")
    : catalog.error ? localizedText(catalog.error)
    : catalog.results.length ? t(`${catalog.totalResults.toLocaleString(activeLanguage)} resultados en TMDB.`,
      `${catalog.totalResults.toLocaleString(activeLanguage)} results on TMDB.`)
    : catalog.loaded ? t("No encontramos pel\u00edculas. Prueba otro t\u00edtulo o g\u00e9nero.", "No movies found. Try another title or genre.")
      : t("Busca un t\u00edtulo o descubre pel\u00edculas populares.", "Search for a title or discover popular movies.");
  $("catalog-retry").hidden = !catalog.error || catalog.loading || !configured;
  const fragment = document.createDocumentFragment();
  catalog.results.forEach((movie) => {
    const row = $("catalog-row-template").content.firstElementChild.cloneNode(true);
    translateInterface(row);
    row.querySelector(".catalog-title").textContent = movie.title;
    row.querySelector(".catalog-title").lang = movie.language ?? catalogLanguage();
    row.querySelector(".catalog-meta").textContent = [movie.year ?? t("A\u00f1o no disponible", "Year unavailable"), genreName(movie.genre)].join(" \u00b7 ");
    row.querySelector(".catalog-description").textContent = movie.description;
    row.querySelector(".catalog-description").lang = movie.language ?? catalogLanguage();
    const poster = row.querySelector(".catalog-poster");
    poster.alt = t(`P\u00f3ster de ${movie.title}`, `Poster for ${movie.title}`);
    if (movie.posterPath) {
      poster.src = `https://image.tmdb.org/t/p/w185${movie.posterPath}`;
      poster.hidden = false;
      poster.addEventListener("error", () => { poster.hidden = true; }, { once: true });
    }
    const choose = row.querySelector(".choose-catalog-movie");
    const existing = savedApiMovie(movie);
    choose.dataset.tmdbId = movie.tmdbId;
    choose.textContent = existing ? t("Elegir de mi colecci\u00f3n", "Choose from my collection") : t("Elegir y guardar", "Choose and save");
    const title = `${movie.title}${movie.year ? ` (${movie.year})` : ""}`;
    choose.setAttribute("aria-label", t(`Elegir ${title} para mi plan`, `Choose ${title} for my plan`));
    fragment.append(row);
  });
  $("catalog-list").replaceChildren(fragment);
  $("catalog-pagination").hidden = catalog.loading || Boolean(catalog.error) || catalog.totalPages < 2;
  $("catalog-previous").disabled = catalog.page <= 1 || catalog.loading;
  $("catalog-next").disabled = catalog.page >= catalog.totalPages || catalog.loading;
  $("catalog-page").textContent = t(`P\u00e1gina ${catalog.page.toLocaleString(activeLanguage)} de ${catalog.totalPages.toLocaleString(activeLanguage)}`,
    `Page ${catalog.page.toLocaleString(activeLanguage)} of ${catalog.totalPages.toLocaleString(activeLanguage)}`);
}

// Match legacy entries only when title AND release year agree; IDs keep existing plans intact.
function savedApiMovie(movie) {
  return state.movies.find((saved) => saved.tmdbId === movie.tmdbId)
    ?? state.movies.find((saved) => !saved.tmdbId && movie.year !== null && saved.year === movie.year
      && normalizedTitle(saved.title) === normalizedTitle(movie.title));
}

function saveApiMovie(movie, genre) {
  const existing = savedApiMovie(movie);
  if (existing) {
    const { id, watched, genre: savedGenre } = existing;
    Object.assign(existing, movie, { id, watched, genre: savedGenre, custom: false });
    return existing;
  }
  const saved = { ...movie, genre: genre ?? movie.genre, watched: false, custom: false };
  state.movies.push(saved);
  return saved;
}

function cancelSelection({ preserveMessage = false } = {}) {
  const wasLoading = Boolean(selectionController);
  selectionController?.abort();
  selectionController = null;
  if (!preserveMessage || wasLoading) {
    selectionRetry = null;
    pickerMessage = "";
  }
}

async function selectFromApi(loadMovie, retry, { genre = null, forceFood = false, focus = false, previewOnly = false, chooseFood = true } = {}) {
  if (sharedBusy()) {
    notify(["Espera a que termine la operaci\u00f3n de la party.", "Wait for the party operation to finish."]);
    return;
  }
  cancelSelection();
  const controller = new AbortController();
  selectionController = controller;
  pickerMessage = ["Cargando la ficha de la pel\u00edcula\u2026", "Loading movie details\u2026"];
  renderPicker();
  if (focus) $("planner").scrollIntoView({ block: "start" });
  let movie;
  let savedMovie;
  try {
    movie = await loadMovie(controller.signal);
    if (controller.signal.aborted) return;
    if (previewOnly) {
      savedMovie = savedApiMovie(movie);
    } else if (party.session) {
      const snapshot = await writeParty("/movies", "POST", {
        movie: { ...movie, genre: genre ?? movie.genre, watched: false, custom: false },
      });
      if (controller.signal.aborted) return;
      if (!snapshot) {
        selectionController = null;
        pickerMessage = ["No se pudo confirmar que la pel\u00edcula se guard\u00f3 en la party. Actualiza la lista antes de reintentar.",
          "Could not confirm that the movie was saved to the party. Refresh the list before retrying."];
        selectionRetry = retry;
        renderPicker();
        return;
      }
      savedMovie = state.movies.find((saved) => saved.tmdbId === movie.tmdbId);
      if (!savedMovie) throw new PartyApiError("La pel\u00edcula no apareci\u00f3 en la lista compartida. Actualiza la party.",
        "The movie did not appear in the shared list. Refresh the party.");
    } else savedMovie = saveApiMovie(movie, genre);
  } catch (error) {
    if (controller.signal.aborted) return;
    selectionController = null;
    pickerMessage = apiErrorMessage(error);
    selectionRetry = retry;
    renderPicker();
    return;
  }
  selectionController = null;
  pickerMessage = "";
  localizedMovies.set(`${movie.tmdbId}:${movie.language}`, movie);
  previewMovie = previewOnly ? { ...movie, genre: savedMovie?.genre ?? genre ?? movie.genre, watched: savedMovie?.watched ?? false } : null;
  state.draft.movieId = savedMovie?.id ?? null;
  if (chooseFood && (forceFood || state.preferences.autoFood)) state.draft.foodId = pickRandom(FOODS, state.draft.foodId).id;
  const saved = persistState();
  renderPicker();
  renderMovies();
  renderPlans();
  renderCatalog();
  if (focus) {
    $("planner").scrollIntoView({ block: "start" });
    $("movie-title").focus({ preventScroll: true });
  }
  if (previewOnly) {
    notify([`${movie.title}: vista previa, sin a\u00f1adir a la lista.`, `${movie.title}: preview, not added to the list.`]);
    return;
  }
  const title = moviePresentation(savedMovie).title;
  notify(saved || party.session ? [`${title}: lista para tu pr\u00f3ximo plan.`, `${title}: ready for your next plan.`]
    : ["Pel\u00edcula elegida solo para esta sesi\u00f3n.", "Movie selected for this session only."]);
}

function addPreviewMovie() {
  if (!previewMovie || selectionController || sharedBusy()) return;
  const movie = moviePresentation(previewMovie);
  return selectFromApi(async () => movie, addPreviewMovie, { genre: movie.genre, chooseFood: false });
}

function chooseCatalogMovie(movie) {
  if (sharedBusy()) {
    notify(["Espera a que termine la operaci\u00f3n de la party.", "Wait for the party operation to finish."]);
    return;
  }
  const existing = savedApiMovie(movie);
  if (existing?.tmdbId && existing.castProfiles !== undefined
    && (moviePresentation(existing).language ?? "es-ES") === catalogLanguage()) {
    selectMovie(existing.id);
    return;
  }
  const genre = !catalog.query && catalog.genre !== "all" ? catalog.genre : null;
  return selectFromApi((signal) => fetchMovieDetails(movie.tmdbId, signal),
    () => chooseCatalogMovie(movie), { genre, focus: true });
}

async function randomApiMovie(signal) {
  const { genre, pendingOnly } = state.preferences;
  const firstPage = await fetchCatalogPage("", genre, 1, signal);
  const remainingPages = Array.from({ length: firstPage.totalPages }, (_, index) => index + 1);
  const previous = previewMovie ?? movieById(state.draft.movieId);
  // Sample different pages, not just the first popular results. Bound retries for watched-heavy collections.
  for (let attempt = 0; attempt < 5 && remainingPages.length; attempt += 1) {
    const index = Math.floor(Math.random() * remainingPages.length);
    const [page] = remainingPages.splice(index, 1);
    const data = page === 1 ? firstPage : await fetchCatalogPage("", genre, page, signal);
    const options = data.results.filter((movie) => {
      const saved = savedApiMovie(movie);
      return (!pendingOnly || !saved?.watched)
        && (!previous || (movie.tmdbId !== previous.tmdbId && saved?.id !== previous.id));
    });
    const movie = pickRandom(options, null);
    if (movie) return fetchMovieDetails(movie.tmdbId, signal);
  }
  throw new MovieApiError("No encontramos otra pel\u00edcula en las p\u00e1ginas consultadas. Reintenta, cambia de g\u00e9nero o desactiva Solo pendientes.",
    "No other movie was found on the pages checked. Retry, change genre, or turn off Pending only.");
}

// Avoid immediate repeats when at least two choices exist; a single choice remains valid.
function pickRandom(items, previousId) {
  const pool = items.length > 1 ? items.filter((item) => item.id !== previousId) : items;
  return pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
}

function randomMovie(forceFood = false) {
  if (movieSource() === "catalog") {
    return selectFromApi(randomApiMovie, () => randomMovie(forceFood), {
      genre: state.preferences.genre === "all" ? null : state.preferences.genre, forceFood, previewOnly: true,
    });
  }
  cancelSelection();
  const movie = pickRandom(candidates(), state.draft.movieId);
  if (!movie) {
    notify(["No hay pel\u00edculas con estos filtros. Cambia de g\u00e9nero, incluye las vistas o a\u00f1ade una nueva.",
      "No movies match these filters. Change genre, include watched movies, or add a new one."]);
    return null;
  }
  previewMovie = null;
  state.draft.movieId = movie.id;
  if (forceFood || state.preferences.autoFood) {
    state.draft.foodId = pickRandom(FOODS, state.draft.foodId).id;
  }
  persistState();
  renderPicker();
  return movie;
}

function randomFood() {
  const food = pickRandom(FOODS, state.draft.foodId);
  state.draft.foodId = food.id;
  persistState();
  renderPicker();
  return food;
}

function selectMovie(id) {
  if (party.loading || party.entering) {
    notify(["Espera a que termine de cargar la party.", "Wait for the party to finish loading."]);
    return;
  }
  cancelSelection();
  const movie = movieById(id);
  if (!movie) {
    notify(["No se encontr\u00f3 esa pel\u00edcula. Vuelve a elegir una de tu colecci\u00f3n.", "That movie was not found. Choose another from your collection."]);
    return;
  }
  previewMovie = null;
  state.draft.movieId = id;
  if (state.preferences.autoFood) state.draft.foodId = pickRandom(FOODS, state.draft.foodId).id;
  persistState();
  renderPicker();
  $("planner").scrollIntoView({ block: "start" });
  $("movie-title").focus({ preventScroll: true });
  const title = moviePresentation(movie).title;
  notify([`${title}: lista para tu pr\u00f3ximo plan.`, `${title}: ready for your next plan.`]);
}

function renderCast(movie) {
  const cast = movie?.cast ?? [];
  const key = JSON.stringify([movie?.id, cast, movie?.castProfiles]);
  // Keep in-flight images and horizontal scroll intact when only picker status or food changes.
  if (key === renderedCastKey) return;
  renderedCastKey = key;
  const fragment = document.createDocumentFragment();
  cast.forEach((name) => {
    const row = $("cast-member-template").content.firstElementChild.cloneNode(true);
    translateInterface(row);
    row.querySelector(".cast-name").textContent = name;
    const profilePath = movie.castProfiles?.find((person) => person.name === name)?.profilePath;
    const photo = row.querySelector(".cast-photo");
    const placeholder = row.querySelector(".cast-placeholder");
    const showPhoto = Boolean(profilePath);
    photo.hidden = !showPhoto;
    placeholder.hidden = showPhoto;
    if (showPhoto) {
      photo.addEventListener("error", () => {
        photo.hidden = true;
        placeholder.hidden = false;
      }, { once: true });
      photo.src = `https://image.tmdb.org/t/p/w185${profilePath}`;
    }
    fragment.append(row);
  });
  $("movie-cast").replaceChildren(fragment);
  $("movie-cast").hidden = cast.length === 0;
  $("movie-cast-empty").hidden = cast.length > 0;
}

function renderPicker() {
  const savedMovie = movieById(state.draft.movieId);
  const movie = moviePresentation(previewMovie ?? savedMovie);
  const food = foodById(state.draft.foodId);
  const count = candidates().length;
  const online = movieSource() === "catalog";
  const busy = Boolean(selectionController) || sharedBusy();
  $("catalog-language").disabled = sharedBusy();
  $("movie-badge").textContent = movie ? genreName(movie.genre).toLocaleUpperCase(activeLanguage) : t("POR DESCUBRIR", "YET TO DISCOVER");
  $("movie-title").textContent = movie ? movie.title : t("Tu pr\u00f3xima favorita te espera.", "Your next favorite is waiting.");
  $("movie-title").lang = movie?.tmdbId ? (movie.language ?? "es-ES") : activeLanguage;
  $("movie-meta").textContent = movie
    ? [movie.year ?? t("A\u00f1o no disponible", "Year unavailable"),
      movie.minutes ? `${movie.minutes.toLocaleString(activeLanguage)} min` : t("Duraci\u00f3n no disponible", "Runtime unavailable"),
      movie.addedByName ? t(`A\u00f1adida por ${movie.addedByName}`, `Added by ${movie.addedByName}`) : movie.custom ? t("A\u00f1adida por ti", "Added by you") : null,
      movie.watched ? t("Ya vista", "Watched") : null].filter(Boolean).join(" \u00b7 ")
    : online ? t("Un cat\u00e1logo entero por descubrir.", "An entire catalog to discover.")
      : t(`${state.movies.length.toLocaleString(activeLanguage)} pel\u00edculas en tu colecci\u00f3n.`,
        `${state.movies.length.toLocaleString(activeLanguage)} movies in your collection.`);
  $("movie-description").textContent = movie ? movie.description : t("Pulsa el bot\u00f3n y descubre qu\u00e9 ver esta noche.", "Press the button and discover what to watch tonight.");
  $("movie-description").lang = movie?.tmdbId ? (movie.language ?? "es-ES") : activeLanguage;
  const details = movie?.tmdbId ? movie : null;
  $("movie-score").hidden = !details;
  $("movie-score-value").textContent = details && details.rating !== null ? `${Math.round(details.rating * 10).toLocaleString(activeLanguage)}%` : "\u2014";
  $("movie-score-votes").textContent = !details || details.rating === null ? t("Sin puntuaci\u00f3n en TMDB", "No TMDB rating")
    : details.voteCount == null ? t("TMDB \u00b7 Votos no disponibles", "TMDB \u00b7 Votes unavailable")
    : `TMDB \u00b7 ${details.voteCount.toLocaleString(activeLanguage)} ${details.voteCount === 1 ? t("voto", "vote") : t("votos", "votes")}`;
  $("movie-credits").hidden = !details;
  renderCast(details);
  $("movie-directors").textContent = details?.directors.join(", ") || t("Direcci\u00f3n no disponible", "Director unavailable");
  $("movie-genres").textContent = details?.genres.join(", ") || t("G\u00e9neros no disponibles", "Genres unavailable");
  $("movie-genres").lang = details?.genres.length ? (details.language ?? "es-ES") : activeLanguage;
  $("movie-original-title").textContent = details?.originalTitle || t("No disponible", "Unavailable");
  $("movie-tmdb-link").hidden = !movie?.tmdbId;
  if (movie?.tmdbId) $("movie-tmdb-link").href = `https://www.themoviedb.org/movie/${movie.tmdbId}`;
  const poster = $("movie-poster");
  const posterPath = movie?.tmdbId ? movie.posterPath : null;
  const showPoster = Boolean(posterPath && posterPath !== failedPosterPath);
  poster.hidden = !showPoster;
  $("movie-art").hidden = showPoster;
  if (showPoster) {
    if (poster.dataset.path !== posterPath) {
      poster.dataset.path = posterPath;
      poster.src = `https://image.tmdb.org/t/p/w500${posterPath}`;
    }
    poster.alt = t(`P\u00f3ster de ${movie.title}`, `Poster for ${movie.title}`);
  } else {
    poster.removeAttribute("src");
    delete poster.dataset.path;
  }
  $("candidate-count").textContent = online
    ? t("Sorpresas del cat\u00e1logo TMDB, no solo de tu colecci\u00f3n.", "Surprises from the TMDB catalog, not just your collection.")
    : count
    ? t(`${count.toLocaleString(activeLanguage)} ${count === 1 ? "pel\u00edcula" : "pel\u00edculas"} en el bombo`,
      `${count.toLocaleString(activeLanguage)} ${count === 1 ? "movie" : "movies"} in the draw`)
    : t("Sin opciones. Abre Preferencias o a\u00f1ade una peli en Mi colecci\u00f3n.", "No options. Open Preferences or add a movie in My collection.");
  $("random-movie").disabled = busy || (online ? !api.baseUrl : count === 0);
  $("random-movie").setAttribute("aria-busy", String(busy));
  $("random-movie-icon").hidden = busy;
  $("random-movie-spinner").hidden = !busy;
  $("picker-status").className = busy ? "sr-only" : "helper";
  $("picker-status").hidden = !pickerMessage;
  $("picker-status").textContent = localizedText(pickerMessage);
  $("retry-movie").hidden = !selectionRetry || busy;
  $("add-selected-movie").hidden = !movie;
  $("add-selected-movie").disabled = busy || Boolean(savedMovie);
  $("add-selected-movie").textContent = savedMovie
    ? t("Ya est\u00e1 en la lista", "Already in the list")
    : party.session ? t("A\u00f1adir a la colecci\u00f3n del grupo", "Add to the group's collection")
      : t("A\u00f1adir a mi colecci\u00f3n", "Add to my collection");
  $("food-name").textContent = food ? food.name : t("Comida por elegir", "Food to choose");
  $("food-description").textContent = food ? food.description : t("Porque una buena peli merece un buen bocado.", "Because a good movie deserves a good bite.");
  $("save-plan").disabled = busy || !savedMovie || !food;
  $("plan-hint").textContent = movie && !savedMovie
    ? t("A\u00f1ade la pel\u00edcula a la lista antes de guardar un plan.", "Add the movie to the list before saving a plan.")
    : movie && food ? t("Pon fecha y lugar. Lo dem\u00e1s ya est\u00e1.", "Set a date and place. Everything else is ready.")
    : t("Elige una peli y una comida para empezar.", "Choose a movie and food to get started.");
}

function normalizedTitle(title) {
  return title.normalize("NFKC").toLocaleLowerCase("es");
}

async function addMovie(event) {
  event?.preventDefault();
  if (sharedBusy()) {
    notify(["Espera a que termine la operaci\u00f3n de la party.", "Wait for the party operation to finish."]);
    return;
  }
  const input = $("new-movie-title");
  setValidationMessage(input);
  const title = input.value.trim().replace(/\s+/g, " ");
  if (!title) setValidationMessage(input, "Escribe el t\u00edtulo de una pel\u00edcula.", "Enter a movie title.");
  if (!$("add-movie-form").reportValidity()) return;
  const genre = $("new-movie-genre").value;
  if (!isGenre(genre)) {
    notify(["Elige un g\u00e9nero v\u00e1lido para tu pel\u00edcula.", "Choose a valid genre for your movie."]);
    return;
  }
  if (state.movies.some((movie) => normalizedTitle(movie.title) === normalizedTitle(title))) {
    setValidationMessage(input, "Esta pel\u00edcula ya est\u00e1 en tu colecci\u00f3n.", "This movie is already in your collection.");
    input.reportValidity();
    return;
  }
  const movie = {
    id: crypto.randomUUID(), title, genre, year: null, minutes: null,
    description: CUSTOM_MOVIE_DESCRIPTIONS[0],
    watched: false, custom: true,
  };
  if (party.session) {
    if (!await writeParty("/movies", "POST", { movie })) return;
  } else state.movies.push(movie);
  state.preferences.movieTab = "pending";
  const saved = persistState();
  $("add-movie-form").reset();
  closeAddMovie();
  renderMovies();
  renderPicker();
  notify(saved || party.session ? [`"${title}" ya est\u00e1 en pendientes.`, `"${title}" is now pending.`]
    : ["Pel\u00edcula a\u00f1adida solo para esta sesi\u00f3n.", "Movie added for this session only."]);
}

async function toggleWatched(id) {
  if (sharedBusy()) { notify(["Espera a que termine la operaci\u00f3n de la party.", "Wait for the party operation to finish."]); return; }
  const movie = movieById(id);
  if (!movie) {
    notify(["No se encontr\u00f3 la pel\u00edcula que quieres actualizar.", "The movie you want to update was not found."]);
    return;
  }
  const activeIndex = [...$("movie-list").children].findIndex((row) => row.contains(document.activeElement));
  const watched = !movie.watched;
  if (party.session) {
    if (!await writeParty(`/movies/${encodeURIComponent(id)}`, "PATCH", { watched })) return;
  } else movie.watched = watched;
  persistState();
  renderMovies();
  renderPicker();
  if (activeIndex >= 0) focusAfterRemoval("movie-list", ".watch-toggle", activeIndex, `[data-movie-tab="${state.preferences.movieTab}"]`);
  const title = moviePresentation(movie).title;
  notify(watched ? [`"${title}" pasa a ya vistas.`, `"${title}" moves to watched.`]
    : [`"${title}" vuelve a pendientes.`, `"${title}" moves back to pending.`]);
}

async function deleteMovie(id) {
  if (sharedBusy()) { notify(["Espera a que termine la operaci\u00f3n de la party.", "Wait for the party operation to finish."]); return; }
  const movie = movieById(id);
  if (!movie) {
    notify(["No se encontr\u00f3 la pel\u00edcula que quieres eliminar.", "The movie you want to delete was not found."]);
    return;
  }
  if (!canDeletePartyEntry(movie.addedBy)) {
    notify(["Solo quien a\u00f1adi\u00f3 la pel\u00edcula o el anfitri\u00f3n puede eliminarla de la colecci\u00f3n del grupo.",
      "Only the person who added the movie or the host can delete it from the group's collection."]);
    return;
  }
  const title = moviePresentation(movie).title;
  if (!window.confirm(t(`\u00bfEliminar "${title}" de la colecci\u00f3n del grupo? Tambi\u00e9n se eliminar\u00e1n todas sus noches programadas y completadas, incluidas las creadas por otros miembros. Este cambio afecta a todo el grupo y no se puede deshacer.`,
    `Delete "${title}" from the group's collection? All its scheduled and completed nights will also be deleted, including those created by other members. This change affects the whole group and cannot be undone.`))) return;
  const index = [...$("movie-list").children].findIndex((row) => row.contains(document.activeElement));
  cancelSelection();
  if (!await writeParty(`/movies/${encodeURIComponent(id)}`, "DELETE")) return;
  persistState();
  focusAfterRemoval("movie-list", ".delete-movie", Math.max(0, index), `[data-movie-tab="${state.preferences.movieTab}"]`);
  notify([`"${title}" y sus noches asociadas se eliminaron de la colecci\u00f3n del grupo.`,
    `"${title}" and its associated nights were deleted from the group's collection.`]);
}

function renderMovies() {
  const watched = state.movies.filter((movie) => movie.watched).length;
  $("collection-total").textContent = state.movies.length.toLocaleString(activeLanguage);
  $("pending-count").textContent = (state.movies.length - watched).toLocaleString(activeLanguage);
  $("watched-count").textContent = watched.toLocaleString(activeLanguage);
  const showWatched = state.preferences.movieTab === "watched";
  document.querySelectorAll("[data-movie-tab]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.movieTab === state.preferences.movieTab));
  });
  const movies = state.movies.filter((movie) => movie.watched === showWatched).map(moviePresentation);
  // Custom additions appear first so the result is visible even in a long collection.
  movies.sort((a, b) => Number(b.custom) - Number(a.custom));
  const fragment = document.createDocumentFragment();
  movies.forEach((movie) => {
    const row = $("movie-row-template").content.firstElementChild.cloneNode(true);
    translateInterface(row);
    row.querySelector(".movie-row-title").textContent = movie.title;
    row.querySelector(".movie-row-title").lang = movie.tmdbId ? (movie.language ?? "es-ES") : activeLanguage;
    row.querySelector(".movie-row-meta").textContent = [genreName(movie.genre), movie.year,
      movie.minutes ? `${movie.minutes.toLocaleString(activeLanguage)} min` : null, movie.tmdbId ? "TMDB" : null,
      movie.addedByName ? t(`A\u00f1adida por ${movie.addedByName}`, `Added by ${movie.addedByName}`)
        : movie.custom ? t("A\u00f1adida por ti", "Added by you") : null].filter(Boolean).join(" \u00b7 ");
    const watch = row.querySelector(".watch-toggle");
    watch.dataset.id = movie.id;
    watch.setAttribute("aria-pressed", String(movie.watched));
    watch.setAttribute("aria-label", t(`Marcar ${movie.title} como ${movie.watched ? "pendiente" : "vista"}`,
      `Mark ${movie.title} as ${movie.watched ? "pending" : "watched"}`));
    const choose = row.querySelector(".choose-movie");
    choose.dataset.id = movie.id;
    choose.setAttribute("aria-label", t(`Elegir ${movie.title} para mi plan`, `Choose ${movie.title} for my plan`));
    const remove = row.querySelector(".delete-movie");
    remove.dataset.id = movie.id;
    remove.setAttribute("aria-label", t(`Eliminar ${movie.title} de la colecci\u00f3n del grupo`, `Delete ${movie.title} from the group's collection`));
    remove.hidden = !canDeletePartyEntry(movie.addedBy);
    remove.disabled = sharedBusy();
    fragment.append(row);
  });
  $("movie-list").replaceChildren(fragment);
  $("movie-list").setAttribute("aria-label", showWatched ? t("Pel\u00edculas ya vistas", "Watched movies") : t("Pel\u00edculas pendientes", "Pending movies"));
  $("movie-empty").hidden = movies.length > 0;
  $("movie-empty-title").textContent = showWatched ? t("Aqu\u00ed ir\u00e1n tus historias vividas.", "Your watched stories will appear here.") : t("\u00a1Te has puesto al d\u00eda!", "You're all caught up!");
  $("movie-empty-description").textContent = showWatched ? t("Marca una pel\u00edcula como vista o completa una movie night.", "Mark a movie as watched or complete a movie night.")
    : t("A\u00f1ade otra peli o vuelve a disfrutar de una de tus favoritas.", "Add another movie or enjoy a favorite again.");
}

async function savePlan(event) {
  event?.preventDefault();
  if (sharedBusy()) { notify(["Espera a que termine la operaci\u00f3n de la party.", "Wait for the party operation to finish."]); return; }
  if (selectionController) {
    notify(["Espera a que termine de cargar la pel\u00edcula antes de guardar el plan.", "Wait for the movie to finish loading before saving the plan."]);
    return;
  }
  const { movieId, foodId } = state.draft;
  if (!movieById(movieId) || !foodById(foodId)) {
    notify(["Elige una pel\u00edcula y una comida antes de guardar el plan.", "Choose a movie and food before saving the plan."]);
    return;
  }
  const dateInput = $("plan-date");
  const placeInput = $("plan-place");
  setValidationMessage(dateInput);
  setValidationMessage(placeInput);
  const date = dateInput.value;
  const place = placeInput.value.trim();
  if (!isValidDate(date)) setValidationMessage(dateInput, "Elige una fecha v\u00e1lida con un a\u00f1o de cuatro cifras.", "Choose a valid date with a four-digit year.");
  if (!place) setValidationMessage(placeInput, "Escribe d\u00f3nde ser\u00e1 tu movie night.", "Enter where your movie night will take place.");
  if (!$("plan-form").reportValidity()) return;

  const duplicate = state.plans.some((plan) => plan.movieId === movieId && plan.foodId === foodId
    && plan.date === date && plan.place.toLocaleLowerCase("es") === place.toLocaleLowerCase("es"));
  if (duplicate) {
    notify(["Ese plan ya est\u00e1 en tus movie nights.", "That plan is already in your movie nights."]);
    return;
  }
  const plan = { id: crypto.randomUUID(), movieId, foodId, date, place, completed: false };
  if (party.session) {
    if (!await writeParty("/plans", "POST", { plan })) return;
  } else state.plans.push(plan);
  state.draft.date = date;
  state.draft.place = place;
  state.preferences.planTab = "scheduled";
  state.preferences.view = "plans";
  placeInput.value = place;
  const saved = persistState();
  renderPlans();
  renderOrganizer();
  notify(saved || party.session ? ["Movie night guardada. Ya tienes algo bueno que esperar.", "Movie night saved. You have something good to look forward to."]
    : ["Plan creado solo para esta sesi\u00f3n. No se pudo guardar en el navegador.", "Plan created for this session only. It could not be saved in the browser."]);
}

async function togglePlan(id) {
  if (sharedBusy()) { notify(["Espera a que termine la operaci\u00f3n de la party.", "Wait for the party operation to finish."]); return; }
  const plan = state.plans.find((item) => item.id === id);
  if (!plan) {
    notify(["No se encontr\u00f3 el plan que quieres actualizar.", "The plan you want to update was not found."]);
    return;
  }
  const activeIndex = [...$("plan-list").children].findIndex((row) => row.contains(document.activeElement));
  const completed = !plan.completed;
  if (party.session) {
    if (!await writeParty(`/plans/${encodeURIComponent(id)}`, "PATCH", { completed })) return;
  } else {
    plan.completed = completed;
    // Reopening a plan does not erase viewing history; that is an independent library action.
    if (completed) movieById(plan.movieId).watched = true;
  }
  persistState();
  renderPlans();
  renderMovies();
  renderPicker();
  if (activeIndex >= 0) focusAfterRemoval("plan-list", ".complete-plan", activeIndex, `[data-plan-tab="${state.preferences.planTab}"]`);
  notify(completed ? ["Noche completada y pel\u00edcula marcada como vista.", "Night completed and movie marked as watched."]
    : ["Tu noche vuelve a estar programada.", "Your night is scheduled again."]);
}

async function deletePlan(id) {
  if (sharedBusy()) { notify(["Espera a que termine la operaci\u00f3n de la party.", "Wait for the party operation to finish."]); return; }
  const plan = state.plans.find((item) => item.id === id);
  if (!plan) {
    notify(["No se encontr\u00f3 el plan que quieres eliminar.", "The plan you want to delete was not found."]);
    return;
  }
  const title = moviePresentation(movieById(plan.movieId)).title;
  if (!window.confirm(t(`\u00bfEliminar el plan de "${title}"? La pel\u00edcula seguir\u00e1 en tu colecci\u00f3n.`,
    `Delete the plan for "${title}"? The movie will stay in your collection.`))) return;
  const index = [...$("plan-list").children].findIndex((row) => row.contains(document.activeElement));
  if (party.session) {
    if (!await writeParty(`/plans/${encodeURIComponent(id)}`, "DELETE")) return;
  } else state.plans = state.plans.filter((item) => item.id !== id);
  persistState();
  renderPlans();
  focusAfterRemoval("plan-list", ".delete-plan", Math.max(0, index), `[data-plan-tab="${state.preferences.planTab}"]`);
  notify(["Plan eliminado. Tu colecci\u00f3n sigue intacta.", "Plan deleted. Your collection is still intact."]);
}

function focusAfterRemoval(listId, selector, index, fallback) {
  const buttons = [...$(listId).querySelectorAll(selector)].filter((button) => !button.hidden);
  const target = buttons[Math.min(index, buttons.length - 1)] || document.querySelector(fallback);
  target.focus({ preventScroll: true });
}

function renderPlans() {
  const completed = state.plans.filter((plan) => plan.completed).length;
  $("nights-total").textContent = state.plans.length.toLocaleString(activeLanguage);
  $("scheduled-count").textContent = (state.plans.length - completed).toLocaleString(activeLanguage);
  $("completed-count").textContent = completed.toLocaleString(activeLanguage);
  const showCompleted = state.preferences.planTab === "completed";
  document.querySelectorAll("[data-plan-tab]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.planTab === state.preferences.planTab));
  });
  const plans = state.plans.filter((plan) => plan.completed === showCompleted)
    .sort((a, b) => showCompleted ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date));
  const dateFormatter = new Intl.DateTimeFormat(activeLanguage, { day: "numeric", month: "short", year: "numeric" });
  const fragment = document.createDocumentFragment();
  plans.forEach((plan) => {
    const movie = moviePresentation(movieById(plan.movieId));
    const row = $("plan-row-template").content.firstElementChild.cloneNode(true);
    translateInterface(row);
    row.querySelector(".plan-movie-title").textContent = movie.title;
    row.querySelector(".plan-movie-title").lang = movie.tmdbId ? (movie.language ?? "es-ES") : activeLanguage;
    row.querySelector(".plan-author").textContent = plan.createdByName ? t(`Plan de ${plan.createdByName}`, `Planned by ${plan.createdByName}`) : "";
    const time = row.querySelector("time");
    time.dateTime = plan.date;
    time.textContent = dateFormatter.format(new Date(`${plan.date}T12:00:00`));
    row.querySelector(".plan-food").textContent = foodById(plan.foodId).name;
    row.querySelector(".plan-location").textContent = plan.place;
    const toggle = row.querySelector(".complete-plan");
    toggle.dataset.id = plan.id;
    toggle.setAttribute("aria-pressed", String(plan.completed));
    toggle.setAttribute("aria-label", t(`${plan.completed ? "Reabrir" : "Completar"} el plan de ${movie.title}`,
      `${plan.completed ? "Reopen" : "Complete"} the plan for ${movie.title}`));
    toggle.querySelector("span").textContent = plan.completed ? t("Reabrir", "Reopen") : t("Completar", "Complete");
    const remove = row.querySelector(".delete-plan");
    remove.dataset.id = plan.id;
    remove.setAttribute("aria-label", t(`Eliminar el plan de ${movie.title}`, `Delete the plan for ${movie.title}`));
    remove.hidden = Boolean(party.session && !canDeletePartyEntry(plan.createdBy));
    fragment.append(row);
  });
  $("plan-list").replaceChildren(fragment);
  $("plan-list").setAttribute("aria-label", showCompleted ? t("Movie nights completadas", "Completed movie nights") : t("Movie nights programadas", "Scheduled movie nights"));
  $("plans-empty").hidden = plans.length > 0;
  $("plans-empty-title").textContent = showCompleted ? t("Todav\u00eda no hay noches completadas.", "No completed nights yet.") : t("Todav\u00eda no hay planes.", "No plans yet.");
  $("plans-empty-description").textContent = showCompleted ? t("Cuando completes un plan, aparecer\u00e1 aqu\u00ed.", "Completed plans will appear here.")
    : t("Elige una peli y guarda tu primera noche.", "Choose a movie and save your first night.");
  $("empty-plan-link").hidden = showCompleted;
}

function renderTheme() {
  document.documentElement.dataset.theme = state.theme;
  document.documentElement.dataset.colorMode = state.colorMode;
  $("theme-label").textContent = THEMES[state.theme];
  $("color-mode-label").textContent = t(COLOR_MODES[state.colorMode], state.colorMode === "dark" ? "Dark" : "Light");
  $("color-mode-toggle").setAttribute("aria-pressed", String(state.colorMode === "dark"));
  $("color-mode-toggle").setAttribute("aria-label", t("Modo oscuro", "Dark mode"));
  $("color-mode-toggle").title = state.colorMode === "dark" ? t("Cambiar a modo claro", "Switch to light mode") : t("Cambiar a modo oscuro", "Switch to dark mode");
  document.querySelectorAll('input[name="theme"]').forEach((input) => { input.checked = input.value === state.theme; });
  document.querySelector('meta[name="theme-color"]').content = getComputedStyle(document.documentElement).getPropertyValue("--page").trim();
}

function closeThemeMenu(restoreFocus = false) {
  $("theme-menu").hidden = true;
  $("theme-toggle").setAttribute("aria-expanded", "false");
  if (restoreFocus) $("theme-toggle").focus();
}

function closeAddMovie() {
  $("add-movie-form").hidden = true;
  $("show-add-movie").setAttribute("aria-expanded", "false");
  $("show-add-movie").focus({ preventScroll: true });
}

function renderOrganizer() {
  // Older saved collections have no view preference; their data remains unchanged.
  const view = state.preferences.view ?? "plans";
  const focusedPanel = document.activeElement.closest("#collection, #nights, #catalog");
  $("collection").hidden = view !== "movies";
  $("nights").hidden = view !== "plans";
  $("catalog").hidden = view !== "catalog";
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.view === view));
  });
  if (focusedPanel?.hidden) {
    document.querySelector(`[data-view="${view}"]`).focus({ preventScroll: true });
  }
  if (view === "catalog" && api.baseUrl && !catalog.loaded) loadCatalog();
}

function preserveRenderedFocus(render) {
  const focused = document.activeElement;
  const list = focused.closest("#movie-list, #plan-list, #catalog-list");
  const buttons = list ? [...list.querySelectorAll("button")] : [];
  const index = buttons.indexOf(focused);
  render();
  if (index < 0) return;
  const replacements = [...list.querySelectorAll("button")].filter((button) => !button.hidden && !button.disabled);
  const replacement = replacements.find((button) => button.className === focused.className
    && button.dataset.id === focused.dataset.id && button.dataset.tmdbId === focused.dataset.tmdbId);
  (replacement ?? replacements[Math.min(index, replacements.length - 1)]
    ?? document.querySelector(`[data-view="${state.preferences.view ?? "plans"}"]`))?.focus({ preventScroll: true });
}

function renderAll({ preserveFormValues = false } = {}) {
  activeLanguage = catalogLanguage();
  document.documentElement.lang = activeLanguage;
  syncCatalogLanguage();
  syncLocalizationContext();
  translateInterface();
  preserveRenderedFocus(() => {
    renderTheme();
    renderPicker();
    renderMovies();
    renderPlans();
    renderCatalog();
    renderOrganizer();
    renderParty();
  });
  renderLanguageStatus();
  if (storageMessages && !$("storage-notice").hidden) $("storage-notice").textContent = localizedText(storageMessages);
  if (toastMessages && !$("toast").hidden) $("toast").textContent = localizedText(toastMessages);
  $("api-setup-notice").hidden = Boolean(api.baseUrl);
  if (api.error) $("catalog-status").textContent = localizedText(api.error);
  $("movie-source").value = movieSource();
  $("movie-genre").value = state.preferences.genre;
  $("pending-only").checked = state.preferences.pendingOnly;
  $("auto-food").checked = state.preferences.autoFood;
  if (!preserveFormValues) {
    $("plan-date").value = state.draft.date;
    $("plan-place").value = state.draft.place;
  }
}

// Delegated list events continue working after templates are re-rendered.
$("random-movie").addEventListener("click", () => randomMovie());
$("add-selected-movie").addEventListener("click", addPreviewMovie);
$("catalog-language").addEventListener("change", (event) => changeCatalogLanguage(event.target.value));
$("language-retry").addEventListener("click", () => refreshSelectedLanguage({ retry: true }));
$("random-food").addEventListener("click", randomFood);
$("retry-movie").addEventListener("click", () => selectionRetry?.());
$("movie-poster").addEventListener("error", () => {
  failedPosterPath = $("movie-poster").dataset.path;
  renderPicker();
});
$("movie-source").addEventListener("change", (event) => {
  cancelSelection();
  state.preferences.source = event.target.value;
  persistState();
  renderPicker();
});
$("movie-genre").addEventListener("change", (event) => {
  cancelSelection();
  state.preferences.genre = event.target.value;
  persistState();
  renderPicker();
});
$("pending-only").addEventListener("change", (event) => {
  cancelSelection();
  state.preferences.pendingOnly = event.target.checked;
  persistState();
  renderPicker();
});
$("auto-food").addEventListener("change", (event) => {
  state.preferences.autoFood = event.target.checked;
  persistState();
});
$("catalog-query").addEventListener("input", () => {
  $("catalog-genre").disabled = Boolean($("catalog-query").value.trim());
});
$("catalog-form").addEventListener("submit", (event) => {
  event.preventDefault();
  if (!$("catalog-form").reportValidity()) return;
  catalog.query = $("catalog-query").value.trim();
  catalog.genre = $("catalog-genre").value;
  loadCatalog();
  state.preferences.view = "catalog";
  persistState();
  renderOrganizer();
  $("catalog").scrollIntoView({ block: "start" });
});
$("catalog-previous").addEventListener("click", () => loadCatalog(catalog.page - 1));
$("catalog-next").addEventListener("click", () => loadCatalog(catalog.page + 1));
$("catalog-retry").addEventListener("click", () => loadCatalog(catalog.page));
$("catalog-list").addEventListener("click", (event) => {
  const button = event.target.closest(".choose-catalog-movie");
  if (!button) return;
  const movie = catalog.results.find((item) => item.tmdbId === Number(button.dataset.tmdbId));
  if (movie) chooseCatalogMovie(movie);
  else notify(["Los resultados han cambiado. Vuelve a elegir una pel\u00edcula.", "The results have changed. Choose a movie again."]);
});
$("plan-form").addEventListener("submit", savePlan);
["plan-date", "plan-place"].forEach((id) => {
  $(id).addEventListener("input", (event) => {
    setValidationMessage(event.target);
    const field = id === "plan-date" ? "date" : "place";
    // An unfinished date stays in the form until the browser has a valid date value.
    if (field === "date" && event.target.value !== "" && !isValidDate(event.target.value)) return;
    state.draft[field] = event.target.value;
    persistState();
  });
});
$("show-add-movie").addEventListener("click", () => {
  if (!$("add-movie-form").hidden) {
    closeAddMovie();
    return;
  }
  $("add-movie-form").hidden = false;
  $("show-add-movie").setAttribute("aria-expanded", "true");
  $("new-movie-genre").value = state.preferences.genre === "all" ? "general" : state.preferences.genre;
  $("new-movie-title").focus();
});
$("cancel-add-movie").addEventListener("click", closeAddMovie);
$("new-movie-title").addEventListener("input", () => setValidationMessage($("new-movie-title")));
$("add-movie-form").addEventListener("submit", addMovie);
$("movie-list").addEventListener("click", (event) => {
  const watch = event.target.closest(".watch-toggle");
  const choose = event.target.closest(".choose-movie");
  const remove = event.target.closest(".delete-movie");
  if (watch) toggleWatched(watch.dataset.id);
  if (choose) selectMovie(choose.dataset.id);
  if (remove) deleteMovie(remove.dataset.id);
});
$("plan-list").addEventListener("click", (event) => {
  const toggle = event.target.closest(".complete-plan");
  const remove = event.target.closest(".delete-plan");
  if (toggle) togglePlan(toggle.dataset.id);
  if (remove) deletePlan(remove.dataset.id);
});
document.querySelectorAll("[data-movie-tab]").forEach((button) => {
  button.addEventListener("click", () => {
    state.preferences.movieTab = button.dataset.movieTab;
    persistState();
    renderMovies();
  });
});
document.querySelectorAll("[data-plan-tab]").forEach((button) => {
  button.addEventListener("click", () => {
    state.preferences.planTab = button.dataset.planTab;
    persistState();
    renderPlans();
  });
});
document.querySelectorAll("[data-view]").forEach((button) => {
  button.addEventListener("click", () => {
    state.preferences.view = button.dataset.view;
    persistState();
    renderOrganizer();
  });
});
$("color-mode-toggle").addEventListener("click", () => {
  state.colorMode = state.colorMode === "dark" ? "light" : "dark";
  persistState();
  renderTheme();
});
$("theme-toggle").addEventListener("click", () => {
  const open = $("theme-menu").hidden;
  $("theme-menu").hidden = !open;
  $("theme-toggle").setAttribute("aria-expanded", String(open));
  if (open) $("theme-menu").querySelector(":checked").focus();
});
$("theme-menu").addEventListener("change", (event) => {
  if (!event.target.matches('input[name="theme"]')) return;
  if (!Object.hasOwn(THEMES, event.target.value)) {
    notify(["Elige un tema de interfaz v\u00e1lido.", "Choose a valid interface theme."]);
    return;
  }
  state.theme = event.target.value;
  persistState();
  renderTheme();
});
$("theme-menu").addEventListener("click", (event) => {
  // Arrow keys may change several radio options before Enter/Space or Escape closes them.
  if (event.target.matches('input[name="theme"]')) closeThemeMenu(true);
});
document.addEventListener("click", (event) => {
  if (!event.target.closest(".theme-control")) closeThemeMenu();
  if (!event.target.closest("#picker-options")) $("picker-options").open = false;
});
document.addEventListener("keydown", (event) => {
  if ($("party-dialog").open) return;
  if (event.key === "Enter" && event.target.matches('input[name="theme"]') && !$("theme-menu").hidden) {
    event.preventDefault();
    closeThemeMenu(true);
  }
  if (event.key !== "Escape") return;
  if (!$("theme-menu").hidden) closeThemeMenu(true);
  if (!$("add-movie-form").hidden && !$("collection").hidden) closeAddMovie();
  if ($("picker-options").open) {
    $("picker-options").open = false;
    $("picker-options").querySelector("summary").focus();
  }
});

// Other tabs on the same origin receive saved changes; invalid updates remain protected.
window.addEventListener("storage", (event) => {
  if (event.key !== STORAGE_KEY && event.key !== null) return;
  const updated = event.newValue === null ? freshState() : decodeState(event.newValue);
  if (!updated) return;
  if (party.session) {
    party.localState = updated;
    return;
  }
  cancelSelection();
  previewMovie = null;
  state = updated;
  storageWritable = true;
  $("storage-notice").hidden = true;
  renderAll();
  refreshSelectedLanguage();
  notify(["La colecci\u00f3n se ha actualizado desde otra pesta\u00f1a.", "The collection was updated from another tab."]);
});

renderAll();
const partyReady = initializeParties();
if (!party.session) refreshSelectedLanguage();
