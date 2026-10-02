# Contributing to RingFlow

Thank you for your interest in contributing to RingFlow! This guide outlines our development workflow, coding standards, and architectural patterns to help you get started quickly.

---

## Code of Conduct

* Be respectful, inclusive, and collaborative.
* Report bugs, request features, or ask questions by opening an issue.
* Keep pull requests focused and document any changes you make.

---

## Development Workflow

We follow a typical Git branching and Pull Request workflow:

### 1. Branch Naming Conventions
Create a new branch from `main` using the appropriate prefix:
* `feature/` for new features (e.g., `feature/analytics-export`)
* `bugfix/` for bug fixes (e.g., `bugfix/moderator-redirect-loop`)
* `docs/` for documentation updates (e.g., `docs/contributing-guide`)
* `chore/` for maintenance, upgrades, or refactoring (e.g., `chore/dependency-bump`)

### 2. Pull Request Guidelines
* Keep PRs small and atomic where possible.
* Ensure all code compiles cleanly without TypeScript errors.
* Run ESLint before committing: `npm run lint`.
* Provide a clear description of the problem solved and the implementation details in your PR.

---

## Coding Standards

### TypeScript & Next.js
* Use TypeScript for all source code. Avoid using `any` type overrides.
* We use **Next.js App Router** conventions. Place pages and layout configurations under `src/app`.
* Server-side operations should be encapsulated in **Server Actions** placed within `src/actions/`.

### UI & Styling
* Use **Tailwind CSS** for layout and component styling.
* Use CSS custom properties defined in `src/app/globals.css` for design system tokens (colors, padding, fonts) to maintain visual consistency.
* Prioritize mobile-first design, especially for the **Moderator Portal** and **Public Event Dashboard**.

---

## Architectural Principles

Read [AGENTS.md](AGENTS.md) (rules and layout), [PRD.md](PRD.md) (product) and
[docs/roles/](docs/roles/README.md) (who may do what) before changing behaviour.

1. **Every exported server action authorizes itself.** It checks role, tenancy (the admin owns the
   tournament), and scope (the moderator owns the tatami). UI guards are not security.
2. **Audit official actions.** Writes that change scores, results, draws, approvals or the queue
   record who did what (see [docs/PLAN.md](docs/PLAN.md) Phase 3).
3. **Realtime:** after a write, call `broadcastLiveEvent` with ids only (never tokens or PINs).
   Screens refetch through `useLiveEvents`.
4. **Database changes:** edit `src/db/schema/index.ts`, then add an idempotent SQL file in
   `db/migrations/` (`migrationN_description.sql`). Name unique constraints the way
   drizzle-kit does (`<table>_<column>_unique`) so `npm run db:push` agrees with the SQL. If a new table must drive live screens,
   add its trigger to the `ringflow_events` NOTIFY function (see `migration8_realtime_notify.sql`).
