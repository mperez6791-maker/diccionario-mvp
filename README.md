# El Diccionario (MVP) — web “Jackbox-style” (ES/EN)

This is a minimal multiplayer web version of the dictionary bluff game:
- Everyone joins from their phone (same Wi‑Fi is fine).
- Host starts and advances phases.
- Bilingual mode alternates Spanish/English each round.
- Uses **Firebase Auth (Anonymous)** + **Firestore** for real-time syncing.

## 1) Prereqs
- Install Node.js LTS (v20+ recommended).

## 2) Firebase setup (10 min)
1. Go to Firebase Console and create a project.
2. Build -> Authentication -> Sign-in method -> enable **Anonymous**.
3. Build -> Firestore Database -> create a database (production/test is fine for MVP).
4. Project settings -> Your apps -> add a **Web app** and copy the config values.

## 3) Create `.env` with your Firebase config
Create a file named `.env` in the project root:

```bash
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
```

## 4) Firestore security rules (MVP)
In Firestore -> Rules, paste this MVP rule set (NOT hardened — good for testing):
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /rooms/{roomId} {
      allow read, write: if request.auth != null;
      match /players/{playerId} {
        allow read, write: if request.auth != null;
      }
      match /rounds/{roundId} {
        allow read, write: if request.auth != null;
        match /submissions/{submissionId} {
          allow read, write: if request.auth != null;
        }
        match /votes/{voteId} {
          allow read, write: if request.auth != null;
        }
      }
    }
  }
}
```
Later we can harden this (host-only transitions, anti-cheat, etc.).

## 5) Run locally
```bash
npm install
npm run dev
```
Open the URL Vite prints (usually http://localhost:5173).

## 6) Deploy (easy path)
- Vercel (recommended): import the repo, set the same env vars, deploy.
- Or Firebase Hosting: `npm run build` then host the `dist` folder.

## Words dataset
`src/data/words_pack_core.json` includes a small original bilingual pack.
For production, we’ll generate larger packs (e.g., 1000+ entries) with original definitions.

## MVP limitations (intentional)
- Join only during lobby (simpler flow).
- Host advances phases manually.
- Anonymous auth only.
- Rules are permissive for speed.

## Next steps (if you want)
- Timers per phase (writing/voting).
- Late join / reconnect behavior.
- Anti-cheat scoring via Cloud Functions.
- Premium packs + host unlock monetization.
- Multi-pack selection + difficulty slider.
