/**
 * Execution Manager Service
 *
 * Manages the dual execution path for plan validation:
 * 1. Primary: Codex CLI (uses browser OAuth, no API key needed)
 * 2. Fallback: Direct OpenAI API (uses OPENAI_API_KEY when Pro quota exhausted)
 *
 * Features:
 * - Automatic fallback when Codex CLI Pro quota is exhausted
 * - Transparent logging of execution path
 * - User notification when fallback occurs (may incur API costs)
 */

import OpenAI from 'openai';
import { CodexService, CodexResult, CodexExecutionOptions } from './codex.js';

export type ExecutionPath = 'codex_cli' | 'openai_api';

export interface ExecutionManagerStatus {
  codexCliAvailable: boolean;
  openaiApiKeySet: boolean;
  currentPath: ExecutionPath | null;
  fallbackTriggered: boolean;
  fallbackReason: string | null;
}

export interface ExecutionManagerOptions {
  /** Logger function */
  logger?: (message: string, level: 'info' | 'warn' | 'error' | 'debug') => void;
  /** OpenAI API key (defaults to OPENAI_API_KEY env var) */
  openaiApiKey?: string;
  /** Model to use for OpenAI API fallback */
  openaiModel?: string;
}

export class ExecutionManager {
  private codexService: CodexService;
  private openai: OpenAI | null = null;
  private openaiApiKey: string | undefined;
  private openaiModel: string;
  private logger: (message: string, level: 'info' | 'warn' | 'error' | 'debug') => void;
  private codexCliAvailable: boolean | null = null;
  private fallbackTriggered = false;
  private fallbackReason: string | null = null;

  constructor(options: ExecutionManagerOptions = {}) {
    this.logger = options.logger ?? ((message, level) => {
      const prefix = `[ExecutionManager][${level.toUpperCase()}]`;
      if (level === 'error') {
        console.error(`${prefix} ${message}`);
      } else if (level === 'warn') {
        console.warn(`${prefix} ${message}`);
      } else if (level === 'debug') {
        // Debug messages silent by default
      } else {
        console.log(`${prefix} ${message}`);
      }
    });

    this.openaiApiKey = options.openaiApiKey ?? process.env.OPENAI_API_KEY;
    this.openaiModel = options.openaiModel ?? 'gpt-4o';

    // Initialize services
    this.codexService = new CodexService({ logger: this.logger });

    // Initialize OpenAI client if API key is available
    if (this.openaiApiKey) {
      this.openai = new OpenAI({ apiKey: this.openaiApiKey });
      this.logger('OpenAI API fallback is available', 'info');
    } else {
      this.logger('OPENAI_API_KEY not set - fallback unavailable', 'warn');
    }
  }

  /**
   * Initialize the execution manager
   * Checks Codex CLI availability and validates configuration
   */
  public async initialize(): Promise<void> {
    // Check if Codex CLI is installed
    this.codexCliAvailable = await this.codexService.isInstalled();

    if (this.codexCliAvailable) {
      this.logger('Codex CLI is installed and available', 'info');
    } else {
      this.logger('Codex CLI not found - will use OpenAI API if available', 'warn');
    }

    // Validate that at least one execution path is available
    if (!this.codexCliAvailable && !this.openai) {
      throw new Error(
        'No execution path available. Either install Codex CLI (npm install -g @openai/codex) ' +
        'or set OPENAI_API_KEY environment variable.'
      );
    }
  }

  /**
   * Get current execution manager status
   */
  public getStatus(): ExecutionManagerStatus {
    return {
      codexCliAvailable: this.codexCliAvailable ?? false,
      openaiApiKeySet: !!this.openaiApiKey,
      currentPath: this.codexCliAvailable ? 'codex_cli' : (this.openai ? 'openai_api' : null),
      fallbackTriggered: this.fallbackTriggered,
      fallbackReason: this.fallbackReason,
    };
  }

  /**
   * Execute plan validation with automatic fallback
   *
   * Execution order:
   * 1. Try Codex CLI first (uses Pro plan quota via OAuth)
   * 2. If quota exhausted, fall back to OpenAI API
   */
  public async execute(options: CodexExecutionOptions): Promise<CodexResult> {
    // Reset fallback state for new execution
    const previousFallback = this.fallbackTriggered;

    // Try Codex CLI first if available
    if (this.codexCliAvailable) {
      this.logger('Attempting execution via Codex CLI', 'info');

      const result = await this.codexService.execute(options);

      // Check if we need to fall back
      if (result.quotaExhausted && this.openai) {
        this.logger('Codex CLI quota exhausted, falling back to OpenAI API', 'warn');
        this.logger('NOTE: OpenAI API usage may incur costs', 'warn');

        this.fallbackTriggered = true;
        this.fallbackReason = 'Codex CLI Pro quota exhausted';

        return this.executeViaOpenAI(options);
      }

      // Return CLI result (successful or not)
      return result;
    }

    // Codex CLI not available, use OpenAI API directly
    if (this.openai) {
      this.logger('Codex CLI not available, using OpenAI API', 'info');

      if (!previousFallback) {
        this.fallbackTriggered = true;
        this.fallbackReason = 'Codex CLI not installed';
      }

      return this.executeViaOpenAI(options);
    }

    // No execution path available (should not reach here after initialize())
    throw new Error('No execution path available');
  }

  /**
   * Execute plan validation via OpenAI API (fallback path)
   * Replicates Codex-like behavior using chat completions
   */
  private async executeViaOpenAI(options: CodexExecutionOptions): Promise<CodexResult> {
    const {
      planContent,
      projectPath,
      applyChanges = false,
      timeout = 5 * 60 * 1000,
      additionalInstructions,
    } = options;

    const mode = applyChanges ? 'apply' : 'suggest';

    if (!this.openai) {
      return {
        success: false,
        mode,
        executionPath: 'openai_api',
        rawOutput: '',
        rawError: 'OpenAI API not configured',
        error: 'OpenAI API not configured - set OPENAI_API_KEY environment variable',
        quotaExhausted: false,
        ...this.getDefaultParsedResult(),
      };
    }

    // Build the analysis prompt
    const systemPrompt = `You are an expert code reviewer and implementation planner. Your task is to analyze implementation plans and provide structured feedback.

You must respond in a specific format with clear sections:

1. **Technical Feasibility Analysis**
   - Feasibility Score: [0-100]
   - Blockers:
     - [List any blockers]
   - Risks:
     - [List any risks]
   - Missing Dependencies:
     - [List missing dependencies]

2. **Code Review**
   - Suggestions:
     - [List suggestions]
   - Best Practice Violations:
     - [List violations]
   - Improvements:
     - [List improvements]

3. **Implementation Analysis**
   - Completeness Score: [0-100]
   - Complexity: [low/medium/high]
   - Gaps:
     - [List gaps in the plan]

Provide thorough, actionable feedback.`;

    const userPrompt = `Please analyze the following implementation plan:

${additionalInstructions ? `Additional context: ${additionalInstructions}\n\n` : ''}
Project path: ${projectPath}
Mode: ${mode} (${applyChanges ? 'changes may be applied' : 'suggest only, no changes'})

---

PLAN TO ANALYZE:

${planContent}

---

Provide your structured analysis.`;

    try {
      // Create AbortController for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await this.openai.chat.completions.create({
        model: this.openaiModel,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: 4000,
        temperature: 0.3,
      }, {
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const content = response.choices[0]?.message?.content ?? '';

      // Parse the response using the same parser as Codex CLI
      const parsed = this.codexService.parseCodexOutput(content);

      this.logger('OpenAI API execution completed successfully', 'info');

      return {
        success: true,
        mode,
        executionPath: 'openai_api',
        rawOutput: content,
        rawError: '',
        error: undefined,
        quotaExhausted: false,
        feasibility: parsed.feasibility,
        codeReview: parsed.codeReview,
        implementationAnalysis: parsed.implementationAnalysis,
        changesApplied: [], // OpenAI API path doesn't apply changes
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Check for timeout
      if (errorMessage.includes('aborted') || errorMessage.includes('timeout')) {
        return {
          success: false,
          mode,
          executionPath: 'openai_api',
          rawOutput: '',
          rawError: 'Request timed out',
          error: `OpenAI API request timed out after ${timeout}ms`,
          quotaExhausted: false,
          ...this.getDefaultParsedResult(),
        };
      }

      // Check for quota errors
      const isQuotaError = errorMessage.toLowerCase().includes('rate limit') ||
        errorMessage.toLowerCase().includes('quota') ||
        errorMessage.includes('429');

      return {
        success: false,
        mode,
        executionPath: 'openai_api',
        rawOutput: '',
        rawError: errorMessage,
        error: errorMessage,
        quotaExhausted: isQuotaError,
        ...this.getDefaultParsedResult(),
      };
    }
  }

  /**
   * Get default parsed result structure
   */
  private getDefaultParsedResult() {
    return {
      feasibility: {
        score: 50,
        blockers: [] as string[],
        risks: ['Unable to complete analysis'] as string[],
        dependencies_missing: [] as string[],
      },
      codeReview: {
        suggestions: [],
        best_practice_violations: [] as string[],
        improvements: [] as string[],
      },
      implementationAnalysis: {
        completeness: 50,
        gaps: ['Analysis incomplete'] as string[],
        estimated_complexity: 'medium' as const,
      },
      changesApplied: [] as string[],
    };
  }

  /**
   * Check if fallback is available
   */
  public hasFallbackAvailable(): boolean {
    return !!this.openai;
  }

  /**
   * Reset fallback state (for testing or new sessions)
   */
  public resetFallbackState(): void {
    this.fallbackTriggered = false;
    this.fallbackReason = null;
  }
}

// Export singleton factory
let instance: ExecutionManager | null = null;

export async function getExecutionManager(options?: ExecutionManagerOptions): Promise<ExecutionManager> {
  if (!instance) {
    instance = new ExecutionManager(options);
    await instance.initialize();
  }
  return instance;
}

export function resetExecutionManager(): void {
  instance = null;
}
