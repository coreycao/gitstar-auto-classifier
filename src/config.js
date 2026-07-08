import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Load .env file into process.env (without overwriting existing values).
 */
function loadDotenv() {
  const envPath = resolve(__dirname, '..', '.env');
  try {
    const content = readFileSync(envPath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex === -1) continue;
      const key = trimmed.slice(0, eqIndex).trim();
      const value = trimmed.slice(eqIndex + 1).trim();
      // Don't overwrite existing env vars (e.g. from GitHub Actions)
      if (!(key in process.env)) {
        process.env[key] = value;
      }
    }
  } catch {
    // .env file is optional
  }
}

// Load .env on module import
loadDotenv();

export function loadConfig() {
  const username = process.env.GH_USERNAME;
  if (!username) {
    throw new Error('GH_USERNAME environment variable is required');
  }

  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey) {
    throw new Error('LLM_API_KEY environment variable is required');
  }

  // LLM endpoint + model are required: there is no safe default, since the API
  // key is provider-specific. Failing fast with a clear message beats silently
  // hitting the wrong provider.
  const llmBaseUrl = (process.env.LLM_BASE_URL || '').trim();
  if (!llmBaseUrl) {
    throw new Error('LLM_BASE_URL environment variable is required (e.g. https://api.deepseek.com)');
  }

  const llmModel = (process.env.LLM_MODEL || '').trim();
  if (!llmModel) {
    throw new Error('LLM_MODEL environment variable is required (e.g. deepseek-chat)');
  }

  // Repository identity — auto-derived in GitHub Actions from GITHUB_REPOSITORY ("owner/repo").
  // Override REPO_URL / PAGES_URL for custom domains or a non-default setup.
  const ghRepository = process.env.GITHUB_REPOSITORY || '';
  const [repoOwner, repoName] = ghRepository.split('/');
  const hasRepoIdentity = Boolean(repoOwner && repoName);
  const repoUrl = process.env.REPO_URL
    || (hasRepoIdentity ? `https://github.com/${repoOwner}/${repoName}` : 'https://github.com/your-username/gitstar-auto-classifier');
  const pagesUrl = process.env.PAGES_URL
    || (hasRepoIdentity ? `https://${repoOwner}.github.io/${repoName}/` : '');

  return {
    // GitHub
    ghUsername: username,
    ghToken: process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '',
    repoOwner: repoOwner || '',
    repoUrl,
    pagesUrl,

    // LLM
    llmApiKey: apiKey,
    llmBaseUrl: llmBaseUrl.replace(/\/+$/, ''),
    llmModel,

    // Paths
    stateFile: process.env.STATE_FILE || 'data/classifications.json',
    readmeFile: process.env.README_FILE || 'README.md',

    // Tuning
    batchSize: parseInt(process.env.BATCH_SIZE || '10', 10),
    forceRefresh: (process.env.FORCE_REFRESH || 'false') === 'true',
  };
}
