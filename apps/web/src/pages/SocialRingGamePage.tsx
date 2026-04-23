import { useMutation, useQueryClient } from "@tanstack/react-query";
import { startTransition, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { api } from "@/lib/api";
import { calculateBonusOutcome } from "@/lib/bonus-engine";
import { formatGameRewardStatus } from "@/lib/game-status";
import { useGameStore } from "@/lib/game-store";
import { useSessionStore } from "@/lib/session-store";

const TOTAL_ROUNDS = 6;
const SIGNAL_PADS = [
  { id: "nova", label: "Нова", accent: "var(--planet-orbit)" },
  { id: "glow", label: "Сияние", accent: "var(--planet-shield)" },
  { id: "mint", label: "Мята", accent: "var(--planet-social)" },
  { id: "pulse", label: "Пульс", accent: "var(--accent-cyan)" },
] as const;

type SignalPadId = (typeof SIGNAL_PADS)[number]["id"];
type RelayPhase = "idle" | "showing" | "input" | "transition" | "complete";

function randomSignal(): SignalPadId {
  return SIGNAL_PADS[Math.floor(Math.random() * SIGNAL_PADS.length)]!.id;
}

function rewardFromScore(score: number) {
  return Math.max(6, Math.floor(score * 1.8));
}

export function SocialRingGamePage() {
  const { userId } = useSessionStore();
  const queryClient = useQueryClient();
  const recordSocialRun = useGameStore((state) => state.recordSocialRun);
  const bestSocialScore = useGameStore((state) => state.bestSocialScore);
  const stardust = useGameStore((state) => state.stardust);
  const bonusStreak = useGameStore((state) => state.bonusStreak);
  const vaultCharge = useGameStore((state) => state.vaultCharge);
  const selectedPlanet = useGameStore((state) => state.selectedPlanet);
  const structures = useGameStore((state) => state.structures);
  const planetMastery = useGameStore((state) => state.planetMastery);
  const [phase, setPhase] = useState<RelayPhase>("idle");
  const [sequence, setSequence] = useState<SignalPadId[]>([]);
  const [round, setRound] = useState(0);
  const [userIndex, setUserIndex] = useState(0);
  const [score, setScore] = useState(0);
  const [activePad, setActivePad] = useState<SignalPadId | null>(null);
  const [rewardClaimed, setRewardClaimed] = useState(false);
  const [status, setStatus] = useState("Подготовьте ринг, запомните последовательность и повторите ее.");
  const timersRef = useRef<number[]>([]);
  const baseReward = rewardFromScore(score);
  const rewardPreview = useMemo(
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
          planetCode: "SOCIAL_RING",
          baseReward,
          performanceScore: score,
          category: "mini_game",
        },
      ),
    [baseReward, bonusStreak, planetMastery, score, selectedPlanet, structures, vaultCharge],
  );
  const progressDots = useMemo(() => Array.from({ length: TOTAL_ROUNDS }, (_, index) => index < round), [round]);
  const canResetRun = phase !== "idle" || sequence.length > 0 || round > 0 || score > 0;

  const claimMutation = useMutation({
    mutationFn: async () => {
      const event = await api.ingest(api.buildEvent(userId, "referral"));
      const run = await api.submitGameRun({
        user_id: userId,
        game_code: "social_ring_signal",
        planet_code: "SOCIAL_RING",
        score,
        base_reward: baseReward,
        total_reward: rewardPreview.totalReward,
        source_event_id: event.event_id,
        bonus_breakdown: {
          streak_bonus: rewardPreview.streakBonus,
          mastery_bonus: rewardPreview.masteryBonus,
          performance_bonus: rewardPreview.performanceBonus,
          focus_bonus: rewardPreview.focusBonus,
          charge_gain: rewardPreview.chargeGain,
          crates_earned: rewardPreview.cratesEarned,
        },
      });
      return { event, run };
    },
    onSuccess: () => {
      const outcome = recordSocialRun(score, baseReward);
      setRewardClaimed(true);
      setStatus(formatGameRewardStatus({ totalReward: outcome.totalReward, cratesEarned: outcome.cratesEarned, syncLabel: "Социальным кольцом" }));
      startTransition(() => {
        queryClient.invalidateQueries({ queryKey: ["profile", userId] });
        queryClient.invalidateQueries({ queryKey: ["leaderboard"] });
        queryClient.invalidateQueries({ queryKey: ["ledger", userId] });
        queryClient.invalidateQueries({ queryKey: ["quests", userId] });
        queryClient.invalidateQueries({ queryKey: ["games-summary", userId] });
      });
    },
    onError: () => {
      setStatus("Ринг завершен, но синхронизация не прошла. Попробуйте забрать награду еще раз.");
    },
  });

  function clearTimers() {
    for (const timer of timersRef.current) {
      window.clearTimeout(timer);
    }
    timersRef.current = [];
  }

  function resetRun() {
    clearTimers();
    setPhase("idle");
    setSequence([]);
    setRound(0);
    setUserIndex(0);
    setScore(0);
    setActivePad(null);
    setRewardClaimed(false);
    setStatus("Подготовьте ринг, запомните последовательность и повторите ее.");
  }

  function launchRun() {
    clearTimers();
    const firstSequence: SignalPadId[] = [randomSignal()];
    setPhase("showing");
    setSequence(firstSequence);
    setRound(1);
    setUserIndex(0);
    setScore(0);
    setActivePad(null);
    setRewardClaimed(false);
    setStatus("Ринг активен. Сначала запомните порядок сигналов.");
  }

  function queueNextRound() {
    setSequence((current) => [...current, randomSignal()]);
    setRound((current) => current + 1);
    setUserIndex(0);
    setPhase("showing");
    setStatus("Цепочка расширена. Загружается новый командный паттерн.");
  }

  function finishRun(message: string) {
    clearTimers();
    setPhase("complete");
    setActivePad(null);
    setStatus(message);
  }

  function pulsePad(padId: SignalPadId) {
    setActivePad(padId);
    const clearTimer = window.setTimeout(() => {
      setActivePad((current) => (current === padId ? null : current));
    }, 180);
    timersRef.current.push(clearTimer);
  }

  function handlePadClick(padId: SignalPadId) {
    if (phase !== "input") {
      return;
    }

    pulsePad(padId);

    if (padId !== sequence[userIndex]) {
      finishRun("Связь оборвалась. Командный импульс распался до завершения цепочки.");
      return;
    }

    const nextIndex = userIndex + 1;
    setScore((current) => current + 2);

    if (nextIndex < sequence.length) {
      setUserIndex(nextIndex);
      setStatus("Хорошая фиксация. Продолжайте повторять сигналы без ошибки.");
      return;
    }

    setScore((current) => current + round * 2);

    if (round >= TOTAL_ROUNDS) {
      finishRun("Ринг собран идеально. Командный сигнал стабилен и готов к награде.");
      return;
    }

    setPhase("transition");
    setStatus("Сигнал сохранен. Готовим следующий командный паттерн.");
    const nextRoundTimer = window.setTimeout(queueNextRound, 520);
    timersRef.current.push(nextRoundTimer);
  }

  useEffect(() => {
    if (phase !== "showing" || sequence.length === 0) {
      return;
    }

    clearTimers();
    sequence.forEach((signal, index) => {
      const revealTimer = window.setTimeout(() => {
        setActivePad(signal);
      }, 420 + index * 620);
      const hideTimer = window.setTimeout(() => {
        setActivePad((current) => (current === signal ? null : current));
      }, 720 + index * 620);
      timersRef.current.push(revealTimer, hideTimer);
    });

    const inputTimer = window.setTimeout(() => {
      setActivePad(null);
      setUserIndex(0);
      setPhase("input");
      setStatus("Ваш ход. Нажмите сигнальные панели в том же порядке.");
    }, 360 + sequence.length * 620);
    timersRef.current.push(inputTimer);

    return clearTimers;
  }, [phase, sequence]);

  useEffect(() => clearTimers, []);

  return (
    <div className="space-y-6">
      <section className="hero-panel">
        <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr] xl:items-end">
          <div className="space-y-4">
            <p className="eyebrow">Третья мини-игра</p>
            <h2 className="text-5xl font-semibold leading-[0.95] md:text-6xl">
              Сигнальный ринг превращает рефералы в игру на память, ритм и командную синхронизацию.
            </h2>
            <p className="max-w-2xl text-base text-white/68 md:text-lg">
              Следите за рингом, повторяйте последовательность и завершайте цепочку, чтобы превратить забег в живое событие.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="metric-chip">
              <span>Раунд</span>
              <strong>{round}/{TOTAL_ROUNDS}</strong>
            </div>
            <div className="metric-chip">
              <span>Счет сигнала</span>
              <strong>{score}</strong>
            </div>
            <div className="metric-chip">
              <span>Лучший счет кольца</span>
              <strong>{bestSocialScore}</strong>
            </div>
            <div className="metric-chip">
              <span>Награда</span>
              <strong>{rewardPreview.totalReward}</strong>
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
            <p className="text-sm uppercase tracking-[0.25em] text-white/45">Управление рингом</p>
            <h3 className="text-4xl font-semibold">
              {phase === "idle"
                ? "Готов к синхронизации"
                : phase === "showing"
                  ? "Запоминайте команду"
                  : phase === "input"
                    ? "Повторите сигналы"
                    : phase === "transition"
                      ? "Загрузка паттерна"
                      : "Забег завершен"}
            </h3>
            <p className="text-white/62">{status}</p>
            {canResetRun ? (
              <div className="flex flex-wrap gap-3">
                <button className="secondary-button" onClick={resetRun}>
                  Сбросить
                </button>
              </div>
            ) : null}

            <div className="signal-progress">
              {progressDots.map((isActive, index) => (
                <span key={index} className={`signal-progress__dot ${isActive ? "signal-progress__dot--active" : ""}`} />
              ))}
            </div>

            <div className="list-row">
              <div>
                <p className="text-lg font-medium">Забрать награду ринга</p>
                <p className="text-sm text-white/55">
                  База {baseReward}, серия +{rewardPreview.streakBonus}, мастерство +{rewardPreview.masteryBonus}, результат +{rewardPreview.performanceBonus}.
                </p>
              </div>
              <button
                className="primary-button"
                disabled={phase !== "complete" || rewardClaimed || claimMutation.isPending || score === 0}
                onClick={() => claimMutation.mutate()}
              >
                {rewardClaimed ? "Получено" : claimMutation.isPending ? "Синхронизация…" : `Забрать +${rewardPreview.totalReward}`}
              </button>
            </div>

            <div className="metric-chip">
              <span>Звездная пыль</span>
              <strong>{stardust}</strong>
            </div>
          </div>
        </article>

        <article className="surface-panel signal-stage-panel">
          <div className="signal-stage">
            <div className="signal-stage__pads">
              {SIGNAL_PADS.map((pad) => (
                <button
                  key={pad.id}
                  className={`signal-pad ${activePad === pad.id ? "signal-pad--active" : ""}`}
                  style={{ "--signal-accent": pad.accent } as CSSProperties}
                  onClick={() => handlePadClick(pad.id)}
                  disabled={phase !== "input"}
                >
                  <span>{pad.label}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="signal-stage__launch">
            <button className="primary-button" onClick={launchRun} disabled={phase === "showing" || phase === "input"}>
              {phase === "complete" ? "Запустить снова" : "Старт ринга"}
            </button>
          </div>
        </article>
      </section>
    </div>
  );
}
