import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes, type RouteObject } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { ShellLayout, appLinks, appRoutes, isShellLinkActive, mobileBottomNavItems, mobileOverflowLinks } from "@/app/router";

function collectPaths(routes: RouteObject[]): string[] {
  return routes.flatMap((route) => [
    ...(route.path ? [route.path] : []),
    ...collectPaths(route.children ?? []),
  ]);
}

function renderShell(pathname: string) {
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      { initialEntries: [pathname] },
      createElement(
        Routes,
        null,
        createElement(
          Route,
          { path: "/", element: createElement(ShellLayout) },
          createElement(Route, { path: "*", element: createElement("div", null, "Маршрут") }),
        ),
      ),
    ),
  );
}

describe("router", () => {
  it("registers the contacts route and keeps legacy social routes as redirects", () => {
    const paths = collectPaths(appRoutes);

    expect(paths).toContain("/app/contacts");
    expect(paths).toContain("/app/live-links");
    expect(paths).toContain("/app/friends");
    expect(paths).toContain("/app/qr");
    expect(paths).toContain("/app/ai");
  });

  it("exposes one top-level navigation link for contacts", () => {
    const labels = appLinks.map((link) => link.label);

    expect(labels).toContain("Контакты");
    expect(labels).toContain("Живые связи");
    expect(labels).not.toContain("Друзья");
    expect(labels).not.toContain("QR");
    expect(labels).toContain("AI");
  });

  it("exposes a compact mobile bottom nav with overflow destinations", () => {
    expect(mobileBottomNavItems.map((item) => item.label)).toEqual(["Обзор", "Контакты", "AI", "Еще"]);
    expect(mobileOverflowLinks.map((item) => item.label)).toEqual([
      "Планеты",
      "Игры",
      "Лидерборд",
      "Квесты",
      "Награды",
      "Живые связи",
      "Социальное кольцо",
    ]);
  });

  it("treats nested game and planet routes as active shell destinations", () => {
    const gamesLink = appLinks.find((link) => link.to === "/app/games");
    const planetsLink = appLinks.find((link) => link.to === "/app/planets");

    expect(gamesLink).toBeDefined();
    expect(planetsLink).toBeDefined();
    expect(isShellLinkActive("/app/game/moby-bird", gamesLink!)).toBe(true);
    expect(isShellLinkActive("/app/planets/mars", planetsLink!)).toBe(true);
  });

  it("renders the mobile shell header, bottom nav, and overflow panel", () => {
    const html = renderShell("/app/planets/mars");

    expect(html).toContain("mobile-shell-header");
    expect(html).toContain('aria-label="Мобильная навигация"');
    expect(html).toContain("mobile-overflow-panel");
    expect(html).toContain('aria-label="Закрыть разделы Еще"');
    expect(html).toContain("Планеты");
    expect(html).toContain("Социальное кольцо");
    expect(html).toContain('data-mobile-overflow-active="true"');
  });

  it("allows mobile bottom nav labels to wrap instead of truncating with ellipsis", () => {
    const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
    const mobileBottomNavLabelBlockMatch = css.match(/\.mobile-bottom-nav__item > \* \{[^}]+\}/);

    expect(mobileBottomNavLabelBlockMatch?.[0]).toContain("white-space: normal;");
    expect(mobileBottomNavLabelBlockMatch?.[0]).not.toContain("text-overflow: ellipsis;");
    expect(mobileBottomNavLabelBlockMatch?.[0]).not.toContain("white-space: nowrap;");
  });

  it("centers mobile bottom nav labels inside each tile", () => {
    const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
    const mobileBottomNavLabelBlockMatch = css.match(/\.mobile-bottom-nav__item > \* \{[^}]+\}/);

    expect(mobileBottomNavLabelBlockMatch?.[0]).toContain("display: flex;");
    expect(mobileBottomNavLabelBlockMatch?.[0]).toContain("align-items: center;");
    expect(mobileBottomNavLabelBlockMatch?.[0]).toContain("justify-content: center;");
    expect(mobileBottomNavLabelBlockMatch?.[0]).toContain("text-align: center;");
  });

  it("lets the mobile overflow panel expand to its full content height", () => {
    const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
    const mobileOverflowPanelBlockMatch = css.match(/\.mobile-overflow-panel__content \{[^}]+\}/);

    expect(mobileOverflowPanelBlockMatch?.[0]).not.toContain("max-height:");
    expect(mobileOverflowPanelBlockMatch?.[0]).not.toContain("overflow: auto;");
  });
});
