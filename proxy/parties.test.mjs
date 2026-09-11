import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import worker from "./worker.mjs";
import { D1Database } from "./d1-fixture.mjs";

const ORIGIN = "https://alexriosj.github.io";
const digest = (value) => createHash("sha256").update(value).digest("hex");

function database(t, migrate = true) {
  const db = new D1Database(migrate);
  t.after(() => db.sqlite.close());
  return db;
}

async function api(db, path, { method = "GET", body, token, headers = {}, raw, env = {} } = {}) {
  const requestHeaders = { Origin: ORIGIN, ...headers };
  if (token) requestHeaders.Authorization = `Bearer ${token}`;
  if (body !== undefined || raw !== undefined) {
    requestHeaders["Content-Type"] ??= "application/json";
  }
  const response = await worker.fetch(new Request(`https://api.example.com${path}`, {
    method, headers: requestHeaders, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  }), { ALLOWED_ORIGINS: ORIGIN, PARTY_DB: db, ...env });
  const responseText = await response.text();
  return { status: response.status, headers: response.headers, data: responseText ? JSON.parse(responseText) : null };
}

async function create(db, name = "Nuestras noches", displayName = "Anfitri\u00f3n") {
  const result = await api(db, "/parties", { method: "POST", body: { name, displayName } });
  assert.equal(result.status, 201, JSON.stringify(result.data));
  return result.data;
}

async function join(db, inviteToken, displayName = "Invitado") {
  const result = await api(db, "/parties/join", { method: "POST", body: { inviteToken, displayName } });
  assert.equal(result.status, 201, JSON.stringify(result.data));
  return result.data;
}

const custom = (overrides = {}) => ({
  id: randomUUID(), title: "Una pel\u00edcula", genre: "cozy", year: null, minutes: null,
  description: "Una de nuestras elegidas.", watched: false, custom: true, ...overrides,
});
const tmdb = (overrides = {}) => ({
  id: "tmdb-42", tmdbId: 42, title: "Del cat\u00e1logo", genre: "sci-fi", year: 2024, minutes: 123,
  description: "Sinopsis\ncon varias l\u00edneas.", watched: false, custom: false, posterPath: "/poster.jpg",
  cast: ["Actor"], directors: ["Directora"], genres: ["Ciencia ficci\u00f3n"], originalTitle: "Original",
  castProfiles: [{ name: "Actor", profilePath: "/actor.jpg" }], voteCount: 1200,
  rating: 8.5, ...overrides,
});
const plan = (movieId, overrides = {}) => ({
  id: randomUUID(), movieId, foodId: "pizza", date: "2026-09-10", place: "En casa",
  completed: false, ...overrides,
});
const path = (session, suffix = "") => `/parties/${session.partyId}${suffix}`;
const send = (db, session, suffix = "", options = {}) =>
  api(db, path(session, suffix), { token: session.token, ...options });
const secretMovie = (overrides = {}) => ({ id: randomUUID(), title: "La sorpresa oculta", year: null, ...overrides });
const submitSurprise = (db, session, body) => send(db, session, "/surprises", { method: "POST", body });
const revealSurprise = (db, session, body = {}) => send(db, session, "/surprises/reveal", { method: "POST", body });
const WEEK = 7 * 24 * 60 * 60 * 1000;

function assertSurprisePrivacy(snapshot, secrets, pendingCount, revealed = []) {
  assert.deepEqual(Object.keys(snapshot.surprise).sort(), ["history", "nextRevealAt", "pendingCount"]);
  assert.equal(snapshot.surprise.pendingCount, pendingCount);
  assert.equal(snapshot.surprise.history.length, revealed.length);
  const serialized = JSON.stringify(snapshot);
  for (const secret of secrets) {
    assert.equal(serialized.includes(secret.id), false, "secret identifiers never leave storage");
    if (!revealed.includes(secret.title)) assert.equal(serialized.includes(secret.title), false, "pending title remains hidden");
  }
  for (const entry of snapshot.surprise.history) {
    assert.deepEqual(Object.keys(entry).sort(), ["revealedAt", "title", "year"]);
    assert.ok(revealed.includes(entry.title));
    assert.equal(new Date(entry.revealedAt).toISOString(), entry.revealedAt);
  }
}

async function addMovie(db, session, movie = custom()) {
  const result = await send(db, session, "/movies", { method: "POST", body: { movie } });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  return result.data;
}

async function addPlan(db, session, value) {
  const result = await send(db, session, "/plans", { method: "POST", body: { plan: value } });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  return result.data;
}

test("create/join generate identities, hash credentials, retain duplicate display names and expose only safe snapshots", async (t) => {
  const db = database(t);
  const created = await create(db, "  Nuestra party  ", "  Ana  ");
  assert.match(created.session.partyId, /^[0-9a-f-]{36}$/);
  assert.match(created.session.memberId, /^[0-9a-f-]{36}$/);
  for (const key of ["token", "inviteToken"]) assert.match(created.session[key], /^[0-9a-f]{64}$/);
  assert.notEqual(created.session.token, created.session.inviteToken);
  assert.deepEqual(created.snapshot.party, { id: created.session.partyId, name: "Nuestra party" });
  assert.deepEqual(created.snapshot.members, [{ id: created.session.memberId, name: "Ana", role: "host" }]);
  assert.deepEqual(created.snapshot.movies, []);
  assert.deepEqual(created.snapshot.plans, []);
  const joined = await join(db, created.session.inviteToken, "Ana");
  assert.equal(joined.session.partyId, created.session.partyId);
  assert.equal(joined.session.inviteToken, created.session.inviteToken);
  assert.notEqual(joined.session.memberId, created.session.memberId);
  assert.notEqual(joined.session.token, created.session.token);
  assert.deepEqual(joined.snapshot.members.map(({ name, role }) => ({ name, role })), [
    { name: "Ana", role: "host" }, { name: "Ana", role: "member" },
  ]);
  assert.ok(Number.isSafeInteger(joined.snapshot.revision));
  assert.ok(joined.snapshot.revision > created.snapshot.revision);
  const savedParty = db.sqlite.prepare("SELECT * FROM parties").get();
  const savedMembers = db.sqlite.prepare("SELECT * FROM party_members ORDER BY rowid").all();
  assert.equal(savedParty.invite_hash, digest(created.session.inviteToken));
  assert.deepEqual(savedMembers.map((member) => member.token_hash), [digest(created.session.token), digest(joined.session.token)]);
  const fetched = await send(db, created.session);
  assert.deepEqual(fetched.data, joined.snapshot);
  const serialized = JSON.stringify(fetched.data);
  for (const session of [created.session, joined.session]) {
    for (const secret of [session.token, session.inviteToken, digest(session.token), digest(session.inviteToken)]) {
      assert.equal(serialized.includes(secret), false);
    }
  }
  for (const column of ["token", "token_hash", "invite_hash", "inviteToken"]) assert.equal(serialized.includes(`"${column}"`), false);
  assert.equal(JSON.stringify([savedParty, savedMembers]).includes(created.session.token), false);
  assert.ok(db.sessions.every((constraint) => constraint === "first-primary"));
  assert.equal(db.batches.at(-1).length, 6);
});

test("every private route checks bearer membership in the exact party; invitation and spoofed roles are not authorization", async (t) => {
  const db = database(t);
  const host = (await create(db)).session;
  const other = (await create(db, "Otra party")).session;
  const movie = custom();
  const value = plan(movie.id);
  await addMovie(db, host, movie);
  await addPlan(db, host, value);
  const endpoints = [
    ["", "GET", undefined], ["/movies", "POST", { movie: custom() }],
    [`/movies/${movie.id}`, "PATCH", { watched: true }],
    [`/movies/${movie.id}`, "DELETE", undefined],
    ["/plans", "POST", { plan: plan(movie.id) }],
    [`/plans/${value.id}`, "PATCH", { completed: true }], [`/plans/${value.id}`, "DELETE", undefined],
    ["/surprises", "POST", { id: randomUUID(), title: "Secreta", year: null }],
    ["/surprises/reveal", "POST", {}],
  ];
  const initial = (await send(db, host)).data;
  for (const token of [undefined, "short", "a".repeat(10000), "f".repeat(64), host.inviteToken, other.token]) {
    for (const [suffix, method, body] of endpoints) {
      const result = await api(db, path(host, suffix), { method, body, token });
      assert.equal(result.status, 401, `${method} ${suffix}`);
      assert.equal(typeof result.data.error, "string");
    }
  }
  assert.deepEqual((await send(db, host)).data, initial);
  const spoof = await api(db, "/parties/join", {
    method: "POST", body: { inviteToken: host.inviteToken, displayName: "Miembro", role: "host", id: host.memberId },
  });
  assert.equal(spoof.status, 201);
  assert.notEqual(spoof.data.session.memberId, host.memberId);
  assert.equal(spoof.data.snapshot.members.at(-1).role, "member");
  assert.equal((await api(db, "/parties/join", {
    method: "POST", body: { inviteToken: "f".repeat(64), displayName: "No" },
  })).status, 404);
});

test("movies retain original attribution/content and watched status on retries; normalized custom titles conflict atomically", async (t) => {
  const db = database(t);
  const host = (await create(db)).session;
  const member = (await join(db, host.inviteToken, "Bea")).session;
  const movie = tmdb({ watched: true, addedBy: host.memberId, addedByName: "Falso", role: "host", extra: "not stored" });
  const first = await addMovie(db, member, movie);
  assert.equal(first.movies[0].watched, false);
  assert.equal(first.movies[0].addedBy, member.memberId);
  assert.equal(first.movies[0].addedByName, "Bea");
  assert.equal(first.movies[0].extra, undefined);
  assert.equal(first.movies[0].role, undefined);
  assert.deepEqual(first.movies[0].castProfiles, movie.castProfiles);
  assert.equal(first.movies[0].voteCount, 1200);
  await send(db, host, "/movies/tmdb-42", { method: "PATCH", body: { watched: true } });
  const repeated = await addMovie(db, host, tmdb({ title: "Sobrescribir", watched: false }));
  assert.equal(repeated.movies.length, 1);
  assert.equal(repeated.movies[0].title, movie.title);
  assert.equal(repeated.movies[0].watched, true);
  assert.equal(repeated.movies[0].addedBy, member.memberId);
  const own = custom({ title: "  \uff30\uff25\uff2c\uff29   bonita  " });
  await addMovie(db, host, own);
  const duplicate = await send(db, member, "/movies", {
    method: "POST", body: { movie: custom({ title: "peli bonita" }) },
  });
  assert.equal(duplicate.status, 409);
  assert.match(duplicate.data.error, /t\u00edtulo/);
  const idempotent = await addMovie(db, member, { ...own, title: "Otro t\u00edtulo" });
  assert.equal(idempotent.movies.length, 2);
  assert.equal(idempotent.movies[1].title, "\uff30\uff25\uff2c\uff29 bonita");
  assert.equal(idempotent.movies[1].addedBy, host.memberId);
  assert.equal(db.sqlite.prepare("SELECT count(*) AS n FROM party_movies").get().n, 2);
  await addMovie(db, member, custom({ title: "Otra pel\u00edcula" }));
  const conflictingRetry = await addMovie(db, member, { ...own, title: "Otra pel\u00edcula" });
  assert.equal(conflictingRetry.movies[1].title, "\uff30\uff25\uff2c\uff29 bonita");
  assert.equal(conflictingRetry.movies[1].addedBy, host.memberId);
});

test("movie author or host can delete a movie and all its nights without affecting other movies or parties", async (t) => {
  const db = database(t);
  const host = (await create(db)).session;
  const author = (await join(db, host.inviteToken, "Autora")).session;
  const member = (await join(db, host.inviteToken, "Otro")).session;
  const otherParty = (await create(db, "Otra party")).session;
  const kept = custom({ title: "Conservar" });
  await addMovie(db, host, kept);
  const keptPlan = plan(kept.id);
  await addPlan(db, member, keptPlan);

  for (const [deletingMember, movie] of [[author, custom()], [host, tmdb()]]) {
    await addMovie(db, author, movie);
    const scheduled = plan(movie.id);
    const completed = plan(movie.id, { foodId: "pasta" });
    await addPlan(db, host, scheduled);
    await addPlan(db, member, completed);
    const before = (await send(db, member, `/plans/${completed.id}`, { method: "PATCH", body: { completed: true } })).data;
    await addMovie(db, otherParty, movie);
    const otherBefore = await addPlan(db, otherParty, scheduled);

    const denied = await send(db, member, `/movies/${movie.id}`, { method: "DELETE", body: { role: "host", addedBy: member.memberId } });
    assert.equal(denied.status, 403);
    assert.match(denied.data.error, /anfitri\u00f3n/);
    assert.deepEqual((await send(db, host)).data, before);

    const removed = await send(db, deletingMember, `/movies/${movie.id}`, { method: "DELETE" });
    assert.equal(removed.status, 200, JSON.stringify(removed.data));
    assert.deepEqual(removed.data.movies, before.movies.filter((item) => item.id !== movie.id));
    assert.deepEqual(removed.data.plans, before.plans.filter((item) => item.movieId !== movie.id));
    assert.equal(removed.data.plans[0].id, keptPlan.id);
    assert.equal(removed.data.revision, before.revision + 3);
    assert.deepEqual((await send(db, member)).data, removed.data);
    assert.deepEqual((await send(db, otherParty)).data, otherBefore);
    assert.equal((await send(db, deletingMember, `/movies/${movie.id}`, { method: "DELETE" })).status, 404);
    assert.deepEqual((await send(db, host)).data, removed.data);

    const readded = await addMovie(db, author, movie);
    assert.equal(readded.movies.find((item) => item.id === movie.id).watched, false);
    assert.equal(readded.plans.length, 1);
    const withoutNights = await send(db, author, `/movies/${movie.id}`, { method: "DELETE" });
    assert.equal(withoutNights.status, 200);
    assert.equal(withoutNights.data.revision, readded.revision + 1);
  }
  assert.equal(db.sqlite.prepare("PRAGMA foreign_key_check").all().length, 0);
  assert.equal((await send(db, host, `/movies/${randomUUID()}`, { method: "DELETE" })).status, 404);
  assert.equal((await send(db, host, "/movies/tmdb-0", { method: "DELETE" })).status, 400);
  assert.equal((await send(db, host, "/movies", { method: "DELETE" })).status, 405);
});

test("movie deletion and every dependent night roll back together if the database fails", async (t) => {
  const db = database(t);
  const logged = t.mock.method(console, "error", () => {});
  const host = (await create(db)).session;
  const movie = custom();
  await addMovie(db, host, movie);
  await addPlan(db, host, plan(movie.id));
  const before = await addPlan(db, host, plan(movie.id, { foodId: "pasta" }));
  db.sqlite.exec(`CREATE TRIGGER test_reject_movie_delete AFTER DELETE ON party_movies
    BEGIN SELECT RAISE(ABORT, 'private_delete_failure'); END;`);
  const result = await send(db, host, `/movies/${movie.id}`, { method: "DELETE" });
  assert.equal(result.status, 500);
  assert.equal(JSON.stringify(result.data).includes("private_delete_failure"), false);
  assert.equal(logged.mock.calls.length, 1);
  assert.deepEqual((await send(db, host)).data, before);
  assert.equal(db.sqlite.prepare("PRAGMA foreign_key_check").all().length, 0);
});

test("movie deletion migration preserves an existing party and enables removal of its saved nights", async (t) => {
  const db = database(t, false);
  db.sqlite.exec(readFileSync(new URL("./migrations/0001_parties.sql", import.meta.url), "utf8"));
  db.sqlite.exec(readFileSync(new URL("./migrations/0003_party_surprises.sql", import.meta.url), "utf8"));
  const host = (await create(db)).session;
  const movie = custom();
  await addMovie(db, host, movie);
  const before = await addPlan(db, host, plan(movie.id));
  db.sqlite.exec(readFileSync(new URL("./migrations/0002_movie_deletion.sql", import.meta.url), "utf8"));
  assert.deepEqual((await send(db, host)).data, before);
  const deleted = await send(db, host, `/movies/${movie.id}`, { method: "DELETE" });
  assert.equal(deleted.status, 200);
  assert.deepEqual(deleted.data.movies, []);
  assert.deepEqual(deleted.data.plans, []);
  assert.equal(deleted.data.revision, before.revision + 2);
});

test("surprise submissions stay anonymous and hidden on every snapshot path, including host and ordinary mutations", async (t) => {
  const db = database(t);
  const created = await create(db);
  assert.deepEqual(created.snapshot.surprise, { pendingCount: 0, history: [], nextRevealAt: null });
  const host = created.session;
  const member = (await join(db, host.inviteToken)).session;
  const secrets = [secretMovie(), secretMovie({ title: "Otra sorpresa desconocida", year: 1999 })];
  assertSurprisePrivacy((await submitSurprise(db, member, secrets[0])).data, secrets, 1);
  const submitted = await submitSurprise(db, host, secrets[1]);
  assert.equal(submitted.status, 200);
  assertSurprisePrivacy(submitted.data, secrets, 2);
  assert.equal(submitted.headers.get("Cache-Control"), "no-store");
  assertSurprisePrivacy((await join(db, host.inviteToken, "Tercero")).snapshot, secrets, 2);
  assertSurprisePrivacy((await create(db, "Otra")).snapshot, secrets, 0);
  const movie = custom({ title: "Visible" });
  const scheduled = plan(movie.id);
  const snapshots = [
    (await send(db, host)).data, (await send(db, member)).data,
    await addMovie(db, host, movie), await addPlan(db, member, scheduled),
    (await send(db, member, `/movies/${movie.id}`, { method: "PATCH", body: { watched: true } })).data,
    (await send(db, host, `/plans/${scheduled.id}`, { method: "PATCH", body: { completed: true } })).data,
    (await send(db, member, `/plans/${scheduled.id}`, { method: "DELETE" })).data,
    (await send(db, host, `/movies/${movie.id}`, { method: "DELETE" })).data,
    (await submitSurprise(db, member, secrets[0])).data,
  ];
  for (const snapshot of snapshots) assertSurprisePrivacy(snapshot, secrets, 2);
  assert.deepEqual(db.sqlite.prepare("PRAGMA table_info(party_surprises)").all().map((column) => column.name),
    ["party_id", "id", "title", "title_key", "year", "revealed_at"]);
  assert.deepEqual(db.sqlite.prepare("PRAGMA foreign_key_list(party_surprises)").all().map((key) => key.table), ["parties"]);
  const stored = JSON.stringify(db.sqlite.prepare("SELECT * FROM party_surprises").all());
  for (const session of [host, member]) {
    for (const privateValue of [session.memberId, session.token, digest(session.token)]) {
      assert.equal(stored.includes(privateValue), false);
    }
  }
  const result = await revealSurprise(db, host);
  assert.equal(result.status, 200);
  const revealed = result.data.surprise.history.map((entry) => entry.title);
  assertSurprisePrivacy(result.data, secrets, 1, revealed);
  for (const snapshot of [
    (await send(db, host)).data, (await send(db, member)).data,
    (await join(db, host.inviteToken)).snapshot,
    await addMovie(db, member, movie), await addPlan(db, host, scheduled),
    (await submitSurprise(db, member, secrets[0])).data,
    (await revealSurprise(db, host)).data,
  ]) assertSurprisePrivacy(snapshot, secrets, 1, revealed);
});

test("surprise routes reject guessed access, invalid input, foreign sessions and member reveals", async (t) => {
  const db = database(t);
  const host = (await create(db)).session;
  const member = (await join(db, host.inviteToken)).session;
  const foreign = (await create(db, "Foreign")).session;
  const entry = secretMovie();
  const initial = (await submitSurprise(db, member, entry)).data;
  assert.equal((await revealSurprise(db, member)).status, 403);
  assert.equal((await revealSurprise(db, member, { role: "host" })).status, 403);
  for (const session of [host, member]) {
    for (const suffix of ["/surprises", "/surprises/reveal", `/surprises/${entry.id}`, `/surprises/${entry.id}/reveal`,
      `/movies/${entry.id}`, `/plans/${entry.id}`]) {
      const guessed = await send(db, session, suffix);
      assert.ok([404, 405].includes(guessed.status), suffix);
      assert.equal(JSON.stringify(guessed.data).includes(entry.title), false);
    }
    for (const method of ["PATCH", "DELETE"]) {
      assert.equal((await send(db, session, `/surprises/${entry.id}`, { method, body: {} })).status, 404);
      assert.equal((await send(db, session, `/movies/${entry.id}`, { method, body: { watched: true } })).status, 404);
    }
    assert.equal((await send(db, session, "/plans", { method: "POST", body: { plan: plan(entry.id) } })).status, 404);
  }
  for (const token of [undefined, "invalid", "f".repeat(64), host.inviteToken, foreign.token]) {
    assert.equal((await api(db, path(host, "/surprises"), { method: "POST", token, body: entry })).status, 401);
    assert.equal((await api(db, path(host, "/surprises/reveal"), { method: "POST", token, body: {} })).status, 401);
  }
  for (const changes of [
    { id: "tmdb-42" }, { id: null }, { title: "" }, { title: " \n\t " }, { title: "X".repeat(121) },
    { title: "A\u0000B" }, { title: 123 }, { year: 1887 }, { year: 2201 }, { year: 2000.5 },
    { year: "2000" }, { year: undefined }, { addedBy: member.memberId }, { metadata: { title: "Extra" } },
  ]) {
    assert.equal((await submitSurprise(db, member, secretMovie(changes))).status, 400, JSON.stringify(changes));
  }
  for (const body of [{ id: entry.id }, { title: entry.title }, { revealedAt: "2026-01-01T00:00:00Z" }, { force: true }]) {
    assert.equal((await revealSurprise(db, host, body)).status, 400);
  }
  assert.equal((await send(db, host, "/surprises", { method: "POST", raw: "{" })).status, 400);
  assert.equal((await send(db, host, "/surprises", {
    method: "POST", body: entry, headers: { "Content-Type": "text/plain" },
  })).status, 415);
  assert.equal((await send(db, host, "/surprises/reveal", { method: "POST", body: [] })).status, 400);
  assert.deepEqual((await send(db, host)).data, initial);
  for (const year of [1888, 2200, null]) {
    assert.equal((await submitSurprise(db, host, secretMovie({ title: "Y".repeat(120), year }))).status, 200);
  }
});

test("secret title/year deduplication and client IDs are idempotent across members, pending and revealed", async (t) => {
  const db = database(t);
  const host = (await create(db)).session;
  const member = (await join(db, host.inviteToken)).session;
  const original = secretMovie({ title: " \uff30\uff25\uff2c\uff29 \t bonita\n ", year: 2000 });
  const first = await submitSurprise(db, member, original);
  assert.equal(first.status, 200);
  for (const entry of [
    { ...original, title: "New title", year: 2001 },
    secretMovie({ title: "peli bonita", year: 2000 }),
    secretMovie({ title: "PELI\u00a0BONITA", year: 2000 }),
  ]) assert.deepEqual((await submitSurprise(db, host, entry)).data, first.data);
  const revealed = await revealSurprise(db, host);
  assert.equal(revealed.data.surprise.history[0].title, "\uff30\uff25\uff2c\uff29 bonita");
  assert.deepEqual((await submitSurprise(db, member, original)).data, revealed.data);
  assert.deepEqual((await submitSurprise(db, member, secretMovie({ title: "peli bonita", year: 2000 }))).data, revealed.data);
  for (const year of [null, 2001]) {
    assert.equal((await submitSurprise(db, member, secretMovie({ title: "peli bonita", year }))).status, 200);
  }
  const beforeNullRetry = (await send(db, host)).data;
  assert.deepEqual((await submitSurprise(db, host, secretMovie({ title: "PELI BONITA", year: null }))).data, beforeNullRetry);
  const other = (await create(db, "Other party")).session;
  assert.equal((await submitSurprise(db, other, original)).data.surprise.pendingCount, 1);
  assert.equal(db.sqlite.prepare("SELECT count(*) AS n FROM party_surprises WHERE party_id = ?").get(host.partyId).n, 3);
});

test("weekly reveal is atomic, host-selected only by the server, and retry-safe through cooldown and exhaustion", async (t) => {
  const db = database(t);
  let now = Date.parse("2026-09-01T12:30:00.000Z");
  t.mock.method(Date, "now", () => now);
  const host = (await create(db)).session;
  const before = (await send(db, host)).data;
  const empty = await revealSurprise(db, host);
  assert.equal(empty.status, 409);
  assert.match(empty.data.error, /Todavía no hay/);
  assert.deepEqual((await send(db, host)).data, before);
  const entries = Array.from({ length: 3 }, (_, i) => secretMovie({ title: `Secret choice ${i}`, year: 2000 + i }));
  for (const entry of entries) await submitSurprise(db, host, entry);
  const submitted = (await send(db, host)).data;
  const simultaneous = await Promise.all(Array.from({ length: 12 }, () => revealSurprise(db, host)));
  const first = simultaneous[0].data;
  for (const result of simultaneous) {
    assert.equal(result.status, 200);
    assert.deepEqual(result.data, first);
  }
  assert.equal(first.revision, submitted.revision + 1);
  assert.equal(first.surprise.pendingCount, 2);
  assert.equal(first.surprise.history.length, 1);
  assert.equal(first.surprise.history[0].revealedAt, new Date(now).toISOString());
  assert.equal(first.surprise.nextRevealAt, new Date(now + WEEK).toISOString());
  now += WEEK - 1;
  assert.deepEqual((await revealSurprise(db, host)).data, first);
  now += 1;
  const second = await revealSurprise(db, host);
  assert.equal(second.data.surprise.history.length, 2);
  assert.equal(second.data.surprise.history[0].revealedAt, new Date(now).toISOString());
  assert.deepEqual(second.data.surprise.history[1], first.surprise.history[0]);
  assert.equal(second.data.revision, first.revision + 1);
  now += WEEK * 4;
  const third = await revealSurprise(db, host);
  assert.equal(third.data.surprise.history.length, 3, "elapsed weeks never reveal multiple entries");
  assert.equal(third.data.surprise.pendingCount, 0);
  assert.deepEqual(new Set(third.data.surprise.history.map((entry) => entry.title)), new Set(entries.map((entry) => entry.title)));
  assert.deepEqual((await revealSurprise(db, host)).data, third.data, "empty queue retains this week's reveal");
  now += WEEK;
  assert.deepEqual((await revealSurprise(db, host)).data, third.data, "exhausted queue never repeats a film");
  const newEntry = secretMovie({ title: "Nueva semana" });
  await submitSurprise(db, host, newEntry);
  const fourth = await revealSurprise(db, host);
  assert.equal(fourth.data.surprise.history[0].title, newEntry.title);
  assert.equal(fourth.data.surprise.history.length, 4);
  await submitSurprise(db, host, secretMovie({ title: "Esperar otra semana" }));
  const waiting = (await send(db, host)).data;
  assert.deepEqual((await revealSurprise(db, host)).data, waiting, "submitting cannot reset cooldown");
  assert.deepEqual(waiting.movies, []);
  assert.deepEqual(waiting.plans, []);
});

test("concurrent surprise submissions, reveals and readers see coherent revisions and never skip reveals", async (t) => {
  const db = database(t);
  t.mock.method(Date, "now", () => Date.parse("2026-09-01T00:00:00Z"));
  const host = (await create(db)).session;
  const baseRevision = (await send(db, host)).data.revision;
  const first = secretMovie();
  await submitSurprise(db, host, first);
  const entries = Array.from({ length: 20 }, (_, i) => secretMovie({ title: `Concurrent secret ${i}` }));
  const results = await Promise.all(entries.flatMap((entry) => [
    submitSurprise(db, host, entry), submitSurprise(db, host, { ...entry, id: randomUUID() }),
    revealSurprise(db, host), send(db, host),
  ]));
  for (const result of results) {
    assert.equal(result.status, 200);
    const { pendingCount, history } = result.data.surprise;
    assert.ok(history.length <= 1);
    assert.equal(result.data.revision, baseRevision + pendingCount + 2 * history.length);
    assertSurprisePrivacy(result.data, [first, ...entries], pendingCount, history.map((entry) => entry.title));
  }
  const current = (await send(db, host)).data;
  assert.equal(current.surprise.pendingCount, 20);
  assert.equal(current.surprise.history.length, 1);
  assert.equal(current.revision, baseRevision + 22);
});

test("surprise capacity counts history, is enforced atomically, and still permits generic duplicate retries", async (t) => {
  const db = database(t);
  const host = (await create(db)).session;
  const entries = Array.from({ length: 201 }, (_, i) => secretMovie({ title: `Capacity secret ${i}` }));
  for (const entry of entries.slice(0, 199)) {
    assert.equal((await submitSurprise(db, host, entry)).status, 200);
  }
  const last = await Promise.all(entries.slice(199).map((entry) => submitSurprise(db, host, entry)));
  assert.deepEqual(last.map((result) => result.status).sort(), [200, 409]);
  assert.match(last.find((result) => result.status === 409).data.error, /200 películas sorpresa/);
  const full = (await send(db, host)).data;
  assert.equal(full.surprise.pendingCount, 200);
  assert.deepEqual((await submitSurprise(db, host, entries[0])).data, full);
  assert.deepEqual((await submitSurprise(db, host, { ...entries[0], id: randomUUID() })).data, full);
  const revealed = (await revealSurprise(db, host)).data;
  assert.equal(revealed.surprise.pendingCount, 199);
  assert.equal(revealed.surprise.history.length, 1);
  const history = revealed.surprise.history[0];
  assert.deepEqual((await submitSurprise(db, host, secretMovie({ title: history.title, year: history.year }))).data, revealed);
  assert.equal((await submitSurprise(db, host, secretMovie({ title: "No space even after reveal" }))).status, 409);
  assert.deepEqual((await send(db, host)).data, revealed);
  assert.equal((await addMovie(db, host, custom())).movies.length, 1, "ordinary movies remain independent");
});

test("surprise write, revision and snapshot queries roll back together on database failures", async (t) => {
  const db = database(t);
  t.mock.method(console, "error", () => {});
  const host = (await create(db)).session;
  const entry = secretMovie();
  await submitSurprise(db, host, entry);
  const before = (await send(db, host)).data;
  db.sqlite.exec(`CREATE TRIGGER test_surprise_reveal_failure AFTER UPDATE ON party_surprises
    BEGIN SELECT RAISE(ABORT, 'private_surprise_failure'); END;`);
  const failedReveal = await revealSurprise(db, host);
  assert.equal(failedReveal.status, 500);
  assert.equal(JSON.stringify(failedReveal.data).includes(entry.title), false);
  assert.deepEqual((await send(db, host)).data, before);
  db.sqlite.exec("DROP TRIGGER test_surprise_reveal_failure");
  const originalBatch = db.batch.bind(db);
  t.mock.method(db, "batch", (statements) => originalBatch([
    ...statements, db.prepare("SELECT * FROM missing_snapshot_table"),
  ]));
  assert.equal((await submitSurprise(db, host, secretMovie({ title: "Rollback me" }))).status, 500);
  assert.equal((await revealSurprise(db, host)).status, 500);
  t.mock.restoreAll();
  assert.deepEqual((await send(db, host)).data, before);
});

test("additive surprise migration preserves existing members, credentials, movies, plans and revisions", async (t) => {
  const db = database(t, false);
  for (const file of ["0001_parties.sql", "0002_movie_deletion.sql"]) {
    db.sqlite.exec(readFileSync(new URL(`./migrations/${file}`, import.meta.url), "utf8"));
  }
  const partyId = randomUUID(), memberId = randomUUID();
  const token = "b".repeat(64);
  const movie = custom();
  const scheduled = plan(movie.id);
  db.sqlite.prepare("INSERT INTO parties (id, name, invite_hash) VALUES (?, ?, ?)").run(partyId, "Existing", digest("old invite"));
  db.sqlite.prepare("INSERT INTO party_members (party_id, id, name, role, token_hash) VALUES (?, ?, ?, ?, ?)")
    .run(partyId, memberId, "Existing host", "host", digest(token));
  db.sqlite.prepare("INSERT INTO party_movies (party_id, id, metadata, custom_title, added_by, watched) VALUES (?, ?, ?, ?, ?, 1)")
    .run(partyId, movie.id, JSON.stringify(movie), movie.title, memberId);
  db.sqlite.prepare(`INSERT INTO party_plans
    (party_id, id, movie_id, food_id, date, place, place_key, created_by, completed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`)
    .run(partyId, scheduled.id, movie.id, scheduled.foodId, scheduled.date, scheduled.place, scheduled.place, memberId);
  const tables = ["parties", "party_members", "party_movies", "party_plans"];
  const before = tables.map((table) => db.sqlite.prepare(`SELECT * FROM ${table}`).all());
  db.sqlite.exec(readFileSync(new URL("./migrations/0003_party_surprises.sql", import.meta.url), "utf8"));
  assert.deepEqual(tables.map((table) => db.sqlite.prepare(`SELECT * FROM ${table}`).all()), before);
  assert.deepEqual(db.sqlite.prepare("PRAGMA foreign_key_check").all(), []);
  const session = { partyId, token, memberId };
  const result = await send(db, session);
  assert.equal(result.status, 200);
  assert.equal(result.data.revision, before[0][0].revision);
  assert.deepEqual(result.data.surprise, { pendingCount: 0, history: [], nextRevealAt: null });
  assert.equal(result.data.movies[0].watched, true);
  assert.equal(result.data.plans[0].completed, true);
  assert.equal((await submitSurprise(db, session, secretMovie())).status, 200);
  assert.equal((await revealSurprise(db, session)).status, 200);
  assert.deepEqual(tables.slice(1).map((table) => db.sqlite.prepare(`SELECT * FROM ${table}`).all()), before.slice(1));
});

test("simultaneous additions preserve distinct rows and consistent monotonic snapshots, including TMDB conflicts", async (t) => {
  const db = database(t);
  const host = (await create(db)).session;
  const member = (await join(db, host.inviteToken)).session;
  const movies = Array.from({ length: 20 }, (_, i) => custom({ title: `Pel\u00edcula ${i}` }));
  const snapshots = await Promise.all(movies.map((movie, i) => addMovie(db, i % 2 ? host : member, movie)));
  const ordered = snapshots.toSorted((a, b) => a.revision - b.revision);
  for (let i = 0; i < ordered.length; i++) {
    assert.equal(ordered[i].movies.length, i + 1);
    if (i) assert.ok(ordered[i].revision > ordered[i - 1].revision);
    for (const movie of ordered[i].movies) {
      assert.ok(ordered[i].members.some((author) => author.id === movie.addedBy && author.name === movie.addedByName));
    }
  }
  const duplicateSnapshots = await Promise.all([addMovie(db, host, tmdb()), addMovie(db, member, tmdb())]);
  const final = (await send(db, host)).data;
  assert.equal(final.movies.length, 21);
  assert.deepEqual(new Set(final.movies.filter((movie) => movie.custom).map((movie) => movie.id)), new Set(movies.map((movie) => movie.id)));
  const saved = final.movies.find((movie) => movie.id === "tmdb-42");
  for (const value of duplicateSnapshots) assert.deepEqual(value.movies.find((movie) => movie.id === "tmdb-42"), saved);
});

test("plans derive authors, are idempotent, reject duplicate tuples and isolate movie references", async (t) => {
  const db = database(t);
  const host = (await create(db)).session;
  const member = (await join(db, host.inviteToken, "Bea")).session;
  const other = (await create(db, "Otra")).session;
  const movie = custom();
  await addMovie(db, host, movie);
  const value = plan(movie.id, { completed: true, createdBy: host.memberId, createdByName: "Falso" });
  const first = await addPlan(db, member, value);
  assert.equal(first.plans[0].completed, false);
  assert.equal(first.plans[0].createdBy, member.memberId);
  assert.equal(first.plans[0].createdByName, "Bea");
  const repeated = await addPlan(db, host, { ...value, foodId: "pasta", place: "Otra casa" });
  assert.deepEqual(repeated.plans, first.plans);
  const duplicate = await send(db, host, "/plans", {
    method: "POST", body: { plan: plan(movie.id, { place: "\uff25\uff2e CASA" }) },
  });
  assert.equal(duplicate.status, 409);
  assert.equal((await send(db, other, "/plans", { method: "POST", body: { plan: plan(movie.id) } })).status, 404);
  assert.equal((await send(db, host, "/plans", { method: "POST", body: { plan: plan(randomUUID()) } })).status, 404);
  assert.equal((await send(db, host)).data.plans.length, 1);
  assert.equal((await send(db, other)).data.plans.length, 0);
  await addPlan(db, host, plan(movie.id, { foodId: "pasta" }));
  const conflictingRetry = await addPlan(db, host, { ...value, foodId: "pasta" });
  assert.equal(conflictingRetry.plans[0].foodId, "pizza");
  assert.equal(conflictingRetry.plans[0].createdBy, member.memberId);
});

test("all members toggle plans/movies; completion is sticky and only creator or host deletes", async (t) => {
  const db = database(t);
  const host = (await create(db)).session;
  const creator = (await join(db, host.inviteToken, "Autora")).session;
  const other = (await join(db, host.inviteToken, "Otro")).session;
  const movie = custom();
  const value = plan(movie.id);
  await addMovie(db, host, movie);
  await addPlan(db, creator, value);
  const complete = await send(db, other, `/plans/${value.id}`, { method: "PATCH", body: { completed: true, createdBy: other.memberId } });
  assert.equal(complete.status, 200);
  assert.equal(complete.data.plans[0].completed, true);
  assert.equal(complete.data.movies[0].watched, true);
  assert.equal(complete.data.plans[0].createdBy, creator.memberId);
  const retried = await addPlan(db, host, { ...value, completed: false });
  assert.equal(retried.plans[0].completed, true);
  const reopened = await send(db, other, `/plans/${value.id}`, { method: "PATCH", body: { completed: false } });
  assert.equal(reopened.data.plans[0].completed, false);
  assert.equal(reopened.data.movies[0].watched, true);
  const denied = await send(db, other, `/plans/${value.id}`, { method: "DELETE" });
  assert.equal(denied.status, 403);
  assert.deepEqual((await send(db, host)).data, reopened.data);
  const removed = await send(db, creator, `/plans/${value.id}`, { method: "DELETE" });
  assert.equal(removed.status, 200);
  assert.deepEqual(removed.data.plans, []);
  assert.equal(removed.data.movies[0].watched, true);
  await addPlan(db, creator, value);
  assert.equal((await send(db, host, `/plans/${value.id}`, { method: "DELETE" })).status, 200);
  const unwatched = await send(db, other, `/movies/${movie.id}`, { method: "PATCH", body: { watched: false } });
  assert.equal(unwatched.data.movies[0].watched, false);
  for (const [suffix, method, body] of [
    [`/plans/${value.id}`, "DELETE"], [`/plans/${value.id}`, "PATCH", { completed: true }],
    [`/movies/${randomUUID()}`, "PATCH", { watched: true }],
  ]) {
    assert.equal((await send(db, host, suffix, { method, body })).status, 404);
  }
});

test("completion, watched status and revision roll back together on a real SQLite trigger failure", async (t) => {
  const db = database(t);
  const logged = t.mock.method(console, "error", () => {});
  const host = (await create(db)).session;
  const movie = custom();
  const value = plan(movie.id);
  await addMovie(db, host, movie);
  const before = await addPlan(db, host, value);
  db.sqlite.exec(`CREATE TRIGGER test_reject_watched BEFORE UPDATE ON party_movies
    BEGIN SELECT RAISE(ABORT, 'private_database_failure'); END;`);
  const result = await send(db, host, `/plans/${value.id}`, { method: "PATCH", body: { completed: true } });
  assert.equal(result.status, 500);
  assert.equal(JSON.stringify(result.data).includes("private_database_failure"), false);
  assert.equal(result.headers.get("Cache-Control"), "no-store");
  assert.equal(logged.mock.calls.length, 1);
  assert.deepEqual((await send(db, host)).data, before);
});

test("party names, display names and invite format are bounded, nonblank and control-free", async (t) => {
  const db = database(t);
  for (const value of ["", " ", "\nAna", "Ana\u0000", "Ana\u0085", 12, null, "A".repeat(41)]) {
    assert.equal((await api(db, "/parties", { method: "POST", body: { name: "Party", displayName: value } })).status, 400);
  }
  for (const value of ["", " ", "\tParty", "A".repeat(81), {}, null]) {
    assert.equal((await api(db, "/parties", { method: "POST", body: { name: value, displayName: "Ana" } })).status, 400);
  }
  for (const value of ["", "a".repeat(63), "a".repeat(65), "A".repeat(64), null, 42]) {
    assert.equal((await api(db, "/parties/join", { method: "POST", body: { inviteToken: value, displayName: "Ana" } })).status, 400);
  }
  const result = await create(db, "P".repeat(80), "A".repeat(40));
  assert.equal(result.snapshot.party.name.length, 80);
  assert.equal(result.snapshot.members[0].name.length, 40);
  assert.equal(db.sqlite.prepare("SELECT count(*) AS n FROM parties").get().n, 1);
});

test("movie and plan payloads enforce frontend maxima, canonical IDs, known values and calendar dates", async (t) => {
  const db = database(t);
  const host = (await create(db)).session;
  for (const overrides of [
    { title: "T".repeat(121) }, { id: "legacy" }, { id: "tmdb-1" }, { tmdbId: 1 },
    { title: "\nBad" }, { title: "" }, { genre: "all" }, { year: 1887 }, { year: 2201 },
    { minutes: 0 }, { minutes: 1001 }, { description: "D".repeat(6001) }, { custom: "true" },
  ]) {
    const result = await send(db, host, "/movies", { method: "POST", body: { movie: custom(overrides) } });
    assert.equal(result.status, 400, JSON.stringify(overrides));
  }
  for (const overrides of [
    { title: "T".repeat(301) }, { id: "tmdb-43" }, { id: "tmdb-042" }, { tmdbId: 0 },
    { id: "tmdb-9007199254740992", tmdbId: 9007199254740992 }, { custom: true },
    { cast: Array(13).fill("Actor") }, { cast: ["A".repeat(121)] }, { directors: Array(7).fill("A") },
    { genres: Array(21).fill("A") }, { genres: ["A".repeat(81)] }, { originalTitle: "T".repeat(301) },
    { rating: 11 }, { rating: -1 }, { rating: "8" }, { posterPath: "https://evil.example/poster.jpg" },
    { posterPath: "//evil.example/poster.jpg" }, { posterPath: "/poster.svg" }, { cast: null },
    { castProfiles: null }, { castProfiles: Array(13).fill({ name: "Actor", profilePath: null }) },
    { castProfiles: [{ name: "", profilePath: null }] },
    { castProfiles: [{ name: "Actor", profilePath: "//evil.example/photo.jpg" }] },
    { voteCount: -1 }, { voteCount: 1.5 }, { voteCount: Number.MAX_SAFE_INTEGER + 1 },
    { language: "fr-FR" }, { language: null }, { language: { toString: "en-US" } },
  ]) {
    const result = await send(db, host, "/movies", { method: "POST", body: { movie: tmdb(overrides) } });
    assert.equal(result.status, 400, JSON.stringify(overrides));
  }
  const maximal = tmdb({
    title: "T".repeat(300), year: 2200, minutes: 1000, description: "D".repeat(6000),
    cast: Array(12).fill("A".repeat(120)), directors: Array(6).fill("A".repeat(120)),
    genres: Array(20).fill("G".repeat(80)), originalTitle: "O".repeat(300), rating: 10,
  });
  assert.equal((await addMovie(db, host, maximal)).movies[0].title.length, 300);
  for (const overrides of [
    { id: "old-plan" }, { movieId: "invalid" }, { foodId: "unknown" }, { date: "2026-02-29" },
    { date: "2024-02-30" }, { date: "2026-04-31" }, { date: "2026-13-01" }, { date: "0000-01-01" },
    { date: "2026-9-10" }, { place: "" }, { place: " " }, { place: "P".repeat(121) }, { place: "Casa\n" },
  ]) {
    const result = await send(db, host, "/plans", { method: "POST", body: { plan: plan(maximal.id, overrides) } });
    assert.equal(result.status, 400, JSON.stringify(overrides));
  }
  assert.equal((await addPlan(db, host, plan(maximal.id, { date: "2024-02-29", place: "P".repeat(120) }))).plans.length, 1);
  assert.equal((await send(db, host, "/movies/tmdb-42", { method: "PATCH", body: { watched: "true" } })).status, 400);
  const planId = (await send(db, host)).data.plans[0].id;
  assert.equal((await send(db, host, `/plans/${planId}`, { method: "PATCH", body: { completed: 1 } })).status, 400);
});

test("parties preserve optional TMDB language without rewriting an existing movie", async (t) => {
  const db = database(t);
  const host = (await create(db)).session;
  const original = tmdb({ language: "en-US", title: "English title", posterPath: "/english.jpg" });
  const first = await addMovie(db, host, original);
  assert.equal(first.movies[0].language, "en-US");
  const repeated = await addMovie(db, host, tmdb({ language: "es-ES" }));
  assert.deepEqual(repeated, first);
  const stored = await send(db, host);
  assert.equal(stored.data.movies[0].posterPath, "/english.jpg");
  assert.equal(stored.data.movies[0].language, "en-US");
});

test("JSON body reading limits actual UTF-8 bytes, not just Content-Length; invalid encoding and JSON are rejected", async (t) => {
  const db = database(t);
  for (const [raw, headers, status] of [
    ["{}", { "Content-Type": "text/plain" }, 415],
    ["{", {}, 400], ["[]", {}, 400], ["null", {}, 400],
    ["{}", { "Content-Length": "32769" }, 413],
    ["{}", { "Content-Length": "invalid" }, 413],
    [JSON.stringify({ name: "P", displayName: "Ana", extra: "a".repeat(32768) }), {}, 413],
    [JSON.stringify({ name: "P", displayName: "Ana", extra: "\ud83c\udfac".repeat(9000) }), { "Content-Length": "1" }, 413],
    [new Uint8Array([0xff, 0xfe]), {}, 400],
  ]) {
    const result = await api(db, "/parties", { method: "POST", raw, headers });
    assert.equal(result.status, status);
  }
  let cancelled = false;
  const stream = new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(32769)); },
    cancel() { cancelled = true; },
  });
  const response = await worker.fetch(new Request("https://api.example.com/parties", {
    method: "POST", headers: { Origin: ORIGIN, "Content-Type": "application/json" }, body: stream, duplex: "half",
  }), { ALLOWED_ORIGINS: ORIGIN, PARTY_DB: db });
  assert.equal(response.status, 413);
  assert.equal(cancelled, true);
  const quoted = await create(db, "Party'); DROP TABLE parties;--", "O'Connor");
  assert.equal(quoted.snapshot.members[0].name, "O'Connor");
  assert.equal(db.sqlite.prepare("SELECT count(*) AS n FROM parties").get().n, 1);
});

test("party CORS allows private methods/headers without changing catalog GET-only CORS or caching snapshots", async (t) => {
  const db = database(t);
  const previous = Object.getOwnPropertyDescriptor(globalThis, "caches");
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "caches", previous);
    else delete globalThis.caches;
  });
  globalThis.caches = { default: {
    match() { assert.fail("Private requests must never read the CDN cache"); },
    put() { assert.fail("Private requests must never write the CDN cache"); },
  } };
  const upstream = t.mock.method(globalThis, "fetch", () => { assert.fail("Parties must not call TMDB"); });
  const host = (await create(db)).session;
  const result = await send(db, host);
  assert.equal(result.headers.get("Cache-Control"), "no-store");
  assert.equal(result.headers.get("Access-Control-Allow-Origin"), ORIGIN);
  assert.equal(result.headers.get("Vary"), "Origin");
  assert.equal(result.headers.get("X-Content-Type-Options"), "nosniff");
  for (const method of ["POST", "PATCH", "DELETE", "GET"]) {
    const suffix = method === "POST" ? "/parties" : method === "GET" ? path(host) : path(host, `/plans/${randomUUID()}`);
    const preflight = await api(undefined, suffix, {
      method: "OPTIONS", headers: { "Access-Control-Request-Method": method, "Access-Control-Request-Headers": "authorization,content-type,Accept" },
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("Access-Control-Allow-Methods"), "GET, POST, PATCH, DELETE, OPTIONS");
    assert.equal(preflight.headers.get("Access-Control-Allow-Headers"), "Accept, Authorization, Content-Type");
    assert.equal(preflight.headers.get("Cache-Control"), "no-store");
  }
  const moviePreflight = await api(undefined, path(host, "/movies/tmdb-42"), {
    method: "OPTIONS", headers: { "Access-Control-Request-Method": "DELETE", "Access-Control-Request-Headers": "authorization" },
  });
  assert.equal(moviePreflight.status, 204);
  assert.equal(moviePreflight.headers.get("Access-Control-Allow-Methods"), "GET, POST, PATCH, DELETE, OPTIONS");
  for (const origin of ["null", "https://evil.example", `${ORIGIN}.evil.example`]) {
    const denied = await send(db, host, "", { headers: { Origin: origin } });
    assert.equal(denied.status, 403);
    assert.equal(denied.headers.has("Access-Control-Allow-Origin"), false);
  }
  assert.equal((await api(db, "/parties", { method: "OPTIONS", headers: { "Access-Control-Request-Headers": "X-Role" } })).status, 400);
  assert.equal((await api(db, "/parties", { method: "OPTIONS", headers: { "Access-Control-Request-Method": "PUT" } })).status, 405);
  const catalog = await api(undefined, "/movies", { method: "OPTIONS", headers: { "Access-Control-Request-Method": "GET" } });
  assert.equal(catalog.status, 204);
  assert.equal(catalog.headers.get("Access-Control-Allow-Methods"), "GET, OPTIONS");
  assert.equal(catalog.headers.get("Access-Control-Allow-Headers"), "Accept");
  assert.equal((await api(undefined, "/movies", { method: "OPTIONS", headers: { "Access-Control-Request-Method": "POST" } })).status, 405);
  assert.equal(upstream.mock.calls.length, 0);
});

test("missing D1 and unmigrated databases fail explicitly; invalid routes/methods cannot write", async (t) => {
  const result = await api(undefined, "/parties", { method: "POST", body: { name: "Party", displayName: "Ana" } });
  assert.equal(result.status, 503);
  assert.match(result.data.error, /PARTY_DB/);
  assert.equal(result.headers.get("Cache-Control"), "no-store");
  const logged = t.mock.method(console, "error", () => {});
  const db = database(t, false);
  const unmigrated = await api(db, "/parties", { method: "POST", body: { name: "Party", displayName: "Ana" } });
  assert.equal(unmigrated.status, 500);
  assert.equal(JSON.stringify(unmigrated.data).includes("no such table"), false);
  assert.equal(logged.mock.calls.length, 1);
  assert.equal((await api(undefined, "/parties?token=do-not-accept", { method: "POST" })).status, 400);
  assert.equal((await api(undefined, "/parties/invalid")).status, 404);
  const invalidMethod = await api(undefined, "/parties", { method: "GET" });
  assert.equal(invalidMethod.status, 405);
  assert.equal(invalidMethod.headers.get("Allow"), "POST, OPTIONS");
});

test("actual schema enforces participant/list caps, retryability at capacity and composite foreign keys", async (t) => {
  const db = database(t);
  const host = (await create(db)).session;
  const memberInsert = db.sqlite.prepare("INSERT INTO party_members (party_id, id, name, role, token_hash) VALUES (?, ?, ?, 'member', ?)");
  for (let i = 1; i < 50; i++) memberInsert.run(host.partyId, randomUUID(), `Miembro ${i}`, digest(`member-${i}`));
  const deniedJoin = await api(db, "/parties/join", {
    method: "POST", body: { inviteToken: host.inviteToken, displayName: "Sin sitio" },
  });
  assert.equal(deniedJoin.status, 409);
  assert.match(deniedJoin.data.error, /50 participantes/);
  const movie = custom();
  await addMovie(db, host, movie);
  const movieInsert = db.sqlite.prepare("INSERT INTO party_movies (party_id, id, metadata, custom_title, added_by) VALUES (?, ?, ?, ?, ?)");
  for (let i = 1; i < 200; i++) {
    const next = custom({ title: `Movie ${i}` });
    movieInsert.run(host.partyId, next.id, JSON.stringify(next), next.title.toLowerCase(), host.memberId);
  }
  const deniedMovie = await send(db, host, "/movies", { method: "POST", body: { movie: custom({ title: "Too many" }) } });
  assert.equal(deniedMovie.status, 409);
  assert.match(deniedMovie.data.error, /200 pel\u00edculas/);
  assert.equal((await addMovie(db, host, movie)).movies.length, 200);
  const value = plan(movie.id);
  await addPlan(db, host, value);
  const planInsert = db.sqlite.prepare(`INSERT INTO party_plans
    (party_id, id, movie_id, food_id, date, place, place_key, created_by) VALUES (?, ?, ?, 'pizza', '2026-09-10', ?, ?, ?)`);
  for (let i = 1; i < 500; i++) planInsert.run(host.partyId, randomUUID(), movie.id, `Casa ${i}`, `casa ${i}`, host.memberId);
  const deniedPlan = await send(db, host, "/plans", { method: "POST", body: { plan: plan(movie.id, { place: "Otra casa" }) } });
  assert.equal(deniedPlan.status, 409);
  assert.match(deniedPlan.data.error, /500 planes/);
  const full = await addPlan(db, host, value);
  assert.equal(full.plans.length, 500);
  assert.equal(full.members.length, 50);
  assert.equal(full.movies.length, 200);
  await send(db, host, `/plans/${value.id}`, { method: "DELETE" });
  assert.equal((await addPlan(db, host, plan(movie.id, { place: "Nueva" }))).plans.length, 500);
  const other = (await create(db, "Other")).session;
  assert.throws(() => movieInsert.run(other.partyId, randomUUID(), JSON.stringify(custom()), "bad", host.memberId), /FOREIGN KEY/);
  assert.throws(() => planInsert.run(other.partyId, randomUUID(), movie.id, "Bad", "bad", other.memberId), /FOREIGN KEY/);
  assert.equal(db.sqlite.prepare("PRAGMA foreign_key_check").all().length, 0);
});
