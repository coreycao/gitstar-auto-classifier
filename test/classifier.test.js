import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CATEGORIES,
  TAXONOMY_DEFINITIONS,
  buildSystemPrompt,
  buildRepoList,
  normalizeCategory,
} from '../src/classifier.js';

test('every category has a definition and vice versa', () => {
  for (const cat of CATEGORIES) {
    assert.ok(TAXONOMY_DEFINITIONS[cat], `missing definition for "${cat}"`);
    assert.ok(TAXONOMY_DEFINITIONS[cat].length > 0, `empty definition for "${cat}"`);
  }
  assert.deepEqual(
    Object.keys(TAXONOMY_DEFINITIONS).sort(),
    [...CATEGORIES].sort(),
    'TAXONOMY_DEFINITIONS and CATEGORIES must match exactly'
  );
});

test('system prompt carries rules, taxonomy and JSON schema', () => {
  const prompt = buildSystemPrompt();
  assert.match(prompt, /PRIMARY category/);
  assert.match(prompt, /at most 2 categories/);
  assert.match(prompt, /"Other" only when no category fits/);
  assert.match(prompt, /in English/);
  assert.match(prompt, /"results"/);
  for (const cat of CATEGORIES) {
    assert.ok(prompt.includes(`- ${cat}: `), `taxonomy entry for "${cat}" missing from prompt`);
  }
});

test('repo list renders required fields and tolerates empty ones', () => {
  const repos = [
    {
      full_name: 'a/b',
      description: 'A tool.',
      language: 'Rust',
      topics: ['cli', 'devtools'],
      fork: false,
    },
    {
      full_name: 'c/d',
      description: '',
      language: null,
      topics: [],
      fork: true,
    },
  ];
  const list = buildRepoList(repos);
  assert.match(list, /1\. Name: a\/b, Description: A tool\., Language: Rust, Topics: cli, devtools, Fork: false/);
  assert.match(list, /2\. Name: c\/d, Description: N\/A, Language: N\/A, Topics: N\/A, Fork: true/);
});

test('normalizeCategory resolves exact, case and substring variants', () => {
  assert.equal(normalizeCategory('AI/ML'), 'AI/ML');
  assert.equal(normalizeCategory('  ai/ml  '), 'AI/ML');
  assert.equal(normalizeCategory('developer tools'), 'Developer Tool');
  assert.equal(normalizeCategory('completely unknown nonsense'), 'Other');
});
