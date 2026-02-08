/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { PromptImprovementSuggestion } from '../src/types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Resolved path to prompts.ts.
 * Scripts are always launched from the repository root, so `process.cwd()`
 * points there regardless of Playwright's internal cwd.
 */
const PROMPTS_FILE_PATH = path.resolve(
  process.cwd(),
  'x-pack/platform/plugins/shared/automatic_import_v2/server/agents/prompts.ts'
);

/** Map `target_prompt` suggestion labels to the exported constant names. */
const PROMPT_CONSTANT_MAP: Record<string, string> = {
  orchestrator: 'AUTOMATIC_IMPORT_AGENT_PROMPT',
  logs_analyzer: 'LOG_ANALYZER_PROMPT',
  pipeline_generator: 'INGEST_PIPELINE_GENERATOR_PROMPT',
  text_to_ecs: 'TEXT_TO_ECS_PROMPT',
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PromptExtraction {
  constantName: string;
  /** Index of the first character *after* the opening backtick. */
  contentStart: number;
  /** Index of the closing backtick (content runs up to but not including it). */
  contentEnd: number;
  /** The raw TypeScript source between the backticks. */
  content: string;
}

/**
 * Three modes controlled by `AUTO_IMPROVE_PROMPTS` env var:
 *
 * - `off`    — (default) only print suggestions, don't touch any files
 * - `review` — generate proposed changes, write to `prompts.ts.proposed`,
 *              print a diff, but do NOT overwrite the real file
 * - `apply`  — overwrite `prompts.ts` directly (creates a timestamped backup)
 */
export type AutoImproveMode = 'off' | 'review' | 'apply';

export interface AutoImproveResult {
  mode: AutoImproveMode;
  applied: number;
  skipped: number;
  /** Path to the backup file (only when mode=apply). */
  backupPath: string;
  /** Path to the proposed file (only when mode=review). */
  proposedPath: string;
  changes: Array<{
    target: string;
    constantName: string;
    suggestionCount: number;
  }>;
  /** Unified-diff-style text showing what changed (for review mode). */
  diffText: string;
}

/** Minimal interface for the inference client provided by `@kbn/evals`. */
interface InferenceClientLike {
  chatComplete: (params: {
    messages: Array<{ role: string; content: string }>;
  }) => Promise<unknown>;
}

// ---------------------------------------------------------------------------
// Mode resolution
// ---------------------------------------------------------------------------

/**
 * Read `AUTO_IMPROVE_PROMPTS` from the environment and map to a mode.
 *
 * | Env value            | Mode     |
 * |----------------------|----------|
 * | unset / "false" / "" | off      |
 * | "review"             | review   |
 * | "true" / "apply"     | apply    |
 */
export const resolveAutoImproveMode = (): AutoImproveMode => {
  const raw = (process.env.AUTO_IMPROVE_PROMPTS ?? '').toLowerCase().trim();
  if (raw === 'review') return 'review';
  if (raw === 'true' || raw === 'apply') return 'apply';
  return 'off';
};

// ---------------------------------------------------------------------------
// Extraction helpers
// ---------------------------------------------------------------------------

/**
 * Extract a single template-literal constant from the raw TypeScript source.
 *
 * Strategy: find `export const NAME = \`` then walk forward looking for the
 * *un-escaped* closing backtick (an even number of preceding back-slashes).
 */
function extractConstant(fileText: string, constantName: string): PromptExtraction | null {
  const marker = `export const ${constantName} = \``;
  const markerIdx = fileText.indexOf(marker);
  if (markerIdx === -1) return null;

  const contentStart = markerIdx + marker.length;

  for (let i = contentStart; i < fileText.length; i++) {
    if (fileText[i] === '`') {
      // Count preceding back-slashes — an odd count means this backtick is escaped.
      let backslashes = 0;
      let j = i - 1;
      while (j >= contentStart && fileText[j] === '\\') {
        backslashes++;
        j--;
      }
      if (backslashes % 2 === 0) {
        return {
          constantName,
          contentStart,
          contentEnd: i,
          content: fileText.substring(contentStart, i),
        };
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Simple diff helper
// ---------------------------------------------------------------------------

/**
 * Produce a simple unified-diff-style summary between two strings.
 * (No external dependency — just enough to show what changed.)
 */
function simpleDiff(oldText: string, newText: string, label: string): string {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');

  const lines: string[] = [`--- a/${label}`, `+++ b/${label}`];

  // Collect added/removed ranges for context
  const maxLen = Math.max(oldLines.length, newLines.length);
  let inHunk = false;
  let hunkLines: string[] = [];
  let hunkStart = 0;

  const flushHunk = () => {
    if (hunkLines.length > 0) {
      lines.push(`@@ around line ${hunkStart + 1} @@`);
      lines.push(...hunkLines);
      lines.push('');
      hunkLines = [];
    }
    inHunk = false;
  };

  for (let i = 0; i < maxLen; i++) {
    const oldLine = i < oldLines.length ? oldLines[i] : undefined;
    const newLine = i < newLines.length ? newLines[i] : undefined;

    if (oldLine === newLine) {
      if (inHunk) flushHunk();
      continue;
    }

    if (!inHunk) {
      inHunk = true;
      hunkStart = i;
      // Add 2 lines of context before
      for (let ctx = Math.max(0, i - 2); ctx < i; ctx++) {
        if (ctx < oldLines.length) hunkLines.push(`  ${oldLines[ctx]}`);
      }
    }

    if (oldLine !== undefined && newLine !== undefined) {
      hunkLines.push(`- ${oldLine}`);
      hunkLines.push(`+ ${newLine}`);
    } else if (oldLine !== undefined) {
      hunkLines.push(`- ${oldLine}`);
    } else if (newLine !== undefined) {
      hunkLines.push(`+ ${newLine}`);
    }
  }
  flushHunk();

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// LLM prompts for rewriting
// ---------------------------------------------------------------------------

function buildRewritePrompt(
  currentContent: string,
  suggestions: PromptImprovementSuggestion[]
): string {
  const changeList = suggestions
    .map(
      (s, i) =>
        `${i + 1}. [${s.confidence.toUpperCase()}] ${s.suggestion}\n   Reasoning: ${s.reasoning}`
    )
    .join('\n\n');

  return `You are a precise prompt engineer. Your task is to apply improvement suggestions to an LLM system prompt that is stored as a TypeScript template literal.

## CURRENT PROMPT CONTENT (raw TypeScript source between the backticks)

<current>
${currentContent}
</current>

## IMPROVEMENTS TO APPLY

${changeList}

## CRITICAL RULES

1. Apply ALL of the improvements listed above.
2. Make MINIMAL changes — only modify or add what the suggestions explicitly require.
3. **PRESERVE ALL ESCAPE SEQUENCES EXACTLY** — characters like \\\`, \\$, \\\\, etc. must stay as-is. If you see \\\`\\\`\\\` (escaped backtick triples for markdown code blocks) do NOT change them.
4. Do NOT remove or reformat existing content unless a suggestion explicitly says to.
5. Preserve the overall markdown structure — headings, code blocks, tables, examples.
6. Do NOT add commentary, meta-notes, or explanations — return ONLY the modified prompt text.
7. The output must be valid content for a TypeScript template literal (backtick string).

Return the COMPLETE modified prompt content, wrapped in XML tags:

<modified>
...the complete modified prompt content...
</modified>`;
}

function parseRewriteResponse(response: string): string | null {
  const match = response.match(/<modified>([\s\S]*?)<\/modified>/);
  if (!match) return null;
  // Trim a single leading and/or trailing newline (XML tag artefact) but
  // preserve all other whitespace.
  return match[1].replace(/^\n/, '').replace(/\n$/, '');
}

// ---------------------------------------------------------------------------
// Core auto-improve logic
// ---------------------------------------------------------------------------

/**
 * Generate prompt improvements and either propose or apply them.
 *
 * - `review` mode: writes `prompts.ts.proposed` and prints a diff
 * - `apply`  mode: overwrites `prompts.ts` (with timestamped backup)
 *
 * In both modes the LLM is called to rewrite each target prompt constant.
 */
export async function applyPromptImprovements(
  suggestions: PromptImprovementSuggestion[],
  inferenceClient: InferenceClientLike,
  mode: AutoImproveMode = 'review'
): Promise<AutoImproveResult> {
  const result: AutoImproveResult = {
    mode,
    applied: 0,
    skipped: 0,
    backupPath: '',
    proposedPath: '',
    changes: [],
    diffText: '',
  };

  if (suggestions.length === 0) return result;

  // 1. Read current source
  let fileText: string;
  try {
    fileText = fs.readFileSync(PROMPTS_FILE_PATH, 'utf-8');
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`❌ Could not read prompts.ts at ${PROMPTS_FILE_PATH}:`, err);
    result.skipped = suggestions.length;
    return result;
  }

  const originalFileText = fileText; // keep for diffing

  // 2. Group suggestions by target prompt
  const grouped = new Map<string, PromptImprovementSuggestion[]>();
  for (const s of suggestions) {
    const arr = grouped.get(s.target_prompt) ?? [];
    arr.push(s);
    grouped.set(s.target_prompt, arr);
  }

  // 3. Rewrite each target constant via LLM
  const allDiffs: string[] = [];

  for (const [target, targetSuggestions] of grouped.entries()) {
    const constantName = PROMPT_CONSTANT_MAP[target];
    if (!constantName) {
      // eslint-disable-next-line no-console
      console.warn(`⚠️  Unknown target_prompt "${target}" — skipping`);
      result.skipped += targetSuggestions.length;
      continue;
    }

    // Re-extract after each modification because indices shift.
    const extraction = extractConstant(fileText, constantName);
    if (!extraction) {
      // eslint-disable-next-line no-console
      console.warn(`⚠️  Could not locate ${constantName} in prompts.ts — skipping`);
      result.skipped += targetSuggestions.length;
      continue;
    }

    // eslint-disable-next-line no-console
    console.log(
      `\n🔧 Generating changes for ${constantName} (${targetSuggestions.length} suggestion(s))…`
    );

    try {
      const rewritePrompt = buildRewritePrompt(extraction.content, targetSuggestions);

      const rawResponse = await inferenceClient.chatComplete({
        messages: [{ role: 'user' as const, content: rewritePrompt }],
      });

      const responseText =
        typeof rawResponse === 'string'
          ? rawResponse
          : String((rawResponse as { content?: string })?.content ?? JSON.stringify(rawResponse));

      const modified = parseRewriteResponse(responseText);
      if (!modified) {
        // eslint-disable-next-line no-console
        console.warn(`⚠️  Could not parse LLM response for ${constantName} — skipping`);
        result.skipped += targetSuggestions.length;
        continue;
      }

      // Sanity check: the rewritten content should be roughly the same size.
      const ratio = modified.length / Math.max(extraction.content.length, 1);
      if (ratio > 2.0 || ratio < 0.3) {
        // eslint-disable-next-line no-console
        console.warn(
          `⚠️  Modified ${constantName} size ratio ${ratio.toFixed(2)} is suspicious — skipping`
        );
        result.skipped += targetSuggestions.length;
        continue;
      }

      // Build a diff for this constant
      allDiffs.push(simpleDiff(extraction.content, modified, constantName));

      // Replace the constant content in the file string.
      fileText =
        fileText.substring(0, extraction.contentStart) +
        modified +
        fileText.substring(extraction.contentEnd);

      result.applied += targetSuggestions.length;
      result.changes.push({
        target,
        constantName,
        suggestionCount: targetSuggestions.length,
      });

      // eslint-disable-next-line no-console
      console.log(`   ✅ Generated ${targetSuggestions.length} change(s) for ${constantName}`);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`❌ Failed to generate changes for ${constantName}:`, err);
      result.skipped += targetSuggestions.length;
    }
  }

  result.diffText = allDiffs.join('\n\n');

  // 4. Write the result based on mode
  if (result.applied > 0 && fileText !== originalFileText) {
    if (mode === 'apply') {
      // Create a timestamped backup, then overwrite
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      result.backupPath = `${PROMPTS_FILE_PATH}.${timestamp}.backup`;
      fs.writeFileSync(result.backupPath, originalFileText, 'utf-8');
      fs.writeFileSync(PROMPTS_FILE_PATH, fileText, 'utf-8');
      // eslint-disable-next-line no-console
      console.log(`\n💾 Overwrote prompts.ts (backup: ${result.backupPath})`);
    } else {
      // review mode — write to .proposed, leave the real file untouched
      result.proposedPath = `${PROMPTS_FILE_PATH}.proposed`;
      fs.writeFileSync(result.proposedPath, fileText, 'utf-8');
      // eslint-disable-next-line no-console
      console.log(`\n📝 Wrote proposed changes to ${result.proposedPath}`);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Report formatting
// ---------------------------------------------------------------------------

export function formatAutoImproveReport(result: AutoImproveResult): string {
  if (result.applied === 0 && result.skipped === 0) {
    return '\n🤖 Auto-Improve: No suggestions to apply.\n';
  }

  const lines = [
    '',
    '═══════════════════════════════════════════════════════════════',
    `🤖 AUTO-IMPROVE RESULTS  (mode: ${result.mode})`,
    '═══════════════════════════════════════════════════════════════',
    '',
    `  Generated: ${result.applied} change(s)`,
    `  Skipped:   ${result.skipped} suggestion(s)`,
  ];

  if (result.changes.length > 0) {
    lines.push('');
    lines.push('  Prompts modified:');
    for (const c of result.changes) {
      lines.push(`    • ${c.constantName}: ${c.suggestionCount} edit(s)`);
    }
  }

  // Show diff
  if (result.diffText) {
    lines.push('');
    lines.push('  ─── Diff ───────────────────────────────────────────────────');
    for (const dl of result.diffText.split('\n')) {
      lines.push(`  ${dl}`);
    }
    lines.push('  ────────────────────────────────────────────────────────────');
  }

  if (result.mode === 'review') {
    lines.push('');
    lines.push(`  📄 Proposed file: ${result.proposedPath}`);
    lines.push('');
    lines.push('  To apply these changes:');
    lines.push(`    cp "${result.proposedPath}" \\`);
    lines.push(`       "${PROMPTS_FILE_PATH}"`);
    lines.push('');
    lines.push('  Or re-run with AUTO_IMPROVE_PROMPTS=apply to overwrite directly.');
  }

  if (result.mode === 'apply') {
    lines.push('');
    lines.push(`  💾 prompts.ts overwritten`);
    if (result.backupPath) {
      lines.push(`  ↩️  Backup: ${result.backupPath}`);
    }
    lines.push('');
    lines.push('  Re-run the eval suite to verify improvements.');
  }

  lines.push('');
  lines.push('═══════════════════════════════════════════════════════════════');
  lines.push('');

  return lines.join('\n');
}
