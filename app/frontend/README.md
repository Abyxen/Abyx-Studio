# ABYX — NOVUS Frontend Preview

This package combines the NOVUS frontend snapshot with the ABYX application project setup. NOVUS is the selected UI direction; this is a frontend preview package, not a replacement for or a claim of a fully connected backend.

## Requirements
- Node.js 20.19+ or 22.12+
- npm (included with Node.js)

## Run the frontend

1. Extract this ZIP.
2. Open the extracted `ABYX-NOVUS-Preview` folder in VS Code (or a terminal).
3. Run:

   ```bash
   npm install
   npm run dev
   ```

4. Open the local URL printed by Vite (usually http://localhost:5173).
5. Keep the terminal open while previewing. Press `Ctrl+C` to stop the server.

## Production build

```bash
npm run build
npm run preview
```

Vite writes the production frontend to `dist/`.

## What's included
- React 19 + Vite frontend source
- NOVUS UI components, themes, styles, chat renderer and utilities
- ABYX app configuration and Vite setup
- Public branding assets

## Important integration note
This archive is intended to let you inspect and test the frontend. Features that require the ABYX backend, local services, API credentials, or a running harness will only work when those services are available and correctly configured. No API keys or personal data are bundled.
