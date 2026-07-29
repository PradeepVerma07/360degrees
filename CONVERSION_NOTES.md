# TypeScript to JavaScript Conversion Notes

## Converted files

- `client/src/App.tsx` -> `client/src/App.jsx`
- `client/src/SupportTickets.tsx` -> `client/src/SupportTickets.jsx`
- `client/src/main.tsx` -> `client/src/main.jsx`
- `client/src/api.ts` -> `client/src/api.js`
- `client/src/tat.ts` -> `client/src/tat.js`
- `client/vite.config.ts` -> `client/vite.config.js`
- `server/src/auth.ts` -> `server/src/auth.js`
- `server/src/db.ts` -> `server/src/db.js`
- `server/src/env.ts` -> `server/src/env.js`
- `server/src/index.ts` -> `server/src/index.js`
- `server/src/tat.ts` -> `server/src/tat.js`

## Removed TypeScript-only files

- Client and server `tsconfig` files
- `client/src/types.ts`
- `client/src/vite-env.d.ts`
- TypeScript build cache files

## Package changes

- Removed TypeScript, TSX and `@types/*` packages.
- Vite now builds JavaScript/JSX directly.
- Backend development uses Node.js native watch mode.
- A JavaScript production build script copies backend source and the built frontend into `server/dist`.

## Validation performed

- Every backend and utility JavaScript file passed `node --check`.
- Every React JSX file passed JSX parser validation.
- The uploaded dependency folder contained Windows-native binaries, so it cannot execute on the Linux validation container. Run `npm install` locally to install binaries for your operating system.
