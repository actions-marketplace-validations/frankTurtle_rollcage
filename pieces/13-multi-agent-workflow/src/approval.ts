import { existsSync } from 'node:fs';
import {
  AuditLogger,
  canonicalJson,
  matchesAny,
  readAuditRecords,
  sha256Hex,
  verifyAuditChain,
} from '@adl/shared';

export interface ProposedChange {
  branch: string;
  message: string;
  /** Path to full new content, for every file the agents wrote. */
  files: Record<string, string>;
  /** SHA-256 over the branch and the files. An approval names this value. */
  hash: string;
}

export const hashChange = (change: Pick<ProposedChange, 'branch' | 'files'>): string =>
  sha256Hex(canonicalJson({ branch: change.branch, files: change.files }));

/** The commit port. The shipped committer is a dry run; a real one is the adopter's to write. */
export interface Committer {
  commit(change: ProposedChange): Promise<string>;
}

export class DryRunCommitter implements Committer {
  readonly commits: ProposedChange[] = [];

  async commit(change: ProposedChange): Promise<string> {
    this.commits.push(change);
    return `dry-run-${change.hash.slice(0, 8)}`;
  }
}

export interface GateOptions {
  auditPath: string;
  /** Branches that need no approval. Every other branch is shared. */
  agentBranches: string[];
  /** Names that can never approve, so an agent cannot approve its own work. */
  agentNames: string[];
  now?: () => Date;
}

export interface GateDecision {
  allowed: boolean;
  reason: string;
}

export interface CommitResult {
  committed: boolean;
  reason: string;
  commitId?: string;
}

/**
 * The human approval checkpoint. Approvals live in the hash-chained audit log, so they are tied to
 * the exact change hash and an edited log stops being honored.
 */
export class ApprovalGate {
  private readonly audit: AuditLogger;

  constructor(private readonly options: GateOptions) {
    this.audit = new AuditLogger(options.auditPath, options.now);
  }

  approve(change: ProposedChange, approver: string): void {
    const name = approver.trim();
    if (!name) throw new Error('an approver name is required');
    const lower = name.toLowerCase();
    if (
      lower.startsWith('agent') ||
      this.options.agentNames.some((a) => a.toLowerCase() === lower)
    ) {
      throw new Error(`"${name}" is an agent and cannot approve a change`);
    }
    this.audit.append({
      actor: `human:${name}`,
      action: 'approve',
      input: change.hash,
      decision: 'approved',
      detail: { changeHash: change.hash, branch: change.branch },
    });
  }

  check(change: ProposedChange): GateDecision {
    if (hashChange(change) !== change.hash) {
      return { allowed: false, reason: 'the change hash does not match the change content' };
    }
    if (matchesAny(change.branch, this.options.agentBranches)) {
      return { allowed: true, reason: `${change.branch} is an agent branch, no approval needed` };
    }
    const { auditPath } = this.options;
    if (!existsSync(auditPath))
      return { allowed: false, reason: `no approval recorded for ${change.hash.slice(0, 8)}` };
    const chain = verifyAuditChain(auditPath);
    if (!chain.ok) {
      return {
        allowed: false,
        reason: `audit chain broken at line ${chain.brokenAt}, approvals are not honored`,
      };
    }
    const approval = readAuditRecords(auditPath).find(
      (r) =>
        r.action === 'approve' &&
        r.actor.startsWith('human:') &&
        r.detail?.['changeHash'] === change.hash,
    );
    return approval
      ? { allowed: true, reason: `approved by ${approval.actor}` }
      : {
          allowed: false,
          reason: `no approval recorded for change ${change.hash.slice(0, 8)} on shared branch ${change.branch}`,
        };
  }

  async commit(change: ProposedChange, committer: Committer): Promise<CommitResult> {
    const decision = this.check(change);
    const base = { actor: 'orchestrator', action: 'commit', input: change.hash };
    if (!decision.allowed) {
      this.audit.append({
        ...base,
        decision: 'blocked',
        detail: { reason: decision.reason, branch: change.branch },
      });
      return { committed: false, reason: decision.reason };
    }
    const commitId = await committer.commit(change);
    this.audit.append({
      ...base,
      decision: 'committed',
      detail: { reason: decision.reason, branch: change.branch, commitId },
    });
    return { committed: true, reason: decision.reason, commitId };
  }
}
