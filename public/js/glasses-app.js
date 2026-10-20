// ============================================================
// DASTAK — Wearable UI (600×600, D-pad + Enter)
// Renders one frame at a time from DastakEngine state. Builds DOM with textContent only.
// Makes no network requests: the page is also served with CSP connect-src 'none'.
//
// Keys (same meaning on every frame):
//   ↑ ↓      move selection / adjust a number
//   ← →      move selection; on the start frame, change household
//   Enter    confirm the highlighted choice
//   Esc, Backspace, or system Back   go back one question
// ============================================================
(function () {
  'use strict';

  var E = window.DastakEngine;
  var R = window.DASTAK_REGISTRY;
  var main = document.getElementById('main');

  if (!E || !R || !window.DastakStore || !R.protocols || !R.protocols.length) {
    main.textContent = '';
    main.appendChild(el('p', 'kicker warn', 'Cannot start'));
    main.appendChild(el('p', 'sub fg', 'Protocol data or app scripts are missing. No visit can be run. Reload once while online.'));
    return;
  }

  var store = window.DastakStore.createStore(function () { return window.localStorage; });
  var PROTOCOLS = R.protocols;
  var ROSTER = R.roster;

  var STATUS_TEXT = {
    'structural-test': 'TEST CONTENT · not clinical',
    'clinical-draft': 'DRAFT · not reviewed',
    'reviewed-demo': 'DEMO · not for care',
    'clinically-approved': 'APPROVED CONTENT'
  };

  var app = {
    screen: 'idle',       // idle | resume | visit | complete | error | settings | confirm-delete
    household: 0,
    sel: 0,               // highlighted item on the current frame
    protocol: null,
    visit: null,
    errorVisit: null,
    countIndex: 0,
    pending: null,        // saved visit offered on the resume frame
    notice: null,         // one-line notice shown on the next frame
    lastRecord: null,
    spokenFor: null       // step already announced, so re-renders do not repeat audio
  };

  // ---------------- DOM helpers ----------------
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  function setText(id, text) { document.getElementById(id).textContent = text || ''; }
  function setKeys(left, right) {
    var k = document.getElementById('keys');
    k.textContent = '';
    [left, right].forEach(function (parts) {
      var span = el('span');
      (parts || []).forEach(function (p, i) {
        if (i % 2 === 0) span.appendChild(el('b', null, p));
        else span.appendChild(document.createTextNode(' ' + p + '  '));
      });
      k.appendChild(span);
    });
  }
  function setProgress(fraction) {
    document.getElementById('bar-fill').style.transform = 'scaleX(' + Math.max(0, Math.min(1, fraction)) + ')';
  }
  function saveStatus() {
    var s = document.getElementById('ctx-save');
    var st = store.status();
    s.className = st === 'ok' ? '' : 'bad';
    s.textContent = st === 'ok' ? 'saved on device' : 'NOT SAVED';
  }

  // Option list: role=radiogroup, one aria-checked item, pointer click confirms.
  function optionList(items, opts) {
    opts = opts || {};
    var list = el('div', 'list' + (opts.row ? ' row' : ''));
    list.setAttribute('role', 'radiogroup');
    list.setAttribute('aria-label', opts.label || 'Options');
    var first = 0, last = items.length;
    if (opts.window && items.length > opts.window) {
      first = Math.max(0, Math.min(app.sel - Math.floor(opts.window / 2), items.length - opts.window));
      last = first + opts.window;
      list.appendChild(el('div', 'edge', first > 0 ? '▲ ' + first + ' more' : ''));
    }
    for (var i = first; i < last; i++) {
      var b = el('button', 'opt' + (opts.compact ? ' compact' : ''));
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', i === app.sel ? 'true' : 'false');
      b.tabIndex = i === app.sel ? 0 : -1;
      b.appendChild(el('span', null, items[i].label));
      if (items[i].tag) b.appendChild(el('span', 'tag', items[i].tag));
      b.addEventListener('click', (function (idx) {
        return function (e) { e.preventDefault(); app.sel = idx; activate(); };
      })(i));
      list.appendChild(b);
    }
    if (opts.window && items.length > opts.window) {
      list.appendChild(el('div', 'edge', last < items.length ? '▼ ' + (items.length - last) + ' more' : ''));
    }
    return list;
  }
  function focusSelected() {
    var b = main.querySelector('[aria-checked="true"]');
    if (b) b.focus({ preventScroll: true });
  }

  // ---------------- audio (optional; the workflow never depends on it) ----------------
  var audioCtx = null;
  function tone(freq, dur) {
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      var o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, audioCtx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.12, audioCtx.currentTime + dur * 0.3);
      g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur);
      o.connect(g); g.connect(audioCtx.destination);
      o.start(); o.stop(audioCtx.currentTime + dur + 0.05);
    } catch (e) { /* audio unavailable: visual cues remain */ }
  }
  function speechSupported() { return 'speechSynthesis' in window && typeof window.SpeechSynthesisUtterance === 'function'; }
  function voices() { try { return speechSupported() ? window.speechSynthesis.getVoices() : []; } catch (e) { return []; } }
  // Voice choices: 'off' first, then installed voices.
  function voiceChoices() { return ['off'].concat(voices().map(function (v) { return v.name; })); }
  function currentVoiceName() { return store.loadVoice() || (voices().length ? voices()[0].name : 'off'); }
  // Speaks exactly the text on screen; falls back to a tone when speech is off or unsupported.
  function announce(text, freq) {
    var name = currentVoiceName();
    if (!speechSupported() || name === 'off') { tone(freq, 0.3); return; }
    try {
      window.speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(text);
      var v = voices().filter(function (x) { return x.name === name; })[0];
      if (v) u.voice = v;
      window.speechSynthesis.speak(u);
    } catch (e) { tone(freq, 0.3); }
  }

  // ---------------- data helpers ----------------
  function household() { return ROSTER[app.household]; }
  function protocolById(id) { return E.findProtocol(R, id); }
  function dueText(h) {
    if (h.dueIn < 0) return 'overdue by ' + (-h.dueIn) + ' day' + (h.dueIn === -1 ? '' : 's');
    if (h.dueIn === 0) return 'due today';
    return 'due in ' + h.dueIn + ' day' + (h.dueIn === 1 ? '' : 's');
  }
  function minutesAgo(t) {
    var m = Math.max(0, Math.round((Date.now() - t) / 60000));
    return m < 60 ? m + ' min ago' : Math.round(m / 60) + ' h ago';
  }
  function idleItems() {
    var h = household();
    var items = PROTOCOLS.map(function (p) {
      var saved = store.loadVisit(p, h.id, Date.now());
      var tag = saved && saved.visit ? 'interrupted' : (p.id === h.protocolId ? 'scheduled' : '');
      return { label: p.label, tag: tag, protocol: p };
    });
    items.push({ label: 'Settings', tag: '', settings: true });
    return items;
  }

  // ---------------- screens ----------------
  function render() {
    main.textContent = '';
    saveStatus();
    var fn = SCREENS[app.screen];
    fn();
    focusSelected();
  }

  var SCREENS = {
    idle: function () {
      var h = household();
      setText('ctx-label', 'Dastak');
      setText('ctx-progress', 'household ' + (app.household + 1) + ' of ' + ROSTER.length);
      setText('ctx-meta', 'Prototype · not clinically validated');
      setProgress(0);
      main.appendChild(el('p', 'kicker', h.id + ' · ' + h.area + ' · ' + dueText(h)));
      var carry = store.latestCarryForHousehold(h.id, Date.now());
      if (carry) main.appendChild(el('p', 'note', '⟩ flagged last visit: ' + carry.flags[0].description));
      main.appendChild(el('p', 'sub', E.triageNote(ROSTER)));
      if (app.notice) { main.appendChild(el('p', 'notice', app.notice)); app.notice = null; }
      main.appendChild(optionList(idleItems(), { label: 'Choose visit type', compact: true }));
      setKeys(['← →', 'household', '↑ ↓', 'visit type'], ['ENTER', 'begin']);
    },

    resume: function () {
      var p = app.protocol, v = app.pending.visit;
      setText('ctx-label', p.label);
      setText('ctx-progress', '');
      setText('ctx-meta', STATUS_TEXT[p.status]);
      setProgress(E.progress(p, v).fraction);
      main.appendChild(el('p', 'kicker warn', 'Interrupted visit'));
      main.appendChild(el('p', 'prompt', 'Resume ' + v.householdId + ' at question ' + (v.path.length + 1) + '?'));
      main.appendChild(el('p', 'sub', 'Saved ' + minutesAgo(app.pending.savedAt) + '. ' + v.path.length + ' answer' + (v.path.length === 1 ? '' : 's') + ' kept. Start over discards them.'));
      main.appendChild(optionList([{ label: 'Resume' }, { label: 'Start over' }], { label: 'Interrupted visit', row: true }));
      setKeys(['← →', 'choose'], ['ENTER', 'confirm']);
    },

    visit: function () {
      var p = app.protocol, v = app.visit;
      var step = E.stepMap(p)[v.current];
      var pr = E.progress(p, v);
      setText('ctx-label', p.label);
      setText('ctx-progress', 'Q' + pr.question + ' · up to ' + pr.upToMore + ' more');
      setText('ctx-meta', STATUS_TEXT[p.status]);
      setProgress(pr.fraction);
      if (app.notice) { main.appendChild(el('p', 'notice', app.notice)); app.notice = null; }

      var entering = app.spokenFor !== v.path.length + ':' + step.id;
      app.spokenFor = v.path.length + ':' + step.id;

      var carry = store.carryFor(v.householdId, p.id, Date.now());
      var carried = carry && carry.flags.some(function (f) { return f.stepId === step.id; });

      if (step.type === 'info') {
        if (step.danger) {
          main.appendChild(el('p', 'kicker danger', 'Referral flag'));
          main.appendChild(el('p', 'prompt danger', step.prompt));
          main.appendChild(el('p', 'sub fg', step.referral));
          if (entering) announce(step.prompt + '. ' + step.referral, 440);
        } else {
          main.appendChild(el('p', 'kicker', 'Note'));
          main.appendChild(el('p', 'prompt', step.prompt));
        }
        if (carried) main.appendChild(el('p', 'note', '⟩ also flagged at the last ' + carry.visitLabel + ' visit'));
        main.appendChild(optionList([{ label: 'Continue' }], { label: 'Continue' }));
        setKeys(['ESC', 'back'], ['ENTER', 'continue']);
        return;
      }

      main.appendChild(el('p', 'prompt', step.prompt));
      if (carried) {
        main.appendChild(el('p', 'note', '⟩ flagged at the last ' + carry.visitLabel + ' visit'));
        if (entering) announce('Flagged last visit', 660);
      }

      if (step.type === 'count') {
        var values = E.gridValues(step);
        var big = el('p', 'count', E.formatNumber(step, values[app.countIndex]));
        big.setAttribute('role', 'spinbutton');
        big.setAttribute('aria-valuenow', String(values[app.countIndex]));
        big.setAttribute('aria-valuemin', String(step.min));
        big.setAttribute('aria-valuemax', String(step.max));
        big.setAttribute('aria-label', step.prompt);
        main.appendChild(big);
        main.appendChild(el('p', 'count-unit', step.unit || ''));
        main.appendChild(el('p', 'count-hint', 'range ' + E.formatNumber(step, step.min) + '–' + E.formatNumber(step, step.max) + ' · steps of ' + step.step));
        var confirm = optionList([{ label: 'Confirm ' + E.formatAnswer(step, values[app.countIndex]) }], { label: 'Confirm value' });
        main.appendChild(confirm);
        setKeys(['↑ ↓', 'adjust', 'ESC', 'back'], ['ENTER', 'confirm']);
        return;
      }

      var items = frameItems(step);
      if (step.type === 'yesno') {
        main.appendChild(optionList(items, { label: step.prompt, row: true }));
        setKeys(['← →', 'choose', 'ESC', 'back'], ['ENTER', 'confirm']);
      } else {
        main.appendChild(optionList(items, { label: step.prompt, window: 5, compact: step.type === 'range' }));
        setKeys(['↑ ↓', 'choose', 'ESC', 'back'], ['ENTER', 'confirm']);
      }
    },

    complete: function () {
      var r = app.lastRecord;
      setText('ctx-label', r.protocolLabel);
      setText('ctx-progress', 'complete');
      setText('ctx-meta', STATUS_TEXT[r.protocolStatus]);
      setProgress(1);
      main.appendChild(el('p', 'kicker', 'Visit complete'));
      main.appendChild(el('p', 'prompt', r.householdId + ' · ' + r.answers.length + ' answers'));
      if (r.flags.length) {
        main.appendChild(el('p', 'sub fg', r.flags.length + ' referral flag' + (r.flags.length === 1 ? '' : 's') + ':'));
        var ul = el('ul', 'flags');
        r.flags.slice(0, 3).forEach(function (f) { ul.appendChild(el('li', null, '• ' + f.description)); });
        if (r.flags.length > 3) ul.appendChild(el('li', null, '+ ' + (r.flags.length - 3) + ' more'));
        main.appendChild(ul);
      } else {
        main.appendChild(el('p', 'sub', 'No referral flags raised.'));
      }
      main.appendChild(el('p', store.status() === 'ok' ? 'sub' : 'notice',
        store.status() === 'ok' ? 'Record kept on this device only. Not sent anywhere.' : 'NOT SAVED: storage is unavailable, this record will be lost.'));
      main.appendChild(optionList([{ label: 'Done' }], { label: 'Done' }));
      setKeys([], ['ENTER', 'back to start']);
    },

    error: function () {
      setText('ctx-label', app.protocol ? app.protocol.label : 'Dastak');
      setText('ctx-progress', '');
      setText('ctx-meta', 'visit NOT complete');
      main.appendChild(el('p', 'kicker warn', 'Protocol error'));
      main.appendChild(el('p', 'prompt', 'This visit is NOT complete and was not recorded.'));
      main.appendChild(el('p', 'sub', app.errorVisit && app.errorVisit.error ? app.errorVisit.error : 'The protocol could not continue.'));
      main.appendChild(el('p', 'sub', 'Go back and choose differently, or report the protocol to its author.'));
      main.appendChild(optionList([{ label: 'Go back' }], { label: 'Go back' }));
      setKeys([], ['ENTER', 'go back']);
    },

    settings: function () {
      setText('ctx-label', 'Settings');
      setText('ctx-progress', '');
      setText('ctx-meta', 'not part of a visit');
      setProgress(0);
      var name = currentVoiceName();
      var voiceLabel = !speechSupported() ? 'Voice: unsupported, tones only' : 'Voice: ' + (name === 'off' ? 'off (tones)' : name);
      main.appendChild(el('p', 'kicker', 'Settings'));
      if (app.notice) { main.appendChild(el('p', 'notice', app.notice)); app.notice = null; }
      main.appendChild(optionList([
        { label: voiceLabel, tag: speechSupported() ? '← →' : '' },
        { label: 'Test audio' },
        { label: 'Delete data on this device' },
        { label: 'Back' }
      ], { label: 'Settings', compact: true }));
      setKeys(['↑ ↓', 'move', '← →', 'change'], ['ENTER', 'select']);
    },

    'confirm-delete': function () {
      setText('ctx-label', 'Delete local data');
      main.appendChild(el('p', 'kicker warn', 'Delete from this device'));
      main.appendChild(el('p', 'sub fg', 'This removes: interrupted visits, carry-forward flags, the last visit record and the voice setting. Protocols and the household list are part of the app and stay. This cannot be undone.'));
      main.appendChild(optionList([{ label: 'Cancel' }, { label: 'Delete' }], { label: 'Confirm delete', row: true }));
      setKeys(['← →', 'choose'], ['ENTER', 'confirm']);
    }
  };

  function frameItems(step) {
    if (step.type === 'yesno') return [{ label: 'No', value: 'no' }, { label: 'Yes', value: 'yes' }];
    if (step.type === 'choice') return E.normalizeOptions(step).map(function (o) { return { label: o.label, value: o.value }; });
    if (step.type === 'range') return E.gridValues(step).map(function (v) { return { label: E.formatAnswer(step, v), value: v }; });
    return [];
  }

  // Sets the default selection when a frame is first shown.
  function enterStep() {
    var step = E.stepMap(app.protocol)[app.visit.current];
    if (step.type === 'yesno') app.sel = 1;
    else if (step.type === 'range') app.sel = E.gridIndexOf(step, step.default);
    else app.sel = 0;
    if (step.type === 'count') app.countIndex = E.gridIndexOf(step, step.default);
  }

  function persistVisit() {
    if (app.visit && app.visit.status === 'in_progress') store.saveVisit(app.visit, Date.now());
  }

  // ---------------- actions ----------------
  function beginVisit(protocol, resumeVisit) {
    app.protocol = protocol;
    app.visit = resumeVisit || E.createVisit(protocol, household().id, Date.now());
    if (app.visit.status === 'error') { app.errorVisit = app.visit; app.screen = 'error'; app.sel = 0; render(); return; }
    if (!resumeVisit) store.clearVisit(household().id, protocol.id);
    app.spokenFor = null;
    enterStep();
    persistVisit();
    app.screen = 'visit';
    if (history.state && history.state.dastak === 'visit') history.replaceState({ dastak: 'visit' }, '');
    else history.pushState({ dastak: 'visit' }, '');
    render();
  }

  function answerCurrent() {
    var step = E.stepMap(app.protocol)[app.visit.current];
    var value;
    if (step.type === 'info') value = 'ack';
    else if (step.type === 'count') value = E.gridValues(step)[app.countIndex];
    else value = frameItems(step)[app.sel].value;

    var res = E.applyAnswer(app.protocol, app.visit, value, Date.now());
    if (res.error) { app.errorVisit = { error: res.error }; app.screen = 'error'; app.sel = 0; render(); return; }
    var v = res.visit;
    if (v.status === 'error') { app.errorVisit = v; app.visit = v; app.screen = 'error'; app.sel = 0; render(); return; }
    if (v.status === 'complete') { finish(v); return; }
    app.visit = v;
    enterStep();
    persistVisit();
    render();
  }

  function finish(v) {
    var p = app.protocol;
    var record = E.buildRecord(p, v, household());
    store.saveCarry(v.householdId, p.id, p.label, record.flags, Date.now());
    store.saveRecord(record);
    store.clearVisit(v.householdId, p.id);
    app.lastRecord = record;
    app.visit = null;
    app.screen = 'complete';
    app.sel = 0;
    // A completed visit is final: replace the history entry so Back cannot reopen it.
    history.replaceState({ dastak: 'complete' }, '');
    render();
  }

  function back() {
    if (app.screen === 'visit' || app.screen === 'error') {
      var v = app.visit;
      // From an error: a broken transition is undone by stepping back over the answer that
      // triggered it; a rejected answer left the visit unchanged, so stay on that question.
      var prev = !v ? null : (app.screen === 'error' && v.status === 'in_progress') ? v : E.goBack(v);
      if (!prev) { toIdle(); return; }
      app.visit = prev;
      app.screen = 'visit';
      enterStep();
      persistVisit();
      render();
      return;
    }
    if (app.screen === 'settings' || app.screen === 'resume' || app.screen === 'complete') { toIdle(); return; }
    if (app.screen === 'confirm-delete') { app.screen = 'settings'; app.sel = 2; render(); }
  }

  function toIdle() {
    if (app.visit && app.visit.status === 'in_progress' && app.visit.path.length === 0) {
      store.clearVisit(app.visit.householdId, app.visit.protocolId); // nothing answered yet: nothing to resume
    }
    app.screen = 'idle';
    app.visit = null;
    app.protocol = null;
    var h = household();
    var idx = PROTOCOLS.findIndex(function (p) { return p.id === h.protocolId; });
    app.sel = idx === -1 ? 0 : idx;
    render();
  }

  function activate() {
    switch (app.screen) {
      case 'idle':
        var item = idleItems()[app.sel];
        if (item.settings) { app.screen = 'settings'; app.sel = 0; render(); return; }
        var saved = store.loadVisit(item.protocol, household().id, Date.now());
        if (saved && saved.visit) {
          app.protocol = item.protocol;
          app.pending = saved;
          app.screen = 'resume';
          app.sel = 0;
          render();
          return;
        }
        if (saved && saved.discarded) app.notice = 'Earlier saved visit discarded: ' + saved.discarded;
        beginVisit(item.protocol, null);
        return;
      case 'resume':
        var pending = app.pending;
        app.pending = null;
        if (app.sel === 0) beginVisit(app.protocol, pending.visit);
        else beginVisit(app.protocol, null);
        return;
      case 'visit': answerCurrent(); return;
      case 'complete': toIdle(); return;
      case 'error': back(); return;
      case 'settings':
        if (app.sel === 0) { cycleVoice(1); return; }
        if (app.sel === 1) { announce('Audio test', 520); return; }
        if (app.sel === 2) { app.screen = 'confirm-delete'; app.sel = 0; render(); return; }
        toIdle();
        return;
      case 'confirm-delete':
        if (app.sel === 1) {
          var ok = store.clearAll();
          app.notice = ok ? 'Local data deleted.' : 'Could not delete: storage unavailable.';
        }
        app.screen = 'settings';
        app.sel = 2;
        render();
        return;
    }
  }

  function cycleVoice(dir) {
    if (!speechSupported()) return;
    var choices = voiceChoices();
    var i = choices.indexOf(currentVoiceName());
    var next = choices[(i + dir + choices.length) % choices.length];
    store.saveVoice(next);
    render();
  }

  function itemCount() {
    switch (app.screen) {
      case 'idle': return PROTOCOLS.length + 1;
      case 'resume': case 'confirm-delete': return 2;
      case 'settings': return 4;
      case 'visit':
        var step = E.stepMap(app.protocol)[app.visit.current];
        return step.type === 'info' || step.type === 'count' ? 1 : frameItems(step).length;
    }
    return 1;
  }

  function move(dir, wrap) {
    var n = itemCount();
    var next = app.sel + dir;
    if (wrap) next = (next + n) % n;
    else next = Math.max(0, Math.min(n - 1, next));
    if (next !== app.sel) { app.sel = next; render(); }
  }

  function adjustCount(dir) {
    var step = E.stepMap(app.protocol)[app.visit.current];
    var max = E.gridValues(step).length - 1;
    var next = Math.max(0, Math.min(max, app.countIndex + dir));
    if (next !== app.countIndex) { app.countIndex = next; render(); }
  }

  function onKey(e) {
    var k = e.key;
    var isBack = k === 'Escape' || k === 'Backspace' || k === 'BrowserBack' || k === 'GoBack';
    var handled = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' '].indexOf(k) !== -1 || isBack;
    if (!handled) return;
    e.preventDefault();
    if (isBack) { back(); return; }
    if (k === 'Enter' || k === ' ') { activate(); return; }

    var vertical = k === 'ArrowUp' || k === 'ArrowDown';
    var dir = k === 'ArrowUp' || k === 'ArrowLeft' ? -1 : 1;

    if (app.screen === 'idle' && !vertical) {
      app.household = (app.household + dir + ROSTER.length) % ROSTER.length;
      var idx = PROTOCOLS.findIndex(function (p) { return p.id === household().protocolId; });
      app.sel = idx === -1 ? 0 : idx;
      render();
      return;
    }
    if (app.screen === 'settings' && !vertical) {
      if (app.sel === 0) cycleVoice(dir);
      return;
    }
    if (app.screen === 'visit') {
      var step = E.stepMap(app.protocol)[app.visit.current];
      if (step.type === 'count') { adjustCount(k === 'ArrowUp' || k === 'ArrowRight' ? 1 : -1); return; }
      if (step.type === 'range') { move(dir, false); return; }
    }
    move(dir, true);
  }

  // ---------------- boot ----------------
  try {
    var migration = store.migrateLegacy(R, Date.now());
    if (migration.discarded) app.notice = 'Older saved data could not be verified and was removed.';
  } catch (e) { /* migration is best-effort */ }

  document.addEventListener('keydown', onKey);
  // System back (gesture or browser button) acts like Esc while a frame other than start is open.
  window.addEventListener('popstate', function () {
    if (app.screen !== 'idle') {
      back();
      if (app.screen !== 'idle') history.pushState({ dastak: 'visit' }, '');
    }
  });
  if (speechSupported()) {
    try { window.speechSynthesis.onvoiceschanged = function () { if (app.screen === 'settings') render(); }; } catch (e) { /* ignore */ }
  }
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('/sw.js').catch(function () { /* app still works online */ });
  }
  history.replaceState({ dastak: 'idle' }, '');
  toIdle();
})();
