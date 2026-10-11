# ApnaDesign

[Live demo](https://apnadesign.ajarafashion.com) · [VPS deployment notes](deploy/README.md)

[![CI and deploy](https://github.com/raju1979/apnadesign/actions/workflows/deploy.yml/badge.svg)](https://github.com/raju1979/apnadesign/actions/workflows/deploy.yml)

A collaborative browser design editor with Supabase accounts and database-enforced owner/editor/viewer access. TypeScript across React/Next.js and a Node.js WebSocket backend. React Konva renders the canvas; a Rust/WebAssembly module calculates canvas geometry.

## Setup

Requires Node.js 22+. Install dependencies with `npm install`.

1. Create your own Supabase project. Copy `.env.example` to `.env.local` and add its project URL and **publishable** key. No service-role key is required.
2. Apply the SQL files in `supabase/migrations/` to your project in filename order, using the Supabase CLI or SQL Editor. They create private projects, email memberships, owner/editor/viewer RLS policies, revocable viewer-only guest links, and a private project-scoped image bucket with a 500 KB per-image limit. Internal database names retain the original `formwork_` prefix for compatibility.
3. In Supabase Authentication URL Configuration, set the Site URL and permitted redirect URL to `http://localhost:3000` for local use. Use your HTTPS URL after deployment. Keep email confirmation enabled. Configure production SMTP before relying on delivery at scale.
4. To use name-only guest entry, enable **Anonymous Sign-Ins** in Supabase under **Authentication → Sign In / Providers**. Run `npm run dev` and open http://localhost:3000. Guests enter a display name; email/password sign-in and account creation remain available for future use. Email accounts may need confirmation before sign-in.

## Accounts and collaboration

The dashboard lists only projects you own or have been invited to. Guest access uses a Supabase anonymous account, so it still follows the same project permissions as other users. A guest's projects are tied to that anonymous browser session; signing out or clearing browser data can permanently remove access. Create a new design and open **Share** to invite a collaborator by email as a Viewer or Editor. Email invitees must sign in with the invited address; granting access does not send an email.

Owners can also create a separate **Anonymous guest link**. Anyone with that link can view the design after entering a display name; guest links are viewer-only. Creating a replacement or revoking the link immediately ends access for guests who claimed the previous link. A guest who signs out or clears browser data cannot recover that anonymous account. Room links without the guest token remain restricted to the owner and invited email accounts. Only owners can grant, change, or remove membership. Revoked access is checked before each edit and active clients are disconnected within the periodic permission check (5 seconds, plus request latency).

- **Owner:** edits and manages membership.
- **Editor:** edits the document, cannot manage access or transfer ownership.
- **Viewer:** can view, select, pan, zoom, and export; cannot change document content.
- **Uninvited / signed out:** no project data access.

Room links alone do not grant access. Auth tokens are sent as the first WebSocket message, not in URLs. The server verifies tokens with Supabase Auth and uses the user's token for database requests. Supabase row-level security protects direct database access too. Frontend controls are also disabled for viewers. Final document operations are saved to Supabase before broadcasting; drag previews are ephemeral WebSocket messages and the final position is persisted on release. The reconnect outbox retries unacknowledged edits with field-level preconditions, and undo/redo skips values that have since changed. Same-property concurrent edits use server arrival order; unrelated property patches preserve each other.

Authenticated projects are saved in Supabase. Legacy local `.data/` designs are excluded from this repository and are not automatically claimed or exposed to accounts.

Owners can use **Delete** on a project card in the dashboard. The confirmation names the project and permanently removes its document, pages, memberships, and guest sharing records. Shared projects have no delete control for collaborators. Uploaded image files remain in private Storage; automatic cleanup is not included.

## Editor features

Multiple pages with independent layers and page-scoped collaborator edits; shapes, text, images, and frames; drag, resize, rotate; fill and typography; layer names, visibility, locking and ordering; zoom and pan; duplicate/delete; conflict-aware local undo/redo; viewport PNG export; live cursors, selections, and drag previews; reconnect outbox; project-scoped private image uploads; oversized still images are converted to WebP in the browser and kept under 500 KB; frame membership, click destinations, and a click-through prototype preview.

Keyboard: V select, H pan, Space+drag or middle-mouse drag temporarily pans from any tool, F frame, R rectangle, O ellipse, T text, Delete remove, Cmd/Ctrl+D duplicate, Cmd/Ctrl+Z undo, Cmd/Ctrl+Shift+Z redo. Ctrl/Cmd+scroll zooms around the pointer. Shift+1 or the zoom percentage fits the visible artwork on the current page.

Drag a selection box from empty canvas or Shift-click layers/objects to select several items. Drag any selected object to move the whole selection. The selection toolbar provides six alignment options and edge/centre snapping with visible guides; hold Alt while dragging to bypass snapping, or turn it off with **Snap on**.

Use **Copy/Paste** or Cmd/Ctrl+C/V to copy selections between pages and projects. Pasted groups retain their children; private images can only be pasted within their original project. **Group** (Cmd/Ctrl+G) combines objects in the same frame; **Ungroup** (Cmd/Ctrl+Shift+G) releases them. Groups appear as collapsible containers in Layers and move their members together. Select a member in Layers to edit it individually. Right-click an object or selection for copy/paste, grouping, duplicate, rename, ordering, frame selection, visibility, locking, and deletion. Multi-object actions are saved and undone together.

Use the panel icons at the top-left and top-right of the canvas to hide or show Layers and Properties independently. Cmd/Ctrl+Backslash toggles both panels. The canvas expands into the freed space and keeps its current centre and zoom. On narrow screens the same buttons open one sidebar as an overlay.

Return to the dashboard with **Back to projects**, the **Workspace** breadcrumb, or the **ApnaDesign** logo in the editor header. Your account or guest session stays signed in.

## Rust / WebAssembly

The dependency-free Rust crate in `wasm/geometry` computes bounds for an entire page in a single WASM call, including rotated rectangles, frames, text, images, and centre-origin ellipses. The editor uses those bounds to fit artwork and centre each newly opened page. Hidden objects are excluded. Geometry is local to each browser and does not change collaborative document data.

The compiled WASM artifact is included in `public/wasm`, so normal Node.js setup and deployment do not require Rust. The module loads in the background with a four-second timeout. If WASM is unavailable, the file is missing, or initialization fails, the editor uses the JavaScript implementation. Streaming initialization falls back to byte initialization if the host serves an incorrect MIME type. Hash-based filenames prevent a cached binary from being mistaken for a new build; `npm run build` verifies that the shipped binary matches its manifest and Rust source.

To change and rebuild the Rust module:

```sh
rustup target add wasm32-unknown-unknown
npm run wasm:build
npm run wasm:test
npm test
```

`lib/geometry.ts` owns the small ABI adapter and releases WASM memory after every batch. To inspect the active implementation in browser developer tools, check the canvas section's `data-geometry-engine` attribute (`wasm` or `javascript`). WASM is currently a foundation for future geometry operations; a performance improvement for small designs is not claimed.

## Validation

```sh
npm exec -- next typegen
npm run typecheck
npm test
npm run build
npm start
npm run test:server
```

`npm test` runs the compiled Rust/WASM geometry against the JavaScript fallback, checks fitting large scenes, tests loader failures and memory reuse, and runs document operation tests and the SQL migrations inside a local PostgreSQL engine (PGlite), checking conflict-aware undo, editor writes, viewer write rejection, outsider isolation, owner-only sharing, ownership protection, guest-link revocation, and project-scoped image storage policies. `test:server` checks live rejection of unauthenticated edits, forged sessions, and foreign origins.

For the live authenticated multiplayer test, run `npm run test:multiplayer` with `TEST_ROOM`, `TEST_EDITOR_TOKEN`, and `TEST_VIEWER_TOKEN` set to a real project's ID and two signed-in users' access tokens. Do not commit or share tokens. Full live account creation, email confirmation, and sharing still need a browser walkthrough with your own accounts.

## Prototype boundaries

One Node process serializes room edits. Scale-out needs coordinated room ownership or a shared sync backend. Undo history is local to the current browser. Frames provide click-through navigation, and groups support collective movement; resizing or rotating a whole group, nested frames, vector paths, auto-layout, and presentation links are not included. PNG export captures the current viewport. Social login is not yet included.

For deployment, use a persistent Node host with WebSocket support and HTTPS; Vercel serverless alone cannot run this custom server. Include `public/wasm` when deploying static assets. Add per-user rate limits and production SMTP before a public launch.

## License

MIT — see [LICENSE](LICENSE).

### Geometry performance

Rust/WASM now computes individual object bounds in a single batch for box selection and snap-guide preparation. Snapping prepares a sorted anchor index once per drag and performs binary searches on pointer updates; collaborator document changes invalidate the index. JavaScript remains a fallback when WASM cannot load.

Run `npm run benchmark:geometry` to compare 1,000- and 5,000-object scenes. See [benchmark results and methodology](benchmarks/RESULTS.md). These measurements cover geometry CPU time, not whole-editor frame rates.

Double-click text on the canvas to edit it inline (double-tap on touch devices). Enter saves, Shift+Enter inserts a new line, Escape cancels, and clicking away saves. Locked and view-only text cannot be edited. If a collaborator changes the same text while you are typing, your draft stays available to copy instead of overwriting their update.
