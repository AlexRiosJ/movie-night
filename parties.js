"use strict";

const PARTY_STORAGE_KEY = "movie-night:parties:v1";
const PARTY_TOKEN = /^[a-f0-9]{64}$/;
const PARTY_ID = /^[a-f0-9-]{36}$/;
const party = {
  session: null, snapshot: null, revision: -1, sessions: [], activeId: null,
  localState: null, loading: false, writing: false, entering: false,
  error: "", errorMessages: null, storageError: "", storageErrorMessages: null,
  storageWritable: true, epoch: 0, timer: null, polling: false,
  formMode: "create", copyStatus: null, surpriseSubmission: null, surpriseStatus: null,
};

class PartyApiError extends LocalizedError {}

function setPartyError(spanish, english) {
  const error = new PartyApiError(spanish, english);
  party.error = error.message;
  party.errorMessages = error.messages;
}

function validPartySession(value) {
  return isRecord(value) && PARTY_ID.test(value.partyId) && PARTY_ID.test(value.memberId)
    && PARTY_TOKEN.test(value.token) && PARTY_TOKEN.test(value.inviteToken)
    && value.apiBaseUrl === api.baseUrl;
}

function partyStorageError(error) {
  party.storageError = "No se pudo recordar la sesi\u00f3n en este navegador. Al cerrar podr\u00edas perder tu identidad; los datos compartidos siguen en el servidor.";
  party.storageErrorMessages = [party.storageError,
    "Your session could not be remembered in this browser. Closing it may lose your identity; shared data remains on the server."];
  console.error("Movie Night: party storage", error);
  renderParty();
}

function rememberParties() {
  if (!party.storageWritable) return;
  try {
    // Merge other tabs' memberships instead of replacing their remembered parties.
    const raw = localStorage.getItem(PARTY_STORAGE_KEY);
    const stored = raw === null ? { version: 1, sessions: [] } : JSON.parse(raw);
    if (stored.version !== 1 || !Array.isArray(stored.sessions)
      || !stored.sessions.every(validPartySession)) throw new TypeError("Invalid party sessions");
    const sessions = new Map(stored.sessions.map((session) => [session.partyId, session]));
    party.sessions.forEach((session) => sessions.set(session.partyId, session));
    party.sessions = [...sessions.values()];
    localStorage.setItem(PARTY_STORAGE_KEY, JSON.stringify({
      version: 1, activeId: party.activeId, sessions: party.sessions,
    }));
  } catch (error) {
    party.storageWritable = false;
    partyStorageError(error);
  }
}

function persistPartyView() {
  try {
    localStorage.setItem(`movie-night:party-view:${party.session.partyId}`, JSON.stringify({
      theme: state.theme, colorMode: state.colorMode, preferences: state.preferences, draft: state.draft,
    }));
    return true;
  } catch (error) {
    partyStorageError(error);
    return false;
  }
}

function loadPartyView(snapshot) {
  const initial = { ...freshState(), theme: state.theme, colorMode: state.colorMode,
    movies: snapshot.movies.map(normalizeMovieGenre), plans: snapshot.plans };
  initial.preferences.language = catalogLanguage();
  try {
    const raw = localStorage.getItem(`movie-night:party-view:${party.session.partyId}`);
    if (raw === null) return initial;
    const view = JSON.parse(raw);
    const candidate = { ...initial, theme: view.theme, colorMode: view.colorMode, preferences: view.preferences, draft: view.draft };
    if (isRecord(candidate.draft) && !snapshot.movies.some((movie) => movie.id === candidate.draft.movieId)) {
      candidate.draft.movieId = null;
    }
    if (!isValidState(candidate)) throw new TypeError("Invalid party preferences");
    return migrateStoredState(candidate);
  } catch (error) {
    partyStorageError(error);
    return initial;
  }
}

function validatePartySnapshot(snapshot, session) {
  if (!isRecord(snapshot) || !isRecord(snapshot.party) || snapshot.party.id !== session.partyId
    || !isText(snapshot.party.name, 80) || !Number.isSafeInteger(snapshot.revision) || snapshot.revision < 0
    || !Array.isArray(snapshot.members) || !snapshot.members.every((member) => isRecord(member)
      && typeof member.id === "string" && PARTY_ID.test(member.id) && isText(member.name, 40)
      && ["host", "member"].includes(member.role))
    || !snapshot.members.some((member) => member.id === session.memberId)
    || new Set(snapshot.members.map((member) => member.id)).size !== snapshot.members.length
    || !isValidState({ ...freshState(), movies: snapshot.movies, plans: snapshot.plans })) {
    throw new PartyApiError("La party devolvi\u00f3 datos no compatibles. No se reemplaz\u00f3 tu lista.",
      "The party returned incompatible data. Your list was not replaced.");
  }
  const authors = new Map(snapshot.members.map((member) => [member.id, member.name]));
  if (!snapshot.movies.every((movie) => authors.has(movie.addedBy) && authors.get(movie.addedBy) === movie.addedByName)
    || !snapshot.plans.every((plan) => authors.has(plan.createdBy) && authors.get(plan.createdBy) === plan.createdByName)) {
    throw new PartyApiError("No se pudo identificar a los autores de la lista compartida.",
      "Could not identify the authors of the shared list.");
  }
  if (snapshot.surprise !== undefined && !validPartySurprise(snapshot.surprise)) {
    throw new PartyApiError("La party devolvi\u00f3 datos de sorpresa no compatibles.",
      "The party returned incompatible surprise data.");
  }
  return snapshot;
}

function validPartySurprise(value) {
  const timestamp = (date) => typeof date === "string" && Number.isFinite(Date.parse(date));
  return isRecord(value) && Number.isInteger(value.pendingCount) && value.pendingCount >= 0
    && value.pendingCount <= 200 && Array.isArray(value.history) && value.history.length <= 200
    && value.history.every((movie) => isRecord(movie) && isText(movie.title, 120)
      && (movie.year === null || (Number.isInteger(movie.year) && movie.year >= 1888 && movie.year <= 2200))
      && timestamp(movie.revealedAt))
    && (value.nextRevealAt === null || timestamp(value.nextRevealAt));
}

async function partyRequest(path, method = "GET", body = null, session = party.session) {
  if (!api.baseUrl) throw new PartyApiError("Configura el Worker y su base de datos para usar parties.",
    "Configure the Worker and its database to use parties.");
  const headers = { Accept: "application/json" };
  if (body !== null) headers["Content-Type"] = "application/json";
  if (session) headers.Authorization = `Bearer ${session.token}`;
  let response;
  let data;
  try {
    response = await fetch(new URL(`${api.baseUrl}${path}`), {
      method, headers, body: body === null ? undefined : JSON.stringify(body),
      credentials: "omit", referrerPolicy: "no-referrer", redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
    data = await response.json();
  } catch (error) {
    if (["TimeoutError", "AbortError"].includes(error.name) || error instanceof TypeError) {
      const messages = method === "GET"
        ? ["No se pudo actualizar la party. Revisa tu conexi\u00f3n y reintenta.",
          "Could not refresh the party. Check your connection and try again."]
        : ["No se pudo confirmar el cambio. Actualiza la party antes de reintentarlo: podr\u00eda haberse guardado.",
          "Could not confirm the change. Refresh the party before retrying: it may have been saved."];
      throw new PartyApiError(...messages);
    }
    if (error instanceof SyntaxError) throw new PartyApiError("El Worker no devolvi\u00f3 datos v\u00e1lidos para la party.",
      "The Worker returned invalid party data.");
    throw error;
  }
  if (!response.ok) {
    if (isRecord(data) && isText(data.error, 500)) throw new PartyApiError(data.error);
    throw new PartyApiError(`No se pudo acceder a la party (HTTP ${response.status}).`,
      `Could not access the party (HTTP ${response.status}).`);
  }
  return data;
}

function reportPartyError(error) {
  if (!(error instanceof PartyApiError)) console.error("Movie Night: party", error);
  if (error instanceof PartyApiError) setPartyError(...error.messages);
  else setPartyError("No se pudo completar la operaci\u00f3n de la party. Reintenta.",
    "Could not complete the party operation. Try again.");
  renderParty();
}

function applyPartySnapshot(snapshot, initial = false) {
  validatePartySnapshot(snapshot, party.session);
  if (!initial && snapshot.revision <= party.revision) return;
  party.snapshot = snapshot;
  party.session.name = snapshot.party.name;
  party.revision = snapshot.revision;
  state = initial ? loadPartyView(snapshot) : { ...state, movies: snapshot.movies.map(normalizeMovieGenre), plans: snapshot.plans };
  if (state.draft.movieId && !movieById(state.draft.movieId)) state.draft.movieId = null;
  if (initial) {
    renderAll();
    refreshSelectedLanguage();
  }
  else {
    const focused = document.activeElement.closest(".watch-toggle, .choose-movie, .delete-movie, .complete-plan, .delete-plan, .choose-catalog-movie");
    const list = focused?.closest("#movie-list, #plan-list, #catalog-list");
    renderPicker();
    renderMovies();
    renderPlans();
    renderCatalog();
    if (list) {
      const replacement = [...list.querySelectorAll("button")].find((button) => !button.hidden
        && button.className === focused.className && button.dataset.id === focused.dataset.id
        && button.dataset.tmdbId === focused.dataset.tmdbId);
      (replacement || document.querySelector(`[data-view="${state.preferences.view}"]`))?.focus({ preventScroll: true });
    }
    refreshSelectedLanguage();
  }
}

function schedulePartyPoll() {
  clearTimeout(party.timer);
  if (party.session && !document.hidden) party.timer = setTimeout(() => refreshParty(), 5000);
}

async function refreshParty() {
  if (!party.session || party.polling || party.writing || party.entering || document.hidden) return;
  const session = party.session;
  const epoch = party.epoch;
  party.polling = true;
  try {
    const snapshot = await partyRequest(`/parties/${session.partyId}`, "GET", null, session);
    if (epoch !== party.epoch) return;
    applyPartySnapshot(snapshot, party.loading);
    party.loading = false;
    party.error = "";
  } catch (error) {
    if (epoch === party.epoch) reportPartyError(error);
  } finally {
    if (epoch === party.epoch) {
      party.polling = false;
      renderParty();
      renderPicker();
      schedulePartyPoll();
    }
  }
}

function activateParty(session, snapshot = null) {
  cancelSelection();
  clearTimeout(party.timer);
  if (!party.session) party.localState = state;
  else if (!party.loading) persistPartyView();
  party.epoch += 1;
  party.session = session;
  party.activeId = session.partyId;
  party.snapshot = null;
  party.revision = -1;
  party.loading = !snapshot;
  party.polling = false;
  party.error = "";
  party.formMode = "create";
  $("party-options").open = false;
  party.copyStatus = null;
  clearSurpriseDraft();
  $("party-copy-status").hidden = true;
  const language = catalogLanguage();
  state = { ...freshState(), theme: state.theme, colorMode: state.colorMode };
  state.preferences.language = language;
  if (snapshot) applyPartySnapshot(snapshot, true);
  else renderAll();
  rememberParties();
  renderParty();
  if (snapshot) schedulePartyPoll();
  else return refreshParty();
}

function leaveParty() {
  if (party.writing || party.entering) {
    notify(["Espera a que termine la operaci\u00f3n antes de cambiar de lista.",
      "Wait for the operation to finish before switching lists."]);
    return;
  }
  cancelSelection();
  clearTimeout(party.timer);
  if (party.session) {
    if (!party.loading) persistPartyView();
    state = party.localState;
  }
  party.epoch += 1;
  clearSurpriseDraft();
  Object.assign(party, {
    session: null, snapshot: null, activeId: null, localState: null,
    revision: -1, loading: false, polling: false, error: "", formMode: "create",
  });
  rememberParties();
  clearPartyInvitation();
  renderAll();
  renderParty();
  closePartyDialog();
  refreshSelectedLanguage();
}

function sharedBusy() {
  return party.loading || party.writing || party.entering;
}

function canDeletePartyEntry(authorId) {
  return Boolean(party.session && (authorId === party.session.memberId
    || party.snapshot?.members.some((member) => member.id === party.session.memberId && member.role === "host")));
}

async function writeParty(path, method, body = null) {
  if (!party.session || sharedBusy()) {
    notify(["Espera a que la party termine de sincronizarse.", "Wait for the party to finish syncing."]);
    return null;
  }
  const session = party.session;
  const epoch = party.epoch;
  party.writing = true;
  renderParty();
  renderPicker();
  try {
    const snapshot = await partyRequest(`/parties/${session.partyId}${path}`, method, body, session);
    if (epoch !== party.epoch) return null;
    applyPartySnapshot(snapshot);
    party.error = "";
    return snapshot;
  } catch (error) {
    if (epoch === party.epoch) reportPartyError(error);
    return null;
  } finally {
    if (epoch === party.epoch) {
      party.writing = false;
      renderParty();
      renderPicker();
      schedulePartyPoll();
    }
  }
}

function inviteFromLocation() {
  const hash = window.location.hash;
  const match = /^#party=([a-f0-9]{64})$/.exec(hash);
  if (hash.startsWith("#party=") && !match) {
    setPartyError("El enlace de invitaci\u00f3n no es v\u00e1lido. Pide un enlace completo.",
      "The invitation link is invalid. Ask for a complete link.");
  }
  return match?.[1] ?? "";
}

function clearPartyInvitation() {
  if (window.location.hash.startsWith("#party=")) {
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
  }
}

function invitationUrl(token) {
  const url = new URL(window.location.href);
  url.hash = `party=${token}`;
  return url.href;
}

function tokenFromInvitation(value) {
  let url;
  try {
    url = new URL(value);
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    throw new PartyApiError("Pega el enlace de invitaci\u00f3n completo que te compartieron.",
      "Paste the complete invitation link that was shared with you.");
  }
  const match = /^#party=([a-f0-9]{64})$/.exec(url.hash);
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || !match) {
    throw new PartyApiError("El enlace de invitaci\u00f3n no es v\u00e1lido. Pide un enlace completo.",
      "The invitation link is invalid. Ask for a complete link.");
  }
  return match[1];
}

function openPartyDialog() {
  closeThemeMenu();
  $("picker-options").open = false;
  if (!$("party-dialog").open) $("party-dialog").showModal();
  $("party-trigger").setAttribute("aria-expanded", "true");
  renderParty();
}

function closePartyDialog() {
  if ($("party-dialog").open) $("party-dialog").close();
}

function setPartyMode(mode) {
  if (sharedBusy()) {
    notify(["Espera a que termine la operaci\u00f3n de la party.", "Wait for the party operation to finish."]);
    return;
  }
  clearPartyInvitation();
  party.formMode = mode;
  party.error = "";
  renderParty();
}

async function submitParty(event) {
  event.preventDefault();
  if (sharedBusy()) return;
  if (!$("party-form").reportValidity()) return;
  let inviteToken = "";
  if (party.formMode === "join") {
    try {
      inviteToken = tokenFromInvitation($("party-join-link").value.trim());
    } catch (error) {
      reportPartyError(error);
      return;
    }
  }
  const displayName = $("party-display-name").value.trim();
  const name = $("party-name").value.trim();
  if (!displayName || (!inviteToken && !name)) {
    setPartyError("Escribe tu nombre y, si creas una party, su nombre.",
      "Enter your name and, if creating a party, its name.");
    renderParty();
    return;
  }
  const remembered = inviteToken && party.sessions.find((session) => session.inviteToken === inviteToken);
  if (remembered) {
    clearPartyInvitation();
    if (party.session?.partyId !== remembered.partyId) await activateParty(remembered);
    else { party.formMode = "create"; $("party-options").open = false; renderParty(); }
    if (!party.loading) closePartyDialog();
    return;
  }
  party.entering = true;
  party.error = "";
  renderParty();
  renderPicker();
  try {
    const data = await partyRequest(inviteToken ? "/parties/join" : "/parties", "POST",
      inviteToken ? { inviteToken, displayName } : { name, displayName }, null);
    const session = isRecord(data) && isRecord(data.session) ? { ...data.session, apiBaseUrl: api.baseUrl } : null;
    if (!validPartySession(session)) throw new PartyApiError("La sesi\u00f3n de la party no es compatible.",
      "The party session is incompatible.");
    validatePartySnapshot(data.snapshot, session);
    party.sessions = party.sessions.filter((saved) => saved.partyId !== session.partyId);
    party.sessions.push(session);
    clearPartyInvitation();
    activateParty(session, data.snapshot);
    $("party-join-link").value = "";
    if (inviteToken) closePartyDialog();
    else if ($("party-dialog").open) $("party-copy").focus();
    notify(inviteToken ? ["Ya formas parte de la party.", "You've joined the party."]
      : ["Party creada. Comparte el enlace para invitar.", "Party created. Share the link to invite others."]);
  } catch (error) {
    reportPartyError(error);
  } finally {
    party.entering = false;
    renderParty();
    renderPicker();
    schedulePartyPoll();
  }
}

function clearSurpriseDraft() {
  party.surpriseSubmission = null;
  party.surpriseStatus = null;
  $("party-surprise-title").value = "";
  $("party-surprise-year").value = "";
  setValidationMessage($("party-surprise-title"));
  setValidationMessage($("party-surprise-year"));
}

async function submitPartySurprise(event) {
  event.preventDefault();
  if (sharedBusy() || !party.snapshot?.surprise || !$("party-surprise-form").reportValidity()) return;
  const title = $("party-surprise-title").value.trim().replace(/\s+/gu, " ");
  const yearValue = $("party-surprise-year").value.trim();
  const year = yearValue ? Number(yearValue) : null;
  if (!title || title.length > 120 || (year !== null && (!Number.isInteger(year) || year < 1888 || year > 2200))) {
    notify(["Escribe un t\u00edtulo y un a\u00f1o v\u00e1lidos para la sorpresa.",
      "Enter a valid title and year for the surprise."]);
    return;
  }
  const previous = party.surpriseSubmission;
  const submission = previous?.title === title && previous.year === year ? previous : {
    id: crypto.randomUUID(), title, year,
  };
  party.surpriseSubmission = submission;
  party.surpriseStatus = null;
  if (!await writeParty("/surprises", "POST", submission)) return;
  clearSurpriseDraft();
  party.surpriseStatus = ["Propuesta recibida de forma an\u00f3nima. Si el t\u00edtulo y a\u00f1o ya estaban, no se duplican.",
    "Proposal received anonymously. If the title and year were already submitted, they are not duplicated."];
  renderPartySurprises();
}

async function revealPartySurprise() {
  if (sharedBusy() || !party.snapshot?.surprise || !party.snapshot.members.some(
    (member) => member.id === party.session.memberId && member.role === "host")) return;
  if (!window.confirm(t("\u00bfYa est\u00e1n reunidos? Se revelar\u00e1 una pel\u00edcula para todos y no habr\u00e1 otro sorteo durante 7 d\u00edas.",
    "Is everyone together? One movie will be revealed to everyone, with no further draw for 7 days."))) return;
  await writeParty("/surprises/reveal", "POST", {});
}

function renderPartySurprises() {
  const surprise = party.snapshot?.surprise;
  const supported = Boolean(surprise);
  $("party-surprises").hidden = !party.session;
  $("party-surprise-form").hidden = !supported;
  $("party-surprise-count").textContent = surprise
    ? t(`${surprise.pendingCount} pel\u00edculas ocultas pendientes.`, `${surprise.pendingCount} hidden movies pending.`)
    : t("Las noches sorpresa requieren actualizar el Worker y su base de datos.",
      "Surprise nights require updating the Worker and its database.");
  $("party-surprise-status").hidden = !party.surpriseStatus;
  $("party-surprise-status").textContent = party.surpriseStatus ? localizedText(party.surpriseStatus) : "";
  const busy = sharedBusy();
  for (const id of ["party-surprise-title", "party-surprise-year", "party-surprise-submit"]) {
    $(id).disabled = busy || !supported;
  }
  $("party-surprise-form").setAttribute("aria-busy", String(party.writing));
  const host = party.snapshot?.members.some((member) => member.id === party.session?.memberId && member.role === "host");
  const next = surprise?.nextRevealAt;
  const waiting = next && Date.parse(next) > Date.now();
  $("party-surprise-reveal").hidden = !supported || !host;
  $("party-surprise-reveal").disabled = busy || !surprise?.pendingCount || Boolean(waiting);
  $("party-surprise-next").textContent = waiting
    ? t(`Pr\u00f3ximo sorteo disponible: ${new Date(next).toLocaleString("es-ES")}.`,
      `Next draw available: ${new Date(next).toLocaleString("en-US")}.`)
    : supported ? t("El anfitri\u00f3n puede revelar una pel\u00edcula cuando se re\u00fanan.",
      "The host can reveal a movie when you meet.") : "";
  const history = document.createDocumentFragment();
  for (const movie of surprise?.history ?? []) {
    const item = document.createElement("li");
    const date = new Date(movie.revealedAt).toLocaleDateString(catalogLanguage());
    item.textContent = `${movie.title}${movie.year === null ? "" : ` (${movie.year})`} \u2014 ${date}`;
    history.append(item);
  }
  $("party-surprise-history").replaceChildren(history);
}

function renderParty() {
  const current = party.snapshot;
  const member = current?.members.find((item) => item.id === party.session.memberId);
  const joining = party.formMode === "join";
  const partyName = current?.party.name || party.session?.name || t("Tu party", "Your party");
  const error = party.error ? localizedText(party.errorMessages?.[0] === party.error ? party.errorMessages : party.error) : "";
  const storageError = party.storageError
    ? localizedText(party.storageErrorMessages?.[0] === party.storageError ? party.storageErrorMessages : party.storageError) : "";
  const warning = [error, storageError].filter(Boolean).join(" ");
  $("party-trigger-name").textContent = party.session ? partyName : t("Modo personal", "Personal mode");
  $("party-trigger-label").textContent = party.session ? t("En party", "In a party") : "Movie party";
  $("party-trigger").dataset.active = String(Boolean(party.session));
  const triggerLabel = party.session
    ? t(`Party: ${partyName}. Ver participantes y compartir enlace.`, `Party: ${partyName}. View participants and share the link.`)
    : t("Party: modo personal. Crear o unirme a una party.", "Party: personal mode. Create or join a party.");
  $("party-trigger").setAttribute("aria-label", triggerLabel + (warning
    ? t(" Hay un aviso pendiente.", " There is a pending notice.") : ""));
  $("party-trigger").title = triggerLabel;
  $("party-trigger-warning").hidden = !warning;
  $("party-notice").textContent = warning;
  $("party-notice").hidden = !warning || $("party-dialog").open;
  $("party-title").textContent = party.session ? partyName : t("Mejor con tu gente.", "Better with your people.");
  $("party-dialog-label").textContent = party.session ? t("TU PARTY", "YOUR PARTY")
    : t("MOVIE NIGHTS, EN COMPA\u00d1\u00cdA", "MOVIE NIGHTS, TOGETHER");
  $("party-identity").textContent = member
    ? t(`Participas como ${member.name}${member.role === "host" ? " (anfitri\u00f3n)" : ""}.`,
      `Joined as ${member.name}${member.role === "host" ? " (host)" : ""}.`)
    : party.session ? t("Esperando la lista compartida.", "Waiting for the shared list.")
      : t("Una lista y un plan para todo el grupo. Tu colecci\u00f3n personal sigue siendo solo tuya.",
        "One list and one plan for the whole group. Your personal collection remains yours alone.");
  $("party-current").hidden = !party.session;
  const names = current?.members.map((item) => item.name).join(", ");
  $("party-members").textContent = current ? t(`Participantes: ${names}`, `Participants: ${names}`) : "";
  $("party-status").textContent = error || (party.writing ? t("Guardando en la party\u2026", "Saving to the party\u2026")
    : party.entering ? t("Preparando tu sesi\u00f3n\u2026", "Preparing your session\u2026")
      : party.loading ? t("Cargando la party\u2026", "Loading the party\u2026")
        : current ? t("Lista compartida. Actualizaci\u00f3n autom\u00e1tica cada 5 segundos.",
          "Shared list. Updates automatically every 5 seconds.") : "");
  $("party-status").setAttribute("role", party.error ? "alert" : "status");
  $("party-status").hidden = !$("party-status").textContent;
  $("party-storage-notice").textContent = storageError;
  $("party-storage-notice").hidden = !party.storageError;
  $("party-copy-status").textContent = party.copyStatus ? localizedText(party.copyStatus) : "";
  $("party-invite").hidden = !party.session;
  if (party.session) $("party-link").value = invitationUrl(party.session.inviteToken);
  $("party-leave").hidden = !party.session && !window.location.hash.startsWith("#party=");
  $("party-leave").disabled = party.writing || party.entering;
  $("party-refresh").hidden = !party.session;
  $("party-refresh").disabled = party.writing || party.entering;
  $("party-refresh").textContent = party.error ? t("Reintentar conexi\u00f3n", "Retry connection")
    : t("Actualizar ahora", "Refresh now");
  $("party-setup-notice").hidden = Boolean(api.baseUrl);
  $("party-create").disabled = sharedBusy() || !api.baseUrl;
  $("party-create").textContent = party.entering ? t("Conectando\u2026", "Connecting\u2026")
    : joining ? t("Unirme a la party", "Join party") : t("Crear party", "Create party");
  $("party-form").setAttribute("aria-busy", String(party.entering));
  $("party-name-field").hidden = joining;
  $("party-name").required = !joining;
  $("party-name").disabled = joining || party.entering;
  $("party-join-field").hidden = !joining;
  $("party-join-link").required = joining;
  $("party-join-link").disabled = !joining || party.entering;
  $("party-display-name").disabled = party.entering;
  $("party-mode-create").setAttribute("aria-pressed", String(!joining));
  $("party-mode-join").setAttribute("aria-pressed", String(joining));
  $("party-mode-create").disabled = sharedBusy();
  $("party-mode-join").disabled = sharedBusy();
  $("party-options-summary").hidden = !party.session;
  if (!party.session) $("party-options").open = true;
  $("party-form-help").textContent = joining
    ? t("Pega la invitaci\u00f3n y escribe tu nombre para entrar a la lista del grupo.",
      "Paste the invitation and enter your name to join the group's list.")
    : t("Crea una lista nueva para tu grupo. Tu colecci\u00f3n personal no se subir\u00e1.",
      "Create a new list for your group. Your personal collection will not be uploaded.");
  $("party-resume").hidden = !party.sessions.some((saved) => saved.partyId !== party.session?.partyId);
  const select = $("party-sessions");
  const previous = select.value;
  const fragment = document.createDocumentFragment();
  party.sessions.filter((saved) => saved.partyId !== party.session?.partyId).forEach((saved) => {
    const option = document.createElement("option");
    option.value = saved.partyId;
    option.textContent = saved.name || `Party ${saved.partyId.slice(0, 8)}`;
    fragment.append(option);
  });
  select.replaceChildren(fragment);
  if (party.sessions.some((saved) => saved.partyId === previous && saved.partyId !== party.session?.partyId)) select.value = previous;
  $("party-resume-button").disabled = sharedBusy();
  $("add-movie-submit").disabled = sharedBusy();
  document.querySelectorAll(".watch-toggle, .delete-movie, .complete-plan, .delete-plan, .choose-catalog-movie").forEach((button) => {
    button.disabled = sharedBusy();
  });
  const collectionLabel = party.session ? t("Colecci\u00f3n del grupo", "Group collection") : t("Mi colecci\u00f3n", "My collection");
  const nightsLabel = party.session ? t("Noches del grupo", "Group nights") : t("Mis noches", "My nights");
  $("collection-label").textContent = collectionLabel;
  $("nights-label").textContent = nightsLabel;
  $("collection-heading").textContent = collectionLabel;
  $("nights-heading").textContent = nightsLabel;
  $("collection-source-label").textContent = collectionLabel;
  $("catalog-help").textContent = party.session
    ? t("Busca un t\u00edtulo o descubre por g\u00e9nero. Elegir y guardar a\u00f1ade la pel\u00edcula a la lista compartida con tu nombre. Para propuestas ocultas, abre la party y usa Noches sorpresa.",
      "Search by title or discover by genre. Choosing and saving adds the movie to the shared list with your name. For hidden proposals, open the party and use Surprise movie nights.")
    : t("Sin t\u00edtulo, descubre pel\u00edculas populares por g\u00e9nero. La b\u00fasqueda por t\u00edtulo incluye todos los g\u00e9neros. Elegir una peli la guarda en tu colecci\u00f3n.",
      "Leave the title empty to discover popular movies by genre. Title searches include all genres. Choosing a movie saves it to your collection.");
  renderPartySurprises();
}

async function followPartyInvitation() {
  const token = inviteFromLocation();
  if (!token && !window.location.hash.startsWith("#party=")) { renderParty(); return; }
  const remembered = party.sessions.find((session) => session.inviteToken === token);
  if (remembered) {
    clearPartyInvitation();
    if (party.session?.partyId !== remembered.partyId) await activateParty(remembered);
    renderParty();
    return;
  }
  party.formMode = "join";
  $("party-join-link").value = window.location.href;
  $("party-options").open = true;
  openPartyDialog();
  $(token ? "party-display-name" : "party-join-link").focus();
}

async function initializeParties() {
  try {
    const raw = localStorage.getItem(PARTY_STORAGE_KEY);
    if (raw !== null) {
      const stored = JSON.parse(raw);
      if (!isRecord(stored) || stored.version !== 1 || !Array.isArray(stored.sessions)
        || !stored.sessions.every(validPartySession)
        || (stored.activeId !== null && !stored.sessions.some((session) => session.partyId === stored.activeId))) {
        throw new TypeError("Invalid party sessions");
      }
      party.sessions = stored.sessions;
      party.activeId = stored.activeId;
    }
  } catch (error) {
    party.storageWritable = false;
    partyStorageError(error);
  }
  $("party-trigger").addEventListener("click", openPartyDialog);
  $("party-close").addEventListener("click", closePartyDialog);
  $("party-dialog").addEventListener("close", () => {
    $("party-trigger").setAttribute("aria-expanded", "false");
    renderParty();
    $("party-trigger").focus({ preventScroll: true });
  });
  $("party-dialog").addEventListener("click", (event) => {
    if (event.target !== $("party-dialog")) return;
    const bounds = $("party-dialog").getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right
      || event.clientY < bounds.top || event.clientY > bounds.bottom) closePartyDialog();
  });
  $("party-mode-create").addEventListener("click", () => setPartyMode("create"));
  $("party-mode-join").addEventListener("click", () => setPartyMode("join"));
  $("party-form").addEventListener("submit", submitParty);
  $("party-surprise-form").addEventListener("submit", submitPartySurprise);
  $("party-surprise-reveal").addEventListener("click", revealPartySurprise);
  $("party-leave").addEventListener("click", leaveParty);
  $("party-refresh").addEventListener("click", refreshParty);
  $("party-resume-button").addEventListener("click", async () => {
    if (sharedBusy()) return;
    const session = party.sessions.find((saved) => saved.partyId === $("party-sessions").value);
    if (session) {
      clearPartyInvitation();
      await activateParty(session);
      if (!party.loading) closePartyDialog();
    }
  });
  $("party-copy").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText($("party-link").value);
      party.copyStatus = ["Enlace copiado. Ya puedes compartirlo con tu grupo.",
        "Link copied. You can now share it with your group."];
    } catch (error) {
      console.error("Movie Night: copy invitation", error);
      $("party-link").focus();
      $("party-link").select();
      party.copyStatus = ["No se pudo copiar autom\u00e1ticamente. Copia el enlace seleccionado.",
        "Could not copy automatically. Copy the selected link."];
    }
    $("party-copy-status").textContent = localizedText(party.copyStatus);
    $("party-copy-status").hidden = false;
  });
  window.addEventListener("hashchange", () => {
    if (sharedBusy()) {
      setPartyError("Espera a que termine la operaci\u00f3n y vuelve a abrir la invitaci\u00f3n.",
        "Wait for the operation to finish, then reopen the invitation.");
      renderParty();
      return;
    }
    followPartyInvitation();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) clearTimeout(party.timer);
    else refreshParty();
  });
  if (window.location.hash.startsWith("#party=")) await followPartyInvitation();
  else {
    const session = party.sessions.find((saved) => saved.partyId === party.activeId);
    if (session) await activateParty(session);
  }
  renderParty();
}
