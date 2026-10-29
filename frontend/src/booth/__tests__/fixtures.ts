import type { BoothState, Result } from "../types";

export function boothState(enrolled = true): BoothState {
  const now = "2026-10-30T16:10:00+09:00";
  const rounds = [
    {
      id: 1,
      era: "트라이아스기",
      opens_at: "2026-10-30T16:00:00+09:00",
      closes_at: "2026-10-30T16:50:00+09:00",
      state: "open",
      is_open: true,
      version: 60,
      published_at: now,
      paused_reason: null,
    },
    {
      id: 2,
      era: "쥐라기",
      opens_at: "2026-10-30T17:00:00+09:00",
      closes_at: "2026-10-30T17:50:00+09:00",
      state: "pending",
      is_open: false,
      version: 0,
      published_at: null,
      paused_reason: null,
    },
    {
      id: 3,
      era: "백악기",
      opens_at: "2026-10-30T19:30:00+09:00",
      closes_at: "2026-10-30T20:20:00+09:00",
      state: "pending",
      is_open: false,
      version: 0,
      published_at: null,
      paused_reason: null,
    },
  ];
  const holdings: {
    code: string;
    name: string;
    quantity: number;
    cost: number;
    price: number;
    value: number;
    profit: number;
  }[] = [];
  const funds: {
    code: string;
    name: string;
    units: number;
    cost: number;
    nav: number;
    value: number;
    profit: number;
  }[] = [];
  return {
    now,
    rounds,
    selected_round: 1,
    round: rounds[0]!,
    instruments: [
      {
        code: "FEED",
        name: "쥐라기 사료",
        sector: "사료·바이오",
        price: 10000,
        initial_price: 10000,
        return_rate: 0,
        history: [
          { x: "2026-10-30T16:00:00+09:00", y: 10000 },
          { x: now, y: 10000 },
        ],
      },
    ],
    funds: [
      {
        code: "HERB",
        name: "초식이의 분산 펀드",
        style: "분산형",
        icon: "🦕",
        description: "여섯 종목 분산",
        nav: 1000,
        return_rate: 0,
        weights: { CASH: 0.4, FEED: 0.6 },
        reason: "분산 운용합니다.",
        last_decision_at: now,
        history: [{ x: now, y: 1000 }],
      },
    ],
    events: [],
    ranking: [
      {
        rank: 1,
        award_rank: 1,
        participant_id: 1,
        nickname: "김공룡",
        total_assets: 1000000,
        return_rate: 0,
        eligible: true,
        first_trade_at: now,
      },
    ],
    result: null as Result | null,
    results: [],
    me: enrolled
      ? {
          participant_id: 1,
          nickname: "김공룡",
          round_id: 1,
          enrolled: true,
          cash: 1000000,
          principal: 1000000,
          stock_value: 0,
          fund_value: 0,
          total_assets: 1000000,
          return_rate: 0,
          holdings,
          funds,
          orders: [],
          disqualified: false,
          reason: null,
          late_join: false,
        }
      : null,
  };
}
export const config = {
  mode: "booth" as const,
  event_day: "2026-10-30",
  public_url: "https://dino.example.com",
  qa_tools: false,
};
