# gestaltparaelalma: Instagram autopilot

This repo is PUBLIC. Never commit secrets, emails, phone numbers or private notes: those live in `.env` and `CLAUDE.local.md` (both gitignored). Personal context about the people involved is in `CLAUDE.local.md`.

## Goal

Grow @gestaltparaelalma (a Gestalt therapist's account), get more engagement from current followers, and turn followers into patients who book a **consulta de bienvenida**. The only call to action is **"escribime por mensaje directo"** (DM) or a question sticker. Never publish a phone number, address or external booking link.

## How it works (decided 2026-10-01, cost must stay $0)

| Piece | What | Where |
|---|---|---|
| Generate | Weekly Claude task writes captions and renders images for the week | This Mac |
| Approve | Sofía reviews drafts on a local review page (to build) | This Mac, `drafts/` (gitignored) |
| Queue | Approved posts as folders: images + caption + scheduled date | `queue/` in this repo |
| Publish | GitHub Actions runs once a day and publishes everything that is due | `.github/workflows/` |
| Access | Meta app `gestalt-publisher` + long-lived Instagram token | GitHub secret `IG_ACCESS_TOKEN` + local `.env` |

- One post a day at a fixed time is enough. GitHub's scheduler can run hours late, so the publisher must publish **anything due and not yet published**, never "exactly this hour".
- Rejected drafts never leave the Mac. Only approved posts get committed (the repo is public).
- Images must be reachable at a public URL when Instagram creates the container; use the raw GitHub URL of the committed file (`https://raw.githubusercontent.com/facubarboza22/gestaltparaelalma/main/queue/...`). JPEG, 4:5 (1080×1350) for feed.
- No paid APIs. Content is written by Claude in the Mac session (the user's subscription), not from GitHub Actions.

## Accounts and IDs (not secret)

- GitHub: `facubarboza22/gestaltparaelalma` (public). Push works via the repo-local `credential.helper=!gh auth git-credential` (the macOS keychain holds a different, work GitHub credential). The repo config first sets an empty `credential.helper` to clear the inherited `osxkeychain`; without it git asks the keychain first and the push gets a 403 as the work account.
- Meta app **gestalt-publisher**: app ID `1563617255075951`, Instagram app ID `1112821461091196` (name `gestalt-publisher-IG`), Development mode (no App Review needed to post to our own tester account). Use case "Manage messaging & content on Instagram" = Instagram API with Instagram Login (`graph.instagram.com`, no Facebook Page needed).
- Permissions added: `instagram_business_basic`, `instagram_business_content_publish`, `instagram_business_manage_insights`. Messages and comments permissions deliberately NOT added (her DMs stay private).
- @gestaltparaelalma accepted the Instagram tester invite on 2026-10-01.
- The app secret lives only in the Meta dashboard. Never paste it or the token in chat; never print env values.

### Chrome profiles (Claude in Chrome extension)

- **"Gestalt"** profile: Instagram signed in as gestaltparaelalma + Facebook. It CANNOT open developers.facebook.com: Facebook blocked it as a "new device" (may clear after some days).
- **"personal"** profile: owns the Meta developer dashboard (both `playpremodern-publisher` and `gestalt-publisher`). Its Instagram session is probably @playpremodern.
- Always confirm which account is signed in before acting. The Instagram OAuth popup silently uses whichever IG account is active in that profile (this caused "Rol de desarrollador insuficiente" on playpremodern).

## Status

- [x] Meta app created, permissions added, tester invite accepted (2026-10-01)
- [x] Local folder + GitHub repo
- [x] Access token (2026-10-01). Generated in the "personal" profile (Meta dashboard → Casos de uso → API de Instagram → "2. Genera identificadores de acceso" → "Generar identificador" on the gestaltparaelalma row) after switching that profile's Instagram to gestaltparaelalma. Saved as GitHub secret `IG_ACCESS_TOKEN` and in local `.env`. Verified: username gestaltparaelalma, `account_type` MEDIA_CREATOR, IG user ID `17841465773777580`, publishing quota 100 per 24 h. 60-day token: **expires ~2026-11-30 unless refreshed.**
  - Saving a secret needs an interactive terminal (the app's Terminal panel), not the chat's `!` box: `read -s` gets no input there.
- [x] Publisher (2026-10-01): `scripts/ig.mjs` (whoami / check / publish [--dry-run] / refresh), pure helpers in `scripts/lib/queue.mjs` (tests: `node --test scripts/`), workflow `.github/workflows/publish.yml` (every 2 h, 08:17–20:17 UTC-3, one post per run, commits `published.json` / `error.json` back). Queue format in `queue/README.md`. Token expiry lives in repo variable `IG_TOKEN_EXPIRES_AT` (+ `.env`); runs go red <10 days before it, which is the email alert. `refresh` renews the token into `.env`, the secret and the variable; the weekly Mac task must call it. First real carousel published 2026-10-14 (manual `gh workflow run publish.yml`: GitHub's schedule never fired before ~16:00 UTC in 8 days of history, so the 10:00 post was late). Second clock: cron-job.org POSTs `workflow_dispatch` to the GitHub API every hour (see below); the workflow's `concurrency` group keeps overlapping runs from double-posting.
- [x] Review page (2026-10-01): `scripts/review.mjs` + `scripts/review/index.html`, no dependencies, http://localhost:5178 (localhost only, POSTs need our Origin). Sofía double-clicks `Revisar posts.command` in the repo folder. Edit caption/date (renames the draft folder to the new day), Aprobar (validates, moves to `queue/`, commit + push), Rechazar (to `drafts/_rechazados/` with reason), Volver a borradores (unpublished queue posts). Git actions run one at a time and pull first. Tested end to end against a sandbox clone with a local remote, never with real posts. Preview for Claude: `.claude/launch.json` → "review".
- [x] Templates + renderer (2026-10-13): `scripts/render/slide.html` (sage #709279 + paper, Fraunces / Karla / Caveat from Google Fonts, procedural paper grain, hand-drawn SVG strokes; layouts cover/text/big/note/cta; colour scheme per weekly theme via `"theme"`: salvia / arcilla / bosque, rotating, see `docs/estrategia.md`) and `scripts/render.mjs drafts/<post>` reading `slides.json` → NN.jpg, or reel.mp4 + cover.jpg (frames piped to ffmpeg, silent audio track). Playwright is a devDependency; on this Mac `node_modules/playwright*` are symlinks to playpremodern's copy (npm install hung). Rosario's portrait for CTA slides: `drafts/_assets/rosario.jpg` (her own Aug 2026 post, local only).
- [x] Reels (2026-10-13): a queue folder with `reel.mp4` (+ `cover.jpg`) publishes as REELS. The video URL goes through jsDelivr pinned to the commit (raw GitHub serves mp4 as octet-stream; jsDelivr max 20 MB). **Not yet tried against Instagram.**
- [x] Writing rules against AI-sounding copy: `docs/escritura.md`. Research with sources per theme: `docs/investigacion/`.
- [x] First theme published (14, 16, 19, 21 Oct). Second theme drafted 2026-10-21: despedidas (non-death grief), 4 carousels (5 slides each, short text) + 1 reel in `drafts/` (23, 26, 27 reel, 28, 30 Oct), waiting for Sofía.
- [x] cron-job.org second clock (fixed 2026-10-21): the job set up on 2026-10-14 had never been saved. Recreated as job "gestaltparaelalma publicar" in the user's cron-job.org account (same account as "playpremodern instagram"): POST to the `publish.yml` dispatches endpoint, body `{"ref":"main"}`, headers Accept / X-GitHub-Api-Version / Authorization, crontab `5 8-21 * * *` America/Montevideo, responses saved in history. Fine-grained token `cron-job gestalt` (Actions read/write, this repo only) created by the user, ~1 year: renew it before ~2027-10-21. The console's test run needs a captcha, so verify with the scheduled run instead.
- [x] Strategy: `docs/estrategia.md` (one theme a week, Mon/Wed/Fri). Depression postponed: too delicate (2026-10-21).
- [ ] Weekly Claude task that fills next week's drafts
- [ ] First test post, approved by Sofía

## Reference implementation (read, don't copy blindly)

The @playpremodern publisher already works and lives in `/Users/facundobarboza/playpremodern`:
- `src/lib/instagram.ts`: container plan for image/carousel/reel/story, publish state machine, token refresh (`graph.instagram.com/v25.0`).
- `scripts/social/ig.mjs`: CLI (whoami, limit, draft, publish).
- `.github/workflows/instagram.yml`: scheduled workflow.
- `docs/instagram/weekly-worker.md`: weekly-worker runbook.

That one runs on Vercel + Firestore because it's part of a website. This repo has no website: state lives in the queue folders (e.g. a `published.json` written back by the workflow), not in a database.

Gotchas learned there:
- GitHub scheduled workflows are unreliable (runs skipped or hours late). Publish whatever is overdue.
- Reels: the video container can stay IN_PROGRESS for minutes; poll status before `media_publish`.
- Instagram allows a limited number of API posts per 24 h (check `content_publishing_limit`).
- Never print tokens. When appending to `.env`, make sure the previous line ends with a newline.

## Content rules (health content in someone else's name)

- Every post is approved by Sofía before it's queued. Nothing auto-publishes without approval.
- Write in Rioplatense Spanish (voseo), warm and simple, in the therapist's first person. No AI-sounding filler, no therapy jargon without explaining it.
- Never diagnose, promise results or give medical advice. No patient stories or quotes. No before/after.
- Don't name or quote authors in posts unless Rosario approved that author (none yet; Sofía's call, 2026-10-14). Any approved quote still gets verified at a primary source, never from memory.
- Every post speaks from Gestalt (an exercise or a Gestalt lens at its center). No study data or statistics (decided 2026-10-21). Rules in `docs/escritura.md`.
- For posts about anxiety, grief, depression or self-harm: gentle tone, and add that it's not a substitute for urgent help, with a crisis line for her country when relevant.
- CTA: invite people to write by DM for a consulta de bienvenida. Never ask for a phone number publicly.

## Working with the user

The user (Facundo) is a beginner who learns by doing. Talk in Rioplatense Spanish, explain jargon the first time, give one recommendation instead of a list, and say clearly which steps they must do themselves (passwords, pasting secrets, approving terms).
