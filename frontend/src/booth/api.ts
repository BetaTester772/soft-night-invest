import { request } from "../api/client";
import type {
  AdminStatus,
  BoothConfig,
  BoothState,
  Me,
  Order,
  OrderBody,
} from "./types";

export const boothApi = {
  config: () => request<BoothConfig>("/booth/config"),
  state: (roundId?: number) =>
    request<BoothState>("/booth/state", {
      auth: "booth",
      query: { round_id: roundId },
    }),
  join: (nickname: string) =>
    request<{ token: string; participant: { id: number; nickname: string } }>(
      "/booth/join",
      { method: "POST", body: { nickname } },
    ),
  enroll: (roundId: number) =>
    request<Me>("/booth/enroll", {
      method: "POST",
      auth: "booth",
      body: { round_id: roundId },
    }),
  order: (body: OrderBody) =>
    request<{ order: Order; me: Me }>("/booth/orders", {
      method: "POST",
      auth: "booth",
      body,
    }),
  logout: () =>
    request<void>("/booth/logout", { method: "POST", auth: "booth" }),
  status: () => request<AdminStatus>("/booth/admin/status", { auth: "admin" }),
  admin: <T = unknown>(action: string, body?: unknown) =>
    request<T>("/booth/admin/" + action, {
      method: "POST",
      auth: "admin",
      body,
    }),
};
