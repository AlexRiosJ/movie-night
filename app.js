"use strict";

// A local catalog keeps the app usable without API keys, downloads, or a backend.
const STORAGE_KEY = "movie-night:v1";
const INITIAL_MOVIES = [
  { id: "coraline", genre: "spooky", year: 2009, minutes: 100 },
  { id: "hocus-pocus", genre: "spooky", year: 1993, minutes: 96 },
  { id: "beetlejuice", genre: "spooky", year: 1988, minutes: 92 },
  { id: "addams-family", genre: "spooky", year: 1991, minutes: 99 },
  { id: "fantastic-fox", genre: "cozy", year: 2009, minutes: 87 },
  { id: "harry-sally", genre: "cozy", year: 1989, minutes: 96 },
  { id: "paddington-2", genre: "cozy", year: 2017, minutes: 103 },
  { id: "julie-julia", genre: "cozy", year: 2009, minutes: 123 },
  { id: "interstellar", genre: "sci-fi", year: 2014, minutes: 169 },
  { id: "wall-e", genre: "sci-fi", year: 2008, minutes: 98 },
  { id: "arrival", genre: "sci-fi", year: 2016, minutes: 116 },
  { id: "back-to-future", genre: "sci-fi", year: 1985, minutes: 116 },
  { id: "spirited-away", genre: "fantasy", year: 2001, minutes: 125 },
  { id: "howls-castle", genre: "fantasy", year: 2004, minutes: 119 },
  { id: "stardust", genre: "fantasy", year: 2007, minutes: 127 },
  { id: "princess-bride", genre: "fantasy", year: 1987, minutes: 98 },
  { id: "klaus", genre: "christmas", year: 2019, minutes: 96 },
  { id: "home-alone", genre: "christmas", year: 1990, minutes: 103 },
  { id: "the-holiday", genre: "christmas", year: 2006, minutes: 136 },
  { id: "elf", genre: "christmas", year: 2003, minutes: 97 },
].map((movie) => ({ ...movie, ...TRANSLATIONS.es.movies[movie.id] }));
const FOODS = Object.keys(TRANSLATIONS.es.foods).map((id) => ({ id }));

const $ = (id) => document.getElementById(id);
let language = "es";
let storageWritable = true;
let toastTimer;

function t(key, values = {}) {
  return TRANSLATIONS[language].messages[key].replace(/\{(\w+)\}/g, (_, name) => String(values[name]));
}

function genreName(genre) {
  return TRANSLATIONS[language].genres[genre];
}

// Translate seed content by stable ID, never by changing the saved collection.
function movieCopy(movie) {
  if (!movie.custom && Object.hasOwn(TRANSLATIONS[language].movies, movie.id)) {
    return TRANSLATIONS[language].movies[movie.id];
  }
  return { title: movie.title, description: movie.custom ? t("customDescription") : movie.description };
}

function setFieldError(id, key = "") {
  $(id).dataset.i18nError = key;
  $(id).setCustomValidity(key ? t(key) : "");
}

function renderLanguage() {
  language = state.language ?? "es";
  document.documentElement.lang = language;
  document.querySelectorAll("[data-i18n]").forEach((element) => {
    element.textContent = t(element.dataset.i18n);
  });
  ["aria-label", "placeholder", "content"].forEach((attribute) => {
    document.querySelectorAll(`[data-i18n-${attribute}]`).forEach((element) => {
      element.setAttribute(attribute, t(element.getAttribute(`data-i18n-${attribute}`)));
    });
  });
  document.querySelectorAll("[data-i18n-genre]").forEach((element) => {
    element.textContent = genreName(element.dataset.i18nGenre);
  });
  document.querySelectorAll("[data-language]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.language === language));
  });
  document.querySelectorAll("[data-i18n-error]").forEach((input) => {
    input.setCustomValidity(input.dataset.i18nError ? t(input.dataset.i18nError) : "");
  });
}

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
    language: "es",
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
  return typeof value === "string" && Object.hasOwn(TRANSLATIONS.es.genres, value);
}

// Validate stored data and references before rendering. Damaged data is never overwritten.
function isValidState(value) {
  if (!isRecord(value) || value.version !== 1 || !isGenre(value.theme)
    || (value.language !== undefined && !["en", "es"].includes(value.language))
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

function storageWarning(key, error) {
  $("storage-notice").dataset.i18n = key;
  $("storage-notice").textContent = t(key);
  $("storage-notice").hidden = false;
  if (error) console.error("Movie Night: localStorage", error);
}

function decodeState(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    storageWritable = false;
    storageWarning("storageUnreadable", error);
    return null;
  }
  if (!isValidState(parsed)) {
    storageWritable = false;
    storageWarning("storageIncompatible");
    return null;
  }
  return parsed;
}

function loadState() {
  let raw;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch (error) {
    storageWarning("storageUnavailable", error);
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
    storageWarning("storageUnsaved", error);
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
  const food = FOODS.find((item) => item.id === id);
  return food ? { ...food, ...TRANSLATIONS[language].foods[id] } : undefined;
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
    notify(t("noCandidates"));
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
    notify(t("movieNotFound"));
    return;
  }
  state.draft.movieId = id;
  if (state.preferences.autoFood) state.draft.foodId = pickRandom(FOODS, state.draft.foodId).id;
  persistState();
  renderPicker();
  $("planner").scrollIntoView({ block: "start" });
  $("movie-title").focus({ preventScroll: true });
  notify(t("movieSelected", { title: movieCopy(movie).title }));
}

function renderPicker() {
  const movie = movieById(state.draft.movieId);
  const food = foodById(state.draft.foodId);
  const count = candidates().length;
  const copy = movie ? movieCopy(movie) : null;
  $("movie-badge").textContent = movie ? genreName(movie.genre).toLocaleUpperCase(language) : t("fateBadge");
  $("movie-title").textContent = copy ? copy.title : t("pickerTitle");
  $("movie-meta").textContent = movie
    ? [movie.year, movie.minutes ? `${movie.minutes} min` : null, movie.custom ? t("addedByYou") : null, movie.watched ? t("alreadyWatched") : null].filter(Boolean).join(" \u00b7 ")
    : t(state.movies.length === 1 ? "collectionCountOne" : "collectionCountOther", { count: state.movies.length });
  $("movie-description").textContent = copy ? copy.description : t("pickerDescription");
  $("candidate-count").textContent = count
    ? t(count === 1 ? "candidateCountOne" : "candidateCountOther", { count })
    : t("noOptions");
  $("random-movie").disabled = count === 0;
  $("food-name").textContent = food ? food.name : t("foodPending");
  $("food-description").textContent = food ? food.description : t("foodDescription");
  $("save-plan").disabled = !movie || !food;
  $("plan-hint").textContent = t(movie && food ? "planReady" : "planHint");
}

function normalizedTitle(title) {
  return title.normalize("NFKC").toLowerCase();
}

function matchesMovieTitle(movie, title) {
  const titles = [movie.title];
  if (!movie.custom) {
    Object.values(TRANSLATIONS).forEach((translation) => {
      if (Object.hasOwn(translation.movies, movie.id)) titles.push(translation.movies[movie.id].title);
    });
  }
  return titles.some((candidate) => normalizedTitle(candidate) === normalizedTitle(title));
}

function addMovie(event) {
  event?.preventDefault();
  const input = $("new-movie-title");
  setFieldError("new-movie-title");
  const title = input.value.trim().replace(/\s+/g, " ");
  if (!title) setFieldError("new-movie-title", "titleRequired");
  if (!$("add-movie-form").reportValidity()) return;
  const genre = $("new-movie-genre").value;
  if (!isGenre(genre)) {
    notify(t("invalidGenre"));
    return;
  }
  if (state.movies.some((movie) => matchesMovieTitle(movie, title))) {
    setFieldError("new-movie-title", "duplicateMovie");
    input.reportValidity();
    return;
  }
  state.movies.push({
    id: crypto.randomUUID(), title, genre, year: null, minutes: null,
    description: t("customDescription"),
    watched: false, custom: true,
  });
  state.preferences.movieTab = "pending";
  const saved = persistState();
  $("add-movie-form").reset();
  closeAddMovie();
  renderMovies();
  renderPicker();
  notify(t(saved ? "movieAdded" : "movieAddedSession", { title }));
}

function toggleWatched(id) {
  const movie = movieById(id);
  if (!movie) {
    notify(t("movieUpdateMissing"));
    return;
  }
  const activeIndex = [...$("movie-list").children].findIndex((row) => row.contains(document.activeElement));
  movie.watched = !movie.watched;
  persistState();
  renderMovies();
  renderPicker();
  if (activeIndex >= 0) focusAfterRemoval("movie-list", ".watch-toggle", activeIndex, `[data-movie-tab="${state.preferences.movieTab}"]`);
  notify(t(movie.watched ? "movieWatched" : "moviePending", { title: movieCopy(movie).title }));
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
    const { title } = movieCopy(movie);
    row.querySelector(".movie-row-title").textContent = title;
    row.querySelector(".movie-row-meta").textContent = `${genreName(movie.genre)} \u00b7 ${movie.year ?? t("addedByYou")}`;
    const watch = row.querySelector(".watch-toggle");
    watch.dataset.id = movie.id;
    watch.setAttribute("aria-pressed", String(movie.watched));
    watch.setAttribute("aria-label", t(movie.watched ? "markPending" : "markWatched", { title }));
    const choose = row.querySelector(".choose-movie");
    choose.dataset.id = movie.id;
    choose.setAttribute("aria-label", t("chooseMovie", { title }));
    choose.title = t("chooseMovieTitle");
    fragment.append(row);
  });
  $("movie-list").replaceChildren(fragment);
  $("movie-list").setAttribute("aria-label", t(showWatched ? "watchedMovies" : "pendingMovies"));
  $("movie-empty").hidden = movies.length > 0;
  $("movie-empty-title").textContent = t(showWatched ? "watchedEmptyTitle" : "pendingEmptyTitle");
  $("movie-empty-description").textContent = t(showWatched ? "watchedEmptyDescription" : "pendingEmptyDescription");
}

function savePlan(event) {
  event?.preventDefault();
  const { movieId, foodId } = state.draft;
  if (!movieById(movieId) || !foodById(foodId)) {
    notify(t("planSelectionRequired"));
    return;
  }
  const dateInput = $("plan-date");
  const placeInput = $("plan-place");
  setFieldError("plan-date");
  setFieldError("plan-place");
  const date = dateInput.value;
  const place = placeInput.value.trim();
  if (!isValidDate(date)) setFieldError("plan-date", "invalidDate");
  if (!place) setFieldError("plan-place", "placeRequired");
  if (!$("plan-form").reportValidity()) return;

  const duplicate = state.plans.some((plan) => plan.movieId === movieId && plan.foodId === foodId
    && plan.date === date && plan.place.toLowerCase() === place.toLowerCase());
  if (duplicate) {
    notify(t("duplicatePlan"));
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
  notify(t(saved ? "planSaved" : "planSavedSession"));
}

function togglePlan(id) {
  const plan = state.plans.find((item) => item.id === id);
  if (!plan) {
    notify(t("planUpdateMissing"));
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
  notify(t(plan.completed ? "planCompleted" : "planReopened"));
}

function deletePlan(id) {
  const plan = state.plans.find((item) => item.id === id);
  if (!plan) {
    notify(t("planDeleteMissing"));
    return;
  }
  if (!window.confirm(t("deleteConfirmation", { title: movieCopy(movieById(plan.movieId)).title }))) return;
  const index = [...$("plan-list").children].findIndex((row) => row.contains(document.activeElement));
  state.plans = state.plans.filter((item) => item.id !== id);
  persistState();
  renderPlans();
  focusAfterRemoval("plan-list", ".delete-plan", Math.max(0, index), `[data-plan-tab="${state.preferences.planTab}"]`);
  notify(t("planDeleted"));
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
  const dateFormatter = new Intl.DateTimeFormat(language, { day: "numeric", month: "short", year: "numeric" });
  const fragment = document.createDocumentFragment();
  plans.forEach((plan) => {
    const movie = movieById(plan.movieId);
    const { title } = movieCopy(movie);
    const row = $("plan-row-template").content.firstElementChild.cloneNode(true);
    row.querySelector(".plan-movie-title").textContent = title;
    const time = row.querySelector("time");
    time.dateTime = plan.date;
    time.textContent = dateFormatter.format(new Date(`${plan.date}T12:00:00`));
    row.querySelector(".plan-food").textContent = foodById(plan.foodId).name;
    row.querySelector(".plan-location").textContent = plan.place;
    const toggle = row.querySelector(".complete-plan");
    toggle.dataset.id = plan.id;
    toggle.setAttribute("aria-pressed", String(plan.completed));
    toggle.setAttribute("aria-label", t(plan.completed ? "reopenPlanLabel" : "completePlanLabel", { title }));
    toggle.querySelector("span").textContent = t(plan.completed ? "reopen" : "complete");
    const remove = row.querySelector(".delete-plan");
    remove.dataset.id = plan.id;
    remove.setAttribute("aria-label", t("deletePlanLabel", { title }));
    fragment.append(row);
  });
  $("plan-list").replaceChildren(fragment);
  $("plan-list").setAttribute("aria-label", t(showCompleted ? "completedNights" : "scheduledNights"));
  $("plans-empty").hidden = plans.length > 0;
  $("plans-empty-title").textContent = t(showCompleted ? "completedEmptyTitle" : "scheduledEmptyTitle");
  $("plans-empty-description").textContent = t(showCompleted ? "completedEmptyDescription" : "scheduledEmptyDescription");
  $("empty-plan-link").hidden = showCompleted;
}

function renderTheme() {
  document.documentElement.dataset.theme = state.theme;
  $("theme-label").textContent = genreName(state.theme);
  $("art-caption").textContent = TRANSLATIONS[language].moods[state.theme];
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

function renderContent() {
  renderLanguage();
  renderTheme();
  renderPicker();
  renderMovies();
  renderPlans();
  renderOrganizer();
}

function renderAll() {
  renderContent();
  $("movie-genre").value = state.preferences.genre;
  $("pending-only").checked = state.preferences.pendingOnly;
  $("auto-food").checked = state.preferences.autoFood;
  $("plan-date").value = state.draft.date;
  $("plan-place").value = state.draft.place;
}

// Delegated list events continue working after templates are re-rendered.
document.querySelectorAll("[data-language]").forEach((button) => {
  button.addEventListener("click", () => {
    if (button.dataset.language === language) return;
    state.language = button.dataset.language;
    language = state.language;
    persistState();
    // Do not restore form values here: unfinished input must survive a language change.
    renderContent();
    notify(t("languageChanged"));
  });
});
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
    setFieldError(id);
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
$("new-movie-title").addEventListener("input", () => setFieldError("new-movie-title"));
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
  notify(t("collectionUpdated"));
});

renderAll();
