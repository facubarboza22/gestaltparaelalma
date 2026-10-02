# queue/

Approved posts waiting to go out (and the ones already published). Only posts Sofía approved are committed here: the repo is public.

One folder per post, named `YYYY-MM-DD-short-title` (lowercase, no spaces or accents):

```
queue/2026-10-06-que-es-gestalt/
  01.jpg          one image = single post; 01.jpg…10.jpg = carousel
  caption.txt     the caption, exactly as it will appear
  post.json       {"approved": true, "publishAt": "2026-10-06T10:00:00-03:00"}
```

- Images: JPEG, 1080×1350 (4:5). All slides of a carousel the same size.
- `publishAt` always carries its time zone (`-03:00`). The post goes out at the first publisher run after that time (runs are every two hours, 08:17 to 20:17, and GitHub can be late).
- Caption: no links, no phone numbers; the call to action is a DM. Max 2200 characters, 30 hashtags.

Drafts (`drafts/`, gitignored, never pushed) use the same folder format, with `post.json` = `{"publishAt": "…", "note": "…"}`: no `approved`, and an optional `note` that only Sofía sees on the review page. Approving on the review page (`Revisar posts.command`, or `node scripts/review.mjs`) moves the folder here, keeps only `approved`/`publishAt`/`approvedAt` in `post.json`, and commits + pushes it. Rejected drafts go to `drafts/_rechazados/<post>/` with `rechazo.json` (`reason`, `at`): read them before writing new drafts.

Written by the publisher, don't edit by hand:

- `published.json`: Instagram media id, link and time. A post with this file is never published again.
- `error.json`: last error and number of attempts. After 3 failed attempts the post stops retrying; fix it and delete `error.json` to try again.

Commands (from the repo folder):

| Command | What it does |
|---|---|
| `node scripts/ig.mjs check` | Validates every post and shows its state. Run it before committing. |
| `node scripts/ig.mjs publish --dry-run` | Shows what the next run would publish, without publishing. |
| `node scripts/ig.mjs whoami` | Confirms the token is for @gestaltparaelalma. |
| `node scripts/ig.mjs refresh` | Renews the 60-day token (Mac only; weekly). |

Emergency stop: commit an empty file named `PAUSED` at the repo root. Delete it to resume.
