import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * Create an empty state object.
 */
function emptyState() {
  return { last_run: null, total_classified: 0, repos: {} };
}

/**
 * Load classification state from a JSON file.
 * Returns empty state if the file doesn't exist or is corrupt.
 * @param {string} filePath
 * @returns {Promise<{last_run: string|null, total_classified: number, repos: Object}>}
 */
export async function loadState(filePath) {
  try {
    const raw = await readFile(filePath, 'utf-8');
    const state = JSON.parse(raw);
    // Basic validation
    if (!state.repos || typeof state.repos !== 'object') {
      console.warn('State file has invalid format, starting fresh.');
      return emptyState();
    }
    return state;
  } catch (err) {
    if (err.code === 'ENOENT') {
      return emptyState();
    }
    console.warn(`Failed to load state file: ${err.message}. Starting fresh.`);
    return emptyState();
  }
}

/**
 * Save classification state to a JSON file.
 * @param {string} filePath
 * @param {object} state
 */
export async function saveState(filePath, state) {
  await mkdir(dirname(filePath), { recursive: true });
  const json = JSON.stringify(state, null, 2) + '\n';
  await writeFile(filePath, json, 'utf-8');
}

/**
 * Given all starred repos and the current state, return repos that
 * haven't been classified yet.
 * @param {Array} allRepos - from GitHub API
 * @param {object} state - current classification state
 * @returns {Array} repos not yet in state
 */
export function computeNewRepos(allRepos, state) {
  return allRepos.filter((repo) => !state.repos[repo.full_name]);
}

/**
 * Merge newly classified repos into the state.
 * @param {object} state - current state (mutated)
 * @param {Array<{full_name: string, categories: string[], summary: string, description: string, language: string|null, topics: string[], html_url: string, homepage: string|null, stargazers_count: number, starred_at: string, fork: boolean, archived: boolean, classified_at: string}>} classifications
 * @returns {object} updated state
 */
export function mergeClassifications(state, classifications) {
  const now = new Date().toISOString();

  for (const entry of classifications) {
    state.repos[entry.full_name] = {
      categories: entry.categories,
      summary: entry.summary,
      description: entry.description,
      language: entry.language,
      topics: entry.topics,
      html_url: entry.html_url,
      homepage: entry.homepage,
      stargazers_count: entry.stargazers_count,
      starred_at: entry.starred_at,
      fork: entry.fork,
      archived: entry.archived,
      classified_at: now,
    };
  }

  state.last_run = now;
  state.total_classified = Object.keys(state.repos).length;
  return state;
}
