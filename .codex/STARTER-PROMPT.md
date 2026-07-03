# Starter Prompt For Codex

Use this as the first message in a new app project. Fill in the bracketed sections, then paste it into Codex.

```markdown
I want to build a new application with Codex. Start by helping me shape the product, architecture, and implementation plan before writing any code.

## App Idea

[Describe the app in plain language. Brain dump is fine.]

## Core Features

- [Feature 1]
- [Feature 2]
- [Feature 3]
- [Feature 4]
- [Feature 5]

## Proposed Tech Stack

- Frontend: [e.g. Next.js, Remix, SvelteKit, native app, none]
- Backend/API: [e.g. Next.js route handlers, FastAPI, Rails, Express]
- Database: [e.g. Postgres, SQLite, Supabase, Neon, none]
- Authentication: [e.g. Clerk, Auth.js, Supabase Auth, custom, none]
- Hosting: [e.g. Vercel, Netlify, Fly.io, Render]
- Styling/UI: [e.g. Tailwind CSS, shadcn/ui, CSS modules]
- Analytics/events: [e.g. PostHog, custom database events, none]

I am open to recommendations, especially around architecture, data modeling, authentication, permissions, analytics, theming, scalability, and deployment.

## What I Want You To Do First

Before proposing a final plan:

1. Research current best practices for building this type of application.
2. Research the proposed tech stack and identify trade-offs, risks, or better alternatives.
3. Suggest a sensible architecture, including frontend structure, backend/API design, database schema, authentication flow, and deployment approach.
4. Consider edge cases, security concerns, performance, maintainability, and future monetization options.
5. Come back with a structured set of clarifying questions so we can reduce assumptions before implementation.

## First Response Format

Do not start coding yet. First, give me:

- a short summary of the product idea
- recommended architecture
- suggested tech stack
- key product decisions we need to make
- risks or unknowns
- clarifying questions, including small UX and implementation details
- proposed MVP scope
- recommended build sequence
```
