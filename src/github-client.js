/**
 * GitHub API client for fetching starred repositories.
 * Uses the REST API directly with the starred+json media type
 * to get `starred_at` timestamps.
 */

/**
 * Fetch all starred repos for a given username, handling pagination.
 * @param {string} username - GitHub username
 * @param {string} token - GitHub token (optional, for higher rate limits)
 * @returns {Promise<Array<{full_name: string, description: string, language: string|null, topics: string[], html_url: string, homepage: string|null, stargazers_count: number, starred_at: string, fork: boolean, archived: boolean}>>}
 */
export async function fetchAllStarredRepos(username, token = '') {
  const repos = [];
  let page = 1;
  const perPage = 100;

  while (true) {
    const url = `https://api.github.com/users/${encodeURIComponent(username)}/starred?per_page=${perPage}&page=${page}&sort=created&direction=desc`;

    const headers = {
      Accept: 'application/vnd.github.star+json',
      'User-Agent': 'gitstar-auto-classifier',
    };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const response = await fetch(url, { headers });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`GitHub API error (${response.status}): ${body}`);
    }

    const data = await response.json();

    if (data.length === 0) {
      break;
    }

    for (const item of data) {
      const repo = item.repo || item; // star+json wraps in {starred_at, repo}
      repos.push({
        full_name: repo.full_name,
        description: repo.description || '',
        language: repo.language || null,
        topics: repo.topics || [],
        html_url: repo.html_url,
        homepage: repo.homepage || null,
        stargazers_count: repo.stargazers_count || 0,
        starred_at: item.starred_at || repo.created_at || new Date().toISOString(),
        fork: repo.fork || false,
        archived: repo.archived || false,
      });
    }

    // If we got fewer than perPage results, this is the last page
    if (data.length < perPage) {
      break;
    }

    page++;
  }

  return repos;
}
