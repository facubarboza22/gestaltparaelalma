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

- GitHub: `facubarboza22/gestaltparaelalma` (public). Push works via the repo-local `credential.helper=!gh auth git-credential` (the macOS keychain holds a different, work GitHub credential).
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
- [ ] **Next: access token.** In the "personal" profile, Meta dashboard → Casos de uso → API de Instagram → "Configuración de la API con el inicio de sesión de Instagram" → "2. Genera identificadores de acceso" → Añadir cuenta. The Instagram popup must be signed in as **gestaltparaelalma** (switch accounts there first; the user types the password). The user saves the token themselves: `gh secret set IG_ACCESS_TOKEN --repo facubarboza22/gestaltparaelalma` (paste when prompted) and as `IG_ACCESS_TOKEN=` in local `.env` (check the file ends with a newline before appending). Then verify with a `/me?fields=user_id,username,account_type` call without printing the token.
- [ ] Publisher script + daily GitHub Actions workflow + token refresh (60-day token; refresh weekly from the Mac task and update the secret with `gh secret set`)
- [ ] Local review page for Sofía (approve / edit caption / reject / reschedule)
- [ ] Image templates (HTML → PNG with Playwright, calm Gestalt look)
- [ ] Strategy, content pillars, calendar (`docs/`)
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
- Attribute quotes correctly (e.g. Fritz Perls' "Gestalt prayer"); verify any quote or author before using it, never from memory alone.
- For posts about anxiety, grief, depression or self-harm: gentle tone, and add that it's not a substitute for urgent help, with a crisis line for her country when relevant.
- CTA: invite people to write by DM for a consulta de bienvenida. Never ask for a phone number publicly.

## Working with the user

The user (Facundo) is a beginner who learns by doing. Talk in Rioplatense Spanish, explain jargon the first time, give one recommendation instead of a list, and say clearly which steps they must do themselves (passwords, pasting secrets, approving terms).
