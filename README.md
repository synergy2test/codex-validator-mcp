# Codex Validator MCP Server

MCP server that enables Claude Code to validate implementation plans using OpenAI Codex CLI, with Context7 integration for best practices validation and automatic fallback to OpenAI API when Codex Pro quota is exhausted.

## Features

- **Dual Execution Path**: Primary uses Codex CLI (browser OAuth), falls back to OpenAI API when Pro quota exhausted
- **Apply Mode**: Option to apply suggested changes with confirmation workflow
- **Context7 Integration**: Validates code against library/framework best practices
- **Structured Output**: Both JSON (programmatic) and Markdown (human review) formats
- **Technology Detection**: Automatically detects frameworks and libraries in plans

## Prerequisites

### Codex CLI (Primary Path)

Install the OpenAI Codex CLI:

```bash
npm install -g @openai/codex
```

Authenticate via browser OAuth:

```bash
codex login
```

This opens a browser window for you to log in to your OpenAI account. Your credentials are cached locally by the Codex CLI. No API key is needed for this path.

### OpenAI API Key (Fallback Path)

Set the `OPENAI_API_KEY` environment variable for fallback when Codex Pro quota is exhausted:

```bash
export OPENAI_API_KEY="sk-..."
```

**Note**: Using the fallback path may incur API costs.

### Context7 API Key (Optional)

For higher rate limits with Context7:

```bash
export CONTEXT7_API_KEY="your-context7-key"
```

Get a free API key at [context7.com/dashboard](https://context7.com/dashboard).

## Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/codex-validator-mcp.git
cd codex-validator-mcp

# Install dependencies
npm install

# Build TypeScript
npm run build
```

## Usage

### Running the Server

**Development:**
```bash
npm run dev
# or
node --loader ts-node/esm src/index.ts
```

**Production:**
```bash
npm run build
npm start
# or
node dist/index.js
```

### Claude Code Configuration

Add to your Claude Code settings (`.claude/settings.json` or global settings):

```json
{
  "mcpServers": {
    "codex-validator": {
      "command": "node",
      "args": ["/path/to/codex-validator-mcp/dist/index.js"],
      "env": {
        "OPENAI_API_KEY": "sk-...",
        "CONTEXT7_API_KEY": "..."
      }
    }
  }
}
```

Or using `npx`:

```json
{
  "mcpServers": {
    "codex-validator": {
      "command": "npx",
      "args": ["ts-node", "--esm", "/path/to/codex-validator-mcp/src/index.ts"],
      "env": {
        "OPENAI_API_KEY": "sk-..."
      }
    }
  }
}
```

## Tool Reference

### `validate_plan`

Validates an implementation plan using Codex with Context7 best practices integration.

#### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `plan_path` | string | Either plan_path or plan_content | - | Path to plan file (e.g., `./PLAN.md`) |
| `plan_content` | string | Either plan_path or plan_content | - | Direct plan content as a string |
| `project_path` | string | No | cwd | Root directory for context |
| `apply_changes` | boolean | No | `false` | If true, apply suggested changes |
| `require_confirmation` | boolean | No | `true` | If apply_changes=true, require user confirmation |

#### Output

**JSON Structure:**
```json
{
  "validation_status": "pass | warn | fail",
  "execution_path": "codex_cli | openai_api",
  "fallback_triggered": false,
  "fallback_reason": null,
  "mode": "suggest | apply",
  "changes_applied": [],
  "feasibility": {
    "score": 85,
    "blockers": [],
    "risks": ["Potential memory issues with large datasets"],
    "dependencies_missing": []
  },
  "code_review": {
    "suggestions": [],
    "best_practice_violations": [],
    "improvements": ["Consider adding error boundary"]
  },
  "implementation_analysis": {
    "completeness": 90,
    "gaps": [],
    "estimated_complexity": "medium"
  },
  "context7_validation": {
    "technologies_detected": ["React", "TypeScript", "FastAPI"],
    "best_practices_checked": [],
    "violations": []
  }
}
```

**Markdown Report:** Saved to `./validation-report.md`

### Example Usage

**Suggest Mode (Default):**
```
Use validate_plan with plan_path: "./PLAN.md"
```

**Apply Mode with Confirmation:**
```
Use validate_plan with plan_path: "./PLAN.md", apply_changes: true
```

**Apply Mode without Confirmation:**
```
Use validate_plan with plan_path: "./PLAN.md", apply_changes: true, require_confirmation: false
```

**Direct Content:**
```
Use validate_plan with plan_content: "## Implementation Plan\n\n1. Create React component..."
```

## Architecture

```
src/
├── index.ts                    # MCP server entry point
├── tools/
│   └── validate-plan.ts        # Main validation tool
├── services/
│   ├── codex.ts               # Codex CLI wrapper
│   ├── execution-manager.ts   # CLI/API execution with fallback
│   ├── context7.ts            # Context7 integration
│   └── change-applier.ts      # Change confirmation workflow
└── utils/
    └── tech-detector.ts       # Technology detection
```

## Execution Flow

1. **Input Validation**: Check plan_path or plan_content provided
2. **Technology Detection**: Scan plan for frameworks/libraries
3. **Codex Execution**:
   - Try Codex CLI first (uses Pro plan quota via OAuth)
   - Fall back to OpenAI API if quota exhausted
4. **Context7 Validation**: Query best practices for detected technologies
5. **Result Generation**: JSON + Markdown output
6. **Report Save**: Write `validation-report.md`

## Fallback Behavior

The server implements automatic fallback:

1. **Primary**: Codex CLI (authenticated via `codex login`)
   - Uses your OpenAI Pro plan quota
   - No API key needed
   - Full Codex capabilities

2. **Fallback**: OpenAI API (when Pro quota exhausted)
   - Requires `OPENAI_API_KEY` environment variable
   - May incur API costs
   - Replicates Codex-like analysis via chat completions

The server automatically detects quota exhaustion from Codex CLI output and switches to the API fallback transparently.

## Validation Status

- **PASS**: Plan is ready for implementation
- **WARN**: Plan has issues that should be addressed
- **FAIL**: Plan has critical issues blocking implementation

### Status Determination

- `fail`: Codex execution failed, blockers found, feasibility < 40, or critical Context7 violations
- `warn`: Feasibility 40-70 or Context7 warnings
- `pass`: Feasibility >= 70, no blockers, no critical violations

## Development

```bash
# Type check
npm run typecheck

# Build
npm run build

# Run in development
npm run dev
```

## Troubleshooting

### "Codex CLI not found"

Install the Codex CLI:
```bash
npm install -g @openai/codex
```

### "No execution path available"

Either:
1. Install and authenticate Codex CLI (`codex login`)
2. Set `OPENAI_API_KEY` for fallback

### "Quota exhausted" errors

If you see quota errors:
1. Wait for your Pro plan quota to reset
2. Or set `OPENAI_API_KEY` for automatic fallback

### Context7 not returning results

1. Check your internet connection
2. Optionally set `CONTEXT7_API_KEY` for higher rate limits
3. Context7 is optional - validation continues without it

## License

MIT
