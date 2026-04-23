import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: string[]; select?: (value: unknown) => unknown }) => {
    if (queryKey[0] === "assistant-context") {
      return {
        data: {
          user_id: "u_demo",
          recommended_focus: "Соберите следующий шаг из друзей и контекста.",
          quick_prompts: ["С чего начать?"],
          summary_chips: ["AI-навигация", "CREDIT_SHIELD"],
          friend_count: 0,
          pending_invites_count: 0,
        },
        isLoading: false,
        isFetching: false,
        isError: false,
        error: null,
      };
    }

    return {
      data: undefined,
      isLoading: false,
      isFetching: false,
      isError: false,
      error: null,
    };
  },
  useMutation: () => ({
    isPending: false,
    error: null,
    variables: undefined,
    mutate: vi.fn(),
  }),
}));

import { AiPage, sanitizeDisplayTokens } from "@/pages/AiPage";

function renderAiPage() {
  return renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: ["/app/ai"] }, createElement(AiPage)));
}

describe("AiPage", () => {
  it("does not render the hero QR shortcut button", () => {
    const html = renderAiPage();

    expect(html).not.toContain("Проверить QR");
  });

  it("does not render the contacts hero CTA button", () => {
    const html = renderAiPage();

    expect(html).not.toContain("Открыть контакты");
  });

  it("does not render the hero metric cards", () => {
    const html = renderAiPage();

    expect(html).not.toContain("Быстрые подсказки");
    expect(html).not.toContain("Локальная история");
    expect(html).not.toContain("Друзья в контексте");
    expect(html).not.toContain("Новые инвайты");
  });

  it("does not render the AI summary context panel", () => {
    const html = renderAiPage();

    expect(html).not.toContain("Контекст");
    expect(html).not.toContain("Сводка для AI");
    expect(html).not.toContain("Рекомендуемый фокус");
    expect(html).not.toContain("Социальный слой");
    expect(html).not.toContain("Ожидают внимания");
  });

  it("does not render the CTA panel with friends and QR links", () => {
    const html = renderAiPage();

    expect(html).not.toContain("CTA");
    expect(html).not.toContain("Подключить внешние сигналы");
    expect(html).not.toContain("QR-модуль");
  });

  it("does not render the active answer panel", () => {
    const html = renderAiPage();

    expect(html).not.toContain("Активный ответ");
    expect(html).not.toContain("Что сейчас держать в фокусе");
  });

  it("filters raw system tokens from AI labels", () => {
    expect(sanitizeDisplayTokens(["AI-навигация", "CREDIT_SHIELD", "SOCIAL_RING", "QR"])).toEqual(["AI-навигация", "QR"]);
  });

  it("does not render raw system chips from assistant context", () => {
    const html = renderAiPage();

    expect(html).toContain("AI-навигация");
    expect(html).not.toContain("CREDIT_SHIELD");
  });
});
