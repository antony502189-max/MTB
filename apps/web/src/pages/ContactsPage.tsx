import type { FriendEntry, FriendsResponse, QrResolvedPayload } from "@mtb/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import qrcode from "qrcode-generator";
import { type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, getQrActionLabel } from "@/lib/api";
import { useSessionStore } from "@/lib/session-store";

const EMPTY_FRIENDS: FriendsResponse = {
  accepted: [],
  pending_incoming: [],
  pending_outgoing: [],
};

type InviteSource = "manual" | "qr" | "referral";
type InviteRequest = {
  targetUserId: string;
  source: InviteSource;
};
type ActionRoute = "/app/contacts" | "/app/ai";
type ResolverState = "idle" | "loading" | "error" | "invalid" | "success";
type ScannerState = "idle" | "starting" | "active" | "detected" | "unsupported" | "error";
type QrCell = {
  row: number;
  col: number;
};
type BarcodeDetectorResult = {
  rawValue?: string;
};
type BarcodeDetectorInstance = {
  detect: (source: HTMLVideoElement) => Promise<BarcodeDetectorResult[]>;
};
type BarcodeDetectorConstructor = new (options?: { formats?: string[] }) => BarcodeDetectorInstance;
type JsQrDecoder = typeof import("jsqr").default;

declare global {
  interface Window {
    BarcodeDetector?: BarcodeDetectorConstructor;
  }
}

const CTA_ROUTE_BY_KIND: Record<string, ActionRoute> = {
  add_friend: "/app/contacts",
  open_referral: "/app/contacts",
  navigate: "/app/contacts",
  ask_assistant: "/app/ai",
};

const PANEL_TONE_CLASS: Record<ResolverState, string> = {
  idle: "border-white/8 bg-white/[0.02]",
  loading: "border-cyan-300/18 bg-cyan-300/[0.05]",
  error: "border-rose-300/18 bg-rose-300/[0.05]",
  invalid: "border-amber-300/18 bg-amber-300/[0.05]",
  success: "border-emerald-300/18 bg-emerald-300/[0.05]",
};

function formatDateTime(value: string | null) {
  if (!value) {
    return "Ожидает подтверждения";
  }

  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Не удалось получить данные. Попробуйте еще раз.";
}

function getCameraErrorMessage(error: unknown) {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError" || error.name === "SecurityError") {
      return "Доступ к камере запрещен. Разрешите камеру в браузере и попробуйте снова.";
    }
    if (error.name === "NotFoundError" || error.name === "OverconstrainedError") {
      return "Камера не найдена. Можно вставить данные QR вручную.";
    }
  }

  return "Не удалось открыть камеру. Можно вставить данные QR вручную.";
}

function formatSourceLabel(source: string) {
  if (source === "manual") {
    return "вручную";
  }
  if (source === "qr") {
    return "через QR";
  }
  if (source === "referral") {
    return "из рефералки";
  }
  return source;
}

function formatStatusLabel(status: string) {
  if (status === "accepted") {
    return "активно";
  }
  if (status === "pending") {
    return "ожидает";
  }
  return status;
}

function getRouteForKind(ctaKind: string): ActionRoute | null {
  return CTA_ROUTE_BY_KIND[ctaKind] ?? null;
}

function buildQrMatrix(value: string) {
  const qr = qrcode(0, "Q");
  qr.addData(value);
  qr.make();

  const moduleCount = qr.getModuleCount();
  const cells: QrCell[] = [];

  for (let row = 0; row < moduleCount; row += 1) {
    for (let col = 0; col < moduleCount; col += 1) {
      if (qr.isDark(row, col)) {
        cells.push({ row, col });
      }
    }
  }

  return { cells, moduleCount };
}

function QrPayloadImage({ value }: { value: string }) {
  const quietZone = 4;
  const { cells, moduleCount } = useMemo(() => buildQrMatrix(value), [value]);
  const viewBoxSize = moduleCount + quietZone * 2;

  return (
    <svg
      aria-label="QR для добавления контакта"
      className="h-auto w-full"
      role="img"
      shapeRendering="crispEdges"
      viewBox={`0 0 ${viewBoxSize} ${viewBoxSize}`}
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>QR для добавления контакта</title>
      <rect fill="#f8fafc" height={viewBoxSize} width={viewBoxSize} />
      <g fill="#101820">
        {cells.map((cell) => (
          <rect key={`${cell.row}-${cell.col}`} height="1" width="1" x={cell.col + quietZone} y={cell.row + quietZone} />
        ))}
      </g>
    </svg>
  );
}

function getResolverState(result: QrResolvedPayload | undefined, isPending: boolean, isError: boolean): ResolverState {
  if (isPending) {
    return "loading";
  }
  if (isError) {
    return "error";
  }
  if (!result) {
    return "idle";
  }
  return result.valid ? "success" : "invalid";
}

function getResolverHeading(state: ResolverState, result: QrResolvedPayload | undefined) {
  if (state === "loading") {
    return "Разбираем QR";
  }
  if (state === "error") {
    return "QR не удалось разобрать";
  }
  if (state === "invalid") {
    return result?.title || "QR не прошел проверку";
  }
  if (state === "success") {
    return result?.title || "QR распознан";
  }
  return "Здесь появится результат";
}

function getResolverDescription(state: ResolverState, result: QrResolvedPayload | undefined, errorMessage: string) {
  if (state === "loading") {
    return "Проверяем данные QR и выбираем следующий шаг.";
  }
  if (state === "error") {
    return errorMessage;
  }
  if (state === "invalid" || state === "success") {
    return result?.description ?? "Ответ получен без описания.";
  }
  return "Вставьте данные QR друга: после проверки можно сразу отправить приглашение.";
}

function FriendConnectionRow({
  entry,
  action,
  actionDisabled,
}: {
  entry: FriendEntry;
  action?: ReactNode;
  actionDisabled?: boolean;
}) {
  return (
    <div className={`list-row ${actionDisabled ? "opacity-80" : ""}`}>
      <div className="min-w-0">
        <p className="text-lg font-medium">{entry.display_name}</p>
        <p className="break-all text-sm text-white/55">
          ID: {entry.user_id} - {formatSourceLabel(entry.source)}
        </p>
      </div>
      <div className="flex flex-col items-start gap-3 text-left sm:flex-row sm:items-center sm:text-right">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-[0.22em] text-white/42">{formatStatusLabel(entry.status)}</p>
          <p className="text-sm text-white/55">{formatDateTime(entry.accepted_at ?? entry.created_at)}</p>
        </div>
        {action}
      </div>
    </div>
  );
}

export function ContactsPage() {
  const { userId, displayName } = useSessionStore();
  const queryClient = useQueryClient();
  const [inviteeId, setInviteeId] = useState("");
  const [payloadInput, setPayloadInput] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [scannerState, setScannerState] = useState<ScannerState>("idle");
  const [scannerMessage, setScannerMessage] = useState("Камера выключена");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const scannerCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const scannerStreamRef = useRef<MediaStream | null>(null);
  const scannerFrameRef = useRef<number | null>(null);
  const scannerSessionRef = useRef(0);
  const barcodeDetectorRef = useRef<BarcodeDetectorInstance | null>(null);
  const jsQrDecoderRef = useRef<JsQrDecoder | null>(null);
  const trimmedInviteeId = inviteeId.trim();
  const trimmedPayload = payloadInput.trim();

  const friendsQuery = useQuery({
    queryKey: ["friends", userId],
    queryFn: () => api.getFriends(userId),
    enabled: Boolean(userId),
  });
  const myQrQuery = useQuery({
    queryKey: ["my-qr", userId],
    queryFn: () => api.getMyQr(userId),
    enabled: Boolean(userId),
  });

  const inviteMutation = useMutation({
    mutationFn: ({ targetUserId, source }: InviteRequest) =>
      api.inviteToFriends({
        user_id: userId,
        target_user_id: targetUserId,
        source,
      }),
    onSuccess: (entry, variables) => {
      const channel = variables.source === "qr" ? "QR" : "user_id";
      setFeedback(`Инвайт через ${channel} отправлен для ${entry.display_name || variables.targetUserId}.`);
      if (variables.source === "manual") {
        setInviteeId("");
      }
      queryClient.invalidateQueries({ queryKey: ["friends", userId] });
      queryClient.invalidateQueries({ queryKey: ["assistant-context", userId] });
    },
    onError: (error) => {
      setFeedback(getErrorMessage(error));
    },
  });

  const acceptMutation = useMutation({
    mutationFn: (friendshipId: string) =>
      api.acceptFriendInvite({
        user_id: userId,
        friendship_id: friendshipId,
      }),
    onSuccess: (entry) => {
      setFeedback(`Связь с ${entry.display_name} подтверждена.`);
      queryClient.invalidateQueries({ queryKey: ["friends", userId] });
      queryClient.invalidateQueries({ queryKey: ["assistant-context", userId] });
    },
    onError: (error) => {
      setFeedback(getErrorMessage(error));
    },
  });

  const resolveMutation = useMutation({
    mutationFn: (payload: string) => api.resolveQr(userId, payload),
  });

  const friends = friendsQuery.data ?? EMPTY_FRIENDS;
  const acceptedCount = friends.accepted.length;
  const incomingCount = friends.pending_incoming.length;
  const outgoingCount = friends.pending_outgoing.length;
  const totalOpenInvites = incomingCount + outgoingCount;
  const qrTargetUserId = resolveMutation.data?.valid && resolveMutation.data.cta_kind === "add_friend" ? resolveMutation.data.cta_target?.trim() ?? "" : "";
  const resolverState = getResolverState(resolveMutation.data, resolveMutation.isPending, resolveMutation.isError);
  const resolverHeading = getResolverHeading(resolverState, resolveMutation.data);
  const resolverDescription = getResolverDescription(
    resolverState,
    resolveMutation.data,
    resolveMutation.error instanceof Error ? resolveMutation.error.message : "Не удалось получить ответ от QR.",
  );
  const primaryRoute = getRouteForKind(resolveMutation.data?.cta_kind ?? "");
  const canInviteManually = Boolean(trimmedInviteeId) && trimmedInviteeId !== userId && !inviteMutation.isPending;
  const canInviteFromQr = Boolean(qrTargetUserId) && qrTargetUserId !== userId && !inviteMutation.isPending;
  const inviteValidationMessage =
    trimmedInviteeId === userId ? "Нельзя пригласить собственный user_id." : "Введите user_id или используйте QR друга.";
  const showInitialLoading = (friendsQuery.isLoading && !friendsQuery.data) || (myQrQuery.isLoading && !myQrQuery.data);
  const hasNetworkError = friendsQuery.isError || myQrQuery.isError;
  const scannerIsRunning = scannerState === "starting" || scannerState === "active";

  const stopScanner = useCallback((nextState: ScannerState = "idle", nextMessage = "Камера выключена") => {
    scannerSessionRef.current += 1;

    if (scannerFrameRef.current !== null && typeof window !== "undefined") {
      window.cancelAnimationFrame(scannerFrameRef.current);
      scannerFrameRef.current = null;
    }

    if (scannerStreamRef.current) {
      scannerStreamRef.current.getTracks().forEach((track) => track.stop());
      scannerStreamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.srcObject = null;
    }

    barcodeDetectorRef.current = null;
    setScannerState(nextState);
    setScannerMessage(nextMessage);
  }, []);

  useEffect(() => () => stopScanner(), [stopScanner]);

  function handleResolveSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!trimmedPayload || resolveMutation.isPending) {
      return;
    }
    resolveMutation.mutate(trimmedPayload);
  }

  function handlePayloadChange(nextValue: string) {
    setPayloadInput(nextValue);
    if (resolveMutation.data || resolveMutation.isError) {
      resolveMutation.reset();
    }
  }

  const handleDetectedQr = useCallback(
    (rawValue: string) => {
      const cleanValue = rawValue.trim();
      if (!cleanValue) {
        return;
      }

      setPayloadInput(cleanValue);
      if (resolveMutation.data || resolveMutation.isError) {
        resolveMutation.reset();
      }
      resolveMutation.mutate(cleanValue);
    },
    [resolveMutation],
  );

  async function startScanner() {
    if (typeof window === "undefined") {
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      stopScanner("unsupported", "Сканер камеры недоступен в этом браузере. Вставьте данные QR вручную.");
      return;
    }

    const BarcodeDetector = window.BarcodeDetector;
    const sessionId = scannerSessionRef.current + 1;
    scannerSessionRef.current = sessionId;
    setScannerState("starting");
    setScannerMessage("Запрашиваем доступ к камере...");

    try {
      const detector = BarcodeDetector ? new BarcodeDetector({ formats: ["qr_code"] }) : null;
      const jsQrDecoder = jsQrDecoderRef.current ?? (await import("jsqr")).default;
      jsQrDecoderRef.current = jsQrDecoder;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
        },
      });

      if (scannerSessionRef.current !== sessionId) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      barcodeDetectorRef.current = detector;
      scannerStreamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      setScannerState("active");
      setScannerMessage("Наведите камеру на QR друга.");

      const scanFrame = async () => {
        if (scannerSessionRef.current !== sessionId) {
          return;
        }

        const video = videoRef.current;
        const activeDetector = barcodeDetectorRef.current;
        let rawValue = "";
        if (video && activeDetector && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
          try {
            const [barcode] = await activeDetector.detect(video);
            rawValue = barcode?.rawValue?.trim() ?? "";
          } catch {
            rawValue = "";
          }
        }

        if (!rawValue && video && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
          const canvas = scannerCanvasRef.current;
          const context = canvas?.getContext("2d", { willReadFrequently: true });
          const width = video.videoWidth;
          const height = video.videoHeight;
          if (canvas && context && width > 0 && height > 0) {
            canvas.width = width;
            canvas.height = height;
            context.drawImage(video, 0, 0, width, height);
            const imageData = context.getImageData(0, 0, width, height);
            rawValue = jsQrDecoderRef.current?.(imageData.data, width, height, { inversionAttempts: "attemptBoth" })?.data.trim() ?? "";
          }
        }

        if (rawValue) {
          stopScanner("detected", "QR найден, проверяем данные.");
          handleDetectedQr(rawValue);
          return;
        }

        if (scannerSessionRef.current === sessionId) {
          scannerFrameRef.current = window.requestAnimationFrame(scanFrame);
        }
      };

      scannerFrameRef.current = window.requestAnimationFrame(scanFrame);
    } catch (error) {
      stopScanner("error", getCameraErrorMessage(error));
    }
  }

  function handleInviteFromQr() {
    if (!canInviteFromQr) {
      return;
    }
    inviteMutation.mutate({ targetUserId: qrTargetUserId, source: "qr" });
  }

  return (
    <div className="space-y-6">
      <section className="hero-panel">
        <div className="grid gap-5 xl:grid-cols-[1.05fr_0.95fr] xl:items-end">
          <div className="space-y-3 md:space-y-4">
            <p className="eyebrow">Контакты</p>
            <h2 className="text-4xl font-semibold leading-[0.95] md:text-6xl">
              Друзья и QR теперь в одном месте: покажите свой код, добавьте человека по скану или отправьте инвайт вручную.
            </h2>
            <p className="max-w-3xl text-sm text-white/68 md:text-lg">
              {displayName} управляет своим QR, входящими запросами и текущим кругом друзей без перехода между вкладками.
            </p>
            <div className="min-h-[1.5rem] text-sm text-white/64" aria-live="polite">
              {feedback}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="metric-chip">
              <span>Друзья</span>
              <strong>{friendsQuery.isLoading && !friendsQuery.data ? "..." : acceptedCount}</strong>
            </div>
            <div className="metric-chip">
              <span>Инвайты</span>
              <strong>{friendsQuery.isLoading && !friendsQuery.data ? "..." : totalOpenInvites}</strong>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[0.92fr_1.08fr]">
        <article className="surface-panel">
          <div>
            <p className="eyebrow">Мой QR</p>
            <h3 className="mt-2 text-3xl font-semibold">Поделиться своим контактом</h3>
            <p className="mt-3 text-sm text-white/62">Покажите или отправьте эти данные, чтобы другой пользователь добавил вас в друзья.</p>
          </div>

          {myQrQuery.isPending ? (
            <div className="mt-6 list-row animate-pulse" aria-live="polite">
              <div>
                <p className="text-lg font-medium">Готовим персональный QR</p>
                <p className="text-sm text-white/55">Запрашиваем текущие данные контакта.</p>
              </div>
            </div>
          ) : null}

          {myQrQuery.isError ? (
            <div className="mt-6 rounded-[24px] border border-rose-300/18 bg-rose-300/[0.05] p-4 text-sm text-white/70" aria-live="polite">
              {getErrorMessage(myQrQuery.error)}
            </div>
          ) : null}

          {myQrQuery.data ? (
            <>
              <div className="mt-6 rounded-[28px] border border-white/8 bg-white/[0.02] p-5">
                <p className="eyebrow">{myQrQuery.data.resolved_type || "QR"}</p>
                <h4 className="mt-2 text-2xl font-semibold">{myQrQuery.data.title}</h4>
                <p className="mt-3 text-sm text-white/62">{myQrQuery.data.description}</p>
                <div className="mt-5 rounded-[24px] border border-white/8 bg-black/20 p-4">
                  <div className="mx-auto w-full max-w-[240px] rounded-[20px] bg-slate-50 p-3 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.08)]">
                    <QrPayloadImage value={myQrQuery.data.raw_payload} />
                  </div>
                </div>
              </div>

            </>
          ) : null}
        </article>

        <article className="surface-panel">
          <p className="eyebrow">Добавить через QR</p>
          <h3 className="mt-2 text-3xl font-semibold">Сканировать или вставить QR</h3>
          <p className="mt-3 max-w-2xl text-sm text-white/62">
            Сканируйте QR камерой или вставьте данные вручную. Если QR ведет на добавление в друзья, кнопка приглашения появится сразу после проверки.
          </p>

          <div className="mt-6 rounded-[28px] border border-white/8 bg-black/20 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="eyebrow">Сканировать камерой</p>
                <h4 className="mt-2 text-xl font-semibold">Навести камеру на QR</h4>
              </div>
              <button
                className={scannerIsRunning ? "secondary-button" : "primary-button"}
                type="button"
                onClick={() => {
                  if (scannerIsRunning) {
                    stopScanner();
                    return;
                  }
                  void startScanner();
                }}
              >
                {scannerIsRunning ? "Остановить сканер" : "Запустить сканер QR"}
              </button>
            </div>
            <div className="relative mt-4 aspect-[4/3] overflow-hidden rounded-[24px] border border-white/10 bg-slate-950">
              <video
                ref={videoRef}
                aria-label="Превью камеры для сканирования QR"
                className={`h-full w-full object-cover transition-opacity ${scannerState === "active" ? "opacity-100" : "opacity-25"}`}
                muted
                playsInline
              />
              <canvas ref={scannerCanvasRef} className="hidden" aria-hidden="true" />
              <div className="pointer-events-none absolute inset-6 rounded-[20px] border border-cyan-200/40 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]" />
              {scannerState !== "active" ? (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-5 text-center text-sm font-medium text-white/68">
                  {scannerMessage}
                </div>
              ) : null}
            </div>
            <p className="mt-3 min-h-[1.25rem] text-sm text-white/58" aria-live="polite">
              {scannerMessage}
            </p>
          </div>

          <form className="mt-4 space-y-4" onSubmit={handleResolveSubmit}>
            <label className="block">
              <span className="mb-2 block text-sm uppercase tracking-[0.2em] text-white/45">Данные QR</span>
              <textarea
                className="min-h-[170px] w-full rounded-[24px] border border-white/10 bg-black/20 px-4 py-4 text-sm leading-6 text-white outline-none transition focus:border-white/25"
                name="payload"
                rows={7}
                autoComplete="off"
                placeholder="Вставьте данные из QR друга"
                value={payloadInput}
                onChange={(event) => handlePayloadChange(event.target.value)}
              />
            </label>

            <div className="flex flex-wrap gap-3">
              <button className="primary-button" type="submit" disabled={!trimmedPayload || resolveMutation.isPending}>
                {resolveMutation.isPending ? "Проверяем..." : "Разобрать QR"}
              </button>
              <button className="secondary-button" type="button" onClick={() => handlePayloadChange("")} disabled={!payloadInput && !resolveMutation.data}>
                Очистить
              </button>
            </div>
          </form>

          <div className={`mt-5 rounded-[28px] border p-5 ${PANEL_TONE_CLASS[resolverState]}`} aria-live="polite">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="eyebrow">Результат QR</p>
                <h4 className="mt-2 text-2xl font-semibold">{resolverHeading}</h4>
              </div>
              <span className="text-xs uppercase tracking-[0.22em] text-white/45">{resolverState}</span>
            </div>
            <p className="mt-3 text-sm text-white/68">{resolverDescription}</p>
            <div className="mt-4 rounded-[22px] border border-white/8 bg-black/20 p-4 text-sm text-white/62">
              {resolveMutation.data
                ? "QR разобран. Ниже показаны только действие и цель без технической строки."
                : "После проверки здесь появится понятный результат без технической строки QR."}
            </div>

            {resolveMutation.data ? (
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <div className="metric-chip">
                  <span>Действие</span>
                  <strong>{getQrActionLabel(resolveMutation.data.cta_kind)}</strong>
                </div>
                <div className="metric-chip">
                  <span>Цель</span>
                  <strong className="break-all">{resolveMutation.data.cta_target || "Не передана"}</strong>
                </div>
              </div>
            ) : null}

            <div className="mt-5 flex flex-wrap gap-3">
              {qrTargetUserId ? (
                <button className="primary-button" type="button" disabled={!canInviteFromQr} onClick={handleInviteFromQr}>
                  {inviteMutation.isPending ? "Отправляем..." : "Добавить из QR"}
                </button>
              ) : null}
              {primaryRoute === "/app/ai" ? (
                <Link className="secondary-button" to="/app/ai">
                  Открыть AI
                </Link>
              ) : null}
            </div>
          </div>
        </article>
      </section>

      <section className="grid gap-4">
        <article className="surface-panel">
          <p className="eyebrow">Ручной инвайт</p>
          <h3 className="mt-2 text-3xl font-semibold">Добавить друга по user_id</h3>
          <p className="mt-3 text-sm text-white/62">Если QR сейчас не под рукой, отправьте запрос по идентификатору пользователя.</p>
          <label className="mt-5 block">
            <span className="mb-2 block text-sm uppercase tracking-[0.2em] text-white/45">ID пользователя</span>
            <input
              className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-4 text-white outline-none transition focus:border-white/25"
              name="targetUserId"
              autoComplete="off"
              placeholder="например, u_demo_friend"
              value={inviteeId}
              onChange={(event) => setInviteeId(event.target.value)}
            />
          </label>
          <div className="mt-3 text-sm text-white/58">{inviteValidationMessage}</div>
          <div className="mt-5 flex flex-wrap gap-3">
            <button
              className="primary-button"
              disabled={!canInviteManually}
              type="button"
              onClick={() => inviteMutation.mutate({ targetUserId: trimmedInviteeId, source: "manual" })}
            >
              {inviteMutation.isPending ? "Отправляем..." : "Отправить инвайт"}
            </button>
          </div>
          <div className="mt-4 min-h-[1.25rem] text-sm text-white/58" aria-live="polite">
            {inviteMutation.isError ? getErrorMessage(inviteMutation.error) : inviteMutation.isSuccess ? "Инвайт ушел в обработку." : null}
          </div>

          <div className="mt-7 grid gap-3 sm:grid-cols-2">
            <div className="metric-chip">
              <span>Исходящие</span>
              <strong>{friendsQuery.isLoading && !friendsQuery.data ? "..." : outgoingCount}</strong>
            </div>
            <div className="metric-chip">
              <span>Принятые связи</span>
              <strong>{friendsQuery.isLoading && !friendsQuery.data ? "..." : acceptedCount}</strong>
            </div>
          </div>
        </article>
      </section>

      <section>
        <article className="surface-panel">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="eyebrow">Активные друзья</p>
              <h3 className="text-2xl font-semibold">Текущий круг контактов</h3>
            </div>
            <span className="text-sm text-white/55">в сети: {friendsQuery.isLoading && !friendsQuery.data ? "..." : acceptedCount}</span>
          </div>

          {friendsQuery.isError ? (
            <div className="rounded-3xl border border-rose-300/20 bg-rose-300/10 px-4 py-4 text-sm text-rose-100">
              {getErrorMessage(friendsQuery.error)}
            </div>
          ) : acceptedCount ? (
            <div className="space-y-3">
              {friends.accepted.map((entry) => (
                <FriendConnectionRow key={entry.friendship_id} entry={entry} />
              ))}
            </div>
          ) : (
            <div className="list-row list-row--empty">
              <div>
                <p className="text-lg font-medium">Список друзей еще пуст</p>
                <p className="text-sm text-white/55">Отсканируйте QR или отправьте инвайт, чтобы начать.</p>
              </div>
            </div>
          )}
        </article>
      </section>

      {hasNetworkError ? (
        <section className="surface-panel">
          <p className="eyebrow">Состояние сети</p>
          <h3 className="mt-2 text-2xl font-semibold">Часть данных не синхронизировалась</h3>
          <p className="mt-3 max-w-2xl text-sm text-white/60">
            Контакты и QR загружаются отдельно, поэтому экран остается рабочим даже при частичном сбое.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <button
              className="primary-button"
              type="button"
              onClick={() => {
                void friendsQuery.refetch();
                void myQrQuery.refetch();
              }}
            >
              Повторить загрузку
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
