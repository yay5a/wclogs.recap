import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WclGraphqlClient } from '../graphql-client.js';

const loggerWarn = vi.hoisted(() => vi.fn());

vi.mock('@wcl/shared', () => ({
  createLogger: () => ({
    warn: loggerWarn,
  }),
}));

import { collectTableMetrics, isRetryableWclError } from './table-collector.js';

const emptyTablePayload = {
  data: {
    reportData: {
      report: {
        table: {
          entries: [],
        },
      },
    },
  },
};

const makeStatusError = (status: number): Error =>
  Object.assign(new Error(`GraphQL Error (Code: ${status})`), {
    response: { status },
  });

const makeClient = (request: ReturnType<typeof vi.fn>): WclGraphqlClient =>
  ({ request }) as never;

afterEach(() => {
  vi.useRealTimers();
  loggerWarn.mockReset();
});

describe('table collector retry handling', () => {
  it.each([429, 502, 503, 504])('treats WCL status %s as retryable', (status) => {
    expect(isRetryableWclError(makeStatusError(status))).toBe(true);
  });

  it.each([400, 401, 403, 404, 500])('does not treat WCL status %s as retryable', (status) => {
    expect(isRetryableWclError(makeStatusError(status))).toBe(false);
  });

  it('retries a retryable table request and returns parsed metrics', async () => {
    vi.useFakeTimers();
    const request = vi
      .fn()
      .mockRejectedValueOnce(makeStatusError(502))
      .mockResolvedValue(emptyTablePayload);

    const promise = collectTableMetrics(makeClient(request), {
      reportCode: 'ABC123',
      completedFightIds: [1],
    });

    await vi.advanceTimersByTimeAsync(2_000);

    await expect(promise).resolves.toMatchObject({
      topDamageDone: [],
      topHealingDone: [],
      topDeaths: [],
      topInterrupts: [],
      topDispels: [],
      totals: {},
      deathsByFightId: { 1: 0 },
    });
    expect(request).toHaveBeenCalledTimes(7);
    expect(loggerWarn).toHaveBeenCalledWith(
      {
        reportCode: 'ABC123',
        dataType: 'DamageDone',
        attempt: 1,
        status: 502,
        delayMs: 2_000,
      },
      'wcl table request retrying',
    );
  });

  it('does not retry non-retryable table request errors', async () => {
    const error = makeStatusError(400);
    const request = vi.fn().mockRejectedValueOnce(error).mockResolvedValue(emptyTablePayload);

    await expect(
      collectTableMetrics(makeClient(request), {
        reportCode: 'ABC123',
        completedFightIds: [1],
      }),
    ).rejects.toBe(error);

    expect(request).toHaveBeenCalledTimes(5);
    expect(loggerWarn).not.toHaveBeenCalled();
  });
});
