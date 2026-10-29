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
  state: (roundId?: number, credential?: string | null) =>
    request<BoothState>("/booth/state", {
      auth: "booth",
      query: { round_id: roundId },
      credential,
    }),
  session: (credential: string) => request<{ token: string }>("/booth/session", { method: "POST", auth: "participant", credential }),
  enroll: (roundId: number, credential?: string | null) =>
    request<Me>("/booth/enroll", {
      method: "POST",
      auth: "booth",
      body: { round_id: roundId },
      credential,
    }),
  order: (body: OrderBody, credential?: string | null) =>
    request<{ order: Order; me: Me }>("/booth/orders", {
      method: "POST",
      auth: "booth",
      body,
      credential,
    }),
  logout: (credential?: string | null) =>
    request<void>("/booth/logout", {
      method: "POST",
      auth: "booth",
      credential,
    }),
  status: () => request<AdminStatus>("/booth/admin/status", { auth: "admin" }),
  admin: <T = unknown>(action: string, body?: unknown) =>
    request<T>("/booth/admin/" + action, {
      method: "POST",
      auth: "admin",
      body,
    }),
};
