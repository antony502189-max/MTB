import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-query", () => ({
  useMutation: () => ({
    isPending: false,
    mutate: vi.fn(),
  }),
  useQueryClient: () => ({
    invalidateQueries: vi.fn(),
  }),
}));

vi.mock("@/lib/api", () => ({
  api: {
    ingest: vi.fn(),
    buildEvent: vi.fn(),
    submitGameRun: vi.fn(),
  },
}));

vi.mock("@/lib/bonus-engine", () => ({
  calculateBonusOutcome: () => ({
    totalReward: 4,
    streakBonus: 0,
    masteryBonus: 0,
    performanceBonus: 0,
    focusBonus: 0,
    chargeGain: 0,
    cratesEarned: 0,
  }),
}));

vi.mock("@/lib/game-store", () => ({
  useGameStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      recordSnakeRun: vi.fn(),
      bestSnakeScore: 0,
      stardust: 0,
      bonusStreak: 1,
      vaultCharge: 0,
      vaultCrates: 0,
      selectedPlanet: "ORBIT_COMMERCE",
      structures: {},
      planetMastery: {},
    }),
}));

vi.mock("@/lib/session-store", () => ({
  useSessionStore: () => ({
    userId: "u_demo",
  }),
}));

import { SnakePage, directionFromSwipeDelta, supportsTouchInput } from "@/pages/SnakePage";

function renderSnakePage() {
  return renderToStaticMarkup(createElement(SnakePage));
}

describe("SnakePage", () => {
  it("maps horizontal and vertical swipes to directions", () => {
    expect(directionFromSwipeDelta(48, 6)).toBe("right");
    expect(directionFromSwipeDelta(-48, 10)).toBe("left");
    expect(directionFromSwipeDelta(8, -48)).toBe("up");
    expect(directionFromSwipeDelta(12, 48)).toBe("down");
  });

  it("ignores short swipes below the minimum distance", () => {
    expect(directionFromSwipeDelta(18, 4)).toBeUndefined();
    expect(directionFromSwipeDelta(0, -20)).toBeUndefined();
  });

  it("treats coarse pointers or touch points as touch input", () => {
    expect(supportsTouchInput({ coarsePointer: true, maxTouchPoints: 0 })).toBe(true);
    expect(supportsTouchInput({ coarsePointer: false, maxTouchPoints: 2 })).toBe(true);
    expect(supportsTouchInput({ coarsePointer: false, maxTouchPoints: 0 })).toBe(false);
  });

  it("marks the on-screen controls panel as hidden on mobile", () => {
    const html = renderSnakePage();

    expect(html).toContain("snake-controls-panel snake-controls-panel--desktop");
  });

  it("renders the start action inside the game board panel", () => {
    const html = renderSnakePage();

    expect(html).toContain('data-testid="snake-board-panel"');
    expect(html).toContain('data-testid="snake-launch-button"');
    expect(html).toMatch(/data-testid="snake-board-panel"[\s\S]*data-testid="snake-launch-button"[\s\S]*snake-grid/);
  });
});
