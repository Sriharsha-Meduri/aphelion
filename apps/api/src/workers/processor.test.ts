import { describe, it, expect } from 'vitest';
import { createProcessor } from './processor';
import { silentLogger } from '../test/helpers';

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('processor keyed serialization', () => {
  it('runs same-key tasks strictly in order, never overlapping', async () => {
    const p = createProcessor(silentLogger());
    const log: string[] = [];
    let active = 0;
    let maxActive = 0;

    const make = (id: string, delay: number) => async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      log.push(`start:${id}`);
      await tick(delay);
      log.push(`end:${id}`);
      active -= 1;
    };

    // Same key: must run A then B then C with no overlap, even though A is slowest.
    p.submit(make('A', 30), 'pay_1');
    p.submit(make('B', 5), 'pay_1');
    p.submit(make('C', 5), 'pay_1');
    await p.drain(1000);

    expect(maxActive).toBe(1);
    expect(log).toEqual(['start:A', 'end:A', 'start:B', 'end:B', 'start:C', 'end:C']);
  });

  it('runs different-key tasks concurrently', async () => {
    const p = createProcessor(silentLogger());
    let active = 0;
    let maxActive = 0;
    const make = () => async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await tick(20);
      active -= 1;
    };
    p.submit(make(), 'pay_1');
    p.submit(make(), 'pay_2');
    p.submit(make(), 'pay_3');
    await p.drain(1000);
    expect(maxActive).toBeGreaterThan(1);
  });

  it('a failing task does not break the rest of its key chain', async () => {
    const p = createProcessor(silentLogger());
    const ran: string[] = [];
    p.submit(async () => {
      ran.push('first');
      throw new Error('boom');
    }, 'pay_1');
    p.submit(async () => {
      ran.push('second');
    }, 'pay_1');
    await p.drain(1000);
    expect(ran).toEqual(['first', 'second']);
  });

  it('drain waits for all in-flight work', async () => {
    const p = createProcessor(silentLogger());
    let done = false;
    p.submit(async () => {
      await tick(30);
      done = true;
    }, 'pay_1');
    await p.drain(1000);
    expect(done).toBe(true);
    expect(p.inFlight()).toBe(0);
  });
});
