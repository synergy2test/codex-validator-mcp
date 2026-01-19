/**
 * Context7 Integration Service
 *
 * This service provides integration with Context7 MCP server for:
 * - Resolving library IDs from technology names
 * - Fetching best practices documentation
 * - Cross-referencing code patterns against documented best practices
 *
 * Context7 is accessed via HTTP API at https://mcp.context7.com/mcp
 *
 * Based on Context7 documentation:
 * - resolve-library-id: Resolves a package name to a Context7-compatible library ID
 * - query-docs (get-library-docs): Retrieves documentation for a library
 */

export interface LibraryInfo {
  libraryId: string;
  name: string;
  organization?: string;
  version?: string;
}

export interface BestPractice {
  technology: string;
  libraryId: string;
  topic: string;
  content: string;
  codeExamples: string[];
}

export interface Context7ValidationResult {
  technologies_detected: string[];
  best_practices_checked: BestPractice[];
  violations: Context7Violation[];
}

export interface Context7Violation {
  technology: string;
  violation: string;
  bestPractice: string;
  severity: 'info' | 'warning' | 'error';
}

interface Context7Options {
  /** Optional API key for higher rate limits */
  apiKey?: string;
  /** Base URL for Context7 MCP server */
  baseUrl?: string;
  /** Maximum tokens to request per documentation query */
  maxTokens?: number;
  /** Logger function */
  logger?: (message: string, level: 'info' | 'warn' | 'error' | 'debug') => void;
}

export class Context7Service {
  private apiKey?: string;
  private baseUrl: string;
  private maxTokens: number;
  private logger: (message: string, level: 'info' | 'warn' | 'error' | 'debug') => void;

  constructor(options: Context7Options = {}) {
    this.apiKey = options.apiKey ?? process.env.CONTEXT7_API_KEY;
    this.baseUrl = options.baseUrl ?? 'https://mcp.context7.com/mcp';
    this.maxTokens = options.maxTokens ?? 5000;
    this.logger = options.logger ?? ((message, level) => {
      const prefix = `[Context7][${level.toUpperCase()}]`;
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
   * Resolve a technology/library name to a Context7-compatible library ID
   *
   * Context7 library IDs follow the format: /org/project or /org/project/version
   * Examples: /mongodb/docs, /vercel/next.js, /facebook/react
   */
  public async resolveLibraryId(libraryName: string, query: string): Promise<LibraryInfo | null> {
    try {
      this.logger(`Resolving library ID for: ${libraryName}`, 'debug');

      // Make MCP tool call to resolve-library-id
      const response = await this.callMcpTool('resolve-library-id', {
        libraryName,
        query,
      });

      if (response && response.libraryId) {
        const info: LibraryInfo = {
          libraryId: response.libraryId as string,
          name: libraryName,
          organization: this.extractOrg(response.libraryId as string),
          version: this.extractVersion(response.libraryId as string),
        };
        this.logger(`Resolved ${libraryName} to ${info.libraryId}`, 'info');
        return info;
      }

      // Handle array response (list of matching libraries)
      if (response && Array.isArray(response.libraries) && response.libraries.length > 0) {
        const firstMatch = response.libraries[0];
        const libraryId = firstMatch.libraryId ?? firstMatch.id ?? firstMatch;
        const info: LibraryInfo = {
          libraryId: String(libraryId),
          name: libraryName,
          organization: this.extractOrg(String(libraryId)),
          version: this.extractVersion(String(libraryId)),
        };
        this.logger(`Resolved ${libraryName} to ${info.libraryId}`, 'info');
        return info;
      }

      this.logger(`Could not resolve library ID for: ${libraryName}`, 'debug');
      return null;
    } catch (error) {
      this.logger(`Failed to resolve library ID for ${libraryName}: ${error}`, 'warn');
      return null;
    }
  }

  /**
   * Query documentation for a library with optional topic filter
   */
  public async queryDocs(libraryId: string, query: string, topic?: string): Promise<string | null> {
    try {
      this.logger(`Querying docs for ${libraryId}, topic: ${topic ?? 'general'}`, 'debug');

      // Try query-docs first (newer API), fall back to get-library-docs
      let response = await this.callMcpTool('query-docs', {
        libraryId,
        query,
        ...(topic && { topic }),
        tokens: this.maxTokens,
      });

      // If query-docs fails, try get-library-docs
      if (!response) {
        response = await this.callMcpTool('get-library-docs', {
          libraryId,
          query,
          ...(topic && { topic }),
          tokens: this.maxTokens,
        });
      }

      if (response) {
        // Handle different response formats
        if (typeof response === 'string') {
          return response;
        }
        if (response.content) {
          return String(response.content);
        }
        if (response.docs) {
          return String(response.docs);
        }
        if (response.documentation) {
          return String(response.documentation);
        }
        // Return stringified response as fallback
        return JSON.stringify(response);
      }

      return null;
    } catch (error) {
      this.logger(`Failed to query docs for ${libraryId}: ${error}`, 'warn');
      return null;
    }
  }

  /**
   * Get best practices for a list of detected technologies
   *
   * Context7 recommends max 3 calls per question for optimal performance
   */
  public async getBestPractices(technologies: string[], planContext: string): Promise<BestPractice[]> {
    const practices: BestPractice[] = [];
    const maxCalls = 3; // Context7 recommendation
    let callCount = 0;

    // Prioritize most important technologies
    const prioritizedTechs = this.prioritizeTechnologies(technologies);

    for (const tech of prioritizedTechs) {
      if (callCount >= maxCalls) {
        this.logger(`Reached max Context7 calls (${maxCalls}), using best results`, 'info');
        break;
      }

      // First resolve the library ID
      const libraryInfo = await this.resolveLibraryId(tech, planContext);
      callCount++;

      if (!libraryInfo || callCount >= maxCalls) continue;

      // Then query for best practices documentation
      const docs = await this.queryDocs(
        libraryInfo.libraryId,
        `best practices patterns ${planContext}`,
        'best-practices'
      );
      callCount++;

      if (docs) {
        practices.push({
          technology: tech,
          libraryId: libraryInfo.libraryId,
          topic: 'best-practices',
          content: docs,
          codeExamples: this.extractCodeExamples(docs),
        });
      }
    }

    return practices;
  }

  /**
   * Validate observed patterns against Context7 best practices
   */
  public async validateAgainstBestPractices(
    technologies: string[],
    planContent: string,
    codexObservations: string[]
  ): Promise<Context7ValidationResult> {
    const result: Context7ValidationResult = {
      technologies_detected: technologies,
      best_practices_checked: [],
      violations: [],
    };

    // Get best practices for detected technologies
    const bestPractices = await this.getBestPractices(technologies, planContent);
    result.best_practices_checked = bestPractices;

    // Cross-reference observations against best practices
    for (const observation of codexObservations) {
      for (const practice of bestPractices) {
        const violations = this.findViolations(observation, practice);
        result.violations.push(...violations);
      }
    }

    return result;
  }

  /**
   * Make an MCP tool call to Context7
   */
  private async callMcpTool(
    toolName: string,
    params: Record<string, unknown>
  ): Promise<Record<string, unknown> | null> {
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      if (this.apiKey) {
        headers['Authorization'] = `Bearer ${this.apiKey}`;
      }

      // Build MCP JSON-RPC request
      const request = {
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'tools/call',
        params: {
          name: toolName,
          arguments: params,
        },
      };

      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json() as {
        error?: { message?: string };
        result?: {
          content?: Array<{ type: string; text?: string }>;
          [key: string]: unknown;
        };
      };

      if (data.error) {
        throw new Error(data.error.message ?? 'Unknown MCP error');
      }

      // Extract content from MCP response
      if (data.result?.content) {
        // Handle text content
        const textContent = data.result.content.find(
          (c: { type: string }) => c.type === 'text'
        );
        if (textContent && textContent.text) {
          try {
            return JSON.parse(textContent.text) as Record<string, unknown>;
          } catch {
            return { content: textContent.text };
          }
        }
      }

      return data.result as Record<string, unknown> | null;
    } catch (error) {
      this.logger(`MCP tool call failed: ${error}`, 'error');
      return null;
    }
  }

  /**
   * Prioritize technologies for Context7 queries
   * Frameworks and core libraries get priority over utilities
   */
  private prioritizeTechnologies(technologies: string[]): string[] {
    const priorities: Record<string, number> = {
      // Frameworks (highest priority)
      'react': 10,
      'vue.js': 10,
      'angular': 10,
      'next.js': 10,
      'fastapi': 10,
      'django': 10,
      'express.js': 10,
      'nestjs': 10,
      // Languages
      'typescript': 8,
      'python': 8,
      // Databases
      'postgresql': 7,
      'mongodb': 7,
      // Libraries
      'tanstack query': 5,
      'tailwind css': 5,
      'prisma': 5,
    };

    return [...technologies].sort((a, b) => {
      const aPriority = priorities[a.toLowerCase()] ?? 0;
      const bPriority = priorities[b.toLowerCase()] ?? 0;
      return bPriority - aPriority;
    });
  }

  /**
   * Extract organization from library ID
   */
  private extractOrg(libraryId: string): string | undefined {
    // Format: /org/project or /org/project/version
    const parts = libraryId.split('/').filter(Boolean);
    return parts[0];
  }

  /**
   * Extract version from library ID
   */
  private extractVersion(libraryId: string): string | undefined {
    // Format: /org/project/version
    const parts = libraryId.split('/').filter(Boolean);
    if (parts.length >= 3 && parts[2].startsWith('v')) {
      return parts[2];
    }
    return undefined;
  }

  /**
   * Extract code examples from documentation text
   */
  private extractCodeExamples(docs: string): string[] {
    const examples: string[] = [];

    // Match code blocks (```...```)
    const codeBlockRegex = /```[\w]*\n([\s\S]*?)```/g;
    let match;

    while ((match = codeBlockRegex.exec(docs)) !== null) {
      examples.push(match[1].trim());
    }

    return examples;
  }

  /**
   * Find violations between an observation and a best practice
   */
  private findViolations(observation: string, practice: BestPractice): Context7Violation[] {
    const violations: Context7Violation[] = [];
    const obsLower = observation.toLowerCase();
    const practiceContent = practice.content.toLowerCase();

    // Check for anti-patterns mentioned in observation
    const antiPatterns = [
      { pattern: /don'?t use/i, severity: 'warning' as const },
      { pattern: /avoid/i, severity: 'warning' as const },
      { pattern: /deprecated/i, severity: 'error' as const },
      { pattern: /anti-?pattern/i, severity: 'error' as const },
      { pattern: /not recommended/i, severity: 'warning' as const },
      { pattern: /instead of/i, severity: 'info' as const },
    ];

    for (const { pattern, severity } of antiPatterns) {
      if (pattern.test(obsLower)) {
        // Check if the practice content mentions the same pattern
        const matchedPractice = this.findRelevantPractice(obsLower, practiceContent);
        if (matchedPractice) {
          violations.push({
            technology: practice.technology,
            violation: observation,
            bestPractice: matchedPractice,
            severity,
          });
        }
      }
    }

    return violations;
  }

  /**
   * Find relevant best practice content for a violation
   */
  private findRelevantPractice(observation: string, practiceContent: string): string | null {
    // Extract keywords from observation
    const keywords = observation
      .split(/\s+/)
      .filter(w => w.length > 4)
      .slice(0, 5);

    // Find sentences in practice content that match keywords
    const sentences = practiceContent.split(/[.!?]+/);

    for (const sentence of sentences) {
      const sentenceLower = sentence.toLowerCase();
      const matchCount = keywords.filter(kw => sentenceLower.includes(kw.toLowerCase())).length;

      if (matchCount >= 2) {
        return sentence.trim();
      }
    }

    return null;
  }

  /**
   * Check if Context7 service is available
   */
  public async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(this.baseUrl, {
        method: 'OPTIONS',
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}

// Export singleton instance
export const context7Service = new Context7Service();
