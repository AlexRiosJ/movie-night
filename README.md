# Movie Night

A Spanish-language movie-night planner built with plain HTML, CSS, and JavaScript.
Search and discover movies through **The Movie Database (TMDB)**, choose food,
and keep a personal collection and movie-night plans in your browser, or share
a party's collection and plans with friends.

The frontend still runs on GitHub Pages without a build step. A small
**Cloudflare Worker** proxies TMDB requests so the shared TMDB credential never
appears in the frontend. Optional **Cloudflare D1** storage enables shared parties
without accounts. Visitors do not need TMDB API keys.

## Project structure

```text
movie-night/
  index.html          Page, forms, templates, and original movie artwork
  styles.css          Three interface styles, each with light and dark palettes
  config.js           Public proxy URL only (never a token)
  app.js              API client, catalog, collection, plans, and localStorage
  parties.js          Party sessions, invitations, mutations, and polling
  app.test.mjs        Frontend behavior tests using Node's built-in test runner
  assets/
    favicon.svg       Original app icon
  proxy/
    worker.mjs        TMDB proxy, origin validation, and party routing
    worker.test.mjs   TMDB proxy tests using Node's built-in test runner
    parties.mjs       Authenticated shared-party API backed by D1
    parties.test.mjs  API tests using the real schema and node:sqlite
    d1-fixture.mjs    Shared SQLite adapter for API and browser-session tests
    migrations/
      0001_parties.sql Parties, members, movies, plans, limits, and revisions
      0002_movie_deletion.sql Movie deletion, dependent nights, and revisions
    wrangler.jsonc    Cloudflare deployment configuration
    .dev.vars.example Local development environment example (no real secrets)
  .nojekyll           Publish static files without Jekyll processing
```

## Connect TMDB

Live catalog access requires this one-time owner setup. Until then the app shows
a configuration notice; existing collections, manual additions, and plans still
work. There is no embedded sample catalog masquerading as live API results.

1. Request a TMDB developer API credential in your
   [TMDB account settings](https://www.themoviedb.org/settings/api).
   Use the **API Read Access Token**, not the shorter v3 API key.
   Review [TMDB's terms and attribution requirements](https://developer.themoviedb.org/docs/faq).
   Developer use is free for non-commercial projects; commercial use requires
   the appropriate agreement with TMDB.
2. Install a current Node.js LTS release and sign in to Cloudflare:

   ```sh
   npx wrangler login
   ```

3. Set `ALLOWED_ORIGINS` in `proxy/wrangler.jsonc` to your frontend's exact origin.
   The supplied production value is `https://alexriosj.github.io`. Origins have
   no path or trailing slash: do **not** include `/movie-night/`. Use a
   comma-separated list for multiple frontend origins.
4. Store the token as a Worker secret and deploy, from the repository root:

   ```sh
   npx wrangler secret put TMDB_READ_TOKEN --config proxy/wrangler.jsonc
   npx wrangler deploy --config proxy/wrangler.jsonc
   ```

   Paste the token only at Wrangler's secret prompt. If prompted to create the
   Worker on the first secret upload, accept. Never put credentials in
   `config.js`, `wrangler.jsonc`, git, a public URL, or a frontend environment
   variable. The Worker has no write access to visitors' local collections.
5. Copy the deployed Worker URL into `config.js`:

   ```js
   window.MOVIE_NIGHT_CONFIG = {
     apiBaseUrl: "https://movie-night-api.YOUR-SUBDOMAIN.workers.dev",
   };
   ```

   Use the Worker base URL, without `/movies`. HTTPS is required except for
   `localhost` and `127.0.0.1` during local development.
6. Publish the frontend files to GitHub Pages and open **Explorar**.

The TMDB proxy only exposes movie discovery/search and movie details, rather than
arbitrary TMDB routes or arbitrary upstream URLs. Origin restrictions are browser
CORS protection, **not authentication**: non-browser clients can make requests.
Configure Cloudflare rate limiting and monitor Worker/TMDB usage for a public
deployment. TMDB rate-limit failures are shown to visitors rather than silently
replacing results with a small local list.

## Enable shared parties (optional)

Parties use the same Worker URL and `ALLOWED_ORIGINS` as the catalog, but do not
require the TMDB secret: manual party movies and plans work independently.
Without a `PARTY_DB` binding, party requests return an explicit Spanish **503**
configuration error; the catalog and local-only collection are unaffected.
No database is provisioned or deployed automatically by this repository.

From the repository root, after signing in to Cloudflare:

1. Create a D1 database:

   ```powershell
   npx wrangler d1 create movie-night-parties --config proxy\wrangler.jsonc
   ```

2. In `proxy/wrangler.jsonc`, keep `"binding": "PARTY_DB"` and set the database's
   actual name and **`database_id` returned by Wrangler**. The checked-in binding
   identifies this app's production database; replace it when deploying in another
   Cloudflare account. A database ID is a public identifier, not a credential.
   Keep `"migrations_dir": "migrations"`; it is relative to the proxy configuration.
3. Apply the schema to the remote database, then deploy the Worker:

   ```powershell
   npx wrangler d1 migrations apply movie-night-parties --remote --config proxy\wrangler.jsonc
   npx wrangler deploy --config proxy\wrangler.jsonc
   ```

   Review Wrangler's target database and migration prompts before accepting.
   Back up an existing database before future schema changes. Keep the existing
   TMDB secret if the live catalog is also enabled.
4. For a **separate local development database**, apply the same migration locally
   before starting Wrangler:

   ```powershell
   npx wrangler d1 migrations apply movie-night-parties --local --config proxy\wrangler.jsonc
   npx wrangler dev --config proxy\wrangler.jsonc
   ```

   Local D1 state is stored in Wrangler's ignored `.wrangler` directory, not in the
   remote database. Match the local frontend origin as described below. Use a local
   Worker URL in `config.js` for local testing.

For an existing deployment, apply the pending D1 migrations before deploying the
updated Worker and frontend. Migration `0002_movie_deletion.sql` preserves existing
movies and nights; future movie deletions atomically remove their associated nights
and advance the shared revision, even when a movie has no nights.

**Before promoting a public deployment widely, configure production rate limiting
for `POST /parties` and `POST /parties/join`**, and appropriate limits for reads and
mutations. Browser origin checks are not an abuse-control or authentication system.
Monitor Worker/D1 quotas and storage costs; repeated creation can otherwise create
unlimited parties. This MVP intentionally does not provide account recovery,
invitation rotation/revocation, participant removal, or automatic party expiry.

### Party API and limits

- `POST /parties` with `{name, displayName}` creates a party and its host.
  `POST /parties/join` with `{inviteToken, displayName}` creates a member.
  Both return `{session: {partyId, memberId, token, inviteToken}, snapshot}`.
- `GET /parties/{partyId}` returns a snapshot. All requests to a specific party
  require `Authorization: Bearer <member token>` for membership in that exact party.
- `POST /parties/{partyId}/movies` accepts `{movie}`; `PATCH` on
  `/parties/{partyId}/movies/{movieId}` accepts `{watched: boolean}`.
  `DELETE` on that movie URL is restricted to the member who added it or the
  party host. It atomically deletes the movie and all its scheduled/completed
  plans, including plans created by other members.
- `POST /parties/{partyId}/plans` accepts `{plan}`; `PATCH` on
  `/parties/{partyId}/plans/{planId}` accepts `{completed: boolean}`.
  `DELETE` on the plan URL is restricted to its creator or the party host.
  Every successful mutation returns the full snapshot directly.
- Snapshots contain `{party: {id, name}, revision, members, movies, plans}`.
  Members expose only `{id, name, role}`. Movies retain the saved-movie shape
  plus `addedBy`/`addedByName`; plans add `createdBy`/`createdByName`.
  Authors and initial watched/completed states are derived by the server.
- Names are trimmed, nonblank, and control-free: party names allow 80 characters,
  display names 40. Duplicate display names are allowed; identity is a server UUID.
  Custom titles allow 120 characters; TMDB metadata retains the frontend's bounds.
  Request bodies are limited to **32 KiB of actual UTF-8 data**, including chunked
  bodies. Plans require a party movie, known food, valid calendar date and a
  nonblank location of at most 120 characters.
- Each party allows **50 participants, 200 movies, and 500 plans**. Additional
  entries are rejected explicitly with **409**, never silently truncated.
  A repeat of an existing movie/plan UUID preserves its original content, author,
  and state, even at capacity. TMDB IDs are canonical `tmdb-N`; custom movies and
  plans use client-generated UUIDs for retries. Conflicting custom titles
  (NFKC/Spanish lowercase; custom-title whitespace collapsed) and duplicate
  movie/food/date/location plans return **409**.
- SQL row writes, uniqueness constraints, and revision triggers prevent lost
  additions. Completing a plan and marking its movie watched are atomic.
  Reopening/deleting a plan does not undo watched history. Each snapshot's
  revision and all its lists are read in one D1 batch transaction; private
  responses are `no-store` and never enter the catalog's CDN cache.

### Run locally

For the API connection, serve the frontend over HTTP rather than opening
`index.html` as a `file://` URL (which has a `null` origin). For example, if Python
is already installed:

```sh
python -m http.server 8000
```

Open `http://localhost:8000`. The frontend itself has no dependencies.

For a local proxy, copy `proxy/.dev.vars.example` to `proxy/.dev.vars`, set your
real token there, and include `http://localhost:8000` (or
`http://127.0.0.1:8000`, matching your browser URL) in its `ALLOWED_ORIGINS`.
This local secret file is ignored by git. Run:

```sh
npx wrangler dev --config proxy/wrangler.jsonc
```

Set `config.js` to the local Worker URL printed by Wrangler (usually
`http://localhost:8787`). Restore the deployed HTTPS URL before publishing.
You can also use a deployed Worker locally if its allowed origins include your
local frontend origin.

### Publish on GitHub Pages

1. Push the configured frontend and proxy source to the repository's `main` branch.
2. Open **Settings > Pages** and choose **Deploy from a branch**.
3. Select **main**, choose **/ (root)**, and save.
4. Open the published URL, normally `https://alexriosj.github.io/movie-night/`.

Pages publishes the static frontend, not the Worker. Deploy Worker changes with
Wrangler separately. All frontend asset paths are relative, so the app also works
under a custom domain; update the Worker origin allowlist when changing domains.

## Using the app

- Choose **Movie**, **Arcade**, or **Zine** with the style selector, then use the
  adjacent **Claro / Oscuro** button to switch color mode independently.
  The button uses a sun/moon icon on compact screens. Changing styles keeps your
  chosen mode. Both preferences persist; personal-mode preferences also sync between tabs.
  New visitors start with **Movie** in light mode.
- **Movie** has a cinema-inspired presentation:
  poster typography, a static projector beam, a film countdown illustration,
  and a perforated ticket for the date and place of your plan.
  The ticket, artwork, and controls all adapt to the selected mode.
  Decorative artwork is hidden from
  assistive technology. No animation, external fonts, or new dependencies are needed.
- **Arcade** turns the planner into a retro console: mint and lilac accents,
  a grid background, an original handheld illustration, raised buttons, and a
  save-point panel for your plan. Scanlines and indicator lights are static.
- **Zine** is a film-club journal: paper texture, editorial typography,
  a collage of prints and stickers, ink-style borders, and a notebook-inspired
  date and place form. Both creative themes retain the same catalog, collection,
  and plan controls, and neither changes your movie preferences.
- **Explorar** browses popular movies, searches by title, and pages through
  results. With an empty title, the genre selector filters discovery.
  Title searches span all genres and distinguish releases by year.
- **Elegir y guardar** loads the complete movie details before selecting it and
  adding it to your collection. Only chosen movies are stored, not every search
  result. Choosing an existing TMDB movie does not duplicate it or reset its
  watched status.
- Movie details include title, release year, runtime, synopsis, poster, up to
  12 principal cast members with portraits in a horizontally scrollable row,
  directors, genres, and original title. A prominent user score shows TMDB's
  average rating as a percentage (rounded to the nearest whole percent), with
  the number of votes. Movies without a rating say so rather than showing 0%.
  Data is requested in Spanish; translations and some metadata may be missing.
  Missing or broken cast portraits show "Sin foto" while keeping the actor's name.
  Missing fields have explicit placeholders, and missing/broken posters use the
  original cinema illustration (or a compact posterless layout on small screens).
- The random-pick button sits above the movie details in a sticky control bar,
  so changing the title or synopsis length does not move it. It stays visible
  while scrolling through the planner, with a full-width button on small screens.
  Loading replaces its shuffle icon with a spinner, without adding visible text
  or resizing the controls. Screen readers still announce loading; errors and
  their retry action remain visible.
- **Elegir pelicula aleatoria** uses TMDB by default when configured. It samples
  different discovery pages, avoids the current movie, and respects your genre
  and watched filter. Discovery includes released movies with at least 50 votes,
  ordered by popularity, within TMDB's 500-page limit. It is not a uniform draw
  from every movie in TMDB. Up to five pages are tried per pick.
- **Preferencias > Elegir desde > Mi coleccion** (or **Coleccion del grupo** in a
  party) chooses from the active collection, including custom additions.
  **Solo pendientes** excludes movies marked watched in that collection;
  it does not mean TMDB knows your viewing history.
- Genre groups are approximate discovery filters: horror/mystery,
  comedy/romance/family, science fiction, fantasy, and other genres. The existing
  proxy category IDs are retained, so this interface update needs no Worker
  deployment. Its "other genres" discovery filter still excludes the legacy
  Christmas keyword; title searches and unfiltered discovery include those movies.
- **Mis noches** and **Mi coleccion** retain the existing saved plans, manual
  movie form, pending/watched toggles, and exact-movie selection. Only one list
  is shown at a time. Custom titles are limited to 120 characters.
- Food can be paired automatically or changed independently. Choose a movie,
  food, date, and location to save a plan. Dates are local, not UTC.
- Completing a plan marks its movie watched. Reopening or deleting a plan does
  not erase viewing history. Deleting a plan asks for confirmation.
- Create a **party** with a party name and display name, then share its invitation.
  Joining requires a display name, not an account. While a party is active,
  additions, watched status, plans, and their authors are shared. All members may
  add and toggle entries; only a plan's creator or the host can delete it directly.
- **Coleccion del grupo** shows a trash button for movies you added; the host
  can delete any movie. The button is available in both pending and watched lists.
  Confirmation warns that the movie and all its scheduled/completed nights,
  including other members' nights, will be deleted for the entire group.
  Cancelling leaves everything intact. The separate personal collection is unaffected.
- The invitation uses a `#party=TOKEN` URL fragment. **Anyone holding this link
  can join**, read the party, and make member-level changes; only share it with
  people you trust. The fragment is not sent to GitHub Pages in the page request,
  but its token is sent to the Worker when joining.
- Shared lists refresh by polling about every **5 seconds** while the page is
  visible, and after writes. Older revisions cannot replace newer state. This
  is not a WebSocket/live-presence service; changes to the same watched/completed
  flag use the last committed write.

Searches and selections have loading, empty, error, and retry states. A later
search/selection or filter change cannot be overwritten by a slower old request.
Failures leave the previous selected movie and saved plans intact. Use
**Mi coleccion** for saved movie details if the API is unavailable.

## Storage and privacy

In **local mode**, movies (including selected TMDB metadata), watched status,
plans, draft fields, filters, theme, color mode, and active list are stored under
`movie-night:v1` in localStorage.
Existing collections and plans are preserved; the new catalog does not reset or
automatically replace them. A legacy entry with the same title and release year
can receive TMDB details while keeping its ID, watched status, and plan references.
Custom movies are not guessed or automatically matched to an ambiguous API result.
Saved TMDB entries without cast portraits or vote counts remain usable offline.
Choosing one again from **Explorar** refreshes its details without changing its
watched status or plan references. Deploy the updated Worker as well as the
frontend to enable portraits and vote counts.

The retired **Light** and **Night** styles become **Movie** in light and dark mode,
respectively. Older Movie and Arcade selections keep dark mode, and Zine keeps
light mode, unless a color mode has already been saved. Retired seasonal themes
become Movie in light mode. Movies, watched status, plans, and drafts are preserved.
The retired Christmas collection category becomes "Otros
generos", and a saved Christmas-only picker filter becomes "Todos los generos".
The same category normalization applies to responses from the existing proxy.
These updates are saved on the next interaction, as part of the usual state save.
Unknown or damaged data is still protected rather than silently reset.

Local collections and plans are not uploaded, including when you create or join a
party: there is **no implicit upload of a legacy collection**. Party mode uses a
separate shared list; only movies and plans explicitly added while it is active
are uploaded. Returning to local mode restores the separate personal collection.

In **party mode**, Cloudflare D1 stores the party name, member names/roles,
selected movie metadata and attribution, watched state, and plans with their
dates/locations and authors. These are visible to every member and to the
deployment's database administrator. Avoid entering sensitive personal details.
Member and invitation credentials are independent, cryptographically random
32-byte tokens; D1 stores only their SHA-256 hashes. API snapshots never expose
credential hashes or tokens. The raw invitation is returned only on creation/join,
and the raw member token only when that member is created.

Membership credentials are remembered in this browser's localStorage under
`movie-night:parties:v1`, scoped to the configured Worker URL. Treat browser access,
stored credentials, and invitation links as sensitive. Clearing site data, private
browsing, switching browser/device/origin, or losing storage can lose your member
identity and host privileges; a display name does not recover them. Rejoining with
an invitation creates a **new member**, not the old identity, and consumes another
participant slot. There are no accounts or recovery/invitation-rotation controls
in this MVP. Shared data remains on the server when browser data is cleared.

Party drafts (including unfinished date/place edits), theme, color mode, filters and view
preferences remain local under `movie-night:party-view:<partyId>`; they are not
shared until you explicitly save a plan. Party lists require a working Worker
connection; failed saves are not silently converted into local-only changes.

Search terms, genre filters, page numbers, and selected TMDB IDs go through the
configured Worker to TMDB. Posters and cast portraits load directly from TMDB's
image CDN, and the attribution logo loads from TMDB.
These services receive normal network information such as IP addresses. There
are no third-party fonts or analytics in the app.

The **local collection** does not sync across devices or origins. Tabs on the same origin
listen for saved changes; simultaneous writes use last-write-wins behavior.
Private browsing or clearing site data may remove your collection. Export the
key's JSON using browser developer tools before clearing storage for a backup.

Unavailable/full storage shows a visible warning. Invalid or incompatible local
collection data is preserved without overwriting it, and local persistence is disabled for that session.
To recover, back up the raw value, remove only `movie-night:v1`, and reload.

Locally saved metadata works without contacting the API, but party synchronization
and posters/cast portraits still need a network connection. This is not an installable/offline PWA.

## Development checks

No npm packages are needed for the dependency-free tests. Use **Node.js 22.13 or
newer** with built-in `node:sqlite` support (a current Node LTS is recommended):

```sh
node --test app.test.mjs proxy/worker.test.mjs proxy/parties.test.mjs
```

The tests use deterministic TMDB fixtures and an in-memory SQLite database with
the actual D1 migration and transactional batch adapter. They exercise identities,
authorization/isolation, attribution, retries, concurrent additions, atomic plan
completion, limits and CORS. SQLite may print an experimental-feature warning on
Node 22. No real credentials, remote database, provisioning or deployment is needed.
