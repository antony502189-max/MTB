import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { formatCategory, formatRewardType, formatStatus } from "@/lib/labels";
import { useSessionStore } from "@/lib/session-store";

function formatWindowEnd(value: string) {
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

export function LiveLinksPage() {
  const { userId, displayName } = useSessionStore();
  const profileQuery = useQuery({
    queryKey: ["profile", userId],
    queryFn: () => api.getProfile(userId),
    enabled: Boolean(userId),
  });
  const ledgerQuery = useQuery({
    queryKey: ["ledger", userId],
    queryFn: () => api.getRewardLedger(userId),
    enabled: Boolean(userId),
  });

  const liveBoosters = profileQuery.data?.active_boosters ?? [];
  const liveLedger = ledgerQuery.data ?? [];
  const pendingLedgerCount = liveLedger.filter((entry) => entry.status === "pending").length;
  const hasNetworkError = profileQuery.isError || ledgerQuery.isError;

  return (
    <div className="space-y-6">
      <section className="hero-panel">
        <div className="grid gap-5 xl:grid-cols-[1.04fr_0.96fr] xl:items-end">
          <div className="space-y-3 md:space-y-4">
            <p className="eyebrow">Живые связи</p>
            <h2 className="text-4xl font-semibold leading-[0.98] md:text-6xl">
              Бустеры и журнал активности показывают текущие связи игрового прогресса.
            </h2>
            <p className="max-w-3xl text-sm text-white/68 md:text-lg">
              {displayName} видит активные окна усилений, последние записи наград и статус синхронизации.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="metric-chip">
              <span>Активные бустеры</span>
              <strong>{profileQuery.isLoading && !profileQuery.data ? "..." : liveBoosters.length}</strong>
            </div>
            <div className="metric-chip">
              <span>Записи журнала</span>
              <strong>{ledgerQuery.isLoading && !ledgerQuery.data ? "..." : liveLedger.length}</strong>
            </div>
            <div className="metric-chip">
              <span>На проверке</span>
              <strong>{ledgerQuery.isLoading && !ledgerQuery.data ? "..." : pendingLedgerCount}</strong>
            </div>
            <div className="metric-chip">
              <span>Состояние</span>
              <strong>{hasNetworkError ? "Сбой" : "Онлайн"}</strong>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
        <article className="surface-panel">
          <div className="mb-5 flex min-h-[3.25rem] items-center">
            <div>
              <p className="eyebrow">Активные окна бустеров</p>
              <h3 className="text-2xl font-semibold">Текущие усиления</h3>
            </div>
          </div>

          {profileQuery.isError ? (
            <div className="rounded-3xl border border-rose-300/20 bg-rose-300/10 px-4 py-4 text-sm text-rose-100">
              {getErrorMessage(profileQuery.error)}
            </div>
          ) : profileQuery.isLoading && !profileQuery.data ? (
            <p className="text-sm text-white/60">Подтягиваем активные окна...</p>
          ) : liveBoosters.length ? (
            <div className="space-y-3">
              {liveBoosters.map((booster) => (
                <div key={booster.booster_id} className="list-row">
                  <div>
                    <p className="text-lg font-medium">{formatCategory(booster.category)}</p>
                    <p className="text-sm text-white/55">До {formatWindowEnd(booster.end_at)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs uppercase tracking-[0.2em] text-white/42">{formatStatus(booster.status)}</p>
                    <strong className="text-2xl text-[var(--accent-cyan)]">+{booster.boost_rate}%</strong>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="list-row list-row--empty">
              <div>
                <p className="text-lg font-medium">Окно бустера</p>
                <p className="text-sm text-white/55">Запустите партнерский сигнал, чтобы открыть первое окно.</p>
              </div>
              <strong className="status-pill">ожидает</strong>
            </div>
          )}
        </article>

        <article className="surface-panel">
          <div className="mb-5 flex min-h-[3.25rem] items-center justify-between gap-3">
            <div>
              <p className="eyebrow">Последние записи</p>
              <h3 className="text-2xl font-semibold">Журнал активности</h3>
            </div>
            <span className="text-sm text-white/55">{ledgerQuery.isLoading && !ledgerQuery.data ? "..." : liveLedger.length}</span>
          </div>

          {ledgerQuery.isError ? (
            <div className="rounded-3xl border border-rose-300/20 bg-rose-300/10 px-4 py-4 text-sm text-rose-100">
              {getErrorMessage(ledgerQuery.error)}
            </div>
          ) : ledgerQuery.isLoading && !ledgerQuery.data ? (
            <p className="text-sm text-white/60">Собираем последние записи...</p>
          ) : liveLedger.length ? (
            <div className="space-y-3">
              {liveLedger.slice(0, 8).map((entry) => (
                <div key={entry.ledger_id} className="list-row">
                  <div>
                    <p className="text-lg font-medium">{formatRewardType(entry.reward_type)}</p>
                    <p className="text-sm text-white/55">{new Date(entry.created_at).toLocaleString("ru-RU")}</p>
                  </div>
                  <div className="text-right">
                    <p className={`text-xs uppercase tracking-[0.18em] ${entry.status === "pending" ? "text-amber-300" : "text-emerald-300"}`}>
                      {formatStatus(entry.status)}
                    </p>
                    <strong className="text-2xl">{entry.amount}</strong>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="list-row list-row--empty">
              <div>
                <p className="text-lg font-medium">Журнал активности</p>
                <p className="text-sm text-white/55">Обновится после первого синхронизированного события.</p>
              </div>
              <strong className="status-pill">ожидает</strong>
            </div>
          )}
        </article>
      </section>

      {hasNetworkError ? (
        <section className="surface-panel">
          <p className="eyebrow">Состояние сети</p>
          <h3 className="mt-2 text-2xl font-semibold">Часть данных не синхронизировалась</h3>
          <p className="mt-3 max-w-2xl text-sm text-white/60">
            Бустеры и журнал загружаются отдельно, поэтому вкладка остается рабочей даже при частичном сбое.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <button
              className="primary-button"
              type="button"
              onClick={() => {
                void profileQuery.refetch();
                void ledgerQuery.refetch();
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
