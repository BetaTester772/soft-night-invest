import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, it, vi } from "vitest";
import { setLanguage } from "../../i18n";
import { PortfolioView } from "../PortfolioView";
import { TradeDialog } from "../TradeDialog";
import { boothState } from "./fixtures";

function investedState() {
  const data = boothState();
  data.me!.holdings = [{ code: "FEED", name: "쥐라기 사료", quantity: 3,
    cost: 25_000, price: 10_000, value: 30_000, profit: 5_000 }];
  data.me!.funds = [{ code: "HERB", name: "초식이의 분산 펀드", units: 2_500_000,
    cost: 3_000, nav: 1_000, value: 2_500, profit: -500 }];
  return data;
}

it("shows stock and fractional fund cost per unit next to current prices in the portfolio", () => {
  const onTrade = vi.fn();
  render(<MemoryRouter><PortfolioView data={investedState()} onTrade={onTrade}
    onJoin={vi.fn()} onEnroll={vi.fn()} /></MemoryRouter>);
  expect(screen.getByText("8,333.33원")).toBeVisible();
  expect(screen.getByText("1,200원")).toBeVisible();
  expect(screen.getAllByText("평단가")).toHaveLength(2);
  expect(screen.getByText("10,000원")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "매도" }));
  expect(onTrade).toHaveBeenCalledWith({ kind: "stock", code: "FEED", round_id: 1, side: "sell" });
  fireEvent.click(screen.getByRole("button", { name: "환매" }));
  expect(onTrade).toHaveBeenLastCalledWith({ kind: "fund", code: "HERB", round_id: 1, side: "sell" });
});

it.each([ ["stock", "FEED", "8,333.33원"], ["fund", "HERB", "1,200원"] ] as const)
  ("shows %s average cost on both order sides and refreshes with holdings", (kind, code, expected) => {
    const props = { target: { kind, code, round_id: 1 }, sessionToken: null,
      onClose: vi.fn(), onFilled: vi.fn(), onSessionChanged: vi.fn() };
    const { rerender } = render(<TradeDialog {...props} data={investedState()} />);
    const modal = within(screen.getByRole("dialog"));
    expect(modal.getByText(expected)).toBeVisible();
    fireEvent.click(modal.getByRole("button", { name: kind === "stock" ? "매도" : "환매" }));
    expect(modal.getByText(expected)).toBeVisible();
    rerender(<TradeDialog {...props} data={boothState()} />);
    expect(modal.queryByText(expected)).not.toBeInTheDocument();
    expect(modal.getByText("—")).toBeVisible();
  });

it("localizes average cost and handles zero-cost holdings without dividing by zero", () => {
  setLanguage("en");
  const data = investedState();
  data.me!.holdings[0]!.cost = 0;
  data.me!.funds[0]!.units = 0;
  render(<MemoryRouter><PortfolioView data={data} onTrade={vi.fn()}
    onJoin={vi.fn()} onEnroll={vi.fn()} /></MemoryRouter>);
  expect(screen.getAllByText("Average cost")).toHaveLength(2);
  expect(screen.getByText("KRW 0", { selector: "dd" })).toBeVisible();
  expect(screen.getByText("—")).toBeVisible();
});
