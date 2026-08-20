const { test } = require('node:test');
const assert = require('node:assert');

const { selectComparisonSave } = require('../server/saveComparison');

// Terra Invicta writes an ExitSave seconds after the last Autosave, and
// Autosave/Autosave2 can land in the same in-game moment. Comparing against the
// immediately-previous file therefore reports "0 game days elapsed, no material
// change" -- true, and useless.
const save = (name, mtime, fullPath = null) => ({
  name,
  fullPath: fullPath || `F:/saves/${name}`,
  lastModified: new Date(mtime)
});

/** Reads in-game dates from a lookup, counting how many files were opened. */
function reader(gameTimes) {
  const opened = [];
  const read = (candidate) => {
    opened.push(candidate.name);
    return gameTimes[candidate.name] ?? null;
  };
  read.opened = opened;
  return read;
}

test('skips a previous save that captures the same in-game moment', () => {
  const current = save('ExitSave.gz', '2026-08-19T22:18:11Z');
  const candidates = [
    current,
    save('Autosave.gz', '2026-08-19T22:17:33Z'),
    save('Autosave2.gz', '2026-08-19T22:13:21Z')
  ];
  const read = reader({
    'Autosave.gz': '8/16/2032 12:00:00 PM',
    'Autosave2.gz': '8/1/2032 12:00:00 AM'
  });

  const result = selectComparisonSave(candidates, current, '8/16/2032 12:00:00 PM', read);
  assert.strictEqual(result.save.name, 'Autosave2.gz', 'walks past the identical-moment save');
  assert.strictEqual(result.gameTime, '8/1/2032 12:00:00 AM');
  assert.strictEqual(result.reason, 'distinct-game-time');
});

test('uses the immediately previous save when its moment already differs', () => {
  const current = save('Autosave.gz', '2026-08-19T22:17:33Z');
  const candidates = [current, save('Autosave2.gz', '2026-08-19T22:13:21Z')];
  const read = reader({ 'Autosave2.gz': '8/1/2032 12:00:00 AM' });

  const result = selectComparisonSave(candidates, current, '8/16/2032 12:00:00 PM', read);
  assert.strictEqual(result.save.name, 'Autosave2.gz');
  assert.strictEqual(result.probed, 1, 'stops at the first usable candidate');
});

test('generalises beyond ExitSave — filename is not the signal', () => {
  // Two autosaves written in the same in-game moment must be skipped too.
  const current = save('Autosave.gz', '2026-08-19T22:17:33Z');
  const candidates = [
    current,
    save('Autosave2.gz', '2026-08-19T22:17:20Z'),
    save('Autosave3.gz', '2026-08-19T22:10:00Z')
  ];
  const read = reader({
    'Autosave2.gz': '8/16/2032 12:00:00 PM',
    'Autosave3.gz': '7/1/2032 12:00:00 AM'
  });

  const result = selectComparisonSave(candidates, current, '8/16/2032 12:00:00 PM', read);
  assert.strictEqual(result.save.name, 'Autosave3.gz');
});

test('falls back to the nearest save when every candidate shares the moment', () => {
  // Rather than showing nothing, compare against the nearest and say why.
  const current = save('ExitSave.gz', '2026-08-19T22:18:11Z');
  const candidates = [current, save('Autosave.gz', '2026-08-19T22:17:33Z')];
  const read = reader({ 'Autosave.gz': '8/16/2032 12:00:00 PM' });

  const result = selectComparisonSave(candidates, current, '8/16/2032 12:00:00 PM', read);
  assert.strictEqual(result.save.name, 'Autosave.gz');
  assert.strictEqual(result.reason, 'same-game-time-fallback');
});

test('bounds how many saves it opens', () => {
  // Reading a save is a multi-MB gunzip; the walk must not scan the folder.
  const current = save('ExitSave.gz', '2026-08-19T23:00:00Z');
  const candidates = [current];
  const gameTimes = {};
  for (let i = 1; i <= 12; i++) {
    const name = `Autosave${i}.gz`;
    candidates.push(save(name, `2026-08-19T22:${String(59 - i).padStart(2, '0')}:00Z`));
    gameTimes[name] = '8/16/2032 12:00:00 PM';
  }
  const read = reader(gameTimes);

  const result = selectComparisonSave(candidates, current, '8/16/2032 12:00:00 PM', read, { maxProbe: 3 });
  assert.strictEqual(read.opened.length, 3, 'stops after maxProbe reads');
  assert.strictEqual(result.reason, 'same-game-time-fallback');
});

test('an unreadable candidate is skipped, not fatal', () => {
  // A save mid-write should not break the comparison entirely.
  const current = save('ExitSave.gz', '2026-08-19T22:18:11Z');
  const candidates = [
    current,
    save('Corrupt.gz', '2026-08-19T22:17:33Z'),
    save('Autosave.gz', '2026-08-19T22:10:00Z')
  ];
  const read = (candidate) => {
    if (candidate.name === 'Corrupt.gz') throw new Error('unexpected end of file');
    return '7/1/2032 12:00:00 AM';
  };

  const result = selectComparisonSave(candidates, current, '8/16/2032 12:00:00 PM', read);
  assert.strictEqual(result.save.name, 'Autosave.gz');
});

test('returns null when there is no older save', () => {
  const current = save('Autosave.gz', '2026-08-19T22:17:33Z');
  assert.strictEqual(selectComparisonSave([current], current, '8/16/2032', reader({})), null);
  assert.strictEqual(selectComparisonSave([], current, '8/16/2032', reader({})), null);
});

test('never selects the current save, even under a different path spelling', () => {
  const current = save('ExitSave.gz', '2026-08-19T22:18:11Z', 'F:/saves/ExitSave.gz');
  const candidates = [
    // Same file, differently cased path.
    save('ExitSave.gz', '2026-08-19T22:18:11Z', 'f:\\SAVES\\ExitSave.gz'),
    save('Autosave.gz', '2026-08-19T22:10:00Z')
  ];
  const result = selectComparisonSave(candidates, current, '8/16/2032 12:00:00 PM', reader({
    'Autosave.gz': '7/1/2032 12:00:00 AM'
  }));
  assert.strictEqual(result.save.name, 'Autosave.gz');
});

test('does not read any save when the current in-game date is unknown', () => {
  const current = save('ExitSave.gz', '2026-08-19T22:18:11Z');
  const candidates = [current, save('Autosave.gz', '2026-08-19T22:17:33Z')];
  const read = reader({ 'Autosave.gz': '8/16/2032 12:00:00 PM' });

  const result = selectComparisonSave(candidates, current, null, read);
  assert.strictEqual(result.reason, 'current-game-time-unknown');
  assert.strictEqual(read.opened.length, 0, 'nothing to compare against, so nothing is read');
});
