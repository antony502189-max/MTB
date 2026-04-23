import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) => {
    if (queryKey[0] === "ledger") {
      return { data: [], isLoading: false };
    }
    if (queryKey[0] === "games-summary") {
      return { data: { games: [] }, isLoading: false };
    }
    return { data: undefined, isLoading: false };
  },
}));

vi.mock("@/lib/api", () => ({
  api: {
    claimVaultCrate: vi.fn(),
    getRewardLedger: vi.fn(),
    getGameSummary: vi.fn(),
  },
}));

vi.mock("@/lib/game-store", () => ({
  useGameStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      stardust: 0,
      bonusStreak: 1,
      vaultCharge: 0,
      vaultCrates: 2,
      openBonusCrate: vi.fn(),
      planetMastery: {},
    }),
}));

vi.mock("@/lib/session-store", () => ({
  useSessionStore: () => ({
    userId: "u_demo",
  }),
}));

import { RewardsPage } from "@/pages/RewardsPage";

function renderRewardsPage() {
  return renderToStaticMarkup(createElement(RewardsPage));
}

describe("RewardsPage", () => {
  it("does not render the ready containers metric card", () => {
    const html = renderRewardsPage();

    expect(html).not.toContain("Готовые контейнеры");
  });

  it("does not render the backend mini-games eyebrow", () => {
    const html = renderRewardsPage();

    expect(html).not.toContain("Бэкенд мини-игр");
  });

  it("does not render the sync journal for regular users", () => {
    const html = renderRewardsPage();

    expect(html).not.toContain("Журнал синхронизации");
    expect(html).not.toContain("Синхронизированная активность");
  });

  it("does not render local bonus history", () => {
    const html = renderRewardsPage();

    expect(html).not.toContain("История локальных бонусов");
    expect(html).not.toContain("Каждый запуск прозрачен");
  });
});
