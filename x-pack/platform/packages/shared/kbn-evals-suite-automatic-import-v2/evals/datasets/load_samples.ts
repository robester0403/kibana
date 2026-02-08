/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import * as fs from 'fs';
import * as path from 'path';

/**
 * Directory that holds the gitignored golden-data log files.
 *
 * Expected layout:
 *   golden_data/<dataset_folder>/samples.log   (one raw log line per line)
 */
const GOLDEN_DATA_DIR = path.resolve(__dirname, '../golden_data');

/**
 * Load sample log lines for a dataset.
 *
 * 1. Looks for `golden_data/<folderName>/samples.log`
 * 2. If found, reads it (one line = one sample, blank lines skipped)
 * 3. If not found, returns the `fallbackSamples` that are baked into the TS file
 *
 * This lets you keep real integration logs out of git while still having
 * inline fallbacks so the suite works without the golden-data folder.
 */
export const loadSamples = (folderName: string, fallbackSamples: string[]): string[] => {
  const samplesPath = path.join(GOLDEN_DATA_DIR, folderName, 'samples.log');

  try {
    if (fs.existsSync(samplesPath)) {
      const raw = fs.readFileSync(samplesPath, 'utf-8');
      const lines = raw
        .split('\n')
        .map((line) => line.trimEnd()) // strip trailing \r / whitespace
        .filter((line) => line.length > 0); // skip blank lines

      if (lines.length > 0) {
        // eslint-disable-next-line no-console
        console.log(
          `📂 Loaded ${lines.length} sample(s) from golden_data/${folderName}/samples.log`
        );
        return lines;
      }
    }
  } catch {
    // Silently fall back to inline samples
  }

  return fallbackSamples;
};
