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
    totalReward: 12,
    streakBonus: 2,
    masteryBonus: 1,
    performanceBonus: 3,
    focusBonus: 0,
    chargeGain: 0,
    cratesEarned: 0,
  }),
}));

vi.mock("@/lib/game-status", () => ({
  formatGameRewardStatus: () => "Награда начислена",
}));

vi.mock("@/lib/game-store", () => ({
  useGameStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      recordSocialRun: vi.fn(() => ({
        totalReward: 12,
        cratesEarned: 0,
      })),
      bestSocialScore: 8,
      stardust: 24,
      bonusStreak: 2,
      vaultCharge: 0,
      vaultCrates: 1,
      selectedPlanet: "SOCIAL_RING",
      structures: {
        ORBIT_COMMERCE: [],
        CREDIT_SHIELD: [],
        SOCIAL_RING: [],
      },
      planetMastery: {
        ORBIT_COMMERCE: 0,
        CREDIT_SHIELD: 0,
        SOCIAL_RING: 0,
      },
    }),
}));

vi.mock("@/lib/session-store", () => ({
  useSessionStore: () => ({
    userId: "u_demo",
  }),
}));

import { SocialRingGamePage } from "@/pages/SocialRingGamePage";

function renderSocialRingGamePage() {
  return renderToStaticMarkup(createElement(SocialRingGamePage));
}

describe("SocialRingGamePage", () => {
  it("renders the start control inside the game stage panel", () => {
    const html = renderSocialRingGamePage();
    const stageIndex = html.indexOf("signal-stage");
    const startIndex = html.indexOf("Старт ринга");

    expect(stageIndex).toBeGreaterThan(-1);
    expect(startIndex).toBeGreaterThan(stageIndex);
  });

  it("does not render the containers metric card", () => {
    const html = renderSocialRingGamePage();

    expect(html).not.toContain("Контейнеры");
  });
});
