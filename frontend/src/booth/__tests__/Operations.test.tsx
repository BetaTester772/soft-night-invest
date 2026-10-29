import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { BoothApp } from "../BoothApp";
import { boothState, config } from "./fixtures";

afterEach(() => vi.unstubAllGlobals());
function page(confirmed: boolean, publicUrl = config.public_url) {
  const data = boothState(false);
  data.round.state = "closed";
  data.round.is_open = false;
  data.result = {
    round_id: 1,
    revision: 1,
    confirmed,
    entries: data.ranking,
    created_at: data.now,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(data))),
  );
  render(
    <MemoryRouter initialEntries={["/broadcast"]}>
      <BoothApp config={{ ...config, public_url: publicUrl }} />
    </MemoryRouter>,
  );
}
it("waits for administrator confirmation before showing award winners", async () => {
  page(false);
  expect(await screen.findByText("시상 결과 확인 중")).toBeInTheDocument();
  expect(
    screen.queryByRole("heading", { name: "1위 김공룡" }),
  ).not.toBeInTheDocument();
});
it("shows confirmed winners and a QR for the configured deployment URL", async () => {
  page(true);
  expect(
    await screen.findByRole("heading", { name: "1위 김공룡" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("img", { name: "참가 QR 코드" })).toBeInTheDocument();
  expect(
    screen.getByRole("link", { name: "휴대폰으로 참가하기" }),
  ).toHaveAttribute("href", "https://dino.example.com");
});
it("asks the operator to configure a URL instead of showing localhost QR", async () => {
  page(true, "");
  expect(
    await screen.findByText("운영자가 참가 주소를 설정하면 QR이 표시됩니다."),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("img", { name: "참가 QR 코드" }),
  ).not.toBeInTheDocument();
});

it("guides account recovery through password reset instead of unusable tokens", async () => {
  const { AdminView } = await import("../AdminView");
  const { adminKeyStore } = await import("../../api/storage");
  adminKeyStore.set("test-admin");
  vi.stubGlobal("fetch", vi.fn(async (input: string) => new Response(JSON.stringify(
    input.includes("/booth/admin/status")
      ? { rounds: boothState().rounds, participants: [], results: [] }
      : []
  ))));
  try {
    render(<MemoryRouter><AdminView config={config} /></MemoryRouter>);
    expect(await screen.findByRole("link", { name: "비밀번호 재설정" })).toHaveAttribute("href", "/reset-password");
    expect(screen.queryByRole("button", { name: "현장 확인 후 계좌 복구" })).not.toBeInTheDocument();
    expect(screen.queryByText("새 복구 토큰")).not.toBeInTheDocument();
  } finally {
    adminKeyStore.set(null);
  }
});
