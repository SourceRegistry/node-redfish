# node-redfish

[![CI](https://github.com/SourceRegistry/node-redfish/actions/workflows/ci.yml/badge.svg)](https://github.com/SourceRegistry/node-redfish/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/node-redfish.svg)](https://www.npmjs.com/package/node-redfish)
[![npm downloads](https://img.shields.io/npm/dm/node-redfish.svg)](https://www.npmjs.com/package/node-redfish)
[![docs](https://img.shields.io/badge/docs-typedoc-blue)](https://sourceregistry.github.io/node-redfish/)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](./LICENSE)
[![semantic-release](https://img.shields.io/badge/%20%20%F0%9F%93%A6%F0%9F%9A%80-semantic--release-e10079.svg)](https://github.com/semantic-release/semantic-release)

A TypeScript client for querying and managing [Redfish](https://www.dmtf.org/standards/redfish)-compliant BMCs (Dell iDRAC, HPE iLO, Lenovo XCC, Supermicro, and other DMTF Redfish implementations).

Ships as dual ESM/CJS with bundled type declarations. Full API reference: **https://sourceregistry.github.io/node-redfish/**

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

## Contributing

See [DEVELOPMENT.md](./DEVELOPMENT.md) for local setup, testing (including integration tests against a real Redfish server), and the release process.

## License

Apache-2.0
