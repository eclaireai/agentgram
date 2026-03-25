import { createHash } from 'node:crypto';

/** SHA-256 hash of content, truncated to 12 hex chars */
export function contentHash(content: string | Buffer): string {
  return createHash('sha256')
    .update(content)
    .digest('hex')
    .slice(0, 12);
}

/** Generate a short unique ID */
export function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Generate a session-friendly branch name */
export function sessionBranchName(sessionName: string): string {
  const safe = sessionName
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return `agentgram/${safe}-${Date.now().toString(36)}`;
}
