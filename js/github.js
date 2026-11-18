// Publish files to a GitHub repository in ONE commit using the Git Data API.
// Needs a fine-grained personal access token with "Contents: Read and write" on that repo only.
// The token is stored only in the artist's own browser.
import { b64 } from './crypto.js';

export async function publishToGitHub({ owner, repo, branch = 'main', token, files, remove = [], message, onP = () => {} }) {
  const api = (path, opts = {}) => fetch(`https://api.github.com/repos/${owner}/${repo}${path}`, {
    ...opts, headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(opts.body ? { 'Content-Type': 'application/json' } : {}) },
  }).then(async r => {
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(j.message || `GitHub error ${r.status}`); e.status = r.status; throw e; }
    return j;
  });
  onP('Connecting to GitHub', 0);
  const ref = await api(`/git/ref/heads/${encodeURIComponent(branch)}`);
  const parent = ref.object.sha;
  const commit = await api(`/git/commits/${parent}`);
  const tree = [];
  const entries = Object.entries(files);
  let i = 0;
  for (const [path, data] of entries) {
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    onP(`Uploading ${path.split('/').pop()}`, (i / Math.max(1, entries.length)) * 90);
    const blob = await api('/git/blobs', { method: 'POST', body: JSON.stringify({ content: b64(bytes), encoding: 'base64' }) });
    tree.push({ path, mode: '100644', type: 'blob', sha: blob.sha });
    i++;
  }
  // only delete paths that actually exist, or GitHub rejects the tree
  if (remove.length) {
    const full = await api(`/git/trees/${commit.tree.sha}?recursive=1`);
    const existing = new Set((full.tree || []).map(t => t.path));
    for (const path of remove) if (existing.has(path) && !files[path]) tree.push({ path, mode: '100644', type: 'blob', sha: null });
  }
  onP('Creating commit', 94);
  const newTree = await api('/git/trees', { method: 'POST', body: JSON.stringify({ base_tree: commit.tree.sha, tree }) });
  const newCommit = await api('/git/commits', { method: 'POST', body: JSON.stringify({ message, tree: newTree.sha, parents: [parent] }) });
  await api(`/git/refs/heads/${encodeURIComponent(branch)}`, { method: 'PATCH', body: JSON.stringify({ sha: newCommit.sha }) });
  onP('Published', 100);
  return newCommit;
}
