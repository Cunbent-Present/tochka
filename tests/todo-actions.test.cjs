const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const start = source.indexOf("  $('#todo').querySelectorAll('.tcard').forEach");
const end = source.indexOf('  // сообщений за неделю', start);
assert.ok(start >= 0 && end > start, 'CRM event bindings must be present');

function fixture(note = { d: 1, t: 'Demo client', s: 'new', r: 100 }) {
  const buttons = ['skip', 'later', 'done'].map(action => ({ dataset: { t: action } }));
  const card = { dataset: { d: String(note.d) }, querySelectorAll: () => buttons, classList: { add() {} } };
  const messages = [];
  let saved;
  const context = {
    notes: [note],
    $: () => ({ querySelectorAll: () => [card] }),
    noteName: n => n.t,
    toast: (message, duration, undo) => messages.push({ message, undo }),
    saveNotes: () => { saved = JSON.parse(JSON.stringify(context.notes)); },
    drawNotes() {},
    setTimeout: callback => callback(),
    dayAt: days => 100 + days * 86400000,
    REDUCE: true,
  };
  vm.runInNewContext(source.slice(start, end), context);
  return { note, context, messages, get saved() { return saved; }, click: action => buttons.find(b => b.dataset.t === action).onclick() };
}

test('skip persists removal of the reminder without changing client history', () => {
  const f = fixture();
  f.click('skip');
  assert.equal(f.context.notes.length, 1);
  assert.deepEqual(f.saved, [{ d: 1, t: 'Demo client', s: 'new' }]);
  assert.equal(typeof f.messages[0].undo, 'function');
});
test('undo restores the exact reminder and preserves prior contact history', () => {
  const original = { d: 1, t: 'Demo client', s: 'reply', sentAt: 50, r: 100 };
  const f = fixture({ ...original });
  f.click('skip');
  assert.equal(f.note.s, 'reply');
  assert.equal(f.note.sentAt, 50);
  f.messages[0].undo();
  assert.deepEqual(f.saved, [original]);
});
test('undo does not overwrite a newer reminder', () => {
  const f = fixture(); f.click('skip');
  f.note.r = 900;
  f.messages[0].undo();
  assert.equal(f.note.r, 900);
});
test('undo does not recreate a deleted client', () => {
  const f = fixture(); f.click('skip');
  f.context.notes = [];
  f.messages[0].undo();
  assert.equal(f.context.notes.length, 0);
});
test('undo respects a later status change', () => {
  const f = fixture(); f.click('skip');
  f.note.s = 'deal';
  f.messages[0].undo();
  assert.equal(f.note.r, undefined);
  assert.equal(f.note.s, 'deal');
});
test('tomorrow still reschedules without marking the client contacted', () => {
  const f = fixture(); f.click('later');
  assert.equal(f.saved[0].r, 86400100);
  assert.equal(f.saved[0].s, 'new');
  assert.equal(f.saved[0].sentAt, undefined);
});
test('done still records contact and schedules the follow-up', () => {
  const f = fixture(); f.click('done');
  assert.equal(f.saved[0].s, 'sent');
  assert.ok(f.saved[0].sentAt > 0);
  assert.equal(f.saved[0].r, 259200100);
});
