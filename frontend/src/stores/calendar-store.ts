import { create } from 'zustand';

import { type DayKey, todayKey } from '@/lib/dates';

type CalendarStore = {
  /** Current São Paulo calendar day; ticks over at local midnight. */
  dayKey: DayKey;
};

export const useCalendarStore = create<CalendarStore>(() => ({
  dayKey: todayKey(),
}));

let clockStarted = false;

/** Starts the minute tick that rolls `dayKey` over. Idempotent. */
export function startCalendarClock() {
  if (clockStarted || typeof window === 'undefined') return;
  clockStarted = true;
  window.setInterval(() => {
    const next = todayKey();
    if (useCalendarStore.getState().dayKey !== next) {
      useCalendarStore.setState({ dayKey: next });
    }
  }, 60_000);
}
