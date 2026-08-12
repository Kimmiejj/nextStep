import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const backendSource = fs.readFileSync(new URL('../apps-script/Code.gs', import.meta.url), 'utf8');

test('getAppData caches its payload and opens the Spreadsheet once per execution', () => {
  const cache = new Map();
  const reads = { Config: 0, Questions: 0, Sources: 0 };
  let spreadsheetOpens = 0;
  const values = {
    Config: [['key', 'value'], ['APP_NAME', 'Test app']],
    Questions: [
      ['id', 'round', 'section', 'type', 'prompt', 'helper', 'options_json', 'required', 'active'],
      ['Q1', 'R1', 'Section', 'text', 'Question', '', '[]', 'FALSE', 'TRUE']
    ],
    Sources: [['source_id', 'title', 'url', 'note'], ['source', 'Source', 'https://example.com', 'Note']]
  };
  const spreadsheet = {
    getSheetByName(name) {
      return {
        getDataRange() {
          return {
            getDisplayValues() { reads[name] += 1; return structuredClone(values[name]); },
            getValues() { reads[name] += 1; return structuredClone(values[name]); }
          };
        }
      };
    }
  };
  const scriptCache = {
    get(key) { return cache.get(key) || null; },
    put(key, value) { cache.set(key, String(value)); },
    remove(key) { cache.delete(key); }
  };
  const context = {
    CacheService: { getScriptCache() { return scriptCache; } },
    SpreadsheetApp: {
      openById() {
        spreadsheetOpens += 1;
        return spreadsheet;
      }
    }
  };
  vm.createContext(context);
  vm.runInContext(backendSource, context);

  const first = vm.runInContext('getAppData()', context);
  const second = vm.runInContext('getAppData()', context);

  assert.equal(first.config.APP_NAME, 'Test app');
  assert.equal(first.questions[0].id, 'Q1');
  assert.equal(second.questions[0].id, 'Q1');
  assert.equal(spreadsheetOpens, 1);
  assert.deepEqual(reads, { Config: 1, Questions: 1, Sources: 1 });
  assert.ok(cache.has('app_data_v2'));
  assert.equal(vm.runInContext('isRetryableBackendError_("Service unavailable")', context), true);
  assert.equal(vm.runInContext('isRetryableBackendError_("ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง")', context), false);
});
