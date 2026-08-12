import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const sourcePath = path.join(root, 'apps-script', 'Index.html');
const codePath = path.join(root, 'apps-script', 'Code.gs');
const outputPath = path.join(root, 'dist', 'index.html');
const webAppUrl = String(process.env.APPS_SCRIPT_WEB_APP_URL || '').trim();

function readGitValue(args) {
  try {
    return execFileSync('git', args, { cwd:root, encoding:'utf8' }).trim();
  } catch (error) {
    return '';
  }
}

const commitCount = readGitValue(['rev-list', '--count', 'HEAD']);
const shortSha = readGitValue(['rev-parse', '--short=7', 'HEAD']);
const appVersion = String(process.env.APP_VERSION || '').trim()
  || (commitCount && shortSha ? `v1.0.${commitCount}-${shortSha}` : 'v1.0.0-dev');

if (webAppUrl && !webAppUrl.startsWith('https://script.google.com/macros/s/')) {
  throw new Error('APPS_SCRIPT_WEB_APP_URL must be a deployed Google Apps Script web app URL.');
}

function readSourceData() {
  const source = `${fs.readFileSync(codePath, 'utf8')}
;globalThis.__nextStepSource = { APP, DEFAULT_CONFIG_ROWS, DEFAULT_SOURCE_ROWS, DEFAULT_QUESTIONS };`;
  const context = {};
  new vm.Script(source, { filename: 'Code.gs' }).runInNewContext(context);
  return context.__nextStepSource;
}

function normalizeText(value) {
  return String(value ?? '')
    .replace(/Direct Admission/gi, 'รอบรับตรงอิสระ')
    .replace(/Portfolio/gi, 'แฟ้มสะสมผลงาน')
    .replace(/Quota/gi, 'โควตา')
    .replace(/Admission/gi, 'แอดมิชชัน')
    .replace(/Reflection/gi, 'ทบทวนตัวเอง')
    .trim();
}

function createStaticData() {
  const { APP, DEFAULT_CONFIG_ROWS, DEFAULT_SOURCE_ROWS, DEFAULT_QUESTIONS } = readSourceData();
  const config = Object.fromEntries(DEFAULT_CONFIG_ROWS.map(([key, value]) => [key, value]));
  const questions = DEFAULT_QUESTIONS
    .filter(row => String(row[11]).toUpperCase() !== 'FALSE' && row[0] && String(row[4] || '').trim())
    .map(row => ({
      id: String(row[0]),
      round: String(row[1]).trim().toUpperCase(),
      section: normalizeText(row[2]),
      type: String(row[3] || 'radio').toLowerCase(),
      prompt: normalizeText(row[4]),
      helper: normalizeText(row[5]),
      options: JSON.parse(row[6] || '[]').map(option => ({ ...option, label: normalizeText(option.label) })),
      required: String(row[7]).toUpperCase() === 'TRUE',
    }));
  const sourceLinks = DEFAULT_SOURCE_ROWS.map(row => ({ title: row[1], url: row[2], note: row[3] }));
  return { config, rounds: APP.rounds, questions, sourceLinks };
}

function createStaticRuntime(data, apiUrl) {
  return `
    let STATIC_DATA = ${JSON.stringify(data)};
    const LIVE_BACKEND_URL = ${JSON.stringify(apiUrl || '')};
    const LIVE_QUESTIONS_TIMEOUT_MS = 8000;
    const BACKEND_ATTEMPT_TIMEOUT_MS = 20000;
    const BACKEND_MAX_ATTEMPTS = 3;
    const BACKEND_RETRY_DELAY_MS = 750;
    const BACKEND_LATE_CALLBACK_TTL_MS = 60000;
    const BACKEND_WRITE_TIMEOUT_MS = 45000;
    const LIVE_QUESTIONS_URL = 'https://docs.google.com/spreadsheets/d/1Rnp1zuFBUHLGutWh1h1kVzN1bAfOTVUw36Phj4vYLmQ/export?format=csv&gid=1155617573';
    const STATIC_STORAGE_KEY = 'nextStep.responses';
    const STATIC_TEACHER_USERNAME = 'teacher';
    const STATIC_TEACHER_PASSWORD_HASH = '1057a9604e04b274da5a4de0c8f4b4868d9b230989f8c8c6a28221143cc5a755';
    async function hashStaticPassword(password) {
      const bytes = new TextEncoder().encode(String(password || ''));
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('');
    }
    function parseCsv(text) {
      const rows = [];
      let row = [];
      let field = '';
      let quoted = false;
      for (let i = 0; i < text.length; i += 1) {
        const char = text[i];
        if (quoted) {
          if (char === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
          else if (char === '"') quoted = false;
          else field += char;
        } else if (char === '"') quoted = true;
        else if (char === ',') { row.push(field); field = ''; }
        else if (char === '\\r' || char === '\\n') {
          if (char === '\\r' && text[i + 1] === '\\n') i += 1;
          row.push(field); rows.push(row); row = []; field = '';
        } else field += char;
      }
      if (field || row.length) { row.push(field); rows.push(row); }
      return rows.filter(items => items.some(item => String(item).trim()));
    }
    function parseLiveQuestions(text) {
      const rows = parseCsv(text);
      const headerRow = rows.shift() || [];
      const headers = headerRow.map(header => String(header || '').trim().toLowerCase());
      const index = key => headers.indexOf(key);
      const requiredHeaders = ['id', 'round', 'type', 'prompt', 'options_json'];
      if (requiredHeaders.some(key => index(key) < 0)) throw new Error('ไม่พบหัวคอลัมน์ Questions ที่จำเป็น');
      const parseOptions = value => {
        try {
          const parsed = JSON.parse(String(value || '[]'));
          return Array.isArray(parsed) ? parsed.map(option => ({...option, label: String(option?.label || '').trim()})).filter(option => option.label) : [];
        } catch (error) {
          return [];
        }
      };
      const questions = rows.map(row => ({
        id: String(row[index('id')] || '').trim(),
        round: String(row[index('round')] || '').trim().toUpperCase(),
        section: String(row[index('section')] || '').trim(),
        type: String(row[index('type')] || 'radio').trim().toLowerCase(),
        prompt: String(row[index('prompt')] || '').trim(),
        helper: String(row[index('helper')] || '').trim(),
        options: parseOptions(row[index('options_json')]),
        required: String(row[index('required')] || '').toUpperCase() === 'TRUE',
        active: String(row[index('active')] || '').toUpperCase() !== 'FALSE'
      })).filter(question => question.id && question.prompt && question.active);
      if (!questions.length) throw new Error('ไม่พบคำถามที่ใช้งานอยู่ใน Questions');
      return questions;
    }
    async function loadLiveQuestions() {
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      let timer;
      try {
        const request = fetch(LIVE_QUESTIONS_URL + '&cacheBust=' + Date.now(), {cache:'no-store', ...(controller ? {signal:controller.signal} : {})});
        const timeout = new Promise((resolve, reject) => {
          timer = setTimeout(() => {
            controller?.abort();
            reject(new Error('โหลด Questions เกิน 8 วินาที'));
          }, LIVE_QUESTIONS_TIMEOUT_MS);
        });
        const response = await Promise.race([request, timeout]);
        if (!response.ok) throw new Error('โหลด Questions ไม่สำเร็จ');
        const questions = parseLiveQuestions(await response.text());
        STATIC_DATA = Object.assign({}, STATIC_DATA, {questions});
      } catch (error) {
        console.warn('ใช้คำถามสำรองที่ฝังไว้ เนื่องจากโหลด Questions สดไม่ได้', error);
      } finally {
        clearTimeout(timer);
      }
      return STATIC_DATA;
    }
    function readStaticResponses() {
      try { return JSON.parse(localStorage.getItem(STATIC_STORAGE_KEY) || '[]'); }
      catch (error) { return []; }
    }
    function backendRequestError(message, retryable) {
      const error = new Error(message);
      error.retryable = Boolean(retryable);
      return error;
    }
    function retireBackendCallback(callbackName, script) {
      const lateCallback = () => {};
      window[callbackName] = lateCallback;
      script.remove();
      setTimeout(() => {
        if (window[callbackName] === lateCallback) delete window[callbackName];
      }, BACKEND_LATE_CALLBACK_TTL_MS);
    }
    function requestBackendJsonpOnce(params) {
      if (!LIVE_BACKEND_URL) return Promise.reject(new Error('ยังไม่ได้ตั้งค่า backend ของ Responses'));
      return new Promise((resolve, reject) => {
        const callbackName = '__nextStepJsonp_' + Date.now().toString(36) + Math.random().toString(36).slice(2);
        const script = document.createElement('script');
        const query = new URLSearchParams(Object.assign({}, params, {callback: callbackName}));
        let settled = false;
        const finish = (handler, value) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          retireBackendCallback(callbackName, script);
          handler(value);
        };
        const timer = setTimeout(() => finish(reject, backendRequestError('backend ไม่ตอบกลับภายใน 20 วินาที', true)), BACKEND_ATTEMPT_TIMEOUT_MS);
        window[callbackName] = response => {
          if (!response || response.ok === false) finish(reject, backendRequestError(response?.error || 'backend ตอบกลับไม่สำเร็จ', response?.retryable === true));
          else finish(resolve, response.data);
        };
        script.onerror = () => finish(reject, backendRequestError('เชื่อมต่อ backend ไม่สำเร็จ', true));
        script.src = LIVE_BACKEND_URL + '?' + query.toString();
        document.head.appendChild(script);
      });
    }
    async function requestBackendJsonp(params) {
      let lastError;
      for (let attempt = 1; attempt <= BACKEND_MAX_ATTEMPTS; attempt += 1) {
        try {
          return await requestBackendJsonpOnce(params);
        } catch (error) {
          lastError = error;
          if (!error?.retryable || attempt === BACKEND_MAX_ATTEMPTS) throw error;
          await new Promise(resolve => setTimeout(resolve, BACKEND_RETRY_DELAY_MS * attempt));
        }
      }
      throw lastError;
    }
    function persistBackendResponse(payload) {
      if (!LIVE_BACKEND_URL) return Promise.resolve();
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      let timer;
      const request = fetch(LIVE_BACKEND_URL, {
        method:'POST', mode:'no-cors',
        headers:{'Content-Type':'text/plain;charset=UTF-8'},
        body:JSON.stringify({action:'submitResponse',payload}),
        ...(controller ? {signal:controller.signal} : {})
      }).then(() => undefined);
      const timeout = new Promise((resolve, reject) => {
        timer = setTimeout(() => {
          controller?.abort();
          reject(new Error('backend ไม่ตอบกลับภายใน 45 วินาที ระบบจะแสดงผลต่อโดยไม่รอ backend'));
        }, BACKEND_WRITE_TIMEOUT_MS);
      });
      return Promise.race([request, timeout]).finally(() => clearTimeout(timer));
    }
    function normalizeStaticResponse(result) {
      const profile = result?.profile || {};
      return Object.assign({}, result, {
        firstName: result?.firstName || profile.firstName || '',
        lastName: result?.lastName || profile.lastName || '',
        nickname: result?.nickname || profile.nickname || '',
        classLevel: result?.classLevel || profile.classLevel || '',
        room: result?.room || profile.room || '',
        number: result?.number || profile.number || '',
        targetUniversity: result?.targetUniversity || profile.targetUniversity || '',
        targetFaculty: result?.targetFaculty || profile.targetFaculty || '',
        answersJson: result?.answersJson || '{}'
      });
    }
    function staticStudentKey(result) {
      const normalized = normalizeStaticResponse(result);
      return [normalized.firstName, normalized.lastName].map(value => String(value || '').trim().toLowerCase()).join('|');
    }
    function writeStaticResponse(result) {
      const studentKey = staticStudentKey(result);
      const responses = readStaticResponses().filter(item => staticStudentKey(item) !== studentKey);
      responses.unshift(normalizeStaticResponse(result));
      localStorage.setItem(STATIC_STORAGE_KEY, JSON.stringify(responses.slice(0, 100)));
    }
    function filterStaticResponses(rows, filters) {
      const active = filters || {};
      const query = String(active.query || '').trim().toLowerCase();
      const classLevel = String(active.classLevel || '').trim();
      const room = String(active.room || '').trim();
      return rows.map(normalizeStaticResponse).filter(row => {
        const searchable = [row.firstName, row.lastName, row.nickname, row.classLevel, row.room, row.targetFaculty, row.targetUniversity].join(' ').toLowerCase();
        return (!query || searchable.includes(query)) && (!classLevel || row.classLevel === classLevel) && (!room || row.room === room);
      });
    }
    function staticCsvCell(value) {
      const text = String(value ?? '');
      return /[",]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
    }
    function staticResponsesCsv(rows) {
      const headers = ['created_at', 'submission_id', 'first_name', 'last_name', 'nickname', 'class_level', 'room', 'number', 'target_university', 'target_faculty', 'answers_json'];
      const lines = [headers.join(',')];
      rows.forEach(row => lines.push([
        row.createdAt, row.submissionId, row.firstName, row.lastName, row.nickname,
        row.classLevel, row.room, row.number, row.targetUniversity, row.targetFaculty, row.answersJson
      ].map(staticCsvCell).join(',')));
      return lines.join(String.fromCharCode(10));
    }
    function staticAnswerProvided(answer) {
      return answer !== undefined && answer !== null && answer !== '' && !(Array.isArray(answer) && answer.length === 0) && !(answer && typeof answer === 'object' && !Array.isArray(answer) && Object.keys(answer).length === 0);
    }
    function buildStaticResult(payload) {
      const rounds = {};
      STATIC_DATA.rounds.forEach(round => {
        rounds[round.id] = { id: round.id, title: round.title, subtitle: round.subtitle, answered: 0, total: 0, topics: [] };
      });
      STATIC_DATA.questions.forEach(question => {
        const bucket = rounds[question.round];
        if (!bucket) return;
        bucket.total += 1;
        const answer = payload.answers[question.id];
        if (staticAnswerProvided(answer)) bucket.answered += 1;
        const topic = String(question.section || '').trim();
        if (topic && !bucket.topics.includes(topic)) bucket.topics.push(topic);
      });
      const profile = payload.profile || {};
      return {
        rounds,
        answered: Object.values(payload.answers).filter(staticAnswerProvided).length,
        total: STATIC_DATA.questions.length,
        submissionId: 'local-' + Date.now().toString(36),
        createdAt: new Date().toISOString(),
        profile,
        firstName: profile.firstName || '',
        lastName: profile.lastName || '',
        nickname: profile.nickname || '',
        classLevel: profile.classLevel || '',
        room: profile.room || '',
        number: profile.number || '',
        targetUniversity: profile.targetUniversity || '',
        targetFaculty: profile.targetFaculty || '',
        answersJson: JSON.stringify(payload.answers || {})
      };
    }
    const staticBackend = {
      run: {
        success: null,
        failure: null,
        withSuccessHandler(handler) { const runner = Object.create(this); runner.success = handler; return runner; },
        withFailureHandler(handler) { const runner = Object.create(this); runner.failure = handler; return runner; },
        getAppData() {
          const backend = this;
          const request = loadLiveQuestions();
          request.then(data => { if (data?.questions) STATIC_DATA = data; backend.success?.(data); }).catch(error => {
            console.warn('ใช้ข้อมูลสำรองเพราะโหลด Questions สดไม่สำเร็จ', error);
            backend.success?.(STATIC_DATA);
          });
          return this;
        },
        submitResponse(payload) {
          const backend = this;
          const result = buildStaticResult(payload);
          if (!LIVE_BACKEND_URL) { writeStaticResponse(result); backend.success?.(result); return this; }
          persistBackendResponse(payload).then(() => {
            result.submissionId = 'github-' + Date.now().toString(36);
            result.backendSaved = true;
            backend.success?.(result);
          }).catch(error => {
            result.backendSaved = false;
            result.backendError = error?.message || 'backend ไม่ตอบกลับ';
            if (typeof notify === 'function') notify('แสดงผลแล้ว แต่ backend ยังยืนยันการบันทึกไม่ได้ กรุณาตรวจ Responses ภายหลัง');
            backend.success?.(result);
          });
          return this;
        },
        teacherLogout(token) {
          const backend = this;
          if (!LIVE_BACKEND_URL) { backend.success?.({ok:true}); return this; }
          requestBackendJsonp({api:'teacherLogout',token}).then(result => backend.success?.(result)).catch(error => backend.failure?.(error));
          return this;
        },
        teacherLogin() { this.failure?.(new Error('โหมดครูไม่เปิดใช้งานในเว็บไซต์แบบ static')); return this; },
        listResponses() { this.success?.(readStaticResponses()); return this; },
        exportResponsesCsv() { this.failure?.(new Error('ดาวน์โหลดข้อมูลครูไม่เปิดใช้งานในเว็บไซต์แบบ static')); return this; }
      }
    };
    staticBackend.run.teacherLogin = async function(username, password) {
      if (LIVE_BACKEND_URL) {
        const backend = this;
        try {
          const passwordHash = await hashStaticPassword(password);
          requestBackendJsonp({api:'teacherLogin',username:String(username || '').trim(),passwordHash}).then(result => backend.success?.(result)).catch(error => backend.failure?.(error));
        } catch (error) { backend.failure?.(error); }
        return this;
      }
      let passwordHash = '';
      try { passwordHash = await hashStaticPassword(password); } catch (error) {}
      if (String(username || '').trim().toLowerCase() !== STATIC_TEACHER_USERNAME || passwordHash !== STATIC_TEACHER_PASSWORD_HASH) {
        this.failure?.(new Error('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง'));
        return this;
      }
      this.success?.({ token: 'static-teacher-' + Date.now().toString(36), displayName: 'คุณครู', role: 'teacher' });
      return this;
    };
    staticBackend.run.listResponses = function(token, filters) {
      if (LIVE_BACKEND_URL) {
        const backend = this;
        requestBackendJsonp({api:'listResponses',token,query:filters?.query || '',classLevel:filters?.classLevel || '',room:filters?.room || ''}).then(rows => backend.success?.(rows)).catch(error => backend.failure?.(error));
        return this;
      }
      this.success?.(filterStaticResponses(readStaticResponses(), filters));
      return this;
    };
    staticBackend.run.exportResponsesCsv = function(token, filters) {
      if (LIVE_BACKEND_URL) {
        const backend = this;
        requestBackendJsonp({api:'exportResponsesCsv',token,query:filters?.query || '',classLevel:filters?.classLevel || '',room:filters?.room || ''}).then(csv => backend.success?.(csv)).catch(error => backend.failure?.(error));
        return this;
      }
      this.success?.(staticResponsesCsv(filterStaticResponses(readStaticResponses(), filters)));
      return this;
    };
  `;
}

const template = fs.readFileSync(sourcePath, 'utf8');
const data = createStaticData();
const runtime = createStaticRuntime(data, webAppUrl);
let output = template
  .replace('<base target="_top">', '<base target="_self">')
  .replaceAll('__APP_VERSION__', appVersion)
  .replaceAll('google.script', 'staticBackend')
  .replace('    const state = {', `${runtime}\n    const state = {`);

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, output, 'utf8');
console.log(`Built ${path.relative(root, outputPath)} ${appVersion} with ${data.questions.length} questions.`);

export { createStaticRuntime };
