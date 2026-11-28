# Local Setup

Install the root dependencies with `npm ci`, then install frontend dependencies from `app/frontend` if they are not already present. Start the desktop application with `npm start`.

Provider credentials belong in the application's configured credential store or user environment, never in tracked files. Select providers and models explicitly before running autonomous work. A run that cannot reach its selected provider must report `blocked` or `failed`; it must not create a simulated result.

Use `npm run validate` after changing the harness or application.
