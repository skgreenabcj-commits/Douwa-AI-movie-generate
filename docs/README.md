# Project Overview

## 1. Purpose

This project is an AI-assisted content production pipeline for children's story videos.

Its goal is to generate structured production assets step by step from a story source, using Google Sheets as the operational data store and GitHub Actions + TypeScript as the execution layer.

The pipeline is designed to support both **Short** and **Full** video formats, while keeping data consistency across downstream steps such as script writing, visual planning, audio/TTS, QA, and final editing support.

---

## 2. What the system does

The system processes each project in multiple sequential steps.

### Main workflow
- **STEP_01**: Rights validation
- **STEP_02**: Source build
- **STEP_03**: Scene build
- **STEP_04 / STEP_05 (combined)**: Script generation for Short / Full
- downstream steps: visual, audio, QA, edit-related production data generation

### Core design concept
- Google Sheets is used as the operational source of truth
- each step reads structured rows from existing sheets
- AI generates structured JSON
- the system validates, normalizes, and upserts the results back into designated sheets
- downstream steps reuse upstream outputs without changing core identifiers

---

## 3. Data model / operational model

### Primary datastore
Google Sheets is the main operational database.

Typical sheets include:
- `00_Project`
- `00_Rights_Validation`
- `01_Source`
- `02_Scenes`
- `03_Script_Short`
- `04_Script_Full`
- `94_Runtime_Config`
- `100_App_Logs`

### Key principles
- `record_id` is the main row-level identifier used for upsert and cross-step linkage
- `scene_no` is a display/order field, not a key
- only columns defined in **Field_Master** are treated as real GSS columns
- non-existent columns must not be written by the implementation
- AI outputs are always validated against JSON schema before writing

---

## 4. Execution architecture

### Trigger
- Google Apps Script (GAS) triggers GitHub Actions workflows

### Execution layer
- GitHub Actions runs the step implementation
- TypeScript modules orchestrate:
  - input loading
  - prompt construction
  - model invocation
  - JSON validation
  - row mapping
  - Google Sheets upsert
  - application logging

### AI interaction model
- prompts are versioned as markdown files
- AI outputs are constrained by JSON schema
- responses are validated before persistence
- business rules such as duration handling, filtering, and dependency control are enforced in code

---

## 5. Technology stack

### Language / runtime
- **TypeScript**
- **Node.js**

### CI / orchestration
- **GitHub Actions**

### Spreadsheet integration
- **Google Sheets**
- **Google Apps Script (GAS)** for workflow triggering and spreadsheet-side integration

### AI / validation
- **Gemini API** for structured content generation
- **AJV** for JSON Schema validation

### Specification assets
- Markdown-based specs and prompt templates
- JSON Schema files for AI output and sheet write models
- example JSON files for prompt guidance and regression review

---

## 6. STEP_04 / STEP_05 specific design

STEP_04 and STEP_05 are managed as a **combined specification**.

### Behavior by `video_format`
- `full`: run Full script generation only
- `short`: run Short script generation only
- `short+full`: run Full first, then Short

### Important dependency rule
In `short+full` mode, **Short generation depends on successful Full generation**.

This is because the Short script is treated as a tuned/condensed derivative that may reference the generated Full script for better narrative compression and consistency.

### Output rule
- one scene = one row
- `record_id` is inherited from `02_Scenes`
- AI does not generate operational identifiers
- duration is calculated by the system from generated narration text
- all outputs are written via upsert into their designated sheets

---

## 7. Non-functional design priorities

The implementation prioritizes:
- schema-safe AI integration
- reproducible step execution
- spreadsheet operational compatibility
- strict column control based on Field_Master
- clear failure logging and partial-success handling
- maintainable prompt / schema / code separation

---

## 8. Intended users

This project is intended for:
- engineers maintaining the production pipeline
- operators managing project rows in Google Sheets
- prompt / schema designers refining AI behavior
- reviewers validating consistency between specification and implementation

---

## 9. Repository intent

This repository is not just an AI prompt collection.

It is an implementation-oriented production system that combines:
- operational sheet design
- structured AI generation
- validation and safety controls
- deterministic write-back logic
- step-based production workflow management
