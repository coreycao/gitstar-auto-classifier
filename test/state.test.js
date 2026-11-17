import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeNewRepos, mergeClassifications, pruneUnstarredRepos } from '../src/state.js';

function makeRepo(fullName, extra = {}) {
  return {
    full_name: fullName,
    description: '',
    language: null,
    topics: [],
    html_url: `https://github.com/${fullName}`,
    homepage: null,
    stargazers_count: 1,
    starred_at: '2026-01-01T00:00:00Z',
    fork: false,
    archived: false,
    ...extra,
  };
}

test('prunes entries whose repos are no longer starred', () => {
  const state = {
    total_classified: 3,
    repos: { 'a/kept': {}, 'b/gone': {}, 'c/kept': {} },
  };
  const stars = [makeRepo('a/kept'), makeRepo('c/kept'), makeRepo('d/new')];

  const removed = pruneUnstarredRepos(stars, state);

  assert.deepEqual(removed, ['b/gone']);
  assert.deepEqual(Object.keys(state.repos).sort(), ['a/kept', 'c/kept']);
  assert.equal(state.total_classified, 2);
});

test('no-op when all entries are still starred', () => {
  const state = { total_classified: 1, repos: { 'a/kept': {} } };
  const stars = [makeRepo('a/kept'), makeRepo('a/kept')]; // duplicate page entries

  const removed = pruneUnstarredRepos(stars, state);

  assert.deepEqual(removed, []);
  assert.equal(state.total_classified, 1);
});

test('empty star list clears all entries', () => {
  const state = { total_classified: 2, repos: { 'a/x': {}, 'b/y': {} } };

  const removed = pruneUnstarredRepos([], state);

  assert.equal(removed.length, 2);
  assert.deepEqual(state.repos, {});
  assert.equal(state.total_classified, 0);
});

test('renamed repo: old entry pruned, new name flows into computeNewRepos', () => {
  const state = { total_classified: 1, repos: { 'old/name': {} } };
  const stars = [makeRepo('new/name')];

  pruneUnstarredRepos(stars, state);
  const toClassify = computeNewRepos(stars, state);

  assert.deepEqual(Object.keys(state.repos), []);
  assert.equal(toClassify.length, 1);
  assert.equal(toClassify[0].full_name, 'new/name');
});

test('force-refresh path: merge overwrites entries and prune keeps state consistent', () => {
  const state = {
    total_classified: 2,
    repos: { 'a/old': { categories: ['Old'] }, 'gone/repo': { categories: ['Old'] } },
  };
  const stars = [makeRepo('a/old'), makeRepo('b/new')];

  // Simulate force-refresh: classify ALL starred repos, merge over existing state
  // (failed batches keep old entries), then prune.
  const classified = [{ ...makeRepo('a/old'), categories: ['New'], summary: 'refreshed' }];
  mergeClassifications(state, classified);
  pruneUnstarredRepos(stars, state);

  assert.equal(state.repos['a/old'].categories[0], 'New'); // overwritten
  assert.equal(state.repos['gone/repo'], undefined); // unstarred, pruned
  assert.equal(state.repos['b/new'], undefined); // batch failed, absent (retried next run)
  assert.equal(state.total_classified, 1);
});
