/**
 * Image_Prompt_QC.gs — Prompt Quality Checker for 06_Image_Prompts
 *
 * Flow:
 *   1. runPromptQualityCheck() → opens ImagePromptQC.html (project selector)
 *   2. HTML calls getActiveProjects()  → populates checkboxes
 *   3. User selects projects → HTML calls runQcForProjects(projectIds)
 *   4. runQcForProjects() scans, highlights cells, returns issues JSON directly
 *   5. HTML renders results table
 *   6. "X 閉じてハイライト解除" → clearAllHighlights()
 *
 * Shared constants from Code.gs (same GAS global scope):
 *   SHEET_IMAGE_PROMPTS, HEADER_ROW, DATA_START_ROW, START_COL
 */

/** @const */ var QC_COLOR_PLURAL = '#FFD966'; // yellow : plural-form issues
/** @const */ var QC_COLOR_PROPS  = '#F1948A'; // salmon-red : props / appearance issues

/**
 * Plural-form patterns to detect in prompt_composition.
 * Add entries here when new character types are introduced across projects.
 */
var QC_PLURAL_PATTERNS = [
  { re: /\bCrabs\b/i,          hint: 'the Crab' },
  { re: /\bMonkeys\b/i,        hint: 'the Monkey' },
  { re: /\bBees\b/i,           hint: 'the Bee' },
  { re: /\bChestnuts\b/i,      hint: 'the Chestnut' },
  { re: /\bMortars\b/i,        hint: 'the Mortar' },
  { re: /\bUnchis\b/i,         hint: 'Unchi' },
  { re: /\bGrandmothers\b/i,   hint: 'Grandmother' },
  { re: /\bGrandfathers\b/i,   hint: 'Grandfather' },
  { re: /\bVillagers\b/i,      hint: 'the Villager' },
  { re: /\bChildren\b/i,       hint: 'the Child' },
  { re: /\bOnis\b/i,           hint: 'the Oni' },
  { re: /\bSamurais\b/i,       hint: 'the Samurai' },
  { re: /\bDogs\b/i,           hint: 'the Dog' },
  { re: /\bPheasants\b/i,      hint: 'the Pheasant' },
  { re: /\bKintaros\b/i,       hint: 'Kintaro' },
  { re: /\bMomotaros\b/i,      hint: 'Momotaro' },
];

/**
 * Props / appearance patterns to detect in prompt_character.
 * Add entries here when new prohibited keywords are identified.
 */
var QC_PROPS_PATTERNS = [
  { re: /onigiri/i,            hint: 'onigiri -> prompt_scene' },
  { re: /rice\s*ball/i,        hint: 'rice ball -> prompt_scene' },
  { re: /watering\s*can/i,     hint: 'watering can -> prompt_scene' },
  { re: /holding\s+a\b/i,      hint: 'holding [obj] -> prompt_scene' },
  { re: /carrying\s+a\b/i,     hint: 'carrying [obj] -> prompt_scene' },
  { re: /handing\s+over/i,     hint: 'handing over -> prompt_scene' },
  { re: /\bwearing\b/i,        hint: 'wearing -> remove (visual only)' },
  { re: /\bkimono\b/i,         hint: 'kimono -> remove' },
  { re: /\bhaircut\b/i,        hint: 'haircut -> remove' },
  { re: /\bbob\s+hair/i,       hint: 'bob hair -> remove' },
  { re: /\baxe\b/i,            hint: 'axe -> prompt_scene' },
  { re: /\bsword\b/i,          hint: 'sword -> prompt_scene' },
  { re: /\bpersimmon\b/i,      hint: 'persimmon -> prompt_scene' },
  { re: /\bbasket\b/i,         hint: 'basket -> prompt_scene' },
  { re: /\bbucket\b/i,         hint: 'bucket -> prompt_scene' },
  { re: /\bclub\b/i,           hint: 'club -> prompt_scene' },
];

// ---------------------------------------------------------------------------
// Menu entry point
// ---------------------------------------------------------------------------

/**
 * Opens the QC dialog (project selector).
 * Called from onOpen() menu in Code.gs.
 */
function runPromptQualityCheck() {
  var html = HtmlService.createHtmlOutputFromFile('ImagePromptQC')
    .setWidth(640)
    .setHeight(460);
  SpreadsheetApp.getUi().showModelessDialog(html, 'Prompt Quality Check');
}

// ---------------------------------------------------------------------------
// Called from ImagePromptQC.html
// ---------------------------------------------------------------------------

/**
 * Scans 06_Image_Prompts for the given project IDs, highlights cells,
 * and returns issues as a JSON string directly (no cache needed).
 * @param {string[]} projectIds - array of project_id strings to scan
 * @returns {string} JSON string of issue objects
 */
function runQcForProjects(projectIds) {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_IMAGE_PROMPTS);
  if (!sheet) return JSON.stringify({ error: 'Sheet "' + SHEET_IMAGE_PROMPTS + '" not found' });

  var lastCol = sheet.getLastColumn();
  var lastRow = sheet.getLastRow();
  if (lastRow < HEADER_ROW || lastCol < START_COL) return JSON.stringify([]);

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
    return JSON.stringify({ error: 'Required columns not found (prompt_composition / prompt_character)' });
  }

  // Build project filter set
  var filterSet = {};
  for (var k = 0; k < projectIds.length; k++) {
    filterSet[projectIds[k]] = true;
  }
  var filterAll = (projectIds.length === 0);

  // Clear previous highlights across all rows
  qcClearHighlights_(sheet, lastRow, COL);

  var rowCount = lastRow - DATA_START_ROW + 1;
  if (rowCount <= 0) return JSON.stringify([]);

  var rows = sheet.getRange(DATA_START_ROW, START_COL, rowCount, colCount).getValues();
  var issues = [];

  for (var i = 0; i < rows.length; i++) {
    var row       = rows[i];
    var projectId = String(row[COL.projectId] || '');
    if (!filterAll && !filterSet[projectId]) continue;

    var recordId    = String(row[COL.recordId]    || '');
    var sceneNo     = String(row[COL.sceneNo]      || '');
    var composition = String(row[COL.composition]  || '');
    var character   = String(row[COL.character]    || '');
    var sheetRow    = DATA_START_ROW + i;

    // ① prompt_composition — plural character names
    var pluralHits = [];
    for (var p = 0; p < QC_PLURAL_PATTERNS.length; p++) {
      var pp = QC_PLURAL_PATTERNS[p];
      if (pp.re.test(composition)) {
        pluralHits.push(composition.match(pp.re)[0] + ' -> ' + pp.hint);
      }
    }
    if (pluralHits.length > 0) {
      sheet.getRange(sheetRow, START_COL + COL.composition).setBackground(QC_COLOR_PLURAL);
      issues.push({
        type: 'plural', recordId: recordId, sceneNo: sceneNo,
        col: 'prompt_composition', detail: pluralHits.join(' / '),
      });
    }

    // ② prompt_character — props / appearance descriptions
    var propsHits = [];
    for (var q = 0; q < QC_PROPS_PATTERNS.length; q++) {
      var qp = QC_PROPS_PATTERNS[q];
      if (qp.re.test(character)) {
        propsHits.push(character.match(qp.re)[0] + ' -> ' + qp.hint);
      }
    }
    if (propsHits.length > 0) {
      sheet.getRange(sheetRow, START_COL + COL.character).setBackground(QC_COLOR_PROPS);
      issues.push({
        type: 'props', recordId: recordId, sceneNo: sceneNo,
        col: 'prompt_character', detail: propsHits.join(' / '),
      });
    }
  }

  return JSON.stringify(issues);
}

// ---------------------------------------------------------------------------
// Clear highlights — called from ImagePromptQC.html close button
// ---------------------------------------------------------------------------

/**
 * Removes all QC highlights from 06_Image_Prompts.
 * Called via google.script.run from the dialog close button.
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
// Private helper
// ---------------------------------------------------------------------------

function qcClearHighlights_(sheet, lastRow, COL) {
  var dataRows = lastRow - DATA_START_ROW + 1;
  if (dataRows <= 0) return;
  if (COL.composition >= 0)
    sheet.getRange(DATA_START_ROW, START_COL + COL.composition, dataRows, 1).setBackground(null);
  if (COL.character >= 0)
    sheet.getRange(DATA_START_ROW, START_COL + COL.character, dataRows, 1).setBackground(null);
}
