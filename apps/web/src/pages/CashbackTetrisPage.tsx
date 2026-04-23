import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GameHero, gameReward } from "@/pages/game-page-shared";

const WIDTH = 10;
const HEIGHT = 16;
const COLORS = ["#ff4d96", "#526bff", "#6df2ff", "#b9ff73"] as const;
const SHAPES = [
  [[1, 1, 1, 1]],
  [
    [1, 1],
    [1, 1],
  ],
  [
    [0, 1, 0],
    [1, 1, 1],
  ],
  [
    [1, 0, 0],
    [1, 1, 1],
  ],
] as const;

type Board = (string | null)[][];
type Piece = {
  shape: number[][];
  x: number;
  y: number;
  color: string;
};

function emptyBoard(): Board {
  return Array.from({ length: HEIGHT }, () => Array.from({ length: WIDTH }, () => null));
}

function randomPiece(): Piece {
  return {
    shape: SHAPES[Math.floor(Math.random() * SHAPES.length)].map((row) => [...row]),
    x: Math.floor(WIDTH / 2) - 2,
    y: 0,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
  };
}

function rotateShape(shape: number[][]) {
  return shape[0].map((_, columnIndex) => shape.map((row) => row[columnIndex]).reverse());
}

function hasCollision(board: Board, piece: Piece, offsetX = 0, offsetY = 0, nextShape = piece.shape) {
  return nextShape.some((row, rowIndex) =>
    row.some((cell, columnIndex) => {
      if (!cell) return false;
      const x = piece.x + columnIndex + offsetX;
      const y = piece.y + rowIndex + offsetY;
      return x < 0 || x >= WIDTH || y >= HEIGHT || Boolean(board[y]?.[x]);
    }),
  );
}

function mergePiece(board: Board, piece: Piece) {
  const next = board.map((row) => [...row]);
  piece.shape.forEach((row, rowIndex) => {
    row.forEach((cell, columnIndex) => {
      if (!cell) return;
      const y = piece.y + rowIndex;
      const x = piece.x + columnIndex;
      if (next[y]?.[x] !== undefined) {
        next[y][x] = piece.color;
      }
    });
  });
  return next;
}

function clearLines(board: Board) {
  const remaining = board.filter((row) => row.some((cell) => !cell));
  const cleared = HEIGHT - remaining.length;
  return {
    board: [...Array.from({ length: cleared }, () => Array.from({ length: WIDTH }, () => null)), ...remaining],
    cleared,
  };
}

export function CashbackTetrisPage() {
  const [board, setBoard] = useState<Board>(emptyBoard);
  const [piece, setPiece] = useState<Piece>(randomPiece);
  const [score, setScore] = useState(0);
  const [lines, setLines] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [rewardClaimed, setRewardClaimed] = useState(false);
  const [status, setStatus] = useState("Собирайте полные линии орбитальных категорий. Стрелки или WASD управляют блоком.");
  const boardRef = useRef(board);
  const pieceRef = useRef(piece);
  const baseReward = gameReward(score + lines * 5, 1.4, 7);
  const canResetRun = isRunning || isComplete || score > 0 || lines > 0;

  useEffect(() => {
    boardRef.current = board;
  }, [board]);

  useEffect(() => {
    pieceRef.current = piece;
  }, [piece]);

  function resetRun() {
    setBoard(emptyBoard());
    setPiece(randomPiece());
    setScore(0);
    setLines(0);
    setIsRunning(false);
    setIsComplete(false);
    setRewardClaimed(false);
    setStatus("Собирайте полные линии орбитальных категорий. Стрелки или WASD управляют блоком.");
  }

  function spawnAfterLock(nextBoard: Board) {
    const nextPiece = randomPiece();
    if (hasCollision(nextBoard, nextPiece)) {
      setIsRunning(false);
      setIsComplete(true);
      setStatus("Поле заполнено. Заберите бонус за собранные категории.");
      return;
    }
    setPiece(nextPiece);
  }

  const stepDown = useCallback(() => {
    const currentBoard = boardRef.current;
    const currentPiece = pieceRef.current;
    if (!hasCollision(currentBoard, currentPiece, 0, 1)) {
      setPiece((value) => ({ ...value, y: value.y + 1 }));
      return;
    }
    const merged = mergePiece(currentBoard, currentPiece);
    const result = clearLines(merged);
    setBoard(result.board);
    if (result.cleared) {
      setLines((value) => value + result.cleared);
      setScore((value) => value + result.cleared * 12);
      setStatus(`Линия усиления очищена: +${result.cleared * 12} очков.`);
    } else {
      setScore((value) => value + 1);
    }
    spawnAfterLock(result.board);
  }, []);

  function movePiece(offset: number) {
    if (!isRunning || hasCollision(boardRef.current, pieceRef.current, offset, 0)) return;
    setPiece((value) => ({ ...value, x: value.x + offset }));
  }

  function rotatePiece() {
    const current = pieceRef.current;
    const rotated = rotateShape(current.shape);
    if (!isRunning || hasCollision(boardRef.current, current, 0, 0, rotated)) return;
    setPiece((value) => ({ ...value, shape: rotated }));
  }

  function hardDrop() {
    if (!isRunning) return;
    while (!hasCollision(boardRef.current, pieceRef.current, 0, 1)) {
      pieceRef.current = { ...pieceRef.current, y: pieceRef.current.y + 1 };
    }
    setPiece(pieceRef.current);
    stepDown();
  }

  useEffect(() => {
    if (!isRunning || isComplete) return;
    const timer = window.setInterval(stepDown, Math.max(260, 620 - lines * 22));
    return () => window.clearInterval(timer);
  }, [isComplete, isRunning, lines, stepDown]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (event.key === "ArrowLeft" || key === "a") {
        event.preventDefault();
        movePiece(-1);
      }
      if (event.key === "ArrowRight" || key === "d") {
        event.preventDefault();
        movePiece(1);
      }
      if (event.key === "ArrowDown" || key === "s") {
        event.preventDefault();
        stepDown();
      }
      if (key === "w") {
        event.preventDefault();
        rotatePiece();
      }
      if (event.code === "Space") {
        event.preventDefault();
        hardDrop();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isRunning, stepDown]);

  const renderedBoard = useMemo(() => {
    const next = board.map((row) => [...row]);
    piece.shape.forEach((row, rowIndex) => {
      row.forEach((cell, columnIndex) => {
        if (!cell) return;
        const y = piece.y + rowIndex;
        const x = piece.x + columnIndex;
        if (next[y]?.[x] !== undefined) {
          next[y][x] = piece.color;
        }
      });
    });
    return next.flat();
  }, [board, piece]);

  return (
    <div className="space-y-6">
      <GameHero
        code="cashback_tetris"
        kicker="Мини-игра из документа"
        title="Орбитальный тетрис собирает категории в линии и запускает бонусные окна."
        description="Укладывайте орбитальные блоки, очищайте строки и превращайте чистое поле в награды Орбиты покупок."
        score={score}
        baseReward={baseReward}
        status={status}
        setStatus={setStatus}
        rewardClaimed={rewardClaimed}
        canClaim={isComplete && score > 0}
        onClaimed={() => setRewardClaimed(true)}
        metrics={[{ label: "Линии", value: lines }]}
      />
      <section className="grid gap-6 xl:grid-cols-[0.78fr_1.22fr]">
        <article className="surface-panel">
          <div className="space-y-4">
            <p className="eyebrow">Блоки категорий</p>
            <h3 className="text-4xl font-semibold">{isRunning ? "Падение активно" : isComplete ? "Поле закрыто" : "Готово к сборке"}</h3>
            <div className="flex flex-wrap gap-3">
              <button className="primary-button" onClick={() => setIsRunning(true)} disabled={isRunning || isComplete}>
                Старт
              </button>
              {canResetRun ? (
                <button className="secondary-button" onClick={resetRun}>
                  Сбросить
                </button>
              ) : null}
            </div>
            <div className="snake-controls-panel snake-controls-panel--desktop">
              <div className="snake-controls">
                <button className="control-button control-button-left" onClick={() => movePiece(-1)}>←</button>
                <button className="control-button control-button-up" onClick={rotatePiece}>↻</button>
                <button className="control-button control-button-right" onClick={() => movePiece(1)}>→</button>
                <button className="control-button control-button-down" onClick={stepDown}>↓</button>
              </div>
            </div>
            <p className="text-sm text-white/58">W - поворот, A/D - движение, S - вниз, Space - быстро вниз. Стрелки тоже работают.</p>
          </div>
        </article>
        <article className="surface-panel">
          <div className="tetris-grid">
            {renderedBoard.map((cell, index) => (
              <span key={index} className="tetris-cell" style={{ background: cell ?? undefined }} />
            ))}
          </div>
        </article>
      </section>
    </div>
  );
}
