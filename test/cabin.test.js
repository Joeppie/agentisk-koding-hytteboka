import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  book, calendar, cancel, countVotes, currentPeriod, drawWinner, emptyState, enter, firstState, HORIZON, KEEP, markDraw,
  readName, sameName, unmarkDraw, vote, VOTE_CLOSES, withdraw,
} from '../src/cabin.js';
import { addWeeks } from '../src/weeks.js';

// The week the tests happen in: 12 to 18 October 2026.
const TODAY = '2026-W42';
const AUTUMN = '2026-W45';
const WINTER = '2027-W08';
const EASTER = '2027-W12';
const NOW = '2026-10-14T08:00:00.000Z';

const day = (text) => new Date(`${text}T00:00:00Z`);
const as = (name, week) => ({ name, week, today: TODAY, now: NOW });

/** A book where a winner is to be drawn for the winter break. */
function bookWithWinter(...entered) {
  const state = emptyState();
  state.draws[WINTER] = { label: 'Vinterferie', entries: [] };
  for (const name of entered) assert.equal(enter(state, as(name, WINTER)).ok, true);
  return state;
}

/** Checks that a rule said no, with the words it used, and left the book as it was. */
function refused(state, rule, wish, words, status = 409) {
  const before = structuredClone(state);
  const answer = rule(state, wish);
  assert.equal(answer.ok, false);
  assert.equal(answer.status, status);
  assert.match(answer.message, words);
  assert.deepEqual(state, before, 'a refused wish changes nothing');
}

describe('booking a week', () => {
  test('a free week goes to the one who books it', () => {
    const state = emptyState();
    assert.deepEqual(book(state, as('Ola Nordmann', AUTUMN)), { ok: true });
    assert.deepEqual(state.bookings[AUTUMN], { name: 'Ola Nordmann', at: NOW });
  });

  test('a week that is taken cannot be booked by someone else', () => {
    const state = emptyState();
    book(state, as('Ola Nordmann', AUTUMN));
    refused(state, book, as('Kari Hansen', AUTUMN), /Uke 45 er allerede booket av Ola Nordmann/);
    assert.equal(state.bookings[AUTUMN].name, 'Ola Nordmann');
  });

  test('the one who has the week is told so when they book it again', () => {
    const state = emptyState();
    book(state, as('Ola Nordmann', AUTUMN));
    refused(state, book, as('ola nordmann', AUTUMN), /Du har allerede uke 45/);
  });

  test('the week we are in can be booked, and the last of the 52', () => {
    const state = emptyState();
    assert.equal(book(state, as('Ola Nordmann', TODAY)).ok, true);
    assert.equal(book(state, as('Ola Nordmann', '2027-W40')).ok, true);
  });

  test('a week that is over, too far ahead or not a week cannot be booked', () => {
    const state = emptyState();
    refused(state, book, as('Ola Nordmann', '2026-W41'), /Uke 41 er over/);
    refused(state, book, as('Ola Nordmann', '2027-W41'), /for langt fram/);
    refused(state, book, as('Ola Nordmann', '2027-W53'), /finnes ikke/, 404);
    refused(state, book, as('Ola Nordmann', 'tull'), /finnes ikke/, 404);
  });

  test('nobody books without a name', () => {
    const state = emptyState();
    refused(state, book, as('', AUTUMN), /Skriv navnet ditt/, 400);
    refused(state, book, as('   ', AUTUMN), /Skriv navnet ditt/, 400);
    refused(state, book, as('x'.repeat(61), AUTUMN), /Skriv navnet ditt/, 400);
  });

  test('a name is the same however it is typed', () => {
    assert.equal(readName('  Ola \t Nordmann\n'), 'Ola Nordmann');
    assert.equal(sameName('Ola Nordmann', ' ola   NORDMANN '), true);
    assert.equal(sameName('Åse Ødegård', 'åse ødegård'), true);
    assert.equal(sameName('Ola Nordmann', 'Ola Normann'), false);
  });
});

describe('giving a week up', () => {
  test('the one who has the week can give it up, and then it is free', () => {
    const state = emptyState();
    book(state, as('Ola Nordmann', AUTUMN));
    assert.equal(cancel(state, as('ola nordmann', AUTUMN)).ok, true);
    assert.equal(state.bookings[AUTUMN], undefined);
    assert.equal(book(state, as('Kari Hansen', AUTUMN)).ok, true);
  });

  test('nobody gives up a week that is someone else’s', () => {
    const state = emptyState();
    book(state, as('Ola Nordmann', AUTUMN));
    refused(state, cancel, as('Kari Hansen', AUTUMN), /booket av Ola Nordmann, ikke av deg/, 403);
  });

  test('a week nobody has cannot be given up', () => {
    refused(emptyState(), cancel, as('Ola Nordmann', AUTUMN), /Uke 45 er ikke booket/);
  });
});

describe('entering a draw', () => {
  test('a week a winner is drawn for cannot be booked', () => {
    const state = bookWithWinter();
    refused(state, book, as('Ola Nordmann', WINTER), /Det trekkes lodd om uke 8/);
  });

  test('those who want the week enter, in the order they came', () => {
    const state = bookWithWinter('Ola Nordmann', 'Kari Hansen');
    assert.deepEqual(state.draws[WINTER].entries.map((entry) => entry.name), ['Ola Nordmann', 'Kari Hansen']);
    assert.equal(state.bookings[WINTER], undefined);
  });

  test('one person has one ticket', () => {
    const state = bookWithWinter('Ola Nordmann');
    refused(state, enter, as('OLA NORDMANN', WINTER), /Du er allerede påmeldt/);
  });

  test('someone who entered can leave again', () => {
    const state = bookWithWinter('Ola Nordmann', 'Kari Hansen');
    assert.equal(withdraw(state, as('ola nordmann', WINTER)).ok, true);
    assert.deepEqual(state.draws[WINTER].entries.map((entry) => entry.name), ['Kari Hansen']);
    refused(state, withdraw, as('Ola Nordmann', WINTER), /Du er ikke påmeldt/);
  });

  test('there is no draw to enter for an ordinary week', () => {
    refused(emptyState(), enter, as('Ola Nordmann', AUTUMN), /Det trekkes ikke lodd om uke 45/);
    refused(emptyState(), withdraw, as('Ola Nordmann', AUTUMN), /Det trekkes ikke lodd om uke 45/);
  });

  test('nobody enters without a name, or for a week that is over', () => {
    const state = bookWithWinter();
    refused(state, enter, as('', WINTER), /Skriv navnet ditt/, 400);
    state.draws['2026-W41'] = { label: '', entries: [] };
    refused(state, enter, as('Ola Nordmann', '2026-W41'), /Uke 41 er over/);
  });
});

describe('drawing the winner', () => {
  const people = ['Ola Nordmann', 'Kari Hansen', 'Per Olsen'];
  const draw = (state, pick) => drawWinner(state, { week: WINTER, today: TODAY, now: NOW, pick });

  test('the one whose ticket is picked gets the week', () => {
    const state = bookWithWinter(...people);
    const asked = [];
    const answer = draw(state, (count) => {
      asked.push(count);
      return 1;
    });

    assert.deepEqual(answer, { ok: true, winner: 1, entries: people });
    assert.deepEqual(asked, [3], 'one pick among the three tickets');
    assert.deepEqual(state.bookings[WINTER], { name: 'Kari Hansen', at: NOW });
    assert.equal(state.draws[WINTER].entries.length, 3, 'the tickets stay, to show who was in the draw');
  });

  test('every ticket can win', () => {
    for (const [index, name] of people.entries()) {
      const state = bookWithWinter(...people);
      draw(state, () => index);
      assert.equal(state.bookings[WINTER].name, name);
    }
  });

  test('left to itself, the draw gives everyone the same chance', () => {
    const wins = [0, 0, 0];
    for (let round = 0; round < 6000; round += 1) {
      const state = bookWithWinter(...people);
      wins[drawWinner(state, { week: WINTER, today: TODAY, now: NOW }).winner] += 1;
    }
    // 2000 each on average. Outside 1800 to 2200 is more than five standard deviations away.
    for (const count of wins) assert.ok(count > 1800 && count < 2200, `wins were ${wins}`);
  });

  test('a single ticket wins', () => {
    const state = bookWithWinter('Ola Nordmann');
    assert.equal(drawWinner(state, { week: WINTER, today: TODAY, now: NOW }).winner, 0);
    assert.equal(state.bookings[WINTER].name, 'Ola Nordmann');
  });

  test('there is nothing to draw before someone has entered', () => {
    refused(bookWithWinter(), drawWinner, { week: WINTER, today: TODAY, now: NOW }, /Ingen har meldt seg på/);
  });

  test('a winner is drawn once', () => {
    const state = bookWithWinter(...people);
    draw(state, () => 0);
    refused(state, drawWinner, { week: WINTER, today: TODAY, now: NOW, pick: () => 2 }, /er gjort. Uka gikk til Ola Nordmann/);
  });

  test('no winner is drawn for an ordinary week', () => {
    refused(emptyState(), drawWinner, { week: AUTUMN, today: TODAY, now: NOW }, /Det trekkes ikke lodd om uke 45/);
  });

  test('after the draw nobody enters, leaves or books the week', () => {
    const state = bookWithWinter(...people);
    draw(state, () => 0);
    refused(state, enter, as('Nina Berg', WINTER), /Trekningen om uke 8 er gjort/);
    refused(state, withdraw, as('Kari Hansen', WINTER), /Trekningen om uke 8 er gjort/);
    refused(state, book, as('Nina Berg', WINTER), /gikk til Ola Nordmann/);
  });

  test('a winner who gives the week up is out, and it is drawn again among the others', () => {
    const state = bookWithWinter(...people);
    draw(state, () => 0);
    refused(state, cancel, as('Kari Hansen', WINTER), /ikke av deg/, 403);

    assert.equal(cancel(state, as('Ola Nordmann', WINTER)).ok, true);
    assert.equal(state.bookings[WINTER], undefined);
    assert.deepEqual(state.draws[WINTER].entries.map((entry) => entry.name), ['Kari Hansen', 'Per Olsen']);

    refused(state, enter, as('Nina Berg', WINTER), /Påmeldingen til uke 8 er stengt/);
    refused(state, enter, as('Ola Nordmann', WINTER), /Påmeldingen til uke 8 er stengt/);
    assert.deepEqual(draw(state, () => 1), { ok: true, winner: 1, entries: ['Kari Hansen', 'Per Olsen'] });
    assert.equal(state.bookings[WINTER].name, 'Per Olsen');
  });

  test('a draw nobody is left in can be made an ordinary week again', () => {
    const state = bookWithWinter('Ola Nordmann');
    draw(state, () => 0);
    cancel(state, as('Ola Nordmann', WINTER));
    refused(state, drawWinner, { week: WINTER, today: TODAY, now: NOW }, /Ingen har meldt seg på/);
    assert.equal(unmarkDraw(state, { week: WINTER, today: TODAY }).ok, true);
  });
});

describe('choosing the weeks a winner is drawn for', () => {
  const choose = (week, label = '') => ({ week, label, today: TODAY });

  test('a free week can be set up for a draw, with a name', () => {
    const state = emptyState();
    assert.equal(markDraw(state, choose(AUTUMN, '  Høstferie ')).ok, true);
    assert.deepEqual(state.draws[AUTUMN], { label: 'Høstferie', entries: [] });
    refused(state, book, as('Ola Nordmann', AUTUMN), /Det trekkes lodd om uke 45/);
  });

  test('a week that is booked, or already set up, cannot be', () => {
    const state = emptyState();
    book(state, as('Ola Nordmann', AUTUMN));
    refused(state, markDraw, choose(AUTUMN), /allerede booket av Ola Nordmann/);
    markDraw(state, choose('2026-W46'));
    refused(state, markDraw, choose('2026-W46'), /Det trekkes allerede lodd om uke 46/);
  });

  test('a week that is over or does not exist cannot be, nor one with a name that is too long', () => {
    const state = emptyState();
    refused(state, markDraw, choose('2026-W41'), /er over/);
    refused(state, markDraw, choose('ingen uke'), /finnes ikke/, 404);
    refused(state, markDraw, choose(AUTUMN, 'x'.repeat(41)), /40 tegn/, 400);
  });

  test('a draw nobody has entered can be made an ordinary week again', () => {
    const state = bookWithWinter();
    assert.equal(unmarkDraw(state, choose(WINTER)).ok, true);
    assert.equal(state.draws[WINTER], undefined);
    assert.equal(book(state, as('Ola Nordmann', WINTER)).ok, true);
  });

  test('a draw someone has entered, or that is done, stays a draw', () => {
    const state = bookWithWinter('Ola Nordmann');
    refused(state, unmarkDraw, choose(WINTER), /1 har meldt seg på/);
    drawWinner(state, { week: WINTER, today: TODAY, now: NOW });
    refused(state, unmarkDraw, choose(WINTER), /Trekningen om uke 8 er gjort/);
    refused(state, unmarkDraw, choose(AUTUMN), /Det trekkes ikke lodd om uke 45/);
  });
});

describe('the book as it is shown', () => {
  test('the calendar is the 52 weeks from this one, each with what stands about it', () => {
    const state = bookWithWinter('Kari Hansen');
    book(state, as('Ola Nordmann', AUTUMN));
    const weeks = calendar(state, TODAY);

    assert.equal(weeks.length, HORIZON);
    assert.equal(weeks[0].week, TODAY);
    assert.equal(weeks.at(-1).week, '2027-W40');
    assert.deepEqual(weeks[0], { week: TODAY, from: day('2026-10-09'), to: day('2026-10-16'), booking: null, draw: null });
    assert.equal(weeks.find((entry) => entry.week === AUTUMN).booking.name, 'Ola Nordmann');
    assert.equal(weeks.find((entry) => entry.week === WINTER).draw.label, 'Vinterferie');
  });

  test('a new book has Easter and the winter break set up for a draw', () => {
    const state = firstState(new Date('2026-10-11T12:00:00Z'));
    assert.deepEqual(state.bookings, {});
    assert.deepEqual(state.draws, {
      '2027-W08': { label: 'Vinterferie', entries: [] },
      '2027-W12': { label: 'Påske', entries: [] },
    });
  });

  test('a new book takes this year’s weeks while they are still ahead', () => {
    const state = firstState(new Date('2027-01-11T12:00:00Z'));
    assert.deepEqual(Object.keys(state.draws), ['2027-W08', '2027-W12']);
  });

  test('a new book leaves out an Easter that is more than 52 weeks away', () => {
    // The week after Easter 2027. Easter 2028 is in week 15, 54 weeks later.
    const state = firstState(new Date('2027-03-29T12:00:00Z'));
    assert.deepEqual(Object.keys(state.draws), ['2028-W08']);
  });
});

describe('the log', () => {
  const what = (state) => state.log.map((entry) => `${entry.what} ${entry.name ?? ''}`.trim());

  test('every change is written down, with who and when', () => {
    const state = emptyState();
    book(state, as('Ola Nordmann', AUTUMN));
    cancel(state, as('Ola Nordmann', AUTUMN));
    markDraw(state, { week: WINTER, label: 'Vinterferie', today: TODAY, now: NOW, by: 'Gro Berg' });
    enter(state, as('Kari Hansen', WINTER));
    enter(state, as('per olsen', WINTER));
    withdraw(state, as('Per Olsen', WINTER));

    assert.deepEqual(what(state), [
      'book Ola Nordmann', 'cancel Ola Nordmann', 'markDraw', 'enter Kari Hansen', 'enter per olsen', 'withdraw per olsen',
    ]);
    assert.deepEqual(state.log[2], { at: NOW, week: WINTER, what: 'markDraw', by: 'Gro Berg' });
  });

  test('a draw is written down so anyone can check it: who was in it, who won, and who pressed', () => {
    const state = bookWithWinter('Ola Nordmann', 'Kari Hansen');
    drawWinner(state, { week: WINTER, today: TODAY, now: NOW, by: 'Gro Berg', pick: () => 1 });
    assert.deepEqual(state.log.at(-1), {
      at: NOW, week: WINTER, what: 'draw', name: 'Kari Hansen', by: 'Gro Berg', entries: ['Ola Nordmann', 'Kari Hansen'], winner: 1,
    });
  });

  test('a refusal writes nothing', () => {
    const state = bookWithWinter('Ola Nordmann');
    const before = state.log.length;
    refused(state, enter, as('Ola Nordmann', WINTER), /allerede påmeldt/);
    assert.equal(state.log.length, before);
  });

  test('a year after a week is over, everything about it is forgotten', () => {
    const state = emptyState();
    book(state, as('Ola Nordmann', AUTUMN));
    state.draws[AUTUMN] = { label: '', entries: [] };
    const atNow = (week, today) => ({ name: 'Per Olsen', week, today, now: NOW });

    book(state, atNow(addWeeks(AUTUMN, KEEP + 1), addWeeks(AUTUMN, KEEP)));
    assert.deepEqual(what(state), ['book Ola Nordmann', 'book Per Olsen'], `kept for ${KEEP} weeks after`);

    book(state, atNow(addWeeks(AUTUMN, KEEP + 2), addWeeks(AUTUMN, KEEP + 1)));
    assert.deepEqual(what(state), ['book Per Olsen', 'book Per Olsen'], 'then forgotten');
    assert.deepEqual(Object.keys(state.bookings), [addWeeks(AUTUMN, KEEP + 1), addWeeks(AUTUMN, KEEP + 2)]);
    assert.deepEqual(state.draws, {});
  });
});

describe('the vote on how Easter is cut', () => {
  // Easter 2027 is in week 12, so the vote closes when week 2 starts, on Friday 8 January.
  const CLOSED = '2027-W02';
  const ballot = (name, choice, today = TODAY) => ({ week: EASTER, name, choice, today, now: NOW });
  const count = (today = CLOSED, by = 'Gro Berg') => ({ week: EASTER, today, now: NOW, by });

  /** A book with Easter set up for a draw, and these votes cast: [name, choice] pairs. */
  function bookWithVotes(...votes) {
    const state = emptyState();
    state.draws[EASTER] = { label: 'Påske', entries: [] };
    for (const [name, choice] of votes) assert.equal(vote(state, ballot(name, choice)).ok, true);
    return state;
  }

  test('it closes ten weeks before Easter', () => {
    assert.equal(VOTE_CLOSES, 10);
    assert.equal(calendar(emptyState(), TODAY).find((entry) => entry.week === EASTER).vote.closes, CLOSED);
  });

  test('everyone has one vote, and can change it until the vote closes', () => {
    const state = bookWithVotes(['Ola Nordmann', 'long'], ['Kari Hansen', 'split']);
    refused(state, vote, ballot('ola nordmann', 'long'), /Du har allerede stemt på det/);
    assert.equal(vote(state, ballot('ola nordmann', 'split')).ok, true);
    assert.deepEqual(state.votes[EASTER].entries.map((entry) => `${entry.name} ${entry.choice}`), [
      'Kari Hansen split', 'ola nordmann split',
    ]);
  });

  test('nobody votes after it has closed, without a name, or for something else', () => {
    const state = bookWithVotes();
    refused(state, vote, ballot('Ola Nordmann', 'long', CLOSED), /Avstemningen om påsken er stengt/);
    refused(state, vote, ballot('', 'long'), /Skriv navnet ditt/, 400);
    refused(state, vote, ballot('Ola Nordmann', 'tre dager'), /Velg én lang påske eller påsken delt i to/, 400);
  });

  test('only Easter itself is voted on', () => {
    const state = bookWithVotes();
    refused(state, vote, { ...ballot('Ola Nordmann', 'long'), week: '2027-W13' }, /ingen påske den uka/, 404);
    refused(state, vote, { ...ballot('Ola Nordmann', 'long'), week: '2027-W12b' }, /ingen påske den uka/, 404);
    refused(state, countVotes, { ...count(), week: WINTER }, /ingen påske den uka/, 404);
  });

  test('the votes are counted once the vote has closed, and not before', () => {
    const state = bookWithVotes(['Ola Nordmann', 'long']);
    refused(state, countVotes, count(addWeeks(CLOSED, -1)), /telles når avstemningen stenger, fredag 8\. januar 2027 kl\. 12/);
    assert.deepEqual(countVotes(state, count()), { ok: true, choice: 'long', long: 1, split: 0 });
  });

  test('once counted, the result stands: nobody counts again or votes after', () => {
    const state = bookWithVotes(['Ola Nordmann', 'long']);
    countVotes(state, count());
    refused(state, countVotes, count(), /alt talt opp/);
    refused(state, vote, ballot('Kari Hansen', 'split'), /Avstemningen om påsken er stengt/);
  });

  test('the most votes win, and a tie or no votes splits Easter', () => {
    const result = (...votes) => {
      const state = bookWithVotes(...votes);
      return countVotes(state, count()).choice;
    };
    assert.equal(result(['Ola Nordmann', 'long'], ['Kari Hansen', 'long'], ['Per Olsen', 'split']), 'long');
    assert.equal(result(['Ola Nordmann', 'split'], ['Kari Hansen', 'split'], ['Per Olsen', 'long']), 'split');
    assert.equal(result(['Ola Nordmann', 'long'], ['Kari Hansen', 'split']), 'split');
    assert.equal(result(), 'split');
  });

  test('Easter cannot be booked or drawn for until the votes are counted', () => {
    const state = bookWithVotes();
    refused(state, enter, as('Ola Nordmann', EASTER), /før stemmene om hvordan den skal deles, er talt opp/);
    unmarkDraw(state, { week: EASTER, today: TODAY });
    refused(state, book, as('Ola Nordmann', EASTER), /før stemmene om hvordan den skal deles, er talt opp/);
    assert.equal(book(state, as('Ola Nordmann', '2027-W13')).ok, true, 'the short week after Easter is the same either way');
  });

  test('a long Easter is one draw, from the Friday before Palm Sunday to Easter Monday', () => {
    const state = bookWithVotes(['Ola Nordmann', 'long']);
    countVotes(state, count());
    assert.deepEqual(Object.keys(state.draws), [EASTER]);
    const easter = calendar(state, CLOSED).filter((entry) => entry.week.startsWith('2027-W12'));
    assert.deepEqual(easter.map((entry) => [entry.week, entry.from, entry.to]), [[EASTER, day('2027-03-19'), day('2027-03-29')]]);
    assert.equal(enter(state, { ...as('Kari Hansen', EASTER), today: CLOSED }).ok, true);
    refused(state, enter, { ...as('Kari Hansen', `${EASTER}b`), today: CLOSED }, /finnes ikke/, 404);
  });

  test('a split Easter is two draws, each with its own tickets', () => {
    const state = bookWithVotes(['Ola Nordmann', 'split']);
    countVotes(state, count());
    assert.deepEqual(state.draws, {
      [EASTER]: { label: 'Påske, første del', entries: [] },
      [`${EASTER}b`]: { label: 'Påske, andre del', entries: [] },
    });
    const easter = calendar(state, CLOSED).filter((entry) => entry.week.startsWith('2027-W12'));
    assert.deepEqual(easter.map((entry) => [entry.week, entry.from, entry.to]), [
      [EASTER, day('2027-03-19'), day('2027-03-24')],
      [`${EASTER}b`, day('2027-03-24'), day('2027-03-29')],
    ]);

    const at = (name, week) => ({ ...as(name, week), today: CLOSED });
    enter(state, at('Kari Hansen', EASTER));
    enter(state, at('Per Olsen', `${EASTER}b`));
    enter(state, at('Kari Hansen', `${EASTER}b`));
    assert.equal(drawWinner(state, { week: EASTER, today: CLOSED, now: NOW, pick: () => 0 }).ok, true);
    assert.equal(drawWinner(state, { week: `${EASTER}b`, today: CLOSED, now: NOW, pick: () => 0 }).ok, true);
    assert.equal(state.bookings[EASTER].name, 'Kari Hansen');
    assert.equal(state.bookings[`${EASTER}b`].name, 'Per Olsen');
  });

  test('every vote and the count are written down; a refusal is not', () => {
    const state = bookWithVotes(['Ola Nordmann', 'long'], ['Kari Hansen', 'split']);
    refused(state, vote, ballot('Kari Hansen', 'split'), /allerede stemt/);
    countVotes(state, count());
    assert.deepEqual(state.log, [
      { at: NOW, week: EASTER, what: 'vote', name: 'Ola Nordmann', choice: 'long' },
      { at: NOW, week: EASTER, what: 'vote', name: 'Kari Hansen', choice: 'split' },
      { at: NOW, week: EASTER, what: 'countVotes', by: 'Gro Berg', choice: 'split', long: 1, split: 1 },
    ]);
  });

  test('a year after Easter is over, the votes are forgotten too', () => {
    const state = bookWithVotes(['Ola Nordmann', 'long']);
    book(state, { name: 'Per Olsen', week: addWeeks(EASTER, KEEP + 2), today: addWeeks(EASTER, KEEP + 1), now: NOW });
    assert.deepEqual(state.votes, {});
  });
});

describe('the week going on now', () => {
  test('a week ends on Friday at noon in Norway', () => {
    const state = emptyState();
    assert.equal(currentPeriod(state, new Date('2026-10-16T09:59:59Z')), '2026-W42');
    assert.equal(currentPeriod(state, new Date('2026-10-16T10:00:00Z')), '2026-W43');
    assert.equal(currentPeriod(state, new Date('2026-10-18T20:00:00Z')), '2026-W43', 'the weekend is the next week');
    // Winter time: noon in Oslo is 11:00 UTC.
    assert.equal(currentPeriod(state, new Date('2027-01-08T10:59:59Z')), '2027-W01');
    assert.equal(currentPeriod(state, new Date('2027-01-08T11:00:00Z')), '2027-W02');
  });

  test('a split Easter swaps on Wednesday, and Easter ends on Easter Monday at noon', () => {
    const state = emptyState();
    state.votes[EASTER] = { entries: [], result: { choice: 'split', long: 0, split: 0, at: NOW } };
    assert.equal(currentPeriod(state, new Date('2027-03-24T10:59:59Z')), EASTER);
    assert.equal(currentPeriod(state, new Date('2027-03-24T11:00:00Z')), `${EASTER}b`);
    assert.equal(currentPeriod(state, new Date('2027-03-29T09:59:59Z')), `${EASTER}b`);
    assert.equal(currentPeriod(state, new Date('2027-03-29T10:00:00Z')), '2027-W13');
  });

  test('once Easter is split, its first half is over when the second starts', () => {
    const state = emptyState();
    state.votes[EASTER] = { entries: [], result: { choice: 'split', long: 0, split: 0, at: NOW } };
    refused(state, book, { ...as('Ola Nordmann', EASTER), today: `${EASTER}b` }, /Uke 12 er over/);
    assert.equal(book(state, { ...as('Ola Nordmann', `${EASTER}b`), today: `${EASTER}b` }).ok, true);
  });
});
