export const VERSION = 1;
export const MINUTE = 60000;
export const DEFAULT_FILTER = { stages: ['1', '2'], pos: 'all', categories: [], status: 'all' };
export function partOfSpeech(category) { return category.replace(/[A-ZＡ-Ｚ0-9０-９\s]+$/u, ''); }
export function parseCSV(source) {
  const rows = []; let row = [], cell = '', quoted = false;
  const text = source.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++; }
      else if (quoted || !cell) quoted = !quoted;
      else throw new Error('CSVの引用符を確認してください。');
    } else if (c === ',' && !quoted) { row.push(cell); cell = ''; }
    else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); if (row.some(x => x.trim())) rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (quoted) throw new Error('CSVの引用符が閉じていません。');
  row.push(cell); if (row.some(x => x.trim())) rows.push(row);
  if (!rows.length) throw new Error('CSVが空です。');
  const headers = rows.shift().map(x => x.trim());
  const names = ['ステージ', 'カテゴリ', '番号', '英単語', '日本語訳', '発音記号'];
  if (names.some(x => !headers.includes(x))) throw new Error('必要な6列がありません。取得済みCSVを選んでください。');
  const ids = new Set();
  const words = rows.map((r, index) => {
    const [stage, category, number, en, ja, phonetic] = names.map(n => (r[headers.indexOf(n)] || '').trim());
    if (!['1', '2'].includes(stage) || !category || !/^\d+$/.test(number) || !en || !ja) throw new Error(`${index + 2}行目の内容を確認してください。`);
    const id = `${stage}:${category}:${number}`;
    if (ids.has(id)) throw new Error(`同じ項目が重複しています：${id}`);
    ids.add(id); return { id, stage, category, number, en, ja, phonetic, pos: partOfSpeech(category) };
  });
  if (!words.length || words.length > 20000) throw new Error('取り込める項目数は1〜20,000です。');
  return words;
}
export function emptyData() { return { version: VERSION, words: [], progress: {}, session: null, filter: structuredClone(DEFAULT_FILTER), mode: 'recall', duration: 30 }; }
export function mergeWords(data, words) {
  const prior = new Map(data.words.map(w => [w.id, w])); const progress = {};
  for (const w of words) {
    const old = prior.get(w.id);
    if (old && old.en === w.en && old.ja === w.ja && data.progress[w.id]) progress[w.id] = data.progress[w.id];
  }
  return { ...data, words, progress, session: null };
}
export function selectWords(data, filter = data.filter) {
  return data.words.filter(w => filter.stages.includes(w.stage)
    && (filter.pos === 'all' || (filter.pos === 'no-idioms' ? w.pos !== '熟語' : w.pos === filter.pos))
    && (!filter.categories.length || filter.categories.includes(w.category))
    && (filter.status === 'all' || (filter.status === 'weak' ? isWeak(data.progress[w.id]) : !data.progress[w.id])));
}
export function isWeak(p) { return !!p && (p.status === 'weak' || p.status === 'uncertain'); }
export function shuffle(items, random = Math.random) {
  const list = [...items]; for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; } return list;
}
export function startSession(data, { minutes = 30, mode = 'recall', sweep = false, now = Date.now(), random = Math.random } = {}) {
  const pool = selectWords(data); if (!pool.length) throw new Error('この範囲には項目がありません。');
  // Unchecked entries first, then previously checked ones, without dropping repeated headwords.
  const order = [...shuffle(pool.filter(w => !data.progress[w.id]), random), ...shuffle(pool.filter(w => data.progress[w.id]), random)].map(w => w.id);
  return { mode, sweep, filter: structuredClone(data.filter), pool: pool.map(w => w.id), order,
    seen: [], answers: [], elapsed: 0, limit: sweep ? 0 : minutes * MINUTE, started: now,
    current: null, currentSpent: 0, choices: [], paused: false, complete: false, scanSinceReview: 0, reviewStreak: 0 };
}
export function nextItem(data, now = Date.now()) {
  const s = data.session; if (!s || s.complete || (s.limit && s.elapsed >= s.limit)) return null;
  const seen = new Set(s.seen); const available = s.order.filter(id => !seen.has(id));
  if (s.sweep) return available.length ? { id: available[0], review: false } : null;
  const lastPhase = s.limit - s.elapsed <= Math.min(5 * MINUTE, s.limit * 0.2);
  const weak = s.pool.filter(id => isWeak(data.progress[id]));
  const ready = weak.filter(id => data.progress[id].due <= now && id !== s.current)
    .sort((a, b) => data.progress[a].due - data.progress[b].due);
  // At most ten reviews in a row; scanning cannot starve while there are unseen entries.
  if (ready.length && (lastPhase || s.scanSinceReview >= 3 || !available.length) && (s.reviewStreak < 10 || !available.length || lastPhase)) return { id: ready[0], review: true };
  if (lastPhase && weak.length) {
    // Wait for spacing instead of drilling a just-revealed answer immediately.
    const spaced = weak.filter(id => now - data.progress[id].lastAt >= MINUTE && id !== s.current)
      .sort((a, b) => data.progress[a].lastAt - data.progress[b].lastAt);
    if (spaced.length) return { id: spaced[0], review: true };
    if (ready.length) return { id: ready[0], review: true };
    return { wait: true, due: Math.min(...weak.map(id => data.progress[id].lastAt + MINUTE)) };
  }
  if (available.length) return { id: available[0], review: false };
  if (ready.length) return { id: ready[0], review: true };
  if (weak.length) return { wait: true, due: Math.min(...weak.map(id => data.progress[id].due)) };
  return null;
}
export function recordAnswer(data, { id, grade, ms, now = Date.now(), review = false, assisted = false, chosen = '' }) {
  if (!['known', 'uncertain', 'unknown'].includes(grade)) throw new Error('不正な回答です。');
  const s = data.session; const old = data.progress[id] || { errors: 0, count: 0, streak: 0, status: 'unchecked', history: [] };
  const p = { ...old, count: old.count + 1, lastAt: now, lastMs: Math.max(0, ms), lastChosen: chosen, history: [...old.history, { at: now, grade, ms, assisted }].slice(-12) };
  if (grade === 'unknown' || grade === 'uncertain') {
    p.status = grade === 'unknown' ? 'weak' : 'uncertain'; p.errors += grade === 'unknown' ? 1 : 0; p.streak = 0; p.due = now + 3 * MINUTE;
  } else if (isWeak(old)) {
    // A correct choice or an immediate repeat cannot establish unaided retention.
    const spacedRecall = !assisted && now - old.lastAt >= MINUTE;
    p.streak = spacedRecall ? old.streak + 1 : old.streak;
    p.status = p.streak >= 2 ? 'confirmed' : old.status; p.due = now + (p.streak ? 10 : 3) * MINUTE;
  } else { p.status = old.status === 'confirmed' ? 'confirmed' : 'known'; p.streak = old.streak; p.due = now + 24 * 60 * MINUTE; }
  data.progress[id] = p;
  if (!s.seen.includes(id)) s.seen.push(id);
  s.answers.push({ id, grade, ms, review, assisted, at: now, score: grade === 'unknown' ? 0 : 30 + Math.max(0, Math.min(4, Math.floor((11000 - ms) * 4 / 7700))) });
  if (review) { s.scanSinceReview = 0; s.reviewStreak++; } else { s.scanSinceReview++; s.reviewStreak = 0; }
  s.current = null; s.currentSpent = 0; s.choices = [];
  return p;
}
function meaningTokens(text) {
  return text.replace(/[<(（][^>)）]*[>)）]/g, '').replace(/[〜～…･・]/g, '').split(/[、,;；/／]/).map(x => x.trim()).filter(x => x.length >= 2);
}
export function makeChoices(word, words, random = Math.random) {
  const correct = meaningTokens(word.ja); const selected = [word];
  for (const candidate of shuffle(words.filter(w => w.pos === word.pos && w.id !== word.id && w.en.toLowerCase() !== word.en.toLowerCase()), random)) {
    const tokens = meaningTokens(candidate.ja);
    if (!tokens.length || selected.some(w => w.ja === candidate.ja || meaningTokens(w.ja).some(a => tokens.some(b => a === b || (Math.min(a.length, b.length) >= 3 && (a.includes(b) || b.includes(a))))))) continue;
    if (correct.some(a => tokens.includes(a))) continue;
    selected.push(candidate); if (selected.length === 4) return shuffle(selected, random);
  }
  return []; // Fall back to recall when there are fewer than three distinct distractors.
}
export function stats(data, pool = selectWords(data)) {
  const result = { total: pool.length, checked: 0, weak: 0, uncertain: 0, confirmed: 0, known: 0 };
  for (const w of pool) { const p = data.progress[w.id]; if (p) { result.checked++; result[p.status] = (result[p.status] || 0) + 1; } }
  return result;
}
export function serializeCSV(rows) { return '\uFEFF' + rows.map(r => r.map(x => '"' + String(x ?? '').replaceAll('"', '""') + '"').join(',')).join('\r\n') + '\r\n'; }
export function validateBackup(value) {
  if (!value || value.version !== VERSION || !Array.isArray(value.words) || !value.progress || typeof value.progress !== 'object') throw new Error('対応するバックアップではありません。');
  const words = parseCSV(serializeCSV([['ステージ', 'カテゴリ', '番号', '英単語', '日本語訳', '発音記号'], ...value.words.map(w => [w.stage, w.category, w.number, w.en, w.ja, w.phonetic])]));
  const clean = emptyData(); clean.words = words;
  for (const w of words) {
    const p = value.progress[w.id]; if (!p) continue;
    if (!['known', 'weak', 'uncertain', 'confirmed'].includes(p.status) || !['count', 'errors', 'streak', 'due', 'lastAt', 'lastMs'].every(k => Number.isFinite(p[k]) && p[k] >= 0) || !Array.isArray(p.history)) throw new Error('学習記録の形式が不正です。');
    clean.progress[w.id] = { status: p.status, count: p.count, errors: p.errors, streak: p.streak, due: p.due, lastAt: p.lastAt, lastMs: p.lastMs, lastChosen: String(p.lastChosen || ''), history: p.history.slice(-12).filter(h => h && ['known', 'uncertain', 'unknown'].includes(h.grade)).map(h => ({ grade: h.grade, at: Number(h.at) || 0, ms: Number(h.ms) || 0, assisted: !!h.assisted })) };
  }
  return clean;
}
