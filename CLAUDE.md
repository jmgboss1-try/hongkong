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
- **Month-keyed documents.** Most data lives in one doc per month, id `YYYY-MM`, with day keys `'01'..'31'` inside: e.g. `expenses/{YYYY-MM}` → `{ '05': { hq, veg, …, deposit }, carryover }`, `revenue/{YYYY-MM}`, `workhours`/`workextra`/`workmemos/{YYYY-MM}` → `{ uid: { dd: value } }`, `payroll`, `bonuses`, `advances`, `severance`, `payrollOwner`, `fixedExpenses/{YYYY-MM}`. Config docs use fixed ids (`expenseCategories/default`, `fixedExpenses/config`, `loans/hyung`, `investment/records`). Because saves overwrite the whole month doc, re-read the doc right before writing when another screen may have changed it. The store account stays logged in on the POS all day, so store-facing pages (`RevenueInput.jsx`, `Cash.jsx`) re-check the date every minute, reload when it changes, re-read before saving, and write only today's day key with `setDoc(..., { merge: true })`.
- **Expenses are written from more than one screen.** Besides `Expenses.jsx` (지출관리), the dashboard's "못 적은 지출 입력" widget (`src/components/MissedExpenseInput.jsx`) adds amounts into the same `expenses/{YYYY-MM}` day entries using the categories from `expenseCategories/default`, and `ExpensesInput.jsx` (staff 지출입력) writes today's entry. Changes to the expense data shape or categories must keep all three in sync. The dashboard unmounts its content while loading a month, so the widget takes its initial date from the `curMonth` prop.
- **History-based settings.** Per-employee wage and schedule changes are stored as `wageHistory` / `scheduleHistory` arrays of `{ month, … }` on the `users` doc; the effective value for a month is the latest entry with `month <= curMonth`. The owner's own salary config (`payrollOwner`) follows the same carry-forward rule.
- **Roles and routing.** `src/AuthContext.jsx` loads `users/{uid}` and exposes `isOwner`, `isStore`, `isInvestor`, `isPending`, and `isLegend` (staff with 12+ months tenure, derived from `joinDate`). The owner sets each account's `role` (`staff`/`store`/`investor`) in 인원관리's edit form. Route access is enforced in `PrivateRoute` in `src/App.jsx` (`ownerOnly`, `storeOk`, `storeOnly`, `investorOk`, `legendOnly` flags); a denied route redirects to the role's own home (`homePath`), never to another role's page, and the visible menu per role is defined separately in `src/components/Layout.jsx`. Adding a page means updating both. Each account can reorder its menu ("↕️ 탭 순서 편집"); the order is saved as `menuOrder` (array of paths) on `users/{uid}`, and menus missing from a saved order are appended in default order, so new pages show up without migration. Any Firestore security rules live in the Firebase console, not this repo.
- **Photos** are compressed client-side to JPEG data URLs (`compressImage` in `src/components/PhotoAttach.jsx`) and stored inside Firestore docs, under a ~800k-char budget per doc because of Firestore's 1 MB limit. Never put photos into a doc that holds a whole list (e.g. `lossClaims/records` holds every claim): store them in their own doc and keep only a count on the record, as 손실보상 timeline photos do (`lossClaimPhotos/{eventId}`, deleted with the entry or claim). Phone→POS transfer: the POS creates a `photoInbox/{sid}` doc and shows a QR code to `/upload/:sid`, a public no-login page (`PhoneUpload.jsx`) that appends images; the POS listens with `onSnapshot`.
- **Bank statement import** (`src/components/BankImport.jsx`, the 📑 계좌내역 엑셀 tab in 지출관리) reads bank .xls/.xlsx/.csv exports with SheetJS (`xlsx`, pinned at 0.18.5 because the official SheetJS CDN is unreachable from the dev environment) and KB 국민은행 "계좌 거래내역 조회" PDFs (optionally password-protected) with `pdfjs-dist`; both are lazy-loaded. PDFs from macOS "Save as PDF" put each glyph in its own text item, so lines are rebuilt by x-gaps; the parse is checked against the PDF's 총 출금/입금금액. Columns are found by Korean header names, withdrawals are added to `expenses/{YYYY-MM}` categories. Deposits are reconciled, not added: for every day in the statement period (PDF 조회기간, else min..max date) `deposit` is set to that day's included deposit total, so re-uploads are idempotent and hand-entered 실입금액 is replaced; deposits from the 예금주 are excluded by default and per-sender exclusions are remembered as `__skip_in` rules. Imported transaction keys are saved in the same write as the amounts, as `importedKeys` on `expenses/{YYYY-MM}`, so a re-upload can't double-count; code iterating an expenses doc must only treat two-digit keys as days. Chosen categories are remembered as keyword rules in `expenseImportRules/default`, which is optional (import still works if that read/write is denied). Users can save only the rows they have categorized; the rest stay on screen. Withdrawals matching a 고정지출 item (same month, same amount, nearest due day) are linked: if that item is already marked paid in `fixedExpenses/{YYYY-MM}` the row is excluded as a duplicate, otherwise saving it also marks the item paid on the withdrawal date. This is a fourth writer of `expenses` docs.
