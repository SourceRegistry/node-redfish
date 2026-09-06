import type { RedfishErrorPayload } from './types.js';

/** Thrown for any non-2xx response from a Redfish service. */
export class RedfishError extends Error {
  readonly url: string;
  readonly status: number;
  readonly statusText: string;
  readonly body?: RedfishErrorPayload | string;

  constructor(message: string, options: { url: string; status: number; statusText: string; body?: RedfishErrorPayload | string }) {
    super(message);
    this.name = 'RedfishError';
    this.url = options.url;
    this.status = options.status;
    this.statusText = options.statusText;
    this.body = options.body;
  }

  /** Extracted `@Message.ExtendedInfo` entries, if the service returned an extended-info error body. */
  get extendedInfo(): Array<{ MessageId?: string; Message?: string; Severity?: string }> {
    if (this.body && typeof this.body === 'object') {
      return this.body.error?.['@Message.ExtendedInfo'] ?? [];
    }
    return [];
  }
}

/** Thrown when a request exceeds the configured timeout. */
export class RedfishTimeoutError extends Error {
  readonly url: string;
  readonly timeoutMs: number;

  constructor(url: string, timeoutMs: number) {
    super(`Request to ${url} timed out after ${timeoutMs}ms`);
    this.name = 'RedfishTimeoutError';
    this.url = url;
    this.timeoutMs = timeoutMs;
  }
}

/** Thrown when a resource does not expose an action the client was asked to invoke. */
export class RedfishActionNotSupportedError extends Error {
  readonly action: string;
  readonly resourceId: string;

  constructor(action: string, resourceId: string) {
    super(`Resource "${resourceId}" does not support action "${action}"`);
    this.name = 'RedfishActionNotSupportedError';
    this.action = action;
    this.resourceId = resourceId;
  }
}
