# Workforce Planner — Internal Deployment Guide (draft for IT)

Status: draft. Written before the real-data import feature (item 1A below) is built, so IT can start
site/server setup (1B) in parallel. Update the "data file" section once 1A ships.

## What Brian needs to be able to update this himself

Two things, regardless of which hosting option IT picks — the rest of this doc is background/detail, not
required reading to act on this part:

1. **Code updates reach the live app without manual server access each time.** Ideally: a push to `main` on
   GitHub triggers an automatic build + deploy. (Azure Static Web Apps does this out of the box via a
   GitHub Actions workflow it sets up itself. If it's the VM route instead, ask for a small script/webhook
   that runs `git pull && npm run build` and swaps the files in, rather than manual RDP/SSH each time.)
2. **A way to replace one small data file about once a week, on my own, with no full redeploy or ticket to
   IT.** Write access to one specific location — a mapped drive, SFTP login, storage account key/SAS token,
   whatever fits how they're hosting it — kept separate from the app's own files, so updating it is a single
   file copy.

Everything else in this doc (SSO mechanism, DNS, which VM/hosting option) is IT's call and doesn't change
what's needed here.

## What this app actually is

A static, client-only web app — no backend, no database, no server-side code. It's built once into a
folder of plain HTML/JS/CSS files and served exactly like any static website. Node.js is only needed to
_build_ it; nothing Node-related needs to run continuously in production.

## Worth raising with IT: this may not need a VM at all

Other Upchurch tools on Azure (e.g. whatever runs on `UPC-AZ-VM-PAS-01`) are R/Shiny-based — a persistent
process that has to stay running, seeds live data tables on startup, restarts on crash, and needs R and its
packages kept in sync on the server. That kind of app genuinely needs a VM (or an always-on app service).

Workforce Planner has none of that. After `npm run build` it is a folder of plain static files — there is no
server-side runtime, no process to keep alive, no startup data-seeding step, nothing version-dependent on
the host beyond "can it serve files over HTTPS." That means a VM is one option, but not the only one, and
possibly not the best one:

- **Azure Static Web Apps** (or Blob Storage + CDN) hosts this kind of app directly, with no VM to patch or
  maintain. It also has Azure AD login built in ("Easy Auth"), which would satisfy the SSO requirement (item
  2 below) with no reverse-proxy config and no app changes — solving two open items at once.
- If IT has a strong preference for VM-based hosting for internal tools regardless, that's fine too — the
  app doesn't care, it's just files either way.

Worth asking IT directly whether Static Web Apps (or equivalent) is on the table before they spend time
either fixing the `PAS-01` VM issue or standing up a new one.

## Decisions — confirmed vs. still open

Confirmed by Brian (2026-09-11):

1. **URL: `https://workforce-planner.upchurchus.com/`** — root of its own subdomain, not a subpath under
   another site. This is the simpler case for us: a plain `npm run build` (no `GITHUB_ACTIONS` env var set)
   already produces the build with root-relative paths (`base: '/'`), so **no code change is needed** for
   this. IT's side: point DNS for that subdomain at wherever the site is hosted, and provision/attach a TLS
   certificate for it.
2. **Access restriction: SSO.** The app itself has no login screen or auth of any kind built in — it's a
   static site, so the SSO gate has to sit in front of it (a reverse proxy that enforces SSO before serving
   any file, or a hosting platform with that built in — see the Static Web Apps option above, which solves
   this and the hosting question together). Whatever mechanism IT picks, please confirm it here so we can
   note any app-side implications (there shouldn't be any, since it's all static files).
3. **Data folder is separate from the app** — confirmed, matches the plan below exactly.

Still open — need answers from IT:

4. **Repo access.** The GitHub repo is currently public, so `git clone`/`git pull` needs no credentials.
   If you'd rather we make it private for an internal business tool, we can — but then this server needs a
   deploy key or personal access token to pull it. Let us know which you'd prefer.
5. **Outbound access for site visitors.** The app currently loads two web fonts from Google
   (`fonts.googleapis.com`, `fonts.gstatic.com`) when a page loads. If client machines on your network
   don't have general internet egress, confirm whether they can reach those two domains — if not, tell us
   and we'll switch to self-hosted fonts before the real deploy (small change, not done yet).
6. **Which server/hosting this actually goes on.** IT initially tried adding this URL to the existing
   `UPC-AZ-VM-PAS-01` Azure VM (which already hosts other, R-based Upchurch tools) and hit an issue, so a
   new, dedicated VM may be created instead. See "Worth raising with IT" above — given this app has no
   server-side runtime at all, a VM may not be the best fit here regardless of whether `PAS-01`'s issue gets
   fixed; Azure Static Web Apps is worth a direct ask. None of the steps in this guide change based on which
   hosting option IT lands on — same Node build, same static-file serving, same separate data folder — so
   this doesn't block 1A or the rest of 1B.

## One-time server setup

1. Install Node.js 22+ and npm.
2. Clone the repo: `git clone <repo-url>`
3. From the repo root: `npm ci`, then `npm run build`. This produces a `dist/` folder — that folder _is_
   the entire app (static HTML/JS/CSS/images).
4. Point your web server (IIS, NGINX, Azure Static Web Apps, whatever you use elsewhere) at `dist/` as the
   site root, serving plain static files. No app server, reverse proxy to a Node process, or WSGI/ASGI
   equivalent is required — it's just files.

## The data file — deliberately kept outside the app's build

The app loads its working data at runtime from one JSON file, fetched as
`./data/workforce-planner.json` relative to the site.

That file must live **outside** both the git repo and the `dist/` folder the build produces — for example
`/var/www/workforce-planner-data/workforce-planner.json` on the server, with your web server configured to serve it at
the site's `/data/workforce-planner.json` path (an NGINX `location` block or IIS virtual directory pointing outside the
deployed `dist/` folder both work fine). The reason: every time we `git pull` and rebuild for a code
update, `dist/` gets regenerated from scratch — if the data file lived inside it, a routine code deploy
would wipe or roll back real data. Keeping it outside means code deploys and data updates are completely
independent operations.

Real company data (project names, labor costs, headcount) should **never** be committed to the git repo or
placed anywhere under `dist/` — that's the one hard rule here, since the repo may stay public (see decision
3 above) and code deploys will happen more than once.

## Redeploying a code update (after the initial setup)

1. `git pull`
2. `npm ci && npm run build`
3. Swap the new `dist/` contents into place. The data file at `/data/workforce-planner.json` is untouched, since it
   lives outside `dist/`.

## Weekly data refresh (once the import feature ships)

1. Brian exports the relevant data from BuildOps.
2. Runs it through the app's import screen (still to be built) → downloads a finished `workforce-planner.json`.
3. That file gets copied to the server path IT set up above (e.g. `/var/www/workforce-planner-data/workforce-planner.json`).

No code deploy, rebuild, or IT involvement is needed for this weekly step once the server path is set up —
it's a single file copy.

## One cleanup item

The repo also auto-deploys a dataless copy to GitHub Pages
(`https://brianbalzar.github.io/workforce-planner/`) on every push to `main`, via
`.github/workflows/deploy.yml`. It contains no workforce dataset. A user may
select a finished `workforce-planner.json`, which remains in that browser tab's
memory only and must be selected again after a refresh. The file is not sent to
GitHub or retained by the app.

## Open items still in progress on our side (not blockers for 1B)

- The in-app BuildOps and detailed-estimate import screens (runtime loading is now implemented).
- Confirming the exact `base` path config once decision 1 (URL/path) is answered.
- Self-hosting fonts if decision 4 comes back "no general internet egress."
