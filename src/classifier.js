/**
 * LLM-based repository classifier.
 * Calls an OpenAI-compatible chat completions API to classify repos
 * into a fixed taxonomy of categories.
 */

const CATEGORIES = [
  'AI/ML',
  'Analytics',
  'Blockchain/Web3',
  'CLI Tool',
  'Cloud/DevOps',
  'Database',
  'Developer Tool',
  'Documentation',
  'Editor/IDE',
  'Embedded/IoT',
  'Frontend Framework',
  'Game Development',
  'GIS/Mapping',
  'Image Processing',
  'Learning/Education',
  'Library/Utility',
  'Messaging/Chat',
  'Mobile Development',
  'Monitoring/Observability',
  'Networking',
  'Operating System',
  'Package Manager',
  'Security',
  'Static Site Generator',
  'Template/Boilerplate',
  'Testing',
  'Web Framework',
  'Other',
];

/**
 * Build the classification prompt for a batch of repos.
 */
function buildPrompt(repos) {
  const taxonomy = CATEGORIES.join(', ');
  const repoList = repos
    .map(
      (r, i) =>
        `${i + 1}. Name: ${r.full_name}, Description: ${r.description || 'N/A'}, Language: ${r.language || 'N/A'}, Topics: ${r.topics.length > 0 ? r.topics.join(', ') : 'N/A'}, Stars: ${r.stargazers_count}, Fork: ${r.fork}`
    )
    .join('\n');

  return `You are a precise software project classifier. Classify each repository into 1-3 categories from the taxonomy below, and write a one-sentence summary of what the project does.

TAXONOMY: ${taxonomy}

REPOSITORIES:
${repoList}

You must respond with a JSON object containing a "results" key, whose value is an array. Each element must have:
- "full_name": exact repo name as given above
- "categories": array of 1-3 categories from the taxonomy
- "summary": one-sentence description

Example: {"results": [{"full_name": "user/repo", "categories": ["Developer Tool", "CLI Tool"], "summary": "A CLI tool for X"}]}`;
}

/**
 * Normalize a category string to match the taxonomy.
 * Tries exact match first, then case-insensitive, then substring match.
 * Falls back to "Other".
 */
function normalizeCategory(raw) {
  const trimmed = raw.trim();

  // Exact match
  if (CATEGORIES.includes(trimmed)) return trimmed;

  // Case-insensitive match
  const lower = trimmed.toLowerCase();
  for (const cat of CATEGORIES) {
    if (cat.toLowerCase() === lower) return cat;
  }

  // Substring match (both directions)
  for (const cat of CATEGORIES) {
    if (cat.toLowerCase().includes(lower) || lower.includes(cat.toLowerCase())) {
      return cat;
    }
  }

  return 'Other';
}

/**
 * Parse the LLM response, stripping markdown fences if present.
 */
function parseResponse(text) {
  // Strip markdown code fences
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }

  return JSON.parse(cleaned);
}

/**
 * Call the LLM API to classify a single batch of repos.
 * Retries once on parse failure.
 */
async function classifyBatch(repos, config) {
  const prompt = buildPrompt(repos);

  const body = {
    model: config.llmModel,
    messages: [
      { role: 'user', content: prompt },
    ],
    temperature: 0.1,
    max_tokens: 4000,
    // Disable thinking/reasoning mode for DeepSeek models (wastes tokens on simple classification)
    thinking: { type: 'disabled' },
    // Force JSON output
    response_format: { type: 'json_object' },
  };

  const url = `${config.llmBaseUrl}/chat/completions`;
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${config.llmApiKey}`,
  };

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`LLM API error (${response.status}): ${errorText}`);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error('Empty response from LLM');
      }

      const parsed = parseResponse(content);
      // Support both {results: [...]} and direct [...]
      const results = Array.isArray(parsed) ? parsed : parsed.results;
      if (!Array.isArray(results)) {
        throw new Error('LLM response is not an array');
      }

      return results;
    } catch (err) {
      if (attempt === 0) {
        console.warn(`  Parse error, retrying: ${err.message}`);
        // On retry, add explicit instruction for JSON-only output
        body.messages.push({
          role: 'assistant',
          content: '```json\n',
        });
        body.messages.push({
          role: 'user',
          content: 'Continue. Return ONLY valid JSON, no markdown fences.',
        });
      } else {
        console.error(`  Failed to classify batch after retry: ${err.message}`);
        return [];
      }
    }
  }

  return [];
}

/**
 * Classify a list of repos in batches.
 * @param {Array} repos - repos to classify
 * @param {object} config - configuration with llmApiKey, llmBaseUrl, llmModel, batchSize
 * @returns {Promise<Array>} classified repos with categories and summary
 */
export async function classifyRepos(repos, config) {
  const results = [];
  const totalBatches = Math.ceil(repos.length / config.batchSize);

  for (let i = 0; i < repos.length; i += config.batchSize) {
    const batch = repos.slice(i, i + config.batchSize);
    const batchNum = Math.floor(i / config.batchSize) + 1;
    console.log(`Classifying batch ${batchNum}/${totalBatches} (${batch.length} repos)...`);

    const batchResults = await classifyBatch(batch, config);

    for (const result of batchResults) {
      // Find matching repo from input
      const repo = repos.find(
        (r) => r.full_name === result.full_name
      );
      if (!repo) continue;

      const categories = (result.categories || ['Other']).map(normalizeCategory);

      results.push({
        ...repo,
        categories,
        summary: result.summary || repo.description || 'No description available.',
      });
    }

    // Small delay between batches to avoid rate limits
    if (i + config.batchSize < repos.length) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  return results;
}

export { CATEGORIES };
