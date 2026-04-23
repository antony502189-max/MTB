import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) => {
    if (queryKey[0] === "friends") {
      return {
        data: {
          accepted: [],
          pending_incoming: [],
          pending_outgoing: [],
        },
        isLoading: false,
        isPending: false,
        isFetching: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
      };
    }

    if (queryKey[0] === "friend-activity") {
      return {
        data: [],
        isLoading: false,
        isPending: false,
        isFetching: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
      };
    }

    if (queryKey[0] === "my-qr") {
      return {
        data: {
          valid: true,
          resolved_type: "friend_invite",
          title: "Добавить контакт",
          description: "Покажите этот QR, чтобы вас добавили в контакты.",
          cta_kind: "add_friend",
          cta_target: "u_demo",
          raw_payload: "mtb://qr?action=add_friend&target=u_demo",
        },
        isLoading: false,
        isPending: false,
        isFetching: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
      };
    }

    return {
      data: undefined,
      isLoading: false,
      isPending: false,
      isFetching: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    };
  },
  useMutation: () => ({
    data: undefined,
    isPending: false,
    isError: false,
    isSuccess: false,
    error: null,
    variables: undefined,
    mutate: vi.fn(),
    reset: vi.fn(),
  }),
  useQueryClient: () => ({
    invalidateQueries: vi.fn(),
  }),
}));

import { ContactsPage } from "@/pages/ContactsPage";

function renderContactsPage() {
  return renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: ["/app/contacts"] }, createElement(ContactsPage)));
}

describe("ContactsPage", () => {
  it("combines own QR, QR scan input, and friend invite actions on one screen", () => {
    const html = renderContactsPage();

    expect(html).toContain("Контакты");
    expect(html).toContain("Мой QR");
    expect(html).toContain("Сканировать или вставить QR");
    expect(html).toContain("Сканировать камерой");
    expect(html).toContain("Добавить друга по user_id");
  });

  it("renders the camera scanner controls and preview container", () => {
    const html = renderContactsPage();

    expect(html).toContain("Запустить сканер QR");
    expect(html).toContain('aria-label="Превью камеры для сканирования QR"');
    expect(html).toContain("Камера выключена");
  });

  it("renders the own QR payload as a visible QR image", () => {
    const html = renderContactsPage();

    expect(html).toContain('aria-label="QR для добавления контакта"');
    expect(html).toContain("<svg");
  });

  it("does not render raw QR payload text on the page", () => {
    const html = renderContactsPage();

    expect(html).not.toContain("Данные для вставки");
    expect(html).not.toContain("mtb://qr?action=add_friend");
  });

  it("does not render the own QR autofill action", () => {
    const html = renderContactsPage();

    expect(html).not.toContain("Подставить мой QR");
  });

  it("does not render the incoming confirmations and outgoing invites panels", () => {
    const html = renderContactsPage();

    expect(html).not.toContain("Входящие подтверждения");
    expect(html).not.toContain("Запросы, которые ждут решения");
    expect(html).not.toContain("Пока нет входящих инвайтов");
    expect(html).not.toContain("Исходящие инвайты");
    expect(html).not.toContain("Нет исходящих запросов");
  });

  it("does not render own QR action metadata cards", () => {
    const html = renderContactsPage();

    expect(html).not.toContain("Кому ведет");
    expect(html).not.toContain("Добавить в друзья");
  });

  it("does not expose the old standalone friends and QR module labels", () => {
    const html = renderContactsPage();

    expect(html).not.toContain("Friends MVP");
    expect(html).not.toContain("QR MVP");
  });

  it("does not render the friend social activity feed", () => {
    const html = renderContactsPage();

    expect(html).not.toContain("Социальная активность");
    expect(html).not.toContain("Последние события по друзьям");
    expect(html).not.toContain("Лента пока пустая");
  });
});
