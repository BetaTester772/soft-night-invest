import { t } from '../i18n';
import type { BoothState, MarketEvent } from './types';

/** Translate known system content while keeping participant and operator input intact. */
export function localizeBoothState(data: BoothState): BoothState {
  const event = (e: MarketEvent) => ({
    ...e,
    headline: ['ghost', 'meteor', 'cancelled', 'market'].includes(e.kind) ? t(e.headline) : e.headline,
  });
  const round = (r: BoothState['round']) => ({
    ...r,
    era: t(r.era),
    paused_reason: r.paused_reason ? t(r.paused_reason) : null,
  });
  return {
    ...data,
    round: round(data.round),
    rounds: data.rounds.map(round),
    instruments: data.instruments.map((i) => ({ ...i, name: t(i.name), sector: t(i.sector) })),
    funds: data.funds.map((f) => ({
      ...f,
      name: t(f.name),
      style: t(f.style),
      description: t(f.description),
      reason: t(f.reason),
    })),
    events: data.events.map(event),
    event_history: data.event_history?.map(event),
    me: data.me ? {
      ...data.me,
      holdings: data.me.holdings.map((h) => ({ ...h, name: t(h.name) })),
      funds: data.me.funds.map((f) => ({ ...f, name: t(f.name) })),
    } : null,
  };
}
