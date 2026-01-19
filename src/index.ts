#!/usr/bin/env node
/**
 * Codex Validator MCP Server
 *
 * MCP server that enables Claude Code to validate implementation plans using
 * OpenAI Codex CLI, with Context7 integration for best practices validation
 * and automatic fallback to OpenAI API when Codex Pro quota is exhausted.
 *
 * Usage:
 *   npx ts-node src/index.ts          # Development
 *   node dist/index.js                # Production
 *
 * Environment Variables:
 *   OPENAI_API_KEY     - Required for fallback when Codex CLI quota exhausted
 *   CONTEXT7_API_KEY   - Optional for higher Context7 rate limits
 *
 * Note: Codex CLI uses browser OAuth authentication (run `codex login` first)
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import {
  validatePlan,
  validatePlanSchema,
  saveMarkdownReport,
  TOOL_NAME,
  TOOL_DESCRIPTION,
} from './tools/validate-plan.js';
import { getExecutionManager, resetExecutionManager } from './services/execution-manager.js';
import { CodexService } from './services/codex.js';

// Server metadata
const SERVER_NAME = 'codex-validator';
const SERVER_VERSION = '1.0.0';

/**
 * Main entry point
 */
async function main(): Promise<void> {
  // Initialize the MCP server
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  // Register the validate_plan tool
  server.tool(
    TOOL_NAME,
    TOOL_DESCRIPTION,
    {
      plan_path: z.string().optional().describe('Path to plan file (e.g., ./PLAN.md)'),
      plan_content: z.string().optional().describe('Direct plan content as a string'),
      project_path: z.string().optional().describe('Root directory for context (defaults to cwd)'),
      apply_changes: z.boolean().optional().default(false).describe('If true, apply suggested changes instead of suggest-only mode'),
      require_confirmation: z.boolean().optional().default(true).describe('If apply_changes=true, require user confirmation before each change'),
    },
    async (params) => {
      try {
        // Validate input
        const input = validatePlanSchema.parse(params);

        // Execute validation
        const { json, markdown } = await validatePlan(input);

        // Save markdown report
        try {
          const reportPath = await saveMarkdownReport(markdown);
          console.error(`[${SERVER_NAME}] Report saved to: ${reportPath}`);
        } catch (error) {
          console.error(`[${SERVER_NAME}] Failed to save report: ${error}`);
          // Continue without saving - not a critical error
        }

        // Return both JSON and markdown
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(json, null, 2),
            },
            {
              type: 'text',
              text: `\n---\n\n${markdown}`,
            },
          ],
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`[${SERVER_NAME}] Validation error: ${errorMessage}`);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                error: errorMessage,
                validation_status: 'fail',
                execution_path: 'unknown',
                fallback_triggered: false,
                fallback_reason: null,
              }),
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Perform startup checks
  await performStartupChecks();

  // Connect to stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error(`[${SERVER_NAME}] Server started successfully`);

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.error(`[${SERVER_NAME}] Shutting down...`);
    await server.close();
    resetExecutionManager();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.error(`[${SERVER_NAME}] Shutting down...`);
    await server.close();
    resetExecutionManager();
    process.exit(0);
  });
}

/**
 * Perform startup validation checks
 */
async function performStartupChecks(): Promise<void> {
  console.error(`[${SERVER_NAME}] Performing startup checks...`);

  // Check Codex CLI installation
  const codexService = new CodexService();
  const codexInstalled = await codexService.isInstalled();

  if (codexInstalled) {
    console.error(`[${SERVER_NAME}] Codex CLI: INSTALLED`);
  } else {
    console.error(`[${SERVER_NAME}] Codex CLI: NOT INSTALLED`);
    console.error(`[${SERVER_NAME}] Install with: npm install -g @openai/codex`);
    console.error(`[${SERVER_NAME}] Then authenticate with: codex login`);
  }

  // Check OpenAI API key (for fallback)
  const hasOpenAiKey = !!process.env.OPENAI_API_KEY;
  if (hasOpenAiKey) {
    console.error(`[${SERVER_NAME}] OpenAI API Key: SET (fallback available)`);
  } else {
    console.error(`[${SERVER_NAME}] OpenAI API Key: NOT SET`);
    console.error(`[${SERVER_NAME}] Set OPENAI_API_KEY for fallback when Codex Pro quota exhausted`);
  }

  // Check Context7 API key (optional)
  const hasContext7Key = !!process.env.CONTEXT7_API_KEY;
  if (hasContext7Key) {
    console.error(`[${SERVER_NAME}] Context7 API Key: SET (higher rate limits)`);
  } else {
    console.error(`[${SERVER_NAME}] Context7 API Key: NOT SET (using free tier)`);
  }

  // Validate execution path availability
  if (!codexInstalled && !hasOpenAiKey) {
    console.error(`[${SERVER_NAME}] WARNING: No execution path available!`);
    console.error(`[${SERVER_NAME}] Either install Codex CLI or set OPENAI_API_KEY`);
  }

  // Initialize execution manager
  try {
    await getExecutionManager();
    console.error(`[${SERVER_NAME}] Execution manager: READY`);
  } catch (error) {
    console.error(`[${SERVER_NAME}] Execution manager: FAILED`);
    console.error(`[${SERVER_NAME}] Error: ${error}`);
    // Don't exit - let the server start and report errors on tool use
  }

  console.error(`[${SERVER_NAME}] Startup checks complete`);
}

// Run the server
main().catch((error) => {
  console.error(`[${SERVER_NAME}] Fatal error:`, error);
  process.exit(1);
});
