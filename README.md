# node-redfish

[![CI](https://github.com/SourceRegistry/node-redfish/actions/workflows/ci.yml/badge.svg)](https://github.com/SourceRegistry/node-redfish/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/node-redfish.svg)](https://www.npmjs.com/package/node-redfish)
[![npm downloads](https://img.shields.io/npm/dm/node-redfish.svg)](https://www.npmjs.com/package/node-redfish)
[![docs](https://img.shields.io/badge/docs-typedoc-blue)](https://sourceregistry.github.io/node-redfish/)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](./LICENSE)
[![semantic-release](https://img.shields.io/badge/%20%20%F0%9F%93%A6%F0%9F%9A%80-semantic--release-e10079.svg)](https://github.com/semantic-release/semantic-release)

A TypeScript client for querying and managing [Redfish](https://www.dmtf.org/standards/redfish)-compliant BMCs (Dell iDRAC, HPE iLO, Lenovo XCC, Supermicro, and other DMTF Redfish implementations).

Ships as dual ESM/CJS with bundled type declarations, built with [Vite](https://vitejs.dev) in library mode.

## Install

```sh
npm install node-redfish
```

## Usage

```ts
import { RedfishClient } from 'node-redfish';

const client = new RedfishClient({
  baseUrl: 'https://10.0.0.5',
  auth: { type: 'session', username: 'admin', password: 'secret' },
  // Most BMCs ship a self-signed TLS certificate.
  insecure: true,
});

await client.connect();

const root = await client.getServiceRoot();
console.log(root.RedfishVersion);

const systems = await client.getSystems();
for (const system of systems) {
  console.log(system.Id, system.PowerState, system.Status?.Health);
}

await client.resetSystem(systems[0].Id!, 'GracefulRestart');

await client.disconnect();
```

### Authentication

Three strategies are supported via the `auth` option:

```ts
// HTTP Basic auth on every request
{ type: 'basic', username: 'admin', password: 'secret' }

// Redfish session auth: connect() creates a session and captures
// X-Auth-Token; disconnect() deletes it.
{ type: 'session', username: 'admin', password: 'secret' }

// A pre-existing X-Auth-Token / bearer-style token
{ type: 'token', token: 'abc123' }
```

Omit `auth` (or pass `{ type: 'none' }`) for unauthenticated requests.

### Self-signed certificates

BMCs commonly present a self-signed or vendor-CA certificate. Pass `insecure: true` to skip TLS verification (backed by an [undici](https://github.com/nodejs/undici) `Agent`).

### API surface

```ts
client.getServiceRoot();

client.getSystems();          // expanded ComputerSystem[]
client.getSystemIds();        // string[] of resource IDs
client.getSystem(id);
client.resetSystem(id, resetType); // 'On' | 'ForceOff' | 'GracefulRestart' | ...

client.getChassisCollection();
client.getChassis(id);
client.getPower(chassisId);
client.getThermal(chassisId);

client.getManagers();
client.getManager(id);
client.resetManager(id, resetType);

client.getSessions();

// Generic escape hatches for anything not wrapped above
client.get(path);
client.post(path, body);
client.patch(path, body, etag);  // sends If-Match when etag is given
client.put(path, body, etag);
client.delete(path);
```

`resetSystem`/`resetManager` read the action `target` URL from the resource's own `Actions` block (per the Redfish spec) rather than assuming a fixed path, and throw `RedfishActionNotSupportedError` if the resource doesn't advertise that action.

### Errors

- `RedfishError` — non-2xx response; carries `status`, `statusText`, parsed `body`, and `extendedInfo` (from `@Message.ExtendedInfo`).
- `RedfishTimeoutError` — request exceeded `timeoutMs` (default 15s).
- `RedfishActionNotSupportedError` — requested action isn't present on the resource.

## Development

```sh
npm ci
npm run lint
npm run typecheck
npm test
npm run build
```

### Integration tests

`npm test` only runs against a mocked `fetch`. `src/client.integration.test.ts` additionally exercises the client against a real Redfish HTTP server — [DMTF's own reference emulator](https://github.com/DMTF/Redfish-Interface-Emulator) — and is skipped automatically when nothing answers at `REDFISH_TEST_BASE_URL` (default `http://localhost:5000`):

```sh
docker run --rm -p 5000:5000 dmtf/redfish-interface-emulator:latest
npm run test:integration
```

It covers the read surface (`getServiceRoot`, `getSystems`, `getSystem`, `getChassisCollection`) and action discovery/invocation (`resetSystem`). The emulator's bundled `SessionService` fixture predates the current spec and doesn't support session creation, so `{ type: 'session' }` auth isn't covered by it.

Other DMTF tooling worth knowing about if you're extending this package:
- [Redfish-Mockup-Server](https://github.com/DMTF/Redfish-Mockup-Server) — serves static JSON mockups (GET-only), useful for read-path fixtures against specific vendor mockup data (DSP2043).
- [Redfish-Service-Validator](https://github.com/DMTF/Redfish-Service-Validator) / [Redfish-Protocol-Validator](https://github.com/DMTF/Redfish-Protocol-Validator) — conformance checkers for a *service*, not a client, but useful for validating any target BMC before filing a bug against this client.
- [python-redfish-library](https://github.com/DMTF/python-redfish-library) — DMTF's official Python client; this package's `auth`/`connect`/`disconnect` shape and the `insecure` TLS option mirror its `redfish_client`/`login`/`cafile` design.

## Publishing

CI (`.github/workflows/ci.yml`) publishes to npm on `v*` tags using the `NPM_TOKEN` repository secret. Once this package is enrolled in [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers), the publish job should switch to OIDC (`id-token: write` + `npm publish --provenance`, no token secret) — see the `TODO` in the workflow file.

## License

Apache-2.0
