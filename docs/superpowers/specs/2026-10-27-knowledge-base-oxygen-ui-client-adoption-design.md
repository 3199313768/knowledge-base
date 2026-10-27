# Knowledge Base Oxygen UI Client Adoption Design

## Goal

Replace the client application's duplicated base UI with the published
`@oxygen-design/ui@0.1.0` package while preserving all Supabase, Tauri, file,
search, upload, workspace, and recycle-bin behavior.

## Scope

The migration covers `apps/client` only:

- Add `@oxygen-design/ui@0.1.0` as a client dependency.
- Import the package's precompiled CSS once from the React entry point.
- Replace local button, card, badge, input, alert, dialog, page-header,
  empty-state, and status-message implementations with package components.
- Reuse package icons and `AppShell` primitives for the application shell while
  keeping the existing navigation state and service callbacks.
- Keep `PasswordInput` as a business composition component, implemented with
  package `Input`, `Button`, and eye icons.
- Keep page-specific layout CSS and business components where they express
  domain behavior rather than generic visual primitives.

The migration does not change data access, authentication contracts, service
interfaces, Supabase configuration, Tauri commands, or native iOS code.

## Compatibility Boundary

Existing local imports under `apps/client/src/components/ui` will remain as
thin re-export adapters during this migration. This keeps business components
stable while making the package the implementation source. The adapters will
not add new styling or behavior. Page code may migrate to direct package
imports when a file is already being changed for a larger layout update.

## Component Mapping

| Current surface | Oxygen UI replacement |
| --- | --- |
| Local `Button` | `Button` |
| Local `Card` | `Card`, `CardHeader`, `CardTitle`, `CardContent`, `CardFooter` |
| Local `Badge` | `Badge` |
| Local `TextInput` | `Input` |
| Manual field/error markup | `Field`, `FieldError`, `Label` |
| Manual service/error banner | `Alert`, `AlertTitle`, `AlertDescription` |
| Manual delete overlay | `AlertDialog` |
| Repeated page headings | `PageHeader` |
| Repeated empty/loading/error blocks | `EmptyState`, `StatusMessage` |
| Hand-drawn navigation icons | Curated Oxygen icon exports |
| Responsive shell layout | `AppShell` with existing navigation callbacks |

## Implementation Order

1. Add the package dependency and global stylesheet import.
2. Add failing package-adoption tests and adapter contract tests.
3. Convert local UI modules into package-backed adapters.
4. Migrate authentication and shell surfaces.
5. Migrate file, search, team, recycle-bin, upload, and inspector states.
6. Remove duplicated generic CSS while preserving page-specific layout rules.
7. Run client tests, typecheck, build, and real-browser checks at desktop and
   iPhone widths.

## Error and Loading States

Every existing loading, empty, error, retry, disabled, and permission-related
state remains visible with its current Chinese user-facing copy. Components
continue to receive safe view-model strings from the existing hooks/services;
the UI migration will not expose raw Supabase errors or stack traces.

## Testing

- Existing client unit tests remain the behavior baseline.
- New tests assert that the client entry imports the package styles and that
  local adapters render the package components without changing accessible
  names or disabled/loading behavior.
- Auth, shell navigation, delete confirmation, empty state, error state, and
  upload retry paths receive focused component coverage where their markup
  changes.
- Browser verification covers login, authenticated shell, mobile navigation,
  dialog confirmation, and at least one file/search state.

## Risks and Mitigations

- Package CSS may collide with legacy selectors: load the package stylesheet
  once and remove only generic duplicate selectors after visual verification.
- Radix overlay focus behavior can differ from the hand-written dialog: keep
  the existing accessible names and add interaction tests before removing the
  old markup.
- The app's current local React/Vite versions must stay compatible with the
  package's React peer range; verify with the existing lockfile and build.
- Dirty user changes are preserved; migration edits stay limited to client UI,
  its dependency metadata, tests, and this design documentation.

## Success Criteria

- `apps/client` uses `@oxygen-design/ui` as the implementation source for its
  generic UI primitives.
- Existing business behavior and service tests remain passing.
- Client typecheck and production build pass.
- Desktop and iPhone browser checks show no clipping, overlap, or inaccessible
  primary actions.
