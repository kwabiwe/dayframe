# API Guidelines

Use this when adding or changing API routes, server actions, controllers, services, or backend handlers.

## Request Handling

- Validate all external input.
- Check authentication and authorization before reading or mutating protected data.
- Return consistent error shapes.
- Keep secrets server-side.

## Data Access

- Reuse existing database clients, repositories, models, and transaction helpers.
- Prefer parameterized queries or ORM query builders.
- Make ownership checks explicit for user-owned records.

## Review Checklist

- [ ] Input validation covers required fields and edge cases.
- [ ] Auth checks happen before data access.
- [ ] Errors are useful without leaking sensitive details.
- [ ] Tests cover success, validation failure, and unauthorized access.
