/**
 * Code.gs — Douwa AI Workflow Runner (GAS server-side)
 *
 * Setup: set the following Script Properties (Extensions → Apps Script → Project Settings):
 *   GITHUB_TOKEN  : GitHub PAT with "workflow" write scope
 *   GITHUB_REF    : branch to dispatch against (default: "main")
 */

/** @const */
var REPO = 'skgreenabcj-commits/Douwa-AI-movie-generate';
/** @const */
var WORKFLOW_FILE = 'run-step.yml';
/** @const */
var DEFAULT_REF = 'main';
/** @const */
var SHEET_PROJECT = '00_Project';
/** @const */
var SHEET_SOURCE = '01_Source';
/** @const */
var SHEET_IMAGE_PROMPTS = '06_Image_Prompts';
/** @const */
var SHEET_TTS_SUBTITLES = '08_TTS_Subtitles';
/** @const */
var HEADER_ROW = 5;
/** @const */
var DATA_START_ROW = 6;
/** @const */
var START_COL = 2; // Column B

// ---------------------------------------------------------------------------
// Menu
// ---------------------------------------------------------------------------

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('AI動画制作')
    .addItem('ワークフロー実行...', 'showRunnerDialog')
    .addSeparator()
    .addItem('SSML 構文チェック...', 'showSsmlCheckDialog')
    .addToUi();
}

// ---------------------------------------------------------------------------
// Dialog
// ---------------------------------------------------------------------------

function showRunnerDialog() {
  var html = HtmlService.createHtmlOutputFromFile('Dialog')
    .setWidth(500)
    .setHeight(640);
  SpreadsheetApp.getUi().showModalDialog(html, 'Douwa AI Workflow Runner');
}

// ---------------------------------------------------------------------------
// Called from Dialog.html
// ---------------------------------------------------------------------------

/**
 * Returns active projects from 00_Project sheet.
 * @returns {Array<{project_id: string, label: string}>}
 */
function getActiveProjects() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_PROJECT);
  if (!sheet) throw new Error('00_Project シートが見つかりません');

  var lastCol = sheet.getLastColumn();
  var lastRow = sheet.getLastRow();
  if (lastRow < HEADER_ROW || lastCol < START_COL) return [];

  var colCount = lastCol - START_COL + 1;
  var headers = sheet.getRange(HEADER_ROW, START_COL, 1, colCount).getValues()[0];

  var pidIdx = headers.indexOf('project_id');
  var titleIdx = headers.indexOf('source_title');
  if (titleIdx < 0) titleIdx = headers.indexOf('title_jp');
  var statusIdx = headers.indexOf('project_status');

  if (pidIdx < 0) throw new Error('project_id カラムが見つかりません');
  if (lastRow < DATA_START_ROW) return [];

  var rowCount = lastRow - DATA_START_ROW + 1;
  var rows = sheet.getRange(DATA_START_ROW, START_COL, rowCount, colCount).getValues();

  return rows
    .filter(function(row) {
      var pid = row[pidIdx] ? String(row[pidIdx]).trim() : '';
      var status = statusIdx >= 0 ? String(row[statusIdx]).trim() : '';
      return pid && status !== 'ARCHIVED' && status !== 'COMPLETED';
    })
    .map(function(row) {
      var pid = String(row[pidIdx]).trim();
      var title = titleIdx >= 0 && row[titleIdx] ? String(row[titleIdx]).trim() : '';
      return { project_id: pid, label: title ? pid + '  ' + title : pid };
    });
}

/**
 * Validates that all given project IDs have 01_Source.approval_status = "APPROVED".
 * Called before dispatching STEP_03_TO_06 to prevent running downstream steps
 * without human review of the source material.
 * @param {string[]} projectIds
 * @returns {{valid: boolean, message?: string}}
 */
function validateSourceApproval(projectIds) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_SOURCE);
  if (!sheet) return { valid: false, message: '01_Source シートが見つかりません' };

  var lastCol = sheet.getLastColumn();
  var lastRow = sheet.getLastRow();
  if (lastRow < HEADER_ROW || lastCol < START_COL) {
    return { valid: false, message: '01_Source にデータがありません。STEP_01 を先に実行してください。' };
  }

  var colCount = lastCol - START_COL + 1;
  var headers = sheet.getRange(HEADER_ROW, START_COL, 1, colCount).getValues()[0];
  var pidIdx = headers.indexOf('project_id');
  var approvalIdx = headers.indexOf('approval_status');

  if (pidIdx < 0 || approvalIdx < 0) {
    return { valid: false, message: '01_Source に必要なカラム (project_id / approval_status) が見つかりません' };
  }
  if (lastRow < DATA_START_ROW) {
    return { valid: false, message: '01_Source にデータ行がありません。STEP_01 を先に実行してください。' };
  }

  var rowCount = lastRow - DATA_START_ROW + 1;
  var rows = sheet.getRange(DATA_START_ROW, START_COL, rowCount, colCount).getValues();

  var notApproved = [];
  projectIds.forEach(function(pid) {
    var found = false;
    rows.forEach(function(row) {
      var rowPid = row[pidIdx] ? String(row[pidIdx]).trim() : '';
      if (rowPid !== pid) return;
      found = true;
      var approval = row[approvalIdx] ? String(row[approvalIdx]).trim() : '';
      if (approval !== 'APPROVED') {
        notApproved.push(pid + '（現在: ' + (approval || '未設定') + '）');
      }
    });
    if (!found) {
      notApproved.push(pid + '（01_Source に行なし — STEP_01 未実行）');
    }
  });

  if (notApproved.length > 0) {
    return {
      valid: false,
      message: '以下のプロジェクトは 01_Source.approval_status が APPROVED ではありません。\n' +
               '01_Source シートで approval_status を APPROVED に設定してから実行してください。\n\n' +
               notApproved.join('\n')
    };
  }
  return { valid: true };
}

/**
 * Validates that RETAKE rows exist for the given project IDs.
 * @param {string[]} projectIds
 * @returns {{valid: boolean, message?: string}}
 */
function validateRetake(projectIds) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_IMAGE_PROMPTS);
  if (!sheet) return { valid: false, message: '06_Image_Prompts シートが見つかりません' };

  var lastCol = sheet.getLastColumn();
  var lastRow = sheet.getLastRow();
  if (lastRow < HEADER_ROW || lastCol < START_COL) {
    return { valid: false, message: 'RETAKE対象の行がありません' };
  }

  var colCount = lastCol - START_COL + 1;
  var headers = sheet.getRange(HEADER_ROW, START_COL, 1, colCount).getValues()[0];
  var pidIdx = headers.indexOf('project_id');
  var approvalIdx = headers.indexOf('approval_status');

  if (pidIdx < 0 || approvalIdx < 0) {
    return { valid: false, message: '必要なカラム (project_id / approval_status) が見つかりません' };
  }
  if (lastRow < DATA_START_ROW) return { valid: false, message: 'RETAKE対象の行がありません' };

  var rowCount = lastRow - DATA_START_ROW + 1;
  var rows = sheet.getRange(DATA_START_ROW, START_COL, rowCount, colCount).getValues();

  var targetSet = {};
  projectIds.forEach(function(id) { targetSet[id] = true; });

  var found = {};
  rows.forEach(function(row) {
    var pid = row[pidIdx] ? String(row[pidIdx]).trim() : '';
    var approval = row[approvalIdx] ? String(row[approvalIdx]).trim() : '';
    if (targetSet[pid] && approval === 'RETAKE') found[pid] = true;
  });

  var foundIds = Object.keys(found);
  if (foundIds.length === 0) {
    return {
      valid: false,
      message: 'RETAKE対象の行がありません。\n06_Image_Prompts シートで approval_status を "RETAKE" に設定してから実行してください。'
    };
  }
  return { valid: true };
}

/**
 * Validates that RETAKE rows exist in 08_TTS_Subtitles for the given project IDs.
 * @param {string[]} projectIds
 * @returns {{valid: boolean, message?: string}}
 */
function validateRetakeTts(projectIds) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_TTS_SUBTITLES);
  if (!sheet) return { valid: false, message: '08_TTS_Subtitles シートが見つかりません' };

  var lastCol = sheet.getLastColumn();
  var lastRow = sheet.getLastRow();
  if (lastRow < HEADER_ROW || lastCol < START_COL) {
    return { valid: false, message: 'RETAKE対象の行がありません' };
  }

  var colCount = lastCol - START_COL + 1;
  var headers = sheet.getRange(HEADER_ROW, START_COL, 1, colCount).getValues()[0];
  var pidIdx = headers.indexOf('project_id');
  var approvalIdx = headers.indexOf('approval_status');

  if (pidIdx < 0 || approvalIdx < 0) {
    return { valid: false, message: '必要なカラム (project_id / approval_status) が見つかりません' };
  }
  if (lastRow < DATA_START_ROW) return { valid: false, message: 'RETAKE対象の行がありません' };

  var rowCount = lastRow - DATA_START_ROW + 1;
  var rows = sheet.getRange(DATA_START_ROW, START_COL, rowCount, colCount).getValues();

  var targetSet = {};
  projectIds.forEach(function(id) { targetSet[id] = true; });

  var found = {};
  rows.forEach(function(row) {
    var pid = row[pidIdx] ? String(row[pidIdx]).trim() : '';
    var approval = row[approvalIdx] ? String(row[approvalIdx]).trim() : '';
    if (targetSet[pid] && approval === 'RETAKE') found[pid] = true;
  });

  if (Object.keys(found).length === 0) {
    return {
      valid: false,
      message: 'RETAKE対象の行がありません。\n08_TTS_Subtitles シートで approval_status を "RETAKE" に設定してから実行してください。'
    };
  }
  return { valid: true };
}

/**
 * Main entry point called from the dialog.
 * @param {{stepId: string, projectIds: string[], isRetake: boolean, dryRun: boolean}} params
 * @returns {{success: boolean, alertMessage?: string}}
 */
function runWorkflow(params) {
  var stepId = params.stepId;
  var projectIds = params.projectIds;
  var isRetake = params.isRetake;
  var dryRun = params.dryRun;

  if (!projectIds || projectIds.length === 0) {
    return { success: false, alertMessage: 'project_id を1つ以上選択してください' };
  }

  // Pre-flight: STEP_03_TO_06 requires 01_Source.approval_status = APPROVED
  if (stepId === 'STEP_03_TO_06') {
    var sourceValidation = validateSourceApproval(projectIds);
    if (!sourceValidation.valid) {
      return { success: false, alertMessage: sourceValidation.message };
    }
  }

  // RETAKE pre-flight check (GAS-side, before touching GitHub)
  if (stepId === 'STEP_07' && isRetake) {
    var validation = validateRetake(projectIds);
    if (!validation.valid) {
      return { success: false, alertMessage: validation.message };
    }
  }
  if (stepId === 'STEP_08B' && isRetake) {
    var ttsValidation = validateRetakeTts(projectIds);
    if (!ttsValidation.valid) {
      return { success: false, alertMessage: ttsValidation.message };
    }
  }

  var token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  if (!token) {
    return { success: false, alertMessage: 'GITHUB_TOKEN がスクリプトプロパティに未設定です。\nExtensions → Apps Script → Project Settings → Script Properties で設定してください。' };
  }

  var ref = PropertiesService.getScriptProperties().getProperty('GITHUB_REF') || DEFAULT_REF;
  var url = 'https://api.github.com/repos/' + REPO + '/actions/workflows/' + WORKFLOW_FILE + '/dispatches';

  var body = {
    ref: ref,
    inputs: {
      step_id: stepId,
      project_ids: projectIds.join(','),
      max_items: String(projectIds.length),
      dry_run: dryRun ? 'true' : 'false'
    }
  };

  var response = UrlFetchApp.fetch(url, {
    method: 'post',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json'
    },
    payload: JSON.stringify(body),
    muteHttpExceptions: true
  });

  var status = response.getResponseCode();
  if (status !== 204) {
    var text = response.getContentText();
    return { success: false, alertMessage: 'GitHub API エラー (' + status + '):\n' + text };
  }

  return { success: true };
}
