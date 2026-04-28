/**
 * ssml-check.gs — SSML syntax checker for 08_TTS_Subtitles RETAKE rows
 *
 * Entry point (menu): showSsmlCheckDialog()
 * Called from SsmlCheck.html: checkSsmlRetakeRows(projectId)
 *
 * Validation rules:
 *   1. tts_text is not empty
 *   2. Starts with <speak> / ends with </speak>
 *   3. Well-formed XML  (XmlService.parse — catches <.sub>, unclosed tags, missing quotes, etc.)
 *   4. <prosody rate> must be "1.0"
 *   5. <sub> tags must have alias attribute
 *   6. <break> tags must be self-closing and have valid time/strength attribute values
 *
 * Note: whether </sub> is followed by <break> is intentional per user design
 *       (reading-assist vs accent-assist), so that pattern is NOT flagged.
 */

// Constants are defined in Code.gs (SHEET_TTS_SUBTITLES, HEADER_ROW, DATA_START_ROW, START_COL)

// ---------------------------------------------------------------------------
// Dialog entry point
// ---------------------------------------------------------------------------

/**
 * Opens a modeless dialog so the user can view errors while editing the sheet.
 */
function showSsmlCheckDialog() {
  var html = HtmlService.createHtmlOutputFromFile('SsmlCheck')
    .setWidth(580)
    .setHeight(540);
  SpreadsheetApp.getUi().showModelessDialog(html, 'SSML 構文チェック');
}

// ---------------------------------------------------------------------------
// Server-side function called from SsmlCheck.html
// ---------------------------------------------------------------------------

/**
 * Reads 08_TTS_Subtitles, filters approval_status="RETAKE" rows for the
 * given project, and validates each tts_text as SSML.
 *
 * @param {string} projectId
 * @returns {{
 *   results?: Array<{record_id: string, errors: string[]}>,
 *   checkedCount?: number,
 *   errorCount?: number,
 *   error?: string
 * }}
 */
function checkSsmlRetakeRows(projectId) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_TTS_SUBTITLES);
  if (!sheet) return { error: '08_TTS_Subtitles シートが見つかりません' };

  var lastCol = sheet.getLastColumn();
  var lastRow = sheet.getLastRow();
  if (lastRow < HEADER_ROW || lastCol < START_COL) {
    return { results: [], checkedCount: 0, errorCount: 0 };
  }

  var colCount = lastCol - START_COL + 1;
  var headers = sheet.getRange(HEADER_ROW, START_COL, 1, colCount).getValues()[0];

  var pidIdx      = headers.indexOf('project_id');
  var recordIdIdx = headers.indexOf('record_id');
  var approvalIdx = headers.indexOf('approval_status');
  var ttsTextIdx  = headers.indexOf('tts_text');

  if (pidIdx < 0 || recordIdIdx < 0 || approvalIdx < 0 || ttsTextIdx < 0) {
    return { error: '必要なカラムが見つかりません (project_id / record_id / approval_status / tts_text)' };
  }
  if (lastRow < DATA_START_ROW) return { results: [], checkedCount: 0, errorCount: 0 };

  var rowCount = lastRow - DATA_START_ROW + 1;
  var rows = sheet.getRange(DATA_START_ROW, START_COL, rowCount, colCount).getValues();

  var results = [];
  rows.forEach(function(row) {
    var pid      = row[pidIdx]      ? String(row[pidIdx]).trim()      : '';
    var approval = row[approvalIdx] ? String(row[approvalIdx]).trim() : '';
    if (pid !== projectId || approval !== 'RETAKE') return;

    var recordId = row[recordIdIdx] ? String(row[recordIdIdx]).trim() : '(record_id なし)';
    var ttsText  = row[ttsTextIdx]  ? String(row[ttsTextIdx]).trim()  : '';
    var errors   = validateSsml_(ttsText);
    results.push({ record_id: recordId, errors: errors });
  });

  var errorCount = results.filter(function(r) { return r.errors.length > 0; }).length;
  return { results: results, checkedCount: results.length, errorCount: errorCount };
}

// ---------------------------------------------------------------------------
// SSML validation logic
// ---------------------------------------------------------------------------

/**
 * Validates a tts_text string as SSML.
 * Returns an array of human-readable error messages (empty array = no errors).
 *
 * @param {string} ssml
 * @returns {string[]}
 */
function validateSsml_(ssml) {
  var errors = [];

  // 1. Empty check
  if (!ssml) {
    errors.push('tts_text が空です');
    return errors;
  }

  // 2. <speak> wrapper check
  if (!/^<speak[\s>]/.test(ssml)) {
    errors.push('<speak> タグで始まっていません');
  }
  if (!/<\/speak>\s*$/.test(ssml)) {
    errors.push('</speak> タグで終わっていません');
  }

  // 3. XML well-formedness
  //    XmlService.parse() throws on: malformed tags (<.sub>), unclosed tags,
  //    missing attribute quotes, mismatched elements, etc.
  try {
    XmlService.parse(ssml);
  } catch (e) {
    errors.push('XML 構文エラー: ' + String(e.message || e));
    // Further checks are meaningless when XML structure is broken
    return errors;
  }

  // 4. <prosody rate> must be "1.0" (speed is controlled via speech_rate field)
  var prosodyRe = /<prosody[^>]+rate="([^"]+)"/g;
  var pm;
  while ((pm = prosodyRe.exec(ssml)) !== null) {
    if (pm[1] !== '1.0') {
      errors.push('<prosody rate="' + pm[1] + '"> — rate は "1.0" 固定が必要です（速度は speech_rate フィールドで制御）');
    }
  }

  // 5. <sub> tags must have alias attribute
  var allSubTags = ssml.match(/<sub(\s[^>]*)?>/g) || [];
  allSubTags.forEach(function(tag) {
    if (!/\balias=/.test(tag)) {
      errors.push('<sub> タグに alias 属性がありません: ' + tag);
    }
  });

  // 6. <break> tag syntax check
  //    Valid:   <break/>  <break time="200ms"/>  <break time="1.5s"/>  <break strength="weak"/>
  //    Invalid: not self-closing, invalid time format, unknown strength value
  var breakTagRe = /<break([^>\/]*)(\/?)?>/g;
  var bm;
  while ((bm = breakTagRe.exec(ssml)) !== null) {
    var attrs    = bm[1];
    var slash    = bm[2] || '';
    var fullTag  = bm[0];

    // Must be self-closing (end with "/>")
    if (slash !== '/') {
      errors.push('<break> タグが自己終了形式ではありません（"/>" で閉じてください）: ' + fullTag);
    }

    // time attribute: must match Nms or Ns (e.g. "200ms", "1.5s")
    var timeMatch = attrs.match(/\btime="([^"]+)"/);
    if (timeMatch && !/^\d+(\.\d+)?(ms|s)$/.test(timeMatch[1])) {
      errors.push('<break time="' + timeMatch[1] + '"> — 値の形式が不正です（例: "200ms" / "1.5s"）');
    }

    // strength attribute: must be a valid SSML enum value
    var strengthMatch = attrs.match(/\bstrength="([^"]+)"/);
    if (strengthMatch) {
      var validStrengths = ['none', 'x-weak', 'weak', 'medium', 'strong', 'x-strong'];
      if (validStrengths.indexOf(strengthMatch[1]) < 0) {
        errors.push(
          '<break strength="' + strengthMatch[1] + '"> — 不正な値です' +
          '（none / x-weak / weak / medium / strong / x-strong）'
        );
      }
    }
  }

  return errors;
}
