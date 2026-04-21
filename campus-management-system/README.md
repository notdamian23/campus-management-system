# CAMPUS

CAMPUS is an IoT-based fingerprint biometric management system for the Engineering Council Organization. It combines a Next.js web app, Firebase services, and portable fingerprint-device synchronization for attendance, events, payments, documents, notifications, and role-based dashboards.

## Main Modules

- Web app: `app/`, `components/`, and `lib/` contain the Next.js frontend, shared UI, and client-side Firebase helpers.
- Cloud Functions: `functions/` contains the main Firebase Functions codebase for account management, events, payments, documents, and onboarding flows.
- Portable device sync: `portable-device-functions/` contains the device-facing APIs used for pairing, enrollment sessions, and attendance synchronization.
- Security rules: `firestore.rules` and `storage.rules` define Firestore and Storage access control.
- Integration docs: `docs/` contains the current device and enrollment workflow notes.

## Basic Setup

1. Install the root app dependencies with `npm install`.
2. Create `.env.local` with the required Firebase web config values such as `NEXT_PUBLIC_FIREBASE_API_KEY`, `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`, `NEXT_PUBLIC_FIREBASE_PROJECT_ID`, `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`, `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`, and `NEXT_PUBLIC_FIREBASE_APP_ID`.
3. Install backend dependencies in `functions/` and `portable-device-functions/` with `npm install`.
4. Start local frontend development with `npm run dev:hot`.
5. Use `npm run dev` for the current production-like build-and-start workflow.

## Common Commands

- `npm run dev`: build the app, then start the standalone server.
- `npm run dev:hot`: run the Next.js development server with hot reload.
- `npm run build`: build the frontend app.
- `npm run lint`: run the current ESLint configuration.

## Notes

- This repository contains the web app and Firebase backends. The ESP32/PlatformIO firmware referenced in the docs is maintained separately and is not present in this checkout.
