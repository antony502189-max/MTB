import { useMutation, useQuery } from "@tanstack/react-query";
import type { AssistantChatResponse, AssistantContext } from "@mtb/contracts";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { useSessionStore } from "@/lib/session-store";

type ChatRole = "user" | "assistant";

type HistoryMessage = {
  id: string;
  role: ChatRole;
  message: string;
  createdAt: string;
  qrPayload: string | null;
  suggestedActions: string[];
  relatedModules: string[];
  contextChips: string[];
};

const EMPTY_CONTEXT: AssistantContext = {
  user_id: "",
  recommended_focus: "",
  quick_prompts: [],
  summary_chips: [],
  friend_count: 0,
  pending_invites_count: 0,
};

const MAX_HISTORY_ITEMS = 18;

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => asNonEmptyString(entry))
    .filter((entry): entry is string => entry !== null);
}

function isSystemToken(value: string): boolean {
  return /^[A-Z0-9]+(?:_[A-Z0-9]+)+$/.test(value);
}

function isHiddenAiChip(value: string): boolean {
  return value.trim().toUpperCase() === "CREDIT_SHIELD";
}

export function sanitizeDisplayTokens(values: string[]): string[] {
  return values.filter((value) => !isSystemToken(value) && !isHiddenAiChip(value));
}

function normalizeAssistantContext(value: AssistantContext | null | undefined, userId: string, segment: string): AssistantContext {
  const fallbackPrompts =
    segment === "freelancer"
      ? [
          "Какие действия дадут быстрый прирост прогресса на этой неделе?",
          "Помоги разобрать активность по друзьям и QR-сценариям.",
          "С чего лучше начать, если хочу усилить Orbit и Social одновременно?",
        ]
      : segment === "first-jobber"
        ? [
            "Подскажи короткий план роста через задания и партнерские покупки.",
            "Какие следующие шаги помогут удержать темп в квестах?",
            "Как использовать друзей и QR без лишних действий?",
          ]
        : [
            "С чего начать, чтобы быстро почувствовать прогресс в приложении?",
            "Какие действия сейчас самые выгодные для моего профиля?",
            "Собери маршрут из друзей, QR и квестов на один день.",
          ];

  const recommendedFocus =
    asNonEmptyString(value?.recommended_focus) ??
    (segment === "freelancer"
      ? "Свести воедино социальный контур, QR-точки и быстрые квесты."
      : segment === "first-jobber"
        ? "Удерживать ровный ритм заданий, чтобы AI подсказывал следующий лучший шаг."
        : "Начать с самых понятных действий и быстро собрать первую серию полезных сигналов.");

  const summaryChips = sanitizeDisplayTokens(asStringArray(value?.summary_chips));
  const quickPrompts = asStringArray(value?.quick_prompts);

  return {
    user_id: asNonEmptyString(value?.user_id) ?? userId,
    recommended_focus: recommendedFocus,
    quick_prompts: quickPrompts.length > 0 ? quickPrompts : fallbackPrompts,
    summary_chips:
      summaryChips.length > 0
        ? summaryChips
        : [
            segment === "freelancer" ? "Гибкий ритм" : segment === "first-jobber" ? "Карьерный темп" : "Режим старта",
            "AI-навигация",
          ],
    friend_count: typeof value?.friend_count === "number" ? value.friend_count : 0,
    pending_invites_count: typeof value?.pending_invites_count === "number" ? value.pending_invites_count : 0,
  };
}

function normalizeAssistantReply(value: AssistantChatResponse): Omit<HistoryMessage, "id" | "role" | "createdAt" | "qrPayload"> {
  return {
    message: asNonEmptyString(value?.message) ?? "Ответ получен, но сервер не прислал текст. Попробуйте уточнить запрос.",
    suggestedActions: asStringArray(value?.suggested_actions),
    relatedModules: sanitizeDisplayTokens(asStringArray(value?.related_modules)),
    contextChips: sanitizeDisplayTokens(asStringArray(value?.context_chips)),
  };
}

function buildHistoryMessage(
  role: ChatRole,
  message: string,
  options?: Partial<Pick<HistoryMessage, "qrPayload" | "suggestedActions" | "relatedModules" | "contextChips">>,
): HistoryMessage {
  return {
    id: `${role}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    role,
    message,
    createdAt: new Date().toISOString(),
    qrPayload: options?.qrPayload ?? null,
    suggestedActions: options?.suggestedActions ?? [],
    relatedModules: options?.relatedModules ?? [],
    contextChips: options?.contextChips ?? [],
  };
}

function readHistory(storageKey: string): HistoryMessage[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((entry): HistoryMessage | null => {
        if (!entry || typeof entry !== "object") {
          return null;
        }

        const candidate = entry as Record<string, unknown>;
        const role = candidate.role === "user" || candidate.role === "assistant" ? candidate.role : null;
        const message = asNonEmptyString(candidate.message);
        const createdAt = asNonEmptyString(candidate.createdAt) ?? new Date().toISOString();

        if (!role || !message) {
          return null;
        }

        return {
          id: asNonEmptyString(candidate.id) ?? `${role}_${createdAt}`,
          role,
          message,
          createdAt,
          qrPayload: asNonEmptyString(candidate.qrPayload),
          suggestedActions: asStringArray(candidate.suggestedActions),
          relatedModules: sanitizeDisplayTokens(asStringArray(candidate.relatedModules)),
          contextChips: sanitizeDisplayTokens(asStringArray(candidate.contextChips)),
        };
      })
      .filter((entry): entry is HistoryMessage => entry !== null)
      .slice(-MAX_HISTORY_ITEMS);
  } catch {
    return [];
  }
}

function getStorageKey(userId: string) {
  return `mtb.ai.history.${userId}`;
}

function formatMessageTime(value: string) {
  try {
    return new Intl.DateTimeFormat("ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return "";
  }
}

function getModuleLink(moduleName: string): { label: string; to: string } | null {
  const token = moduleName.toLowerCase();

  if (token.includes("friend") || token.includes("social")) {
    return { label: "Контакты", to: "/app/contacts" };
  }
  if (token.includes("qr")) {
    return { label: "Контакты", to: "/app/contacts" };
  }
  if (token.includes("quest")) {
    return { label: "Квесты", to: "/app/quests" };
  }
  if (token.includes("reward")) {
    return { label: "Награды", to: "/app/rewards" };
  }
  if (token.includes("referral")) {
    return { label: "Рефералы", to: "/app/referrals" };
  }
  if (token.includes("game")) {
    return { label: "Игры", to: "/app/games" };
  }
  if (token.includes("planet") || token.includes("galaxy")) {
    return { label: "Галактика", to: "/app/galaxy" };
  }

  return null;
}

export function AiPage() {
  const { userId, displayName, segment } = useSessionStore();
  const storageKey = getStorageKey(userId);
  const [prompt, setPrompt] = useState("");
  const [qrPayload, setQrPayload] = useState("");
  const [history, setHistory] = useState<HistoryMessage[]>([]);
  const [chatError, setChatError] = useState<string | null>(null);
  const timelineEndRef = useRef<HTMLDivElement | null>(null);
  const hydratedStorageKeyRef = useRef<string | null>(null);

  const assistantContextQuery = useQuery({
    queryKey: ["assistant-context", userId, segment],
    queryFn: () => api.getAssistantContext(userId),
    enabled: Boolean(userId),
    staleTime: 60_000,
    select: (value) => normalizeAssistantContext(value, userId, segment),
  });

  const assistantContext = normalizeAssistantContext(assistantContextQuery.data ?? EMPTY_CONTEXT, userId, segment);

  useEffect(() => {
    setHistory(readHistory(storageKey));
    hydratedStorageKeyRef.current = storageKey;
  }, [storageKey]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (hydratedStorageKeyRef.current !== storageKey) {
      return;
    }

    try {
      window.localStorage.setItem(storageKey, JSON.stringify(history.slice(-MAX_HISTORY_ITEMS)));
    } catch {
      // Keep history in memory if localStorage is unavailable.
    }
  }, [history, storageKey]);

  useEffect(() => {
    timelineEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [history, assistantContextQuery.isFetching]);

  const chatMutation = useMutation({
    mutationFn: async ({ message, qr }: { message: string; qr: string | null }) =>
      api.assistantChat({
        user_id: userId,
        message,
        qr_payload: qr,
      }),
    onSuccess: (response) => {
      setChatError(null);
      const reply = normalizeAssistantReply(response);
      setHistory((current) => [
        ...current.slice(-(MAX_HISTORY_ITEMS - 1)),
        buildHistoryMessage("assistant", reply.message, {
          suggestedActions: reply.suggestedActions,
          relatedModules: reply.relatedModules,
          contextChips: reply.contextChips,
        }),
      ]);
    },
    onError: () => {
      setChatError("Не удалось связаться с AI-ассистентом. Проверьте API и попробуйте еще раз.");
    },
  });

  function submitPrompt(message: string, qr: string | null) {
    const cleanMessage = message.trim();
    const cleanQr = qr && qr.trim().length > 0 ? qr.trim() : null;

    if (!cleanMessage || chatMutation.isPending) {
      return;
    }

    setChatError(null);
    setHistory((current) => [
      ...current.slice(-(MAX_HISTORY_ITEMS - 1)),
      buildHistoryMessage("user", cleanMessage, { qrPayload: cleanQr }),
    ]);
    setPrompt("");
    setQrPayload("");
    chatMutation.mutate({ message: cleanMessage, qr: cleanQr });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    submitPrompt(prompt, qrPayload);
  }

  const activePromptCount = assistantContext.quick_prompts.length;
  const pendingAssistantState = chatMutation.isPending ? chatMutation.variables : null;

  return (
    <div className="space-y-6">
      <section className="hero-panel">
        <div className="space-y-3 md:space-y-4">
            <p className="eyebrow">AI-навигатор</p>
            <h2 className="text-4xl font-semibold leading-[0.95] md:text-6xl">
              {displayName}, AI собирает следующий лучший шаг из контекста, друзей и QR-сценариев.
            </h2>
            <div className="flex flex-wrap gap-2 pt-1">
              {assistantContext.summary_chips.map((chip) => (
                <span
                  key={chip}
                  className="inline-flex rounded-full border border-white/10 bg-white/6 px-3 py-2 text-xs uppercase tracking-[0.18em] text-white/64"
                >
                  {chip}
                </span>
              ))}
            </div>
            <p className="max-w-3xl text-sm text-white/68 md:text-lg">{assistantContext.recommended_focus}</p>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.12fr_0.88fr]">
        <article className="order-2 flex min-h-[560px] min-w-0 flex-col surface-panel xl:order-1 xl:min-h-[720px]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="eyebrow">Диалог</p>
              <h3 className="mt-2 text-2xl font-semibold">Локальная AI-история</h3>
            </div>
            <div className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs uppercase tracking-[0.18em] text-white/60">
              {segment === "freelancer" ? "Freelancer" : segment === "first-jobber" ? "First jobber" : "Student"} profile
            </div>
          </div>

          <form className="mt-6 space-y-4 border-t border-white/8 pt-5" onSubmit={handleSubmit}>
            <div className="grid gap-4 xl:grid-cols-[1fr_0.42fr]">
              <label className="block min-w-0">
                <span className="mb-2 block text-sm uppercase tracking-[0.2em] text-white/45">Запрос для ассистента</span>
                <textarea
                  className="min-h-[132px] w-full resize-y rounded-[24px] border border-white/10 bg-black/20 px-4 py-4 text-sm text-white outline-none transition focus:border-white/20"
                  name="assistantPrompt"
                  placeholder="Например: собери следующий лучший шаг для роста через квесты, друзей и QR."
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                />
              </label>

              <div className="space-y-4">
                <label className="block min-w-0">
                  <span className="mb-2 block text-sm uppercase tracking-[0.2em] text-white/45">QR payload</span>
                  <textarea
                    className="min-h-[132px] w-full resize-y rounded-[24px] border border-white/10 bg-black/20 px-4 py-4 text-sm text-white outline-none transition focus:border-white/20"
                    name="qrPayload"
                    placeholder="Опционально: вставьте payload из QR-потока."
                    value={qrPayload}
                    onChange={(event) => setQrPayload(event.target.value)}
                  />
                </label>
              </div>
            </div>

            {chatError ? (
              <div className="rounded-[22px] border border-rose-400/25 bg-rose-500/10 px-4 py-4 text-sm text-rose-100">
                {chatError}
              </div>
            ) : null}

            <div className="flex flex-wrap items-center justify-end gap-3">
              <button className="primary-button" disabled={chatMutation.isPending || prompt.trim().length === 0} type="submit">
                {chatMutation.isPending ? "Отправляем…" : "Спросить AI"}
              </button>
            </div>
          </form>

          <div className="mt-6 flex-1 space-y-4 overflow-x-hidden overflow-y-auto pr-1">
            {assistantContextQuery.isLoading ? (
              <div className="list-row list-row--empty">
                <div>
                  <p className="text-sm text-white/72">Собираем контекст пользователя…</p>
                  <p className="mt-1 text-sm text-white/50">AI готовит быстрые подсказки и стартовую сводку.</p>
                </div>
              </div>
            ) : null}

            {assistantContextQuery.isError ? (
              <div className="rounded-[22px] border border-rose-400/25 bg-rose-500/10 px-4 py-4 text-sm text-rose-100">
                Не удалось загрузить контекст ассистента. Чат все еще доступен, но ответы будут беднее без сводки.
              </div>
            ) : null}

            {history.map((entry) => {
              const isAssistant = entry.role === "assistant";

              return (
                <div
                  key={entry.id}
                  className={`rounded-[28px] border px-5 py-4 ${
                    isAssistant
                      ? "border-white/10 bg-white/[0.035]"
                      : "ml-auto max-w-full border-cyan-400/20 bg-cyan-400/10 sm:max-w-[92%]"
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs uppercase tracking-[0.18em] text-white/48">
                      {isAssistant ? "AI-ассистент" : displayName}
                    </p>
                    <span className="text-xs text-white/38">{formatMessageTime(entry.createdAt)}</span>
                  </div>
                  <p className="mt-3 break-words whitespace-pre-wrap text-sm leading-6 text-white/80">{entry.message}</p>

                  {entry.qrPayload ? (
                    <div className="mt-4 rounded-2xl border border-white/10 bg-black/15 px-3 py-3 text-xs text-white/58">
                      QR payload: <span className="break-all text-white/82">{entry.qrPayload}</span>
                    </div>
                  ) : null}

                  {entry.contextChips.length > 0 ? (
                    <div className="mt-4 flex flex-wrap gap-2">
                      {entry.contextChips.map((chip) => (
                        <span
                          key={`${entry.id}_${chip}`}
                          className="inline-flex rounded-full border border-white/10 bg-white/6 px-3 py-2 text-[11px] uppercase tracking-[0.16em] text-white/62"
                        >
                          {chip}
                        </span>
                      ))}
                    </div>
                  ) : null}

                  {entry.suggestedActions.length > 0 ? (
                    <div className="mt-5">
                      <p className="text-xs uppercase tracking-[0.18em] text-white/45">Suggested actions</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {entry.suggestedActions.map((action) => (
                          <button
                            key={`${entry.id}_${action}`}
                            type="button"
                            className="secondary-button break-words px-4 py-2 text-left text-sm"
                            onClick={() => setPrompt(action)}
                          >
                            {action}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {(() => {
                    const relatedLinks = entry.relatedModules
                      .map((moduleName) => ({ moduleName, moduleLink: getModuleLink(moduleName) }))
                      .filter(
                        (entry): entry is { moduleName: string; moduleLink: { label: string; to: string } } =>
                          entry.moduleLink !== null,
                      );

                    if (relatedLinks.length === 0) {
                      return null;
                    }

                    return (
                      <div className="mt-5">
                        <p className="text-xs uppercase tracking-[0.18em] text-white/45">Related modules</p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {relatedLinks.map(({ moduleName, moduleLink }) => (
                            <Link
                              key={`${entry.id}_${moduleName}`}
                              className="inline-flex break-all rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs uppercase tracking-[0.14em] text-white/70 transition hover:border-white/20 hover:bg-white/10"
                              to={moduleLink.to}
                            >
                              {moduleLink.label}
                            </Link>
                          ))}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              );
            })}

            {pendingAssistantState ? (
              <div className="rounded-[28px] border border-white/10 bg-white/[0.035] px-5 py-4">
                <p className="text-xs uppercase tracking-[0.18em] text-white/48">AI-ассистент</p>
                <p className="mt-3 text-sm leading-6 text-white/72">
                  Анализируем запрос
                  {pendingAssistantState.qr ? " вместе с QR payload" : ""}
                  …
                </p>
              </div>
            ) : null}

            <div ref={timelineEndRef} />
          </div>
        </article>

        <div className="order-1 space-y-4 xl:order-2">
          <article className="surface-panel">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="eyebrow">Quick prompts</p>
                <h3 className="mt-2 text-2xl font-semibold">Стартовые вопросы</h3>
              </div>
              <span className="text-xs uppercase tracking-[0.18em] text-white/45">{activePromptCount} ready</span>
            </div>
            <div className="mt-5 space-y-3">
              {assistantContext.quick_prompts.map((quickPrompt) => (
                <button
                  key={quickPrompt}
                  type="button"
                  className="list-row w-full text-left transition hover:border-white/15 hover:bg-white/5"
                  onClick={() => submitPrompt(quickPrompt, qrPayload)}
                >
                  <span className="max-w-[90%] text-sm leading-6 text-white/76">{quickPrompt}</span>
                  <strong className="text-xl text-white/46">+</strong>
                </button>
              ))}
            </div>
          </article>
        </div>
      </section>
    </div>
  );
}
