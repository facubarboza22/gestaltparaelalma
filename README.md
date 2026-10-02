# gestaltparaelalma

Automatic publisher for the Instagram account [@gestaltparaelalma](https://www.instagram.com/gestaltparaelalma/).

- `queue/`: approved posts (images + caption + date). GitHub Actions publishes the ones that are due. Format and commands in [queue/README.md](queue/README.md).
- `scripts/`: publisher (`ig.mjs`), review page (`review.mjs`) and helpers. Tests: `node --test scripts/`.
- `Revisar posts.command`: double-click to open the review page.
- `docs/`: strategy, calendar and runbooks.
