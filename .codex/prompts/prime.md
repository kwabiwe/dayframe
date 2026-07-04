---
description: Prime agent with codebase understanding
---

# Prime: Load Project Context

## Objective

Build comprehensive understanding of the codebase by analyzing structure, documentation, and key files.

## Process

### 1. Analyze Project Structure

Run:

```bash
git ls-files
```

Show directory structure:
Run `tree -L 3 -I 'node_modules|__pycache__|.git|dist|build|.next|coverage'` if available. If `tree` is unavailable, use `find . -maxdepth 3`.

### 2. Read Core Documentation

- Read `docs/PRD.md` or the current project spec file
- Read `AGENTS.md`, or the agent-specific global rules file
- Read README files at project root and major directories
- Read any architecture documentation
- Read relevant files in `.codex/reference/` only when they apply to the current task
- For Dayframe product work, treat `docs/PRD.md`, `AGENTS.md`, `docs/dayframe-regression-checklist.md`, and relevant `.codex/reference/` files as source-of-truth before implementation.
- Check whether current code or docs drift from category-first direction, focused mobile dashboard rules, Settings separation, and hosted Supabase migration requirements.
- Read database/schema configuration if present, such as Drizzle, Prisma, SQL migrations, ORM models, or schema files

### 3. Identify Key Files

Based on the structure, identify and read:
- Main entry points (main.py, index.ts, app.py, etc.)
- Core configuration files (pyproject.toml, package.json, tsconfig.json)
- Key model/schema definitions
- Important service or controller files

### 4. Understand Current State

Check recent activity:

```bash
git log -10 --oneline
```

Check current branch and status:

```bash
git status
```

## Output Report

Provide a concise summary covering:

### Project Overview
- Purpose and type of application
- Primary technologies and frameworks
- Current version/state

### Architecture
- Overall structure and organization
- Key architectural patterns identified
- Important directories and their purposes

### Tech Stack
- Languages and versions
- Frameworks and major libraries
- Build tools and package managers
- Testing frameworks

### Core Principles
- Code style and conventions observed
- Documentation standards
- Testing approach

### Current State
- Active branch
- Recent changes or development focus
- Current PRD phase or likely next feature
- Any immediate observations or concerns
- Any detected product-direction drift that should be fixed before implementation

**Make this summary easy to scan - use bullet points and clear headers.**
