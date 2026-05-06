/**
 * Image_Prompt_QC.gs — Prompt Quality Checker for 06_Image_Prompts
 *
 * Scans all rows in 06_Image_Prompts and detects:
 *   ① prompt_composition : plural character name patterns  (highlight: yellow)
 *   ② prompt_character   : scene-specific props / appearance patterns  (highlight: orange)
 *
 * Shared constants from Code.gs (same GAS global scope):
 *   SHEET_IMAGE_PROMPTS, HEADER_ROW, DATA_START_ROW, START_COL
 *
 * Entry point  : runPromptQualityCheck()  ← called from onOpen() menu in Code.gs
 * Clear entry  : clearAllHighlights()     ← called from ImagePromptQC.html close button
 */

/** @const */ var QC_COLOR_PLURAL = '#FFD966'; // yellow : plural-form issues
/** @const */ var QC_COLOR_PROPS  = '#F1948A'; // salmon-red : props / appearance issues

/**
 * Plural-form patterns to detect in prompt_composition.
 * Add entries here when new character types are introduced across projects.
 * @type {Array<{re: RegExp, hint: string}>}
 */
var QC_PLURAL_PATTERNS = [
  { re: /\bCrabs\b/i,          hint: '→ the Crab' },
  { re: /\bMonkeys\b/i,        hint: '→ the Monkey' },
  { re: /\bBees\b/i,           hint: '→ the Bee' },
  { re: /\bChestnuts\b/i,      hint: '→ the Chestnut' },
  { re: /\bMortars\b/i,        hint: '→ the Mortar' },
  { re: /\bUnchis\b/i,         hint: '→ Unchi' },
  { re: /\bGrandmothers\b/i,   hint: '→ Grandmother' },
  { re: /\bGrandfathers\b/i,   hint: '→ Grandfather' },
  { re: /\bVillagers\b/i,      hint: '→ the Villager' },
  { re: /\bChildren\b/i,       hint: '→ the Child' },
  { re: /\bOnis\b/i,           hint: '→ the Oni' },
  { re: /\bSamurais\b/i,       hint: '→ the Samurai' },
  { re: /\bDogs\b/i,           hint: '→ the Dog' },
  { re: /\bPheasants\b/i,      hint: '→ the Pheasant' },
  { re: /\bKintaros\b/i,       hint: '→ Kintaro' },
  { re: /\bMomotaros\b/i,      hint: '→ Momotaro' },
];

/**
 * Props / appearance patterns to detect in prompt_character.
 * Add entries here when new prohibited keywords are identified.
 * @type {Array<{re: RegExp, hint: string}>}
 */
var QC_PROPS_PATTERNS = [
  { re: /onigiri/i,             hint: '→ prompt_scene へ移動' },
  { re: /rice\s*ball/i,         hint: '→ prompt_scene へ移動' },
  { re: /watering\s*can/i,      hint: '→ prompt_scene へ移動' },
  { re: /holding\s+a\b/i,       hint: '物体を持つ記述 → prompt_scene へ移動' },
  { re: /carrying\s+a\b/i,      hint: '物体を運ぶ記述 → prompt_scene へ移動' },
  { re: /handing\s+over/i,      hint: '物体の受け渡し → prompt_scene へ移動' },
  { re: /\bwearing\b/i,         hint: '衣装記述 → 削除（外見は character_book 担当）' },
  { re: /\bkimono\b/i,          hint: '衣装記述 → 削除' },
  { re: /\bhaircut\b/i,         hint: '髪型記述 → 削除' },
  { re: /\bbob\s+hair/i,        hint: '髪型記述 → 削除' },
  { re: /\baxe\b/i,             hint: '→ prompt_scene へ移動' },
  { re: /\bsword\b/i,           hint: '→ prompt_scene へ移動' },
  { re: /\bpersimmon\b/i,       hint: '→ prompt_scene へ移動' },
  { re: /\bbasket\b/i,          hint: '→ prompt_scene へ移動' },
  { re: /\bbucket\b/i,          hint: '→ prompt_scene へ移動' },
  { re: /\bclub\b/i,            hint: '→ prompt_scene へ移動（金棒等）' },
];

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * Scans 06_Image_Prompts, highlights offending cells, and shows a modeless dialog.
 * Called from the "AI動画制作 → 🔍 Prompt 品質チェック" menu in Code.gs.
 */
function runPromptQualityCheck() {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_IMAGE_PROMPTS);
  if (!sheet) {
    SpreadsheetApp.getUi().alert('シート "' + SHEET_IMAGE_PROMPTS + '" が見つかりません');
    return;
  }

  var lastCol = sheet.getLastColumn();
  var lastRow = sheet.getLastRow();
  if (lastRow < HEADER_ROW || lastCol < START_COL) {
    SpreadsheetApp.getUi().alert('06_Image_Prompts にデータがありません');
    return;
  }

  // Resolve column indices from header row (robust against column reordering)
  var colCount = lastCol - START_COL + 1;
  var headers  = sheet.getRange(HEADER_ROW, START_COL, 1, colCount).getValues()[0];

  var ci = function(name) { return headers.indexOf(name); };
  var COL = {
    projectId:   ci('project_id'),
    recordId:    ci('record_id'),
    sceneNo:     ci('scene_no'),
    composition: ci('prompt_composition'),
    character:   ci('prompt_character'),
  };

  if (COL.composition === -1 || COL.character === -1) {
    SpreadsheetApp.getUi().alert(
      '必要なカラムが見つかりません\n（prompt_composition / prompt_character）'
    );
    return;
  }

  // Clear previous highlights before re-scan
  qcClearHighlights_(sheet, lastRow, COL);

  // Read all data rows
  var rowCount = lastRow - DATA_START_ROW + 1;
  if (rowCount <= 0) {
    qcShowDialog_([]);
    return;
  }
  var rows = sheet.getRange(DATA_START_ROW, START_COL, rowCount, colCount).getValues();

  var issues = [];

  for (var i = 0; i < rows.length; i++) {
    var row         = rows[i];
    var projectId   = String(row[COL.projectId]   || '');
    var recordId    = String(row[COL.recordId]     || '');
    var sceneNo     = String(row[COL.sceneNo]      || '');
    var composition = String(row[COL.composition]  || '');
    var character   = String(row[COL.character]    || '');

    var sheetRow = DATA_START_ROW + i; // 1-based row index in sheet

    // ① prompt_composition — plural character names
    var pluralHits = QC_PLURAL_PATTERNS
      .filter(function(p) { return p.re.test(composition); })
      .map(function(p) {
        return '"' + composition.match(p.re)[0] + '" ' + p.hint;
      });

    if (pluralHits.length > 0) {
      sheet.getRange(sheetRow, START_COL + COL.composition).setBackground(QC_COLOR_PLURAL);
      issues.push({
        type: 'plural', projectId: projectId, recordId: recordId, sceneNo: sceneNo,
        col: 'prompt_composition', detail: pluralHits.join(' / '), rowIndex: sheetRow,
      });
    }

    // ② prompt_character — props / appearance descriptions
    var propsHits = QC_PROPS_PATTERNS
      .filter(function(p) { return p.re.test(character); })
      .map(function(p) {
        return '"' + character.match(p.re)[0] + '" ' + p.hint;
      });

    if (propsHits.length > 0) {
      sheet.getRange(sheetRow, START_COL + COL.character).setBackground(QC_COLOR_PROPS);
      issues.push({
        type: 'props', projectId: projectId, recordId: recordId, sceneNo: sceneNo,
        col: 'prompt_character', detail: propsHits.join(' / '), rowIndex: sheetRow,
      });
    }
  }

  qcShowDialog_(issues);
}

// ---------------------------------------------------------------------------
// Clear highlights — called from ImagePromptQC.html close button
// ---------------------------------------------------------------------------

/**
 * Removes all QC highlights from 06_Image_Prompts.
 * Called via google.script.run from the dialog's close button.
 */
function clearAllHighlights() {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_IMAGE_PROMPTS);
  if (!sheet) return;

  var lastCol = sheet.getLastColumn();
  var lastRow = sheet.getLastRow();
  if (lastRow < HEADER_ROW || lastCol < START_COL) return;

  var headers = sheet.getRange(HEADER_ROW, START_COL, 1, lastCol - START_COL + 1).getValues()[0];
  var COL = {
    composition: headers.indexOf('prompt_composition'),
    character:   headers.indexOf('prompt_character'),
  };
  qcClearHighlights_(sheet, lastRow, COL);
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function qcClearHighlights_(sheet, lastRow, COL) {
  var dataRows = lastRow - DATA_START_ROW + 1;
  if (dataRows <= 0) return;
  if (COL.composition >= 0)
    sheet.getRange(DATA_START_ROW, START_COL + COL.composition, dataRows, 1).setBackground(null);
  if (COL.character >= 0)
    sheet.getRange(DATA_START_ROW, START_COL + COL.character, dataRows, 1).setBackground(null);
}

/**
 * Called from ImagePromptQC.html via google.script.run after the dialog opens.
 * Reads issues from CacheService (shared across GAS executions).
 * @returns {string} JSON string of issue objects
 */
function getQcIssues() {
  var cache = CacheService.getScriptCache();
  return cache.get('qcIssues') || '[]';
}

function qcShowDialog_(issues) {
  // Persist issues in CacheService so getQcIssues() can read them in a separate execution
  var cache = CacheService.getScriptCache();
  cache.put('qcIssues', JSON.stringify(issues), 300); // TTL: 5 minutes
  // Use createHtmlOutputFromFile (no scriptlets — data loaded client-side via google.script.run)
  var html = HtmlService.createHtmlOutputFromFile('ImagePromptQC')
    .setWidth(680)
    .setHeight(420);
  SpreadsheetApp.getUi().showModelessDialog(html, 'Prompt Quality Check');
}
