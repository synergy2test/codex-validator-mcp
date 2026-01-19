/**
 * Validate Plan Tool
 *
 * MCP tool for validating implementation plans using OpenAI Codex CLI
 * with Context7 integration for best practices validation.
 *
 * Features:
 * - Accepts plan via file path OR direct content string
 * - Dual execution path with automatic fallback
 * - Context7 best practices validation
 * - Both JSON and Markdown output formats
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { z } from 'zod';

import { getExecutionManager } from '../services/execution-manager.js';
import { Context7Service, Context7ValidationResult } from '../services/context7.js';
import { ChangeApplier, ProposedChange } from '../services/change-applier.js';
import { detectTechnologies, getTechnologyNames } from '../utils/tech-detector.js';

// Input schema for the validate_plan tool
export const validatePlanSchema = z.object({
  plan_path: z.string().optional().describe('Path to plan file (e.g., ./PLAN.md)'),
  plan_content: z.string().optional().describe('Direct plan content as a string'),
  project_path: z.string().optional().describe('Root directory for context (defaults to cwd)'),
  apply_changes: z.boolean().optional().default(false).describe('If true, apply suggested changes instead of suggest-only mode'),
  require_confirmation: z.boolean().optional().default(true).describe('If apply_changes=true, require user confirmation before each change'),
});

export type ValidatePlanInput = z.infer<typeof validatePlanSchema>;

// Output structure for validation results
export interface ValidationResult {
  validation_status: 'pass' | 'warn' | 'fail';
  execution_path: 'codex_cli' | 'openai_api';
  fallback_triggered: boolean;
  fallback_reason: string | null;
  mode: 'suggest' | 'apply';
  changes_applied: string[];
  feasibility: {
    score: number;
    blockers: string[];
    risks: string[];
    dependencies_missing: string[];
  };
  code_review: {
    suggestions: Array<{
      type: string;
      description: string;
      suggestion: string;
      severity: string;
    }>;
    best_practice_violations: string[];
    improvements: string[];
  };
  implementation_analysis: {
    completeness: number;
    gaps: string[];
    estimated_complexity: 'low' | 'medium' | 'high';
  };
  context7_validation: Context7ValidationResult;
  proposed_changes?: ProposedChange[];
  confirmation_required?: boolean;
  confirmation_message?: string;
}

// Tool configuration
export const TOOL_NAME = 'validate_plan';
export const TOOL_DESCRIPTION = `Validate an implementation plan using OpenAI Codex CLI with Context7 best practices integration.

This tool analyzes implementation plans for:
- Technical feasibility (blockers, dependencies, architectural issues)
- Code review suggestions (patterns, improvements, anti-patterns)
- Implementation completeness (gaps, complexity estimation)
- Best practices compliance (via Context7)

Primary execution uses Codex CLI (authenticated via browser OAuth).
Falls back to OpenAI API when Pro quota is exhausted.

Parameters:
- plan_path: Path to plan file (e.g., ./PLAN.md)
- plan_content: Direct plan content as a string
- project_path: Root directory for context (defaults to cwd)
- apply_changes: If true, apply suggested changes (default: false)
- require_confirmation: If apply_changes=true, require user confirmation (default: true)

At least one of plan_path or plan_content must be provided.`;

/**
 * Main validation function
 */
export async function validatePlan(input: ValidatePlanInput): Promise<{
  json: ValidationResult;
  markdown: string;
}> {
  // Validate input
  if (!input.plan_path && !input.plan_content) {
    throw new Error('Either plan_path or plan_content must be provided');
  }

  // Resolve project path
  const projectPath = input.project_path ?? process.cwd();

  // Get plan content
  let planContent: string;
  if (input.plan_content) {
    planContent = input.plan_content;
  } else if (input.plan_path) {
    const fullPath = path.isAbsolute(input.plan_path)
      ? input.plan_path
      : path.join(projectPath, input.plan_path);

    try {
      planContent = await fs.readFile(fullPath, 'utf-8');
    } catch (error) {
      throw new Error(`Failed to read plan file: ${fullPath}. ${error}`);
    }
  } else {
    throw new Error('No plan content available');
  }

  // Initialize services
  const executionManager = await getExecutionManager();
  const context7 = new Context7Service();
  const changeApplier = new ChangeApplier();

  // Detect technologies in the plan
  const detectedTechs = detectTechnologies(planContent);
  const techNames = getTechnologyNames(detectedTechs);

  console.log(`[validate-plan] Detected ${techNames.length} technologies: ${techNames.join(', ')}`);

  // Execute plan validation
  const codexResult = await executionManager.execute({
    planContent,
    projectPath,
    applyChanges: input.apply_changes,
    additionalInstructions: techNames.length > 0
      ? `Technologies detected in this plan: ${techNames.join(', ')}`
      : undefined,
  });

  // Get execution manager status
  const execStatus = executionManager.getStatus();

  // Validate against Context7 best practices
  let context7Result: Context7ValidationResult = {
    technologies_detected: techNames,
    best_practices_checked: [],
    violations: [],
  };

  if (techNames.length > 0) {
    try {
      // Extract observations from Codex output for cross-reference
      const observations = [
        ...codexResult.codeReview.best_practice_violations,
        ...codexResult.codeReview.improvements,
      ];

      context7Result = await context7.validateAgainstBestPractices(
        techNames,
        planContent,
        observations
      );
    } catch (error) {
      console.warn(`[validate-plan] Context7 validation failed: ${error}`);
      // Continue without Context7 results
    }
  }

  // Parse proposed changes for confirmation workflow
  let proposedChanges: ProposedChange[] | undefined;
  let confirmationRequired = false;
  let confirmationMessage: string | undefined;

  if (input.apply_changes && input.require_confirmation) {
    proposedChanges = changeApplier.parseProposedChanges(codexResult.rawOutput);
    const confirmation = changeApplier.createConfirmationRequest(proposedChanges);
    confirmationRequired = confirmation.requiresApproval;
    confirmationMessage = confirmation.message;
  }

  // Determine overall validation status
  const validationStatus = determineValidationStatus(codexResult, context7Result);

  // Build result
  const result: ValidationResult = {
    validation_status: validationStatus,
    execution_path: codexResult.executionPath,
    fallback_triggered: execStatus.fallbackTriggered,
    fallback_reason: execStatus.fallbackReason,
    mode: codexResult.mode,
    changes_applied: codexResult.changesApplied,
    feasibility: codexResult.feasibility,
    code_review: {
      suggestions: codexResult.codeReview.suggestions.map(s => ({
        type: s.type,
        description: s.description,
        suggestion: s.suggestion,
        severity: s.severity,
      })),
      best_practice_violations: codexResult.codeReview.best_practice_violations,
      improvements: codexResult.codeReview.improvements,
    },
    implementation_analysis: codexResult.implementationAnalysis,
    context7_validation: context7Result,
    proposed_changes: proposedChanges,
    confirmation_required: confirmationRequired,
    confirmation_message: confirmationMessage,
  };

  // Generate markdown report
  const markdown = generateMarkdownReport(result, planContent);

  return { json: result, markdown };
}

/**
 * Determine overall validation status based on results
 */
function determineValidationStatus(
  codexResult: { success: boolean; feasibility: { score: number; blockers: string[] } },
  context7Result: Context7ValidationResult
): 'pass' | 'warn' | 'fail' {
  // Fail conditions
  if (!codexResult.success) {
    return 'fail';
  }

  if (codexResult.feasibility.blockers.length > 0) {
    return 'fail';
  }

  if (codexResult.feasibility.score < 40) {
    return 'fail';
  }

  // Check for critical Context7 violations
  const criticalViolations = context7Result.violations.filter(v => v.severity === 'error');
  if (criticalViolations.length > 0) {
    return 'fail';
  }

  // Warning conditions
  if (codexResult.feasibility.score < 70) {
    return 'warn';
  }

  const warningViolations = context7Result.violations.filter(v => v.severity === 'warning');
  if (warningViolations.length > 0) {
    return 'warn';
  }

  return 'pass';
}

/**
 * Generate markdown report from validation results
 */
function generateMarkdownReport(result: ValidationResult, planContent: string): string {
  const lines: string[] = [
    '# Plan Validation Report',
    '',
    `**Status**: ${getStatusBadge(result.validation_status)}`,
    `**Execution Path**: ${result.execution_path}`,
    result.fallback_triggered ? `**Fallback**: ${result.fallback_reason}` : '',
    `**Mode**: ${result.mode}`,
    '',
  ].filter(Boolean);

  // Feasibility section
  lines.push('## Technical Feasibility');
  lines.push('');
  lines.push(`**Score**: ${result.feasibility.score}/100`);
  lines.push('');

  if (result.feasibility.blockers.length > 0) {
    lines.push('### Blockers');
    for (const blocker of result.feasibility.blockers) {
      lines.push(`- **BLOCKER**: ${blocker}`);
    }
    lines.push('');
  }

  if (result.feasibility.risks.length > 0) {
    lines.push('### Risks');
    for (const risk of result.feasibility.risks) {
      lines.push(`- ${risk}`);
    }
    lines.push('');
  }

  if (result.feasibility.dependencies_missing.length > 0) {
    lines.push('### Missing Dependencies');
    for (const dep of result.feasibility.dependencies_missing) {
      lines.push(`- ${dep}`);
    }
    lines.push('');
  }

  // Code review section
  lines.push('## Code Review');
  lines.push('');

  if (result.code_review.best_practice_violations.length > 0) {
    lines.push('### Best Practice Violations');
    for (const violation of result.code_review.best_practice_violations) {
      lines.push(`- ${violation}`);
    }
    lines.push('');
  }

  if (result.code_review.improvements.length > 0) {
    lines.push('### Suggested Improvements');
    for (const improvement of result.code_review.improvements) {
      lines.push(`- ${improvement}`);
    }
    lines.push('');
  }

  if (result.code_review.suggestions.length > 0) {
    lines.push('### Additional Suggestions');
    for (const suggestion of result.code_review.suggestions) {
      lines.push(`- [${suggestion.severity}] ${suggestion.description}`);
    }
    lines.push('');
  }

  // Implementation analysis section
  lines.push('## Implementation Analysis');
  lines.push('');
  lines.push(`**Completeness**: ${result.implementation_analysis.completeness}/100`);
  lines.push(`**Estimated Complexity**: ${result.implementation_analysis.estimated_complexity}`);
  lines.push('');

  if (result.implementation_analysis.gaps.length > 0) {
    lines.push('### Gaps');
    for (const gap of result.implementation_analysis.gaps) {
      lines.push(`- ${gap}`);
    }
    lines.push('');
  }

  // Context7 validation section
  if (result.context7_validation.technologies_detected.length > 0) {
    lines.push('## Context7 Best Practices Validation');
    lines.push('');
    lines.push(`**Technologies Detected**: ${result.context7_validation.technologies_detected.join(', ')}`);
    lines.push('');

    if (result.context7_validation.best_practices_checked.length > 0) {
      lines.push('### Best Practices Checked');
      for (const practice of result.context7_validation.best_practices_checked) {
        lines.push(`- **${practice.technology}**: ${practice.topic} (${practice.libraryId})`);
      }
      lines.push('');
    }

    if (result.context7_validation.violations.length > 0) {
      lines.push('### Violations Found');
      for (const violation of result.context7_validation.violations) {
        lines.push(`- [${violation.severity}] **${violation.technology}**: ${violation.violation}`);
        lines.push(`  - Best practice: ${violation.bestPractice}`);
      }
      lines.push('');
    }
  }

  // Changes section (for apply mode)
  if (result.changes_applied.length > 0) {
    lines.push('## Changes Applied');
    lines.push('');
    for (const change of result.changes_applied) {
      lines.push(`- ${change}`);
    }
    lines.push('');
  }

  // Confirmation section (if required)
  if (result.confirmation_required && result.confirmation_message) {
    lines.push('---');
    lines.push('');
    lines.push(result.confirmation_message);
    lines.push('');
  }

  // Footer
  lines.push('---');
  lines.push('');
  lines.push(`*Generated by Codex Validator MCP Server*`);
  lines.push(`*Execution path: ${result.execution_path}*`);

  return lines.join('\n');
}

/**
 * Get status badge for markdown
 */
function getStatusBadge(status: 'pass' | 'warn' | 'fail'): string {
  switch (status) {
    case 'pass':
      return '**PASS** - Plan is ready for implementation';
    case 'warn':
      return '**WARNING** - Plan has issues that should be addressed';
    case 'fail':
      return '**FAIL** - Plan has critical issues blocking implementation';
  }
}

/**
 * Save markdown report to file
 */
export async function saveMarkdownReport(
  markdown: string,
  outputPath: string = './validation-report.md'
): Promise<string> {
  const fullPath = path.isAbsolute(outputPath)
    ? outputPath
    : path.join(process.cwd(), outputPath);

  await fs.writeFile(fullPath, markdown, 'utf-8');
  return fullPath;
}
