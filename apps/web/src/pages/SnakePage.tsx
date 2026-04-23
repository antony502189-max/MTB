import { useMutation, useQueryClient } from "@tanstack/react-query";
import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { calculateBonusOutcome } from "@/lib/bonus-engine";
import { formatGameRewardStatus } from "@/lib/game-status";
import { useGameStore } from "@/lib/game-store";
import { useSessionStore } from "@/lib/session-store";

const BOARD = 12;
const START = [{ x: 5, y: 6 }, { x: 4, y: 6 }];
const OPPOSITE_DIRECTION = {
  up: "down",
  down: "up",
  left: "right",
  right: "left",
} as const;
const KEY_DIRECTION_BY_CODE: Partial<Record<string, Direction>> = {
  ArrowUp: "up",
  KeyW: "up",
  ArrowDown: "down",
  KeyS: "down",
  ArrowLeft: "left",
  KeyA: "left",
  ArrowRight: "right",
  KeyD: "right",
};
const KEY_DIRECTION_BY_KEY: Partial<Record<string, Direction>> = {
  arrowup: "up",
  w: "up",
  arrowdown: "down",
  s: "down",
  arrowleft: "left",
  a: "left",
  arrowright: "right",
  d: "right",
};

type Point = { x: number; y: number };
type Direction = "up" | "down" | "left" | "right";
type TouchInputState = {
  coarsePointer: boolean;
  maxTouchPoints: number;
};

const SNAKE_MIN_SWIPE_DISTANCE = 24;

function nextHead(head: Point, direction: Direction): Point {
  if (direction === "up") return { x: head.x, y: head.y - 1 };
  if (direction === "down") return { x: head.x, y: head.y + 1 };
  if (direction === "left") return { x: head.x - 1, y: head.y };
  return { x: head.x + 1, y: head.y };
}

function randomFood(snake: Point[]): Point {
  while (true) {
    const point = { x: Math.floor(Math.random() * BOARD), y: Math.floor(Math.random() * BOARD) };
    if (!snake.some((part) => part.x === point.x && part.y === point.y)) {
      return point;
    }
  }
}

function rewardFromScore(score: number) {
  return Math.max(4, score * 3);
}

function directionFromKeyboardEvent(event: KeyboardEvent): Direction | undefined {
  return KEY_DIRECTION_BY_CODE[event.code] ?? KEY_DIRECTION_BY_KEY[event.key.toLowerCase()];
}

export function directionFromSwipeDelta(
  deltaX: number,
  deltaY: number,
  minDistance = SNAKE_MIN_SWIPE_DISTANCE,
): Direction | undefined {
  const absX = Math.abs(deltaX);
  const absY = Math.abs(deltaY);
  const dominantDistance = Math.max(absX, absY);

  if (dominantDistance < minDistance) {
    return undefined;
  }

  if (absX >= absY) {
    return deltaX >= 0 ? "right" : "left";
  }

  return deltaY >= 0 ? "down" : "up";
}

export function supportsTouchInput({ coarsePointer, maxTouchPoints }: TouchInputState) {
  return coarsePointer || maxTouchPoints > 0;
}

export function SnakePage() {
  const { userId } = useSessionStore();
  const queryClient = useQueryClient();
  const [snake, setSnake] = useState<Point[]>(START);
  const [direction, setDirection] = useState<Direction>("right");
  const [food, setFood] = useState<Point>({ x: 8, y: 6 });
  const [score, setScore] = useState(0);
  const [isOver, setIsOver] = useState(false);
  const [isStarted, setIsStarted] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [rewardClaimed, setRewardClaimed] = useState(false);
  const [status, setStatus] = useState("Подготовьте забег и запускайте, когда будете готовы.");
  const directionRef = useRef<Direction>("right");
  const recordSnakeRun = useGameStore((state) => state.recordSnakeRun);
  const bestSnakeScore = useGameStore((state) => state.bestSnakeScore);
  const stardust = useGameStore((state) => state.stardust);
  const bonusStreak = useGameStore((state) => state.bonusStreak);
  const vaultCharge = useGameStore((state) => state.vaultCharge);
  const vaultCrates = useGameStore((state) => state.vaultCrates);
  const selectedPlanet = useGameStore((state) => state.selectedPlanet);
  const structures = useGameStore((state) => state.structures);
  const planetMastery = useGameStore((state) => state.planetMastery);
  const tickRate = Math.max(92, 180 - score * 5);
  const baseReward = rewardFromScore(score);
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
          planetCode: "ORBIT_COMMERCE",
          baseReward,
          performanceScore: score,
          category: "mini_game",
        },
      ),
    [baseReward, bonusStreak, planetMastery, score, selectedPlanet, structures, vaultCharge],
  );
  const canPauseRun = isStarted && !isPaused && !isOver;
  const canResetRun = !isPaused && (isStarted || isOver || score > 0);
  const launchButtonDisabled = isStarted && !isPaused && !isOver;
  const launchButtonLabel = !isStarted || isOver ? "Начать забег" : isPaused ? "Продолжить" : "Забег идет";
  const claimMutation = useMutation({
    mutationFn: async () => {
      const event = await api.ingest(api.buildEvent(userId, score >= 4 ? "partner" : "nonPartner"));
      const run = await api.submitGameRun({
        user_id: userId,
        game_code: "halva_snake",
        planet_code: "ORBIT_COMMERCE",
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
      const outcome = recordSnakeRun(score, baseReward);
      setRewardClaimed(true);
      setStatus(formatGameRewardStatus({ totalReward: outcome.totalReward, cratesEarned: outcome.cratesEarned, syncLabel: "Орбитой покупок" }));
      startTransition(() => {
        queryClient.invalidateQueries({ queryKey: ["profile", userId] });
        queryClient.invalidateQueries({ queryKey: ["leaderboard"] });
        queryClient.invalidateQueries({ queryKey: ["ledger", userId] });
        queryClient.invalidateQueries({ queryKey: ["quests", userId] });
        queryClient.invalidateQueries({ queryKey: ["games-summary", userId] });
      });
    },
    onError: () => {
      setStatus("Забег завершен локально, но синхронизация с Орбитой покупок не прошла. Попробуйте забрать награду еще раз.");
    },
  });

  function queueDirection(next: Direction) {
    if (directionRef.current === OPPOSITE_DIRECTION[next]) {
      return;
    }
    directionRef.current = next;
    setDirection(next);
  }

  function resetRun() {
    setSnake(START);
    setDirection("right");
    directionRef.current = "right";
    setFood({ x: 8, y: 6 });
    setScore(0);
    setIsOver(false);
    setIsStarted(false);
    setIsPaused(false);
    setRewardClaimed(false);
    setStatus("Подготовьте забег и запускайте, когда будете готовы.");
  }

  function launchRun() {
    if (isOver) {
      setSnake(START);
      setDirection("right");
      directionRef.current = "right";
      setFood({ x: 8, y: 6 });
      setScore(0);
      setIsOver(false);
      setRewardClaimed(false);
    }
    setIsStarted(true);
    setIsPaused(false);
    setStatus("Забег идет. Кормите змейку и не врезайтесь.");
  }

  function togglePause() {
    setIsPaused((value) => {
      const next = !value;
      setStatus(next ? "Забег поставлен на паузу." : "Забег продолжен.");
      return next;
    });
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const nextDirection = directionFromKeyboardEvent(event);
      if (nextDirection) {
        event.preventDefault();
        queueDirection(nextDirection);
      }
      if (event.key === " ") {
        event.preventDefault();
        if (!isStarted || isOver) {
          launchRun();
        } else {
          togglePause();
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOver, isStarted]);

  useEffect(() => {
    if (!isStarted || isPaused || isOver) {
      return;
    }

    const timer = window.setInterval(() => {
      setSnake((current) => {
        const head = current[0];
        const newHead = nextHead(head, directionRef.current);
        const hitsWall = newHead.x < 0 || newHead.y < 0 || newHead.x >= BOARD || newHead.y >= BOARD;
        const hitsSelf = current.some((segment) => segment.x === newHead.x && segment.y === newHead.y);

        if (hitsWall || hitsSelf) {
          setIsOver(true);
          setStatus("Забег завершен. Заберите топливо или начните новую орбиту.");
          return current;
        }

        const grew = newHead.x === food.x && newHead.y === food.y;
        const nextSnake = [newHead, ...current];
        if (!grew) {
          nextSnake.pop();
        } else {
          setScore((value) => value + 1);
          setFood(randomFood(nextSnake));
          setStatus("Токен пойман. Держите линию чистой и набирайте комбо.");
        }
        return nextSnake;
      });
    }, tickRate);

    return () => window.clearInterval(timer);
  }, [food, isOver, isPaused, isStarted, tickRate]);

  const cells = useMemo(
    () =>
      Array.from({ length: BOARD * BOARD }, (_, index) => {
        const x = index % BOARD;
        const y = Math.floor(index / BOARD);
        const isSnake = snake.some((part) => part.x === x && part.y === y);
        const isFood = food.x === x && food.y === y;
        return { x, y, isSnake, isFood };
      }),
    [food, snake],
  );

  return (
    <div className="space-y-6">
      <section className="hero-panel">
        <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr] xl:items-end">
          <div className="space-y-4">
            <p className="eyebrow">Игровой модуль</p>
            <h2 className="text-5xl font-semibold leading-[0.95] md:text-6xl">
              Змейка Халва получила сенсорное управление, темп, награды и место в общей прокачке.
            </h2>
            <p className="max-w-2xl text-base text-white/68 md:text-lg">
              Используйте стрелки, WASD или экранные кнопки, собирайте орбитальные токены и превращайте счет в звездную пыль.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="metric-chip">
              <span>Текущий счет</span>
              <strong>{score}</strong>
            </div>
            <div className="metric-chip">
              <span>Лучший счет</span>
              <strong>{bestSnakeScore}</strong>
            </div>
            <div className="metric-chip">
              <span>Награда</span>
              <strong>{bonusPreview.totalReward}</strong>
            </div>
            <div className="metric-chip">
              <span>Звездная пыль</span>
              <strong>{stardust}</strong>
            </div>
            <div className="metric-chip">
              <span>Серия бонусов</span>
              <strong>{bonusStreak}x</strong>
            </div>
            <div className="metric-chip">
              <span>Контейнеры</span>
              <strong>{vaultCrates}</strong>
            </div>
          </div>
        </div>
      </section>
      <section className="grid gap-6 xl:grid-cols-[0.78fr_1.22fr]">
        <article className="surface-panel">
          <div className="space-y-4">
            <p className="text-sm uppercase tracking-[0.25em] text-white/45">Управление забегом</p>
            <h3 className="text-4xl font-semibold">
              {!isStarted ? "Готов к старту" : isOver ? "Забег завершен" : isPaused ? "Пауза" : "Орбита активна"}
            </h3>
            <p className="text-white/62">{status}</p>
            <div className="flex flex-wrap gap-3">
              {canPauseRun ? (
                <button className="secondary-button" onClick={togglePause}>
                  Пауза
                </button>
              ) : null}
              {canResetRun ? (
                <button className="secondary-button" onClick={resetRun}>
                  Сбросить забег
                </button>
              ) : null}
            </div>

            <div className="snake-controls-panel snake-controls-panel--desktop mt-5 rounded-[28px] border border-white/8 bg-black/20 p-4">
              <div className="snake-controls">
                <button className="control-button control-button-up" onClick={() => queueDirection("up")}>↑</button>
                <button className="control-button control-button-left" onClick={() => queueDirection("left")}>←</button>
                <button className="control-button control-button-right" onClick={() => queueDirection("right")}>→</button>
                <button className="control-button control-button-down" onClick={() => queueDirection("down")}>↓</button>
              </div>
            </div>

            <div className="space-y-3">
              <div className="list-row">
                <div>
                  <p className="text-lg font-medium">Темп обновления</p>
                  <p className="text-sm text-white/55">Скорость растет по мере длины забега.</p>
                </div>
                <strong className="text-2xl">{tickRate}ms</strong>
              </div>
              <div className="list-row">
                <div>
                  <p className="text-lg font-medium">Забрать награду</p>
                  <p className="text-sm text-white/55">
                    База {baseReward}, серия +{bonusPreview.streakBonus}, мастерство +{bonusPreview.masteryBonus}, результат +{bonusPreview.performanceBonus}.
                  </p>
                </div>
                <button
                  className="primary-button"
                  disabled={rewardClaimed || score === 0 || !isOver || claimMutation.isPending}
                  onClick={() => claimMutation.mutate()}
                >
                  {rewardClaimed ? "Получено" : claimMutation.isPending ? "Синхронизация…" : `Забрать +${bonusPreview.totalReward}`}
                </button>
              </div>
            </div>
          </div>
        </article>
        <article className="surface-panel" data-testid="snake-board-panel">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-[24px] border border-white/8 bg-black/20 px-4 py-3">
            <div className="space-y-1">
              <p className="text-xs uppercase tracking-[0.25em] text-white/40">Поле игры</p>
              <p className="text-sm text-white/60">Старт теперь рядом с сеткой, чтобы запускать забег было удобнее.</p>
            </div>
            <button
              className="primary-button"
              data-testid="snake-launch-button"
              onClick={launchRun}
              disabled={launchButtonDisabled}
            >
              {launchButtonLabel}
            </button>
          </div>
          <div className="snake-grid">
            {cells.map((cell) => (
              <div
                key={`${cell.x}-${cell.y}`}
                className={`snake-cell ${cell.isSnake ? "snake-cell-snake" : ""} ${cell.isFood ? "snake-cell-food" : ""}`}
              />
            ))}
          </div>
        </article>
      </section>
    </div>
  );
}
