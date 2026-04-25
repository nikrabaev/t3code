import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { useTickingNow } from "./useTickingNow";

function Probe({ intervalMs }: { intervalMs: number }) {
  const now = useTickingNow(intervalMs);
  return <span data-testid="now">{now}</span>;
}

describe("useTickingNow", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.useRealTimers();
  });

  it("returns Date.now() initially", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1700000000000));

    const screen = await render(<Probe intervalMs={1000} />);
    try {
      await expect.element(page.getByTestId("now")).toHaveTextContent("1700000000000");
    } finally {
      await screen.unmount();
    }
  });

  it("updates after the interval elapses", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1700000000000));

    const screen = await render(<Probe intervalMs={1000} />);
    try {
      await expect.element(page.getByTestId("now")).toHaveTextContent("1700000000000");

      // Advance fake time by the interval; fires setInterval callbacks
      // and moves Date.now() forward.
      await vi.advanceTimersByTimeAsync(1000);

      // The hook must have updated to a value strictly greater than the initial.
      await vi.waitFor(() => {
        const text = page.getByTestId("now").element().textContent ?? "";
        expect(Number(text)).toBeGreaterThan(1700000000000);
      });
    } finally {
      await screen.unmount();
    }
  });

  it("updates on each subsequent tick", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1700000000000));

    const screen = await render(<Probe intervalMs={500} />);
    try {
      await expect.element(page.getByTestId("now")).toHaveTextContent("1700000000000");

      await vi.advanceTimersByTimeAsync(500);
      const afterFirst = await vi.waitFor(() => {
        const text = page.getByTestId("now").element().textContent ?? "";
        const value = Number(text);
        expect(value).toBeGreaterThan(1700000000000);
        return value;
      });

      await vi.advanceTimersByTimeAsync(500);
      await vi.waitFor(() => {
        const text = page.getByTestId("now").element().textContent ?? "";
        expect(Number(text)).toBeGreaterThan(afterFirst);
      });
    } finally {
      await screen.unmount();
    }
  });

  it("stops ticking after unmount (no leaked timers)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1700000000000));

    const screen = await render(<Probe intervalMs={1000} />);
    await expect.element(page.getByTestId("now")).toHaveTextContent("1700000000000");

    const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");
    await screen.unmount();

    // clearInterval must have been called during cleanup
    expect(clearIntervalSpy).toHaveBeenCalled();
    clearIntervalSpy.mockRestore();

    // Advancing timers after unmount must not throw or produce more renders
    await vi.advanceTimersByTimeAsync(5000);
  });
});
