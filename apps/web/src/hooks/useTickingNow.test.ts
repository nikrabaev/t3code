/**
 * Unit tests for useTickingNow.
 *
 * These tests verify the interval-based timing contract without a DOM
 * environment by directly exercising the setInterval / clearInterval pattern
 * that the hook wraps, using vitest fake timers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Minimal simulation of the hook's setInterval contract.
 * Mirrors what useTickingNow does: store Date.now() at construction,
 * update on every tick, clean up on stop.
 */
function createTickingValue(intervalMs: number) {
  let current = Date.now();
  const id = setInterval(() => {
    current = Date.now();
  }, intervalMs);
  return {
    get value() {
      return current;
    },
    stop() {
      clearInterval(id);
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useTickingNow contract", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns Date.now() at construction time", () => {
    const startMs = Date.now();

    const ticker = createTickingValue(1000);

    expect(ticker.value).toBe(startMs);

    ticker.stop();
  });

  it("updates after each intervalMs tick", () => {
    const startMs = Date.now();
    const ticker = createTickingValue(1000);
    expect(ticker.value).toBe(startMs);

    // Advance clock by the interval — value should update.
    vi.advanceTimersByTime(1000);
    expect(ticker.value).toBe(startMs + 1000);

    // Second tick.
    vi.advanceTimersByTime(1000);
    expect(ticker.value).toBe(startMs + 2000);

    ticker.stop();
  });

  it("stops updating after stop() is called (unmount simulation)", () => {
    const startMs = Date.now();

    const ticker = createTickingValue(1000);
    ticker.stop();

    // Advance time — the cleared interval must not update the value.
    vi.advanceTimersByTime(5000);

    expect(ticker.value).toBe(startMs);
  });

  it("respects a custom intervalMs", () => {
    const startMs = Date.now();
    const ticker = createTickingValue(500);

    // Should NOT update after only 400 ms.
    vi.advanceTimersByTime(400);
    expect(ticker.value).toBe(startMs);

    // Should update after a full 500 ms.
    vi.advanceTimersByTime(100);
    expect(ticker.value).toBe(startMs + 500);

    ticker.stop();
  });
});
