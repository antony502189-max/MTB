import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) => {
    if (queryKey[0] === "profile") {
      return {
        data: {
          active_boosters: [
            {
              booster_id: "booster-1",
              boost_rate: 12,
              category: "electronics",
              end_at: "2026-04-23T12:00:00.000Z",
              start_at: "2026-04-23T10:00:00.000Z",
              status: "active",
            },
          ],
        },
        isError: false,
        isLoading: false,
        refetch: vi.fn(),
      };
    }

    if (queryKey[0] === "ledger") {
      return {
        data: [
          {
            amount: 30,
            created_at: "2026-04-23T11:00:00.000Z",
            ledger_id: "ledger-1",
            meta: {},
            reward_type: "cashback_booster",
            status: "processed",
          },
        ],
        isError: false,
        isLoading: false,
        refetch: vi.fn(),
      };
    }

    return { data: undefined, isError: false, isLoading: false, refetch: vi.fn() };
  },
}));

vi.mock("@/lib/session-store", () => ({
  useSessionStore: () => ({
    displayName: "Пилот Моби",
    userId: "u_demo",
  }),
}));

import { LiveLinksPage } from "@/pages/LiveLinksPage";

function renderLiveLinksPage() {
  return renderToStaticMarkup(createElement(LiveLinksPage));
}

describe("LiveLinksPage", () => {
  it("renders active boosters and reward ledger entries", () => {
    const html = renderLiveLinksPage();

    expect(html).toContain("Живые связи");
    expect(html).toContain("Активные окна бустеров");
    expect(html).toContain("электроника");
    expect(html).toContain("+12%");
    expect(html).toContain("Журнал активности");
    expect(html).toContain("орбитальный бустер");
    expect(html).toContain("30");
  });
});
