import { Agent } from 'undici';
import { RedfishActionNotSupportedError, RedfishError, RedfishTimeoutError } from './errors.js';
import type {
  Chassis,
  ComputerSystem,
  Manager,
  Power,
  RedfishAction,
  RedfishCollection,
  RedfishErrorPayload,
  ResetType,
  ServiceRoot,
  Session,
  Thermal,
} from './types.js';

export interface RedfishAuthBasic {
  type: 'basic';
  username: string;
  password: string;
}

export interface RedfishAuthSession {
  type: 'session';
  username: string;
  password: string;
}

export interface RedfishAuthToken {
  type: 'token';
  token: string;
}

export interface RedfishAuthNone {
  type: 'none';
}

export type RedfishAuth = RedfishAuthBasic | RedfishAuthSession | RedfishAuthToken | RedfishAuthNone;

export interface RedfishClientOptions {
  /** Base URL of the BMC, e.g. `https://10.0.0.5` */
  baseUrl: string;
  /** Authentication strategy. Defaults to `{ type: 'none' }`. */
  auth?: RedfishAuth;
  /**
   * Skip TLS certificate verification. Most BMCs ship a self-signed
   * certificate, so this is commonly needed. Defaults to `false`.
   */
  insecure?: boolean;
  /** Root service path. Defaults to `/redfish/v1`. */
  servicePath?: string;
  /** Per-request timeout in milliseconds. Defaults to 15000. */
  timeoutMs?: number;
  /** Override the fetch implementation (mainly for testing). */
  fetch?: typeof fetch;
}

export interface RedfishResponse<T> {
  data: T;
  status: number;
  etag?: string;
}

export interface RequestOptions {
  method?: string;
  body?: unknown;
  etag?: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

const DEFAULT_SERVICE_PATH = '/redfish/v1';
const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Client for querying and managing Redfish-compliant BMCs.
 *
 * @example
 * ```ts
 * const client = new RedfishClient({
 *   baseUrl: 'https://10.0.0.5',
 *   auth: { type: 'session', username: 'admin', password: 'secret' },
 *   insecure: true,
 * });
 * await client.connect();
 * const systems = await client.getSystems();
 * await client.resetSystem(systems[0].Id!, 'GracefulRestart');
 * await client.disconnect();
 * ```
 */
export class RedfishClient {
  private readonly baseUrl: string;
  private readonly servicePath: string;
  private readonly auth: RedfishAuth;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly dispatcher: Agent | undefined;

  private token: string | undefined;
  private sessionLocation: string | undefined;

  constructor(options: RedfishClientOptions) {
    if (!options.baseUrl) {
      throw new TypeError('RedfishClient requires a `baseUrl`');
    }
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.servicePath = normalizeServicePath(options.servicePath ?? DEFAULT_SERVICE_PATH);
    this.auth = options.auth ?? { type: 'none' };
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = options.fetch ?? fetch;
    this.dispatcher = options.insecure ? new Agent({ connect: { rejectUnauthorized: false } }) : undefined;

    if (this.auth.type === 'token') {
      this.token = this.auth.token;
    }
  }

  /** Whether the client currently holds a session token (from `connect()` or `type: 'token'` auth). */
  get isAuthenticated(): boolean {
    return Boolean(this.token) || this.auth.type === 'basic';
  }

  /**
   * Establishes a session for `{ type: 'session' }` auth by creating a
   * Redfish session and capturing the `X-Auth-Token`. No-op for other auth
   * types.
   */
  async connect(): Promise<void> {
    if (this.auth.type !== 'session') {
      return;
    }
    const url = this.resolve(`${this.servicePath}/SessionService/Sessions`);
    const response = await this.rawFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ UserName: this.auth.username, Password: this.auth.password }),
    });
    if (!response.ok) {
      await throwRedfishError(response);
    }
    const token = response.headers.get('x-auth-token');
    if (!token) {
      throw new RedfishError('Session creation succeeded but no X-Auth-Token header was returned', {
        url,
        status: response.status,
        statusText: response.statusText,
      });
    }
    this.token = token;
    this.sessionLocation = response.headers.get('location') ?? undefined;
    // Drain the body so the connection can be reused.
    await response.text().catch(() => undefined);
  }

  /** Deletes the active session, if one was established via `connect()`. */
  async disconnect(): Promise<void> {
    if (!this.sessionLocation) {
      this.token = this.auth.type === 'token' ? this.auth.token : undefined;
      return;
    }
    const url = this.resolve(this.sessionLocation);
    await this.rawFetch(url, { method: 'DELETE', headers: this.authHeaders() }).catch(() => undefined);
    this.sessionLocation = undefined;
    this.token = this.auth.type === 'token' ? this.auth.token : undefined;
  }

  /** Fetches the service root document (`/redfish/v1/`). */
  getServiceRoot(): Promise<ServiceRoot> {
    return this.get<ServiceRoot>(this.servicePath);
  }

  // ---------------------------------------------------------------------
  // Systems
  // ---------------------------------------------------------------------

  getSystems(): Promise<ComputerSystem[]> {
    return this.getExpandedCollection<ComputerSystem>('Systems');
  }

  getSystemIds(): Promise<string[]> {
    return this.getCollectionIds('Systems');
  }

  getSystem(id: string): Promise<ComputerSystem> {
    return this.get<ComputerSystem>(`${this.servicePath}/Systems/${id}`);
  }

  /**
   * Invokes `#ComputerSystem.Reset` on the given system. The action target
   * is read from the system's `Actions` block so vendor-specific paths are
   * respected; falls back to the standard path if absent.
   */
  async resetSystem(id: string, resetType: ResetType): Promise<void> {
    const system = await this.getSystem(id);
    const action = system.Actions?.['#ComputerSystem.Reset'];
    await this.invokeAction(action, '#ComputerSystem.Reset', { ResetType: resetType }, id);
  }

  // ---------------------------------------------------------------------
  // Chassis
  // ---------------------------------------------------------------------

  getChassisCollection(): Promise<Chassis[]> {
    return this.getExpandedCollection<Chassis>('Chassis');
  }

  getChassisIds(): Promise<string[]> {
    return this.getCollectionIds('Chassis');
  }

  getChassis(id: string): Promise<Chassis> {
    return this.get<Chassis>(`${this.servicePath}/Chassis/${id}`);
  }

  async getPower(chassisId: string): Promise<Power> {
    const chassis = await this.getChassis(chassisId);
    const path = chassis.Power?.['@odata.id'] ?? `${this.servicePath}/Chassis/${chassisId}/Power`;
    return this.get<Power>(path);
  }

  async getThermal(chassisId: string): Promise<Thermal> {
    const chassis = await this.getChassis(chassisId);
    const path = chassis.Thermal?.['@odata.id'] ?? `${this.servicePath}/Chassis/${chassisId}/Thermal`;
    return this.get<Thermal>(path);
  }

  // ---------------------------------------------------------------------
  // Managers
  // ---------------------------------------------------------------------

  getManagers(): Promise<Manager[]> {
    return this.getExpandedCollection<Manager>('Managers');
  }

  getManagerIds(): Promise<string[]> {
    return this.getCollectionIds('Managers');
  }

  getManager(id: string): Promise<Manager> {
    return this.get<Manager>(`${this.servicePath}/Managers/${id}`);
  }

  async resetManager(id: string, resetType: ResetType): Promise<void> {
    const manager = await this.getManager(id);
    const action = manager.Actions?.['#Manager.Reset'];
    await this.invokeAction(action, '#Manager.Reset', { ResetType: resetType }, id);
  }

  // ---------------------------------------------------------------------
  // Sessions
  // ---------------------------------------------------------------------

  getSessions(): Promise<Session[]> {
    return this.getExpandedCollection<Session>('SessionService/Sessions');
  }

  // ---------------------------------------------------------------------
  // Generic request helpers
  // ---------------------------------------------------------------------

  async get<T>(path: string): Promise<T> {
    const { data } = await this.request<T>(path, { method: 'GET' });
    return data;
  }

  /** PATCH a resource. Pass `etag` to send `If-Match` (recommended by the Redfish spec for PATCH). */
  async patch<T>(path: string, body: unknown, etag?: string): Promise<T> {
    const { data } = await this.request<T>(path, { method: 'PATCH', body, etag });
    return data;
  }

  /** PUT a full resource replacement. Rarely used by Redfish services compared to PATCH. */
  async put<T>(path: string, body: unknown, etag?: string): Promise<T> {
    const { data } = await this.request<T>(path, { method: 'PUT', body, etag });
    return data;
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    const { data } = await this.request<T>(path, { method: 'POST', body });
    return data;
  }

  async delete<T = void>(path: string): Promise<T> {
    const { data } = await this.request<T>(path, { method: 'DELETE' });
    return data;
  }

  /** Fetches a Redfish collection resource (the `Members` array of `@odata.id` links), unexpanded. */
  getCollection(path: string): Promise<RedfishCollection> {
    return this.get<RedfishCollection>(this.withinService(path));
  }

  /** Fetches a collection and resolves every member to its full resource body. */
  async getExpandedCollection<T>(path: string): Promise<T[]> {
    const collection = await this.getCollection(this.withinService(path));
    return Promise.all(collection.Members.map((member) => this.get<T>(member['@odata.id'])));
  }

  private async getCollectionIds(path: string): Promise<string[]> {
    const collection = await this.getCollection(this.withinService(path));
    return collection.Members.map((member) => idFromODataId(member['@odata.id']));
  }

  private async invokeAction(
    action: RedfishAction | undefined,
    actionName: string,
    body: unknown,
    resourceId: string,
  ): Promise<void> {
    if (!action?.target) {
      throw new RedfishActionNotSupportedError(actionName, resourceId);
    }
    await this.request(action.target, { method: 'POST', body });
  }

  private withinService(path: string): string {
    if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('/')) {
      return path;
    }
    return `${this.servicePath}/${path}`;
  }

  private resolve(path: string): string {
    if (path.startsWith('http://') || path.startsWith('https://')) {
      return path;
    }
    return `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
  }

  private authHeaders(): Record<string, string> {
    if (this.token) {
      return { 'X-Auth-Token': this.token };
    }
    if (this.auth.type === 'basic') {
      const encoded = base64Encode(`${this.auth.username}:${this.auth.password}`);
      return { Authorization: `Basic ${encoded}` };
    }
    return {};
  }

  private async request<T>(path: string, options: RequestOptions): Promise<RedfishResponse<T>> {
    const url = this.resolve(this.withinService(path));
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...this.authHeaders(),
      ...options.headers,
    };
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    if (options.etag) {
      headers['If-Match'] = options.etag;
    }

    const response = await this.rawFetch(url, {
      method: options.method ?? 'GET',
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: options.signal,
    });

    if (!response.ok) {
      await throwRedfishError(response);
    }

    const etag = response.headers.get('etag') ?? undefined;
    if (response.status === 204) {
      return { data: undefined as T, status: response.status, etag };
    }
    const text = await response.text();
    const data = text.length > 0 ? (JSON.parse(text) as T) : (undefined as T);
    return { data, status: response.status, etag };
  }

  private async rawFetch(url: string, init: { method: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }): Promise<Response> {
    const controller = new AbortController();
    const signals = init.signal ? [init.signal, controller.signal] : [controller.signal];
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(url, {
        method: init.method,
        headers: init.headers,
        body: init.body,
        signal: combineSignals(signals),
        // `dispatcher` is an undici-specific extension used to control TLS
        // verification; not part of the standard fetch types.
        ...(this.dispatcher ? { dispatcher: this.dispatcher } : {}),
      } as RequestInit);
    } catch (error) {
      if (controller.signal.aborted) {
        throw new RedfishTimeoutError(url, this.timeoutMs);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function normalizeServicePath(path: string): string {
  const trimmed = path.replace(/\/+$/, '');
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

function idFromODataId(odataId: string): string {
  const segments = odataId.replace(/\/+$/, '').split('/');
  return segments[segments.length - 1] ?? odataId;
}

function base64Encode(value: string): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(value, 'utf-8').toString('base64');
  }
  // Browser / edge runtime fallback.
  return btoa(value);
}

function combineSignals(signals: AbortSignal[]): AbortSignal {
  if (signals.length === 1) {
    return signals[0] as AbortSignal;
  }
  if (typeof AbortSignal.any === 'function') {
    return AbortSignal.any(signals);
  }
  const controller = new AbortController();
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort();
      break;
    }
    signal.addEventListener('abort', () => controller.abort(), { once: true });
  }
  return controller.signal;
}

async function throwRedfishError(response: Response): Promise<never> {
  const text = await response.text().catch(() => '');
  let body: RedfishErrorPayload | string = text;
  try {
    body = text ? (JSON.parse(text) as RedfishErrorPayload) : text;
  } catch {
    // leave body as raw text
  }
  const message =
    (typeof body === 'object' && body.error?.message) || `Redfish request failed: ${response.status} ${response.statusText}`;
  throw new RedfishError(message, {
    url: response.url,
    status: response.status,
    statusText: response.statusText,
    body,
  });
}
