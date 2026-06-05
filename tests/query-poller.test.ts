import { describe, it, expect } from 'vitest';
import { pollForVideoQuery, queriesEqual } from '../src/content/query-poller';
import type { SongQuery } from '../src/types';

const POLL_MS = 300;
const TIMEOUT_MS = 3000;

/**
 * Drives the poller in virtual time. `pollForVideoQuery` runs its first tick
 * synchronously and schedules the next via the injected `schedule`; `tickOnce`
 * advances the clock by one poll interval and runs that scheduled tick.
 */
function makeDriver() {
  let time = 0;
  let pending: (() => void) | null = null;
  return {
    now: (): number => time,
    schedule: (cb: () => void): void => {
      pending = cb;
    },
    tickOnce: (): void => {
      time += POLL_MS;
      const cb = pending;
      pending = null;
      cb?.();
    },
    hasPending: (): boolean => pending !== null,
  };
}

/** Returns a `read` that yields each value in order, repeating the last forever. */
function sequence(values: Array<SongQuery | null>): () => SongQuery | null {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)] ?? null;
}

async function run(
  deps: Partial<Parameters<typeof pollForVideoQuery>[0]> & {
    read: () => SongQuery | null;
  },
): Promise<SongQuery | null> {
  const driver = makeDriver();
  const promise = pollForVideoQuery({
    videoId: 'vid',
    previous: null,
    timeoutMs: TIMEOUT_MS,
    pollMs: POLL_MS,
    currentId: () => 'vid',
    now: driver.now,
    schedule: driver.schedule,
    ...deps,
  });
  // Drive until the poller stops scheduling (it has resolved).
  let guard = 0;
  while (driver.hasPending() && guard < 1000) {
    driver.tickOnce();
    guard += 1;
  }
  return promise;
}

const A: SongQuery = { title: 'Idol', artist: 'YOASOBI' };
const B: SongQuery = { title: 'Pretender', artist: 'Official髭男dism' };

describe('queriesEqual', () => {
  it('compares title and artist', () => {
    expect(queriesEqual(A, { ...A })).toBe(true);
    expect(queriesEqual(A, B)).toBe(false);
  });
});

describe('pollForVideoQuery', () => {
  it('resolves once a fresh read is stable across two polls', async () => {
    const result = await run({ previous: B, read: sequence([A, A]) });
    expect(result).toEqual(A);
  });

  it('does not resolve early on the outgoing video\'s lingering metadata', async () => {
    // First reads are the previous video (B); then the new one (A) stabilizes.
    const result = await run({ previous: B, read: sequence([B, B, A, A]) });
    expect(result).toEqual(A);
  });

  it('returns the last stable read on timeout even if it equals previous', async () => {
    // Same song re-uploaded: read always equals `previous`, never "fresh".
    const result = await run({ previous: A, read: () => A });
    expect(result).toEqual(A); // Not null — the lingering window has passed.
  });

  it('returns null when the DOM never produces a readable query', async () => {
    const result = await run({ previous: null, read: () => null });
    expect(result).toBeNull();
  });

  it('aborts with null when the video id changes mid-poll', async () => {
    let id = 'vid';
    const result = await run({
      previous: B,
      read: sequence([A]),
      currentId: () => id,
      schedule: (cb) => {
        id = 'other'; // Simulate a navigation before the next tick.
        setTimeout(cb, 0);
      },
    });
    expect(result).toBeNull();
  });
});
