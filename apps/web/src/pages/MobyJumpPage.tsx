import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { GameHero, gameReward } from "@/pages/game-page-shared";

type Platform = {
  id: number;
  x: number;
  y: number;
  boost?: boolean;
};

type HorizontalDirection = -1 | 0 | 1;
type TouchInputState = {
  coarsePointer: boolean;
  maxTouchPoints: number;
};

const JUMP_TOUCH_DEAD_ZONE = 0.18;

function makePlatforms(): Platform[] {
  return Array.from({ length: 8 }, (_, index) => ({
    id: index,
    x: 12 + Math.floor(Math.random() * 64),
    y: 320 - index * 48,
    boost: index % 3 === 1,
  }));
}

export function jumpDirectionFromPointerRatio(ratio: number, deadZone = JUMP_TOUCH_DEAD_ZONE): HorizontalDirection {
  const clampedRatio = Math.max(0, Math.min(1, ratio));
  if (clampedRatio <= deadZone) {
    return -1;
  }
  if (clampedRatio >= 1 - deadZone) {
    return 1;
  }
  return 0;
}

export function jumpDirectionFromKey(key: string): HorizontalDirection | undefined {
  const normalizedKey = key.toLowerCase();
  if (normalizedKey === "arrowleft" || normalizedKey === "a") {
    return -1;
  }
  if (normalizedKey === "arrowright" || normalizedKey === "d") {
    return 1;
  }
  return undefined;
}

export function supportsTouchInput({ coarsePointer, maxTouchPoints }: TouchInputState) {
  return coarsePointer || maxTouchPoints > 0;
}

function detectTouchInput() {
  if (typeof window === "undefined") {
    return false;
  }

  return supportsTouchInput({
    coarsePointer: window.matchMedia?.("(pointer: coarse)").matches ?? false,
    maxTouchPoints: window.navigator.maxTouchPoints ?? 0,
  });
}

export function MobyJumpPage() {
  const [player, setPlayer] = useState({ x: 48, y: 280, vy: -260 });
  const [platforms, setPlatforms] = useState<Platform[]>(makePlatforms);
  const [score, setScore] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [rewardClaimed, setRewardClaimed] = useState(false);
  const [usesTouchInput, setUsesTouchInput] = useState(detectTouchInput);
  const [status, setStatus] = useState("Прыгайте по целям, ловите ускоряющие платформы и не падайте ниже экрана.");
  const directionRef = useRef<HorizontalDirection>(0);
  const keyboardDirectionsRef = useRef<HorizontalDirection[]>([]);
  const pointerDirectionRef = useRef<HorizontalDirection>(0);
  const activePointerIdRef = useRef<number | null>(null);
  const platformsRef = useRef(platforms);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const baseReward = gameReward(score, 1.1, 6);

  useEffect(() => {
    platformsRef.current = platforms;
  }, [platforms]);

  useEffect(() => {
    setUsesTouchInput(detectTouchInput());
  }, []);

  function syncDirection() {
    directionRef.current = pointerDirectionRef.current || keyboardDirectionsRef.current.at(-1) || 0;
  }

  function resetDirections() {
    keyboardDirectionsRef.current = [];
    pointerDirectionRef.current = 0;
    directionRef.current = 0;
    activePointerIdRef.current = null;
  }

  function resetRun() {
    resetDirections();
    setPlayer({ x: 48, y: 280, vy: -260 });
    setPlatforms(makePlatforms());
    setScore(0);
    setIsRunning(false);
    setIsComplete(false);
    setRewardClaimed(false);
    setStatus("Прыгайте по целям, ловите ускоряющие платформы и не падайте ниже экрана.");
  }

  function setPointerDirection(direction: HorizontalDirection) {
    pointerDirectionRef.current = direction;
    syncDirection();
  }

  function setKeyboardDirection(direction: HorizontalDirection, isPressed: boolean) {
    const nextDirections = keyboardDirectionsRef.current.filter((value) => value !== direction);
    if (isPressed) {
      nextDirections.push(direction);
    }
    keyboardDirectionsRef.current = nextDirections;
    syncDirection();
  }

  function setPointerDirectionFromClientX(clientX: number) {
    const stage = stageRef.current;
    if (!stage) {
      return;
    }
    const bounds = stage.getBoundingClientRect();
    if (!bounds.width) {
      return;
    }
    const ratio = (clientX - bounds.left) / bounds.width;
    setPointerDirection(jumpDirectionFromPointerRatio(ratio));
  }

  function clearPointerDirection(pointerId?: number) {
    if (pointerId !== undefined && activePointerIdRef.current !== pointerId) {
      return;
    }
    activePointerIdRef.current = null;
    pointerDirectionRef.current = 0;
    syncDirection();
  }

  function handleStagePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }
    activePointerIdRef.current = event.pointerId;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setPointerDirectionFromClientX(event.clientX);
  }

  function handleStagePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (activePointerIdRef.current !== event.pointerId) {
      return;
    }
    setPointerDirectionFromClientX(event.clientX);
  }

  function handleStagePointerEnd(event: ReactPointerEvent<HTMLDivElement>) {
    if (activePointerIdRef.current !== event.pointerId) {
      return;
    }
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    clearPointerDirection(event.pointerId);
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const direction = jumpDirectionFromKey(event.key);
      if (direction !== undefined) {
        setKeyboardDirection(direction, true);
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      const direction = jumpDirectionFromKey(event.key);
      if (direction !== undefined) {
        setKeyboardDirection(direction, false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  useEffect(() => {
    if (!isRunning || isComplete) return;
    let frame = 0;
    let previous: number | null = null;
    const animate = (time: number) => {
      if (previous === null) previous = time;
      const delta = Math.min((time - previous) / 1000, 0.05);
      previous = time;
      setPlayer((current) => {
        let next = {
          x: (current.x + directionRef.current * 52 * delta + 100) % 100,
          y: current.y + current.vy * delta,
          vy: current.vy + 620 * delta,
        };
        const landing = platformsRef.current.find(
          (platform) =>
            current.vy > 0 &&
            current.y + 34 <= platform.y &&
            next.y + 34 >= platform.y &&
            next.x + 8 >= platform.x &&
            next.x <= platform.x + 24,
        );
        if (landing) {
          next = { ...next, y: landing.y - 34, vy: landing.boost ? -470 : -355 };
          setScore((value) => value + (landing.boost ? 8 : 4));
          setStatus(landing.boost ? "Ускоряющая платформа дала мощный импульс вверх." : "Цель маршрута закреплена.");
        }
        if (next.y < 150) {
          const lift = 150 - next.y;
          next.y = 150;
          setPlatforms((items) =>
            items
              .map((platform) => ({ ...platform, y: platform.y + lift }))
              .map((platform) =>
                platform.y > 360
                  ? {
                      id: platform.id,
                      x: 8 + Math.floor(Math.random() * 70),
                      y: 0,
                      boost: Math.random() > 0.66,
                    }
                  : platform,
              ),
          );
          setScore((value) => value + Math.floor(lift / 8));
        }
        if (next.y > 370) {
          resetDirections();
          setIsRunning(false);
          setIsComplete(true);
          setStatus("Прыжок завершен. Заберите награду за высоту и цели.");
        }
        return next;
      });
      frame = window.requestAnimationFrame(animate);
    };
    frame = window.requestAnimationFrame(animate);
    return () => window.cancelAnimationFrame(frame);
  }, [isComplete, isRunning]);

  return (
    <div className="space-y-6">
      <GameHero
        code="moby_jump"
        kicker="Мини-игра из документа"
        title="Moby Jump поднимает пользователя по платформам маршрутных целей."
        description="Двигайтесь влево и вправо, ловите обычные цели и ускорители, чтобы поднять Кредитный щит выше."
        score={score}
        baseReward={baseReward}
        status={status}
        setStatus={setStatus}
        rewardClaimed={rewardClaimed}
        canClaim={isComplete && score > 0}
        onClaimed={() => setRewardClaimed(true)}
      />
      <section className="grid gap-6 xl:grid-cols-[0.78fr_1.22fr]">
        <article className="surface-panel">
          <div className="space-y-4">
            <p className="eyebrow">Прыжок</p>
            <h3 className="text-4xl font-semibold">{isRunning ? "Высота растет" : isComplete ? "Прыжок завершен" : "Готов к прыжку"}</h3>
            <div className="flex flex-wrap gap-3">
              <button className="primary-button" onClick={() => setIsRunning(true)} disabled={isRunning || isComplete}>
                Старт
              </button>
              <button className="secondary-button" onClick={resetRun}>
                Сбросить
              </button>
            </div>
            <p className="text-sm text-white/58">Стрелки или A/D на клавиатуре. На телефоне ведите пальцем по сцене влево или вправо.</p>
            {usesTouchInput ? null : (
              <div className="jump-controls-panel jump-controls-panel--desktop flex flex-wrap gap-3">
                <button
                  className="control-button h-[72px] w-[72px]"
                  onPointerDown={() => setPointerDirection(-1)}
                  onPointerLeave={() => clearPointerDirection()}
                  onPointerUp={() => clearPointerDirection()}
                >
                  ←
                </button>
                <button
                  className="control-button h-[72px] w-[72px]"
                  onPointerDown={() => setPointerDirection(1)}
                  onPointerLeave={() => clearPointerDirection()}
                  onPointerUp={() => clearPointerDirection()}
                >
                  →
                </button>
              </div>
            )}
          </div>
        </article>
        <article className="surface-panel">
          <div
            ref={stageRef}
            className="jump-stage"
            data-testid="moby-jump-stage"
            onPointerCancel={handleStagePointerEnd}
            onPointerDown={handleStagePointerDown}
            onPointerMove={handleStagePointerMove}
            onPointerUp={handleStagePointerEnd}
          >
            <div className="jump-player" style={{ left: `${player.x}%`, top: player.y }}>
              M
            </div>
            {platforms.map((platform) => (
              <span
                key={`${platform.id}-${platform.y}`}
                className={`jump-platform ${platform.boost ? "jump-platform--boost" : ""}`}
                style={{ left: `${platform.x}%`, top: platform.y }}
              />
            ))}
          </div>
        </article>
      </section>
    </div>
  );
}
