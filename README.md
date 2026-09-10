# Movie Night

A Spanish-language movie-night planner built with plain HTML, CSS, and JavaScript.
Search and discover movies through **The Movie Database (TMDB)**, choose food,
and keep a personal collection and movie-night plans in your browser.

The frontend still runs on GitHub Pages without a build step. A small
**Cloudflare Worker** proxies TMDB requests so the shared TMDB credential never
appears in the frontend. Visitors do not need accounts or API keys.

## Project structure

```text
movie-night/
  index.html          Page, forms, templates, and original theme artwork
  styles.css          Responsive layout and five theme palettes
  config.js           Public proxy URL only (never a token)
  app.js              API client, catalog, collection, plans, and localStorage
  app.test.mjs        Frontend behavior tests using Node's built-in test runner
  assets/
    favicon.svg       Original app icon
  proxy/
    worker.mjs        Read-only TMDB proxy
    worker.test.mjs   Proxy tests using Node's built-in test runner
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

The proxy only exposes movie discovery/search and movie details, rather than
arbitrary TMDB routes or arbitrary upstream URLs. Origin restrictions are browser
CORS protection, **not authentication**: non-browser clients can make requests.
Configure Cloudflare rate limiting and monitor Worker/TMDB usage for a public
deployment. TMDB rate-limit failures are shown to visitors rather than silently
replacing results with a small local list.

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

- **Explorar** browses popular movies, searches by title, and pages through
  results. With an empty title, the universe selector filters discovery.
  Title searches span all universes and distinguish releases by year.
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
  original theme illustration (or a compact posterless layout on small screens).
- The random-pick button sits above the movie details in a sticky control bar,
  so changing the title or synopsis length does not move it. It stays visible
  while scrolling through the planner, with a full-width button on small screens.
  Loading replaces its shuffle icon with a spinner, without adding visible text
  or resizing the controls. Screen readers still announce loading; errors and
  their retry action remain visible.
- **Elegir pelicula aleatoria** uses TMDB by default when configured. It samples
  different discovery pages, avoids the current movie, and respects your universe
  and watched filter. Discovery includes released movies with at least 50 votes,
  ordered by popularity, within TMDB's 500-page limit. It is not a uniform draw
  from every movie in TMDB. Up to five pages are tried per pick.
- **Preferencias > Elegir desde > Mi coleccion** keeps the original local-only
  random picker, including custom additions. **Solo pendientes** excludes movies
  marked watched in this browser; it does not mean TMDB knows your viewing history.
- Universes are approximate discovery filters: horror/mystery for spooky,
  comedy/romance/family for cozy, science fiction, fantasy, and TMDB's Christmas
  keyword. Other genres have their own collection category. Themes remain
  independent of movie filters.
- **Mis noches** and **Mi coleccion** retain the existing saved plans, manual
  movie form, pending/watched toggles, and exact-movie selection. Only one list
  is shown at a time. Custom titles are limited to 120 characters.
- Food can be paired automatically or changed independently. Choose a movie,
  food, date, and location to save a plan. Dates are local, not UTC.
- Completing a plan marks its movie watched. Reopening or deleting a plan does
  not erase viewing history. Deleting a plan asks for confirmation.

Searches and selections have loading, empty, error, and retry states. A later
search/selection or filter change cannot be overwritten by a slower old request.
Failures leave the previous selected movie and saved plans intact. Use
**Mi coleccion** for saved movie details if the API is unavailable.

## Storage and privacy

Movies (including selected TMDB metadata), watched status, plans, draft fields,
filters, theme, and active list are stored under `movie-night:v1` in localStorage.
Existing collections and plans are preserved; the new catalog does not reset or
automatically replace them. A legacy entry with the same title and release year
can receive TMDB details while keeping its ID, watched status, and plan references.
Custom movies are not guessed or automatically matched to an ambiguous API result.
Saved TMDB entries without cast portraits or vote counts remain usable offline.
Choosing one again from **Explorar** refreshes its details without changing its
watched status or plan references. Deploy the updated Worker as well as the
frontend to enable portraits and vote counts.

Collections and plans are not uploaded. Search terms, universe filters, page
numbers, and selected TMDB IDs go through the configured Worker to TMDB. Posters
and cast portraits load directly from TMDB's image CDN, and the attribution logo loads from TMDB.
These services receive normal network information such as IP addresses. There
are no third-party fonts or analytics in the app.

The collection does not sync across devices or origins. Tabs on the same origin
listen for saved changes; simultaneous writes use last-write-wins behavior.
Private browsing or clearing site data may remove your collection. Export the
key's JSON using browser developer tools before clearing storage for a backup.

Unavailable/full storage shows a visible warning. Invalid or incompatible data
is preserved without overwriting it, and persistence is disabled for that session.
To recover, back up the raw value, remove only `movie-night:v1`, and reload.

Saved metadata works without contacting the API, but posters and cast portraits
still need a network connection. This is not an installable/offline PWA.

## Development checks

No npm packages are needed for the dependency-free tests (Node.js 22 or newer):

```sh
node --test app.test.mjs proxy/worker.test.mjs
```

The tests use deterministic API fixtures and do not require real credentials.
