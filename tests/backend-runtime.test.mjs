import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';

import { createStaticRuntime } from '../scripts/build-static.mjs';

const STATIC_DATA = {
  config: { APP_NAME: 'Test' },
  rounds: [{ id: 'R1', title: 'Round 1', subtitle: '' }],
  questions: [{ id: 'fallback', round: 'R1', section: '', type: 'text', prompt: 'Fallback', helper: '', options: [], required: false }],
  sourceLinks: []
};

function createHarness({ fetchImpl, onAppend } = {}) {
  let nextTimerId = 1;
  const timers = new Map();
  const scripts = [];
  const warnings = [];
  const storage = new Map();

  const context = {
    AbortController,
    TextEncoder,
    URLSearchParams,
    clearTimeout(id) { timers.delete(id); },
    console: { warn(...args) { warnings.push(args); } },
    crypto: globalThis.crypto,
    fetch: fetchImpl || (() => Promise.reject(new Error('unexpected fetch'))),
    localStorage: {
      getItem(key) { return storage.has(key) ? storage.get(key) : null; },
      setItem(key, value) { storage.set(key, String(value)); }
    },
    setTimeout(callback, milliseconds) {
      const id = nextTimerId++;
      timers.set(id, { callback, milliseconds });
      if (milliseconds < 5000) queueMicrotask(() => {
        const timer = timers.get(id);
        if (!timer) return;
        timers.delete(id);
        timer.callback();
      });
      return id;
    }
  };
  context.window = context;
  context.document = {
    createElement(tagName) {
      assert.equal(tagName, 'script');
      return {
        removed: false,
        remove() { this.removed = true; },
        src: '',
        onerror: null
      };
    },
    head: {
      appendChild(script) {
        scripts.push(script);
        onAppend?.(script, scripts.length, context);
      }
    }
  };

  vm.createContext(context);
  vm.runInContext(createStaticRuntime(STATIC_DATA, 'https://script.google.com/macros/s/test/exec'), context);

  return {
    context,
    scripts,
    warnings,
    callbackName(script) { return new URL(script.src).searchParams.get('callback'); },
    fireNextTimer(milliseconds) {
      const match = [...timers].find(([, timer]) => timer.milliseconds === milliseconds);
      assert.ok(match, `missing ${milliseconds}ms timer`);
      const [id, timer] = match;
      timers.delete(id);
      timer.callback();
    },
    run(source) { return vm.runInContext(source, context); }
  };
}

test('student app data uses the public Questions CSV without calling Apps Script', async () => {
  const csv = [
    'id,round,section,type,prompt,helper,options_json,required,active',
    'live,R1,Section,text,Live question,,[],FALSE,TRUE'
  ].join('\n');
  let fetchCalls = 0;
  const harness = createHarness({
    fetchImpl: async () => {
      fetchCalls += 1;
      return { ok: true, text: async () => csv };
    },
    onAppend() { throw new Error('student boot must not call Apps Script'); }
  });
  const resultPromise = new Promise((resolve, reject) => {
    harness.context.resolveTest = resolve;
    harness.context.rejectTest = reject;
    harness.run('staticBackend.run.withSuccessHandler(resolveTest).withFailureHandler(rejectTest).getAppData()');
  });

  const result = await resultPromise;
  assert.equal(fetchCalls, 1);
  assert.equal(result.questions[0].id, 'live');
  assert.equal(harness.scripts.length, 0);
});

test('teacher requests retry transient script errors and succeed on the third attempt', async () => {
  const harness = createHarness({
    onAppend(script, attempt, context) {
      queueMicrotask(() => {
        if (attempt < 3) script.onerror();
        else context[harness.callbackName(script)]({ ok: true, data: ['student'] });
      });
    }
  });

  const result = await harness.run('requestBackendJsonp({api:"listResponses",token:"test"})');
  assert.deepEqual([...result], ['student']);
  assert.equal(harness.scripts.length, 3);
  harness.scripts.forEach(script => assert.doesNotThrow(() => harness.context[harness.callbackName(script)]({ ok: true, data: [] })));
});

test('backend API errors are not retried', async () => {
  const harness = createHarness({
    onAppend(script, attempt, context) {
      queueMicrotask(() => context[harness.callbackName(script)]({ ok: false, error: 'เซสชันครูหมดอายุ' }));
    }
  });

  await assert.rejects(harness.run('requestBackendJsonp({api:"listResponses",token:"expired"})'), /เซสชันครูหมดอายุ/);
  assert.equal(harness.scripts.length, 1);
});

test('backend API errors marked retryable are retried', async () => {
  const harness = createHarness({
    onAppend(script, attempt, context) {
      queueMicrotask(() => {
        if (attempt === 1) context[harness.callbackName(script)]({ ok: false, error: 'Service unavailable', retryable: true });
        else context[harness.callbackName(script)]({ ok: true, data: ['recovered'] });
      });
    }
  });

  const result = await harness.run('requestBackendJsonp({api:"listResponses",token:"test"})');
  assert.deepEqual([...result], ['recovered']);
  assert.equal(harness.scripts.length, 2);
});

test('timeouts retry three times and late JSONP responses remain harmless', async () => {
  const harness = createHarness({
    onAppend() { queueMicrotask(() => harness.fireNextTimer(20000)); }
  });

  await assert.rejects(harness.run('requestBackendJsonp({api:"listResponses",token:"test"})'), /20 วินาที/);
  assert.equal(harness.scripts.length, 3);
  harness.scripts.forEach(script => assert.doesNotThrow(() => harness.context[harness.callbackName(script)]({ ok: true, data: [] })));
});

test('concurrent teacher calls keep their own success handlers', async () => {
  const pending = [];
  const harness = createHarness({ onAppend(script) { pending.push(script); } });
  const first = new Promise((resolve, reject) => {
    harness.context.resolveFirst = resolve;
    harness.context.rejectFirst = reject;
    harness.run('staticBackend.run.withSuccessHandler(resolveFirst).withFailureHandler(rejectFirst).listResponses("first",{})');
  });
  const second = new Promise((resolve, reject) => {
    harness.context.resolveSecond = resolve;
    harness.context.rejectSecond = reject;
    harness.run('staticBackend.run.withSuccessHandler(resolveSecond).withFailureHandler(rejectSecond).listResponses("second",{})');
  });

  assert.equal(pending.length, 2);
  harness.context[harness.callbackName(pending[1])]({ ok: true, data: ['second result'] });
  harness.context[harness.callbackName(pending[0])]({ ok: true, data: ['first result'] });

  assert.deepEqual(await first, ['first result']);
  assert.deepEqual(await second, ['second result']);
});
