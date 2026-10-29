import type { ChartPoint } from "../components/ui/LineChart/LineChart";

export interface BoothConfig {
  mode: "study" | "booth";
  event_day: string;
  public_url: string;
  qa_tools: boolean;
  time_scale?: number;
}
export interface RoundInfo {
  id: number;
  era: string;
  opens_at: string;
  closes_at: string;
  state: string;
  is_open: boolean;
  version: number;
  update_interval_seconds?: number;
  published_at: string | null;
  paused_reason: string | null;
}
export interface Instrument {
  code: string;
  name: string;
  sector: string;
  price: number;
  initial_price: number;
  return_rate: number;
  history: ChartPoint[];
}
export interface Fund {
  code: string;
  name: string;
  style: string;
  icon: string;
  description: string;
  nav: number;
  return_rate: number;
  weights: Record<string, number>;
  reason: string;
  last_decision_at: string | null;
  history: ChartPoint[];
}
export interface Holding {
  code: string;
  name: string;
  quantity: number;
  cost: number;
  price: number;
  value: number;
  profit: number;
}
export interface FundHolding {
  code: string;
  name: string;
  units: number;
  cost: number;
  nav: number;
  value: number;
  profit: number;
}
export interface Order {
  id: number;
  kind: "stock" | "fund";
  code: string;
  side: "buy" | "sell";
  quantity?: number;
  units?: number;
  amount: number;
  price: number;
  price_version: number;
  created_at: string;
}
export interface Me {
  participant_id: number;
  nickname: string;
  round_id: number;
  enrolled: boolean;
  cash: number;
  principal: number;
  stock_value: number;
  fund_value: number;
  total_assets: number;
  return_rate: number;
  holdings: Holding[];
  funds: FundHolding[];
  orders: Order[];
  disqualified: boolean;
  reason: string | null;
  late_join: boolean;
}
export interface RankEntry {
  rank: number;
  award_rank: number | null;
  participant_id: number;
  nickname: string;
  total_assets: number;
  return_rate: number;
  eligible: boolean;
  first_trade_at: string | null;
}
export interface Result {
  round_id: number;
  revision: number;
  confirmed: boolean;
  entries: RankEntry[];
  created_at: string;
}
export interface MarketEvent {
  id: number;
  kind: string;
  headline: string;
  sector: string | null;
  rates: Record<string, number>;
  created_at: string;
}
export interface BoothState {
  now: string;
  rounds: RoundInfo[];
  selected_round: number;
  round: RoundInfo;
  instruments: Instrument[];
  funds: Fund[];
  events: MarketEvent[];
  ranking: RankEntry[];
  result: Result | null;
  results: Result[];
  me: Me | null;
}
export interface TradeTarget {
  kind: "stock" | "fund";
  code: string;
  round_id: number;
  side?: "buy" | "sell";
}
export interface OrderBody {
  round_id: number;
  request_id: string;
  kind: "stock" | "fund";
  code: string;
  side: "buy" | "sell";
  quantity?: number;
  amount?: number;
  units?: number;
}
export interface AdminStatus {
  rounds: RoundInfo[];
  participants: {
    participant_id: number;
    nickname: string;
    round_id: number;
    cash: number;
    disqualified: boolean;
    reason: string | null;
  }[];
  results: Result[];
}
