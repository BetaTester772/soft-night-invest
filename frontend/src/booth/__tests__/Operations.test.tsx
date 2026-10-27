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
