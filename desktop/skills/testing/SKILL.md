---
name: testing
description: "Write tests that catch real bugs: choosing unit, integration or end-to-end tests, Vitest/Jest for JavaScript, pytest for Python, Playwright for browser e2e, arrange-act-assert, naming, fixtures, mocking only boundaries, and running and reading failures. Use when the user asks to add tests, fix failing tests, set up a test framework or verify behavior."
---

# Testing

Test behavior the user cares about, through public interfaces, so tests survive refactors and fail
only when something is actually broken.

## 1. Which kind of test
- **Unit:** pure logic (parsers, calculations, validation, reducers). Fast, many.
- **Integration:** a route + DB, a component + its hooks, a service + real filesystem. The best value
  per test for most apps.
- **E2E (Playwright):** 3–10 critical user journeys (sign up, checkout, create item). Slow; keep few.
- Bug fix: first write a test that reproduces the bug and fails, then fix, then see it pass.

## 2. Set up the runner (use what the project already has)
- JS/TS (Vite or any modern project): Vitest. `npm i -D vitest`, script `"test": "vitest"`.
  Run once: `npx vitest run`. React components: `npm i -D @testing-library/react @testing-library/jest-dom jsdom`
  and `test: { environment: 'jsdom' }` in `vite.config.ts`.
- Existing Jest project: keep Jest (`npx jest`).
- API routes (Node): `npm i -D supertest` and call the app object without listening on a port.
- Python: `pip install pytest` (add `pytest-asyncio` for async, `httpx` for FastAPI `TestClient`).
  Run `python -m pytest -q`.
- E2E: `npm init playwright@latest`, then `npx playwright test`. Use `webServer` in
  `playwright.config.ts` to start the app automatically.

## 3. Write good tests
- Name says behavior and condition: `returns 422 when email is missing`, `test_total_applies_discount_over_100`.
- Arrange, act, assert, separated by blank lines; one behavior per test.
- Assert outcomes (returned value, HTTP response, DB row, visible text), not internal calls.
- Test the edges: empty, one, many, boundary values, invalid input, error from a dependency.
```ts
import { describe, it, expect } from 'vitest';
import { applyDiscount } from './pricing';
describe('applyDiscount', () => {
  it('takes 10% off orders over 100', () => {
    expect(applyDiscount(200)).toBe(180);
  });
  it('leaves orders of exactly 100 unchanged', () => {
    expect(applyDiscount(100)).toBe(100);
  });
});
```
```python
def test_create_user_rejects_duplicate_email(client):
    client.post("/users", json={"email": "a@b.co"})
    res = client.post("/users", json={"email": "a@b.co"})
    assert res.status_code == 409
```

## 4. Fixtures and data
- Build test data with small factory functions (`makeUser({ role: 'admin' })`) with sensible defaults.
- pytest fixtures for app client, temp DB (`tmp_path`), and cleanup; Vitest `beforeEach` for resets.
- Each test sets up its own data; tests must pass in any order and in isolation.
- Use an in-memory or temp SQLite DB, or a disposable test database; never the dev or prod DB.

## 5. Mock only boundaries
- Mock: network calls to third-party APIs, time (`vi.useFakeTimers()`, `freezegun`), randomness, email/SMS.
- Do not mock your own modules to make tests pass; that tests the mock. Prefer real DB in integration tests.
- HTTP mocking: MSW (`npm i -D msw`) for JS, `respx` for httpx or `responses` for requests in Python.

## 6. Playwright e2e
```ts
test('user can add a todo', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('New todo').fill('Buy milk');
  await page.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByRole('listitem')).toHaveText(['Buy milk']);
});
```
Select by role/label/text, not CSS classes. Use web-first assertions (auto-wait); never `waitForTimeout`.

## 7. Running and reading failures
1. Run the single failing test first (`npx vitest run path -t "name"`, `python -m pytest path::test_name -x`).
2. Read the first failure fully: expected vs received, and the top stack frame in your code.
3. Decide whether the test or the code is wrong based on the intended behavior; never weaken an assertion
   just to get green.
4. Re-run the whole suite before finishing.

## Check before you finish
1. Run the full suite and quote the summary line (e.g. `Tests 24 passed`).
2. Temporarily break the code under test: the new test must fail (proves it tests something).
3. No `.only`, `skip`, or commented-out tests left behind; no flaky sleeps.

## Common mistakes
- Snapshot tests of large output that nobody reads.
- Testing implementation details (private functions, state shape, call counts).
- Shared mutable state between tests; reliance on test order.
- Tests that hit real external APIs or depend on the current date.
