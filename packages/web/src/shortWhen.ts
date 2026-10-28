import type { IntlShape } from "react-intl";

/**
 * Shorten the time in copied text: today's shows only the time ("10:32"), this year's shows the date ("Oct 19"), earlier ones include the year; with withTime the date also carries the time.
 * Follows the interface language, 24-hour clock
 */
export function shortWhen(intl: IntlShape, iso: string, withTime = false): string {
  const d = new Date(iso);
  const now = new Date();
  const clock = { hour: "2-digit", minute: "2-digit", hourCycle: "h23" } as const;
  if (d.toDateString() === now.toDateString()) return intl.formatTime(d, clock);
  return intl.formatDate(d, {
    ...(d.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
    month: "long",
    day: "numeric",
    ...(withTime ? clock : {}),
  });
}
