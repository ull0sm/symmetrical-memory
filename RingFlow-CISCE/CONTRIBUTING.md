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
Create a new branch from `master` using the appropriate prefix:
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

## Architectural rules

The rules every change must respect (server-side authorization, tenancy, no secrets to clients,
audit, realtime, offline-first, database changes) are in [AGENTS.md](../AGENTS.md). Read it, with
[PRD.md](PRD.md) and [docs/roles/](docs/roles/README.md), before changing behaviour.

## Before you open a pull request

- `npm run lint` and `npm test` pass.
- `npx tsc --noEmit` reports no errors.
- If you touched authorization, scoring or sessions, run the matching suite in
  [tests/http](tests/http/README.md).
- Docs that describe what you changed are updated in the same pull request (see "Keeping the docs
  current" in [AGENTS.md](../AGENTS.md)).
