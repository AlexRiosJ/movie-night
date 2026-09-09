# Movie Night

A small, bilingual English/Spanish movie-night planner built with plain HTML, CSS, and
JavaScript. No account, backend, API key, package manager, or build step.

## Project structure

```text
movie-night/
  index.html          Accessible page, forms, templates, and original SVG artwork
  styles.css          Responsive layout and five theme palettes
  app.js              Catalog, random generators, plans, and localStorage
  i18n.js             English and Spanish interface and catalog translations
  assets/
    favicon.svg       Original app icon
  .nojekyll           Publish the static files without Jekyll processing
  README.md
```

## Run locally

Open `index.html` in a modern browser. For a consistent localStorage origin,
use a local static server if you already have one installed. For example, with
Python installed, run the following from this directory:

```sh
python -m http.server 8000
```

Then open `http://localhost:8000`. No dependencies need to be installed.

## Publish on GitHub Pages

1. Push these files to the root of your repository's `main` branch.
2. Open the repository's **Settings > Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**.
4. Select **main**, choose **/ (root)**, and click **Save**.
5. Once GitHub finishes deployment, open the URL shown in the Pages settings.

For this repository, the default project URL is
`https://alexriosj.github.io/movie-night/`.

All asset paths are relative, so the app works under the repository subdirectory
as well as on a custom domain. There are no client-side routes to configure.

## Using the app

- Use the **English / Espanol** toggle in the header to change language instantly.
  Spanish is the default, including for existing collections. Your choice is
  remembered in this browser and shared with other open tabs on the same origin.
  Interface text, built-in movie titles and descriptions, food suggestions, dates,
  and app messages follow the selected language. Custom movie titles and locations
  stay exactly as entered, and switching does not clear unfinished forms.
- The main area is one flow: choose a movie, change the accompanying food if
  needed, set the date and location, and save the plan.
- **Pick a random movie** picks a movie and, by default, food too.
  **Change**, next to the food, picks food independently.
- Open **Preferences** for the universe filter, **Unwatched only**, and the
  option to automatically pair food with a movie.
- **My nights** and **My collection** switch between two simple lists. Only one
  list is visible at a time; the app remembers your last view.
- In **My collection**, **Add a movie** adds a custom movie to one of the five universes. Titles
  must be nonempty and are limited to 120 characters; duplicates are rejected.
- The circle beside each movie switches it between pending and watched.
  The arrow selects that exact movie for a plan, including movies already watched.
- Choose a movie, food, date, and location to save a movie night. Dates are local,
  not UTC, and past dates are allowed when recording an earlier night.
- **Scheduled** lists unfinished plans by date. Completing a plan moves it to
  **Completed** and marks its movie as watched.
- Reopening or deleting a plan does not erase viewing history. Use the collection
  to mark a movie as pending again. Deleting a plan asks for confirmation.
- The theme button switches between spooky season (default), cozy autumn,
  sci-fi, fantasy, and Christmas. Theme and movie filters are independent.

## Main functions

| Function | Responsibility |
| --- | --- |
| `randomMovie(forceFood = false)` | Pick a movie using the current filters; optionally choose food too. |
| `randomFood()` | Pick food independently. |
| `savePlan(event)` | Validate and save the selected movie, food, date, and location. |
| `renderPlans()` | Render scheduled or completed nights and their counts. |
| `addMovie(event)` | Validate and add a custom movie from the form. |
| `toggleWatched(id)` | Switch a movie between pending and watched. |
| `renderLanguage()` | Apply the selected language to page copy, metadata, and form errors. |

Both generators avoid an immediate repeat when more than one option is available.
The seed catalog and food list live in `INITIAL_MOVIES` and `FOODS` in `app.js`.
Their translated copy lives in `i18n.js`, alongside interface messages, universe
names, and mood captions. Keep both language dictionaries in sync when adding copy.
Built-in movies are translated by ID at display time; duplicate detection recognizes
both their English and Spanish titles.
Changing the seed list's metadata affects new browser collections, not previously
saved ones. Translation updates apply to existing built-in movies as well.
The five palettes are CSS variables in `styles.css`.

## Storage and privacy

Movies, watched status, plans, the current selection, date/location draft, filters,
theme, language, and active list are stored in `localStorage` under `movie-night:v1`.
Previously saved collections and plans continue to work without resetting data. Nothing is sent to
a server. Tabs on the same origin listen for saved changes; if two tabs write at
the same instant, the last write wins.

Data belongs to this browser profile and origin: it does not sync between devices,
and a local preview has different storage from the published website. Private
browsing or clearing site data may remove the collection. Export the key's JSON
from your browser's developer tools before clearing storage if you need a backup.

If storage is unavailable or full, a visible warning explains that changes may
only last for the current tab. Invalid or incompatible stored data is preserved
without overwriting it, and persistence is disabled for that session. To recover,
back up the raw value in developer tools, remove only `movie-night:v1`, and reload.

The app uses local assets and system fonts, but is not an installable/offline PWA.
Opening it from GitHub Pages still requires a connection to download its files.
