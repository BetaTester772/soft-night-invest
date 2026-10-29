import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { setLanguage } from "../../i18n";
import { adminKeyStore } from "../../api/storage";
import { AdminView } from "../AdminView";
import { PortfolioView } from "../PortfolioView";
import { MemoryRouter } from "react-router-dom";
import { boothState, config } from "./fixtures";

vi.mock("../../pages/Admin/AuditTab", () => ({ AuditTab: () => null }));

afterEach(() => {
  adminKeyStore.set(null);
  vi.unstubAllGlobals();
});

function setup(state = "pending", failFirstGrant = false) {
  const data = boothState();
  data.round.state = state;
  const status = {
    rounds: data.rounds,
    participants: [
      { participant_id: 1, nickname: "김공룡", round_id: 1, cash: 1000000, disqualified: false, reason: null },
    ],
    results: [],
  };
  let grants = 0;
  const fetch = vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
    if (String(url).endsWith("/grant")) {
      if (failFirstGrant && ++grants === 1) throw new Error("연결 끊김");
      return new Response(JSON.stringify({ message: "지원금을 지급했습니다.", cash: 1250000 }));
    }
    return new Response(JSON.stringify(status));
  });
  vi.stubGlobal("fetch", fetch);
  adminKeyStore.set("test-admin-key");
  render(<AdminView config={config} />);
  return { fetch, user: userEvent.setup() };
}

it("opens a pending round without QA mode and sends the operator reason", async () => {
  const { fetch, user } = setup();
  const button = await screen.findByRole("button", { name: "지금 개장" });
  expect(button).toBeDisabled();
  await user.type(screen.getByLabelText("운영 사유"), "현장 개장");
  await user.click(button);
  await waitFor(() => expect(fetch.mock.calls.some(([url]) => String(url).endsWith("/open"))).toBe(true));
  const call = fetch.mock.calls.find(([url]) => String(url).endsWith("/open"))!;
  expect(JSON.parse((call[1] as RequestInit).body as string)).toEqual({ round_id: 1, reason: "현장 개장" });
});

it("grants the entered amount only to the selected participant", async () => {
  const { fetch, user } = setup("open");
  await screen.findByRole("option", { name: "김공룡" });
  const button = screen.getByRole("button", { name: "지원금 지급" });
  expect(button).toBeDisabled();
  await user.selectOptions(screen.getByLabelText("참가자"), "1");
  expect(screen.getByText(/현재 현금/)).toHaveTextContent("1,000,000");
  await user.type(screen.getByLabelText("운영 사유"), "현장 지원금");
  const amount = screen.getByLabelText("지급 금액 (원)");
  await user.clear(amount);
  await user.type(amount, "250000");
  await user.click(button);
  expect(await screen.findByRole("status")).toHaveTextContent("지원금을 지급했습니다.");
  const call = fetch.mock.calls.find(([url]) => String(url).endsWith("/grant"))!;
  expect(JSON.parse((call[1] as RequestInit).body as string)).toMatchObject({ round_id: 1, participant_id: 1, amount: 250000, reason: "현장 지원금", request_id: expect.any(String) });
});

it("keeps the same request key after a network failure and prevents invalid amounts", async () => {
  const { fetch, user } = setup("open", true);
  await screen.findByRole("option", { name: "김공룡" });
  await user.selectOptions(screen.getByLabelText("참가자"), "1");
  await user.type(screen.getByLabelText("운영 사유"), "지원금");
  const button = screen.getByRole("button", { name: "지원금 지급" });
  const amount = screen.getByLabelText("지급 금액 (원)");
  await user.clear(amount);
  await user.type(amount, "0");
  expect(button).toBeDisabled();
  await user.clear(amount);
  await user.type(amount, "100000");
  await user.click(button);
  await screen.findByText(/서버에 연결하지 못했습니다/);
  await user.click(button);
  await screen.findByText("지원금을 지급했습니다.");
  const calls = fetch.mock.calls.filter(([url]) => String(url).endsWith("/grant"));
  expect(calls).toHaveLength(2);
  expect((calls[0]![1] as RequestInit).body).toEqual((calls[1]![1] as RequestInit).body);
});

it("disables opening and grants on a closed round", async () => {
  const { user } = setup("closed");
  await screen.findByRole("option", { name: "김공룡" });
  await user.selectOptions(screen.getByLabelText("참가자"), "1");
  await user.type(screen.getByLabelText("운영 사유"), "지원금");
  expect(screen.getByRole("button", { name: "지금 개장" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "지원금 지급" })).toBeDisabled();
});

it("shows granted funds as principal rather than investment profit", () => {
  const data = boothState();
  const granted = {
    ...data,
    me: { ...data.me!, cash: 1250000, total_assets: 1250000, principal: 1250000 },
  };
  render(
    <MemoryRouter>
      <PortfolioView data={granted} onTrade={vi.fn()} onJoin={vi.fn()} onEnroll={vi.fn()} />
    </MemoryRouter>,
  );
  expect(screen.getByText("이번 장 투자 손익").parentElement?.querySelector("strong")?.textContent).toBe("0원");
  expect(screen.getByText("투자 원금 1,250,000원")).toBeInTheDocument();
});

it("renders the added administrator controls in English", async () => {
  setLanguage("en");
  setup();
  expect(await screen.findByRole("button", { name: "Open now" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Grant funds" })).toBeInTheDocument();
  expect(screen.getByLabelText("Grant amount (KRW)")).toBeInTheDocument();
});
