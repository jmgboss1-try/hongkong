# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Store management web app for 홍콩반점 중앙대점 (a single restaurant): revenue, expenses, staff schedules, payroll, inventory, checklists, investor ledger. The UI and all user-facing text are Korean; the owner talks to Claude in Korean, so reply in Korean.

## Commands

```bash
npm run dev       # Vite dev server
npm run build     # production build to dist/ — use this to verify changes
npm run lint      # ESLint over the whole repo
npx eslint <file> # lint only the files you changed
```

There are no tests. Verify with `npm run build` plus `npx eslint` on the touched files. `npm run lint` already reports dozens of pre-existing errors (unused vars, `react-hooks/set-state-in-effect`, missing effect deps); don't treat those as caused by your change and don't mass-fix them unasked.

The app requires a Firebase login, so it can't be meaningfully exercised headless. Say so when a change is untested in the browser.

## Deployment

Vercel project `hongkong` (team `jmgboss1-5587s-projects`) deploys automatically from GitHub:
- `main` → production at https://hongkong-one.vercel.app
- any other branch → a preview URL only

Changes pushed only to a feature branch are **not** visible to the owner on the real site. When the owner wants something live, it must reach `main` (they have approved fast-forwarding the work branch into `main`). `vercel.json` rewrites all paths to `/` for client-side routing.

## Architecture

- **Stack:** React 19 + Vite, react-router-dom 7, Firebase Auth + Firestore (no backend server), recharts for charts, `qrcode` for QR generation. Plain JSX, no TypeScript, no CSS framework — styling is inline `style={{...}}` objects using a fixed dark palette (`#0b0d16` bg, `#12141f` cards, `#272a3d` borders, `#f9b934` accent, `#5e6585` muted text). Match it.
- **Firebase config** comes from `VITE_FIREBASE_*` vars in `.env` (`src/firebase.js` exports `auth` and `db`).
- **Pages hit Firestore directly.** Each page in `src/pages/` loads with `getDoc`/`getDocs` inside a `load()` function triggered by `useEffect` on the selected month, and saves by rewriting the whole document with `setDoc`. There is no shared data layer, and helpers (`pad`, `mLabel`, `daysIn`, wage/schedule lookups, default expense categories) are duplicated per file. When the same logic lives in several pages (e.g. salary calculation exists in both `Payroll.jsx` and `Dashboard.jsx`), change all copies.
- **Month-keyed documents.** Most data lives in one doc per month, id `YYYY-MM`, with day keys `'01'..'31'` inside: e.g. `expenses/{YYYY-MM}` → `{ '05': { hq, veg, …, deposit }, carryover }`, `revenue/{YYYY-MM}`, `workhours`/`workextra`/`workmemos/{YYYY-MM}` → `{ uid: { dd: value } }`, `payroll`, `bonuses`, `advances`, `severance`, `payrollOwner`, `fixedExpenses/{YYYY-MM}`. Config docs use fixed ids (`expenseCategories/default`, `fixedExpenses/config`, `loans/hyung`, `investment/records`). Because saves overwrite the whole month doc, re-read the doc right before writing when another screen may have changed it.
- **Expenses are written from more than one screen.** Besides `Expenses.jsx` (지출관리), the dashboard's "못 적은 지출 입력" widget (`src/components/MissedExpenseInput.jsx`) adds amounts into the same `expenses/{YYYY-MM}` day entries using the categories from `expenseCategories/default`, and `ExpensesInput.jsx` (staff 지출입력) writes today's entry. Changes to the expense data shape or categories must keep all three in sync. The dashboard unmounts its content while loading a month, so the widget takes its initial date from the `curMonth` prop.
- **History-based settings.** Per-employee wage and schedule changes are stored as `wageHistory` / `scheduleHistory` arrays of `{ month, … }` on the `users` doc; the effective value for a month is the latest entry with `month <= curMonth`. The owner's own salary config (`payrollOwner`) follows the same carry-forward rule.
- **Roles and routing.** `src/AuthContext.jsx` loads `users/{uid}` and exposes `isOwner`, `isStore`, `isInvestor`, `isPending`, and `isLegend` (staff with 12+ months tenure, derived from `joinDate`). Route access is enforced in `PrivateRoute` in `src/App.jsx` (`ownerOnly`, `storeOk`, `investorOk`, `legendOnly` flags), and the visible menu per role is defined separately in `src/components/Layout.jsx`. Adding a page means updating both. Any Firestore security rules live in the Firebase console, not this repo.
- **Photos** are compressed client-side to JPEG data URLs (`compressImage` in `src/components/PhotoAttach.jsx`) and stored inside Firestore docs, under a ~800k-char budget per doc because of Firestore's 1 MB limit. Phone→POS transfer: the POS creates a `photoInbox/{sid}` doc and shows a QR code to `/upload/:sid`, a public no-login page (`PhoneUpload.jsx`) that appends images; the POS listens with `onSnapshot`.
- `Expenses.jsx` calls the Anthropic API directly from the browser to extract withdrawals from bank-statement screenshots.
