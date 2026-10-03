import { emptyData, parseCSV, mergeWords, selectWords, startSession, nextItem, recordAnswer, makeChoices, stats, isWeak, serializeCSV, validateBackup } from './engine.js';
import { load, save } from './storage.js';
const $ = selector => document.querySelector(selector);
const app = $('#app');
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const time = ms => `${Math.floor(Math.max(0, ms) / 60000)}:${String(Math.floor(Math.max(0, ms) / 1000) % 60).padStart(2, '0')}`;
let data = emptyData(), view = 'home', locked = false, revealed = false, feedback = null, currentReview = false, promptMode = 'recall', thinking = 0, lastTick = performance.now(), saveAt = 0, installPrompt, updateWorker, storageOK = true;
let saveQueue = Promise.resolve();
function toast(message) { $('#toast').textContent = message; $('#toast').hidden = false; setTimeout(() => $('#toast').hidden = true, 5000); }
function persist() {
  const snapshot = structuredClone(data);
  saveQueue = saveQueue.catch(() => {}).then(() => save(snapshot));
  return saveQueue.catch(error => { storageOK = false; $('#offline-state').textContent = '保存できません'; toast('端末への保存に失敗しました。バックアップを保存してから続けてください。'); throw error; });
}
function saveQuiet() { persist().catch(() => {}); }
function selectedStats() { return stats(data); }
function rangeLabel(s = data.filter) {
  const stage = s.stages.length === 2 ? 'Stage 1 + 2' : s.stages.length ? 'Stage ' + s.stages.join(', ') : 'Stage 未選択';
  return `${stage} / ${s.pos === 'all' ? '全品詞' : s.pos === 'no-idioms' ? '熟語を除く' : s.pos}${s.categories.length ? ' / カテゴリ指定' : ''}`;
}
function renderHome() {
  view = 'home'; const st = selectedStats(), hasWords = !!data.words.length, s = data.session;
  const active = s && !s.complete;
  const categories = [...new Set(data.words.map(w => w.category))];
  app.innerHTML = `<section class="hero"><div><p class="eyebrow">REVIEW, NOT RELEARN</p><h1>知っている語を、<br><em>使える記憶</em>に。</h1><p class="lead">既習語をすばやく確認。<br>迷った語だけ、間隔を空けてもう一度。</p></div><div class="hero-clock"><span>FOCUS SESSION</span><strong>30<small>min</small></strong><p>確認 → 苦手語 → 最終チェック</p></div></section>
    ${!hasWords ? `<section class="import-banner"><div><span class="step-label">START HERE</span><h2>単語CSVを取り込んで始める</h2><p>Stage 1・2を一つの出題範囲に。初回だけ取り込めば、オフラインでも使えます。</p></div><button id="first-import" class="primary">CSVを選ぶ <span>↗</span></button></section>` : ''}
    ${active ? `<section class="resume-banner"><div><strong>中断した復習があります</strong><p>${escape(rangeLabel(s.filter))} · ${s.answers.length}回答 · ${time(s.elapsed)}経過</p></div><button id="resume" class="primary">続きから再開 →</button></section>` : ''}
    <div class="dashboard"><section class="setup"><div class="section-head"><span class="step-label">01 / SESSION</span><h2>今日の復習</h2></div>
    <fieldset><legend>出題範囲</legend><div class="stage-options">${['1', '2'].map(stage => `<label class="toggle"><input type="checkbox" name="stage" value="${stage}" ${data.filter.stages.includes(stage) ? 'checked' : ''}><span>Stage ${stage}</span></label>`).join('')}</div>
    <div class="select-row"><label>品詞<select id="pos"><option value="all">すべて</option><option value="熟語">熟語のみ</option><option value="no-idioms">熟語を除く</option>${['名詞', '他動詞', '自動詞', '形容詞', '副詞'].map(pos => `<option value="${pos}">${pos}</option>`).join('')}</select></label><label>記録で絞る<select id="status"><option value="all">すべての項目</option><option value="weak">苦手・迷ったのみ</option><option value="unchecked">まだ確認していない項目</option></select></label></div>
    <details class="category-details"><summary>カテゴリを指定 <span>${data.filter.categories.length ? data.filter.categories.length + 'カテゴリ' : '指定なし'}</span></summary><div class="category-options">${categories.map(c => `<label><input type="checkbox" name="category" value="${escape(c)}" ${data.filter.categories.includes(c) ? 'checked' : ''}>${escape(c)}</label>`).join('')}</div><p class="fine">選択なし＝全カテゴリ</p></details></fieldset>
    <fieldset><legend>確認のしかた</legend><div class="mode-options"><label class="mode-option"><input type="radio" name="mode" value="recall" ${data.mode === 'recall' ? 'checked' : ''}><span><strong>高速確認</strong><small>意味を思い出して自己判定</small></span><b>おすすめ</b></label><label class="mode-option"><input type="radio" name="mode" value="choice" ${data.mode === 'choice' ? 'checked' : ''}><span><strong>4択診断</strong><small>正誤と回答時間を記録</small></span></label></div></fieldset>
    <div class="select-row"><label>時間<select id="duration"><option value="10">10分</option><option value="30">30分</option><option value="60">60分</option><option value="sweep">全項目を一巡・時間制限なし</option></select></label></div><p id="session-note" class="fine"></p>
    <div class="start-row"><button id="start" class="primary" ${!hasWords || !st.total ? 'disabled' : ''}>復習を始める <span>→</span></button><span id="pool-size">対象 <strong>${st.total.toLocaleString()}</strong> 項目</span></div></section>
    <aside class="overview"><div class="section-head"><span class="step-label">02 / YOUR MEMORY</span><h2>この範囲の記録</h2></div><div class="coverage"><span>確認した項目</span><strong>${st.checked.toLocaleString()}<small> / ${st.total.toLocaleString()}</small></strong><div class="meter"><i style="width:${st.total ? st.checked / st.total * 100 : 0}%"></i></div></div><dl class="memory-stats"><div><dt><i class="dot weak"></i>苦手</dt><dd>${st.weak}</dd></div><div><dt><i class="dot uncertain"></i>迷った</dt><dd>${st.uncertain}</dd></div><div><dt><i class="dot known"></i>思い出せた</dt><dd>${st.known}</dd></div><div><dt><i class="dot confirmed"></i>再テストで確認済み</dt><dd>${st.confirmed}</dd></div></dl><p class="fine">「思い出せた」は今回の判定。苦手語は時間を空けた確認で2回思い出せたら、確認済みに移ります。</p>${s?.complete ? `<button id="last-result" class="secondary full">前回の結果を見る →</button>` : ''}<div class="note"><span>今日の方針</span><p>苦手語を見つけたら、正解を確認。<br>別の語を挟んでから思い出す。</p></div></aside></div>`;
  $('#pos').value = data.filter.pos; $('#status').value = data.filter.status; $('#duration').value = String(data.duration);
  sessionNote();
  app.querySelectorAll('input[name="stage"], input[name="category"], #pos, #status').forEach(input => input.addEventListener('change', () => {
    data.filter = { stages: [...app.querySelectorAll('input[name="stage"]:checked')].map(x => x.value), pos: $('#pos').value, categories: [...app.querySelectorAll('input[name="category"]:checked')].map(x => x.value), status: $('#status').value };
    saveQuiet(); renderHome();
  }));
  app.querySelectorAll('input[name="mode"]').forEach(input => input.addEventListener('change', () => { data.mode = input.value; saveQuiet(); }));
  $('#duration').addEventListener('change', () => { data.duration = $('#duration').value === 'sweep' ? 'sweep' : Number($('#duration').value); sessionNote(); saveQuiet(); });
  $('#first-import')?.addEventListener('click', () => $('#csv-input').click());
  $('#start').addEventListener('click', async () => {
    if (active && !confirm('中断中のセッションを終了し、新しい復習を始めますか？ 単語ごとの記録は引き継ぎます。')) return;
    if (!storageOK) { toast('データを保存できないため、開始できません。バックアップを保存してください。'); return; }
    try { data.session = startSession(data, { minutes: Number(data.duration), mode: data.mode, sweep: data.duration === 'sweep' }); await persist(); begin(); } catch (e) { toast(e.message); }
  });
  $('#resume')?.addEventListener('click', () => { data.session.paused = false; begin(); });
  $('#last-result')?.addEventListener('click', renderResults);
}
function sessionNote() { $('#session-note').textContent = data.duration === 'sweep' ? '選んだ範囲を重複なしで一巡。中断・再開できます。' : `最後${Math.min(5, Number(data.duration) * 0.2)}分は苦手語を優先。タイマーは一時停止中・別画面では止まります。`; }
function begin() { view = 'play'; feedback = null; revealed = false; lastTick = performance.now(); if (data.session.current) renderQuestion(); else advance(); }
function advance() {
  feedback = null; revealed = false; const s = data.session, next = nextItem(data);
  if (!next) { finish(); return; }
  if (next.wait) { s.current = null; renderWait(next.due); saveQuiet(); return; }
  s.current = next.id; s.currentReview = next.review; s.currentSpent = 0; s.choices = [];
  renderQuestion(); saveQuiet();
}
function renderQuestion() {
  view = 'play'; const s = data.session, word = data.words.find(w => w.id === s.current); if (!word) { advance(); return; }
  currentReview = !!s.currentReview; thinking = s.currentSpent || 0;
  promptMode = s.mode === 'choice' && !currentReview ? 'choice' : 'recall';
  let choices = [];
  if (promptMode === 'choice') {
    choices = s.choices.length ? s.choices.map(id => data.words.find(w => w.id === id)).filter(Boolean) : makeChoices(word, data.words);
    if (choices.length < 4) promptMode = 'recall'; else s.choices = choices.map(w => w.id);
  }
  const count = s.answers.length, phase = s.sweep ? '全項目一巡' : s.limit - s.elapsed <= Math.min(300000, s.limit * 0.2) ? '最終チェック' : currentReview ? '苦手語の再テスト' : '既習語の確認';
  app.innerHTML = `<section class="study"><div class="study-top"><button id="pause" class="quiet">Ⅱ 一時停止</button><span>${escape(phase)}</span><strong id="session-time">${s.limit ? time(s.limit - s.elapsed) : time(s.elapsed)}</strong></div><div class="session-meter"><i style="width:${s.limit ? Math.min(100, s.elapsed / s.limit * 100) : s.seen.length / s.pool.length * 100}%"></i></div><div class="study-meta"><span>${escape(rangeLabel(s.filter))}</span><span>${count}回答 · ${s.seen.length}/${s.pool.length}項目確認</span></div><div class="word-area"><span class="word-tag">${escape(word.pos)} <span>· Stage ${escape(word.stage)}</span>${currentReview ? ' · 再確認' : ''}</span><h1 id="word">${escape(word.en)}</h1><div id="question-body">${promptMode === 'recall' ? `<p class="recall-hint">意味を思い出してから、表示してください。</p><button id="reveal" class="primary reveal">意味を表示 <small>Space</small></button>` : `<p class="recall-hint">正しい意味を選んでください。<span id="question-time">11.0秒</span></p><div class="choices">${choices.map((w, i) => `<button class="choice" data-choice="${escape(w.id)}"><b>${i + 1}</b><span>${escape(w.ja)}</span></button>`).join('')}</div><button id="pass" class="text-button">わからない / パス</button>`}</div><div id="feedback"></div></div><div class="study-bottom"><span>1セット25問 · ${count % 25 + 1}問目</span><span>${promptMode === 'choice' ? '回答後すぐに正解を確認' : '選択肢なしで、記憶を確認'}</span></div></section>`;
  $('#pause').addEventListener('click', pause);
  $('#reveal')?.addEventListener('click', reveal);
  app.querySelectorAll('[data-choice]').forEach(button => button.addEventListener('click', () => answer(button.dataset.choice === word.id ? 'known' : 'unknown', { assisted: true, chosen: data.words.find(w => w.id === button.dataset.choice)?.ja || '' })));
  $('#pass')?.addEventListener('click', () => answer('unknown', { assisted: true }));
  lastTick = performance.now();
}
function reveal() {
  if (revealed || locked) return; tick(); revealed = true;
  const word = data.words.find(w => w.id === data.session.current);
  $('#question-body').innerHTML = `<div class="meaning"><p>${escape(word.ja)}</p><span>${escape(word.phonetic)}</span></div><p class="fine">表示する前に、意味を思い出せましたか？</p><div class="grade-buttons"><button id="known" class="grade known"><strong>思い出せた</strong><small>1</small></button><button id="uncertain" class="grade uncertain"><strong>迷った</strong><small>2</small></button><button id="unknown" class="grade weak"><strong>思い出せない</strong><small>3</small></button></div>`;
  ['known', 'uncertain', 'unknown'].forEach(grade => $('#' + grade).addEventListener('click', () => answer(grade)));
}
async function answer(grade, { assisted = false, chosen = '' } = {}) {
  const s = data.session; if (locked || feedback || !s?.current || s.paused || s.complete) return;
  tick(false); if (s.complete) return; locked = true;
  const word = data.words.find(w => w.id === s.current); const ms = Math.round(thinking);
  const completed = { id: s.current, grade, ms, now: Date.now(), review: currentReview, assisted, chosen };
  const p = recordAnswer(data, completed);
  try { await persist(); }
  catch { locked = false; pause(); return; }
  locked = false;
  if (grade === 'known' && !assisted) { advance(); return; }
  feedback = { word, grade, chosen, answerIndex: s.answers.length - 1 };
  $('#question-body').innerHTML = '';
  $('#feedback').innerHTML = `<div class="answer-feedback ${grade === 'unknown' ? 'wrong' : 'correct'}"><span class="step-label">${grade === 'unknown' ? 'ここで覚え直す' : grade === 'uncertain' ? 'あとでもう一度' : '正解'}</span><p>${escape(word.ja)}</p><span class="phonetic">${escape(word.phonetic)}</span>${chosen && grade === 'unknown' ? `<div class="chosen">選んだ意味：${escape(chosen)}</div>` : ''}<p class="fine">${isWeak(p) ? '約3分後以降に、選択肢なしで再確認します。' : '回答時間 ' + (ms / 1000).toFixed(1) + '秒'}</p></div><div class="feedback-actions">${assisted && grade === 'known' ? '<button id="mark-uncertain" class="secondary">正解したけど迷った</button>' : ''}<button id="next" class="primary">次へ <small>Space →</small></button></div>`;
  $('#next').addEventListener('click', advance);
  $('#mark-uncertain')?.addEventListener('click', async () => {
    if (locked) return; locked = true;
    const p = data.progress[word.id]; p.status = 'uncertain'; p.streak = 0; p.due = Date.now() + 180000;
    const entry = s.answers[feedback.answerIndex]; entry.grade = 'uncertain'; p.history[p.history.length - 1].grade = 'uncertain';
    try { await persist(); locked = false; advance(); } catch { locked = false; pause(); }
  });
}
function renderWait(due) {
  view = 'wait'; app.innerHTML = `<section class="pause-panel"><p class="eyebrow">SPACE TO REMEMBER</p><h1>少し間隔を空けよう。</h1><p>直前に見た答えを覚えているだけの正解を減らすため、<br>次の復習時刻まで待ちます。</p><strong id="wait-time">${time(due - Date.now())}</strong><div class="panel-actions"><button id="pause" class="secondary">一時停止</button><button id="end" class="primary">ここまでの結果を見る</button></div></section>`;
  $('#pause').addEventListener('click', pause); $('#end').addEventListener('click', finish);
}
function pause() {
  if (!data.session || data.session.complete) return;
  tick(false); if (data.session.complete) return; data.session.paused = true; view = 'paused'; saveQuiet();
  app.innerHTML = `<section class="pause-panel"><p class="eyebrow">TAKE A BREATH</p><h1>記録して、一時停止。</h1><p>タイマーは止まっています。<br>${data.session.answers.length}回答 · ${time(data.session.elapsed)}経過</p><div class="panel-actions"><button id="continue" class="primary">復習を続ける →</button><button id="home" class="secondary">範囲設定に戻る</button><button id="end" class="text-button">ここまでの結果を見る</button></div></section>`;
  $('#continue').addEventListener('click', () => { data.session.paused = false; begin(); });
  $('#home').addEventListener('click', renderHome); $('#end').addEventListener('click', finish);
}
function finish() { if (!data.session) return; data.session.complete = true; data.session.paused = true; saveQuiet(); renderResults(); }
function renderResults() {
  view = 'results'; const s = data.session; if (!s) { renderHome(); return; }
  const pool = data.words.filter(w => s.pool.includes(w.id)); const st = stats(data, pool);
  const weak = pool.filter(w => isWeak(data.progress[w.id])).sort((a, b) => data.progress[b.id].errors - data.progress[a.id].errors);
  const confirmed = new Set(s.answers.filter(a => data.progress[a.id]?.status === 'confirmed').map(a => a.id)).size;
  const median = s.answers.map(a => a.ms).sort((a, b) => a - b)[Math.floor(s.answers.length / 2)] || 0;
  const choiceAnswers = s.answers.filter(a => a.assisted);
  app.innerHTML = `<section class="result-header"><p class="eyebrow">SESSION COMPLETE</p><h1>次に見る語が、<em>絞れた。</em></h1><p>${escape(rangeLabel(s.filter))} · ${time(s.elapsed)} · ${s.answers.length}回答</p></section><div class="result-metrics"><div><span>今回確認した項目</span><strong>${s.seen.length}<small> / ${s.pool.length}</small></strong></div><div><span>この範囲の苦手・迷った</span><strong>${weak.length}</strong></div><div><span>今回の再テストで確認済み</span><strong>${confirmed}</strong></div><div><span>回答時間の中央値</span><strong>${(median / 1000).toFixed(1)}<small>秒</small></strong></div></div><p class="fine result-note">${st.total - st.checked}項目はまだこのツールで確認していません。未確認の語を「覚えている」とは判定していません。${choiceAnswers.length ? ` 4択：${choiceAnswers.filter(a => a.grade !== 'unknown').length}/${choiceAnswers.length}正解。` : ''}</p><div class="result-actions"><button id="review-weak" class="primary" ${!weak.length ? 'disabled' : ''}>この範囲の苦手だけ、もう一周 →</button><button id="home" class="secondary">範囲設定へ</button><button id="save-weak" class="text-button">苦手語CSVを保存 ↗</button></div><section class="weak-list"><div class="section-head"><span class="step-label">REVIEW LIST</span><h2>この範囲で復習する語 <small>${weak.length}項目</small></h2></div>${weak.length ? weak.map(w => `<div class="weak-row"><div><strong>${escape(w.en)}</strong><span>${escape(w.pos)} · Stage ${escape(w.stage)}</span></div><p>${escape(w.ja)}</p><span class="badge ${data.progress[w.id].status}">${data.progress[w.id].status === 'weak' ? '苦手' : '迷った'}</span></div>`).join('') : '<p class="empty-message">今回の範囲に、苦手・迷ったの記録はありません。</p>'}</section>`;
  $('#home').addEventListener('click', renderHome); $('#save-weak').addEventListener('click', () => exportWeak(pool));
  $('#review-weak').addEventListener('click', async () => {
    data.filter = { ...s.filter, status: 'weak' }; data.session = startSession(data, { minutes: 10, mode: 'recall' });
    try { await persist(); begin(); } catch (e) { toast(e.message); }
  });
}
function tick(checkTimeout = true) {
  const now = performance.now(), delta = Math.max(0, now - lastTick); lastTick = now;
  const s = data.session;
  if (!s || s.paused || s.complete || document.hidden || !['play', 'wait'].includes(view)) return;
  s.elapsed += delta;
  if (view === 'play' && s.current && !revealed && !feedback && !locked) { thinking += delta; s.currentSpent = thinking; }
  if (s.limit && s.elapsed >= s.limit && !locked) { s.elapsed = s.limit; finish(); return; }
  if ($('#session-time')) $('#session-time').textContent = s.limit ? time(s.limit - s.elapsed) : time(s.elapsed);
  const meter = $('.session-meter i'); if (meter && s.limit) meter.style.width = `${Math.min(100, s.elapsed / s.limit * 100)}%`;
  if ($('#question-time') && !feedback) { $('#question-time').textContent = `${Math.max(0, 11 - thinking / 1000).toFixed(1)}秒`; if (checkTimeout && thinking >= 11000 && !locked) answer('unknown', { assisted: true }); }
  if (view === 'wait') {
    const item = nextItem(data); if (!item || !item.wait) { advance(); return; }
    $('#wait-time').textContent = time(item.due - Date.now());
  }
  if (now - saveAt > 5000 && !locked) { saveAt = now; saveQuiet(); }
}
setInterval(tick, 200);
document.addEventListener('visibilitychange', () => { if (document.hidden && ['play', 'wait'].includes(view)) pause(); lastTick = performance.now(); });
window.addEventListener('pagehide', () => { if (data.session && !data.session.complete) { data.session.paused = true; saveQuiet(); } });
document.addEventListener('keydown', event => {
  if ($('#data-dialog').open || ['INPUT', 'SELECT', 'TEXTAREA'].includes(event.target.tagName) || event.repeat) return;
  if (event.key === 'Escape' && view === 'play') { event.preventDefault(); pause(); return; }
  if (view !== 'play') return;
  if (event.code === 'Space' || event.key === 'Enter') { event.preventDefault(); (feedback ? $('#next') : $('#reveal'))?.click(); }
  if (/^[1-4]$/.test(event.key)) {
    event.preventDefault(); if (feedback || locked) return;
    if (promptMode === 'choice') app.querySelectorAll('[data-choice]')[Number(event.key) - 1]?.click();
    else if (revealed) $('#'+ ['known', 'uncertain', 'unknown'][Number(event.key) - 1])?.click();
  }
});
$('#brand').addEventListener('click', event => { event.preventDefault(); if (['play', 'wait'].includes(view)) pause(); else renderHome(); });
$('#manage').addEventListener('click', () => { if (['play', 'wait'].includes(view)) pause(); $('#data-dialog').showModal(); });
$('#close-dialog').addEventListener('click', () => $('#data-dialog').close());
function download(filename, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type })); const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 60000);
}
function exportWeak(pool = data.words) {
  const rows = pool.filter(w => isWeak(data.progress[w.id])).map(w => [w.stage, w.category, w.number, w.en, w.ja, w.phonetic, data.progress[w.id].status === 'weak' ? '苦手' : '迷った', data.progress[w.id].errors]);
  download('word-recall-weak.csv', serializeCSV([['ステージ', 'カテゴリ', '番号', '英単語', '日本語訳', '発音記号', '状態', '誤答回数'], ...rows]), 'text/csv;charset=utf-8');
}
$('#export-weak').addEventListener('click', () => exportWeak());
$('#export-backup').addEventListener('click', () => download('word-recall-backup.json', JSON.stringify({ ...data, exportedAt: new Date().toISOString() }), 'application/json'));
async function importFile(input, backup) {
  const file = input.files[0]; if (!file) return;
  if (data.session && !data.session.complete && !confirm('読み込み後は現在のセッションを終了します。続けますか？')) { input.value = ''; return; }
  try {
    const text = await file.text();
    const next = backup ? validateBackup(JSON.parse(text)) : mergeWords(data, parseCSV(text));
    if (backup && data.words.length && !confirm('この端末の単語・学習記録を、バックアップの内容に置き換えますか？')) return;
    await save(next); data = next; storageOK = true;
    $('#import-message').textContent = `${data.words.length.toLocaleString()}項目を取り込みました。`;
    $('#data-dialog').close(); toast(`${data.words.length.toLocaleString()}項目を取り込みました。`); renderHome();
    navigator.storage?.persist?.().catch(() => {});
  } catch (e) { $('#import-message').textContent = e.message; toast('読み込めませんでした：' + e.message); }
  finally { input.value = ''; }
}
$('#csv-input').addEventListener('change', event => importFile(event.target, false));
$('#backup-input').addEventListener('change', event => importFile(event.target, true));
window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); installPrompt = event; $('#install').textContent = 'ホーム画面に追加'; });
$('#install').addEventListener('click', async () => {
  if (updateWorker) { if (['play', 'wait'].includes(view)) pause(); await persist().catch(() => {}); updateWorker.postMessage('ACTIVATE'); return; }
  if (installPrompt) { await installPrompt.prompt(); installPrompt = null; }
  else toast('Android：ブラウザのメニュー →「アプリをインストール」。iPhone：Safariの共有 →「ホーム画面に追加」。');
});
function updateConnectivity() { $('#offline-state').textContent = !storageOK ? '保存できません' : !navigator.onLine ? 'オフライン' : '端末内に保存'; }
window.addEventListener('online', updateConnectivity); window.addEventListener('offline', updateConnectivity);
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').then(registration => {
    const offer = () => { if (registration.waiting && navigator.serviceWorker.controller) { updateWorker = registration.waiting; $('#install').textContent = '更新を適用'; } };
    offer(); registration.addEventListener('updatefound', () => registration.installing?.addEventListener('statechange', offer));
  }).catch(() => toast('オフライン用の保存が完了していません。接続中にもう一度開いてください。'));
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (updateWorker && !reloading) { reloading = true; location.reload(); } });
}
try { data = await load() || emptyData(); if (data.session && !data.session.complete) data.session.paused = true; }
catch { storageOK = false; toast('保存領域を開けません。ブラウザの設定を確認してください。'); }
updateConnectivity(); renderHome();
