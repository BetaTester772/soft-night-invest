import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { useApi } from "../../api/useApi";
import { boothTokenStore } from "../../api/storage";
import { BoothApp } from "../BoothApp";
import { boothState, config } from "./fixtures";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  boothTokenStore.set(null);
});
const response = (data: unknown) => new Response(JSON.stringify(data));
function stateFor(auth?: string) {
  const data = boothState(Boolean(auth));
  if (data.me)
    data.me.nickname = auth === "Bearer account-B" ? "Account B" : "Account A";
  return response(data);
}
function page(path = "/") {
  render(
    <MemoryRouter initialEntries={[path]}>
      <BoothApp config={config} />
    </MemoryRouter>,
  );
}
function switchAccount() {
  localStorage.setItem("dino.booth.token", "account-B");
  window.dispatchEvent(
    new StorageEvent("storage", {
      key: "dino.booth.token",
      oldValue: "account-A",
      newValue: "account-B",
    }),
  );
}
it("renders successful slow responses without periodic request starvation", async () => {
  vi.useFakeTimers();
  const fetcher = () =>
    new Promise<{ ok: boolean }>((resolve) =>
      setTimeout(() => resolve({ ok: true }), 2500),
    );
  const { result } = renderHook(() =>
    useApi(fetcher, [], { refreshInterval: 2000 }),
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(12500);
  });
  expect(result.current.data).toEqual({ ok: true });
  expect(result.current.loading).toBe(false);
});

it("invalidates an open trade when another tab switches accounts", async () => {
  boothTokenStore.set("account-A");
  let orders = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      const auth = (init?.headers as Record<string, string>)?.Authorization;
      if (input.includes("/orders")) {
        orders++;
        return response({ order: { id: 1 }, me: boothState().me });
      }
      return stateFor(auth);
    }),
  );
  page("/funds");
  fireEvent.click(
    await screen.findByRole("button", { name: "이 펀드에 투자하기" }),
  );
  const oldSubmit = screen.getByRole("button", { name: "펀드 매수하기" });
  await act(async () => switchAccount());
  fireEvent.click(oldSubmit);
  expect(orders).toBe(0);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(await screen.findByText("Account B 님")).toBeInTheDocument();
});

it("blocks a stale account trade even before the storage event arrives", async () => {
  boothTokenStore.set("account-A");
  let orders = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      if (input.includes("/orders")) {
        orders++;
        return response({ order: { id: 1 }, me: boothState().me });
      }
      return stateFor((init?.headers as Record<string, string>)?.Authorization);
    }),
  );
  page("/funds");
  fireEvent.click(
    await screen.findByRole("button", { name: "이 펀드에 투자하기" }),
  );
  localStorage.setItem("dino.booth.token", "account-B");
  fireEvent.click(screen.getByRole("button", { name: "펀드 매수하기" }));
  await act(async () => {});
  expect(orders).toBe(0);
  expect(await screen.findByText("Account B 님")).toBeInTheDocument();
});

it("disables recovery while a join is pending", async () => {
  boothTokenStore.set(null);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      if (input.includes("/join")) return new Promise<Response>(() => {});
      return stateFor();
    }),
  );
  page();
  fireEvent.click(await screen.findByRole("button", { name: "참가하기" }));
  fireEvent.change(screen.getByRole("textbox", { name: /닉네임/ }), {
    target: { value: "Account A" },
  });
  fireEvent.submit(
    screen.getByRole("button", { name: "거래소 입장하기" }).closest("form")!,
  );
  fireEvent.change(screen.getByLabelText("복구 토큰"), {
    target: { value: "account-B" },
  });
  expect(
    screen.getByRole("button", { name: "계좌 복구하기", hidden: true }),
  ).toBeDisabled();
});

it("ignores a late join response after another account is restored", async () => {
  boothTokenStore.set(null);
  let finishJoin!: (value: Response) => void;
  const pending = new Promise<Response>((resolve) => {
    finishJoin = resolve;
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      if (input.includes("/join")) return pending;
      return stateFor((init?.headers as Record<string, string>)?.Authorization);
    }),
  );
  page();
  fireEvent.click(await screen.findByRole("button", { name: "참가하기" }));
  fireEvent.change(screen.getByRole("textbox", { name: /닉네임/ }), {
    target: { value: "Account A" },
  });
  fireEvent.submit(
    screen.getByRole("button", { name: "거래소 입장하기" }).closest("form")!,
  );
  await act(async () => switchAccount());
  expect(await screen.findByText("Account B 님")).toBeInTheDocument();
  await act(async () =>
    finishJoin(
      response({
        token: "account-A",
        participant: { id: 1, nickname: "Account A" },
      }),
    ),
  );
  expect(boothTokenStore.get()).toBe("account-B");
  expect(screen.getByText("Account B 님")).toBeInTheDocument();
});

it("ignores a late logout response from a superseded session", async () => {
  boothTokenStore.set("account-A");
  let finishLogout!: (value: Response) => void;
  const pending = new Promise<Response>((resolve) => {
    finishLogout = resolve;
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      if (input.includes("/logout")) return pending;
      return stateFor((init?.headers as Record<string, string>)?.Authorization);
    }),
  );
  page();
  fireEvent.click(await screen.findByRole("button", { name: "나가기" }));
  await act(async () => switchAccount());
  expect(await screen.findByText("Account B 님")).toBeInTheDocument();
  await act(async () => finishLogout(new Response(null, { status: 204 })));
  expect(boothTokenStore.get()).toBe("account-B");
  expect(screen.getByText("Account B 님")).toBeInTheDocument();
});

it("clears an old account when another tab removes its stored token", async () => {
  boothTokenStore.set("account-A");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input: string, init?: RequestInit) =>
      stateFor((init?.headers as Record<string, string>)?.Authorization),
    ),
  );
  page("/funds");
  expect(await screen.findByText("Account A 님")).toBeInTheDocument();
  await act(async () => {
    localStorage.removeItem("dino.booth.token");
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "dino.booth.token",
        oldValue: "account-A",
        newValue: null,
      }),
    );
  });
  expect(
    await screen.findByRole("button", { name: "참가하기" }),
  ).toBeInTheDocument();
  expect(boothTokenStore.get()).toBeNull();
});
