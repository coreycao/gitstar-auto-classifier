import { loadConfig } from './config.js';
import { fetchAllStarredRepos } from './github-client.js';
import { loadState, saveState, computeNewRepos, mergeClassifications } from './state.js';
import { classifyRepos } from './classifier.js';
import { generateReadme } from './readme-generator.js';

async function main() {
  console.log('⭐ GitHub Star Auto-Classifier');
  console.log('='.repeat(40));

  // 1. Load configuration
  const config = loadConfig();
  console.log(`GitHub user: ${config.ghUsername}`);
  console.log(`LLM model:   ${config.llmModel}`);
  console.log(`Force refresh: ${config.forceRefresh}`);
  console.log('');

  // 2. Fetch all starred repos
  console.log('Fetching starred repositories...');
  const allRepos = await fetchAllStarredRepos(config.ghUsername, config.ghToken);
  console.log(`Found ${allRepos.length} starred repos.`);
  console.log('');

  // 3. Load existing state
  const state = await loadState(config.stateFile);
  const previouslyClassified = Object.keys(state.repos).length;
  console.log(`Previously classified: ${previouslyClassified} repos.`);

  // 4. Determine repos to classify
  let reposToClassify;
  if (config.forceRefresh) {
    console.log('Force refresh enabled — re-classifying all repos.');
    reposToClassify = allRepos;
    // Clear existing state for full re-classification
    state.repos = {};
  } else {
    reposToClassify = computeNewRepos(allRepos, state);
    console.log(`New repos to classify: ${reposToClassify.length}.`);
  }
  console.log('');

  // 5. Classify new repos
  if (reposToClassify.length > 0) {
    console.log(`Classifying ${reposToClassify.length} repos...`);
    const classifications = await classifyRepos(reposToClassify, config);
    console.log(`Successfully classified ${classifications.length} repos.`);
    console.log('');

    // 6. Merge into state
    mergeClassifications(state, classifications);
  } else {
    console.log('No new repos to classify.');
    state.last_run = new Date().toISOString();
    state.total_classified = Object.keys(state.repos).length;
  }

  // 7. Save state (include repo/LLM metadata so the Pages site footer self-links)
  state.repo_url = config.repoUrl;
  state.llm_model = config.llmModel;
  await saveState(config.stateFile, state);
  console.log(`State saved to ${config.stateFile}`);

  // 8. Generate README
  await generateReadme(state, config.readmeFile, { repoUrl: config.repoUrl, pagesUrl: config.pagesUrl });
  console.log(`README generated at ${config.readmeFile}`);

  // 9. Summary
  console.log('');
  console.log('='.repeat(40));
  console.log(`✅ Done! Total classified: ${state.total_classified} repos`);

  // Count categories
  const categoryCounts = {};
  for (const repo of Object.values(state.repos)) {
    for (const cat of repo.categories || []) {
      categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
    }
  }
  const topCategories = Object.entries(categoryCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  console.log('Top categories:');
  for (const [cat, count] of topCategories) {
    console.log(`  ${cat}: ${count}`);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
