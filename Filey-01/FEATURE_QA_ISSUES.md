# Feature QA issues

Date: 2026-11-04

Status: **Both reported issues fixed and re-tested.**

## Test coverage

Checks were run against an isolated temporary storage directory using Flask's
test client; the existing library data was not used or modified.

Passed:

- Startup exposes only the four built-in categories; no custom category is
  seeded.
- A linked custom library accepts `.gguf`, scans an existing file, and indexes
  it without moving the source.
- Global search finds the linked file, and search composes with category filter,
  sort, and pagination.
- Deleting a linked record first returns a confirmation response; choosing
  “Remove from Filey” removes the pointer and preserves the source file.
- Uploading into a managed category with a configured root writes the media
  there and keeps its UUID pointer under the managed storage root.
- Python compilation and JavaScript syntax checks completed successfully.

## Issues

### 1. Changing a library root immediately breaks access to existing records

**Status:** Fixed

**Priority:** High

**Area:** Safe relayout / library settings

**Reproduction:**

1. Create a linked category rooted at a directory containing `weights.gguf`.
2. Scan that category so Filey creates a UUID pointer for the file.
3. Change the category root to a different, empty directory through
   `POST /api/settings` with the updated `categories` object.
4. Observe that the request succeeds with HTTP 200 and provides no move preview
   or confirmation requirement.
5. Request the indexed file's download URL.

**Original actual:** The download returned HTTP 404 because the pointer's
relative path was resolved under the new root, while the original file remained
in the old root.

**Expected:** Root changes should first present a move preview and remain
unapplied until confirmed. After confirmation, preserve record accessibility
according to the selected library mode.

**Evidence:** The settings handler now returns a relayout preview and requires
confirmation ([`server.py`](./server.py)); `MediaLibrary` preserves linked
source roots or moves managed sources ([`backend/media.py`](./backend/media.py)).

**Fix verification:** Saving the changed root first returns HTTP 409 with a
file-count/size preview and does not change the root. Confirming the preview
moves managed files and updates their UUID pointers; linked files remain at
their original locations and stay accessible while the new root is used for
future scans. API regression checks confirmed the behavior for both modes.

### 2. Custom libraries cannot be opened or selected as a library in the UI

**Status:** Fixed

**Priority:** Medium

**Area:** Custom library navigation

**Reproduction:**

1. Create and scan a custom library, such as “AI files”.
2. Try to open that library from the navbar or select it as the current
   category.

**Original actual:** The navbar and page list contained only Home, Movies,
Music, Photos, Info, and Settings. Custom category records appeared in the
mixed Home listing and could be found through search, but could not be browsed
directly.

**Expected:** A newly created library should be available as a selectable
library view, or there should be an equivalent category filter in the UI.

**Evidence:** The navbar and page routing now follow the configured category
registry ([`static/js/app.js`](./static/js/app.js),
[`static/js/components/navbar.js`](./static/js/components/navbar.js)).

**Fix verification:** The UI now adds/removes navbar links from the live custom
category registry and routes each link to a category-filtered file listing. A
browser check confirmed that “AI files” appeared in the navbar, opened
`#ai-files`, and displayed the indexed `.gguf` record. The same browser check
confirmed that root changes present the confirmation preview before applying.
