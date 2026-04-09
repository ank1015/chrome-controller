import {
  PAGE_STABILITY_EVAL_MARKER,
  parsePageStabilityInfo,
  summarizeNetworkEventsForStability,
} from '../../../src/native-cli/wait-support.js';

import type { CliDebuggerEvent } from '../../../src/native-cli/types.js';

describe('native CLI wait support helpers', () => {
  it('summarizes inflight and completed network requests for stable waits', () => {
    const events: CliDebuggerEvent[] = [
      {
        method: 'Network.requestWillBeSent',
        params: {
          requestId: 'r1',
        },
      },
      {
        method: 'Network.requestWillBeSent',
        params: {
          requestId: 'r2',
        },
      },
      {
        method: 'Network.loadingFinished',
        params: {
          requestId: 'r1',
        },
      },
      {
        method: 'Network.loadingFailed',
        params: {
          requestId: 'r2',
        },
      },
      {
        method: 'Network.requestWillBeSent',
        params: {
          requestId: 'r3',
        },
      },
    ];

    expect(summarizeNetworkEventsForStability(events)).toEqual({
      eventCount: 5,
      inflightRequests: 1,
      finishedRequests: 1,
      failedRequests: 1,
    });
  });

  it('parses captured page stability state', () => {
    expect(
      parsePageStabilityInfo({
        [PAGE_STABILITY_EVAL_MARKER]: true,
        readyState: 'complete',
        url: 'https://example.com/chat',
        nowMs: 1000,
        lastMutationAtMs: 994,
        quietForMs: 6,
        mutationCount: 3,
      })
    ).toEqual({
      readyState: 'complete',
      url: 'https://example.com/chat',
      nowMs: 1000,
      lastMutationAtMs: 994,
      quietForMs: 6,
      mutationCount: 3,
    });
  });
});
