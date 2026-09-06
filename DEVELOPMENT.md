# Development

Built with [Vite](https://vitejs.dev) in library mode (dual ESM/CJS + bundled `.d.ts` via `vite-plugin-dts`), tested with [Vitest](https://vitest.dev), linted with ESLint/typescript-eslint.

```sh
npm ci
npm run lint
npm run typecheck
npm test
npm run build
```

Other scripts: `npm run test:watch`, `npm run coverage`, `npm run docs` (builds TypeDoc output into `docs/`, gitignored — CI publishes it to GitHub Pages).

## Integration tests

`npm test` only runs against a mocked `fetch`. `src/client.integration.test.ts` additionally exercises the client against a real Redfish HTTP server — [DMTF's own reference emulator](https://github.com/DMTF/Redfish-Interface-Emulator) — and is skipped automatically when nothing answers at `REDFISH_TEST_BASE_URL` (default `http://localhost:5000`):

```sh
docker run --rm -p 5000:5000 dmtf/redfish-interface-emulator:latest
npm run test:integration
```

It covers the read surface (`getServiceRoot`, `getSystems`, `getSystem`, `getChassisCollection`) and action discovery/invocation (`resetSystem`). The emulator's bundled `SessionService` fixture predates the current spec and doesn't support session creation, so `{ type: 'session' }` auth isn't covered by it.

CI runs this same suite as the `integration` job against the same container image (see `.github/workflows/ci.yml`).

### Other DMTF tooling worth knowing about

- [Redfish-Mockup-Server](https://github.com/DMTF/Redfish-Mockup-Server) — serves static JSON mockups (GET-only), useful for read-path fixtures against specific vendor mockup data (DSP2043).
- [Redfish-Service-Validator](https://github.com/DMTF/Redfish-Service-Validator) / [Redfish-Protocol-Validator](https://github.com/DMTF/Redfish-Protocol-Validator) — conformance checkers for a *service*, not a client, but useful for validating any target BMC before filing a bug against this client.
- [python-redfish-library](https://github.com/DMTF/python-redfish-library) — DMTF's official Python client; this package's `auth`/`connect`/`disconnect` shape and the `insecure` TLS option mirror its `redfish_client`/`login`/`cafile` design.

## CI

`.github/workflows/ci.yml` has four jobs:

- **test** — lint, typecheck, unit tests + coverage, build. Matrix: Node 22.x/24.x. (The published package only needs Node >=18.17 per `engines` — fetch/undici/AbortController all work there. The matrix is narrower than that because the *dev toolchain*, vite 8 / vitest 5, requires newer Node to run at all.)
- **integration** — runs the integration suite against a `dmtf/redfish-interface-emulator` service container.
- **docs** — builds TypeDoc and deploys it to GitHub Pages, on push to `main`. One-time setup: repo Settings > Pages > Source = "GitHub Actions".
- **release** — runs `semantic-release` on push to `main`, after `test` and `integration` pass.

## Releasing

Versioning, the `CHANGELOG.md`, npm publish, and the GitHub release are all handled by [semantic-release](https://semantic-release.gitbook.io/) from [Conventional Commits](https://www.conventionalcommits.org/) on `main` — there's no manual version bump or tag. Commit subjects drive the bump:

- `fix: ...` → patch
- `feat: ...` → minor
- `feat!: ...` / a `BREAKING CHANGE:` footer → major

`release.config.js` wires the plugins. `npm run release:dry` runs a dry-run locally (no publish/push).

Publishing currently authenticates to npm with an automation token in the `NPM_TOKEN` repository secret (`@semantic-release/npm`). Once this package is enrolled in [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers), switch the `release` job to OIDC — add `id-token: write` to its permissions and drop `NPM_TOKEN` — see the `TODO` comment above that job in `ci.yml`.
