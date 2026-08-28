/**
 * The calendar's view ranges, bound to the parish's own zone.
 *
 * The arithmetic itself is in `@spsm/shared/calendarView` — it is pure, the
 * parish app needs the same of it, and `tests/unit` can only reach it there.
 * What is left here is the one thing that is genuinely this app's: which zone
 * "today" is read in.
 */
import { todayIn } from '@spsm/shared';
import { PARISH_TIME_ZONE } from '@/lib/dates';

export {
  dayParts,
  formatClock,
  monthLabel,
  monthRange,
  rangeFor,
  spanLabel,
  startOfWeek,
  step,
  weekRange,
  weekdayOf,
  type CalendarView,
  type ViewRange,
} from '@spsm/shared';

/** Today, as read in Wayland. */
export function todayInParish(): string {
  return todayIn(PARISH_TIME_ZONE);
}
