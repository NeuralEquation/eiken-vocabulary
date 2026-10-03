import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyData, parseCSV, serializeCSV, mergeWords, selectWords, startSession, nextItem, recordAnswer, makeChoices, validateBackup, MINUTE } from '../engine.js';
const header = ['ステージ', 'カテゴリ', '番号', '英単語', '日本語訳', '発音記号'];
const csv = serializeCSV([header, ['1', '他動詞A', '1', 'abate', '弱める', '/a/'], ['2', '自動詞B', '1', 'abate', '弱まる', '/a/'], ['1', '熟語A', '1', 'hold on', '待つ', ''], ['2', '名詞E', '1', 'rout', '敗走', '']]);
function setup() { const d = emptyData(); d.words = parseCSV(csv); return d; }
test('quoted commas, quotes, multiline cells and BOM round-trip without merging headwords', () => {
  const source = serializeCSV([header, ['1', '名詞A', '1', 'test', '意味, "引用"\n続き', '']]);
  assert.equal(parseCSV(source)[0].ja, '意味, "引用"\n続き');
  const d = setup(); assert.equal(d.words.length, 4); assert.notEqual(d.words[0].id, d.words[1].id);
  assert.throws(() => parseCSV(csv + csv.split('\r\n')[1] + '\r\n'), /重複/);
  assert.throws(() => parseCSV('"ステージ'), /閉じて/);
});
test('stage / idiom / category / history filters compose', () => {
  const d = setup(); d.filter.pos = '熟語'; assert.equal(selectWords(d).length, 1);
  d.filter.pos = 'no-idioms'; assert.equal(selectWords(d).length, 3);
  d.filter.stages = ['2']; assert.equal(selectWords(d).length, 2);
  d.filter.categories = ['名詞E']; assert.equal(selectWords(d)[0].en, 'rout');
  d.filter.status = 'weak'; assert.equal(selectWords(d).length, 0);
  d.progress[d.words[3].id] = { status: 'weak' }; assert.equal(selectWords(d).length, 1);
});
test('a complete sweep visits every entry exactly once including repeated spellings and resumes', () => {
  const d = setup(); d.session = startSession(d, { sweep: true, random: () => 0.5 });
  const visited = [];
  while (nextItem(d)) {
    const item = nextItem(d); visited.push(item.id);
    recordAnswer(d, { id: item.id, grade: 'unknown', ms: 10, now: 1000 });
    Object.assign(d, JSON.parse(JSON.stringify(d))); // Reload checkpoint after each answer.
  }
  assert.equal(new Set(visited).size, 4); assert.equal(d.session.answers.length, 4);
});
test('weak entries require two spaced unassisted successes; correct choices do not clear them', () => {
  const d = setup(); d.session = startSession(d); const id = d.words[0].id;
  recordAnswer(d, { id, grade: 'unknown', ms: 100, now: 1000 });
  recordAnswer(d, { id, grade: 'known', ms: 100, now: 4000 }); assert.equal(d.progress[id].streak, 0);
  recordAnswer(d, { id, grade: 'known', ms: 100, now: 200000, assisted: true }); assert.equal(d.progress[id].status, 'weak');
  recordAnswer(d, { id, grade: 'known', ms: 100, now: 400000 }); assert.equal(d.progress[id].streak, 1);
  recordAnswer(d, { id, grade: 'known', ms: 100, now: 1000000 }); assert.equal(d.progress[id].status, 'confirmed');
  recordAnswer(d, { id, grade: 'uncertain', ms: 100, now: 2000000 }); assert.equal(d.progress[id].status, 'uncertain'); assert.equal(d.progress[id].streak, 0);
});
test('timed diagnostic interleaves due reviews without starving unchecked entries', () => {
  const d = setup(); d.session = startSession(d, { now: 1000, random: () => 0.1 }); const id = d.session.order[0];
  recordAnswer(d, { id, grade: 'unknown', ms: 100, now: 1000 });
  for (let i = 0; i < 2; i++) { const n = nextItem(d, 200000); assert.equal(n.review, false); recordAnswer(d, { id: n.id, grade: 'known', ms: 100, now: 200000 }); }
  assert.deepEqual(nextItem(d, 200001), { id, review: true });
  recordAnswer(d, { id, grade: 'unknown', ms: 100, now: 200001, review: true }); assert.equal(nextItem(d, 200002).review, false);
});
test('last phase prioritizes spaced weaknesses and waits instead of repeating immediately', () => {
  const d = setup(); d.session = startSession(d); const id = d.session.order[0];
  recordAnswer(d, { id, grade: 'unknown', ms: 100, now: 1000 }); d.session.elapsed = 26 * MINUTE;
  assert.equal(nextItem(d, 2000).wait, true); assert.deepEqual(nextItem(d, 62000), { id, review: true });
  d.session.elapsed = d.session.limit; assert.equal(nextItem(d, 62000), null);
});
test('reimport keeps unchanged sense records but cannot carry records onto a changed meaning', () => {
  const d = setup(); d.session = startSession(d); const id = d.words[0].id;
  recordAnswer(d, { id, grade: 'unknown', ms: 100, now: 1000 });
  assert.equal(mergeWords(d, parseCSV(csv)).progress[id].status, 'weak');
  const changed = parseCSV(csv); changed[0].ja = '別の意味'; assert.equal(mergeWords(d, changed).progress[id], undefined);
});
test('backup validates before replacing state and preserves sense-specific progress', () => {
  const d = setup(); d.session = startSession(d); const id = d.words[0].id;
  recordAnswer(d, { id, grade: 'unknown', ms: 100, now: 1000 });
  const restored = validateBackup(JSON.parse(JSON.stringify(d))); assert.equal(restored.progress[id].status, 'weak'); assert.equal(restored.words.length, 4); assert.equal(restored.session, null);
  const corrupt = structuredClone(d); corrupt.progress[id].due = 'yesterday'; assert.throws(() => validateBackup(corrupt), /不正/);
});
test('choice generation rejects another sense of same headword and identical / overlapping meanings', () => {
  const words = ['待つ', '待つ', '待つ、休む', '走る', '読む', '書く', '泳ぐ'].map((ja, i) => ({ id: String(i), en: i === 1 ? 'target' : 'w' + i, ja, pos: '他動詞' })); words[0].en = 'target';
  const choices = makeChoices(words[0], words, () => 0.5); assert.equal(choices.length, 4); assert.equal(choices.filter(w => w.ja.includes('待つ')).length, 1);
  assert.deepEqual(makeChoices(words[0], words.slice(0, 3)), []);
});
