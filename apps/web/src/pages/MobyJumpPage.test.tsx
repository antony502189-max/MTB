import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/pages/game-page-shared", () => ({
  GameHero: () => createElement("div", { "data-testid": "moby-jump-hero" }),
  gameReward: () => 6,
}));

import { MobyJumpPage, jumpDirectionFromPointerRatio, jumpDirectionFromKey, supportsTouchInput } from "@/pages/MobyJumpPage";

function renderMobyJumpPage() {
  return renderToStaticMarkup(createElement(MobyJumpPage));
}

describe("MobyJumpPage", () => {
  it("maps touch positions across the stage to horizontal directions", () => {
    expect(jumpDirectionFromPointerRatio(0.1)).toBe(-1);
    expect(jumpDirectionFromPointerRatio(0.5)).toBe(0);
    expect(jumpDirectionFromPointerRatio(0.9)).toBe(1);
  });

  it("maps keyboard movement keys to horizontal directions", () => {
    expect(jumpDirectionFromKey("ArrowLeft")).toBe(-1);
    expect(jumpDirectionFromKey("a")).toBe(-1);
    expect(jumpDirectionFromKey("ArrowRight")).toBe(1);
    expect(jumpDirectionFromKey("D")).toBe(1);
    expect(jumpDirectionFromKey("Space")).toBeUndefined();
  });

  it("treats coarse pointers or touch points as mobile touch input", () => {
    expect(supportsTouchInput({ coarsePointer: true, maxTouchPoints: 0 })).toBe(true);
    expect(supportsTouchInput({ coarsePointer: false, maxTouchPoints: 2 })).toBe(true);
    expect(supportsTouchInput({ coarsePointer: false, maxTouchPoints: 0 })).toBe(false);
  });

  it("renders desktop controls separately and explains touch gestures", () => {
    const html = renderMobyJumpPage();

    expect(html).toContain("jump-controls-panel jump-controls-panel--desktop");
    expect(html).toContain('data-testid="moby-jump-stage"');
    expect(html).toContain("На телефоне ведите пальцем по сцене влево или вправо");
  });
});
