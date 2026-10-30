import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { MarketView } from "../MarketView";
import { boothState } from "./fixtures";

function setup() {
  const data = boothState();
  data.instruments.push({
    ...data.instruments[0]!,
    code: "SECOND",
    name: "두 번째 종목",
    price: 12000,
    change_rate: 0.2,
    history: data.instruments[0]!.history.map((point) => ({ ...point, y: 12000 })),
  });
  const onTrade = vi.fn();
  render(<MarketView data={data} onTrade={onTrade} />);
  return { user: userEvent.setup(), onTrade };
}

it.each(["price", "change", "chart", "space"])(
  "selects the stock and trade target by clicking its row's %s",
  async (area) => {
    const { user, onTrade } = setup();
    const button = screen.getByRole("button", { name: /두 번째 종목/ });
    const row = button.closest("tr")!;
    const cells = within(row).getAllByRole("cell");
    const target = area === "price" ? cells[1]!
      : area === "change" ? cells[2]!
      : area === "chart" ? within(row).getByRole("img")
      : cells[0]!;

    await user.click(target);

    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("img", { name: /두 번째 종목 장중 가격 이력/ })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "주식 매매" }));
    expect(onTrade).toHaveBeenCalledWith({ kind: "stock", code: "SECOND", round_id: 1 });
  },
);

it("keeps stock selection accessible with Tab, Enter, and Space", async () => {
  const { user } = setup();
  const first = screen.getByRole("button", { name: /쥐라기 사료/ });
  const second = screen.getByRole("button", { name: /두 번째 종목/ });
  await user.tab();
  expect(first).toHaveFocus();
  await user.tab();
  expect(second).toHaveFocus();
  await user.keyboard("{Enter}");
  expect(second).toHaveAttribute("aria-pressed", "true");
  await user.tab({ shift: true });
  await user.keyboard(" ");
  expect(first).toHaveAttribute("aria-pressed", "true");
  expect(second).toHaveAttribute("aria-pressed", "false");
});
