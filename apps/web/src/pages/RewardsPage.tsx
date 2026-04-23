import { useQuery } from "@tanstack/react-query";
import { PLANET_META, type PlanetCode } from "@mtb/contracts";
import { useState } from "react";
import { api } from "@/lib/api";
import { useGameStore } from "@/lib/game-store";
import { GAME_CODE_LABELS } from "@/lib/labels";
import { useSessionStore } from "@/lib/session-store";

const PLANETS: PlanetCode[] = ["ORBIT_COMMERCE", "CREDIT_SHIELD", "SOCIAL_RING"];

export function RewardsPage() {
  const { userId } = useSessionStore();
  const stardust = useGameStore((state) => state.stardust);
  const bonusStreak = useGameStore((state) => state.bonusStreak);
  const vaultCharge = useGameStore((state) => state.vaultCharge);
  const vaultCrates = useGameStore((state) => state.vaultCrates);
  const planetMastery = useGameStore((state) => state.planetMastery);
  const openBonusCrate = useGameStore((state) => state.openBonusCrate);
  const [lastCrateReward, setLastCrateReward] = useState<number | null>(null);
  const gameSummaryQuery = useQuery({
    queryKey: ["games-summary", userId],
    queryFn: () => api.getGameSummary(userId),
  });

  return (
    <div className="space-y-6">
      <section className="hero-panel">
        <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr] xl:items-end">
          <div className="space-y-4">
            <p className="eyebrow">Бонусная система</p>
            <h2 className="text-4xl font-semibold leading-[1.02] md:text-5xl">
              Хранилище наград превращает каждый забег в звездную пыль, серию бонусов, мастерство и контейнеры.
            </h2>
            <p className="max-w-2xl text-base text-white/68 md:text-lg">
              Бонусы считаются локально: базовая награда, серия, мастерство планеты, результат и множитель фокуса.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="metric-chip">
              <span>Звездная пыль</span>
              <strong>{stardust}</strong>
            </div>
            <div className="metric-chip">
              <span>Серия бонусов</span>
              <strong>{bonusStreak}x</strong>
            </div>
            <div className="metric-chip">
              <span>Заряд хранилища</span>
              <strong>{vaultCharge}%</strong>
            </div>
          </div>
        </div>
      </section>

      <section>
        <article className="surface-panel">
          <p className="eyebrow">Хранилище наград</p>
          <h3 className="mt-2 text-3xl font-semibold">Заряжайте, открывайте, повторяйте</h3>
          <p className="mt-3 text-sm text-white/62">
            Награды из трех мини-игр заряжают хранилище. Полный заряд создает контейнер с мгновенным бонусом звездной пыли.
          </p>
          <div className="vault-track mt-6">
            <div className="vault-track__fill" style={{ width: `${vaultCharge}%` }} />
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button
              className="primary-button"
              disabled={vaultCrates <= 0}
              onClick={() => {
                const reward = openBonusCrate();
                setLastCrateReward(reward);
              }}
            >
              Открыть контейнер
            </button>
            <span className="text-sm text-white/58">
              {lastCrateReward ? `Последний контейнер: +${lastCrateReward} звездной пыли` : "В этой сессии контейнер еще не открывался."}
            </span>
          </div>

          <div className="mt-7 space-y-3">
            <p className="eyebrow">Мастерство планет</p>
            {PLANETS.map((planetCode) => (
              <div key={planetCode} className="list-row">
                <div>
                  <p className="text-lg font-medium">{PLANET_META[planetCode].title}</p>
                  <p className="text-sm text-white/55">{PLANET_META[planetCode].summary}</p>
                </div>
                <strong className="text-2xl">{planetMastery[planetCode]}/12</strong>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="surface-panel">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <h3 className="text-2xl font-semibold">Сохраненные забеги</h3>
          </div>
          <span className="text-sm text-white/55">
            забегов: {gameSummaryQuery.data?.total_runs ?? 0} - награда: {gameSummaryQuery.data?.total_reward ?? 0}
          </span>
        </div>
        <div className="grid gap-3 xl:grid-cols-3">
          {gameSummaryQuery.data?.games.map((game) => (
            <div key={game.game_code} className="list-row">
              <div>
                <p className="text-lg font-medium">{GAME_CODE_LABELS[game.game_code]}</p>
                <p className="text-sm text-white/55">{PLANET_META[game.planet_code].title}</p>
              </div>
              <div className="text-right">
                <strong className="text-2xl">{game.best_score}</strong>
                <p className="text-xs text-white/42">забегов: {game.runs}</p>
              </div>
            </div>
          ))}
          {!gameSummaryQuery.data?.games.length ? (
            <p className="text-sm text-white/60">Сводки мини-игр появятся после первой полученной награды.</p>
          ) : null}
        </div>
      </section>

    </div>
  );
}
