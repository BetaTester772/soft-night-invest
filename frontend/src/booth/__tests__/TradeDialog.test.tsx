import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setLanguage } from "../../i18n";
import { TradeDialog } from "../TradeDialog";
import { boothState } from "./fixtures";

beforeEach(() => setLanguage("ko"));
afterEach(() => localStorage.clear());

function dialog(data = boothState(), kind: "stock" | "fund" = "stock") {
  return (
    <TradeDialog
      target={{ kind, code: kind === "stock" ? "FEED" : "HERB", round_id: 1 }}
      data={data}
      sessionToken={null}
      onClose={vi.fn()}
      onFilled={vi.fn()}
      onSessionChanged={vi.fn()}
    />
  );
}

it.each([
  [1_000_000, 10_000, "100"],
  [100_001, 30_000, "3"],
  [9_999, 10_000, "0"],
  [0, 10_000, "0"],
  [2_000_000_000_000, 1_000, "1,000,000,000"],
])("shows affordable whole shares for cash %i and price %i", (cash, price, quantity) => {
  const data = boothState();
  data.me!.cash = cash;
  data.instruments[0]!.price = price;
  render(dialog(data));
  expect(screen.getByRole("textbox", { name: /거래할 수량/ }))
    .toHaveAccessibleDescription(`최대 구매 가능 수량: ${quantity}주 (현재가 기준)`);
});

it("updates the maximum when the current price or cash changes", () => {
  const { rerender } = render(dialog());
  expect(screen.getByText("최대 구매 가능 수량: 100주 (현재가 기준)")).toBeInTheDocument();
  const data = boothState();
  data.instruments[0]!.price = 20_000;
  rerender(dialog(data));
  expect(screen.getByText("최대 구매 가능 수량: 50주 (현재가 기준)")).toBeInTheDocument();
  data.me = { ...data.me!, cash: 45_000 };
  rerender(dialog(data));
  expect(screen.getByText("최대 구매 가능 수량: 2주 (현재가 기준)")).toBeInTheDocument();
});

it("only shows the stock purchase maximum while buying stocks", () => {
  const { rerender } = render(dialog());
  expect(screen.getByText(/최대 구매 가능 수량/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "매도" }));
  expect(screen.queryByText(/최대 구매 가능 수량/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "매수" }));
  expect(screen.getByText(/최대 구매 가능 수량/)).toBeInTheDocument();
  rerender(dialog(boothState(), "fund"));
  expect(screen.queryByText(/최대 구매 가능 수량/)).not.toBeInTheDocument();
});

it("shows zero when account or stock pricing data is unavailable", () => {
  const { rerender } = render(dialog(boothState(false)));
  expect(screen.getByText("최대 구매 가능 수량: 0주 (현재가 기준)")).toBeInTheDocument();
  const data = boothState();
  data.instruments = [];
  rerender(dialog(data));
  expect(screen.getByText("최대 구매 가능 수량: 0주 (현재가 기준)")).toBeInTheDocument();
  data.instruments = [{ ...boothState().instruments[0]!, price: 0 }];
  rerender(dialog(data));
  expect(screen.getByText("최대 구매 가능 수량: 0주 (현재가 기준)")).toBeInTheDocument();
});

it("translates the purchase maximum in English", () => {
  setLanguage("en");
  render(dialog());
  expect(screen.getByRole("textbox", { name: /Quantity/ }))
    .toHaveAccessibleDescription("Maximum you can buy: 100 shares (at the current price)");
});
