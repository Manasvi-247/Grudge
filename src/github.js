// GitHub integration. Three pieces, all optional in demo mode:
//   1. webhook signature verification + payload → engine-event translation
//   2. openIssue() — posts the pet's passive-aggressive issues (needs PAT)
//   3. pollUserEvents() — no-tunnel real mode: polls your public activity
//      so commits feed the pet without deploying a webhook endpoint.

import crypto from 'node:crypto';

export function verifySignature(secret, rawBody, signatureHeader) {
  if (!secret) return true; // no secret configured → local dev, accept
  if (!signatureHeader) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Translate a GitHub webhook into an engine event, or null to ignore.
export function parseWebhook(eventName, payload) {
  if (eventName === 'push') {
    return {
      type: 'push',
      commits: payload.commits?.length || 1,
      repo: payload.repository?.full_name ?? 'unknown/repo',
    };
  }
  if (eventName === 'workflow_run' && payload.action === 'completed') {
    return {
      type: 'build',
      ok: payload.workflow_run?.conclusion === 'success',
      repo: payload.repository?.full_name ?? 'unknown/repo',
    };
  }
  return null;
}

export async function openIssue({ token, repo, title, body }) {
  const res = await fetch(`https://api.github.com/repos/${repo}/issues`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'grudge',
    },
    body: JSON.stringify({ title, body, labels: ['grudge'] }),
  });
  if (!res.ok) throw new Error(`GitHub said ${res.status}: ${await res.text()}`);
  return (await res.json()).html_url;
}

// Poll mode: returns push events newer than `sinceId`, plus the newest id seen.
export async function pollUserEvents({ token, username, sinceId }) {
  const res = await fetch(`https://api.github.com/users/${username}/events?per_page=30`, {
    headers: {
      accept: 'application/vnd.github+json',
      'user-agent': 'grudge',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) throw new Error(`GitHub said ${res.status}`);
  const events = await res.json();
  const newest = events[0]?.id ?? sinceId;
  if (!sinceId) return { pushes: [], newest }; // first poll: baseline only, don't gorge on history
  const pushes = events
    .filter((e) => e.type === 'PushEvent' && BigInt(e.id) > BigInt(sinceId))
    .map((e) => ({
      type: 'push',
      commits: e.payload?.size || e.payload?.commits?.length || 1,
      repo: e.repo?.name ?? 'unknown/repo',
    }));
  return { pushes, newest };
}
