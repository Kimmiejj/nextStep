/**
 * TCAS Compass - Google Apps Script backend
 *
 * Bind this project to the target Google Sheet or replace SHEET_ID with the
 * spreadsheet id from the deployment's bound sheet.
 */
const APP = {
  sheetId: '1Rnp1zuFBUHLGutWh1h1kVzN1bAfOTVUw36Phj4vYLmQ',
  sheets: {
    readme: 'README',
    config: 'Config',
    questions: 'Questions',
    responses: 'Responses',
    users: 'Users',
    sources: 'Sources'
  },
  rounds: [
    { id: 'R1', title: 'รอบที่ 1 แฟ้มสะสมผลงาน', subtitle: 'แฟ้มสะสมผลงานและตัวตนของเรา', tone: 'violet' },
    { id: 'R2', title: 'รอบที่ 2 โควตา', subtitle: 'โควตาพื้นที่และคุณสมบัติเฉพาะ', tone: 'blue' },
    { id: 'R3', title: 'รอบที่ 3 แอดมิชชัน', subtitle: 'คะแนน TGAT/TPAT และ A-Level', tone: 'orange' },
    { id: 'R4', title: 'รอบที่ 4 รับตรงอิสระ', subtitle: 'ติดตามประกาศและสมัครกับมหาวิทยาลัย', tone: 'green' },
    { id: 'NOTE', title: 'Note เพิ่มเติม', subtitle: 'ข้อมูลเพิ่มเติมสำหรับใช้ประกอบการวางแผน', tone: 'yellow' }
  ]
};

const APP_DATA_CACHE_KEY = 'app_data_v2';
const APP_DATA_CACHE_SECONDS = 300;
let APP_SPREADSHEET_;

const QUESTION_TYPES = ['checkbox', 'radio', 'textarea', 'text', 'university_targets', 'university_targets_10', 'university_targets_if_yes', 'exam_scores', 'star_rating'];
const QUESTION_HEADERS = ['id', 'round', 'section', 'type', 'prompt', 'helper', 'options_json', 'required', 'active'];

const RESPONSE_HEADERS = [
  'created_at', 'submission_id', 'first_name', 'last_name', 'nickname',
  'class_level', 'room', 'number', 'target_university', 'target_faculty',
  'answers_json'
];

const DEFAULT_CONFIG_ROWS = [
  ['APP_NAME', 'TCAS Compass', 'ชื่อแอปที่แสดงบนหน้าเว็บ'],
  ['ACADEMIC_YEAR', '2570 / TCAS70', 'ปีการศึกษาที่ใช้เป็นข้อมูลตั้งต้น แก้ได้เมื่อมีประกาศใหม่'],
  ['RESULT_DISCLAIMER', 'ข้อมูลนี้จัดทำเพื่อช่วยให้ผู้เรียนเห็นองค์ประกอบและคำถามสำคัญของแต่ละรอบ TCAS ไม่ใช่การให้คะแนนหรือการรับรองผลคัดเลือก โปรดตรวจประกาศและคุณสมบัติของหลักสูตรจริงทุกครั้ง', 'ข้อความกำกับผลลัพธ์'],
  ['CONTACT_NOTE', 'สอบถามครูแนะแนวหรือฝ่ายวิชาการของโรงเรียนเมื่อพบโครงการที่สนใจ', 'ข้อความช่วยเหลือผู้เรียน'],
  ['UPDATED_AT', '2026-08-08', 'วันที่อัปเดตข้อมูลอ้างอิงล่าสุด'],
  ['TEACHER_SESSION_MINUTES', '60', 'อายุ session โหมดครู (นาที)']
];

const DEFAULT_SOURCE_ROWS = [
  ['TCAS70_MAIN', 'ปฏิทินและรูปแบบการสมัคร TCAS70', 'https://www.mytcas.com/', 'แหล่งทางการ: รอบ 1 Portfolio, รอบ 2 Quota, รอบ 3 Admission, รอบ 4 Direct Admission และกำหนดการภาพรวม', '2026-08-08'],
  ['TCAS70_SCHOOL', 'หน้าข้อมูล TCAS70 สำหรับสถานศึกษา', 'https://school.mytcas.com/', 'แหล่งทางการ: ปฏิทิน TCAS70 และปฏิทินสอบ TGAT/TPAT/A-Level', '2026-08-08'],
  ['TCAS70_BLUEPRINT', 'โครงสร้างข้อสอบและตัวอย่างข้อสอบ TCAS70', 'https://www.mytcas.com/blueprint/', 'แหล่งทางการ: รายการ TGAT, TPAT และ A-Level ที่ใช้เตรียมตัว', '2026-08-08'],
  ['TCAS_STAT', 'สถิติการคัดเลือกและคะแนนย้อนหลัง', 'https://mytcas.com/stat/', 'ใช้ดูแนวโน้มและสถิติประกอบการวางแผน ไม่ใช่เกณฑ์รับประกันการติด', '2026-08-08'],
  ['TCAS_MANUAL', 'คู่มือผู้สมัคร TCAS69 (รูปแบบกระบวนการ)', 'https://assets.mytcas.com/69/TCAS69-user-manual.pdf', 'หลักการสมัคร/ยืนยันสิทธิ์/สละสิทธิ์ ต้องตรวจคู่มือปีล่าสุดอีกครั้ง', '2026-08-08']
];

const DEFAULT_USER_ROWS = [
  ['teacher', 'a88c63e97ee7e91c48b2f04957a54f9a817730e807222d4dd5324af14bec5f1c', 'teacher', 'TRUE', 'ครูแนะแนว'],
  ['admin', 'a88c63e97ee7e91c48b2f04957a54f9a817730e807222d4dd5324af14bec5f1c', 'admin', 'TRUE', 'ผู้ดูแลระบบ']
];

const DEFAULT_QUESTIONS = [
  ['R1_01', 'R1', 'ผลงานและตัวตน', 'checkbox', 'ตอนนี้คุณมีหลักฐานหรือผลงานอะไรที่เล่า “ความเป็นตัวเอง” ได้บ้าง', 'เลือกได้หลายข้อ ผลงานไม่จำเป็นต้องเป็นรางวัลเสมอไป แต่ควรมีหลักฐานและเรื่องราวของเรา', '[{"label":"มีผลงาน/โครงงานที่ทำจริงและอธิบายบทบาทตัวเองได้","score":35},{"label":"มีรางวัลหรือผลงานที่ผ่านการคัดเลือก","score":25},{"label":"มีกิจกรรมที่เชื่อมโยงกับคณะ/สาขาที่สนใจ","score":25},{"label":"มีหลักฐาน เช่น รูป ใบประกาศ ลิงก์ หรือชิ้นงาน","score":15}]', 'TRUE', '100', 'sum', '0', 'TRUE', 'https://www.mytcas.com/'],
  ['R1_02', 'R1', 'การสื่อสาร', 'checkbox', 'คุณพร้อมเล่าเหตุผลและบทเรียนจากผลงานของตัวเองแค่ไหน', 'Portfolio ที่ดีควรสะท้อนกระบวนการคิด ไม่ใช่รวมภาพกิจกรรมอย่างเดียว', '[{"label":"อธิบายแรงบันดาลใจและสิ่งที่เรียนรู้ได้ชัดเจน","score":45},{"label":"เล่าบทบาทของตัวเองในงานกลุ่มได้","score":25},{"label":"เชื่อมโยงผลงานกับสาขาที่สนใจได้","score":30}]', 'TRUE', '100', 'sum', '0', 'TRUE', 'https://www.mytcas.com/'],
  ['R1_03', 'R1', 'ความพร้อมเอกสาร', 'radio', 'แฟ้มสะสมผลงานและเอกสารสมัครของคุณอยู่ในระดับใด', '', '[{"label":"ยังไม่มีโครงร่าง","score":10},{"label":"มีไฟล์/ผลงานแล้ว แต่ยังต้องคัดและเรียบเรียง","score":55},{"label":"มี Portfolio ฉบับพร้อมตรวจทานและปรับตามประกาศ","score":85},{"label":"พร้อมส่งและตรวจคุณสมบัติของโครงการแล้ว","score":100}]', 'TRUE', '100', 'max', '0', 'TRUE', 'https://www.mytcas.com/'],
  ['R1_04', 'R1', 'สัมภาษณ์', 'radio', 'ถ้าได้รับเชิญสัมภาษณ์ คุณมั่นใจในการตอบคำถามเกี่ยวกับตัวเองและสาขาที่เลือกแค่ไหน', '', '[{"label":"ยังไม่มั่นใจ ต้องฝึกมาก","score":25},{"label":"พอเล่าได้ แต่ยังตอบคำถามต่อยอดไม่คล่อง","score":55},{"label":"ซ้อมตอบและมีตัวอย่างจากประสบการณ์จริง","score":85},{"label":"เคยสัมภาษณ์/นำเสนอและพร้อมรับคำถามต่อยอด","score":100}]', 'TRUE', '100', 'max', '0', 'TRUE', 'https://www.mytcas.com/'],
  ['R1_05', 'R1', 'ทบทวนตัวเอง', 'textarea', 'เขียนสั้น ๆ: ผลงานหรือกิจกรรมใดสะท้อนตัวคุณมากที่สุด และเพราะอะไร', 'คำตอบนี้ใช้ช่วยให้คุณทบทวนตัวเอง และส่งให้ครูแนะแนวดูได้', '[]', 'FALSE', '0', 'max', '0', 'TRUE', 'https://www.mytcas.com/'],
  ['R2_01', 'R2', 'คุณสมบัติโควตา', 'checkbox', 'คุณมีเงื่อนไขที่อาจตรงกับโครงการโควตาใดบ้าง', 'แต่ละมหาวิทยาลัย/โครงการกำหนดไม่เหมือนกัน ต้องเปิดประกาศจริงตรวจซ้ำ', '[{"label":"โควตาพื้นที่/จังหวัด/ภูมิภาค","score":35},{"label":"โควตาโรงเรียนหรือเครือข่าย","score":30},{"label":"โควตาความสามารถพิเศษ/กิจกรรม","score":20},{"label":"โควตาฐานะ/กลุ่มเป้าหมายตามประกาศ","score":15}]', 'TRUE', '100', 'sum', '0', 'TRUE', 'https://school.mytcas.com/'],
  ['R2_02', 'R2', 'การตรวจประกาศ', 'radio', 'คุณเคยเปิดประกาศรับสมัครของโครงการที่สนใจและเช็กคุณสมบัติรายข้อแล้วหรือยัง', '', '[{"label":"ยังไม่เคยเช็ก","score":10},{"label":"เคยดูคร่าว ๆ","score":45},{"label":"เช็กคุณสมบัติและเอกสารแล้วบางส่วน","score":75},{"label":"บันทึกประกาศ/วันเวลา/เงื่อนไขไว้แล้ว","score":100}]', 'TRUE', '100', 'max', '0', 'TRUE', 'https://school.mytcas.com/'],
  ['R2_03', 'R2', 'เกรดและหลักฐาน', 'radio', 'ความพร้อมด้าน GPAX/ผลการเรียนและเอกสารยืนยันของคุณเป็นอย่างไร', '', '[{"label":"ยังไม่รู้ว่าต้องใช้กี่ภาคเรียนหรือเกณฑ์เท่าไร","score":20},{"label":"รู้คะแนนของตัวเองแล้ว แต่ยังต้องเทียบกับประกาศ","score":55},{"label":"คะแนนผ่านเงื่อนไขเบื้องต้นและมีหลักฐานพร้อม","score":85},{"label":"ตรวจทั้ง GPAX รายวิชา และเอกสารครบแล้ว","score":100}]', 'TRUE', '100', 'max', '0', 'TRUE', 'https://www.mytcas.com/'],
  ['R2_04', 'R2', 'พื้นที่และการเดินทาง', 'checkbox', 'คุณจัดการเงื่อนไขด้านพื้นที่/การเดินทาง/การสอบของโครงการได้แค่ไหน', '', '[{"label":"ตรวจแล้วว่าอยู่ในพื้นที่หรือกลุ่มที่โครงการกำหนด","score":40},{"label":"วางแผนเดินทางไปสอบสัมภาษณ์/สอบปฏิบัติได้","score":30},{"label":"ผู้ปกครองรับทราบและช่วยวางแผน","score":15},{"label":"มีแผนสำรองหากวันสอบชนกัน","score":15}]', 'TRUE', '100', 'sum', '0', 'TRUE', 'https://school.mytcas.com/'],
  ['R2_05', 'R2', 'ทบทวนตัวเอง', 'textarea', 'เขียนสั้น ๆ: โครงการโควตาที่อยากลอง และคุณสมบัติข้อใดที่ต้องเช็กเพิ่ม', '', '[]', 'FALSE', '0', 'max', '0', 'TRUE', 'https://school.mytcas.com/'],
  ['R3_01', 'R3', 'คะแนนสอบ', 'checkbox', 'ตอนนี้คุณมีคะแนนหรือแผนสอบวิชาใดแล้วบ้าง', 'รอบ 3 ใช้เกณฑ์ของหลักสูตรและข้อมูลคะแนนตามประกาศ ต้องเช็กว่าคณะเป้าหมายใช้วิชาใด', '[{"label":"มี/กำลังเตรียม TGAT","score":25},{"label":"มี/กำลังเตรียม TPAT ที่เกี่ยวข้อง","score":25},{"label":"มี/กำลังเตรียม A-Level ที่เกี่ยวข้อง","score":35},{"label":"รู้วิชาที่หลักสูตรเป้าหมายใช้และวางแผนอ่านแล้ว","score":15}]', 'TRUE', '100', 'sum', '0', 'TRUE', 'https://www.mytcas.com/blueprint/'],
  ['R3_02', 'R3', 'การวางแผนคะแนน', 'radio', 'คุณประเมินคะแนนของตัวเองเทียบกับข้อมูลหลักสูตร/สถิติย้อนหลังอย่างไร', 'สถิติย้อนหลังช่วยวางแผน แต่คะแนนตัดและจำนวนที่นั่งเปลี่ยนได้ทุกปี', '[{"label":"ยังไม่มีคะแนนหรือยังไม่เคยเทียบ","score":15},{"label":"มีคะแนนบางวิชาและกำลังหาข้อมูล","score":45},{"label":"เทียบคะแนนกับหลายหลักสูตรและรู้จุดที่ต้องเพิ่ม","score":75},{"label":"มีแผนคะแนนเป้าหมายและแผนสำรองเป็นลำดับ","score":100}]', 'TRUE', '100', 'max', '0', 'TRUE', 'https://mytcas.com/stat/'],
  ['R3_03', 'R3', 'ทางเลือก', 'checkbox', 'คุณเตรียมทางเลือกในการจัดอันดับ/เลือกหลักสูตรไว้อย่างไร', '', '[{"label":"มีคณะ/สาขาเป้าหมายหลัก","score":25},{"label":"มีตัวเลือกที่คะแนน/เงื่อนไขต่างระดับกัน","score":35},{"label":"พิจารณาค่าใช้จ่าย ที่ตั้ง และรูปแบบการเรียนแล้ว","score":20},{"label":"พร้อมจัดอันดับตามความต้องการจริง ไม่เลือกตามกระแสอย่างเดียว","score":20}]', 'TRUE', '100', 'sum', '0', 'TRUE', 'https://www.mytcas.com/'],
  ['R3_04', 'R3', 'สิทธิ์และกำหนดการ', 'radio', 'คุณเข้าใจเรื่องยืนยันสิทธิ์/สละสิทธิ์และกำหนดการของระบบ TCAS แค่ไหน', '', '[{"label":"ยังสับสน ต้องให้ครูช่วยอธิบาย","score":20},{"label":"รู้ว่าต้องติดตามประกาศ แต่ยังไม่รู้รายละเอียด","score":50},{"label":"อ่านคู่มือและจดกำหนดการสำคัญแล้ว","score":85},{"label":"วางแผนการตัดสินใจและรู้ผลของการยืนยัน/สละสิทธิ์แล้ว","score":100}]', 'TRUE', '100', 'max', '0', 'TRUE', 'https://assets.mytcas.com/69/TCAS69-user-manual.pdf'],
  ['R3_05', 'R3', 'ทบทวนตัวเอง', 'textarea', 'เขียนสั้น ๆ: วิชาไหนคือจุดแข็ง และวิชาไหนคือจุดที่อยากพัฒนาใน 30 วันข้างหน้า', '', '[]', 'FALSE', '0', 'max', '0', 'TRUE', 'https://www.mytcas.com/blueprint/'],
  ['R4_01', 'R4', 'การติดตามประกาศ', 'radio', 'ถ้าจะสมัครรอบรับตรงอิสระ คุณพร้อมติดตามประกาศจากเว็บไซต์มหาวิทยาลัยหลายแห่งแค่ไหน', 'รอบ 4 สมัครที่ระบบของมหาวิทยาลัยและรายละเอียดแตกต่างกัน', '[{"label":"ยังไม่รู้ว่าจะติดตามที่ไหน","score":15},{"label":"มีรายชื่อมหาวิทยาลัยไว้แล้วแต่ยังไม่ได้ตั้งเตือน","score":50},{"label":"ตั้งเตือน/ติดตามช่องทางประกาศของมหาวิทยาลัยแล้ว","score":85},{"label":"เช็กประกาศสม่ำเสมอและมีตารางวันสมัครของตัวเอง","score":100}]', 'TRUE', '100', 'max', '0', 'TRUE', 'https://school.mytcas.com/'],
  ['R4_02', 'R4', 'ความยืดหยุ่น', 'checkbox', 'คุณมีทางเลือกและความยืดหยุ่นสำหรับรอบ 4 มากแค่ไหน', '', '[{"label":"เปิดรับหลายมหาวิทยาลัยหรือหลายพื้นที่","score":30},{"label":"พิจารณาสาขาใกล้เคียงที่ยังตรงความสนใจ","score":30},{"label":"พร้อมดูเงื่อนไขสอบสัมภาษณ์/สอบปฏิบัติเฉพาะที่","score":25},{"label":"มีแผนเรื่องค่าใช้จ่ายและการเดินทาง","score":15}]', 'TRUE', '100', 'sum', '0', 'TRUE', 'https://school.mytcas.com/'],
  ['R4_03', 'R4', 'เอกสารและเวลา', 'checkbox', 'สิ่งใดที่คุณเตรียมไว้แล้วสำหรับการสมัครแบบเร่งด่วน', '', '[{"label":"ไฟล์บัตรประชาชน/ทะเบียนบ้าน/ผลการเรียนพร้อมใช้","score":35},{"label":"รูปถ่ายและเอกสารตามแบบฟอร์มพร้อม","score":25},{"label":"มีปฏิทินเตือนวันสมัครและวันยืนยันสิทธิ์","score":25},{"label":"มีผู้ใหญ่ช่วยตรวจเอกสารก่อนส่ง","score":15}]', 'TRUE', '100', 'sum', '0', 'TRUE', 'https://school.mytcas.com/'],
  ['R4_04', 'R4', 'ทบทวนตัวเอง', 'textarea', 'เขียนสั้น ๆ: ถ้ารอบ 4 เปิดรับพรุ่งนี้ คุณจะต้องทำอะไรเป็นอย่างแรก', '', '[]', 'FALSE', '0', 'max', '0', 'TRUE', 'https://school.mytcas.com/']
];

function doGet(e) {
  const params = e && e.parameter ? e.parameter : {};
  if (params.api) return handleApiGet_(params);
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle(getConfig_().APP_NAME || 'TCAS Compass')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function doPost(e) {
  let request = {};
  try { request = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (error) {}
  try {
    if (request.action === 'submitResponse') {
      return jsonOutput_({ ok: true, data: submitResponse(request.payload || {}) });
    }
    return jsonOutput_({ ok: false, error: 'ไม่พบ action ที่รองรับ' });
  } catch (error) {
    return jsonOutput_({ ok: false, error: String(error && error.message || error) });
  }
}

function handleApiGet_(params) {
  const callback = params.callback || '';
  try {
    let data;
    if (params.api === 'getAppData') data = getAppData();
    else if (params.api === 'teacherLogin') data = teacherLoginHash_(params.username, params.passwordHash);
    else if (params.api === 'teacherLogout') data = teacherLogout(params.token);
    else if (params.api === 'listResponses') data = listResponses(params.token, { query: params.query, classLevel: params.classLevel, room: params.room });
    else if (params.api === 'exportResponsesCsv') data = exportResponsesCsv(params.token, { query: params.query, classLevel: params.classLevel, room: params.room });
    else throw new Error('ไม่พบ API ที่ร้องขอ');
    return jsonpOutput_(callback, { ok: true, data: data });
  } catch (error) {
    const message = String(error && error.message || error);
    return jsonpOutput_(callback, { ok: false, error: message, retryable: isRetryableBackendError_(message) });
  }
}

function isRetryableBackendError_(message) {
  return /(timed out|timeout|internal error|temporar|try again|service unavailable|service invoked too many|ไม่พร้อมใช้งาน|ลองใหม่)/i.test(String(message || ''));
}

function jsonOutput_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}

function jsonpOutput_(callback, value) {
  if (!/^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/.test(String(callback || ''))) return jsonOutput_(value);
  return ContentService.createTextOutput(String(callback) + '(' + JSON.stringify(value) + ');').setMimeType(ContentService.MimeType.JAVASCRIPT);
}

function parseQuestionOptions_(value) {
  try {
    const parsed = value ? JSON.parse(value) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

function compactQuestionRow_(row) {
  const options = parseQuestionOptions_(row[6]).map(option => Object.assign({}, option, { label: String(option.label || '') }));
  return [row[0], row[1], row[2], row[3], row[4], row[5], JSON.stringify(options), row[7], row[11]];
}

function migrateQuestionsSheet() {
  const sheet = getSheet_(APP.sheets.questions);
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return { ok: true, rows: 0, columns: QUESTION_HEADERS };
  const headers = values.shift();
  const ix = headerIndex_(headers);
  const rows = values.filter(row => row[ix.id]).map(row => {
    const options = parseQuestionOptions_(row[ix.options_json]).map(option => ({ label: String(option.label || '') }));
    return [
      row[ix.id], row[ix.round], row[ix.section], row[ix.type], row[ix.prompt], row[ix.helper],
      JSON.stringify(options), row[ix.required], row[ix.active] === undefined ? 'TRUE' : row[ix.active]
    ];
  });
  writeTable_(sheet, QUESTION_HEADERS, rows);
  formatTable_(sheet, QUESTION_HEADERS.length);
  clearAppDataCache_();
  return { ok: true, rows: rows.length, columns: QUESTION_HEADERS };
}

function setupSheet() {
  const ss = getSpreadsheet_();
  const existing = ss.getSheets().map(s => s.getName());
  if (existing.indexOf(APP.sheets.readme) < 0 && existing.indexOf('ชีต1') >= 0) {
    ss.getSheetByName('ชีต1').setName(APP.sheets.readme);
  }
  [APP.sheets.config, APP.sheets.questions, APP.sheets.responses, APP.sheets.users, APP.sheets.sources].forEach(name => {
    if (!ss.getSheetByName(name)) ss.insertSheet(name);
  });

  writeTable_(ss.getSheetByName(APP.sheets.config), ['key', 'value', 'description'], DEFAULT_CONFIG_ROWS);
  writeTable_(ss.getSheetByName(APP.sheets.questions), QUESTION_HEADERS, DEFAULT_QUESTIONS.map(compactQuestionRow_));
  writeTable_(ss.getSheetByName(APP.sheets.responses), RESPONSE_HEADERS, []);
  writeTable_(ss.getSheetByName(APP.sheets.users), ['username', 'password_hash', 'role', 'active', 'display_name'], DEFAULT_USER_ROWS);
  writeTable_(ss.getSheetByName(APP.sheets.sources), ['source_id', 'title', 'url', 'note', 'checked_at'], DEFAULT_SOURCE_ROWS);

  const readme = ss.getSheetByName(APP.sheets.readme);
  readme.clear();
  const readmeRows = [
    ['TCAS Compass | คู่มือผู้ดูแลระบบ', '', ''],
    ['เริ่มต้นใช้งาน', '1) เปิด Apps Script ของชีตนี้  2) วางไฟล์ Code.gs และ Index.html  3) รัน setupSheet() ครั้งเดียว  4) Deploy > New deployment > Web app', ''],
    ['สิทธิ์ Deploy', 'Execute as: Me / Who has access: Anyone (หรือ Anyone in domain ตามนโยบายโรงเรียน)', ''],
    ['บัญชีครู', 'ตั้ง username ในแท็บ Users แล้วรัน setTeacherPassword(\'teacher\', \'รหัสใหม่อย่างน้อย 8 ตัว\') หนึ่งครั้ง', 'อย่าเก็บรหัสผ่านแบบ plaintext ใน repository สาธารณะ'],
    ['โครงสร้างข้อมูล', 'Config = ข้อความ/ตั้งค่า | Questions = คำถามและตัวเลือก | Responses = ข้อมูลการตอบของผู้เรียน | Users = บัญชีครู | Sources = แหล่งอ้างอิง', ''],
    ['การแก้คำถาม', 'แก้ข้อความ ตัวเลือก และคำแนะนำได้ที่แท็บ Questions โดยไม่ต้องแก้ HTML/JavaScript', 'ระบบใช้คำถามเพื่อการเรียนรู้และการทบทวน ไม่มีการคำนวณหรือเก็บคะแนนใหม่'],
    ['การอ่านผล', 'ผลลัพธ์จะแสดงองค์ประกอบของแต่ละรอบ พร้อมคำถามและคำตอบของผู้เรียน เพื่อใช้ประกอบการเรียนรู้เท่านั้น', 'ต้องตรวจประกาศของมหาวิทยาลัย/หลักสูตรที่สนใจทุกครั้ง'],
    ['แหล่งอ้างอิงหลัก', 'mytcas.com / school.mytcas.com / blueprint / stat', 'ดู URL และวันที่ตรวจสอบในแท็บ Sources'],
    ['หมายเหตุด้านข้อมูลส่วนบุคคล', 'Responses มีข้อมูลนักเรียน ใช้สิทธิ์แชร์ชีตเท่าที่จำเป็น และตั้งค่า Web app ตามนโยบายโรงเรียน', '']
  ];
  readme.getRange(1, 1, readmeRows.length, 3).setValues(readmeRows);
  formatTable_(readme, 3);
  formatTable_(ss.getSheetByName(APP.sheets.config), 3);
  formatTable_(ss.getSheetByName(APP.sheets.questions), QUESTION_HEADERS.length);
  formatTable_(ss.getSheetByName(APP.sheets.responses), RESPONSE_HEADERS.length);
  formatTable_(ss.getSheetByName(APP.sheets.users), 5);
  formatTable_(ss.getSheetByName(APP.sheets.sources), 5);
  clearAppDataCache_();
  return { ok: true, spreadsheetUrl: ss.getUrl() };
}

function getAppData() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(APP_DATA_CACHE_KEY);
  if (cached) {
    try { return JSON.parse(cached); } catch (error) {}
  }
  const data = {
    config: getConfig_(),
    rounds: APP.rounds,
    questions: readQuestions_(),
    sourceLinks: getSourceLinks_()
  };
  try { cache.put(APP_DATA_CACHE_KEY, JSON.stringify(data), APP_DATA_CACHE_SECONDS); } catch (error) {}
  return data;
}

function submitResponse(payload) {
  if (!payload || !payload.profile) throw new Error('ข้อมูลผู้เรียนไม่ครบ');
  const profile = payload.profile;
  ['firstName', 'lastName', 'nickname', 'classLevel', 'room', 'number'].forEach(key => {
    if (String(profile[key] || '').trim() === '') throw new Error('กรุณากรอกข้อมูลผู้เรียนให้ครบ');
  });
  const questions = readQuestions_();
  const answers = payload.answers || {};
  const summary = buildLearningSummary_(questions, answers);
  const id = Utilities.getUuid();
  const timestamp = new Date();
  const row = [
    timestamp, id, profile.firstName, profile.lastName, profile.nickname,
    profile.classLevel, profile.room, profile.number, profile.targetUniversity || '',
    profile.targetFaculty || '', JSON.stringify(answers)
  ];
  const sheet = getSheet_(APP.sheets.responses);
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new Error('ระบบกำลังบันทึกข้อมูลอยู่ กรุณาลองใหม่อีกครั้ง');
  try {
    if (sheet.getLastRow() === 0) sheet.getRange(1, 1, 1, RESPONSE_HEADERS.length).setValues([RESPONSE_HEADERS]);
    const values = sheet.getDataRange().getValues();
    const headers = values[0].map(value => String(value || '').trim());
    const headerIndex = headerIndex_(headers);
    const studentKey = [profile.firstName, profile.lastName].map(normalizeStudentName_).join('|');
    for (let rowIndex = values.length - 1; rowIndex >= 1; rowIndex -= 1) {
      const existingKey = [values[rowIndex][headerIndex.first_name], values[rowIndex][headerIndex.last_name]].map(normalizeStudentName_).join('|');
      if (existingKey === studentKey) sheet.deleteRow(rowIndex + 1);
    }
    sheet.getRange(sheet.getLastRow() + 1, 1, 1, row.length).setValues([row]);
  } finally {
    lock.releaseLock();
  }
  return Object.assign(summary, { submissionId: id, createdAt: timestamp.toISOString(), profile: profile });
}

function buildLearningSummary_(questions, answers) {
  const rounds = {};
  APP.rounds.forEach(round => {
    rounds[round.id] = {
      id: round.id,
      title: round.title,
      subtitle: round.subtitle,
      answered: 0,
      total: 0,
      topics: []
    };
  });
  questions.forEach(question => {
    const bucket = rounds[question.round];
    if (!bucket) return;
    bucket.total += 1;
    const answer = answers[question.id];
    if (answerProvided_(answer)) bucket.answered += 1;
    const topic = String(question.section || '').replace(/Reflection/gi, 'ทบทวนตัวเอง').trim();
    if (topic && bucket.topics.indexOf(topic) < 0) bucket.topics.push(topic);
  });
  const total = questions.length;
  const answered = Object.keys(answers).filter(id => {
    const answer = answers[id];
    return answerProvided_(answer);
  }).length;
  return { rounds: rounds, answered: answered, total: total };
}

function teacherLogin(username, password) {
  return teacherLoginHash_(username, hashPassword_(String(password || '')));
}

function teacherLoginHash_(username, passwordHash) {
  const normalized = String(username || '').trim().toLowerCase();
  const rows = getSheet_(APP.sheets.users).getDataRange().getValues();
  if (rows.length < 2) throw new Error('ยังไม่มีบัญชีครูในแท็บ Users');
  const headers = rows.shift();
  const ix = headerIndex_(headers);
  const match = rows.find(row => String(row[ix.username] || '').trim().toLowerCase() === normalized && String(row[ix.active] || '').toUpperCase() === 'TRUE');
  if (!match || String(match[ix.password_hash]) !== String(passwordHash || '')) throw new Error('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
  const token = Utilities.getUuid();
  const ttl = Math.max(300, Number(getConfig_().TEACHER_SESSION_MINUTES || 60) * 60);
  CacheService.getScriptCache().put('teacher_' + token, normalized, ttl);
  return { token: token, displayName: match[ix.display_name] || normalized, role: match[ix.role] || 'teacher' };
}

function teacherLogout(token) {
  if (token) CacheService.getScriptCache().remove('teacher_' + token);
  return { ok: true };
}

function setTeacherPassword(username, newPassword) {
  if (!username || !newPassword || String(newPassword).length < 8) throw new Error('รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร');
  const sheet = getSheet_(APP.sheets.users);
  const values = sheet.getDataRange().getValues();
  const headers = values[0];
  const ix = headerIndex_(headers);
  const target = String(username).trim().toLowerCase();
  const rowIndex = values.slice(1).findIndex(row => String(row[ix.username] || '').trim().toLowerCase() === target);
  if (rowIndex < 0) throw new Error('ไม่พบบัญชี ' + username);
  sheet.getRange(rowIndex + 2, ix.password_hash + 1).setValue(hashPassword_(String(newPassword)));
  return { ok: true, username: username };
}

function listResponses(token, filters) {
  requireTeacher_(token);
  const sheet = getSheet_(APP.sheets.responses);
  const values = sheet.getDataRange().getDisplayValues();
  if (values.length < 2) return [];
  const headers = values.shift();
  const ix = headerIndex_(headers);
  const f = filters || {};
  return values.map(row => normalizeResponse_(row, ix)).filter(item => {
    const query = String(f.query || '').trim().toLowerCase();
    const matchesQuery = !query || [item.firstName, item.lastName, item.nickname, item.classLevel, item.room, item.targetFaculty, item.targetUniversity].join(' ').toLowerCase().indexOf(query) >= 0;
    const matchesRoom = !f.room || item.room === String(f.room);
    const matchesClass = !f.classLevel || item.classLevel === String(f.classLevel);
    return matchesQuery && matchesRoom && matchesClass;
  }).reverse();
}

function exportResponsesCsv(token, filters) {
  const rows = listResponses(token, filters || {});
  const columns = ['createdAt', 'firstName', 'lastName', 'nickname', 'classLevel', 'room', 'number', 'targetUniversity', 'targetFaculty', 'answersJson'];
  const headerLabels = ['วันที่ส่ง', 'ชื่อ', 'นามสกุล', 'ชื่อเล่น', 'ชั้น', 'ห้อง', 'เลขที่', 'มหาวิทยาลัยเป้าหมาย', 'คณะ/สาขาเป้าหมาย', 'คำตอบทั้งหมด'];
  const lines = [headerLabels].concat(rows.map(row => columns.map(key => row[key]))).map(line => line.map(csvEscape_).join(','));
  return '\ufeff' + lines.join('\n');
}

function getConfig_() {
  const sheet = getSheet_(APP.sheets.config);
  const values = sheet.getDataRange().getDisplayValues();
  const config = {};
  values.slice(1).forEach(row => { if (row[0]) config[row[0]] = row[1]; });
  return config;
}

function readQuestions_() {
  const sheet = getSheet_(APP.sheets.questions);
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values.shift();
  const ix = headerIndex_(headers);
  return values.filter(row => String(row[ix.active]).toUpperCase() !== 'FALSE' && row[ix.id] && String(row[ix.prompt] || '').trim()).map(row => {
    const round = normalizeRound_(row[ix.round]);
    if (!round) return null;
    const options = parseQuestionOptions_(row[ix.options_json]).map(option => Object.assign({}, option, { label: thaiQuestionText_(option.label) }));
    return {
      id: String(row[ix.id]), round: round, section: thaiQuestionText_(row[ix.section]), type: normalizeQuestionType_(row[ix.type]),
      prompt: thaiQuestionText_(row[ix.prompt]), helper: thaiQuestionText_(row[ix.helper]), options: options,
      required: String(row[ix.required]).toUpperCase() === 'TRUE'
    };
  }).filter(Boolean);
}

function thaiQuestionText_(value) {
  return String(value || '')
    .replace(/Direct Admission/gi, 'รอบรับตรงอิสระ')
    .replace(/Portfolio/gi, 'แฟ้มสะสมผลงาน')
    .replace(/Quota/gi, 'โควตา')
    .replace(/Admission/gi, 'แอดมิชชัน')
    .replace(/Reflection/gi, 'ทบทวนตัวเอง')
    .replace(/สมัคร\s+รอบรับตรงอิสระ/g, 'สมัครรอบรับตรงอิสระ')
    .replace(/มี\s+แฟ้มสะสมผลงาน/g, 'มีแฟ้มสะสมผลงาน')
    .replace(/แฟ้มสะสมผลงาน\s+ที่/g, 'แฟ้มสะสมผลงานที่')
    .replace(/แฟ้มสะสมผลงาน\s+ฉบับ/g, 'แฟ้มสะสมผลงานฉบับ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeRound_(value) {
  const round = String(value || '').trim().toUpperCase();
  return APP.rounds.some(item => item.id === round) ? round : '';
}

function normalizeQuestionType_(value) {
  const type = String(value || '').trim().toLowerCase();
  return QUESTION_TYPES.indexOf(type) >= 0 ? type : 'radio';
}

function answerProvided_(answer) {
  return answer !== undefined && answer !== null && answer !== '' && !(Array.isArray(answer) && answer.length === 0) && !(answer && typeof answer === 'object' && !Array.isArray(answer) && Object.keys(answer).length === 0);
}

function normalizeStudentName_(value) {
  return String(value === undefined || value === null ? '' : value).trim().toLowerCase();
}

function calculateResult_(questions, answers) {
  const rounds = {};
  APP.rounds.forEach(round => { rounds[round.id] = { id: round.id, title: round.title, subtitle: round.subtitle, score: 0, level: 'เริ่มวางแผน', answered: 0, total: 0 }; });
  questions.forEach(question => {
    const bucket = rounds[question.round];
    if (!bucket) return;
    bucket.total += 1;
    const answer = answers[question.id];
    const score = scoreAnswer_(question, answer);
    if (answerProvided_(answer)) bucket.answered += 1;
    if (question.weight > 0) {
      bucket._weighted = (bucket._weighted || 0) + score * question.weight;
      bucket._weight = (bucket._weight || 0) + question.weight;
    }
  });
  let totalWeighted = 0;
  let totalWeight = 0;
  Object.keys(rounds).forEach(id => {
    const bucket = rounds[id];
    bucket.score = bucket._weight ? Math.round(bucket._weighted / bucket._weight) : 0;
    bucket.level = levelForScore_(bucket.score);
    totalWeighted += bucket.score;
    totalWeight += 1;
    delete bucket._weighted;
    delete bucket._weight;
  });
  const overallScore = totalWeight ? Math.round(totalWeighted / totalWeight) : 0;
  return {
    overallScore: overallScore,
    overallLevel: levelForScore_(overallScore),
    rounds: rounds,
    advice: adviceForScore_(overallScore)
  };
}

function scoreAnswer_(question, answer) {
  if (answer === undefined || answer === null || answer === '') return 0;
  if (question.type === 'textarea' || question.type === 'text') return String(answer).trim() ? question.textScoreIfFilled : 0;
  const selected = Array.isArray(answer) ? answer : [answer];
  const scores = selected.map(value => {
    const index = Number(value);
    return question.options[index] ? Number(question.options[index].score || 0) : 0;
  });
  if (!scores.length) return 0;
  return Math.min(100, question.scoreMode === 'sum' ? scores.reduce((sum, score) => sum + score, 0) : Math.max.apply(null, scores));
}

function levelForScore_(score) {
  if (score >= 85) return 'พร้อมลุย';
  if (score >= 70) return 'มีความพร้อม';
  if (score >= 40) return 'กำลังเตรียมพร้อม';
  return 'เริ่มวางแผน';
}

function adviceForScore_(score) {
  if (score >= 85) return 'คุณมีพื้นฐานพร้อมสำหรับการวางแผนหลายรอบแล้ว ลองเลือกหลักสูตรเป้าหมายและตรวจประกาศจริงทีละโครงการ';
  if (score >= 70) return 'คุณมีจุดแข็งที่ต่อยอดได้ แนะนำให้เติมช่องว่างที่เห็นในแต่ละรอบและทำตารางวันสำคัญ';
  if (score >= 40) return 'คุณเริ่มมีทิศทางแล้ว ลองคุยกับครูแนะแนวและกำหนดงานเล็ก ๆ ที่ทำได้ภายในสัปดาห์นี้';
  return 'ยังไม่ต้องกังวล เริ่มจากเลือกคณะ/สาขาที่สนใจ 1-2 แห่ง แล้วเช็กคุณสมบัติและกำหนดการจากประกาศทางการ';
}

function getSourceLinks_() {
  const sheet = getSheet_(APP.sheets.sources);
  const values = sheet.getDataRange().getDisplayValues();
  return values.slice(1).filter(row => row[2]).map(row => ({ title: row[1], url: row[2], note: row[3] }));
}

function requireTeacher_(token) {
  if (!token || !CacheService.getScriptCache().get('teacher_' + token)) throw new Error('เซสชันครูหมดอายุ กรุณาเข้าสู่ระบบใหม่');
}

function normalizeResponse_(row, ix) {
  const number = key => row[ix[key]] || '';
  return {
    createdAt: number('created_at'), submissionId: number('submission_id'), firstName: number('first_name'), lastName: number('last_name'), nickname: number('nickname'),
    classLevel: number('class_level'), room: number('room'), number: number('number'), targetUniversity: number('target_university'), targetFaculty: number('target_faculty'),
    answersJson: number('answers_json')
  };
}

function getRoundScore_(item, round) {
  if (round === 'R1') return item.r1Score;
  if (round === 'R2') return item.r2Score;
  if (round === 'R3') return item.r3Score;
  if (round === 'R4') return item.r4Score;
  return item.overallScore;
}

function getRoundLevel_(item, round) {
  if (round === 'R1') return item.r1Level;
  if (round === 'R2') return item.r2Level;
  if (round === 'R3') return item.r3Level;
  if (round === 'R4') return item.r4Level;
  return item.overallLevel;
}

function hashPassword_(password) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, password, Utilities.Charset.UTF_8);
  return bytes.map(byte => (byte < 0 ? byte + 256 : byte).toString(16).padStart(2, '0')).join('');
}

function csvEscape_(value) {
  const text = String(value === undefined || value === null ? '' : value);
  return /[",\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

function getSpreadsheet_() {
  if (!APP_SPREADSHEET_) APP_SPREADSHEET_ = SpreadsheetApp.openById(APP.sheetId);
  return APP_SPREADSHEET_;
}

function clearAppDataCache_() {
  CacheService.getScriptCache().remove(APP_DATA_CACHE_KEY);
}

function getSheet_(name) {
  const sheet = getSpreadsheet_().getSheetByName(name);
  if (!sheet) throw new Error('ไม่พบแท็บ ' + name + ' กรุณารัน setupSheet()');
  return sheet;
}

function headerIndex_(headers) {
  const index = {};
  headers.forEach((header, i) => { index[String(header)] = i; });
  return index;
}

function writeTable_(sheet, headers, rows) {
  sheet.clear();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  if (rows.length) sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  sheet.setFrozenRows(1);
}

function formatTable_(sheet, columns) {
  const lastRow = Math.max(1, sheet.getLastRow());
  sheet.getRange(1, 1, 1, columns).setBackground('#eef2ff').setFontWeight('bold').setFontColor('#1e1b4b');
  sheet.getRange(1, 1, lastRow, columns).setWrap(true).setVerticalAlignment('middle');
  sheet.autoResizeColumns(1, Math.min(columns, 12));
}
