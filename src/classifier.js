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
  'Content/CMS',
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
  'Productivity',
  'Security',
  'Static Site Generator',
  'Template/Boilerplate',
  'Testing',
  'Web Framework',
  'Other',
];

/**
 * One-line definition per category. Definitions live next to the taxonomy in
 * the prompt: without them the model invents its own boundaries, which showed
 * up as "Developer Tool" used as filler (40 of 53 uses were secondary tags on
 * AI/ML repos) and "Other" on 13% of repos.
 */
const TAXONOMY_DEFINITIONS = {
  'AI/ML': 'ML/LLM frameworks, AI agents and apps, model hubs, inference and fine-tuning',
  'Analytics': 'data analysis, dashboards, metrics and BI',
  'Blockchain/Web3': 'blockchains, smart contracts, wallets and dApps',
  'CLI Tool': 'the primary interface is the terminal',
  'Cloud/DevOps': 'cloud infrastructure, containers, Kubernetes, CI/CD and deployment',
  'Content/CMS': 'content management, blogging, podcast and media publishing',
  'Database': 'database engines, ORMs, clients and migration tools',
  'Developer Tool': 'tools you run while building software: build systems, linters, scaffolding, code quality, AI coding assistants',
  'Documentation': 'reference docs, guides, awesome-lists and technical handbooks',
  'Editor/IDE': 'text editors, IDEs and their plugins',
  'Embedded/IoT': 'firmware, microcontrollers, robotics and connected devices',
  'Frontend Framework': 'UI frameworks and component libraries for browser interfaces',
  'Game Development': 'game engines and code for making games',
  'GIS/Mapping': 'maps, geospatial data and location services',
  'Image Processing': 'image/video generation and editing, OCR and computer vision',
  'Learning/Education': 'courses, curricula, tutorials and interview prep',
  'Library/Utility': 'general-purpose code you import into your own project',
  'Messaging/Chat': 'chat apps, IM bots and notification platforms',
  'Mobile Development': 'Android/iOS apps and cross-platform mobile frameworks',
  'Monitoring/Observability': 'logging, tracing, metrics and uptime monitoring',
  'Networking': 'proxies, tunnels, network protocols and traffic tools',
  'Operating System': 'OS kernels, distros, desktop environments and system tooling',
  'Package Manager': 'package managers and registries',
  'Productivity': 'note-taking, whiteboards, task, time and knowledge management',
  'Security': 'pentesting, vulnerability scanning, auth and privacy tools',
  'Static Site Generator': 'static site generators and their themes',
  'Template/Boilerplate': 'starter templates and project scaffolds',
  'Testing': 'test frameworks, mocking and QA automation',
  'Web Framework': 'server-side and full-stack web application frameworks',
  'Other': 'genuinely fits nothing above',
};

/**
 * Build the system prompt: task, rules, taxonomy with definitions.
 * Kept identical across batches so DeepSeek's KV prefix cache can reuse it.
 */
function buildSystemPrompt() {
  const taxonomy = CATEGORIES.map((c) => `- ${c}: ${TAXONOMY_DEFINITIONS[c]}`).join('\n');

  return `You are a precise software repository classifier. For each repository the user lists, choose 1-2 categories from the taxonomy and write a summary.

RULES:
- categories[0] is the PRIMARY category used for grouping. Put the single best fit first, then at most one more category, most specific first.
- Use at most 2 categories; do not pad. Omit a category rather than guess.
- Use "Other" only when no category fits, and never combine it with a category that fits.
- Disambiguation: "Developer Tool" is a tool you run to build software; "Library/Utility" is code you import; if the terminal is the primary interface, use "CLI Tool". "Documentation" is reference docs and awesome-lists; "Learning/Education" is courses, curricula and tutorials. "Web Framework" is server-side or full-stack; "Frontend Framework" is browser-side UI.
- Write the summary in English, under 20 words, based on the description and topics, regardless of the description's language.
- Return exactly one result per input repository, in the same order, echoing full_name exactly.
- Respond with a JSON object: {"results": [{"full_name": "...", "categories": ["..."], "summary": "..."}]}

Example: {"results": [{"full_name": "user/repo", "categories": ["Developer Tool", "CLI Tool"], "summary": "Terminal-first tool that formats code on save."}]}

TAXONOMY:
${taxonomy}`;
}

/**
 * Build the user message: the batch of repos to classify.
 */
function buildRepoList(repos) {
  return `REPOSITORIES:
${repos
  .map(
    (r, i) =>
      `${i + 1}. Name: ${r.full_name}, Description: ${r.description || 'N/A'}, Language: ${r.language || 'N/A'}, Topics: ${r.topics.length > 0 ? r.topics.join(', ') : 'N/A'}, Fork: ${r.fork}`
  )
  .join('\n')}`;
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
 *
 * Calling convention follows the DeepSeek API docs
 * (https://api-docs.deepseek.com/zh-cn):
 * - system message carries the task/rules, user message carries the data
 *   (matches the official JSON-mode example);
 * - `thinking` must be explicitly disabled — per docs it defaults to ENABLED
 *   when neither `thinking` nor `reasoning_effort` is provided;
 * - `temperature` applies in non-thinking mode (range 0-2, default 1);
 * - JSON mode: invalid output is replaced with spaces (looks empty), and
 *   finish_reason "length" means the JSON was cut off mid-stream.
 */
async function classifyBatch(repos, config) {
  const body = {
    model: config.llmModel,
    messages: [
      { role: 'system', content: buildSystemPrompt() },
      { role: 'user', content: buildRepoList(repos) },
    ],
    temperature: 0,
    max_tokens: 4000,
    thinking: { type: 'disabled' },
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
      const choice = data.choices?.[0];
      const content = choice?.message?.content;

      if (!content || !content.trim()) {
        // JSON mode replaces invalid output with spaces, so this can be an
        // empty string with finish_reason "stop".
        throw new Error(`empty response (finish_reason=${choice?.finish_reason ?? 'unknown'})`);
      }
      if (choice.finish_reason === 'length') {
        throw new Error('response truncated by max_tokens (finish_reason=length); lower BATCH_SIZE');
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
        console.warn(`  Classification attempt failed, retrying: ${err.message}`);
        // Ask for a corrected full response; no assistant prefill — with
        // JSON mode the prefill must be a valid JSON prefix, a markdown
        // fence is not.
        body.messages.push({
          role: 'user',
          content: `Your previous response could not be used (${err.message.slice(0, 200)}). Return the complete corrected JSON object now, following the schema exactly — no prose, no markdown fences.`,
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

export { CATEGORIES, TAXONOMY_DEFINITIONS, buildSystemPrompt, buildRepoList, normalizeCategory };
