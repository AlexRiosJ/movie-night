const MAX_BODY_BYTES = 32 * 1024;
const SURPRISE_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TOKEN = /^[0-9a-f]{64}$/;
const GENRES = new Set(["spooky", "cozy", "sci-fi", "fantasy", "christmas", "general"]);
const FOODS = new Set(["pizza", "popcorn", "pasta", "snacks", "nachos", "burgers", "hot-chocolate", "sandwiches"]);
const METHODS = "GET, POST, PATCH, DELETE, OPTIONS";
const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const normalized = (value) => value.normalize("NFKC").toLocaleLowerCase("es");

class PartyError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
  });
}

function invalid(message = "Los datos de la solicitud no son v\u00e1lidos.") {
  throw new PartyError(400, message);
}

function text(value, max, { empty = false, multiline = false } = {}) {
  const controls = multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/ : /[\u0000-\u001f\u007f-\u009f]/;
  if (typeof value !== "string" || value.length > max || controls.test(value) || (!empty && !value.trim())) invalid();
  return value.trim();
}

function stringList(value, count, length) {
  if (!Array.isArray(value) || value.length > count) invalid();
  return value.map((item) => text(item, length));
}

function isImagePath(value) {
  return value === null || (typeof value === "string" && /^\/[a-zA-Z0-9_-]+\.(jpg|png)$/i.test(value));
}

function movieId(value) {
  if (typeof value !== "string") invalid("El identificador de pel\u00edcula no es v\u00e1lido.");
  if (UUID.test(value)) return value;
  const match = /^tmdb-([1-9]\d*)$/.exec(value);
  if (!match || !Number.isSafeInteger(Number(match[1]))) invalid("El identificador de pel\u00edcula no es v\u00e1lido.");
  return value;
}

function uuid(value) {
  if (typeof value !== "string" || !UUID.test(value)) invalid("El identificador no es un UUID v\u00e1lido.");
  return value;
}

function validateMovie(value) {
  if (!isRecord(value) || typeof value.custom !== "boolean") invalid();
  const id = movieId(value.id);
  if (!GENRES.has(value.genre)
    || !(value.year === null || (Number.isInteger(value.year) && value.year >= 1888 && value.year <= 2200))
    || !(value.minutes === null || (Number.isInteger(value.minutes) && value.minutes > 0 && value.minutes <= 1000))) invalid();
  const movie = {
    id, title: text(value.title, value.custom ? 120 : 300), genre: value.genre,
    year: value.year, minutes: value.minutes,
    description: text(value.description, 6000, { multiline: true }), custom: value.custom,
  };
  if (value.custom) {
    uuid(id);
    if (value.tmdbId !== undefined) invalid();
    movie.title = movie.title.replace(/\s+/gu, " ");
  } else {
    if (!Number.isSafeInteger(value.tmdbId) || value.tmdbId <= 0 || id !== `tmdb-${value.tmdbId}`
      || !isImagePath(value.posterPath)
      || !(value.rating === null || (Number.isFinite(value.rating) && value.rating >= 0 && value.rating <= 10))) invalid();
    Object.assign(movie, {
      tmdbId: value.tmdbId, posterPath: value.posterPath,
      cast: stringList(value.cast, 12, 120), directors: stringList(value.directors, 6, 120),
      genres: stringList(value.genres, 20, 80), originalTitle: text(value.originalTitle, 300, { empty: true }),
      rating: value.rating,
    });
    if (value.castProfiles !== undefined) {
      if (!Array.isArray(value.castProfiles) || value.castProfiles.length > 12) invalid();
      movie.castProfiles = value.castProfiles.map((person) => {
        if (!isRecord(person) || !isImagePath(person.profilePath)) invalid();
        return { name: text(person.name, 120), profilePath: person.profilePath };
      });
    }
    if (value.voteCount !== undefined) {
      if (value.voteCount !== null && (!Number.isSafeInteger(value.voteCount) || value.voteCount < 0)) invalid();
      movie.voteCount = value.voteCount;
    }
    if (value.language !== undefined) {
      if (!["es-ES", "en-US"].includes(value.language)) invalid();
      movie.language = value.language;
    }
  }
  return movie;
}

function validatePlan(value) {
  if (!isRecord(value) || !FOODS.has(value.foodId) || typeof value.date !== "string"
    || !/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value.date)) invalid();
  const date = new Date(`${value.date}T12:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value.date) invalid("La fecha del plan no es v\u00e1lida.");
  return {
    id: uuid(value.id), movieId: movieId(value.movieId), foodId: value.foodId,
    date: value.date, place: text(value.place, 120),
  };
}

function validateSurprise(value) {
  if (Object.keys(value).some((key) => !["id", "title", "year"].includes(key))
    || typeof value.title !== "string"
    || !(value.year === null || (Number.isInteger(value.year) && value.year >= 1888 && value.year <= 2200))) invalid();
  const title = text(value.title.replace(/\s+/gu, " ").trim(), 120);
  return { id: uuid(value.id), title, year: value.year, titleKey: normalized(title).replace(/\s+/gu, " ").trim() };
}

async function readBody(request) {
  if (request.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    throw new PartyError(415, "Env\u00eda los datos como application/json.");
  }
  const length = request.headers.get("Content-Length");
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_BODY_BYTES)) {
    throw new PartyError(413, "La solicitud supera el l\u00edmite de 32 KB.");
  }
  if (!request.body) invalid("Falta el cuerpo JSON de la solicitud.");
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new PartyError(413, "La solicitud supera el l\u00edmite de 32 KB.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let body;
  try {
    body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    invalid("El cuerpo de la solicitud no contiene JSON v\u00e1lido.");
  }
  if (!isRecord(body)) invalid();
  return body;
}

const hex = (bytes) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
const randomToken = () => hex(crypto.getRandomValues(new Uint8Array(32)));
const hash = async (value) => hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));

function parseRoute(url) {
  if (url.search) invalid("Esta ruta no admite par\u00e1metros de consulta.");
  if (url.pathname === "/parties") return { kind: "create", methods: ["POST"] };
  if (url.pathname === "/parties/join") return { kind: "join", methods: ["POST"] };
  const match = /^\/parties\/([^/]+)(?:\/(movies|plans|surprises)(?:\/([^/]+))?)?$/.exec(url.pathname);
  if (!match || !UUID.test(match[1])) throw new PartyError(404, "Ruta de party no disponible.");
  const [, partyId, collection, id] = match;
  if (!collection) return { kind: "snapshot", partyId, methods: ["GET"] };
  if (collection === "surprises") {
    if (id && id !== "reveal") throw new PartyError(404, "Ruta de party no disponible.");
    return { kind: id ? "reveal" : "surprises", partyId, methods: ["POST"] };
  }
  if (id) {
    if (collection === "movies") movieId(id);
    else uuid(id);
  }
  return { kind: collection, partyId, id, methods: id ? ["PATCH", "DELETE"] : ["POST"] };
}

function snapshotStatements(db, partyId) {
  return [
    db.prepare("SELECT id, name, revision FROM parties WHERE id = ?").bind(partyId),
    db.prepare("SELECT id, name, role FROM party_members WHERE party_id = ? ORDER BY rowid").bind(partyId),
    db.prepare(`SELECT m.metadata, m.watched, m.added_by, a.name AS author_name
      FROM party_movies m JOIN party_members a ON a.party_id = m.party_id AND a.id = m.added_by
      WHERE m.party_id = ? ORDER BY m.rowid`).bind(partyId),
    db.prepare(`SELECT p.id, p.movie_id, p.food_id, p.date, p.place, p.completed, p.created_by, a.name AS author_name
      FROM party_plans p JOIN party_members a ON a.party_id = p.party_id AND a.id = p.created_by
      WHERE p.party_id = ? ORDER BY p.rowid`).bind(partyId),
    db.prepare("SELECT count(*) AS pending_count FROM party_surprises WHERE party_id = ? AND revealed_at IS NULL").bind(partyId),
    db.prepare(`SELECT title, year, revealed_at FROM party_surprises WHERE rowid IN (
      SELECT min(rowid) FROM party_surprises WHERE party_id = ? AND revealed_at IS NOT NULL
      GROUP BY title_key, year
    ) ORDER BY revealed_at DESC`).bind(partyId),
  ];
}

function snapshot(results) {
  const [parties, members, movies, plans, pending, history] = results.slice(-6).map((result) => result.results);
  const party = parties[0];
  if (!party) throw new PartyError(404, "No se encontr\u00f3 la party.");
  return {
    party: { id: party.id, name: party.name }, revision: party.revision, members,
    movies: movies.map((movie) => ({
      ...JSON.parse(movie.metadata), watched: Boolean(movie.watched),
      addedBy: movie.added_by, addedByName: movie.author_name,
    })),
    plans: plans.map((plan) => ({
      id: plan.id, movieId: plan.movie_id, foodId: plan.food_id, date: plan.date, place: plan.place,
      completed: Boolean(plan.completed), createdBy: plan.created_by, createdByName: plan.author_name,
    })),
    surprise: {
      pendingCount: pending[0].pending_count,
      history: history.map((entry) => ({
        title: entry.title, year: entry.year, revealedAt: new Date(entry.revealed_at).toISOString(),
      })),
      nextRevealAt: history.length ? new Date(history[0].revealed_at + SURPRISE_INTERVAL_MS).toISOString() : null,
    },
  };
}

async function mutateSurprise(request, db, route, member) {
  const { partyId, kind } = route;
  if (kind === "reveal" && member.role !== "host") {
    throw new PartyError(403, "Solo el anfitrión puede revelar la sorpresa.");
  }
  const body = await readBody(request);
  const statements = [];
  if (kind === "surprises") {
    const entry = validateSurprise(body);
    // Looking up titles here would leak hidden queue membership through counts and capacity.
    statements.push(db.prepare(`INSERT INTO party_surprises (party_id, id, title, title_key, year)
      SELECT ?, ?, ?, ?, ? WHERE NOT EXISTS
        (SELECT 1 FROM party_surprises WHERE party_id = ? AND id = ?)
      ON CONFLICT (party_id, id) DO NOTHING`)
      .bind(partyId, entry.id, entry.title, entry.titleKey, entry.year, partyId, entry.id));
  } else {
    if (Object.keys(body).length) invalid();
    const now = Date.now();
    // Retire late duplicates only at an eligible host reveal, never during submission or polling.
    statements.push(db.prepare(`UPDATE party_surprises AS pending SET revealed_at = (
        SELECT min(revealed.revealed_at) FROM party_surprises AS revealed
        WHERE revealed.party_id = pending.party_id AND revealed.title_key = pending.title_key
          AND revealed.year IS pending.year AND revealed.revealed_at IS NOT NULL
      ) WHERE pending.party_id = ? AND pending.revealed_at IS NULL AND EXISTS (
        SELECT 1 FROM party_surprises AS revealed
        WHERE revealed.party_id = pending.party_id AND revealed.title_key = pending.title_key
          AND revealed.year IS pending.year AND revealed.revealed_at IS NOT NULL
      ) AND NOT EXISTS (
        SELECT 1 FROM party_surprises WHERE party_id = ? AND revealed_at > ?
      )`).bind(partyId, partyId, now - SURPRISE_INTERVAL_MS));
    // Materialize one random distinct group so each updated duplicate uses the same draw.
    statements.push(db.prepare(`WITH chosen AS MATERIALIZED (
        SELECT title_key, year FROM party_surprises
        WHERE party_id = ? AND revealed_at IS NULL AND NOT EXISTS (
          SELECT 1 FROM party_surprises WHERE party_id = ? AND revealed_at > ?
        )
        GROUP BY title_key, year ORDER BY random() LIMIT 1
      )
      UPDATE party_surprises SET revealed_at = ?
      WHERE party_id = ? AND revealed_at IS NULL AND EXISTS (
        SELECT 1 FROM chosen WHERE chosen.title_key = party_surprises.title_key AND chosen.year IS party_surprises.year
      )`).bind(partyId, partyId, now - SURPRISE_INTERVAL_MS, now, partyId));
  }
  const results = await db.batch([...statements, ...snapshotStatements(db, partyId)]);
  const current = snapshot(results);
  if (kind === "reveal" && !current.surprise.history.length) {
    throw new PartyError(409, "Todavía no hay películas sorpresa para revelar.");
  }
  return json(current);
}

async function authenticate(request, db, partyId) {
  const match = /^Bearer ([0-9a-f]{64})$/i.exec(request.headers.get("Authorization") ?? "");
  if (!match || !TOKEN.test(match[1])) throw new PartyError(401, "Necesitas una sesi\u00f3n de miembro v\u00e1lida.");
  const member = await db.prepare("SELECT id, role FROM party_members WHERE party_id = ? AND token_hash = ?")
    .bind(partyId, await hash(match[1])).first();
  if (!member) throw new PartyError(401, "La sesi\u00f3n no pertenece a esta party o ya no es v\u00e1lida.");
  return member;
}

async function createOrJoin(request, db, route) {
  const body = await readBody(request);
  const name = text(body.displayName, 40);
  const token = randomToken();
  const memberId = crypto.randomUUID();
  const tokenHash = await hash(token);
  let partyId, inviteToken;
  const statements = [];
  if (route.kind === "create") {
    const partyName = text(body.name, 80);
    partyId = crypto.randomUUID();
    inviteToken = randomToken();
    statements.push(db.prepare("INSERT INTO parties (id, name, invite_hash) VALUES (?, ?, ?)")
      .bind(partyId, partyName, await hash(inviteToken)));
  } else {
    if (typeof body.inviteToken !== "string" || !TOKEN.test(body.inviteToken)) invalid("La invitaci\u00f3n no es v\u00e1lida.");
    inviteToken = body.inviteToken;
    const party = await db.prepare("SELECT id FROM parties WHERE invite_hash = ?").bind(await hash(inviteToken)).first();
    if (!party) throw new PartyError(404, "La invitaci\u00f3n no corresponde a ninguna party.");
    partyId = party.id;
  }
  statements.push(db.prepare("INSERT INTO party_members (party_id, id, name, role, token_hash) VALUES (?, ?, ?, ?, ?)")
    .bind(partyId, memberId, name, route.kind === "create" ? "host" : "member", tokenHash));
  const results = await db.batch([...statements, ...snapshotStatements(db, partyId)]);
  return json({ session: { partyId, memberId, token, inviteToken }, snapshot: snapshot(results) }, 201);
}

async function mutate(request, db, route, member) {
  const { partyId, id, kind } = route;
  const statements = [];
  let checkIndex = null;
  let deleting = false;
  if (request.method === "DELETE") {
    deleting = true;
    const table = kind === "movies" ? "party_movies" : "party_plans";
    const author = kind === "movies" ? "added_by" : "created_by";
    statements.push(db.prepare(`SELECT ${author} AS author_id FROM ${table} WHERE party_id = ? AND id = ?`).bind(partyId, id));
    statements.push(db.prepare(`DELETE FROM ${table} WHERE party_id = ? AND id = ? AND (${author} = ? OR ? = 'host')`)
      .bind(partyId, id, member.id, member.role));
  } else {
    const body = await readBody(request);
    if (request.method === "POST" && kind === "movies") {
      const movie = validateMovie(body.movie);
      statements.push(db.prepare(`INSERT INTO party_movies (party_id, id, metadata, custom_title, added_by)
        SELECT ?, ?, ?, ?, ? WHERE NOT EXISTS
          (SELECT 1 FROM party_movies WHERE party_id = ? AND id = ?)
        ON CONFLICT (party_id, id) DO NOTHING`)
        .bind(partyId, movie.id, JSON.stringify(movie), movie.custom ? normalized(movie.title) : null, member.id, partyId, movie.id));
    } else if (request.method === "POST") {
      const plan = validatePlan(body.plan);
      // SELECT makes a missing/cross-party movie an explicit 404 without exposing a foreign-key error.
      statements.push(db.prepare(`INSERT INTO party_plans
        (party_id, id, movie_id, food_id, date, place, place_key, created_by)
        SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS
          (SELECT 1 FROM party_movies WHERE party_id = ? AND id = ?)
        AND NOT EXISTS (SELECT 1 FROM party_plans WHERE party_id = ? AND id = ?)
        ON CONFLICT (party_id, id) DO NOTHING`)
        .bind(partyId, plan.id, plan.movieId, plan.foodId, plan.date, plan.place,
          normalized(plan.place), member.id, partyId, plan.movieId, partyId, plan.id));
      statements.push(db.prepare("SELECT id FROM party_plans WHERE party_id = ? AND id = ?").bind(partyId, plan.id));
      checkIndex = 1;
    } else if (kind === "movies") {
      if (typeof body.watched !== "boolean") invalid("El estado de pel\u00edcula debe ser un booleano.");
      statements.push(db.prepare("UPDATE party_movies SET watched = ? WHERE party_id = ? AND id = ?")
        .bind(Number(body.watched), partyId, id));
      checkIndex = 0;
    } else {
      if (typeof body.completed !== "boolean") invalid("El estado del plan debe ser un booleano.");
      statements.push(db.prepare("UPDATE party_plans SET completed = ? WHERE party_id = ? AND id = ?")
        .bind(Number(body.completed), partyId, id));
      checkIndex = 0;
      if (body.completed) {
        statements.push(db.prepare(`UPDATE party_movies SET watched = 1 WHERE party_id = ?
          AND id = (SELECT movie_id FROM party_plans WHERE party_id = ? AND id = ?)`).bind(partyId, partyId, id));
      }
    }
  }
  // D1 batch is a transaction: row changes, revision triggers and every snapshot query share one commit.
  const results = await db.batch([...statements, ...snapshotStatements(db, partyId)]);
  if (deleting) {
    const entry = results[0].results[0];
    if (!entry) throw new PartyError(404, kind === "movies" ? "No se encontr\u00f3 la pel\u00edcula." : "No se encontr\u00f3 el plan.");
    if (entry.author_id !== member.id && member.role !== "host") {
      throw new PartyError(403, kind === "movies"
        ? "Solo quien a\u00f1adi\u00f3 la pel\u00edcula o el anfitri\u00f3n puede eliminarla."
        : "Solo quien cre\u00f3 el plan o el anfitri\u00f3n puede eliminarlo.");
    }
  } else if (checkIndex !== null) {
    const found = request.method === "POST" ? results[checkIndex].results.length : results[checkIndex].meta.changes;
    if (!found) throw new PartyError(404, "No se encontr\u00f3 la pel\u00edcula o el plan en esta party.");
  }
  return json(snapshot(results));
}

function databaseError(error) {
  const message = [error?.message, error?.cause?.message].filter(Boolean).join(" ");
  for (const [marker, description] of [
    ["party_member_limit", "La party ya tiene el m\u00e1ximo de 50 participantes."],
    ["party_movie_limit", "La party ya tiene el m\u00e1ximo de 200 pel\u00edculas."],
    ["party_plan_limit", "La party ya tiene el m\u00e1ximo de 500 planes."],
    ["party_surprise_limit", "La party ya tiene el máximo de 200 propuestas sorpresa."],
  ]) {
    if (message.includes(marker)) return new PartyError(409, description);
  }
  if (message.includes("UNIQUE constraint failed: party_movies.party_id, party_movies.custom_title")) {
    return new PartyError(409, "Ya existe una pel\u00edcula personalizada con ese t\u00edtulo.");
  }
  if (message.includes("UNIQUE constraint failed: party_plans.party_id, party_plans.movie_id")) {
    return new PartyError(409, "Ese plan ya est\u00e1 guardado en la party.");
  }
  return null;
}

export async function handlePartyRequest(request, env) {
  let route;
  try {
    route = parseRoute(new URL(request.url));
    if (request.method === "OPTIONS") {
      const method = request.headers.get("Access-Control-Request-Method");
      if (method && !route.methods.includes(method)) throw new PartyError(405, "M\u00e9todo no disponible para esta ruta.");
      const headers = request.headers.get("Access-Control-Request-Headers");
      if (headers && headers.split(",").some((header) => !["accept", "authorization", "content-type"].includes(header.trim().toLowerCase()))) {
        invalid("Las cabeceras solicitadas no est\u00e1n permitidas.");
      }
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Methods": METHODS,
          "Access-Control-Allow-Headers": "Accept, Authorization, Content-Type",
          "Access-Control-Max-Age": "600", "Cache-Control": "no-store",
        },
      });
    }
    if (!route.methods.includes(request.method)) throw new PartyError(405, "M\u00e9todo no disponible para esta ruta.");
    if (!env.PARTY_DB) throw new PartyError(503, "Las parties no est\u00e1n disponibles: falta configurar la base de datos PARTY_DB.");
    // A primary-first session also avoids stale reads if D1 read replication is enabled later.
    const db = env.PARTY_DB.withSession ? env.PARTY_DB.withSession("first-primary") : env.PARTY_DB;
    if (route.kind === "create" || route.kind === "join") return await createOrJoin(request, db, route);
    const member = await authenticate(request, db, route.partyId);
    if (route.kind === "snapshot") return json(snapshot(await db.batch(snapshotStatements(db, route.partyId))));
    if (route.kind === "surprises" || route.kind === "reveal") return await mutateSurprise(request, db, route, member);
    return await mutate(request, db, route, member);
  } catch (error) {
    const known = error instanceof PartyError ? error : databaseError(error);
    if (known) {
      return json({ error: known.message }, known.status,
        known.status === 405 ? { Allow: [...(route?.methods ?? []), "OPTIONS"].join(", ") } : {});
    }
    console.error("Movie Night: error en la base de datos de parties", error);
    return json({ error: "No se pudo acceder a la party. Int\u00e9ntalo de nuevo m\u00e1s tarde." }, 500);
  }
}
