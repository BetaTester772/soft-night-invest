import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { boothIdentityStore, boothTokenStore, tokenStore } from "../../api/storage";
import { BoothApp } from "../BoothApp";
import { boothState, config } from "./fixtures";

let data = boothState();
let rejection = false;
beforeEach(() => {
  localStorage.clear();
  tokenStore.set(null);
  boothTokenStore.set(null);
  data = boothState();
  rejection = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      if (input.includes("/event")) return new Response(JSON.stringify({ signup: {} }));
      if (input.includes("/orders")) {
        if (rejection)
          return new Response(
            JSON.stringify({
              detail: {
                code: "INSUFFICIENT_CASH",
                message: "현금 잔고가 부족합니다.",
              },
            }),
            { status: 409 },
          );
        const body = JSON.parse(String(init?.body));
        data.me!.cash = 900000;
        data.me!.fund_value = 100000;
        data.me!.funds = [
          {
            code: "HERB",
            name: "초식이의 분산 펀드",
            units: 100000000,
            cost: 100000,
            nav: 1000,
            value: 100000,
            profit: 0,
          },
        ];
        return new Response(
          JSON.stringify({ order: { id: 1, kind: body.kind }, me: data.me }),
          { status: 201 },
        );
      }
      return new Response(JSON.stringify(data), { status: 200 });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());
function page(path = "/") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <BoothApp config={config} />
    </MemoryRouter>,
  );
}

it("requires the full registration form for first participation", async () => {
  data = boothState(false);
  page();
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "참가하기" }));
  expect(await screen.findByRole("textbox", { name: "학번" })).toBeInTheDocument();
  expect(screen.getAllByLabelText(/비밀번호/)).toHaveLength(2);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(localStorage.getItem("dino.booth.token")).toBeNull();
  expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes("/booth/join"))).toBe(false);
});

it("subscribes to a fund and renders the updated server cash", async () => {
  page("/funds");
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: "이 펀드에 투자하기" }),
  );
  const dialog = screen.getByRole("dialog");
  await user.clear(
    within(dialog).getByRole("textbox", { name: /투자할 금액/ }),
  );
  await user.type(
    within(dialog).getByRole("textbox", { name: /투자할 금액/ }),
    "100000",
  );
  await user.click(
    within(dialog).getByRole("button", { name: "펀드 매수하기" }),
  );
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  await user.click(screen.getByRole("link", { name: "내 자산" }));
  expect((await screen.findAllByText("900,000원")).length).toBeGreaterThan(0);
  expect(screen.getAllByText("100,000원").length).toBeGreaterThan(0);
});

it("shows a server order rejection without closing the form", async () => {
  rejection = true;
  page("/funds");
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: "이 펀드에 투자하기" }),
  );
  await user.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: "펀드 매수하기",
    }),
  );
  expect(
    await screen.findByText("현금 잔고가 부족합니다."),
  ).toBeInTheDocument();
  expect(screen.getByRole("dialog")).toBeInTheDocument();
});

it("disables stock orders during a break", async () => {
  data.round.is_open = false;
  data.round.state = "closed";
  page();
  expect(
    await screen.findByRole("button", { name: "주식 매매" }),
  ).toBeDisabled();
});

it.each([null, "nickname-only"])("connects an explicit login to its own booth account with previous token %s", async (previousToken) => {
  boothTokenStore.set(previousToken);
  data = boothState(false);
  const participant = { id: 42, nickname: "김공룡", status: "normal" };
  const fetcher = vi.fn(async (input: string, init?: RequestInit) => {
    if (input.includes("/auth/login")) {
      expect(JSON.parse(String(init?.body))).toEqual({ identity: "2026310000", password: "password" });
      return new Response(JSON.stringify({ token: "study-login", participant }));
    }
    if (input.includes("/booth/session")) {
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer study-login");
      data = boothState();
      return new Response(JSON.stringify({ token: "linked-booth" }));
    }
    if (input.includes("/event")) return new Response(JSON.stringify({ signup: {} }));
    if (input.endsWith("/me")) return new Response(JSON.stringify(participant));
    return new Response(JSON.stringify(data));
  });
  vi.stubGlobal("fetch", fetcher);
  page("/login");
  const user = userEvent.setup();
  await user.type(await screen.findByRole("textbox", { name: "학번" }), "2026310000");
  await user.type(screen.getByLabelText(/비밀번호/), "password");
  await user.click(screen.getByRole("button", { name: "로그인하기" }));
  await waitFor(() => expect(localStorage.getItem("dino.booth.token")).toBe("linked-booth"));
  expect(await screen.findByText("김공룡 님")).toBeInTheDocument();
});


it("resolves the authenticated identity when both credentials are already stored", async () => {
  tokenStore.set("stored-identity");
  boothTokenStore.set("nickname-only");
  const fetcher = vi.fn(async (input: string, init?: RequestInit) => {
    if (input.includes("/booth/session")) {
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer stored-identity");
      return new Response(JSON.stringify({ token: "identity-account" }));
    }
    if (input.endsWith("/me")) return new Response(JSON.stringify({ id: 42, nickname: "김공룡" }));
    return new Response(JSON.stringify(boothState()));
  });
  vi.stubGlobal("fetch", fetcher);
  page();
  await waitFor(() => expect(boothTokenStore.get()).toBe("identity-account"));
  await waitFor(() => expect(fetcher.mock.calls.some(([url, init]) =>
    url.includes("/booth/state") && (init?.headers as Record<string, string>).Authorization === "Bearer identity-account"
  )).toBe(true));
  expect(fetcher.mock.calls.filter(([url]) => url.includes("/booth/session"))).toHaveLength(1);
});


it("adopts a linked token from another tab without issuing replacement sessions", async () => {
  tokenStore.set("shared-identity");
  boothTokenStore.set("nickname-only");
  let sessions = 0;
  const fetcher = vi.fn(async (input: string) => {
    if (input.includes("/booth/session")) {
      sessions += 1;
      return new Response(JSON.stringify({ token: `linked-${sessions}` }));
    }
    if (input.endsWith("/me")) return new Response(JSON.stringify({ id: 42, nickname: "김공룡" }));
    return new Response(JSON.stringify(boothState()));
  });
  vi.stubGlobal("fetch", fetcher);
  page();
  await waitFor(() => expect(boothTokenStore.get()).toBe("linked-1"));
  // A second tab starts with the shared association and needs no new session.
  page();
  await waitFor(() => expect(fetcher.mock.calls.filter(([url]) => url.endsWith("/me"))).toHaveLength(2));
  expect(sessions, "after second tab mount").toBe(1);
  for (const next of ["other-tab-token-A", "other-tab-token-B"]) {
    await act(async () => {
      boothIdentityStore.set({ identity: "shared-identity", booth: next });
      boothTokenStore.set(next);
      window.dispatchEvent(new StorageEvent("storage", { key: "dino.booth.token", newValue: next }));
    });
    expect(boothTokenStore.get()).toBe(next);
    expect(sessions, next).toBe(1);
  }
  expect(sessions).toBe(1);
});
