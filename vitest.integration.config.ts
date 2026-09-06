import { defineConfig } from 'vitest/config';

/**
 * Runs src/**\/*.integration.test.ts against a live Redfish service — by
 * default DMTF's own reference server, the Redfish-Interface-Emulator
 * (https://github.com/DMTF/Redfish-Interface-Emulator):
 *
 *   docker run --rm -p 5000:5000 dmtf/redfish-interface-emulator:latest
 *
 * These are skipped automatically (not failed) when no service answers at
 * REDFISH_TEST_BASE_URL, so `npm test` stays fast and offline by default.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.integration.test.ts'],
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
