import { beforeAll, describe, expect, it } from 'vitest';
import { RedfishClient } from './client.js';

const baseUrl = process.env.REDFISH_TEST_BASE_URL ?? 'http://localhost:5000';

async function isReachable(url: string): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

const available = await isReachable(`${baseUrl}/redfish/v1/`);

if (!available) {
  console.warn(
    `[integration] No Redfish service reachable at ${baseUrl} — skipping. ` +
      'Start one with: docker run --rm -p 5000:5000 dmtf/redfish-interface-emulator:latest',
  );
}

/**
 * Exercises RedfishClient against a real Redfish HTTP server rather than a
 * mocked fetch, using DMTF's own reference emulator as the target. Its
 * SessionService fixture predates the current spec and doesn't support
 * session creation, so this only covers the unauthenticated GET surface and
 * the action-discovery POST path — the parts every BMC must get right.
 */
describe.skipIf(!available)('RedfishClient integration (DMTF Redfish-Interface-Emulator)', () => {
  let client: RedfishClient;

  beforeAll(() => {
    client = new RedfishClient({ baseUrl });
  });

  it('fetches the service root', async () => {
    const root = await client.getServiceRoot();
    expect(root['@odata.id']).toBe('/redfish/v1/');
    expect(root.Systems).toBeDefined();
  });

  it('expands the Systems collection into full resources', async () => {
    const systems = await client.getSystems();
    expect(systems.length).toBeGreaterThan(0);
    for (const system of systems) {
      expect(system.Id).toBeTruthy();
      expect(system['@odata.type']).toContain('ComputerSystem');
    }
  });

  it('fetches a single system by id', async () => {
    const [first] = await client.getSystems();
    const system = await client.getSystem(first!.Id!);
    expect(system['@odata.id']).toBe(first!['@odata.id']);
  });

  it('expands the Chassis collection into full resources', async () => {
    const chassis = await client.getChassisCollection();
    expect(chassis.length).toBeGreaterThan(0);
    expect(chassis[0]!['@odata.type']).toContain('Chassis');
  });

  it('discovers and invokes #ComputerSystem.Reset from the resource Actions block', async () => {
    const [system] = await client.getSystems();
    await expect(client.resetSystem(system!.Id!, 'On')).resolves.toBeUndefined();
  });
});
