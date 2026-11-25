export interface Violation {
  /** Rule ID from the start of the Rego message, or UNKNOWN when the message has none. */
  ruleId: string;
  /** The message with the rule ID prefix removed. */
  message: string;
  file: string;
  /** NIST SP 800-171 control IDs from the mapping file. Empty when the rule is not mapped. */
  controls: string[];
  title: string;
  remediation: string;
}

export interface Explanation {
  text: string;
  assumptions: string[];
  /** 'model' when the output validated, 'fallback' when the rule's own fix text was used. */
  source: 'model' | 'fallback';
  reason?: string;
}

export type Stage = 'pre-merge' | 'post-deploy';
