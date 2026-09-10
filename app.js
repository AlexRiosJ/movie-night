"use strict";

const STORAGE_KEY = "movie-night:v1";
const GENRES = {
  spooky: "Spooky season",
  cozy: "Cozy oto\u00f1o",
  "sci-fi": "Sci-fi",
  fantasy: "Fantas\u00eda",
  christmas: "Navidad",
};
const MOVIE_GENRES = { ...GENRES, general: "Otros g\u00e9neros" };
const ENGLISH_GENRES = {
  spooky: "Spooky season", cozy: "Cozy autumn", "sci-fi": "Sci-fi",
  fantasy: "Fantasy", christmas: "Christmas", general: "Other genres",
};
const MOODS = {
  spooky: "Un poquito de magia.\nUn poquito de misterio.",
  cozy: "Una taza caliente.\nUna historia bonita.",
  "sci-fi": "Pr\u00f3xima parada:\notra galaxia.",
  fantasy: "La magia empieza\ncuando le das al play.",
  christmas: "Luces encendidas.\nCoraz\u00f3n calentito.",
};
const ENGLISH_MOODS = {
  spooky: "A little magic.\nA little mystery.",
  cozy: "A warm cup.\nA lovely story.",
  "sci-fi": "Next stop:\nanother galaxy.",
  fantasy: "The magic begins\nwhen you press play.",
  christmas: "Lights on.\nHearts warmed.",
};
const FOODS = [
  { id: "pizza", name: "Pizza para compartir", description: "Tu favorita, reci\u00e9n hecha. La \u00faltima porci\u00f3n se negocia." },
  { id: "popcorn", name: "Palomitas de cine", description: "Dulces o saladas. El cl\u00e1sico que nunca falla." },
  { id: "pasta", name: "Un buen plato de pasta", description: "Tu salsa favorita y una noche sin complicaciones." },
  { id: "snacks", name: "Tabla de snacks", description: "Un poco de queso, fruta, galletas y lo que m\u00e1s te guste." },
  { id: "nachos", name: "Nachos con guacamole", description: "Crujientes, para compartir y con extra de guacamole." },
  { id: "burgers", name: "Hamburguesas caseras", description: "Unas papas al lado y ya tenemos un plan redondo." },
  { id: "hot-chocolate", name: "Chocolate y galletas", description: "Una taza calentita, algo dulce y tu manta favorita." },
  { id: "sandwiches", name: "S\u00e1ndwiches a la plancha", description: "Pan crujiente, queso fundido y comodidad en cada bocado." },
];
const ENGLISH_FOODS = {
  pizza: ["Pizza to share", "Your favorite, fresh from the oven. The last slice is negotiable."],
  popcorn: ["Movie popcorn", "Sweet or salty. A classic that never fails."],
  pasta: ["A good plate of pasta", "Your favorite sauce and an easy night in."],
  snacks: ["Snack board", "Some cheese, fruit, crackers, and whatever you love."],
  nachos: ["Nachos with guacamole", "Crunchy, made for sharing, with extra guacamole."],
  burgers: ["Homemade burgers", "Add some fries and the plan is complete."],
  "hot-chocolate": ["Hot chocolate and cookies", "A warm cup, something sweet, and your favorite blanket."],
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
let storageMessages;
let toastTimer;
const api = readApiConfig();
const catalog = { query: "", genre: "all", page: 1, totalPages: 0, results: [], loaded: false, loading: false, error: "" };
let catalogController;
let selectionController;
let selectionRetry;
let pickerMessage = "";
let failedPosterPath = null;
let localizationController;
let renderedCastKey;

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
    return { baseUrl: "", error: "invalid-url" };
  }
}

function apiConfigError() {
  return api.error ? t("La URL del proxy en config.js no es v\u00e1lida. Usa HTTPS (o HTTP en localhost).",
    "The proxy URL in config.js is invalid. Use HTTPS (or HTTP on localhost).") : "";
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
    theme: "spooky",
    draft: { movieId: null, foodId: null, date: localToday(), place: "" },
    preferences: { language: "es-MX", genre: "all", pendingOnly: true, autoFood: true, movieTab: "pending", planTab: "scheduled", view: "catalog" },
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

function isStringList(value, count, length) {
  return Array.isArray(value) && value.length <= count && value.every((item) => isText(item, length));
}

function isImagePath(value) {
  return value === null || (typeof value === "string" && /^\/[a-zA-Z0-9_-]+\.(jpg|png)$/i.test(value));
}

function isMovieData(movie) {
  return isRecord(movie) && isText(movie.id, 100) && isText(movie.title, 300) && isGenre(movie.genre)
    && (movie.year === null || (Number.isInteger(movie.year) && movie.year >= 1888 && movie.year <= 2200))
    && (movie.minutes === null || (Number.isInteger(movie.minutes) && movie.minutes > 0 && movie.minutes <= 1000))
    && isText(movie.description, 6000);
}

function isTmdbData(movie) {
  return isMovieData(movie) && Number.isSafeInteger(movie.tmdbId) && movie.tmdbId > 0
    && isImagePath(movie.posterPath) && isStringList(movie.cast, 12, 120)
    && (movie.castProfiles === undefined || (Array.isArray(movie.castProfiles) && movie.castProfiles.length <= 12
      && movie.castProfiles.every((person) => isRecord(person) && isText(person.name, 120) && isImagePath(person.profilePath))))
    && isStringList(movie.directors, 6, 120) && isStringList(movie.genres, 20, 80)
    && typeof movie.originalTitle === "string" && movie.originalTitle.length <= 300
    && (movie.voteCount === undefined || movie.voteCount === null || (Number.isSafeInteger(movie.voteCount) && movie.voteCount >= 0))
    && (movie.rating === null || (Number.isFinite(movie.rating) && movie.rating >= 0 && movie.rating <= 10))
    && (movie.language === undefined || LANGUAGES.includes(movie.language));
}

function isLocalizationCache(movie) {
  if (movie.localizations === undefined) return true;
  return Boolean(movie.tmdbId) && isRecord(movie.localizations)
    && Object.entries(movie.localizations).every(([language, data]) => LANGUAGES.includes(language)
      && isTmdbData(data) && data.language === language && data.tmdbId === movie.tmdbId
      && data.id === `tmdb-${movie.tmdbId}` && data.localizations === undefined);
}

// Validate stored data and references before rendering. Damaged data is never overwritten.
function isValidState(value) {
  if (!isRecord(value) || value.version !== 1 || !Object.hasOwn(GENRES, value.theme)
    || !Array.isArray(value.movies) || !Array.isArray(value.plans)
    || !isRecord(value.draft) || !isRecord(value.preferences)) return false;

  const validMovies = value.movies.every((movie) => isMovieData(movie)
    && typeof movie.watched === "boolean" && typeof movie.custom === "boolean"
    && (movie.tmdbId === undefined || isTmdbData(movie)) && isLocalizationCache(movie));
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
    && (preferences.genre === "all" || isGenre(preferences.genre))
    && typeof preferences.pendingOnly === "boolean" && typeof preferences.autoFood === "boolean"
    && ["pending", "watched"].includes(preferences.movieTab)
    && ["scheduled", "completed"].includes(preferences.planTab)
    && (preferences.view === undefined || ["plans", "movies", "catalog"].includes(preferences.view))
    && (preferences.source === undefined || ["catalog", "collection"].includes(preferences.source))
    && (preferences.language === undefined || LANGUAGES.includes(preferences.language));
}

function storageWarning(messages, error) {
  storageMessages = messages;
  $("storage-notice").textContent = t(...messages);
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
      "Your saved data has an incompatible format. It has been preserved; changes in this session will not be saved."]);
    return null;
  }
  return parsed;
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
activeLanguage = state.preferences.language ?? "es-MX";

function persistState() {
  if (party.session) return party.loading ? false : persistPartyView();
  if (!storageWritable) return false;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    storageWarning(["No se pudieron guardar los cambios en este navegador. Por ahora solo est\u00e1n en esta pesta\u00f1a. Revisa el espacio o los permisos de almacenamiento.",
      "Changes could not be saved in this browser. They are only in this tab. Check storage space or permissions."], error);
    return false;
  }
  $("storage-notice").hidden = true;
  return true;
}

function notify(message) {
  clearTimeout(toastTimer);
  $("toast").textContent = message;
  $("toast").hidden = false;
  toastTimer = setTimeout(() => { $("toast").hidden = true; }, 4800);
}

function movieById(id) {
  return state.movies.find((movie) => movie.id === id);
}

function movieDisplay(movie) {
  if (!movie) return movie;
  const localized = movie.localizations?.[activeLanguage];
  return localized ? { ...movie, ...localized, id: movie.id, genre: movie.genre, watched: movie.watched, custom: movie.custom }
    : movie.custom && CUSTOM_MOVIE_DESCRIPTIONS.includes(movie.description)
      ? { ...movie, description: customMovieDescription() } : movie;
}

function customMovieDescription() {
  return t(...CUSTOM_MOVIE_DESCRIPTIONS);
}

function foodById(id) {
  const food = FOODS.find((food) => food.id === id);
  if (!food || activeLanguage !== "en-US") return food;
  const [name, description] = ENGLISH_FOODS[id];
  return { ...food, name, description };
}

function candidates() {
  return state.movies.filter((movie) =>
    (state.preferences.genre === "all" || movie.genre === state.preferences.genre)
    && (!state.preferences.pendingOnly || !movie.watched));
}

function movieSource() {
  return state.preferences.source ?? (api.baseUrl ? "catalog" : "collection");
}

class MovieApiError extends Error {}

async function apiRequest(path, params, signal, language = activeLanguage) {
  if (!api.baseUrl) throw new MovieApiError(t("Configura la URL del proxy para conectar el cat\u00e1logo TMDB.",
    "Configure the proxy URL to connect to the TMDB catalog."));
  const url = new URL(`${api.baseUrl}${path}`);
  url.searchParams.set("language", language);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, String(value)));
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
    if (error.name === "TimeoutError") throw new MovieApiError(t("TMDB est\u00e1 tardando demasiado. Vuelve a intentarlo.", "TMDB is taking too long. Try again."));
    if (error instanceof TypeError) throw new MovieApiError(t("No se pudo conectar con el cat\u00e1logo. Revisa la conexi\u00f3n y la configuraci\u00f3n del proxy.",
      "Could not connect to the catalog. Check your connection and proxy configuration."));
    throw error;
  }
  let data;
  try {
    data = await response.json();
  } catch (error) {
    if (signal?.aborted) throw error;
    if (["TimeoutError", "AbortError"].includes(error.name)) throw new MovieApiError(t("TMDB est\u00e1 tardando demasiado. Vuelve a intentarlo.", "TMDB is taking too long. Try again."));
    if (error instanceof TypeError) throw new MovieApiError(t("Se interrumpi\u00f3 la descarga de la ficha. Vuelve a intentarlo.", "The movie download was interrupted. Try again."));
    if (!(error instanceof SyntaxError)) throw error;
    throw new MovieApiError(t("El proxy no devolvi\u00f3 datos v\u00e1lidos. Revisa su URL y vuelve a intentarlo.", "The proxy returned invalid data. Check its URL and try again."));
  }
  if (!response.ok) {
    throw new MovieApiError(isRecord(data) && isText(data.error, 500)
      ? data.error : t(`No se pudo consultar TMDB (HTTP ${response.status}). Int\u00e9ntalo de nuevo.`,
        `Could not query TMDB (HTTP ${response.status}). Try again.`));
  }
  return data;
}

async function fetchCatalogPage(query, genre, page, signal, language = activeLanguage) {
  const data = await apiRequest("/movies", { query, genre, page }, signal, language);
  if (!isRecord(data) || data.page !== page || !Number.isInteger(data.totalPages)
    || data.totalPages < 0 || data.totalPages > 500 || !Number.isInteger(data.totalResults) || data.totalResults < 0
    || !Array.isArray(data.results) || data.results.length > 20
    || !data.results.every((movie) => isTmdbData(movie) && movie.id === `tmdb-${movie.tmdbId}` && movie.language === language)) {
    throw new MovieApiError(t("El cat\u00e1logo devolvi\u00f3 un formato no compatible. Actualiza el proxy para habilitar los idiomas.",
      "The catalog returned an incompatible format. Update the proxy to enable languages."));
  }
  return data;
}

async function fetchMovieDetails(tmdbId, signal, language = activeLanguage) {
  const data = await apiRequest(`/movies/${tmdbId}`, {}, signal, language);
  if (!isRecord(data) || !isTmdbData(data.movie) || data.movie.tmdbId !== tmdbId
    || data.movie.id !== `tmdb-${tmdbId}` || data.movie.language !== language) {
    throw new MovieApiError(t("No se pudo leer la ficha en el idioma elegido. Actualiza el proxy para habilitar los idiomas.",
      "Could not read the movie in the selected language. Update the proxy to enable languages."));
  }
  return data.movie;
}

function apiErrorMessage(error) {
  if (error instanceof MovieApiError || error instanceof PartyApiError) return error.message;
  console.error("Movie Night: catalog", error);
  return t("No se pudo cargar la pel\u00edcula. Int\u00e9ntalo de nuevo.", "Could not load the movie. Try again.");
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
  $("catalog-status").textContent = !configured ? (apiConfigError() || t("Conecta el proxy TMDB para explorar pel\u00edculas. Consulta el aviso de configuraci\u00f3n.",
    "Connect the TMDB proxy to explore movies. See the setup notice."))
    : catalog.loading ? t("Buscando pel\u00edculas en TMDB\u2026", "Searching TMDB\u2026")
    : catalog.error || (catalog.results.length ? t(`${catalog.totalResults.toLocaleString(activeLanguage)} resultados en TMDB.`,
      `${catalog.totalResults.toLocaleString(activeLanguage)} results on TMDB.`)
      : catalog.loaded ? t("No encontramos pel\u00edculas. Prueba otro t\u00edtulo o universo.", "No movies found. Try another title or universe.")
      : t("Busca un t\u00edtulo o descubre pel\u00edculas populares.", "Search for a title or discover popular movies."));
  $("catalog-retry").hidden = !catalog.error || catalog.loading || !configured;
  const fragment = document.createDocumentFragment();
  catalog.results.forEach((movie) => {
    const row = $("catalog-row-template").content.firstElementChild.cloneNode(true);
    translateInterface(row);
    row.querySelector(".catalog-title").textContent = movie.title;
    row.querySelector(".catalog-meta").textContent = [movie.year ?? t("A\u00f1o no disponible", "Year unavailable"), genreName(movie.genre)].join(" \u00b7 ");
    row.querySelector(".catalog-description").textContent = movie.description;
    const poster = row.querySelector(".catalog-poster");
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
  $("catalog-page").textContent = t(`P\u00e1gina ${catalog.page} de ${catalog.totalPages}`, `Page ${catalog.page} of ${catalog.totalPages}`);
}

// Match legacy entries only by a known title AND year; IDs keep existing plans intact.
function savedApiMovie(movie) {
  return state.movies.find((saved) => saved.tmdbId === movie.tmdbId)
    ?? state.movies.find((saved) => !saved.tmdbId && !saved.custom && movie.year !== null && saved.year === movie.year
      && [movie.title, movie.originalTitle].filter(Boolean)
        .some((title) => normalizedTitle(saved.title) === normalizedTitle(title)));
}

function saveApiMovie(movie, genre) {
  const existing = savedApiMovie(movie);
  const localizations = { ...existing?.localizations };
  if (movie.language) localizations[movie.language] = { ...movie };
  if (existing) {
    const { id, watched, genre: savedGenre } = existing;
    Object.assign(existing, movie, { id, watched, genre: savedGenre, custom: false, localizations });
    return existing;
  }
  const saved = { ...movie, genre: genre ?? movie.genre, watched: false, custom: false, localizations };
  state.movies.push(saved);
  return saved;
}

function resetCatalogLanguage() {
  catalogController?.abort();
  catalogController = null;
  Object.assign(catalog, { page: 1, totalPages: 0, results: [], loaded: false, loading: false, error: "" });
}

function cancelMovieTranslations() {
  localizationController?.abort();
  localizationController = null;
  $("language-status").hidden = true;
  $("language-retry").hidden = true;
}

async function refreshMovieLanguages() {
  localizationController?.abort();
  const controller = new AbortController();
  localizationController = controller;
  const language = activeLanguage;
  const missing = state.movies.filter((movie) => movie.tmdbId && !movie.localizations?.[language])
    .sort((a, b) => Number(b.id === state.draft.movieId) - Number(a.id === state.draft.movieId));
  $("language-retry").hidden = true;
  $("language-status").hidden = missing.length === 0;
  if (!missing.length) {
    localizationController = null;
    return;
  }
  if (!api.baseUrl) {
    $("language-status").textContent = t(
      "Conecta el proxy para traducir las pel\u00edculas guardadas. Mientras tanto se muestran sus datos disponibles.",
      "Connect the proxy to translate saved movies. Their available details are shown in the meantime.");
    localizationController = null;
    return;
  }
  $("language-status").textContent = t("Actualizando t\u00edtulos y p\u00f3sters de tu colecci\u00f3n\u2026",
    "Updating titles and posters in your collection\u2026");
  let failure = "";
  // Keep requests bounded for large collections; cancelled languages never update storage.
  for (const movie of missing) {
    let details;
    try {
      details = await fetchMovieDetails(movie.tmdbId, controller.signal, language);
    } catch (error) {
      if (controller.signal.aborted) return;
      failure = apiErrorMessage(error);
      continue;
    }
    if (controller.signal.aborted) return;
    if (movieById(movie.id)) {
      saveApiMovie(details);
      persistState();
      renderPicker();
      renderMovies();
      renderPlans();
    }
  }
  if (controller.signal.aborted) return;
  localizationController = null;
  $("language-status").hidden = !failure;
  $("language-status").textContent = failure ? `${t(
    "No se pudieron actualizar todas las traducciones. Se conservan los datos disponibles.",
    "Not all translations could be updated. Available details have been kept.")} ${failure}` : "";
  $("language-retry").hidden = !failure;
}

function changeLanguage(language) {
  if (sharedBusy()) {
    notify(t("Espera a que termine la operaci\u00f3n de la party.", "Wait for the party operation to finish."));
    $("language").value = activeLanguage;
    return;
  }
  if (!LANGUAGES.includes(language)) {
    notify(t("Elige un idioma disponible.", "Choose an available language."));
    $("language").value = activeLanguage;
    return;
  }
  cancelSelection();
  resetCatalogLanguage();
  cancelMovieTranslations();
  activeLanguage = language;
  state.preferences.language = language;
  failedPosterPath = null;
  $("toast").hidden = true;
  ["new-movie-title", "plan-date", "plan-place"].forEach((id) => $(id).setCustomValidity(""));
  persistState();
  renderAll();
  return refreshMovieLanguages();
}

function cancelSelection() {
  selectionController?.abort();
  selectionController = null;
  selectionRetry = null;
  pickerMessage = "";
}

async function selectFromApi(loadMovie, retry, { genre = null, forceFood = false, focus = false } = {}) {
  if (sharedBusy()) {
    notify(t("Espera a que termine la operaci\u00f3n de la party.", "Wait for the party operation to finish."));
    return;
  }
  cancelSelection();
  const controller = new AbortController();
  selectionController = controller;
  pickerMessage = t("Cargando la ficha de la pel\u00edcula\u2026", "Loading movie details\u2026");
  renderPicker();
  if (focus) $("planner").scrollIntoView({ block: "start" });
  let movie;
  let savedMovie;
  try {
    movie = await loadMovie(controller.signal);
    if (controller.signal.aborted) return;
    if (party.session) {
      const snapshot = await writeParty("/movies", "POST", {
        movie: { ...movie, genre: genre ?? movie.genre, watched: false, custom: false },
      });
      if (controller.signal.aborted) return;
      if (!snapshot) {
        selectionController = null;
        pickerMessage = t("No se pudo confirmar que la pel\u00edcula se guard\u00f3 en la party. Actualiza la lista antes de reintentar.",
          "Could not confirm the movie was saved to the party. Refresh the list before retrying.");
        selectionRetry = retry;
        renderPicker();
        return;
      }
      savedMovie = state.movies.find((saved) => saved.tmdbId === movie.tmdbId);
      if (!savedMovie) throw new PartyApiError(t("La pel\u00edcula no apareci\u00f3 en la lista compartida. Actualiza la party.",
        "The movie did not appear in the shared list. Refresh the party."));
    }
    savedMovie = saveApiMovie(movie, genre);
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
  state.draft.movieId = savedMovie.id;
  if (forceFood || state.preferences.autoFood) state.draft.foodId = pickRandom(FOODS, state.draft.foodId).id;
  const saved = persistState();
  renderPicker();
  renderMovies();
  renderPlans();
  renderCatalog();
  if (focus) {
    $("planner").scrollIntoView({ block: "start" });
    $("movie-title").focus({ preventScroll: true });
  }
  notify(saved || party.session ? t(`${savedMovie.title}: lista para tu pr\u00f3ximo plan.`, `${savedMovie.title}: ready for your next plan.`)
    : t("Pel\u00edcula elegida solo para esta sesi\u00f3n.", "Movie selected for this session only."));
}

function chooseCatalogMovie(movie) {
  if (sharedBusy()) {
    notify(t("Espera a que termine la operaci\u00f3n de la party.", "Wait for the party operation to finish."));
    return;
  }
  const existing = savedApiMovie(movie);
  if (existing?.localizations?.[activeLanguage]?.castProfiles !== undefined) {
    selectMovie(existing.id);
    return;
  }
  const genre = !catalog.query && catalog.genre !== "all" ? catalog.genre : null;
  return selectFromApi((signal) => fetchMovieDetails(movie.tmdbId, signal),
    () => chooseCatalogMovie(movie), { genre, focus: true });
}

async function randomApiMovie(signal) {
  const { genre, pendingOnly } = state.preferences;
  const language = activeLanguage;
  const firstPage = await fetchCatalogPage("", genre, 1, signal, language);
  signal.throwIfAborted();
  const remainingPages = Array.from({ length: firstPage.totalPages }, (_, index) => index + 1);
  const previous = movieById(state.draft.movieId);
  // Sample different pages, not just the first popular results. Bound retries for watched-heavy collections.
  for (let attempt = 0; attempt < 5 && remainingPages.length; attempt += 1) {
    const index = Math.floor(Math.random() * remainingPages.length);
    const [page] = remainingPages.splice(index, 1);
    const data = page === 1 ? firstPage : await fetchCatalogPage("", genre, page, signal, language);
    signal.throwIfAborted();
    const options = data.results.filter((movie) => {
      const saved = savedApiMovie(movie);
      return (!pendingOnly || !saved?.watched)
        && (!previous || (movie.tmdbId !== previous.tmdbId && saved?.id !== previous.id));
    });
    const movie = pickRandom(options, null);
    if (movie) return fetchMovieDetails(movie.tmdbId, signal, language);
  }
  throw new MovieApiError(t("No encontramos otra pel\u00edcula en las p\u00e1ginas consultadas. Reintenta, cambia de universo o desactiva Solo pendientes.",
    "No other movie found on the sampled pages. Try again, change universe, or turn off Unwatched only."));
}

// Avoid immediate repeats when at least two choices exist; a single choice remains valid.
function pickRandom(items, previousId) {
  const pool = items.length > 1 ? items.filter((item) => item.id !== previousId) : items;
  return pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
}

function randomMovie(forceFood = false) {
  if (movieSource() === "catalog") {
    return selectFromApi(randomApiMovie, () => randomMovie(forceFood), {
      genre: state.preferences.genre === "all" ? null : state.preferences.genre, forceFood,
    });
  }
  cancelSelection();
  const movie = pickRandom(candidates(), state.draft.movieId);
  if (!movie) {
    notify(t("No hay pel\u00edculas con estos filtros. Cambia de universo, incluye las vistas o a\u00f1ade una nueva.",
      "No movies match these filters. Change universe, include watched movies, or add a new one."));
    return null;
  }
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
    notify(t("Espera a que termine de cargar la party.", "Wait for the party to finish loading."));
    return;
  }
  cancelSelection();
  const movie = movieById(id);
  if (!movie) {
    notify(t("No se encontr\u00f3 esa pel\u00edcula. Vuelve a elegir una de tu colecci\u00f3n.",
      "Movie not found. Choose another from your collection."));
    return;
  }
  state.draft.movieId = id;
  if (state.preferences.autoFood) state.draft.foodId = pickRandom(FOODS, state.draft.foodId).id;
  persistState();
  renderPicker();
  $("planner").scrollIntoView({ block: "start" });
  $("movie-title").focus({ preventScroll: true });
  const title = movieDisplay(movie).title;
  notify(t(`${title}: lista para tu pr\u00f3ximo plan.`, `${title}: ready for your next plan.`));
}

function renderCast(movie) {
  const cast = movie?.cast ?? [];
  const key = JSON.stringify([activeLanguage, movie?.id, cast, movie?.castProfiles]);
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
  const movie = movieDisplay(movieById(state.draft.movieId));
  const food = foodById(state.draft.foodId);
  const count = candidates().length;
  const online = movieSource() === "catalog";
  const busy = Boolean(selectionController) || sharedBusy();
  $("movie-badge").textContent = movie ? genreName(movie.genre).toLocaleUpperCase(activeLanguage) : t("QUE DECIDA EL DESTINO", "LET FATE DECIDE");
  $("movie-title").textContent = movie ? movie.title : t("Tu pr\u00f3xima favorita te espera.", "Your next favorite is waiting.");
  $("movie-meta").textContent = movie
    ? [movie.year ?? t("A\u00f1o no disponible", "Year unavailable"), movie.minutes ? `${movie.minutes} min` : t("Duraci\u00f3n no disponible", "Runtime unavailable"),
      movie.addedByName ? t(`A\u00f1adida por ${movie.addedByName}`, `Added by ${movie.addedByName}`)
        : movie.custom ? t("A\u00f1adida por ti", "Added by you") : null,
      movie.watched ? t("Ya vista", "Watched") : null].filter(Boolean).join(" \u00b7 ")
    : online ? t("Un cat\u00e1logo entero por descubrir.", "A whole catalog to discover.")
      : t(`${state.movies.length} pel\u00edculas en tu colecci\u00f3n.`, `${state.movies.length} movies in your collection.`);
  $("movie-description").textContent = movie ? movie.description : t("Pulsa el bot\u00f3n y descubre qu\u00e9 ver esta noche.", "Press the button and discover what to watch tonight.");
  const details = movie?.tmdbId ? movie : null;
  $("movie-score").hidden = !details;
  $("movie-score-value").textContent = details && details.rating !== null ? `${Math.round(details.rating * 10)}%` : "\u2014";
  $("movie-score-votes").textContent = !details || details.rating === null ? t("Sin puntuaci\u00f3n en TMDB", "No TMDB score")
    : details.voteCount == null ? t("TMDB \u00b7 Votos no disponibles", "TMDB \u00b7 Vote count unavailable")
    : t(`TMDB \u00b7 ${details.voteCount.toLocaleString(activeLanguage)} ${details.voteCount === 1 ? "voto" : "votos"}`,
      `TMDB \u00b7 ${details.voteCount.toLocaleString(activeLanguage)} ${details.voteCount === 1 ? "vote" : "votes"}`);
  $("movie-credits").hidden = !details;
  renderCast(details);
  $("movie-directors").textContent = details?.directors.join(", ") || t("Direcci\u00f3n no disponible", "Directors unavailable");
  $("movie-genres").textContent = details?.genres.join(", ") || t("G\u00e9neros no disponibles", "Genres unavailable");
  $("movie-original-title").textContent = details?.originalTitle || t("No disponible", "Unavailable");
  $("movie-tmdb-link").hidden = !movie?.tmdbId;
  if (movie?.tmdbId) $("movie-tmdb-link").href = `https://www.themoviedb.org/movie/${movie.tmdbId}?language=${activeLanguage}`;
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
    ? t(`${count} ${count === 1 ? "pel\u00edcula" : "pel\u00edculas"} en el bombo`, `${count} ${count === 1 ? "movie" : "movies"} to choose from`)
    : t("Sin opciones. Abre Preferencias o a\u00f1ade una peli en Mi colecci\u00f3n.", "No choices. Open Preferences or add a movie in My collection.");
  $("random-movie").disabled = busy || (online ? !api.baseUrl : count === 0);
  $("random-movie").setAttribute("aria-busy", String(busy));
  $("random-movie-icon").hidden = busy;
  $("random-movie-spinner").hidden = !busy;
  $("picker-status").className = busy ? "sr-only" : "helper";
  $("picker-status").hidden = !pickerMessage;
  $("picker-status").textContent = pickerMessage;
  $("retry-movie").hidden = !selectionRetry || busy;
  $("food-name").textContent = food ? food.name : t("Comida por elegir", "Food to be chosen");
  $("food-description").textContent = food ? food.description : t("Porque una buena peli merece un buen bocado.", "Because a great movie deserves a great bite.");
  $("save-plan").disabled = busy || !movie || !food;
  $("plan-hint").textContent = movie && food ? t("Pon fecha y lugar. Lo dem\u00e1s ya est\u00e1.", "Set a date and location. Everything else is ready.")
    : t("Elige una peli y una comida para empezar.", "Choose a movie and food to get started.");
}

function normalizedTitle(title) {
  return title.normalize("NFKC").toLocaleLowerCase("es");
}

async function addMovie(event) {
  event?.preventDefault();
  if (sharedBusy()) {
    notify(t("Espera a que termine la operaci\u00f3n de la party.", "Wait for the party operation to finish."));
    return;
  }
  const input = $("new-movie-title");
  input.setCustomValidity("");
  const title = input.value.trim().replace(/\s+/g, " ");
  if (!title) input.setCustomValidity(t("Escribe el t\u00edtulo de una pel\u00edcula.", "Enter a movie title."));
  if (!$("add-movie-form").reportValidity()) return;
  const genre = $("new-movie-genre").value;
  if (!isGenre(genre)) {
    notify(t("Elige un universo v\u00e1lido para tu pel\u00edcula.", "Choose a valid universe for your movie."));
    return;
  }
  if (state.movies.some((movie) => [movie.title, movie.originalTitle, ...Object.values(movie.localizations ?? {}).map((data) => data.title)].filter(Boolean)
    .some((savedTitle) => normalizedTitle(savedTitle) === normalizedTitle(title)))) {
    input.setCustomValidity(t("Esta pel\u00edcula ya est\u00e1 en tu colecci\u00f3n.", "This movie is already in your collection."));
    input.reportValidity();
    return;
  }
  const movie = {
    id: crypto.randomUUID(), title, genre, year: null, minutes: null,
    description: customMovieDescription(),
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
  notify(saved || party.session ? t(`"${title}" ya est\u00e1 en pendientes.`, `"${title}" is on your unwatched list.`)
    : t("Pel\u00edcula a\u00f1adida solo para esta sesi\u00f3n.", "Movie added for this session only."));
}

async function toggleWatched(id) {
  if (sharedBusy()) { notify(t("Espera a que termine la operaci\u00f3n de la party.", "Wait for the party operation to finish.")); return; }
  const movie = movieById(id);
  if (!movie) {
    notify(t("No se encontr\u00f3 la pel\u00edcula que quieres actualizar.", "The movie you want to update was not found."));
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
  const title = movieDisplay(movie).title;
  notify(watched ? t(`"${title}" pasa a ya vistas.`, `"${title}" is now watched.`)
    : t(`"${title}" vuelve a pendientes.`, `"${title}" is unwatched again.`));
}

async function deleteMovie(id) {
  if (sharedBusy()) { notify(t("Espera a que termine la operaci\u00f3n de la party.", "Wait for the party operation to finish.")); return; }
  const movie = movieById(id);
  if (!movie) {
    notify(t("No se encontr\u00f3 la pel\u00edcula que quieres eliminar.", "The movie you want to delete was not found."));
    return;
  }
  if (!canDeletePartyEntry(movie.addedBy)) {
    notify(t("Solo quien a\u00f1adi\u00f3 la pel\u00edcula o el anfitri\u00f3n puede eliminarla de la colecci\u00f3n del grupo.",
      "Only the member who added the movie or the host can delete it from the group collection."));
    return;
  }
  const title = movieDisplay(movie).title;
  if (!window.confirm(t(`\u00bfEliminar "${title}" de la colecci\u00f3n del grupo? Tambi\u00e9n se eliminar\u00e1n todas sus noches programadas y completadas, incluidas las creadas por otros miembros. Este cambio afecta a todo el grupo y no se puede deshacer.`,
    `Delete "${title}" from the group collection? All its scheduled and completed nights will also be deleted, including those created by other members. This affects the whole group and cannot be undone.`))) return;
  const index = [...$("movie-list").children].findIndex((row) => row.contains(document.activeElement));
  cancelSelection();
  if (!await writeParty(`/movies/${encodeURIComponent(id)}`, "DELETE")) return;
  persistState();
  focusAfterRemoval("movie-list", ".delete-movie", Math.max(0, index), `[data-movie-tab="${state.preferences.movieTab}"]`);
  notify(t(`"${title}" y sus noches asociadas se eliminaron de la colecci\u00f3n del grupo.`,
    `"${title}" and its associated nights were deleted from the group collection.`));
}

function renderMovies() {
  const watched = state.movies.filter((movie) => movie.watched).length;
  $("collection-total").textContent = state.movies.length;
  $("pending-count").textContent = state.movies.length - watched;
  $("watched-count").textContent = watched;
  const showWatched = state.preferences.movieTab === "watched";
  document.querySelectorAll("[data-movie-tab]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.movieTab === state.preferences.movieTab));
  });
  const movies = state.movies.filter((movie) => movie.watched === showWatched);
  // Custom additions appear first so the result is visible even in a long collection.
  movies.sort((a, b) => Number(b.custom) - Number(a.custom));
  const fragment = document.createDocumentFragment();
  movies.map(movieDisplay).forEach((movie) => {
    const row = $("movie-row-template").content.firstElementChild.cloneNode(true);
    translateInterface(row);
    row.querySelector(".movie-row-title").textContent = movie.title;
    row.querySelector(".movie-row-meta").textContent = [genreName(movie.genre), movie.year,
      movie.minutes ? `${movie.minutes} min` : null, movie.tmdbId ? "TMDB" : null,
      movie.addedByName ? t(`A\u00f1adida por ${movie.addedByName}`, `Added by ${movie.addedByName}`)
        : movie.custom ? t("A\u00f1adida por ti", "Added by you") : null].filter(Boolean).join(" \u00b7 ");
    const watch = row.querySelector(".watch-toggle");
    watch.dataset.id = movie.id;
    watch.setAttribute("aria-pressed", String(movie.watched));
    watch.setAttribute("aria-label", t(`Marcar ${movie.title} como ${movie.watched ? "pendiente" : "vista"}`,
      `Mark ${movie.title} as ${movie.watched ? "unwatched" : "watched"}`));
    const choose = row.querySelector(".choose-movie");
    choose.dataset.id = movie.id;
    choose.setAttribute("aria-label", t(`Elegir ${movie.title} para mi plan`, `Choose ${movie.title} for my plan`));
    const remove = row.querySelector(".delete-movie");
    remove.dataset.id = movie.id;
    remove.setAttribute("aria-label", t(`Eliminar ${movie.title} de la colecci\u00f3n del grupo`, `Delete ${movie.title} from the group collection`));
    remove.hidden = !canDeletePartyEntry(movie.addedBy);
    remove.disabled = sharedBusy();
    fragment.append(row);
  });
  $("movie-list").replaceChildren(fragment);
  $("movie-list").setAttribute("aria-label", showWatched ? t("Pel\u00edculas ya vistas", "Watched movies") : t("Pel\u00edculas pendientes", "Unwatched movies"));
  $("movie-empty").hidden = movies.length > 0;
  $("movie-empty-title").textContent = showWatched ? t("Aqu\u00ed ir\u00e1n tus historias vividas.", "Your watched stories will appear here.") : t("\u00a1Te has puesto al d\u00eda!", "You're all caught up!");
  $("movie-empty-description").textContent = showWatched ? t("Marca una pel\u00edcula como vista o completa una movie night.", "Mark a movie as watched or complete a movie night.")
    : t("A\u00f1ade otra peli o vuelve a disfrutar de una de tus favoritas.", "Add another movie or enjoy a favorite again.");
}

async function savePlan(event) {
  event?.preventDefault();
  if (sharedBusy()) { notify(t("Espera a que termine la operaci\u00f3n de la party.", "Wait for the party operation to finish.")); return; }
  if (selectionController) {
    notify(t("Espera a que termine de cargar la pel\u00edcula antes de guardar el plan.", "Wait for the movie to finish loading before saving the plan."));
    return;
  }
  const { movieId, foodId } = state.draft;
  if (!movieById(movieId) || !foodById(foodId)) {
    notify(t("Elige una pel\u00edcula y una comida antes de guardar el plan.", "Choose a movie and food before saving the plan."));
    return;
  }
  const dateInput = $("plan-date");
  const placeInput = $("plan-place");
  dateInput.setCustomValidity("");
  placeInput.setCustomValidity("");
  const date = dateInput.value;
  const place = placeInput.value.trim();
  if (!isValidDate(date)) dateInput.setCustomValidity(t("Elige una fecha v\u00e1lida con un a\u00f1o de cuatro cifras.", "Choose a valid date with a four-digit year."));
  if (!place) placeInput.setCustomValidity(t("Escribe d\u00f3nde ser\u00e1 tu movie night.", "Enter the location of your movie night."));
  if (!$("plan-form").reportValidity()) return;

  const duplicate = state.plans.some((plan) => plan.movieId === movieId && plan.foodId === foodId
    && plan.date === date && plan.place.toLocaleLowerCase("es") === place.toLocaleLowerCase("es"));
  if (duplicate) {
    notify(t("Ese plan ya est\u00e1 en tus movie nights.", "That plan is already in your movie nights."));
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
  notify(saved || party.session ? t("Movie night guardada. Ya tienes algo bueno que esperar.", "Movie night saved. Something good to look forward to.")
    : t("Plan creado solo para esta sesi\u00f3n. No se pudo guardar en el navegador.", "Plan created for this session only. It could not be saved in the browser."));
}

async function togglePlan(id) {
  if (sharedBusy()) { notify(t("Espera a que termine la operaci\u00f3n de la party.", "Wait for the party operation to finish.")); return; }
  const plan = state.plans.find((item) => item.id === id);
  if (!plan) {
    notify(t("No se encontr\u00f3 el plan que quieres actualizar.", "The plan you want to update was not found."));
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
  notify(completed ? t("Noche completada y pel\u00edcula marcada como vista.", "Night completed and movie marked as watched.")
    : t("Tu noche vuelve a estar programada.", "Your night is scheduled again."));
}

async function deletePlan(id) {
  if (sharedBusy()) { notify(t("Espera a que termine la operaci\u00f3n de la party.", "Wait for the party operation to finish.")); return; }
  const plan = state.plans.find((item) => item.id === id);
  if (!plan) {
    notify(t("No se encontr\u00f3 el plan que quieres eliminar.", "The plan you want to delete was not found."));
    return;
  }
  const title = movieDisplay(movieById(plan.movieId)).title;
  if (!window.confirm(t(`\u00bfEliminar el plan de "${title}"? La pel\u00edcula seguir\u00e1 en tu colecci\u00f3n.`,
    `Delete the plan for "${title}"? The movie will stay in your collection.`))) return;
  const index = [...$("plan-list").children].findIndex((row) => row.contains(document.activeElement));
  if (party.session) {
    if (!await writeParty(`/plans/${encodeURIComponent(id)}`, "DELETE")) return;
  } else state.plans = state.plans.filter((item) => item.id !== id);
  persistState();
  renderPlans();
  focusAfterRemoval("plan-list", ".delete-plan", Math.max(0, index), `[data-plan-tab="${state.preferences.planTab}"]`);
  notify(t("Plan eliminado. Tu colecci\u00f3n sigue intacta.", "Plan deleted. Your collection is unchanged."));
}

function focusAfterRemoval(listId, selector, index, fallback) {
  const buttons = [...$(listId).querySelectorAll(selector)].filter((button) => !button.hidden);
  const target = buttons[Math.min(index, buttons.length - 1)] || document.querySelector(fallback);
  target.focus({ preventScroll: true });
}

function renderPlans() {
  const completed = state.plans.filter((plan) => plan.completed).length;
  $("nights-total").textContent = state.plans.length;
  $("scheduled-count").textContent = state.plans.length - completed;
  $("completed-count").textContent = completed;
  const showCompleted = state.preferences.planTab === "completed";
  document.querySelectorAll("[data-plan-tab]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.planTab === state.preferences.planTab));
  });
  const plans = state.plans.filter((plan) => plan.completed === showCompleted)
    .sort((a, b) => showCompleted ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date));
  const dateFormatter = new Intl.DateTimeFormat(activeLanguage, { day: "numeric", month: "short", year: "numeric" });
  const fragment = document.createDocumentFragment();
  plans.forEach((plan) => {
    const movie = movieDisplay(movieById(plan.movieId));
    const row = $("plan-row-template").content.firstElementChild.cloneNode(true);
    row.querySelector(".plan-movie-title").textContent = movie.title;
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
  $("theme-label").textContent = genreName(state.theme);
  $("art-caption").textContent = t(MOODS[state.theme], ENGLISH_MOODS[state.theme]);
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

function renderAll() {
  const language = state.preferences.language ?? "es-MX";
  if (language !== activeLanguage) resetCatalogLanguage();
  activeLanguage = language;
  document.documentElement.lang = activeLanguage;
  $("language").value = activeLanguage;
  translateInterface();
  if (storageMessages && !$("storage-notice").hidden) $("storage-notice").textContent = t(...storageMessages);
  renderTheme();
  renderPicker();
  renderMovies();
  renderPlans();
  renderCatalog();
  renderOrganizer();
  $("api-setup-notice").hidden = Boolean(api.baseUrl);
  if (api.error) $("catalog-status").textContent = apiConfigError();
  $("movie-source").value = movieSource();
  $("movie-genre").value = state.preferences.genre;
  $("pending-only").checked = state.preferences.pendingOnly;
  $("auto-food").checked = state.preferences.autoFood;
  $("plan-date").value = state.draft.date;
  $("plan-place").value = state.draft.place;
  renderParty();
}

// Delegated list events continue working after templates are re-rendered.
$("language").addEventListener("change", (event) => changeLanguage(event.target.value));
$("language-retry").addEventListener("click", refreshMovieLanguages);
$("random-movie").addEventListener("click", () => randomMovie());
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
});
$("catalog-previous").addEventListener("click", () => loadCatalog(catalog.page - 1));
$("catalog-next").addEventListener("click", () => loadCatalog(catalog.page + 1));
$("catalog-retry").addEventListener("click", () => loadCatalog(catalog.page));
$("catalog-list").addEventListener("click", (event) => {
  const button = event.target.closest(".choose-catalog-movie");
  if (!button) return;
  const movie = catalog.results.find((item) => item.tmdbId === Number(button.dataset.tmdbId));
  if (movie) chooseCatalogMovie(movie);
  else notify(t("Los resultados han cambiado. Vuelve a elegir una pel\u00edcula.", "Results have changed. Choose a movie again."));
});
$("plan-form").addEventListener("submit", savePlan);
["plan-date", "plan-place"].forEach((id) => {
  $(id).addEventListener("input", (event) => {
    event.target.setCustomValidity("");
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
  $("new-movie-genre").value = state.theme;
  $("new-movie-title").focus();
});
$("cancel-add-movie").addEventListener("click", closeAddMovie);
$("new-movie-title").addEventListener("input", () => $("new-movie-title").setCustomValidity(""));
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
$("theme-toggle").addEventListener("click", () => {
  const open = $("theme-menu").hidden;
  $("theme-menu").hidden = !open;
  $("theme-toggle").setAttribute("aria-expanded", String(open));
  if (open) $("theme-menu").querySelector(":checked").focus();
});
$("theme-menu").addEventListener("change", (event) => {
  if (!event.target.matches('input[name="theme"]')) return;
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
  localizationController?.abort();
  const language = updated.preferences.language ?? "es-MX";
  if (language !== activeLanguage) resetCatalogLanguage();
  state = updated;
  activeLanguage = language;
  storageWritable = true;
  $("storage-notice").hidden = true;
  renderAll();
  refreshMovieLanguages();
  notify(t("La colecci\u00f3n se ha actualizado desde otra pesta\u00f1a.", "Your collection was updated from another tab."));
});

renderAll();
const partyReady = initializeParties();
if (!party.session) refreshMovieLanguages();
