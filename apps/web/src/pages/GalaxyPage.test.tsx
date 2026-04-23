import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-query", () => ({
  useMutation: () => ({
    isPending: false,
    mutate: vi.fn(),
  }),
  useQuery: ({ queryKey }: { queryKey: string[] }) => {
    if (queryKey[0] === "profile") {
      return {
        data: {
          active_boosters: [],
          orbit_level: 1,
          planets: [
            { planet_code: "ORBIT_COMMERCE", xp: 0, level: 1 },
            { planet_code: "CREDIT_SHIELD", xp: 0, level: 1 },
            { planet_code: "SOCIAL_RING", xp: 0, level: 1 },
          ],
          quests: [],
        },
      };
    }

    if (queryKey[0] === "ledger") {
      return { data: [] };
    }

    return { data: undefined };
  },
  useQueryClient: () => ({
    invalidateQueries: vi.fn(),
  }),
}));

vi.mock("@/components/GalaxyStage", () => ({
  GalaxyStage: () => null,
}));

vi.mock("@/components/OnboardingOverlay", () => ({
  OnboardingOverlay: () => null,
}));

vi.mock("@/components/PlanetInspector", () => ({
  PlanetInspector: () => null,
}));

vi.mock("@/lib/game-store", () => ({
  useGameStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      actionLog: [
        {
          id: "action-1",
          title: "Тестовое действие",
          detail: "Скрытая техническая запись",
          planetCode: "ORBIT_COMMERCE",
          reward: 10,
        },
      ],
      bestShieldScore: 0,
      bestSnakeScore: 0,
      bestSocialScore: 0,
      bonusStreak: 1,
      buildStructure: vi.fn(),
      claimPlanetAction: vi.fn(),
      completeOnboarding: vi.fn(),
      onboardingComplete: true,
      planetMastery: {
        ORBIT_COMMERCE: 0,
        CREDIT_SHIELD: 0,
        SOCIAL_RING: 0,
      },
      playerAlias: "Пилот Моби",
      playerSegment: "student",
      selectPlanet: vi.fn(),
      selectedPlanet: "ORBIT_COMMERCE",
      stardust: 0,
      structures: {
        ORBIT_COMMERCE: [],
        CREDIT_SHIELD: [],
        SOCIAL_RING: [],
      },
      totalRuns: 0,
      unlockedPlanets: {
        ORBIT_COMMERCE: true,
        CREDIT_SHIELD: false,
        SOCIAL_RING: false,
      },
      vaultCharge: 0,
      vaultCrates: 0,
    }),
}));

vi.mock("@/lib/session-store", () => ({
  useSessionStore: () => ({
    syncProfile: vi.fn(),
    userId: "u_demo",
  }),
}));

import { GalaxyPage } from "@/pages/GalaxyPage";

function renderGalaxyPage() {
  return renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: ["/app/galaxy"] }, createElement(GalaxyPage)));
}

describe("GalaxyPage", () => {
  it("does not render pilot action history for regular users", () => {
    const html = renderGalaxyPage();

    expect(html).not.toContain("Последние действия пилота");
    expect(html).not.toContain("Лента миссий");
    expect(html).not.toContain("Тестовое действие");
  });
});
