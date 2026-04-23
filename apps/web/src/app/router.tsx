import { lazy, Suspense, type ReactNode, useEffect, useState } from "react";
import { createBrowserRouter, Link, Navigate, Outlet, NavLink, useLocation, type RouteObject } from "react-router-dom";
import { motion } from "framer-motion";
import { PLANET_META, type GameCode } from "@mtb/contracts";
import { features } from "@/lib/features";
import { useGameStore } from "@/lib/game-store";
import { MINI_GAME_BY_CODE } from "@/lib/mini-games";
import { isPlanetUnlocked, PLANET_UNLOCK_REQUIREMENTS } from "@/lib/planet-unlocks";

const GalaxyPage = lazy(() => import("@/pages/GalaxyPage").then((module) => ({ default: module.GalaxyPage })));
const GamesPage = lazy(() => import("@/pages/GamesPage").then((module) => ({ default: module.GamesPage })));
const QuestsPage = lazy(() => import("@/pages/QuestsPage").then((module) => ({ default: module.QuestsPage })));
const RewardsPage = lazy(() => import("@/pages/RewardsPage").then((module) => ({ default: module.RewardsPage })));
const ReferralsPage = lazy(() => import("@/pages/ReferralsPage").then((module) => ({ default: module.ReferralsPage })));
const ContactsPage = lazy(() => import("@/pages/ContactsPage").then((module) => ({ default: module.ContactsPage })));
const LiveLinksPage = lazy(() => import("@/pages/LiveLinksPage").then((module) => ({ default: module.LiveLinksPage })));
const AiPage = lazy(() => import("@/pages/AiPage").then((module) => ({ default: module.AiPage })));
const PlanetsMapScreen = lazy(() =>
  import("@/features/planets/screens/PlanetsMapScreen").then((module) => ({ default: module.PlanetsMapScreen })),
);
const PlanetDetailScreen = lazy(() =>
  import("@/features/planets/screens/PlanetDetailScreen").then((module) => ({ default: module.PlanetDetailScreen })),
);
const GameScreen = lazy(() => import("@/features/games/screens/GameScreen").then((module) => ({ default: module.GameScreen })));
const LeaderboardScreen = lazy(() =>
  import("@/features/leaderboard/screens/LeaderboardScreen").then((module) => ({ default: module.LeaderboardScreen })),
);
const SnakePage = lazy(() => import("@/pages/SnakePage").then((module) => ({ default: module.SnakePage })));
const MobyBirdPage = lazy(() => import("@/pages/MobyBirdPage").then((module) => ({ default: module.MobyBirdPage })));
const CashbackTetrisPage = lazy(() =>
  import("@/pages/CashbackTetrisPage").then((module) => ({ default: module.CashbackTetrisPage })),
);
const MobyJumpPage = lazy(() => import("@/pages/MobyJumpPage").then((module) => ({ default: module.MobyJumpPage })));
const FintechMatch3Page = lazy(() =>
  import("@/pages/FintechMatch3Page").then((module) => ({ default: module.FintechMatch3Page })),
);
const SuperMobyBrosPage = lazy(() =>
  import("@/pages/SuperMobyBrosPage").then((module) => ({ default: module.SuperMobyBrosPage })),
);
const CreditShieldGamePage = lazy(() =>
  import("@/pages/CreditShieldGamePage").then((module) => ({ default: module.CreditShieldGamePage })),
);
const SocialRingGamePage = lazy(() =>
  import("@/pages/SocialRingGamePage").then((module) => ({ default: module.SocialRingGamePage })),
);
const AdminKpiPage = lazy(() => import("@/pages/AdminKpiPage").then((module) => ({ default: module.AdminKpiPage })));
const AdminSimulatorPage = lazy(() =>
  import("@/pages/AdminSimulatorPage").then((module) => ({ default: module.AdminSimulatorPage })),
);
const AdminRiskPage = lazy(() => import("@/pages/AdminRiskPage").then((module) => ({ default: module.AdminRiskPage })));
const FeatureLockedPage = lazy(() =>
  import("@/pages/FeatureLockedPage").then((module) => ({ default: module.FeatureLockedPage })),
);

type ShellNavLink = {
  label: string;
  to: string;
  activePrefixes?: string[];
};

type MobileBottomNavItem =
  | (ShellNavLink & { kind: "link" })
  | {
      kind: "overflow";
      label: string;
      destinations: ShellNavLink[];
    };

export const appLinks: ShellNavLink[] = [
  { to: "/app/galaxy", label: "Обзор" },
  { to: "/app/planets", label: "Планеты" },
  { to: "/app/games", label: "Игры", activePrefixes: ["/app/game/"] },
  { to: "/app/leaderboard", label: "Лидерборд" },
  { to: "/app/quests", label: "Квесты" },
  { to: "/app/rewards", label: "Награды" },
  { to: "/app/contacts", label: "Контакты" },
  { to: "/app/live-links", label: "Живые связи" },
  { to: "/app/ai", label: "AI" },
  { to: "/app/referrals", label: "Социальное кольцо" },
];

const adminLinks = [
  { to: "/admin/kpi", label: "KPI" },
  { to: "/admin/simulator", label: "Симулятор" },
  { to: "/admin/risk", label: "Риски" },
];

const mobilePrimaryNavPaths = new Set(["/app/galaxy", "/app/contacts", "/app/ai"]);

function findAppLink(to: string) {
  const link = appLinks.find((item) => item.to === to);

  if (!link) {
    throw new Error(`App link ${to} is not configured`);
  }

  return link;
}

export const mobileOverflowLinks = appLinks.filter((link) => !mobilePrimaryNavPaths.has(link.to));

export const mobileBottomNavItems: MobileBottomNavItem[] = [
  { kind: "link", ...findAppLink("/app/galaxy") },
  { kind: "link", ...findAppLink("/app/contacts") },
  { kind: "link", ...findAppLink("/app/ai") },
  { kind: "overflow", label: "Еще", destinations: mobileOverflowLinks },
];

export function isShellLinkActive(pathname: string, link: Pick<ShellNavLink, "to" | "activePrefixes">) {
  if (pathname === link.to || pathname.startsWith(`${link.to}/`)) {
    return true;
  }

  return (link.activePrefixes ?? []).some((prefix) => pathname.startsWith(prefix));
}

function isMobileBottomNavItemActive(pathname: string, item: MobileBottomNavItem) {
  if (item.kind === "link") {
    return isShellLinkActive(pathname, item);
  }

  return item.destinations.some((link) => isShellLinkActive(pathname, link));
}

function getCurrentSectionLabel(pathname: string) {
  const activeAppLink = appLinks.find((link) => isShellLinkActive(pathname, link));

  if (activeAppLink) {
    return activeAppLink.label;
  }

  const activeAdminLink = adminLinks.find((link) => pathname === link.to || pathname.startsWith(`${link.to}/`));

  return activeAdminLink?.label ?? "Галактика";
}

export function ShellLayout() {
  const location = useLocation();
  const [isMorePanelOpen, setIsMorePanelOpen] = useState(false);
  const isAppRoute = location.pathname.startsWith("/app/");
  const currentSectionLabel = getCurrentSectionLabel(location.pathname);
  const isMobileOverflowActive = mobileOverflowLinks.some((link) => isShellLinkActive(location.pathname, link));

  useEffect(() => {
    setIsMorePanelOpen(false);
  }, [location.pathname]);

  return (
    <div className="app-shell min-h-screen bg-[var(--surface)] text-white">
      <div className="galaxy-noise" />
      <div className="app-shell__frame mx-auto min-h-screen max-w-[1600px]">
        <header className="mobile-shell-header" aria-label="Мобильная шапка">
          <div className="mobile-shell-header__brand">
            <p className="mobile-shell-header__meta">MTB Bank</p>
            <Link className="mobile-shell-header__title" to="/app/galaxy">
              Галактика
            </Link>
          </div>
          <p className="mobile-shell-page mobile-shell-header__context">{currentSectionLabel}</p>
        </header>
        <header className="top-shell">
          <div className="top-shell__brand">
            <h1>Галактика</h1>
          </div>
          <div className="top-shell__nav-stack">
            <nav className="top-nav" aria-label="Основная навигация">
              {appLinks.map((link) => (
                <NavLink
                  key={link.to}
                  to={link.to}
                  aria-current={isShellLinkActive(location.pathname, link) ? "page" : undefined}
                  className={`nav-link ${isShellLinkActive(location.pathname, link) ? "nav-link-active" : ""}`}
                >
                  {link.label}
                </NavLink>
              ))}
            </nav>
            <div className="top-shell__subnav">
              <p className="top-shell__meta">MTB Bank</p>
              <nav className="top-nav top-nav--admin" aria-label="Админка">
                {adminLinks.map((link) => (
                  <NavLink key={link.to} to={link.to} className={({ isActive }) => `nav-link ${isActive ? "nav-link-active" : ""}`}>
                    {link.label}
                  </NavLink>
                ))}
              </nav>
            </div>
          </div>
        </header>
        {isAppRoute ? (
          <section
            id="mobile-overflow-panel"
            className="mobile-overflow-panel"
            aria-label="Разделы Еще"
            aria-hidden={isMorePanelOpen ? "false" : "true"}
            data-open={isMorePanelOpen ? "true" : "false"}
            hidden={!isMorePanelOpen}
          >
            <div className="surface-panel mobile-overflow-panel__content">
              {mobileOverflowLinks.map((link) => (
                <NavLink
                  key={link.to}
                  to={link.to}
                  aria-current={isShellLinkActive(location.pathname, link) ? "page" : undefined}
                  className={`mobile-overflow-link ${isShellLinkActive(location.pathname, link) ? "mobile-overflow-link-active" : ""}`}
                  onClick={() => setIsMorePanelOpen(false)}
                >
                  {link.label}
                </NavLink>
              ))}
            </div>
          </section>
        ) : null}
        <main className="relative overflow-hidden">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, ease: "easeOut" }}
            className="app-shell__content mobile-main relative min-h-screen p-5 pt-3 md:p-8 md:pt-4 xl:p-10 xl:pt-5"
          >
            <Outlet />
          </motion.div>
        </main>
        {isAppRoute ? (
          <nav className="mobile-bottom-nav" aria-label="Мобильная навигация">
            {mobileBottomNavItems.map((item) =>
              item.kind === "link" ? (
                <NavLink
                  key={item.to}
                  to={item.to}
                  aria-current={isShellLinkActive(location.pathname, item) ? "page" : undefined}
                  className={`mobile-bottom-nav__item ${isShellLinkActive(location.pathname, item) ? "mobile-bottom-nav__item--active" : ""}`}
                >
                  <span>{item.label}</span>
                </NavLink>
              ) : (
                <button
                  key={item.label}
                  type="button"
                  className={`mobile-bottom-nav__item mobile-bottom-nav__button ${
                    isMobileBottomNavItemActive(location.pathname, item) ? "mobile-bottom-nav__item--active" : ""
                  }`}
                  aria-controls="mobile-overflow-panel"
                  aria-expanded={isMorePanelOpen}
                  data-mobile-overflow-active={isMobileOverflowActive ? "true" : "false"}
                  onClick={() => setIsMorePanelOpen((value) => !value)}
                >
                  <span>{item.label}</span>
                </button>
              ),
            )}
          </nav>
        ) : null}
      </div>
    </div>
  );
}

function PageFallback() {
  return (
    <div className="surface-panel">
      <p className="eyebrow">Загрузка маршрута</p>
      <h2 className="mt-3 text-3xl font-semibold">Переходим в следующий сектор…</h2>
      <p className="mt-3 text-sm text-white/60">Экран загружается отдельным чанком, чтобы первый вход был легче.</p>
    </div>
  );
}

function renderLazy(element: ReactNode) {
  return <Suspense fallback={<PageFallback />}>{element}</Suspense>;
}

function GameRouteGuard({ code, children }: { code: GameCode; children: ReactNode }) {
  const game = MINI_GAME_BY_CODE[code];
  const unlockedPlanets = useGameStore((state) => state.unlockedPlanets);

  if (isPlanetUnlocked(unlockedPlanets, game.planetCode)) {
    return <>{children}</>;
  }

  return (
    <section className="surface-panel">
      <p className="eyebrow">{PLANET_META[game.planetCode].title}</p>
      <h2 className="mt-3 text-3xl font-semibold">Игра закрыта</h2>
      <p className="mt-3 max-w-2xl text-sm text-white/60">{PLANET_UNLOCK_REQUIREMENTS[game.planetCode]}</p>
      <Link className="primary-button mt-5 inline-flex" to="/app/games">
        Вернуться к играм
      </Link>
    </section>
  );
}

export const appRoutes: RouteObject[] = [
  {
    path: "/",
    element: <ShellLayout />,
    children: [
      { index: true, element: <Navigate to="/app/galaxy" replace /> },
      { path: "/app/galaxy", element: renderLazy(<GalaxyPage />) },
      { path: "/app/planets", element: renderLazy(<PlanetsMapScreen />) },
      { path: "/app/planets/:planetId", element: renderLazy(<PlanetDetailScreen />) },
      { path: "/app/planets/:planetId/game/:gameCode", element: renderLazy(<GameScreen />) },
      { path: "/app/games", element: renderLazy(<GamesPage />) },
      { path: "/app/leaderboard", element: renderLazy(<LeaderboardScreen />) },
      { path: "/app/quests", element: renderLazy(<QuestsPage />) },
      { path: "/app/rewards", element: renderLazy(<RewardsPage />) },
      { path: "/app/contacts", element: renderLazy(<ContactsPage />) },
      { path: "/app/live-links", element: renderLazy(<LiveLinksPage />) },
      { path: "/app/friends", element: <Navigate to="/app/contacts" replace /> },
      { path: "/app/qr", element: <Navigate to="/app/contacts" replace /> },
      { path: "/app/ai", element: renderLazy(<AiPage />) },
      { path: "/app/referrals", element: renderLazy(<ReferralsPage />) },
      { path: "/app/game/social-ring-signal", element: renderLazy(<GameRouteGuard code="social_ring_signal"><SocialRingGamePage /></GameRouteGuard>) },
      { path: "/app/game/credit-shield-reactor", element: renderLazy(<GameRouteGuard code="credit_shield_reactor"><CreditShieldGamePage /></GameRouteGuard>) },
      { path: "/app/game/moby-bird", element: renderLazy(<GameRouteGuard code="moby_bird"><MobyBirdPage /></GameRouteGuard>) },
      { path: "/app/game/cashback-tetris", element: renderLazy(<GameRouteGuard code="cashback_tetris"><CashbackTetrisPage /></GameRouteGuard>) },
      { path: "/app/game/moby-jump", element: renderLazy(<GameRouteGuard code="moby_jump"><MobyJumpPage /></GameRouteGuard>) },
      { path: "/app/game/fintech-match3", element: renderLazy(<GameRouteGuard code="fintech_match3"><FintechMatch3Page /></GameRouteGuard>) },
      { path: "/app/game/super-moby-bros", element: renderLazy(<GameRouteGuard code="super_moby_bros"><SuperMobyBrosPage /></GameRouteGuard>) },
      {
        path: "/app/game/halva-snake",
        element: features.halvaSnakeEnabled ? (
          renderLazy(<GameRouteGuard code="halva_snake"><SnakePage /></GameRouteGuard>)
        ) : (
          renderLazy(<FeatureLockedPage
            title="Змейка Халва временно отключена"
            description="Мини-игра находится за фича-флагом, поэтому ее можно отключить без влияния на основной игровой сценарий и админ-демо."
          />)
        ),
      },
      { path: "/admin/kpi", element: renderLazy(<AdminKpiPage />) },
      { path: "/admin/simulator", element: renderLazy(<AdminSimulatorPage />) },
      { path: "/admin/risk", element: renderLazy(<AdminRiskPage />) },
    ],
  },
];

export function createAppRouter() {
  return createBrowserRouter(appRoutes);
}
