import { useMutation, useQueryClient } from "@tanstack/react-query";
import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { calculateBonusOutcome } from "@/lib/bonus-engine";
import { formatGameRewardStatus } from "@/lib/game-status";
import { useGameStore } from "@/lib/game-store";
import { useSessionStore } from "@/lib/session-store";

const ROUNDS = 12;
const PULSE_START_POSITION = 12;
const PULSE_BASE_SPEED = 28;
const PULSE_ROUND_SPEED = 2.8;

function rewardFromShieldScore(score: number) {
  return Math.max(5, score * 2);
}

export function CreditShieldGamePage() {
  const { userId } = useSessionStore();
  const queryClient = useQueryClient();
  const [round, setRound] = useState(1);
  const [position, setPosition] = useState(PULSE_START_POSITION);
  const [score, setScore] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [rewardClaimed, setRewardClaimed] = useState(false);
  const [status, setStatus] = useState("Запустите стабилизатор и нажмите, когда импульс попадет в центральную зону.");
  const directionRef = useRef(1);
  const recordShieldRun = useGameStore((state) => state.recordShieldRun);
  const bestShieldScore = useGameStore((state) => state.bestShieldScore);
  const stardust = useGameStore((state) => state.stardust);
  const bonusStreak = useGameStore((state) => state.bonusStreak);
  const vaultCharge = useGameStore((state) => state.vaultCharge);
  const selectedPlanet = useGameStore((state) => state.selectedPlanet);
  const structures = useGameStore((state) => state.structures);
  const planetMastery = useGameStore((state) => state.planetMastery);
  const baseReward = rewardFromShieldScore(score);
  const bonusPreview = useMemo(
    () =>
      calculateBonusOutcome(
        {
          bonusStreak,
          vaultCharge,
          selectedPlanet,
          structures,
          planetMastery,
        },
        {
          planetCode: "CREDIT_SHIELD",
          baseReward,
          performanceScore: score,
          category: "mini_game",
        },
      ),
    [baseReward, bonusStreak, planetMastery, score, selectedPlanet, structures, vaultCharge],
  );
  const canResetGame = isRunning || isComplete || score > 0 || round > 1;
  const claimMutation = useMutation({
    mutationFn: async () => {
      const event = await api.ingest(api.buildEvent(userId, score >= 18 ? "credit" : "education"));
      const run = await api.submitGameRun({
        user_id: userId,
        game_code: "credit_shield_reactor",
        planet_code: "CREDIT_SHIELD",
        score,
        base_reward: baseReward,
        total_reward: bonusPreview.totalReward,
        source_event_id: event.event_id,
        bonus_breakdown: {
          streak_bonus: bonusPreview.streakBonus,
          mastery_bonus: bonusPreview.masteryBonus,
          performance_bonus: bonusPreview.performanceBonus,
          focus_bonus: bonusPreview.focusBonus,
          charge_gain: bonusPreview.chargeGain,
          crates_earned: bonusPreview.cratesEarned,
        },
      });
      return { event, run };
    },
    onSuccess: () => {
      const outcome = recordShieldRun(score, baseReward);
      setRewardClaimed(true);
      setStatus(formatGameRewardStatus({ totalReward: outcome.totalReward, cratesEarned: outcome.cratesEarned, syncLabel: "Кредитным щитом" }));
      startTransition(() => {
        queryClient.invalidateQueries({ queryKey: ["profile", userId] });
        queryClient.invalidateQueries({ queryKey: ["leaderboard"] });
        queryClient.invalidateQueries({ queryKey: ["ledger", userId] });
        queryClient.invalidateQueries({ queryKey: ["quests", userId] });
        queryClient.invalidateQueries({ queryKey: ["games-summary", userId] });
      });
    },
    onError: () => {
      setStatus("Забег завершен, но синхронизация с Кредитным щитом не прошла. Попробуйте забрать награду еще раз.");
    },
  });

  function resetGameState() {
    setRound(1);
    setPosition(PULSE_START_POSITION);
    directionRef.current = 1;
    setScore(0);
    setIsComplete(false);
    setRewardClaimed(false);
  }

  useEffect(() => {
    if (!isRunning || isComplete) {
      return;
    }

    let animationFrame = 0;
    let isCancelled = false;
    let previousTime: number | null = null;
    const speed = PULSE_BASE_SPEED + Math.min(round, 6) * PULSE_ROUND_SPEED;

    const animate = (time: number) => {
      if (isCancelled) {
        return;
      }
      if (previousTime === null) {
        previousTime = time;
      }
      const deltaSeconds = Math.min((time - previousTime) / 1000, 0.08);
      previousTime = time;

      setPosition((current) => {
        let next = current + directionRef.current * speed * deltaSeconds;
        if (next >= 100) {
          next = 100 - (next - 100);
          directionRef.current = -1;
        }
        if (next <= 0) {
          next = -next;
          directionRef.current = 1;
        }
        return Math.max(0, Math.min(100, next));
      });

      if (!isCancelled) {
        animationFrame = window.requestAnimationFrame(animate);
      }
    };

    animationFrame = window.requestAnimationFrame(animate);
    return () => {
      isCancelled = true;
      window.cancelAnimationFrame(animationFrame);
    };
  }, [isComplete, isRunning, round]);

  const accuracyBand = useMemo(() => {
    if (position >= 44 && position <= 56) return "perfect";
    if (position >= 34 && position <= 66) return "good";
    return "miss";
  }, [position]);

  function resetGame() {
    resetGameState();
    setIsRunning(false);
    setStatus("Запустите стабилизатор и нажмите, когда импульс попадет в центральную зону.");
  }

  function launchGame() {
    if (isComplete) {
      resetGameState();
    }
    setIsRunning(true);
    setStatus("Реактор работает. Нажмите фиксацию, когда импульс достигнет центра.");
  }

  function lockPulse() {
    if (!isRunning || isComplete) {
      return;
    }

    const gained = accuracyBand === "perfect" ? 3 : accuracyBand === "good" ? 1 : 0;
    const nextRound = round + 1;
    setScore((value) => value + gained);
    setStatus(
      accuracyBand === "miss"
        ? "Импульс ушел. Держите щит стабильным и попробуйте поймать центр."
        : accuracyBand === "perfect"
          ? "Идеальная фиксация. Прочность щита выросла."
          : "Хорошая фиксация. Щит стал крепче."
    );
    if (nextRound > ROUNDS) {
      setIsRunning(false);
      setIsComplete(true);
      return;
    }

    setRound(nextRound);
  }

  return (
    <div className="space-y-6">
      <section className="hero-panel">
        <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr] xl:items-end">
          <div className="space-y-4">
            <p className="eyebrow">Вторая мини-игра</p>
            <h2 className="text-5xl font-semibold leading-[0.95] md:text-6xl">
              Реактор щита тренирует тайминг, спокойствие и перевод результата в награды.
            </h2>
            <p className="max-w-2xl text-base text-white/68 md:text-lg">
              Стабилизируйте импульс за 12 раундов. Чем точнее тайминг, тем выше счет, больше звездной пыли и сильнее Кредитный щит.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="metric-chip">
              <span>Раунд</span>
              <strong>{round}/{ROUNDS}</strong>
            </div>
            <div className="metric-chip">
              <span>Счет щита</span>
              <strong>{score}</strong>
            </div>
            <div className="metric-chip">
              <span>Лучший счет щита</span>
              <strong>{bestShieldScore}</strong>
            </div>
            <div className="metric-chip">
              <span>Награда</span>
              <strong>{bonusPreview.totalReward}</strong>
            </div>
            <div className="metric-chip">
              <span>Серия бонусов</span>
              <strong>{bonusStreak}x</strong>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[0.82fr_1.18fr]">
        <article className="surface-panel">
          <div className="space-y-4">
            <p className="text-sm uppercase tracking-[0.25em] text-white/45">Управление реактором</p>
            <h3 className="text-4xl font-semibold">
              {!isRunning && !isComplete ? "Готов к стабилизации" : isComplete ? "Забег завершен" : "Щит активен"}
            </h3>
            <p className="min-h-[4.75rem] text-white/62 md:min-h-[3.25rem]">{status}</p>
            <div className="list-row">
              <div>
                <p className="text-lg font-medium">Забрать награду</p>
                <p className="text-sm text-white/55">
                  База {baseReward}, серия +{bonusPreview.streakBonus}, мастерство +{bonusPreview.masteryBonus}, результат +{bonusPreview.performanceBonus}.
                </p>
              </div>
              <button
                className="primary-button"
                disabled={!isComplete || rewardClaimed || claimMutation.isPending}
                onClick={() => claimMutation.mutate()}
              >
                {rewardClaimed ? "Получено" : claimMutation.isPending ? "Синхронизация…" : `Забрать +${bonusPreview.totalReward}`}
              </button>
            </div>
            <div className="metric-chip">
              <span>Звездная пыль</span>
              <strong>{stardust}</strong>
            </div>
          </div>
        </article>

        <article className="surface-panel">
          <div className="shield-reactor">
            <div className="shield-reactor__meter">
              <div className="shield-reactor__track">
                <div className="shield-reactor__target shield-reactor__target--good" />
                <div className="shield-reactor__target shield-reactor__target--perfect" />
                <div
                  className={`shield-reactor__pulse shield-reactor__pulse--${accuracyBand}`}
                  style={{ left: `${position}%` }}
                />
              </div>
              <div className="shield-reactor__labels">
                <span>Рано</span>
                <strong>{accuracyBand === "perfect" ? "ИДЕАЛЬНО" : accuracyBand === "good" ? "ХОРОШО" : "МИМО"}</strong>
                <span>Поздно</span>
              </div>
            </div>
            <div className="mt-5 flex flex-wrap justify-center gap-3">
              <button className="primary-button" onClick={launchGame} disabled={isRunning}>
                {isComplete ? "Запустить снова" : "Старт реактора"}
              </button>
              {canResetGame ? (
                <button className="secondary-button" onClick={resetGame}>
                  Сбросить
                </button>
              ) : null}
              <button className="secondary-button" onClick={lockPulse} disabled={!isRunning || isComplete}>
                Зафиксировать импульс
              </button>
            </div>
          </div>
        </article>
      </section>
    </div>
  );
}
