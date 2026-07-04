Create one atomic commit for the completed, reviewed scope.

Before staging:

- Run `git status --short --branch`.
- Run `git diff --stat` and inspect the relevant diffs.
- Use `git status --porcelain` to identify untracked files.
- Separate intended changes from unrelated local/user work.

Staging rules:

- Stage only files that belong to the atomic change.
- Do not blindly run `git add .` or stage all untracked files.
- Do not stage generated QA screenshots, simulator screenshots, `.codex-dayframe-*.png`, secrets, real Supabase keys, session tokens, Health data payload dumps, location exports, `.env`, `.env.*`, local build output, coverage output, or generated artifacts unless the user explicitly requested them.
- Be cautious with untracked `.codex/` files; they may be local workflow artifacts.

Commit:

- Use a concise atomic message with a tag such as `feat`, `fix`, `docs`, `test`, or `chore`.
- Prefer a message that names the actual behavior or documentation repaired.
- After committing, report the commit hash and summarize exactly what was included.
