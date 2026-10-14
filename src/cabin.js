// The rules of the cabin book.
//
// Everything that is stored is one object:
//
//   bookings: { [week]: { name, at } }                       who has the cabin that week
//   draws:    { [week]: { label, entries: [{ name, at }], closed? } } the weeks a winner is drawn for
//   votes:    { [easter]: { entries: [{ name, choice, at }], result? } } how that year's Easter is cut
//   log:      [{ at, week, what, name?, by?, entries?, winner?, choice?, long?, split? }] what was done, oldest first
//
// A week has at most one booking, since bookings are kept by week.
// A draw is done when its week has a booking: that booking is the winner, and its `at` is when it was drawn.
// A draw is `closed` once a winner has given the week up: it is drawn again among those who were in it,
// and nobody can enter after seeing who won the first time.
//
// A week is written as in weeks.js: "2027-W08", or "2027-W12b" for the second half of a split Easter.
//
// Each year the office votes on how Easter is cut: one long stay ('long') or two shorter ones ('split').
// Everyone has one vote, which they can change until the vote closes VOTE_CLOSES weeks before Easter.
// Then anyone can count it, once, and the result is kept in `result`. A tie, or no votes, splits Easter,
// so that more people get some of it. Until it is counted, nobody can book Easter or enter its draw,
// since nobody yet knows which days they would be getting.
//
// The log is there so anyone can see afterwards that bookings and draws went as they should.
// It holds only what that needs: the week, what was done, the names involved and when. Each rule that
// says yes adds to it; a refusal adds nothing. `by` is the name of whoever pressed, where that is not the
// person the change is about. Nothing about a week is kept more than KEEP weeks after it is over.
//
// Each rule takes the state and what someone wants, and either changes the state and answers
// { ok: true }, or leaves it as it was and answers { ok: false, status, message } with words for the person.

import { randomInt } from 'node:crypto';
import {
  addWeeks, currentWeek, easterWeek, isoWeekOf, isPeriodId, isSecondHalf, formatSwap, noonInOslo, periodDays, weekNumber,
  weeksFrom,
} from './weeks.js';

/** How many weeks are shown and can be booked, counting the one we are in. */
export const HORIZON = 52;

/** How many weeks after a week is over everything about it is kept: long enough to settle a complaint about it. */
export const KEEP = 52;

/** How many weeks before Easter the vote on how to cut it closes: time to enter the draw and plan the trip. */
export const VOTE_CLOSES = 10;

/** The ways Easter can be cut, as the vote names them. */
export const CHOICES = ['long', 'split'];

const NAME_LENGTH = 60;
const LABEL_LENGTH = 40;

export function emptyState() {
  return { bookings: {}, draws: {}, votes: {}, log: [] };
}

/** What the book holds the first time it is opened: the weeks Gro named, set up for a draw. */
export function firstState(now = new Date()) {
  const state = emptyState();
  const today = currentWeek(now);
  const year = Number(today.slice(0, 4));
  const next = (weekIn) => [weekIn(year), weekIn(year + 1)].find((week) => isOpen(week, today));

  const winterBreak = next((y) => `${y}-W08`);
  const easter = next(easterWeek);
  if (winterBreak) state.draws[winterBreak] = { label: 'Vinterferie', entries: [] };
  if (easter) state.draws[easter] = { label: 'Påske', entries: [] };
  return state;
}

/** A name as someone typed it, tidied. Empty when it cannot be used as a name. */
export function readName(text) {
  const name = tidy(text);
  return name.length <= NAME_LENGTH ? name : '';
}

export function sameName(a, b) {
  return tidy(a).toLocaleLowerCase('nb') === tidy(b).toLocaleLowerCase('nb');
}

export function isEntered(draw, name) {
  return draw.entries.some((entry) => sameName(entry.name, name));
}

/** The weeks from this one on, each with what stands in the book about it. */
export function calendar(state, today) {
  return weeksFrom(isoWeekOf(today), HORIZON)
    .flatMap((week) => (easterCut(state, week) === 'split' && isEasterWeek(week) ? [week, `${week}b`] : [week]))
    .filter((week) => week >= today)
    .map((week) => describe(state, week));
}

/** What stands in the book about a week, and the days it runs. Easter's own week also has its vote. */
export function describe(state, week) {
  const entry = { week, ...periodDays(week, easterCut(state, week)), booking: state.bookings[week] ?? null, draw: state.draws[week] ?? null };
  if (isEasterWeek(week) && !isSecondHalf(week)) entry.vote = voteOn(state, week);
  return entry;
}

/** The cabin week going on at this moment. */
export function currentPeriod(state, now = new Date()) {
  const week = currentWeek(now);
  const before = addWeeks(week, -1);
  const candidates = [before, `${before}b`, week, `${week}b`, addWeeks(week, 1)].filter((id) => exists(state, id));
  return candidates.find((id) => {
    const { from, to } = periodDays(id, easterCut(state, id));
    return noonInOslo(from) <= now && now < noonInOslo(to);
  });
}

/** The vote on how Easter is cut that year: everyone's vote, when it closes, and the result once it is counted. */
export function voteOn(state, easter) {
  const vote = state.votes?.[easter] ?? { entries: [] };
  return { ...vote, closes: addWeeks(easter, -VOTE_CLOSES), result: vote.result ?? null };
}

/** How Easter is cut in the year of a week: 'long', 'split', or null while the vote is not counted. */
export function easterCut(state, week) {
  return state.votes?.[easterOf(week)]?.result?.choice ?? null;
}

export function book(state, { week, name, today, now }) {
  const problem = weekProblem(state, week, today) ?? nameProblem(name) ?? uncutProblem(state, week);
  if (problem) return problem;

  const booking = state.bookings[week];
  if (state.draws[week]) {
    return booking
      ? refuse(`Det er trukket lodd om ${uke(week)}, og den gikk til ${booking.name}.`)
      : refuse(`Det trekkes lodd om ${uke(week)}. Meld deg på trekningen i stedet.`);
  }
  if (booking) {
    return sameName(booking.name, name)
      ? refuse(`Du har allerede ${uke(week)}.`)
      : refuse(`${Uke(week)} er allerede booket av ${booking.name}.`);
  }

  state.bookings[week] = { name: readName(name), at: now };
  record(state, today, { at: now, week, what: 'book', name: readName(name) });
  return done();
}

/** Giving a week up. A week that was won in a draw goes back to be drawn among the others. */
export function cancel(state, { week, name, today, now }) {
  const problem = weekProblem(state, week, today) ?? nameProblem(name);
  if (problem) return problem;

  const booking = state.bookings[week];
  if (!booking) return refuse(`${Uke(week)} er ikke booket.`);
  if (!sameName(booking.name, name)) return refuse(`${Uke(week)} er booket av ${booking.name}, ikke av deg.`, 403);

  delete state.bookings[week];
  const draw = state.draws[week];
  if (draw) {
    draw.entries = draw.entries.filter((entry) => !sameName(entry.name, name));
    draw.closed = true;
  }
  record(state, today, { at: now, week, what: 'cancel', name: booking.name });
  return done();
}

export function enter(state, { week, name, today, now }) {
  const problem = weekProblem(state, week, today) ?? nameProblem(name) ?? drawProblem(state, week) ?? uncutProblem(state, week);
  if (problem) return problem;

  const draw = state.draws[week];
  if (isEntered(draw, name)) return refuse(`Du er allerede påmeldt trekningen om ${uke(week)}.`);
  if (draw.closed) return refuse(`Påmeldingen til ${uke(week)} er stengt. Den trekkes på nytt blant dem som var med.`);

  draw.entries.push({ name: readName(name), at: now });
  record(state, today, { at: now, week, what: 'enter', name: readName(name) });
  return done();
}

export function withdraw(state, { week, name, today, now }) {
  const problem = weekProblem(state, week, today) ?? nameProblem(name) ?? drawProblem(state, week);
  if (problem) return problem;

  const draw = state.draws[week];
  if (!isEntered(draw, name)) return refuse(`Du er ikke påmeldt trekningen om ${uke(week)}.`);

  const leaving = draw.entries.find((entry) => sameName(entry.name, name));
  draw.entries = draw.entries.filter((entry) => entry !== leaving);
  record(state, today, { at: now, week, what: 'withdraw', name: leaving.name });
  return done();
}

/**
 * Draws the winner: one of those entered, each with the same chance, and books the week for them.
 * `pick(count)` answers a whole number from 0 up to, not including, count.
 */
export function drawWinner(state, { week, today, now, by, pick = randomInt }) {
  const problem = weekProblem(state, week, today) ?? drawProblem(state, week) ?? uncutProblem(state, week);
  if (problem) return problem;

  const { entries } = state.draws[week];
  if (entries.length === 0) return refuse(`Ingen har meldt seg på trekningen om ${uke(week)} ennå.`);

  const winner = pick(entries.length);
  const names = entries.map((entry) => entry.name);
  state.bookings[week] = { name: names[winner], at: now };
  record(state, today, { at: now, week, what: 'draw', name: names[winner], by: byName(by), entries: names, winner });
  return done({ winner, entries: names });
}

export function markDraw(state, { week, label, today, now, by }) {
  const problem = weekProblem(state, week, today);
  if (problem) return problem;

  const title = tidy(label);
  if (title.length > LABEL_LENGTH) return refuse(`Navnet på uka kan være på ${LABEL_LENGTH} tegn.`, 400);
  if (state.draws[week]) return refuse(`Det trekkes allerede lodd om ${uke(week)}.`);
  const booking = state.bookings[week];
  if (booking) return refuse(`${Uke(week)} er allerede booket av ${booking.name}, så den kan det ikke trekkes lodd om.`);

  state.draws[week] = { label: title, entries: [] };
  record(state, today, { at: now, week, what: 'markDraw', by: byName(by) });
  return done();
}

export function unmarkDraw(state, { week, today, now, by }) {
  const problem = weekProblem(state, week, today) ?? drawProblem(state, week);
  if (problem) return problem;

  const count = state.draws[week].entries.length;
  if (count > 0) {
    return refuse(`${count} har meldt seg på trekningen om ${uke(week)}, så den kan ikke gjøres om til en vanlig uke.`);
  }

  delete state.draws[week];
  record(state, today, { at: now, week, what: 'unmarkDraw', by: byName(by) });
  return done();
}

/**
 * A vote on how Easter is cut. One vote per person: voting again changes it.
 * `week` is Easter's own week, and `choice` is one of CHOICES.
 */
export function vote(state, { week, name, choice, today, now }) {
  const problem = easterProblem(state, week, today) ?? nameProblem(name);
  if (problem) return problem;
  if (!CHOICES.includes(choice)) return refuse('Velg én lang påske eller påsken delt i to.', 400);

  const ballot = state.votes?.[week] ?? { entries: [] };
  if (ballot.result || today >= addWeeks(week, -VOTE_CLOSES)) return refuse('Avstemningen om påsken er stengt.');

  const earlier = ballot.entries.find((entry) => sameName(entry.name, name));
  if (earlier?.choice === choice) return refuse('Du har allerede stemt på det.');
  const entries = [...ballot.entries.filter((entry) => entry !== earlier), { name: readName(name), choice, at: now }];
  (state.votes ??= {})[week] = { ...ballot, entries };
  record(state, today, { at: now, week, what: 'vote', name: readName(name), choice });
  return done();
}

/**
 * Counts the vote on how Easter is cut, once it has closed. It can be counted once, and then it stands.
 * The most votes win; a tie splits Easter. A split Easter that is drawn for, is drawn for in two halves.
 */
export function countVotes(state, { week, today, now, by }) {
  const problem = easterProblem(state, week, today);
  if (problem) return problem;

  const closes = addWeeks(week, -VOTE_CLOSES);
  const ballot = state.votes?.[week] ?? { entries: [] };
  if (ballot.result) return refuse('Stemmene om påsken er alt talt opp.');
  if (today < closes) return refuse(`Stemmene telles når avstemningen stenger, ${swapAt(state, closes)}.`);

  const long = ballot.entries.filter((entry) => entry.choice === 'long').length;
  const split = ballot.entries.length - long;
  const choice = long > split ? 'long' : 'split';
  (state.votes ??= {})[week] = { ...ballot, result: { choice, long, split, at: now } };

  const draw = state.draws[week];
  if (choice === 'split' && draw) {
    const label = draw.label;
    draw.label = label && `${label}, første del`;
    state.draws[`${week}b`] = { label: label && `${label}, andre del`, entries: [] };
  }
  record(state, today, { at: now, week, what: 'countVotes', by: byName(by), choice, long, split });
  return done({ choice, long, split });
}

/** When a week starts, as words: "fredag 8. januar 2027 kl. 12". */
export function swapAt(state, week) {
  return formatSwap(periodDays(week, easterCut(state, week)).from);
}

export function uke(week) {
  return `uke ${weekNumber(week)}${isSecondHalf(week) ? ', del 2' : ''}`;
}

export function Uke(week) {
  return `Uke ${weekNumber(week)}${isSecondHalf(week) ? ', del 2' : ''}`;
}

/** Writes down what was done, and forgets every week that has been over for more than KEEP weeks. */
function record(state, today, entry) {
  const oldest = addWeeks(isoWeekOf(today), -KEEP);
  state.log = (state.log ?? []).filter((earlier) => earlier.week >= oldest);
  state.log.push(entry);
  for (const week of Object.keys(state.bookings)) if (week < oldest) delete state.bookings[week];
  for (const week of Object.keys(state.draws)) if (week < oldest) delete state.draws[week];
  for (const week of Object.keys(state.votes ?? {})) if (week < oldest) delete state.votes[week];
}

/** Who pressed, when they gave a name. Nothing is written when they did not. */
function byName(by) {
  return readName(by) || undefined;
}

function isOpen(week, today) {
  return week >= today && week < addWeeks(isoWeekOf(today), HORIZON);
}

function easterOf(week) {
  return easterWeek(Number(week.slice(0, 4)));
}

function isEasterWeek(week) {
  return isoWeekOf(week) === easterOf(week);
}

/** Whether a week is in the book: the second half of Easter is there only when Easter is split. */
function exists(state, week) {
  return isPeriodId(week) && (!isSecondHalf(week) || easterCut(state, week) === 'split');
}

function weekProblem(state, week, today) {
  if (!exists(state, week)) return refuse('Den uka finnes ikke.', 404);
  if (week < today) return refuse(`${Uke(week)} er over.`);
  if (!isOpen(week, today)) return refuse(`${Uke(week)} er for langt fram til å stå i boka ennå.`);
  return null;
}

/** Why there is nothing to vote on or count for this week: it is not Easter, or not one that is open. */
function easterProblem(state, week, today) {
  if (!isPeriodId(week) || isSecondHalf(week) || !isEasterWeek(week)) return refuse('Det er ingen påske den uka.', 404);
  return weekProblem(state, week, today);
}

/** Why Easter cannot be booked or drawn yet: nobody knows which days it is until the vote is counted. */
function uncutProblem(state, week) {
  if (!isEasterWeek(week) || easterCut(state, week)) return null;
  return refuse('Påsken kan ikke bookes eller trekkes før stemmene om hvordan den skal deles, er talt opp.');
}

function nameProblem(name) {
  return readName(name) ? null : refuse('Skriv navnet ditt først.', 400);
}

/** Why nobody can enter, leave or draw: there is no draw for the week, or it is done. */
function drawProblem(state, week) {
  if (!state.draws[week]) return refuse(`Det trekkes ikke lodd om ${uke(week)}.`);
  const booking = state.bookings[week];
  if (booking) return refuse(`Trekningen om ${uke(week)} er gjort. Uka gikk til ${booking.name}.`);
  return null;
}

function tidy(text) {
  return String(text ?? '')
    .normalize('NFC')
    .replace(/[\p{Cc}\s]+/gu, ' ')
    .trim();
}

function refuse(message, status = 409) {
  return { ok: false, status, message };
}

function done(more = {}) {
  return { ok: true, ...more };
}
