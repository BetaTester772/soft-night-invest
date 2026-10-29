import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  within,
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
  vi.restoreAllMocks();
  boothTokenStore.set(null);
});

it.each([null, "persisted-account"])("retains a memory session when writes fail over %s", (stored) => {
  boothTokenStore.set(stored);
  const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new DOMException("Storage full", "QuotaExceededError");
  });
  boothTokenStore.set("memory-account");
  expect(boothTokenStore.get()).toBe("memory-account");
  write.mockRestore();
  localStorage.setItem("dino.booth.token", "newer-account");
  expect(boothTokenStore.get()).toBe("newer-account");
  localStorage.removeItem("dino.booth.token");
  expect(boothTokenStore.get()).toBeNull();
});

it.each(["stock", "fund"])("submits and retries %s orders without randomUUID", async (kind) => {
  boothTokenStore.set("account-A");
  const secureRandom = crypto.getRandomValues.bind(crypto);
  vi.stubGlobal("crypto", { getRandomValues: secureRandom });
  const requests: { request_id: string }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    if (input.includes("/orders")) {
      requests.push(JSON.parse(String(init?.body)));
      if (requests.length === 1) throw new Error("일시 연결 실패");
      return response({ order: { id: 1 }, me: boothState().me });
    }
    return stateFor((init?.headers as Record<string, string>)?.Authorization);
  }));
  page(kind === "fund" ? "/funds" : "/");
  fireEvent.click(await screen.findByRole("button", {
    name: kind === "fund" ? "이 펀드에 투자하기" : "주식 매매",
  }));
  const submit = screen.getByRole("button", {
    name: kind === "fund" ? "펀드 매수하기" : "주식 매수하기",
  });
  fireEvent.click(submit);
  expect(await within(screen.getByRole("dialog")).findByText(/서버에 연결하지 못했습니다/)).toBeInTheDocument();
  fireEvent.click(submit);
  await act(async () => {});
  expect(requests).toHaveLength(2);
  expect(requests[0]!.request_id).toMatch(/^[a-f0-9-]{32,36}$/);
  expect(requests[1]!.request_id).toBe(requests[0]!.request_id);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it.each(["success", "failure"])("preserves an in-flight order during poll errors and handles %s", async (outcome) => {
  vi.useFakeTimers();
  boothTokenStore.set("account-A");
  let failPoll = false;
  let finishOrder!: (value: Response) => void;
  let rejectOrder!: (reason: Error) => void;
  const pending = new Promise<Response>((resolve, reject) => {
    finishOrder = resolve;
    rejectOrder = reject;
  });
  const ids: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    if (input.includes("/orders")) {
      ids.push(JSON.parse(String(init?.body)).request_id);
      if (ids.length === 1) return pending;
      return response({ order: { id: 1 }, me: boothState().me });
    }
    if (failPoll) throw new Error("조회 연결 실패");
    return stateFor((init?.headers as Record<string, string>)?.Authorization);
  }));
  page("/funds");
  await act(async () => {});
  fireEvent.click(screen.getByRole("button", { name: "이 펀드에 투자하기" }));
  const dialog = screen.getByRole("dialog");
  fireEvent.click(screen.getByRole("button", { name: "펀드 매수하기" }));
  failPoll = true;
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(screen.getByRole("dialog")).toBe(dialog);
  expect(screen.getByRole("button", { name: /펀드 매수하기/ })).toBeDisabled();
  failPoll = false;
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(screen.getByRole("dialog")).toBe(dialog);
  if (outcome === "success") {
    await act(async () => finishOrder(response({ order: { id: 1 }, me: boothState().me })));
  } else {
    await act(async () => rejectOrder(new Error("주문 응답 유실")));
    expect(within(dialog).getByText(/서버에 연결하지 못했습니다/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "펀드 매수하기" }));
    await act(async () => {});
    expect(ids).toHaveLength(2);
    expect(ids[1]).toBe(ids[0]);
  }
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it.each([
  { key: "dino.booth.token", newValue: "account-A" },
  { key: "dino.booth.token", newValue: null },
  { key: null, newValue: null },
])("ignores obsolete storage payload $newValue for key $key", async (event) => {
  boothTokenStore.set("account-A");
  vi.stubGlobal("fetch", vi.fn(async (_input: string, init?: RequestInit) =>
    stateFor((init?.headers as Record<string, string>)?.Authorization),
  ));
  page();
  expect(await screen.findByText("Account A 님")).toBeInTheDocument();
  localStorage.setItem("dino.booth.token", "account-B");
  const write = vi.spyOn(Storage.prototype, "setItem");
  const remove = vi.spyOn(Storage.prototype, "removeItem");
  await act(async () => window.dispatchEvent(new StorageEvent("storage", event)));
  expect(localStorage.getItem("dino.booth.token")).toBe("account-B");
  expect(await screen.findByText("Account B 님")).toBeInTheDocument();
  expect(write).not.toHaveBeenCalled();
  expect(remove).not.toHaveBeenCalled();
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
