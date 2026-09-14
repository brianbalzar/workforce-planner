Subject: Workforce Planner — deployment request

Repo: https://github.com/brianbalzar/workforce-planner (public — no credentials needed to clone)
Target URL: https://workforce-planner.upchurchus.com

What we need:

1. **Hosting: Azure Static Web Apps.** This is a 100% static app — plain HTML/JS/CSS, no server process,
   no database, nothing that needs to stay running. Static Web Apps handles SSO (Azure AD) and auto-deploy
   out of the box with no custom scripting, and avoids the kind of conflict we hit trying to add this to the
   existing PAS VM. If you'd rather keep it on a VM instead, that's fine — same build command below, but
   you'll need to set up the auto-deploy step and SSO enforcement yourselves (see 3 and 4).

2. **Build:** `npm ci && npm run build` (Node 22+) produces the whole app as static files in `dist/`.
   Static Web Apps runs this itself once connected to the repo.

3. **Auto-deploy:** connect the site to this GitHub repo so every push to `main` redeploys automatically.
   (If on a VM instead: a script or webhook that runs the build command and swaps the files in on each
   push.)

4. **SSO:** gate the whole site behind SSO — Azure AD if using Static Web Apps/App Service.

5. **Data file:** the app loads its working data at runtime from one JSON file. That file needs to live
   somewhere separate from the app's own deployed files and separate from the repo, so a code redeploy
   never touches or overwrites it (an Azure Storage container works well on Static Web Apps; a folder
   outside the site root works on a VM). Give Brian write access to that location — storage key, SAS token,
   or upload credential — so he can replace the file himself, about weekly, without a ticket each time.

6. **Heads-up:** the app currently loads two fonts from Google (`fonts.googleapis.com`,
   `fonts.gstatic.com`) at page load. Flag it if that's blocked on your network and we'll self-host them
   instead.

Let us know if you have questions.
