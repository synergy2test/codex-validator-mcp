/**
 * Change Applier Service
 *
 * Handles applying suggested changes with confirmation workflow.
 * When apply_changes=true and require_confirmation=true, this service
 * manages the confirmation flow before changes are applied.
 *
 * Note: In MCP context, confirmation is handled via the tool response
 * prompting the user for approval. The actual application is done by
 * Codex CLI when running in --full-auto mode.
 */

export interface ProposedChange {
  type: 'file_create' | 'file_modify' | 'file_delete' | 'dependency_add' | 'config_change';
  path: string;
  description: string;
  diff?: string;
  impact: 'low' | 'medium' | 'high';
}

export interface ChangeConfirmation {
  change: ProposedChange;
  approved: boolean;
  reason?: string;
}

export interface ChangeApplierOptions {
  /** Logger function */
  logger?: (message: string, level: 'info' | 'warn' | 'error' | 'debug') => void;
}

export class ChangeApplier {
  private logger: (message: string, level: 'info' | 'warn' | 'error' | 'debug') => void;

  constructor(options: ChangeApplierOptions = {}) {
    this.logger = options.logger ?? ((message, level) => {
      const prefix = `[ChangeApplier][${level.toUpperCase()}]`;
      if (level === 'debug') {
        // Silent by default
      } else if (level === 'error') {
        console.error(`${prefix} ${message}`);
      } else if (level === 'warn') {
        console.warn(`${prefix} ${message}`);
      } else {
        console.log(`${prefix} ${message}`);
      }
    });
  }

  /**
   * Parse Codex output to extract proposed changes
   */
  public parseProposedChanges(codexOutput: string): ProposedChange[] {
    const changes: ProposedChange[] = [];

    // Look for file modification patterns in Codex output
    const patterns = [
      // File creation
      {
        regex: /(?:create|creating|new file)[:\s]+([^\n]+)/gi,
        type: 'file_create' as const,
      },
      // File modification
      {
        regex: /(?:modify|modifying|update|updating|edit|editing)[:\s]+([^\n]+)/gi,
        type: 'file_modify' as const,
      },
      // File deletion
      {
        regex: /(?:delete|deleting|remove|removing)[:\s]+([^\n]+)/gi,
        type: 'file_delete' as const,
      },
      // Dependency addition
      {
        regex: /(?:install|add dependency|npm install|yarn add)[:\s]+([^\n]+)/gi,
        type: 'dependency_add' as const,
      },
      // Config changes
      {
        regex: /(?:config|configuration|setting)[:\s]+([^\n]+)/gi,
        type: 'config_change' as const,
      },
    ];

    for (const { regex, type } of patterns) {
      let match;
      while ((match = regex.exec(codexOutput)) !== null) {
        const path = match[1].trim();
        if (path && !path.startsWith('//') && path.length < 200) {
          changes.push({
            type,
            path,
            description: this.generateDescription(type, path),
            impact: this.assessImpact(type, path),
          });
        }
      }
    }

    // Look for diff blocks
    const diffRegex = /```(?:diff)?\n([\s\S]*?)```/g;
    let diffMatch;
    while ((diffMatch = diffRegex.exec(codexOutput)) !== null) {
      const diffContent = diffMatch[1].trim();
      const fileMatch = diffContent.match(/^(?:---|\+\+\+)\s+([^\n]+)/m);
      if (fileMatch) {
        const existingChange = changes.find(c => c.path.includes(fileMatch[1]));
        if (existingChange) {
          existingChange.diff = diffContent;
        }
      }
    }

    return changes;
  }

  /**
   * Generate human-readable description for a change
   */
  private generateDescription(type: ProposedChange['type'], path: string): string {
    const filename = path.split('/').pop() ?? path;

    switch (type) {
      case 'file_create':
        return `Create new file: ${filename}`;
      case 'file_modify':
        return `Modify existing file: ${filename}`;
      case 'file_delete':
        return `Delete file: ${filename}`;
      case 'dependency_add':
        return `Add dependency: ${path}`;
      case 'config_change':
        return `Update configuration: ${path}`;
      default:
        return `Change: ${path}`;
    }
  }

  /**
   * Assess the impact level of a change
   */
  private assessImpact(type: ProposedChange['type'], path: string): 'low' | 'medium' | 'high' {
    const pathLower = path.toLowerCase();

    // High impact: critical files
    if (
      pathLower.includes('package.json') ||
      pathLower.includes('tsconfig') ||
      pathLower.includes('.env') ||
      pathLower.includes('config') ||
      pathLower.includes('main') ||
      pathLower.includes('index') ||
      type === 'file_delete'
    ) {
      return 'high';
    }

    // Medium impact: source code changes
    if (
      pathLower.endsWith('.ts') ||
      pathLower.endsWith('.tsx') ||
      pathLower.endsWith('.js') ||
      pathLower.endsWith('.jsx') ||
      pathLower.endsWith('.py') ||
      type === 'dependency_add'
    ) {
      return 'medium';
    }

    // Low impact: documentation, tests, styles
    return 'low';
  }

  /**
   * Generate a confirmation summary for proposed changes
   */
  public generateConfirmationSummary(changes: ProposedChange[]): string {
    if (changes.length === 0) {
      return 'No changes detected.';
    }

    const lines: string[] = [
      '## Proposed Changes',
      '',
      `Total: ${changes.length} change(s)`,
      '',
    ];

    // Group by impact
    const highImpact = changes.filter(c => c.impact === 'high');
    const mediumImpact = changes.filter(c => c.impact === 'medium');
    const lowImpact = changes.filter(c => c.impact === 'low');

    if (highImpact.length > 0) {
      lines.push('### High Impact (requires careful review)');
      for (const change of highImpact) {
        lines.push(`- **${change.type}**: ${change.description}`);
      }
      lines.push('');
    }

    if (mediumImpact.length > 0) {
      lines.push('### Medium Impact');
      for (const change of mediumImpact) {
        lines.push(`- ${change.type}: ${change.description}`);
      }
      lines.push('');
    }

    if (lowImpact.length > 0) {
      lines.push('### Low Impact');
      for (const change of lowImpact) {
        lines.push(`- ${change.type}: ${change.description}`);
      }
      lines.push('');
    }

    // Add diffs if available
    const changesWithDiffs = changes.filter(c => c.diff);
    if (changesWithDiffs.length > 0) {
      lines.push('### Diffs');
      for (const change of changesWithDiffs) {
        lines.push(`\n**${change.path}**:`);
        lines.push('```diff');
        lines.push(change.diff!);
        lines.push('```');
      }
    }

    return lines.join('\n');
  }

  /**
   * Create a confirmation request message
   * In MCP context, this is returned to the user for approval
   */
  public createConfirmationRequest(changes: ProposedChange[]): {
    message: string;
    requiresApproval: boolean;
    highImpactCount: number;
  } {
    const highImpactCount = changes.filter(c => c.impact === 'high').length;
    const summary = this.generateConfirmationSummary(changes);

    const message = `${summary}

---

**Confirmation Required**

${highImpactCount > 0
      ? `WARNING: This includes ${highImpactCount} high-impact change(s) that may significantly affect the project.`
      : 'These changes appear to be relatively safe.'}

To apply these changes, re-run the validation with \`apply_changes: true\` and confirm you have reviewed the changes above.`;

    return {
      message,
      requiresApproval: changes.length > 0,
      highImpactCount,
    };
  }

  /**
   * Validate that changes were actually applied (post-execution check)
   */
  public validateChangesApplied(
    proposedChanges: ProposedChange[],
    appliedChanges: string[]
  ): {
    success: boolean;
    applied: string[];
    failed: string[];
    partial: boolean;
  } {
    const applied: string[] = [];
    const failed: string[] = [];

    for (const change of proposedChanges) {
      const wasApplied = appliedChanges.some(
        ac => ac.toLowerCase().includes(change.path.toLowerCase())
      );

      if (wasApplied) {
        applied.push(change.path);
      } else {
        failed.push(change.path);
      }
    }

    return {
      success: failed.length === 0,
      applied,
      failed,
      partial: applied.length > 0 && failed.length > 0,
    };
  }
}

// Export singleton instance
export const changeApplier = new ChangeApplier();
