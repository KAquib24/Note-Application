# NoteHub QA Report

**Run date:** 2026-10-24  
**Environment:** Local Vite app in the Codex in-app browser; responsive viewport override; Windows file download  
**Scope:** Behavior verified in the running app plus a production TypeScript/Vite build. This is a focused QA pass, not full coverage of every item in the supplied 126-section plan.

## Summary

| Result | Count |
|---|---:|
| Passed after fixes | 37 |
| Remaining failed tests | 0 |
| Blocked | 0 |
| Not tested | Multiple feature groups listed below |

Two P2 issues were found and fixed during the pass: a mobile note-page navigation button overlap and an oversized eager JavaScript bundle. The custom Tiptap link extension also produced a duplicate-extension warning; that warning was fixed and is absent on a clean app load.

## Executed test matrix

| ID | Feature | Test | Actual result | Status |
|---|---|---|---|---|
| T001 | Startup | Open local app on an existing note route | App rendered the note and editor | PASS |
| T002 | Build | Run TypeScript project build and Vite production build | Both completed successfully | PASS |
| T003 | Routing | Open a direct note URL and refresh | Same note and content loaded | PASS |
| T004 | Hierarchy | Create a disposable subject | Subject appeared in the tree and opened | PASS |
| T005 | Hierarchy | Create a note beneath the new subject | Note opened under the intended parent | PASS |
| T006 | Autosave | Enter text and wait for the save indicator | Status reached Saved | PASS |
| T007 | Persistence | Refresh after editing Unicode text | Text and subject/note hierarchy remained | PASS |
| T008 | Search | Search an existing note title | Matching note and hierarchy path appeared | PASS |
| T009 | Search | Search note body text containing हिन्दी, 日本語, and emoji | Matching result and relevant snippet appeared | PASS |
| T010 | Search | Open with Ctrl+Shift+K and close with Escape | Search dialog opened and closed | PASS |
| T011 | Settings | Open settings and inspect categories/theme choices | Settings and Dark/Light/System choices appeared | PASS |
| T012 | Theme | Select Light and refresh | Light remained selected | PASS |
| T013 | Theme | Select System and refresh | System resolved to the OS dark preference and remained active | PASS |
| T014 | Theme | Restore Dark and refresh | Dark mode remained active | PASS |
| T015 | Links | Press Ctrl+K inside the editor | Insert Link dialog opened; Escape cancelled it | PASS |
| T016 | Editor | Apply Bold to selected editor content | Strong formatting appeared | PASS |
| T017 | Undo/redo | Undo the Bold operation | Strong formatting was removed | PASS |
| T018 | Tables | Insert the table toolbar’s default table | A 3×3 table appeared | PASS |
| T019 | Tables | Add a row | Row count changed 3 → 4 | PASS |
| T020 | Tables | Delete the selected row | Row count changed 4 → 3 | PASS |
| T021 | Tables | Add a column | Column count changed 3 → 4 | PASS |
| T022 | Tables | Delete the selected column | Column count changed 4 → 3 | PASS |
| T023 | Persistence | Refresh after table and text edits | Text and 3×3 table remained | PASS |
| T024 | Reader | Switch to Preview with Unicode content | Reader showed the content without raw markup | PASS |
| T025 | Reader/tables | View the saved table in Preview | Reader rendered all three rows | PASS |
| T026 | Export | Export Markdown for the test note | Download contained heading and body text | PASS |
| T027 | Export | Check downloaded name/content encoding | `QA-Note-α.md` downloaded with Unicode content | PASS |
| T028 | Responsive | Check document overflow at 1920, 1440, 1024, 768, 480, 390, and 320 px | No document-level horizontal overflow at those widths | PASS |
| T029 | Mobile navigation | Open the dashboard drawer | Drawer opened | PASS |
| T030 | Mobile navigation | Open the drawer from a note page | Drawer opened without changing the note route after fix | PASS |
| T031 | Mobile navigation | Press Escape while note drawer is open | Drawer closed; note route stayed active | PASS |
| T032 | Mobile navigation | Choose the QA note from the drawer | Correct note opened and the drawer closed | PASS |
| T033 | Delete/data integrity | Delete the disposable QA subject and its one test note | Test branch disappeared; the pre-existing Web Development branch remained | PASS |
| T034 | Runtime | Load a clean tab and inspect console errors | No runtime errors on clean load | PASS |
| T035 | Tiptap links | Inspect clean-load console after link extension fix | Duplicate `link` extension warning absent | PASS |
| T036 | Lazy loading | Open existing note, load editor, open Ctrl+K dialog, switch Preview/Edit | Deferred editor and reader both loaded and switched correctly | PASS |
| T037 | Performance/build | Inspect final production chunk output | Main chunk 224.03 KB; editor 197.00 KB; reader 86.62 KB; no Vite chunk-size warning | PASS |

## Bug reports and fixes

### BUG-001 — Note-page mobile menu tapped through to Home

- **Severity:** P2 — Medium
- **Feature:** Mobile navigation
- **Status:** Fixed and retested
- **Steps to reproduce:** At a mobile width, open a note and tap its hamburger control.
- **Expected:** The navigation drawer opens while the note route remains active.
- **Actual before fix:** The control was positioned at viewport coordinates under the sticky topbar; tapping landed on the NoteHub brand and navigated Home.
- **Environment:** Local app, 390 px viewport, in-app browser.
- **Cause:** The absolutely positioned control had no positioned note-workspace ancestor.
- **Fix:** Positioned the mobile note workspace. Retest confirmed the drawer opens, Escape closes it, and the note route stays active.

### BUG-002 — Initial JavaScript bundle exceeded the build warning threshold

- **Severity:** P2 — Medium
- **Feature:** Initial loading/performance
- **Status:** Fixed; large-note performance remains unmeasured
- **Actual before fix:** Main bundle was about 724 KB minified and Vite warned that it exceeded 500 KB.
- **Fix:** Lazy-loaded the rich editor and moved editor-only Tiptap block-ID setup and URL validation imports out of the shared startup path. Final main chunk is 224.03 KB minified and the production build no longer emits the chunk warning.

### BUG-003 — Duplicate Tiptap `link` extension

- **Severity:** P2 — Medium
- **Feature:** Rich editor/link system
- **Status:** Fixed and retested
- **Actual before fix:** Browser console warned that two extensions named `link` were registered.
- **Fix:** Disabled StarterKit’s built-in link extension because the application registers its own. Ctrl+K still opens the app link dialog; the warning is absent on a clean load.

## Console and build notes

- Clean-load browser console: no runtime errors.
- React Router emits two development-only v7 future-flag warnings. They did not prevent navigation in the checks performed.
- Intermediate HMR errors occurred while modules were being split during this QA pass; a fresh app load after the changes had no runtime errors.
- Final production build succeeded without a chunk-size warning.

## Feature status

| Feature | Status | Coverage note |
|---|---|---|
| Foundation | PASS | Startup and production build verified |
| Dashboard | PARTIAL | Load and temporary subject flow verified; all dashboard actions not covered |
| Hierarchy | PARTIAL | One subject/note branch verified; deep nesting/reordering not covered |
| Editor | PARTIAL | Bold, undo, autosave, and lazy-load smoke checks only |
| Navigation | PARTIAL | Direct note routes and mobile drawer verified; heading navigation not covered |
| Important Notes | NOT TESTED | No mark/jump/remove persistence flow run |
| Tables | PARTIAL | Creation and row/column add/delete verified; advanced operations not covered |
| Links | PARTIAL | Ctrl+K dialog and extension behavior verified; link creation/targets not covered |
| Export | PARTIAL | Markdown only |
| Reader | PARTIAL | Text and table rendering smoke checks only |
| Polish | PARTIAL | Mobile drawer, search, theme, and build checks only |
| Search | PASS | Title and body search, Unicode snippet, shortcut, and Escape verified |
| Settings | PARTIAL | Appearance verified; no editor/autosave settings or shortcut customization tested |
| Accessibility | PARTIAL | Selected keyboard operations and labels checked; no full keyboard/screen-reader audit |
| Responsive | PASS | No document overflow at the seven specified widths for the tested note/editor view |
| Persistence | PARTIAL | Text, table, theme, and test hierarchy survived refresh; multi-tab/failure cases not covered |
| Performance | PARTIAL | Initial bundle warning fixed; large-document/hierarchy stress tests not run |
| Security | PARTIAL | Static review of URL validation and HTML escaping; no active XSS payload test |

## Not tested / remaining coverage

- Full CRUD/reorder/rename/delete coverage across subjects, sections, nested notes, and 5/10-level trees.
- Heading hierarchy, outline navigation/collapse, Important Notes numbering/jump/remove, text and block colors, separators, and block movement boundaries.
- Every formatting shortcut and editor operation, deep undo/redo combinations, and shortcut customization/conflict/reset.
- Table resize, merge/split, row/column spans, and formatting inside cells.
- External, internal note, section, and heading link creation/editing; deleted targets; unsafe URL interaction cases.
- HTML, TXT, PDF, JSON, tree, and complete-subject exports; export of complex content and PDF print layout.
- Reader syntax highlighting across languages, code clipboard, reader links/TOC jumps, and its full responsive flow.
- Simulated storage quota/write failure, corrupt storage, export failure, load failure, and multi-tab stale-write handling.
- Search empty/no-result/special-character extremes, keyboard arrow/Enter selection, 100+ item search performance, and section/nested result stress.
- 100+ headings/notes and the specified large-document performance scenario.
- Full keyboard-only, screen-reader, contrast, dialog focus-trap, tooltip, context-menu, and reduced-motion audit.
- Mobile create/edit/link/export workflow; Edge, Firefox, and Safari browser coverage; browser back/forward and multi-tab coverage.
- Active XSS testing and complete Unicode/special-character export coverage.

This report records the checks actually run. The application should not be considered fully QA-certified until the remaining items above are exercised.
