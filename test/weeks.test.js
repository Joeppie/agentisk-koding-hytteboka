import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  addWeeks, currentWeek, easterSunday, formatMoment, formatRange, formatSwap, isoWeekOf, isPeriodId, isWeekId, mondayOf,
  monthOf, noonInOslo, periodDays, weekIdOf, weekNumber, weeksFrom,
} from '../src/weeks.js';

const day = (text) => new Date(`${text}T00:00:00Z`);
const iso = (date) => date.toISOString().slice(0, 10);

test('a week runs from Monday to Sunday', () => {
  assert.equal(weekIdOf(day('2026-10-11')), '2026-W41');
  assert.equal(weekIdOf(day('2026-10-12')), '2026-W42');
  assert.equal(weekIdOf(day('2026-10-18')), '2026-W42');
  assert.equal(weekIdOf(day('2026-10-19')), '2026-W43');
});

test('the days around New Year belong to the week they are in, not the year', () => {
  assert.equal(weekIdOf(day('2026-12-31')), '2026-W53');
  assert.equal(weekIdOf(day('2027-01-03')), '2026-W53');
  assert.equal(weekIdOf(day('2027-01-04')), '2027-W01');
  assert.equal(weekIdOf(day('2024-12-30')), '2025-W01');
});

test('a week starts on its Monday', () => {
  assert.equal(iso(mondayOf('2026-W42')), '2026-10-12');
  assert.equal(iso(mondayOf('2027-W12')), '2027-03-22');
  assert.equal(iso(mondayOf('2026-W53')), '2026-12-28');
  assert.equal(iso(mondayOf('2027-W01')), '2027-01-04');
});

test('only weeks that exist are weeks', () => {
  assert.equal(isWeekId('2026-W53'), true);
  assert.equal(isWeekId('2027-W53'), false, '2027 has 52 weeks');
  assert.equal(isWeekId('2027-W00'), false);
  assert.equal(isWeekId('2027-W1'), false);
  assert.equal(isWeekId('uke 12'), false);
  assert.equal(isWeekId(undefined), false);
});

test('weeks are counted across New Year', () => {
  assert.equal(addWeeks('2026-W52', 2), '2027-W01');
  assert.deepEqual(weeksFrom('2026-W52', 3), ['2026-W52', '2026-W53', '2027-W01']);
  assert.equal(weekNumber('2027-W08'), 8);
});

test('weeks sort as text', () => {
  const weeks = weeksFrom('2026-W40', 70);
  assert.deepEqual([...weeks].sort(), weeks);
});

test('the week changes at midnight in Norway', () => {
  // Summer time: midnight in Oslo is 22:00 UTC.
  assert.equal(currentWeek(new Date('2026-10-11T21:59:59Z')), '2026-W41');
  assert.equal(currentWeek(new Date('2026-10-11T22:00:00Z')), '2026-W42');
  // Winter time: midnight in Oslo is 23:00 UTC.
  assert.equal(currentWeek(new Date('2027-01-03T22:59:59Z')), '2026-W53');
  assert.equal(currentWeek(new Date('2027-01-03T23:00:00Z')), '2027-W01');
});

test('Easter Sunday falls where the almanac says', () => {
  assert.equal(iso(easterSunday(2025)), '2025-04-20');
  assert.equal(iso(easterSunday(2026)), '2026-04-05');
  assert.equal(iso(easterSunday(2027)), '2027-03-28');
  assert.equal(iso(easterSunday(2028)), '2028-04-16');
  assert.equal(iso(easterSunday(2038)), '2038-04-25');
});

const days = (id, easter) => {
  const { from, to } = periodDays(id, easter);
  return `${iso(from)} ${iso(to)}`;
};

test('a cabin week runs from the Friday before its Monday to its Friday', () => {
  assert.equal(days('2026-W42'), '2026-10-09 2026-10-16');
  assert.equal(days('2027-W08'), '2027-02-19 2027-02-26');
  assert.equal(days('2027-W01'), '2027-01-01 2027-01-08');
  assert.equal(days('2027-W11'), '2027-03-12 2027-03-19', 'the week before Easter ends where Easter starts');
});

test('Easter is one long stay, or two halves that swap on the Wednesday', () => {
  // Easter Sunday 2027 is 28 March: Palm Sunday is the 21st, Easter Monday the 29th.
  assert.equal(days('2027-W12', 'long'), '2027-03-19 2027-03-29');
  assert.equal(days('2027-W12', 'split'), '2027-03-19 2027-03-24');
  assert.equal(days('2027-W12b', 'split'), '2027-03-24 2027-03-29');
  assert.equal(days('2027-W12', null), '2027-03-19 2027-03-29', 'until the vote is counted, Easter shows as one stay');
  // Either way the week after is short, from Easter Monday to Friday.
  assert.equal(days('2027-W13', 'long'), '2027-03-29 2027-04-02');
  assert.equal(days('2027-W13', 'split'), '2027-03-29 2027-04-02');
  // A late Easter: Easter Sunday 2038 is 25 April.
  assert.equal(days('2038-W16', 'long'), '2038-04-16 2038-04-26');
  assert.equal(days('2038-W16b', 'split'), '2038-04-21 2038-04-26');
});

test('only Easter has a second half', () => {
  assert.equal(isPeriodId('2027-W12'), true);
  assert.equal(isPeriodId('2027-W12b'), true);
  assert.equal(isPeriodId('2027-W13b'), false);
  assert.equal(isPeriodId('2027-W12c'), false);
  assert.equal(isPeriodId('2027-W53b'), false);
  assert.deepEqual(['2027-W13', '2027-W12b', '2027-W12'].sort(), ['2027-W12', '2027-W12b', '2027-W13']);
  assert.equal(weekNumber('2027-W12b'), 12);
  assert.equal(isoWeekOf('2027-W12b'), '2027-W12');
});

test('the swap is at noon in Norway, summer and winter', () => {
  assert.equal(noonInOslo(day('2027-01-08')).toISOString(), '2027-01-08T11:00:00.000Z');
  assert.equal(noonInOslo(day('2027-03-29')).toISOString(), '2027-03-29T10:00:00.000Z');
  assert.equal(noonInOslo(day('2026-10-23')).toISOString(), '2026-10-23T10:00:00.000Z');
  assert.equal(noonInOslo(day('2026-10-30')).toISOString(), '2026-10-30T11:00:00.000Z');
});

test('a week is written with its days', () => {
  const range = (id, options) => formatRange(...Object.values(periodDays(id)), options);
  assert.equal(range('2026-W42'), 'fre. 9. – fre. 16. oktober 2026');
  assert.equal(range('2026-W45'), 'fre. 30. oktober – fre. 6. november 2026');
  assert.equal(range('2027-W01'), 'fre. 1. – fre. 8. januar 2027');
  assert.equal(range('2026-W53'), 'fre. 25. desember 2026 – fre. 1. januar 2027');
  assert.equal(range('2026-W53', { year: false }), 'fre. 25. desember – fre. 1. januar');
  assert.equal(formatSwap(day('2027-01-08')), 'fredag 8. januar 2027 kl. 12');
});

test('a week is listed under the month its middle night falls in', () => {
  const month = (id) => monthOf(...Object.values(periodDays(id)));
  assert.equal(month('2026-W45'), 'November 2026');
  assert.equal(month('2026-W53'), 'Desember 2026');
  assert.equal(month('2027-W01'), 'Januar 2027');
});

test('a moment is written in Norwegian time', () => {
  const text = formatMoment('2026-10-11T13:42:00.000Z');
  assert.match(text, /11\. oktober 2026/);
  assert.match(text, /15[:.]42/);
});
