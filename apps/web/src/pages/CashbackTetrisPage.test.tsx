import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/pages/game-page-shared", () => ({
  GameHero: () => createElement("div", { "data-testid": "game-hero" }),
  gameReward: () => 7,
}));

import { CashbackTetrisPage } from "@/pages/CashbackTetrisPage";

function renderCashbackTetrisPage() {
  return renderToStaticMarkup(createElement(CashbackTetrisPage));
}

describe("CashbackTetrisPage", () => {
  it("marks the on-screen controls panel as hidden on mobile", () => {
    const html = renderCashbackTetrisPage();

    expect(html).toContain("snake-controls-panel snake-controls-panel--desktop");
  });
});
