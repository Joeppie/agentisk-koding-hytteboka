// Weeks are counted as ISO weeks, Monday to Sunday, written "2027-W12".
// Written that way, weeks sort as text: "2026-W53" < "2027-W01".
//
// A cabin week runs from Friday to Friday, with the swap at 12:00: those who leave are out by noon,
// so the cleaner is done before the next group comes after work. Cabin week 8 is the one whose
// weekdays are in ISO week 8: from Friday in week 7 to Friday in week 8.
//
// Easter does not fit that, so the weeks around it are cut to the holidays, one of two ways that
// the office votes on each year (see `periodDays`). When Easter is split in two, its second half is
// written with a "b": "2027-W12b". It sorts between "2027-W12" and "2027-W13", as it should.
//
// Every date here is a calendar day held as midnight UTC, so summer time never moves one.
// Only `noonInOslo` turns a day into a moment.

const DAY = 86_400_000;
const HOUR = 3_600_000;
const WEEK_ID = /^(\d{4})-W(\d{2})$/;
const PERIOD_ID = /^(\d{4}-W\d{2})(b?)$/;
const WEEKDAYS = ['søn.', 'man.', 'tir.', 'ons.', 'tor.', 'fre.', 'lør.'];

const MONTHS = [
  'januar', 'februar', 'mars', 'april', 'mai', 'juni',
  'juli', 'august', 'september', 'oktober', 'november', 'desember',
];

const osloDay = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Oslo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const osloHour = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Oslo', hour: '2-digit', hourCycle: 'h23' });

const osloMoment = new Intl.DateTimeFormat('nb-NO', {
  timeZone: 'Europe/Oslo',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export function weekIdOf(date) {
  // A week belongs to the year its Thursday is in.
  const thursday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  thursday.setUTCDate(thursday.getUTCDate() + 4 - (thursday.getUTCDay() || 7));
  const year = thursday.getUTCFullYear();
  const week = Math.ceil(((thursday.getTime() - Date.UTC(year, 0, 1)) / DAY + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/** The Monday a week starts on, or null when the text names no week (as "2027-W53" does not). */
export function mondayOf(id) {
  const match = WEEK_ID.exec(id);
  if (!match) return null;
  const year = Number(match[1]);
  const week = Number(match[2]);
  // 4 January is always in week 1.
  const monday = new Date(Date.UTC(year, 0, 4));
  monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() || 7) + 1 + (week - 1) * 7);
  return weekIdOf(monday) === id ? monday : null;
}

export function isWeekId(id) {
  return typeof id === 'string' && mondayOf(id) !== null;
}

/** Whether the text names a cabin week, or the second half of an Easter that may be split. */
export function isPeriodId(id) {
  const match = typeof id === 'string' && PERIOD_ID.exec(id);
  return Boolean(match) && isWeekId(match[1]) && (!match[2] || match[1] === easterWeek(Number(id.slice(0, 4))));
}

/** The ISO week a cabin week is counted in: "2027-W12b" is in "2027-W12". */
export function isoWeekOf(id) {
  return id.slice(0, 8);
}

export function isSecondHalf(id) {
  return id.endsWith('b');
}

export function weekNumber(id) {
  return Number(id.slice(6, 8));
}

export function addWeeks(id, count) {
  return weekIdOf(new Date(mondayOf(id).getTime() + count * 7 * DAY));
}

export function weeksFrom(id, count) {
  return Array.from({ length: count }, (_, index) => addWeeks(id, index));
}

/** The ISO week of the day it is in Norway at this moment. */
export function currentWeek(now = new Date()) {
  const parts = Object.fromEntries(osloDay.formatToParts(now).map((part) => [part.type, part.value]));
  return weekIdOf(new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day))));
}

/** The moment it is 12:00 in Norway on a day, whether it is summer time or not. */
export function noonInOslo(day) {
  const winter = new Date(day.getTime() + 11 * HOUR);
  return Number(osloHour.format(winter)) === 12 ? winter : new Date(day.getTime() + 10 * HOUR);
}

/** The week Easter Sunday is in. */
export function easterWeek(year) {
  return weekIdOf(easterSunday(year));
}

/**
 * The days a cabin week starts and ends on; the swap is at 12:00 on both.
 * An ordinary week runs from Friday to Friday. Around Easter the weeks follow the holidays, the way
 * the office voted that year (`easter` is 'long', 'split', or null while that is not settled):
 *
 *   long:  Easter is one stay, from the Friday before Palm Sunday to Easter Monday.
 *   split: Easter is two stays, Friday to Wednesday in Holy Week, and Wednesday to Easter Monday.
 *
 * Either way, the week after Easter is short: from Easter Monday to Friday.
 * Until the vote is counted, Easter is shown as the one long stay it may become.
 */
export function periodDays(id, easter = null) {
  const week = isoWeekOf(id);
  const monday = mondayOf(week);
  const at = (days) => new Date(monday.getTime() + days * DAY);
  const easterIn = easterWeek(Number(week.slice(0, 4)));

  if (week === easterIn && isSecondHalf(id)) return { from: at(2), to: at(7) };
  if (week === easterIn) return { from: at(-3), to: easter === 'split' ? at(2) : at(7) };
  if (week === addWeeks(easterIn, 1)) return { from: at(0), to: at(4) };
  return { from: at(-3), to: at(4) };
}

export function easterSunday(year) {
  // The anonymous Gregorian algorithm (Meeus, Jones, Butcher).
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

/** "fre. 19. – fre. 26. mars 2027", or without the year where a heading above already says it. */
export function formatRange(from, to, { year = true } = {}) {
  const day = (date) => `${WEEKDAYS[date.getUTCDay()]} ${date.getUTCDate()}.`;
  const month = (date) => MONTHS[date.getUTCMonth()];
  const sameYear = from.getUTCFullYear() === to.getUTCFullYear();
  const closing = year ? ` ${to.getUTCFullYear()}` : '';

  if (from.getUTCMonth() === to.getUTCMonth() && sameYear) return `${day(from)} – ${day(to)} ${month(to)}${closing}`;
  const opening = year && !sameYear ? ` ${from.getUTCFullYear()}` : '';
  return `${day(from)} ${month(from)}${opening} – ${day(to)} ${month(to)}${closing}`;
}

/** "fredag 8. januar 2027 kl. 12": when a swap is. */
export function formatSwap(day) {
  const weekday = ['søndag', 'mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lørdag'][day.getUTCDay()];
  return `${weekday} ${day.getUTCDate()}. ${MONTHS[day.getUTCMonth()]} ${day.getUTCFullYear()} kl. 12`;
}

/** The month a week is listed under: the one its middle night falls in. */
export function monthOf(from, to) {
  const middle = new Date(from.getTime() + Math.floor((to - from) / DAY / 2) * DAY);
  const name = MONTHS[middle.getUTCMonth()];
  return `${name[0].toUpperCase()}${name.slice(1)} ${middle.getUTCFullYear()}`;
}

/** "11. oktober 2026 kl. 15:42", in Norwegian time, from a stored moment. */
export function formatMoment(iso) {
  return osloMoment.format(new Date(iso));
}
