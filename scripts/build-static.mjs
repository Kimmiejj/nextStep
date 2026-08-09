import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..');
const sourcePath = path.join(root, 'apps-script', 'Index.html');
const codePath = path.join(root, 'apps-script', 'Code.gs');
const outputPath = path.join(root, 'dist', 'index.html');
const webAppUrl = String(process.env.APPS_SCRIPT_WEB_APP_URL || '').trim();

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
      try {
        const response = await fetch(LIVE_QUESTIONS_URL + '&cacheBust=' + Date.now(), {cache:'no-store'});
        if (!response.ok) throw new Error('โหลด Questions ไม่สำเร็จ');
        const questions = parseLiveQuestions(await response.text());
        STATIC_DATA = Object.assign({}, STATIC_DATA, {questions});
      } catch (error) {
        console.warn('ใช้คำถามสำรองที่ฝังไว้ เนื่องจากโหลด Questions สดไม่ได้', error);
      }
      return STATIC_DATA;
    }
    function readStaticResponses() {
      try { return JSON.parse(localStorage.getItem(STATIC_STORAGE_KEY) || '[]'); }
      catch (error) { return []; }
    }
    function requestBackendJsonp(params) {
      if (!LIVE_BACKEND_URL) return Promise.reject(new Error('ยังไม่ได้ตั้งค่า backend ของ Responses'));
      return new Promise((resolve, reject) => {
        const callbackName = '__nextStepJsonp_' + Date.now().toString(36) + Math.random().toString(36).slice(2);
        const script = document.createElement('script');
        const query = new URLSearchParams(Object.assign({}, params, {callback: callbackName}));
        const cleanup = () => { delete window[callbackName]; script.remove(); };
        const timer = setTimeout(() => { cleanup(); reject(new Error('backend ไม่ตอบกลับภายในเวลาที่กำหนด')); }, 15000);
        window[callbackName] = response => {
          clearTimeout(timer);
          cleanup();
          if (!response || response.ok === false) reject(new Error(response?.error || 'backend ตอบกลับไม่สำเร็จ'));
          else resolve(response.data);
        };
        script.onerror = () => { clearTimeout(timer); cleanup(); reject(new Error('เชื่อมต่อ backend ไม่สำเร็จ')); };
        script.src = LIVE_BACKEND_URL + '?' + query.toString();
        document.head.appendChild(script);
      });
    }
    function persistBackendResponse(payload) {
      if (!LIVE_BACKEND_URL) return Promise.resolve();
      return fetch(LIVE_BACKEND_URL, {
        method:'POST', mode:'no-cors',
        headers:{'Content-Type':'text/plain;charset=UTF-8'},
        body:JSON.stringify({action:'submitResponse',payload})
      }).then(() => undefined);
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
        withSuccessHandler(handler) { this.success = handler; return this; },
        withFailureHandler(handler) { this.failure = handler; return this; },
        getAppData() {
          const backend = this;
          const request = LIVE_BACKEND_URL ? requestBackendJsonp({api:'getAppData'}) : loadLiveQuestions();
          request.then(data => { if (data?.questions) STATIC_DATA = data; backend.success?.(data); }).catch(error => {
            if (LIVE_BACKEND_URL) console.warn('ใช้ข้อมูลสำรองเพราะโหลด backend ไม่สำเร็จ', error);
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
          }).catch(error => backend.failure?.(error));
          return this;
        },
        teacherLogout() { return this; },
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
  .replaceAll('google.script', 'staticBackend')
  .replace('    const state = {', `${runtime}\n    const state = {`);

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, output, 'utf8');
console.log(`Built ${path.relative(root, outputPath)} with ${data.questions.length} questions.`);
