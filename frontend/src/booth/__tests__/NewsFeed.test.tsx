import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { NewsFeed } from "../MarketView";
import { boothState } from "./fixtures";

function historyState() {
  return {
    ...boothState(),
    event_history: Array.from({ length: 12 }, (_, index) => ({
      id: 12 - index,
      kind: "market",
      headline: `기록된 속보 ${12 - index}`,
      created_at: "2026-10-30T17:05:00+09:00",
      sector: null,
      rates: {},
    })),
  };
}

it("shows recent history even with no current alert, and lets readers expand older news", async () => {
  const user = userEvent.setup();
  render(<NewsFeed data={historyState()} />);
  expect(screen.getAllByRole("article")).toHaveLength(3);
  expect(screen.getByText("기록된 속보 12")).toBeInTheDocument();
  expect(screen.queryByText("기록된 속보 1")).not.toBeInTheDocument();
  const toggle = screen.getByRole("button", { name: /이전 속보/ });
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  await user.click(toggle);
  expect(toggle).toHaveAttribute("aria-expanded", "true");
  expect(screen.getAllByRole("article")).toHaveLength(12);
  expect(screen.getByText("기록된 속보 1")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "최근 속보만 보기" }));
  expect(screen.getAllByRole("article")).toHaveLength(3);
});

it("updates without duplicates and resets expanded history when the round changes", async () => {
  const user = userEvent.setup();
  const data = historyState();
  const { rerender } = render(<NewsFeed data={data} />);
  await user.click(screen.getByRole("button", { name: /이전 속보/ }));
  rerender(<NewsFeed data={{ ...data }} />);
  expect(screen.getAllByRole("article")).toHaveLength(12);
  const next = { ...data.event_history[0]!, id: 13, headline: "새 속보" };
  rerender(<NewsFeed data={{ ...data, event_history: [next, ...data.event_history] }} />);
  expect(screen.getAllByRole("article")).toHaveLength(13);
  expect(screen.getAllByRole("article")[0]).toHaveTextContent("새 속보");
  rerender(<NewsFeed data={{ ...data, round: { ...data.round, id: 2 } }} />);
  expect(screen.getAllByRole("article")).toHaveLength(3);
});

it("shows an empty state without archive controls before the first news arrives", () => {
  render(<NewsFeed data={{ ...historyState(), event_history: [] }} />);
  expect(screen.getByText("아직 기록된 속보가 없습니다.")).toBeInTheDocument();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});
