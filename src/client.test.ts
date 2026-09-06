import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RedfishClient } from './client.js';
import { RedfishActionNotSupportedError, RedfishError, RedfishTimeoutError } from './errors.js';

function jsonResponse(body: unknown, init: ResponseInit & { headers?: Record<string, string> } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    statusText: init.statusText,
    headers: { 'Content-Type': 'application/json', ...init.headers },
  });
}

describe('RedfishClient', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches the service root', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ '@odata.id': '/redfish/v1/', RedfishVersion: '1.17.0' }));
    const client = new RedfishClient({ baseUrl: 'https://bmc.example.com', fetch: fetchMock as unknown as typeof fetch });

    const root = await client.getServiceRoot();

    expect(root.RedfishVersion).toBe('1.17.0');
    expect(fetchMock).toHaveBeenCalledWith('https://bmc.example.com/redfish/v1', expect.objectContaining({ method: 'GET' }));
  });

  it('authenticates with basic auth on every request', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ '@odata.id': '/redfish/v1/' }));
    const client = new RedfishClient({
      baseUrl: 'https://bmc.example.com',
      auth: { type: 'basic', username: 'admin', password: 'hunter2' },
      fetch: fetchMock as unknown as typeof fetch,
    });

    await client.getServiceRoot();

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(init.headers.Authorization).toBe(`Basic ${Buffer.from('admin:hunter2').toString('base64')}`);
  });

  it('establishes a session and attaches X-Auth-Token to subsequent requests', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(
          { '@odata.id': '/redfish/v1/SessionService/Sessions/1' },
          { status: 201, headers: { 'X-Auth-Token': 'tok-123', Location: '/redfish/v1/SessionService/Sessions/1' } },
        ),
      )
      .mockResolvedValueOnce(jsonResponse({ '@odata.id': '/redfish/v1/' }));

    const client = new RedfishClient({
      baseUrl: 'https://bmc.example.com',
      auth: { type: 'session', username: 'admin', password: 'hunter2' },
      fetch: fetchMock as unknown as typeof fetch,
    });

    await client.connect();
    await client.getServiceRoot();

    const [, sessionInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(sessionInit.body as string)).toEqual({ UserName: 'admin', Password: 'hunter2' });

    const [, rootInit] = fetchMock.mock.calls[1] as [string, RequestInit & { headers: Record<string, string> }];
    expect(rootInit.headers['X-Auth-Token']).toBe('tok-123');

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await client.disconnect();
    expect(fetchMock).toHaveBeenLastCalledWith(
      'https://bmc.example.com/redfish/v1/SessionService/Sessions/1',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('expands a collection into full member resources', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          '@odata.id': '/redfish/v1/Systems',
          'Members@odata.count': 2,
          Members: [{ '@odata.id': '/redfish/v1/Systems/1' }, { '@odata.id': '/redfish/v1/Systems/2' }],
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ '@odata.id': '/redfish/v1/Systems/1', Id: '1', PowerState: 'On' }))
      .mockResolvedValueOnce(jsonResponse({ '@odata.id': '/redfish/v1/Systems/2', Id: '2', PowerState: 'Off' }));

    const client = new RedfishClient({ baseUrl: 'https://bmc.example.com', fetch: fetchMock as unknown as typeof fetch });
    const systems = await client.getSystems();

    expect(systems).toHaveLength(2);
    expect(systems.map((s) => s.PowerState)).toEqual(['On', 'Off']);
  });

  it('discovers the reset action target from the resource before invoking it', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          '@odata.id': '/redfish/v1/Systems/1',
          Id: '1',
          Actions: { '#ComputerSystem.Reset': { target: '/redfish/v1/Systems/1/Actions/ComputerSystem.Reset' } },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    const client = new RedfishClient({ baseUrl: 'https://bmc.example.com', fetch: fetchMock as unknown as typeof fetch });
    await client.resetSystem('1', 'GracefulRestart');

    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe('https://bmc.example.com/redfish/v1/Systems/1/Actions/ComputerSystem.Reset');
    expect(JSON.parse(init.body as string)).toEqual({ ResetType: 'GracefulRestart' });
  });

  it('throws RedfishActionNotSupportedError when the action is missing', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ '@odata.id': '/redfish/v1/Systems/1', Id: '1' }));
    const client = new RedfishClient({ baseUrl: 'https://bmc.example.com', fetch: fetchMock as unknown as typeof fetch });

    await expect(client.resetSystem('1', 'On')).rejects.toBeInstanceOf(RedfishActionNotSupportedError);
  });

  it('throws RedfishError with parsed body on non-2xx responses', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        { error: { code: 'Base.1.0.GeneralError', message: 'Unable to complete the operation.' } },
        { status: 400, statusText: 'Bad Request' },
      ),
    );
    const client = new RedfishClient({ baseUrl: 'https://bmc.example.com', fetch: fetchMock as unknown as typeof fetch });

    const error = await client.getServiceRoot().catch((e) => e);
    expect(error).toBeInstanceOf(RedfishError);
    expect((error as RedfishError).status).toBe(400);
    expect((error as RedfishError).message).toBe('Unable to complete the operation.');
  });

  it('sends If-Match when patching with an etag', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ '@odata.id': '/redfish/v1/Systems/1', Id: '1' }));
    const client = new RedfishClient({ baseUrl: 'https://bmc.example.com', fetch: fetchMock as unknown as typeof fetch });

    await client.patch('/redfish/v1/Systems/1', { AssetTag: 'new-tag' }, 'W/"abc123"');

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(init.headers['If-Match']).toBe('W/"abc123"');
    expect(init.method).toBe('PATCH');
  });

  it('wraps an aborted request in RedfishTimeoutError', async () => {
    fetchMock.mockImplementation((_url: string, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      });
    });
    const client = new RedfishClient({
      baseUrl: 'https://bmc.example.com',
      timeoutMs: 5,
      fetch: fetchMock as unknown as typeof fetch,
    });

    await expect(client.getServiceRoot()).rejects.toBeInstanceOf(RedfishTimeoutError);
  });
});
