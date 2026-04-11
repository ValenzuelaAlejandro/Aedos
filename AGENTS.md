# AGENTS.md — Universal Coding Rules

Universal instructions for any AI coding agent (GitHub Copilot, Codex, Claude, Cursor, Windsurf, etc.).
This file applies to any project and any language. Project-specific rules belong in a nested `AGENTS.md`
inside the relevant subdirectory.

---

## General Mindset

- Understand before acting. Read the relevant code context before writing or modifying anything.
- Do one thing at a time. Small, atomic changes are safer, easier to review, and easier to revert.
- Prefer explicit code over clever code. Clarity beats ingenuity.
- Do not assume — verify. If requirements are ambiguous, stop and ask instead of inventing behavior.
- Do not delete code you do not understand. Add a `TODO` comment explaining the uncertainty first.
- Code that cannot be tested does not get merged.

---

## How to Identify the Type of Problem

Before touching any line of code, classify the problem:

| Category | Signals | Strategy |
|---|---|---|
| Logic bug | Wrong output, unexpected behavior, failing tests | Reproduce first, then bisect |
| State bug | Occurs intermittently, depends on operation order | Look for mutations, race conditions, side effects |
| Integration bug | Works in isolation, fails with other modules or services | Check API contracts, data formats, versions |
| Regression | Used to work, now broken | Find the commit that broke it (`git bisect`) |
| Performance issue | Slow, high memory or CPU usage | Measure first (profiler), optimize after |
| Configuration error | Fails in one environment but not another | Compare env variables, dependencies, versions |
| Technical debt | Hard to extend, confusing to read | Refactor with existing test coverage in place |
| Feature request | New functionality | Define acceptance criteria before writing code |

---

## Debugging Protocol

Follow this order every time.

### 1. Reproduce the Bug
- Document the exact steps to reproduce it.
- Determine whether it is deterministic or intermittent.
- Reduce it to the minimal reproducible case.

### 2. Form a Hypothesis
- Read the full stack trace from top to bottom.
- Identify the true origin line, not just where it explodes.
- Propose 2-3 possible causes ordered by likelihood.

### 3. Isolate the Cause
- Add targeted logs or breakpoints — not a flood of them.
- Use temporary assertions to validate assumptions.
- Test one hypothesis at a time. Never change multiple things simultaneously.
- Divide the system: does it fail in the client, server, database, or network layer?

### 4. Confirm the Root Cause
- Before fixing, verify you understand WHY it happens, not just WHERE.
- If the fix does not make logical sense to you, keep investigating.

### 5. Fix and Verify
- Write the test that would have caught the bug BEFORE writing the fix.
- Apply the minimum change necessary.
- Confirm the new test passes and existing tests do not break.
- Remove all temporary debug logs before committing.

---

## How to Search the Codebase

### Search by symptom

```bash
# Search text across files
grep -rn "text_to_find" ./src

# Search with surrounding context (3 lines before/after)
grep -rn -C 3 "suspect_function" ./src

# Search within a specific file type
grep -rn "pattern" --include="*.ts" ./src
```

### Find the origin of a bug in git

```bash
# Find who changed a line and when
git blame <file>

# Find the commit that introduced a bug
git bisect start
git bisect bad                  # current commit is broken
git bisect good <commit-hash>   # last known good commit
# Git checks out intermediate commits — mark each good or bad
git bisect good   # or: git bisect bad
git bisect reset  # finish session

# View the full history of a specific file
git log --follow -p -- <file>

# Search commits by message keyword
git log --grep="keyword"
```

### Find dependencies and usages

```bash
# See what imports a module
grep -rn "import.*ModuleName" ./src

# See all usages of a function
grep -rn "functionName(" ./src

# Inspect dependency tree (Node.js)
npm ls <package>
```

---

## How to Attack a New Problem

### Five-step process

**1. Understand the requirement**
- What is the expected behavior?
- What are the obvious edge cases?
- Does something similar already exist in the codebase?

**2. Explore before coding**
- Read the most relevant files in the affected area.
- Identify existing patterns to follow.
- Review existing tests to understand the contract.

**3. Plan the change**
- List the files that need to be modified.
- Define the order of changes, from lowest to highest impact.
- Identify which tests to add or modify.

**4. Implement incrementally**
- Make the smallest change that moves toward the solution.
- Verify it works at each step.
- Never refactor and add features in the same change.

**5. Validate completely**
- Unit tests for new logic.
- Integration tests if you touched system boundaries.
- Manual verification of the edge cases identified in step 1.

---

## Code Standards

### Naming
- Variables and functions: `camelCase` (JS/TS), `snake_case` (Python/Ruby)
- Classes and interfaces: `PascalCase`
- Constants: `UPPER_SNAKE_CASE`
- Files: `kebab-case` for components and modules
- Names must describe intent, not implementation. `getUserById`, not `fetchData`.

### Functions
- One function, one responsibility.
- Maximum 20-30 lines. If it grows beyond that, split it.
- Boolean parameters (`doThing(true, false, true)`) signal the function is doing too much.
- Prefer pure functions: same input always produces the same output, no side effects.

### Comments
- Comment the WHY, not the WHAT. The code already says what it does.
- `// TODO:` for pending work. `// FIXME:` for known bugs. `// HACK:` for temporary workarounds.
- Stale comments are worse than no comments. Keep them updated or delete them.

### Error Handling
- Never silence errors with an empty catch block. If you ignore an error, document why.
- Error messages must include enough context to reproduce the problem.
- Use specific error types, not just a generic `Error`.
- Fail fast and explicitly. A clear crash is better than silent corrupted state.

---

## Testing

### Non-negotiable rules
- Every fixed bug requires a regression test that would have caught it.
- Every new public function requires at least one test covering the happy path.
- Tests must be deterministic. They must never fail randomly.
- A test that always passes provides no value. Verify it fails when it should.

### Structure of a good test

```
Arrange -> Act -> Assert

// Arrange: set up initial state
// Act: execute the operation under test
// Assert: verify the expected result
```

### What to test
- Happy path (the normal case).
- Edge cases: null values, empty strings, empty arrays, negative numbers, zero.
- Error cases: what happens when the function receives invalid input?
- Boundary conditions: the minimum and maximum of allowed ranges.

### What NOT to test
- Internal implementation details. Test behavior, not structure.
- Third-party code: frameworks and libraries.
- Trivial getters and setters.

---

## Git Workflow

### Commit format

```
<type>(<scope>): <short description in imperative mood>

feat(auth): add OAuth2 login with Google
fix(cart): prevent duplicate items on rapid clicks
refactor(api): extract validation logic into middleware
test(user): add edge cases for email normalization
docs(readme): update setup instructions for M1 macs
chore(deps): upgrade lodash to 4.17.21
```

Types: `feat` | `fix` | `refactor` | `test` | `docs` | `chore` | `perf` | `ci`

### Commit rules
- One commit equals one logical change.
- The message describes what changes and why, not how.
- Never commit: secrets, API keys, generated files, or large binaries.
- Use `git add -p` to review each change before committing.

### Branch naming

```
feature/<description>     new functionality
fix/<description>         bug fix
refactor/<description>    refactoring with no functional changes
chore/<description>       maintenance, dependencies, config
```

### Pre-PR checklist
- [ ] Tests pass locally.
- [ ] Linter reports no errors.
- [ ] New code has tests.
- [ ] No debug `console.log` statements or temporary comments remain.
- [ ] The PR description explains the WHY of the change.

---

## Security (Universal Rules)

- Never hardcode credentials, API keys, tokens, or passwords in code.
- Use environment variables (`.env`) and add them to `.gitignore`.
- Validate and sanitize all user input before processing it.
- Use HTTPS for all production URLs.
- Do not log sensitive data: passwords, tokens, or personally identifiable information.
- Keep dependencies updated. Run audits regularly (`npm audit`, `pip audit`).
- Apply the principle of least privilege: request only the permissions you actually need.

---

## Performance

### Measure before optimizing

Never optimize without data. First establish:
- Where is the actual bottleneck?
- How much does the proposed optimization actually improve things?
- Is the added complexity worth the gain?

### Warning signs
- Nested loops over large collections (O(n^2) complexity).
- N+1 queries against the database.
- Synchronous blocking operations on the main thread.
- Uncompressed or non-lazy-loaded assets.
- Repeated calculations that could be cached.

---

## What This Agent Must Never Do

- Do not modify files outside the scope of the assigned task.
- Do not delete existing tests without explicit authorization, even if they are failing.
- Do not commit directly to `main` or `master`. Always use a branch.
- Do not refactor and fix bugs in the same commit. They are separate changes.
- Do not assume existing code is correct if it contradicts the requirements.
- Do not ignore compiler or linter warnings. Treat them as errors.
- Do not introduce new dependencies without evaluating their maintenance status, bundle size, and license.
- Do not write code that only you understand. The next developer — or you in six months — must be able to read it.

---

## Working Effectively with the Agent

### How to give the agent effective context

```
Good:
"In src/auth/login.ts, the validateToken function throws an error when
the token is expired instead of returning false. Fix it without changing
the function signature."

Bad:
"Login is broken."
```

### When the agent gets stuck
1. Ask it to explain its plan before executing.
2. If the plan does not make sense, correct it before proceeding.
3. Limit the scope: "work only in this file for now."
4. Start fresh with cleaner context if the conversation history has become noisy.