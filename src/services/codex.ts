/**
 * Codex CLI Wrapper Service
 *
 * This service provides a TypeScript interface for spawning and managing
 * OpenAI Codex CLI processes with support for:
 * - Browser OAuth authentication (no API key needed for CLI)
 * - Suggest-only mode (default): Read-only sandbox, no file modifications
 * - Apply mode: Apply suggested changes with optional confirmation
 * - JSON output parsing for structured results
 * - Timeout handling
 *
 * Based on Codex CLI documentation:
 * - `codex exec` for non-interactive execution
 * - `--sandbox read-only` for suggest mode
 * - `--full-auto` for apply mode
 * - `--json` for structured output
 */

import { spawn, ChildProcess } from 'child_process';

export interface CodexExecutionOptions {
  /** Plan content to analyze */
  planContent: string;
  /** Project root directory for context */
  projectPath: string;
  /** If true, apply suggested changes instead of suggest-only */
  applyChanges?: boolean;
  /** Timeout in milliseconds (default: 5 minutes) */
  timeout?: number;
  /** Additional context or instructions for Codex */
  additionalInstructions?: string;
}

export interface CodexSuggestion {
  type: 'code_change' | 'dependency' | 'architecture' | 'security' | 'performance' | 'other';
  file?: string;
  description: string;
  suggestion: string;
  severity: 'info' | 'warning' | 'error';
}

export interface CodexFeasibility {
  score: number;
  blockers: string[];
  risks: string[];
  dependencies_missing: string[];
}

export interface CodexCodeReview {
  suggestions: CodexSuggestion[];
  best_practice_violations: string[];
  improvements: string[];
}

export interface CodexImplementationAnalysis {
  completeness: number;
  gaps: string[];
  estimated_complexity: 'low' | 'medium' | 'high';
}

export interface CodexResult {
  success: boolean;
  mode: 'suggest' | 'apply';
  executionPath: 'codex_cli' | 'openai_api';
  rawOutput: string;
  rawError: string;
  feasibility: CodexFeasibility;
  codeReview: CodexCodeReview;
  implementationAnalysis: CodexImplementationAnalysis;
  changesApplied: string[];
  error?: string;
  quotaExhausted?: boolean;
}

export interface CodexServiceOptions {
  /** Logger function */
  logger?: (message: string, level: 'info' | 'warn' | 'error' | 'debug') => void;
}

const DEFAULT_TIMEOUT = 5 * 60 * 1000; // 5 minutes

export class CodexService {
  private logger: (message: string, level: 'info' | 'warn' | 'error' | 'debug') => void;

  constructor(options: CodexServiceOptions = {}) {
    this.logger = options.logger ?? ((message, level) => {
      const prefix = `[CodexService][${level.toUpperCase()}]`;
      if (level === 'error') {
        console.error(`${prefix} ${message}`);
      } else if (level === 'warn') {
        console.warn(`${prefix} ${message}`);
      } else if (level === 'debug') {
        // Debug messages are silent by default
      } else {
        console.log(`${prefix} ${message}`);
      }
    });
  }

  /**
   * Build the prompt for Codex to analyze a plan
   */
  private buildAnalysisPrompt(planContent: string, additionalInstructions?: string): string {
    const basePrompt = `You are analyzing an implementation plan. Please provide a comprehensive validation including:

1. **Technical Feasibility Analysis**:
   - Identify any blockers that would prevent implementation
   - List missing dependencies or prerequisites
   - Highlight architectural issues or concerns
   - Rate overall feasibility from 0-100

2. **Code Review Suggestions**:
   - Review proposed code patterns
   - Identify potential improvements
   - Flag any anti-patterns or bad practices
   - Note security considerations

3. **Implementation Completeness**:
   - Identify gaps in the plan
   - List missing steps or considerations
   - Estimate implementation complexity (low/medium/high)
   - Rate completeness from 0-100

Please structure your response clearly with sections for each area above.

${additionalInstructions ? `\nAdditional context: ${additionalInstructions}\n` : ''}

**PLAN TO ANALYZE:**

${planContent}

---

Provide your analysis in a structured format with clear sections.`;

    return basePrompt;
  }

  /**
   * Parse Codex text output into structured results
   */
  public parseCodexOutput(output: string): {
    feasibility: CodexFeasibility;
    codeReview: CodexCodeReview;
    implementationAnalysis: CodexImplementationAnalysis;
    changesApplied: string[];
  } {
    const result = {
      feasibility: {
        score: 70, // Default moderate score
        blockers: [] as string[],
        risks: [] as string[],
        dependencies_missing: [] as string[],
      },
      codeReview: {
        suggestions: [] as CodexSuggestion[],
        best_practice_violations: [] as string[],
        improvements: [] as string[],
      },
      implementationAnalysis: {
        completeness: 70,
        gaps: [] as string[],
        estimated_complexity: 'medium' as 'low' | 'medium' | 'high',
      },
      changesApplied: [] as string[],
    };

    // Extract feasibility score
    const feasibilityMatch = output.match(/feasibility[:\s]*(\d+)/i);
    if (feasibilityMatch) {
      result.feasibility.score = Math.min(100, Math.max(0, parseInt(feasibilityMatch[1], 10)));
    }

    // Extract completeness score
    const completenessMatch = output.match(/completeness[:\s]*(\d+)/i);
    if (completenessMatch) {
      result.implementationAnalysis.completeness = Math.min(100, Math.max(0, parseInt(completenessMatch[1], 10)));
    }

    // Extract complexity
    const complexityMatch = output.match(/complexity[:\s]*(low|medium|high)/i);
    if (complexityMatch) {
      result.implementationAnalysis.estimated_complexity = complexityMatch[1].toLowerCase() as 'low' | 'medium' | 'high';
    }

    // Extract blockers (look for bullet points or numbered items after "blocker" keyword)
    const blockerSection = output.match(/blockers?[:\s]*\n((?:[-*\d.]\s*[^\n]+\n?)+)/i);
    if (blockerSection) {
      result.feasibility.blockers = this.extractListItems(blockerSection[1]);
    }

    // Extract risks
    const riskSection = output.match(/risks?[:\s]*\n((?:[-*\d.]\s*[^\n]+\n?)+)/i);
    if (riskSection) {
      result.feasibility.risks = this.extractListItems(riskSection[1]);
    }

    // Extract missing dependencies
    const depsSection = output.match(/(?:missing\s+)?dependenc(?:y|ies)[:\s]*\n((?:[-*\d.]\s*[^\n]+\n?)+)/i);
    if (depsSection) {
      result.feasibility.dependencies_missing = this.extractListItems(depsSection[1]);
    }

    // Extract gaps
    const gapsSection = output.match(/gaps?[:\s]*\n((?:[-*\d.]\s*[^\n]+\n?)+)/i);
    if (gapsSection) {
      result.implementationAnalysis.gaps = this.extractListItems(gapsSection[1]);
    }

    // Extract improvements
    const improvementsSection = output.match(/improvements?[:\s]*\n((?:[-*\d.]\s*[^\n]+\n?)+)/i);
    if (improvementsSection) {
      result.codeReview.improvements = this.extractListItems(improvementsSection[1]);
    }

    // Extract best practice violations
    const violationsSection = output.match(/(?:best\s+practice\s+)?violations?[:\s]*\n((?:[-*\d.]\s*[^\n]+\n?)+)/i);
    if (violationsSection) {
      result.codeReview.best_practice_violations = this.extractListItems(violationsSection[1]);
    }

    // Extract suggestions as CodexSuggestion objects
    const suggestionsSection = output.match(/suggestions?[:\s]*\n((?:[-*\d.]\s*[^\n]+\n?)+)/i);
    if (suggestionsSection) {
      const items = this.extractListItems(suggestionsSection[1]);
      result.codeReview.suggestions = items.map(item => ({
        type: 'other' as const,
        description: item,
        suggestion: item,
        severity: 'info' as const,
      }));
    }

    // Extract changes applied (for apply mode)
    const changesSection = output.match(/(?:changes?\s+applied|applied\s+changes?)[:\s]*\n((?:[-*\d.]\s*[^\n]+\n?)+)/i);
    if (changesSection) {
      result.changesApplied = this.extractListItems(changesSection[1]);
    }

    return result;
  }

  /**
   * Extract list items from a text block
   */
  private extractListItems(text: string): string[] {
    const lines = text.split('\n');
    return lines
      .map(line => line.replace(/^[-*\d.]+\s*/, '').trim())
      .filter(line => line.length > 0);
  }

  /**
   * Execute Codex CLI with the given options
   * Note: Codex CLI uses browser OAuth authentication (codex login)
   * No API key is needed - user authenticates via browser popup
   */
  public async execute(options: CodexExecutionOptions): Promise<CodexResult> {
    const {
      planContent,
      projectPath,
      applyChanges = false,
      timeout = DEFAULT_TIMEOUT,
      additionalInstructions,
    } = options;

    const prompt = this.buildAnalysisPrompt(planContent, additionalInstructions);
    const mode = applyChanges ? 'apply' : 'suggest';

    this.logger(`Executing Codex CLI in ${mode} mode`, 'info');
    this.logger(`Project path: ${projectPath}`, 'debug');

    return this.spawnCodex(prompt, projectPath, applyChanges, timeout);
  }

  /**
   * Spawn Codex CLI process
   * Uses browser OAuth authentication (no API key needed)
   */
  private async spawnCodex(
    prompt: string,
    projectPath: string,
    applyChanges: boolean,
    timeout: number
  ): Promise<CodexResult> {
    return new Promise((resolve) => {
      const mode = applyChanges ? 'apply' : 'suggest';

      // Build Codex CLI arguments based on documentation:
      // codex exec - non-interactive execution
      // --sandbox read-only - for suggest mode (no file modifications)
      // --full-auto - for apply mode (workspace-write sandbox + on-request approvals)
      // --json - structured output
      // -C path - set working directory
      const args: string[] = [
        'exec',
        '--json', // Enable JSON output for structured parsing
        '-C', projectPath, // Set working directory
      ];

      // Add mode-specific flags
      if (applyChanges) {
        // Full auto mode for applying changes
        // --full-auto sets: approvals=on-request + sandbox=workspace-write
        args.push('--full-auto');
      } else {
        // Suggest mode - read-only sandbox, never ask for approval
        args.push('--sandbox', 'read-only');
        args.push('--ask-for-approval', 'never');
      }

      // Add the prompt as the final argument
      args.push(prompt);

      this.logger(`Spawning: codex ${args.slice(0, 3).join(' ')} ... [prompt]`, 'debug');

      // Spawn process (Codex CLI uses its own OAuth credentials)
      const child: ChildProcess = spawn('codex', args, {
        cwd: projectPath,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: process.env, // Pass through environment
      });

      let stdout = '';
      let stderr = '';
      let timedOut = false;

      // Set timeout
      const timeoutId = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        setTimeout(() => child.kill('SIGKILL'), 5000);
      }, timeout);

      // Capture output
      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      // Handle process completion
      child.on('close', (code) => {
        clearTimeout(timeoutId);

        if (timedOut) {
          resolve({
            success: false,
            mode,
            executionPath: 'codex_cli',
            rawOutput: stdout,
            rawError: stderr,
            error: `Codex CLI timed out after ${timeout}ms`,
            quotaExhausted: false,
            ...this.getDefaultParsedResult(),
          });
          return;
        }

        // Check for quota/rate limit errors
        const quotaExhausted = this.isQuotaError(stderr) || this.isQuotaError(stdout);
        if (quotaExhausted) {
          this.logger('Codex CLI quota exhausted', 'warn');
          resolve({
            success: false,
            mode,
            executionPath: 'codex_cli',
            rawOutput: stdout,
            rawError: stderr,
            error: 'Codex CLI Pro quota exhausted',
            quotaExhausted: true,
            ...this.getDefaultParsedResult(),
          });
          return;
        }

        // Parse output even on non-zero exit (may have partial results)
        const parsed = this.parseCodexOutput(stdout || stderr);

        resolve({
          success: code === 0,
          mode,
          executionPath: 'codex_cli',
          rawOutput: stdout,
          rawError: stderr,
          error: code !== 0 ? `Codex CLI exited with code ${code}` : undefined,
          quotaExhausted: false,
          feasibility: parsed.feasibility,
          codeReview: parsed.codeReview,
          implementationAnalysis: parsed.implementationAnalysis,
          changesApplied: parsed.changesApplied,
        });
      });

      child.on('error', (error) => {
        clearTimeout(timeoutId);

        // Handle command not found
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          this.logger('Codex CLI not found', 'error');
          resolve({
            success: false,
            mode,
            executionPath: 'codex_cli',
            rawOutput: '',
            rawError: 'Codex CLI not found. Please install it with: npm install -g @openai/codex',
            error: 'Codex CLI not installed',
            quotaExhausted: false,
            ...this.getDefaultParsedResult(),
          });
          return;
        }

        resolve({
          success: false,
          mode,
          executionPath: 'codex_cli',
          rawOutput: '',
          rawError: error.message,
          error: error.message,
          quotaExhausted: false,
          ...this.getDefaultParsedResult(),
        });
      });
    });
  }

  /**
   * Check if error indicates quota exhaustion
   */
  private isQuotaError(text: string): boolean {
    const quotaPatterns = [
      'rate limit',
      'rate_limit',
      'quota exceeded',
      'quota_exceeded',
      'too many requests',
      'insufficient_quota',
      'exceeded your current quota',
      'rate limit reached',
      'billing',
      '429',
    ];

    const textLower = text.toLowerCase();
    return quotaPatterns.some(pattern => textLower.includes(pattern));
  }

  /**
   * Get default parsed result structure
   */
  private getDefaultParsedResult(): {
    feasibility: CodexFeasibility;
    codeReview: CodexCodeReview;
    implementationAnalysis: CodexImplementationAnalysis;
    changesApplied: string[];
  } {
    return {
      feasibility: {
        score: 50,
        blockers: [],
        risks: ['Unable to complete analysis'],
        dependencies_missing: [],
      },
      codeReview: {
        suggestions: [],
        best_practice_violations: [],
        improvements: [],
      },
      implementationAnalysis: {
        completeness: 50,
        gaps: ['Analysis incomplete'],
        estimated_complexity: 'medium',
      },
      changesApplied: [],
    };
  }

  /**
   * Check if Codex CLI is installed
   */
  public async isInstalled(): Promise<boolean> {
    return new Promise((resolve) => {
      const child = spawn('codex', ['--version'], {
        stdio: 'pipe',
      });

      child.on('close', (code) => {
        resolve(code === 0);
      });

      child.on('error', () => {
        resolve(false);
      });
    });
  }

  /**
   * Check if Codex CLI is authenticated
   * (User has run `codex login` and has valid OAuth session)
   */
  public async isAuthenticated(): Promise<boolean> {
    return new Promise((resolve) => {
      // Try a simple operation to check authentication
      // If not authenticated, Codex will prompt for login
      const child = spawn('codex', ['exec', '--help'], {
        stdio: 'pipe',
      });

      child.on('close', (code) => {
        resolve(code === 0);
      });

      child.on('error', () => {
        resolve(false);
      });
    });
  }
}

// Export singleton instance
export const codexService = new CodexService();
