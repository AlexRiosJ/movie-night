"use strict";

// A local catalog keeps the app usable without API keys, downloads, or a backend.
const STORAGE_KEY = "movie-night:v1";
const GENRES = {
  spooky: "Spooky season",
  cozy: "Cozy oto\u00f1o",
  "sci-fi": "Sci-fi",
  fantasy: "Fantas\u00eda",
  christmas: "Navidad",
};
const MOODS = {
  spooky: "Un poquito de magia.\nUn poquito de misterio.",
  cozy: "Una taza caliente.\nUna historia bonita.",
  "sci-fi": "Pr\u00f3xima parada:\notra galaxia.",
  fantasy: "La magia empieza\ncuando le das al play.",
  christmas: "Luces encendidas.\nCoraz\u00f3n calentito.",
};
const INITIAL_MOVIES = [
  { id: "coraline", title: "Coraline", genre: "spooky", year: 2009, minutes: 100, description: "Una puerta secreta, otro mundo y una buena excusa para abrazar el coj\u00edn." },
  { id: "hocus-pocus", title: "El retorno de las brujas", genre: "spooky", year: 1993, minutes: 96, description: "Brujas, travesuras y una noche con toda la magia de Halloween." },
  { id: "beetlejuice", title: "Beetlejuice", genre: "spooky", year: 1988, minutes: 92, description: "Fantasmas con mucha personalidad y un caos deliciosamente extra\u00f1o." },
  { id: "addams-family", title: "La familia Addams", genre: "spooky", year: 1991, minutes: 99, description: "Una familia peculiar que convierte lo macabro en un plan de lo m\u00e1s acogedor." },
  { id: "fantastic-fox", title: "Fantastic Mr. Fox", genre: "cozy", year: 2009, minutes: 87, description: "Colores de oto\u00f1o, aventuras diminutas y un zorro que no sabe quedarse quieto." },
  { id: "harry-sally", title: "Cuando Harry encontr\u00f3 a Sally", genre: "cozy", year: 1989, minutes: 96, description: "Paseos, conversaciones y esa sensaci\u00f3n de estar justo donde quieres estar." },
  { id: "paddington-2", title: "Paddington 2", genre: "cozy", year: 2017, minutes: 103, description: "Un osito, un poco de mermelada y una dosis generosa de bondad." },
  { id: "julie-julia", title: "Julie & Julia", genre: "cozy", year: 2009, minutes: 123, description: "Recetas, nuevos comienzos y ganas de cocinar algo rico al terminar." },
  { id: "interstellar", title: "Interstellar", genre: "sci-fi", year: 2014, minutes: 169, description: "Un viaje entre las estrellas para recordar lo que nos conecta con casa." },
  { id: "wall-e", title: "WALL\u00b7E", genre: "sci-fi", year: 2008, minutes: 98, description: "Un peque\u00f1o robot con un gran coraz\u00f3n. Prepara las palomitas y los pa\u00f1uelos." },
  { id: "arrival", title: "La llegada", genre: "sci-fi", year: 2016, minutes: 116, description: "Una visita inesperada y una historia para seguir conversando despu\u00e9s." },
  { id: "back-to-future", title: "Regreso al futuro", genre: "sci-fi", year: 1985, minutes: 116, description: "Una aventura a toda velocidad en la que llegar a tiempo lo es todo." },
  { id: "spirited-away", title: "El viaje de Chihiro", genre: "fantasy", year: 2001, minutes: 125, description: "Un mundo de esp\u00edritus, valent\u00eda y peque\u00f1os detalles que se quedan contigo." },
  { id: "howls-castle", title: "El castillo ambulante", genre: "fantasy", year: 2004, minutes: 119, description: "Un castillo que camina y una aventura que invita a mirar m\u00e1s all\u00e1 de las apariencias." },
  { id: "stardust", title: "Stardust", genre: "fantasy", year: 2007, minutes: 127, description: "Estrellas ca\u00eddas, reinos secretos y un viaje con mucho encanto." },
  { id: "princess-bride", title: "La princesa prometida", genre: "fantasy", year: 1987, minutes: 98, description: "Espadas, humor y un cuento perfecto para volver a creer en las aventuras." },
  { id: "klaus", title: "Klaus", genre: "christmas", year: 2019, minutes: 96, description: "Una carta puede ser el comienzo de algo enorme. Una noche llena de calidez." },
  { id: "home-alone", title: "Solo en casa", genre: "christmas", year: 1990, minutes: 103, description: "Trampas imposibles, luces navide\u00f1as y un cl\u00e1sico para compartir." },
  { id: "the-holiday", title: "The Holiday", genre: "christmas", year: 2006, minutes: 136, description: "Cambiar de casa, bajar el ritmo y dejar un hueco para lo inesperado." },
  { id: "elf", title: "Elf", genre: "christmas", year: 2003, minutes: 97, description: "Esp\u00edritu navide\u00f1o a lo grande, incluso lejos del Polo Norte." },
];
const FOODS = [
  { id: "pizza", name: "Pizza para compartir", description: "Tu favorita, reci\u00e9n hecha. La \u00faltima porci\u00f3n se negocia." },
  { id: "popcorn", name: "Palomitas de cine", description: "Dulces o saladas. El cl\u00e1sico que nunca falla." },
  { id: "pasta", name: "Un buen plato de pasta", description: "Tu salsa favorita y una noche sin complicaciones." },
  { id: "snacks", name: "Tabla de snacks", description: "Un poco de queso, fruta, galletas y lo que m\u00e1s te guste." },
  { id: "nachos", name: "Nachos con guacamole", description: "Crujientes, para compartir y con extra de guacamole." },
  { id: "burgers", name: "Hamburguesas caseras", description: "Unas patatas al lado y ya tenemos un plan redondo." },
  { id: "hot-chocolate", name: "Chocolate y galletas", description: "Una taza calentita, algo dulce y tu manta favorita." },
  { id: "sandwiches", name: "S\u00e1ndwiches a la plancha", description: "Pan crujiente, queso fundido y comodidad en cada bocado." },
];

const $ = (id) => document.getElementById(id);
let storageWritable = true;
let toastTimer;

function localToday() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function freshState() {
  return {
    version: 1,
    movies: INITIAL_MOVIES.map((movie) => ({ ...movie, watched: false, custom: false })),
    plans: [],
    theme: "spooky",
    draft: { movieId: null, foodId: null, date: localToday(), place: "" },
    preferences: { genre: "all", pendingOnly: true, autoFood: true, movieTab: "pending", planTab: "scheduled", view: "plans" },
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
  return typeof value === "string" && Object.hasOwn(GENRES, value);
}

// Validate stored data and references before rendering. Damaged data is never overwritten.
function isValidState(value) {
  if (!isRecord(value) || value.version !== 1 || !isGenre(value.theme)
    || !Array.isArray(value.movies) || !Array.isArray(value.plans)
    || !isRecord(value.draft) || !isRecord(value.preferences)) return false;

  const validMovies = value.movies.every((movie) => isRecord(movie)
    && isText(movie.id, 100) && isText(movie.title, 120) && isGenre(movie.genre)
    && typeof movie.watched === "boolean" && typeof movie.custom === "boolean"
    && (movie.year === null || (Number.isInteger(movie.year) && movie.year >= 1888 && movie.year <= 2200))
    && (movie.minutes === null || (Number.isInteger(movie.minutes) && movie.minutes > 0 && movie.minutes <= 1000))
    && isText(movie.description, 500));
  if (!validMovies) return false;

  const movieIds = new Set(value.movies.map((movie) => movie.id));
  if (movieIds.size !== value.movies.length) return false;
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
    && (preferences.view === undefined || ["plans", "movies"].includes(preferences.view));
}

function storageWarning(message, error) {
  $("storage-notice").textContent = message;
  $("storage-notice").hidden = false;
  if (error) console.error("Movie Night: localStorage", error);
}

function decodeState(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    storageWritable = false;
    storageWarning("No se pudieron leer tus datos guardados. Para no sobrescribirlos, los cambios de esta sesi\u00f3n no se guardar\u00e1n.", error);
    return null;
  }
  if (!isValidState(parsed)) {
    storageWritable = false;
    storageWarning("Tus datos guardados tienen un formato no compatible. Se han conservado intactos; los cambios de esta sesi\u00f3n no se guardar\u00e1n.");
    return null;
  }
  return parsed;
}

function loadState() {
  let raw;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch (error) {
    storageWarning("Este navegador no permite leer el almacenamiento local. Tus cambios podr\u00edan perderse al cerrar la p\u00e1gina.", error);
    return freshState();
  }
  return raw === null ? freshState() : (decodeState(raw) ?? freshState());
}

let state = loadState();

function persistState() {
  if (!storageWritable) return false;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    storageWarning("No se pudieron guardar los cambios en este navegador. Por ahora solo est\u00e1n en esta pesta\u00f1a. Revisa el espacio o los permisos de almacenamiento.", error);
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

function foodById(id) {
  return FOODS.find((food) => food.id === id);
}

function candidates() {
  return state.movies.filter((movie) =>
    (state.preferences.genre === "all" || movie.genre === state.preferences.genre)
    && (!state.preferences.pendingOnly || !movie.watched));
}

// Avoid immediate repeats when at least two choices exist; a single choice remains valid.
function pickRandom(items, previousId) {
  const pool = items.length > 1 ? items.filter((item) => item.id !== previousId) : items;
  return pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
}

function randomMovie(forceFood = false) {
  const movie = pickRandom(candidates(), state.draft.movieId);
  if (!movie) {
    notify("No hay pel\u00edculas con estos filtros. Cambia de universo, incluye las vistas o a\u00f1ade una nueva.");
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
  const movie = movieById(id);
  if (!movie) {
    notify("No se encontr\u00f3 esa pel\u00edcula. Vuelve a elegir una de tu colecci\u00f3n.");
    return;
  }
  state.draft.movieId = id;
  if (state.preferences.autoFood) state.draft.foodId = pickRandom(FOODS, state.draft.foodId).id;
  persistState();
  renderPicker();
  $("planner").scrollIntoView({ block: "start" });
  $("movie-title").focus({ preventScroll: true });
  notify(`${movie.title}: lista para tu pr\u00f3ximo plan.`);
}

function renderPicker() {
  const movie = movieById(state.draft.movieId);
  const food = foodById(state.draft.foodId);
  const count = candidates().length;
  $("movie-badge").textContent = movie ? GENRES[movie.genre].toLocaleUpperCase("es") : "QUE DECIDA EL DESTINO";
  $("movie-title").textContent = movie ? movie.title : "Tu pr\u00f3xima favorita te espera.";
  $("movie-meta").textContent = movie
    ? [movie.year, movie.minutes ? `${movie.minutes} min` : null, movie.custom ? "A\u00f1adida por ti" : null, movie.watched ? "Ya vista" : null].filter(Boolean).join(" \u00b7 ")
    : `${state.movies.length} pel\u00edculas en tu colecci\u00f3n.`;
  $("movie-description").textContent = movie ? movie.description : "Pulsa el bot\u00f3n y descubre qu\u00e9 ver esta noche.";
  $("candidate-count").textContent = count
    ? `${count} ${count === 1 ? "pel\u00edcula" : "pel\u00edculas"} en el bombo`
    : "Sin opciones. Abre Preferencias o a\u00f1ade una peli en Mi colecci\u00f3n.";
  $("random-movie").disabled = count === 0;
  $("food-name").textContent = food ? food.name : "Comida por elegir";
  $("food-description").textContent = food ? food.description : "Porque una buena peli merece un buen bocado.";
  $("save-plan").disabled = !movie || !food;
  $("plan-hint").textContent = movie && food ? "Pon fecha y lugar. Lo dem\u00e1s ya est\u00e1." : "Elige una peli y una comida para empezar.";
}

function normalizedTitle(title) {
  return title.normalize("NFKC").toLocaleLowerCase("es");
}

function addMovie(event) {
  event?.preventDefault();
  const input = $("new-movie-title");
  input.setCustomValidity("");
  const title = input.value.trim().replace(/\s+/g, " ");
  if (!title) input.setCustomValidity("Escribe el t\u00edtulo de una pel\u00edcula.");
  if (!$("add-movie-form").reportValidity()) return;
  const genre = $("new-movie-genre").value;
  if (!isGenre(genre)) {
    notify("Elige un universo v\u00e1lido para tu pel\u00edcula.");
    return;
  }
  if (state.movies.some((movie) => normalizedTitle(movie.title) === normalizedTitle(title))) {
    input.setCustomValidity("Esta pel\u00edcula ya est\u00e1 en tu colecci\u00f3n.");
    input.reportValidity();
    return;
  }
  state.movies.push({
    id: crypto.randomUUID(), title, genre, year: null, minutes: null,
    description: "Una de tus elegidas. El mejor motivo para reservar una noche de pel\u00edcula.",
    watched: false, custom: true,
  });
  state.preferences.movieTab = "pending";
  const saved = persistState();
  $("add-movie-form").reset();
  closeAddMovie();
  renderMovies();
  renderPicker();
  notify(saved ? `"${title}" ya est\u00e1 en pendientes.` : "Pel\u00edcula a\u00f1adida solo para esta sesi\u00f3n.");
}

function toggleWatched(id) {
  const movie = movieById(id);
  if (!movie) {
    notify("No se encontr\u00f3 la pel\u00edcula que quieres actualizar.");
    return;
  }
  const activeIndex = [...$("movie-list").children].findIndex((row) => row.contains(document.activeElement));
  movie.watched = !movie.watched;
  persistState();
  renderMovies();
  renderPicker();
  if (activeIndex >= 0) focusAfterRemoval("movie-list", ".watch-toggle", activeIndex, `[data-movie-tab="${state.preferences.movieTab}"]`);
  notify(movie.watched ? `"${movie.title}" pasa a ya vistas.` : `"${movie.title}" vuelve a pendientes.`);
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
  movies.forEach((movie) => {
    const row = $("movie-row-template").content.firstElementChild.cloneNode(true);
    row.querySelector(".movie-row-title").textContent = movie.title;
    row.querySelector(".movie-row-meta").textContent = `${GENRES[movie.genre]} \u00b7 ${movie.year ?? "A\u00f1adida por ti"}`;
    const watch = row.querySelector(".watch-toggle");
    watch.dataset.id = movie.id;
    watch.setAttribute("aria-pressed", String(movie.watched));
    watch.setAttribute("aria-label", `Marcar ${movie.title} como ${movie.watched ? "pendiente" : "vista"}`);
    const choose = row.querySelector(".choose-movie");
    choose.dataset.id = movie.id;
    choose.setAttribute("aria-label", `Elegir ${movie.title} para mi plan`);
    fragment.append(row);
  });
  $("movie-list").replaceChildren(fragment);
  $("movie-list").setAttribute("aria-label", showWatched ? "Pel\u00edculas ya vistas" : "Pel\u00edculas pendientes");
  $("movie-empty").hidden = movies.length > 0;
  $("movie-empty-title").textContent = showWatched ? "Aqu\u00ed ir\u00e1n tus historias vividas." : "\u00a1Te has puesto al d\u00eda!";
  $("movie-empty-description").textContent = showWatched ? "Marca una pel\u00edcula como vista o completa una movie night." : "A\u00f1ade otra peli o vuelve a disfrutar de una de tus favoritas.";
}

function savePlan(event) {
  event?.preventDefault();
  const { movieId, foodId } = state.draft;
  if (!movieById(movieId) || !foodById(foodId)) {
    notify("Elige una pel\u00edcula y una comida antes de guardar el plan.");
    return;
  }
  const dateInput = $("plan-date");
  const placeInput = $("plan-place");
  dateInput.setCustomValidity("");
  placeInput.setCustomValidity("");
  const date = dateInput.value;
  const place = placeInput.value.trim();
  if (!isValidDate(date)) dateInput.setCustomValidity("Elige una fecha v\u00e1lida con un a\u00f1o de cuatro cifras.");
  if (!place) placeInput.setCustomValidity("Escribe d\u00f3nde ser\u00e1 tu movie night.");
  if (!$("plan-form").reportValidity()) return;

  const duplicate = state.plans.some((plan) => plan.movieId === movieId && plan.foodId === foodId
    && plan.date === date && plan.place.toLocaleLowerCase("es") === place.toLocaleLowerCase("es"));
  if (duplicate) {
    notify("Ese plan ya est\u00e1 en tus movie nights.");
    return;
  }
  state.plans.push({ id: crypto.randomUUID(), movieId, foodId, date, place, completed: false });
  state.draft.date = date;
  state.draft.place = place;
  state.preferences.planTab = "scheduled";
  state.preferences.view = "plans";
  placeInput.value = place;
  const saved = persistState();
  renderPlans();
  renderOrganizer();
  notify(saved ? "Movie night guardada. Ya tienes algo bueno que esperar." : "Plan creado solo para esta sesi\u00f3n. No se pudo guardar en el navegador.");
}

function togglePlan(id) {
  const plan = state.plans.find((item) => item.id === id);
  if (!plan) {
    notify("No se encontr\u00f3 el plan que quieres actualizar.");
    return;
  }
  const activeIndex = [...$("plan-list").children].findIndex((row) => row.contains(document.activeElement));
  plan.completed = !plan.completed;
  // Reopening a plan does not erase viewing history; that is an independent library action.
  if (plan.completed) movieById(plan.movieId).watched = true;
  persistState();
  renderPlans();
  renderMovies();
  renderPicker();
  if (activeIndex >= 0) focusAfterRemoval("plan-list", ".complete-plan", activeIndex, `[data-plan-tab="${state.preferences.planTab}"]`);
  notify(plan.completed ? "Noche completada y pel\u00edcula marcada como vista." : "Tu noche vuelve a estar programada.");
}

function deletePlan(id) {
  const plan = state.plans.find((item) => item.id === id);
  if (!plan) {
    notify("No se encontr\u00f3 el plan que quieres eliminar.");
    return;
  }
  if (!window.confirm(`\u00bfEliminar el plan de "${movieById(plan.movieId).title}"? La pel\u00edcula seguir\u00e1 en tu colecci\u00f3n.`)) return;
  const index = [...$("plan-list").children].findIndex((row) => row.contains(document.activeElement));
  state.plans = state.plans.filter((item) => item.id !== id);
  persistState();
  renderPlans();
  focusAfterRemoval("plan-list", ".delete-plan", Math.max(0, index), `[data-plan-tab="${state.preferences.planTab}"]`);
  notify("Plan eliminado. Tu colecci\u00f3n sigue intacta.");
}

function focusAfterRemoval(listId, selector, index, fallback) {
  const buttons = $(listId).querySelectorAll(selector);
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
  const dateFormatter = new Intl.DateTimeFormat("es", { day: "numeric", month: "short", year: "numeric" });
  const fragment = document.createDocumentFragment();
  plans.forEach((plan) => {
    const movie = movieById(plan.movieId);
    const row = $("plan-row-template").content.firstElementChild.cloneNode(true);
    row.querySelector(".plan-movie-title").textContent = movie.title;
    const time = row.querySelector("time");
    time.dateTime = plan.date;
    time.textContent = dateFormatter.format(new Date(`${plan.date}T12:00:00`));
    row.querySelector(".plan-food").textContent = foodById(plan.foodId).name;
    row.querySelector(".plan-location").textContent = plan.place;
    const toggle = row.querySelector(".complete-plan");
    toggle.dataset.id = plan.id;
    toggle.setAttribute("aria-pressed", String(plan.completed));
    toggle.setAttribute("aria-label", `${plan.completed ? "Reabrir" : "Completar"} el plan de ${movie.title}`);
    toggle.querySelector("span").textContent = plan.completed ? "Reabrir" : "Completar";
    const remove = row.querySelector(".delete-plan");
    remove.dataset.id = plan.id;
    remove.setAttribute("aria-label", `Eliminar el plan de ${movie.title}`);
    fragment.append(row);
  });
  $("plan-list").replaceChildren(fragment);
  $("plan-list").setAttribute("aria-label", showCompleted ? "Movie nights completadas" : "Movie nights programadas");
  $("plans-empty").hidden = plans.length > 0;
  $("plans-empty-title").textContent = showCompleted ? "Todav\u00eda no hay noches completadas." : "Todav\u00eda no hay planes.";
  $("plans-empty-description").textContent = showCompleted ? "Cuando completes un plan, aparecer\u00e1 aqu\u00ed." : "Elige una peli y guarda tu primera noche.";
  $("empty-plan-link").hidden = showCompleted;
}

function renderTheme() {
  document.documentElement.dataset.theme = state.theme;
  $("theme-label").textContent = GENRES[state.theme];
  $("art-caption").textContent = MOODS[state.theme];
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
  const focusedPanel = document.activeElement.closest("#collection, #nights");
  $("collection").hidden = view !== "movies";
  $("nights").hidden = view !== "plans";
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.view === view));
  });
  if (focusedPanel?.hidden) {
    document.querySelector(`[data-view="${view}"]`).focus({ preventScroll: true });
  }
}

function renderAll() {
  renderTheme();
  renderPicker();
  renderMovies();
  renderPlans();
  renderOrganizer();
  $("movie-genre").value = state.preferences.genre;
  $("pending-only").checked = state.preferences.pendingOnly;
  $("auto-food").checked = state.preferences.autoFood;
  $("plan-date").value = state.draft.date;
  $("plan-place").value = state.draft.place;
}

// Delegated list events continue working after templates are re-rendered.
$("random-movie").addEventListener("click", () => randomMovie());
$("random-food").addEventListener("click", randomFood);
$("movie-genre").addEventListener("change", (event) => {
  state.preferences.genre = event.target.value;
  persistState();
  renderPicker();
});
$("pending-only").addEventListener("change", (event) => {
  state.preferences.pendingOnly = event.target.checked;
  persistState();
  renderPicker();
});
$("auto-food").addEventListener("change", (event) => {
  state.preferences.autoFood = event.target.checked;
  persistState();
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
  if (watch) toggleWatched(watch.dataset.id);
  if (choose) selectMovie(choose.dataset.id);
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
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => {
      state.preferences.view = button.dataset.view;
      persistState();
      renderOrganizer();
    });
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
  state = updated;
  storageWritable = true;
  $("storage-notice").hidden = true;
  renderAll();
  notify("La colecci\u00f3n se ha actualizado desde otra pesta\u00f1a.");
});

renderAll();
