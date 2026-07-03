# Initialize Project

Set up and start this project locally. This command must adapt to the actual stack in the repository rather than assuming one framework.

## 1. Inspect the Project

Identify the runtime, package manager, and framework from files such as:

- `package.json`, `pnpm-lock.yaml`, `yarn.lock`, `package-lock.json`, `bun.lockb`
- `pyproject.toml`, `requirements.txt`, `uv.lock`, `poetry.lock`
- `go.mod`, `Cargo.toml`, `Gemfile`, `composer.json`
- `docker-compose.yml`, `compose.yml`, `Dockerfile`
- framework configs such as `next.config.*`, `vite.config.*`, `astro.config.*`, `drizzle.config.*`, `prisma/schema.prisma`

## 2. Environment File

If `.env.example` exists and `.env` does not exist:

```bash
cp .env.example .env
```

Never print secrets from `.env`. If values are missing, tell the user exactly which variable names need to be filled in.

## 3. Install Dependencies

Choose the command that matches the project:

```bash
npm install        # package-lock.json
pnpm install       # pnpm-lock.yaml
yarn install       # yarn.lock
bun install        # bun.lockb
uv sync            # uv.lock / pyproject.toml
poetry install     # poetry.lock
pip install -r requirements.txt
```

## 4. Start Required Services

If the project uses Docker services, start only the required local dependencies:

```bash
docker compose up -d
```

If the project has database migrations or seed commands, run the documented commands from `package.json`, README, or framework config.

## 5. Start the Dev Server

Use the project's declared dev command, for example:

```bash
npm run dev
pnpm dev
yarn dev
bun dev
uv run uvicorn app.main:app --reload
```

Report the URL and port once the server is available.

## 6. Validate Setup

Run the smallest useful validation:

- health endpoint if one exists
- type check if available
- lint if available
- one smoke test if available
- browser load check for frontend projects

## Output

Return:

- detected stack and package manager
- commands run
- local URL
- missing environment variables
- validation results
- cleanup instructions
