# Codex Validator MCP

**Validate your implementation plans before writing a single line of code.**

An MCP server that lets Claude Code delegate plan validation to OpenAI Codex, catching architectural issues, missing dependencies, and best practice violations before implementation begins.

## Why?

You've spent time crafting a detailed implementation plan. Before Claude Code executes it:

- **Catch blockers early** — Missing dependencies, incompatible versions, architectural conflicts
- **Get a second opinion** — Codex analyzes feasibility from a fresh perspective
- **Validate against best practices** — Context7 checks your approach against official documentation
- **Estimate complexity** — Know what you're getting into before committing

All without leaving your Claude Code workflow.

## Quick Start

```bash
# Clone and build
git clone https://github.com/synergy2test/codex-validator-mcp.git
cd codex-validator-mcp
npm install && npm run build

# Authenticate Codex CLI (one-time, opens browser)
npm install -g @openai/codex
codex login
```

Add to Claude Code settings (`~/.claude/settings.json`):

```json
{
  "mcpServers": {
    "codex-validator": {
      "command": "node",
      "args": ["/path/to/codex-validator-mcp/dist/index.js"]
    }
  }
}
```

That's it. Now in Claude Code:

```
Validate my PLAN.md before we implement it
```

## What You Get

```json
{
  "validation_status": "warn",
  "feasibility": {
    "score": 72,
    "blockers": [],
    "risks": ["React 18 concurrent features may conflict with existing state management"],
    "dependencies_missing": ["@tanstack/react-query"]
  },
  "code_review": {
    "suggestions": ["Consider error boundaries for async components"],
    "best_practice_violations": ["Direct DOM manipulation in useEffect"]
  },
  "implementation_analysis": {
    "completeness": 85,
    "gaps": ["No rollback strategy defined"],
    "estimated_complexity": "medium"
  }
}
```

Plus a human-readable `validation-report.md` saved to your project.

## How It Works

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────┐
│ Claude Code │────▶│ Codex Validator  │────▶│ Codex CLI   │
│             │     │    MCP Server    │     │ (your quota)│
└─────────────┘     └────────┬─────────┘     └─────────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │    Context7     │
                    │ (best practices)│
                    └─────────────────┘
```

1. Claude Code sends your plan to the MCP server
2. Server passes it to Codex CLI for analysis (uses your OpenAI Pro quota)
3. Context7 validates against framework/library best practices
4. You get structured feedback before implementation

## Automatic Fallback

When your Codex Pro quota runs out mid-month, the server automatically falls back to direct OpenAI API calls. Just set:

```bash
export OPENAI_API_KEY="sk-..."
```

You'll be notified when fallback activates (API costs may apply).

## Tool Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `plan_path` | string | — | Path to your plan file |
| `plan_content` | string | — | Or pass plan content directly |
| `project_path` | string | cwd | Project root for context |
| `apply_changes` | boolean | false | Apply suggestions (with confirmation) |

## Apply Mode

Want Codex to fix issues it finds?

```
Validate PLAN.md with apply_changes: true
```

You'll be prompted to confirm each change before it's applied.

## Optional: Context7 API Key

For higher rate limits on best practices lookups:

```bash
export CONTEXT7_API_KEY="your-key"  # Free at context7.com/dashboard
```

Works fine without it—just with lower rate limits.

## Requirements

- Node.js 18+
- [OpenAI Codex CLI](https://github.com/openai/codex) (`npm install -g @openai/codex`)
- OpenAI account with Pro plan (or API key for fallback)

## License

MIT
