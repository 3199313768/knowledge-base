# Oxygen Design System Package Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a private, publish-ready `@oxygen-design/ui` package in an independent GitHub repository with reusable React components, generic page patterns, precompiled CSS, framework-neutral tokens, Storybook, package-consumer verification, and Changesets release automation.

**Architecture:** Create a new pnpm workspace repository at `/Users/yangqian/本人代码/oxygen-design-system` with a publishable `packages/ui` library and a private `apps/storybook` application. Build the library with Vite library mode, emit declarations with `vite-plugin-dts`, keep React external, compile prefixed Tailwind CSS without Preflight, and expose components, `styles.css`, and `tokens.css` through explicit package exports.

**Tech Stack:** React, TypeScript, Vite library mode, Tailwind CSS v4, shadcn/ui source patterns, Radix Primitives, Lucide React, CVA, Vitest, Testing Library, Storybook, pnpm, Changesets, GitHub Actions, private npm Organization package.

## Global Constraints

- This plan targets a new repository, not `packages/ui` inside the knowledge-base repository.
- Do not create the GitHub repository, npm Organization, trusted publisher, token, secret, or npm release without separate explicit authorization.
- The npm Organization is `oxygen-design`, the package is `@oxygen-design/ui`, and the GitHub repository is `oxygen-design-system`.
- The development manifest starts at `0.0.0`; the initial minor changeset must produce the first release `0.1.0`. Keep `publishConfig.access = "restricted"`.
- React and React DOM are peer dependencies and must be external from the production bundle.
- Consumers must not need Tailwind CSS or `node_modules` source scanning.
- Export `@oxygen-design/ui`, `@oxygen-design/ui/styles.css`, and `@oxygen-design/ui/tokens.css`.
- Do not ship Tailwind Preflight or another global reset.
- Prefix public design variables with `--oxygen-` and generated utility classes with the Oxygen Tailwind prefix.
- Use `4 / 8 / 12 / 16 / 24 / 32px` spacing, `40px` desktop controls, `44px` coarse-pointer targets, `6px` control radii, and `8px` surface radii.
- Initial scope is light theme only; keep tokens semantic so dark mode can be added later.
- User-visible component examples support Chinese and English long text without overlap.
- Do not commit, push, publish, deploy, or expose Storybook unless the user explicitly authorizes that action.
- Each task ends with focused tests and a diff review instead of a commit step.

---

## File Map

### Repository Root

- Create `package.json`: private workspace scripts only.
- Create `pnpm-workspace.yaml`: include `apps/*` and `packages/*`.
- Create `tsconfig.base.json`: strict shared TypeScript options.
- Create `.gitignore`: ignore dependencies, builds, Storybook output, tarballs, environment files, and local npm credentials.
- Create `.npmrc`: registry policy only; never include a token value.
- Create `.changeset/config.json`: private-package versioning and changelog policy.
- Create `.github/workflows/check.yml`: PR and branch verification.
- Create `.github/workflows/release.yml`: Changesets version PR and restricted npm publication.

### UI Package

- Create `packages/ui/package.json`: public exports, peers, dependencies, build/test scripts.
- Create `packages/ui/tsconfig.json`: library compilation and JSX settings.
- Create `packages/ui/vite.config.ts`: ESM library build, CSS output, declarations, externals.
- Create `packages/ui/vitest.config.ts`: jsdom component tests.
- Create `packages/ui/scripts/copy-tokens.mjs`: copy the standalone token export after Vite empties `dist`.
- Create `packages/ui/src/styles/tokens.css`: framework-neutral Oxygen variables.
- Create `packages/ui/src/styles/index.css`: Tailwind v4 theme/utilities without Preflight and component-level CSS.
- Create `packages/ui/src/lib/cn.ts`: class merging helper.
- Create `packages/ui/src/components/*.tsx`: base and interactive components.
- Create `packages/ui/src/patterns/*.tsx`: generic page patterns.
- Create `packages/ui/src/index.ts`: complete public React export surface.
- Create `packages/ui/tests/*.test.tsx`: behavior and accessibility checks.

### Storybook And Package Verification

- Create `apps/storybook/package.json`: private Storybook application.
- Create `apps/storybook/.storybook/main.ts`: React-Vite stories and addons.
- Create `apps/storybook/.storybook/preview.tsx`: import package CSS and configure viewports/backgrounds.
- Create `apps/storybook/stories/*.stories.tsx`: component and pattern stories.
- Create `tests/consumer/package.json`: isolated React consumer fixture.
- Create `tests/consumer/src/main.tsx`: imports components and both CSS exports.
- Create `tests/consumer/vite.config.ts`: minimal production build.
- Create `scripts/verify-package.mjs`: pack, install, typecheck, and build the consumer fixture from the tarball.

---

### Task 1: Bootstrap The Independent Workspace And Package Contract

**Files:**
- Create: `/Users/yangqian/本人代码/oxygen-design-system/package.json`
- Create: `/Users/yangqian/本人代码/oxygen-design-system/pnpm-workspace.yaml`
- Create: `/Users/yangqian/本人代码/oxygen-design-system/tsconfig.base.json`
- Create: `/Users/yangqian/本人代码/oxygen-design-system/.gitignore`
- Create: `/Users/yangqian/本人代码/oxygen-design-system/.npmrc`
- Create: `/Users/yangqian/本人代码/oxygen-design-system/packages/ui/package.json`
- Create: `/Users/yangqian/本人代码/oxygen-design-system/packages/ui/tsconfig.json`
- Create: `/Users/yangqian/本人代码/oxygen-design-system/packages/ui/vite.config.ts`
- Create: `/Users/yangqian/本人代码/oxygen-design-system/packages/ui/vitest.config.ts`
- Create: `/Users/yangqian/本人代码/oxygen-design-system/packages/ui/scripts/copy-tokens.mjs`
- Create: `/Users/yangqian/本人代码/oxygen-design-system/packages/ui/src/index.ts`
- Create: `/Users/yangqian/本人代码/oxygen-design-system/packages/ui/src/styles/tokens.css`
- Create: `/Users/yangqian/本人代码/oxygen-design-system/packages/ui/src/styles/index.css`
- Test: `/Users/yangqian/本人代码/oxygen-design-system/packages/ui/tests/package-contract.test.ts`

**Interfaces:**
- Consumes: pnpm, Node.js, npm registry metadata, React peer dependency contract.
- Produces: workspace package `@oxygen-design/ui`, root scripts `test`, `typecheck`, `build`, `storybook:build`, and package exports `.`, `./styles.css`, `./tokens.css`.

- [ ] **Step 1: Resolve current official-compatible dependencies before writing manifests**

Run read-only version checks against npm and review the current official Vite, Tailwind v4, Storybook, Changesets, Radix, and npm trusted-publishing documentation. Record chosen ranges in the implementation notes; do not hard-code remembered versions.

Run:

```bash
pnpm view react version
pnpm view vite version
pnpm view tailwindcss version
pnpm view storybook version
pnpm view @changesets/cli version
```

Expected: each command returns a concrete published version. If network access is unavailable, stop dependency installation rather than guessing.

- [ ] **Step 2: Create the local repository directory only after workspace-write approval**

Create `/Users/yangqian/本人代码/oxygen-design-system` as a sibling of the knowledge-base repository. Initialize Git locally only if the user explicitly authorizes repository creation; do not create a GitHub remote in this step.

- [ ] **Step 3: Write the failing package-contract test**

Create `packages/ui/tests/package-contract.test.ts`:

```ts
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const packageRoot = process.cwd();

describe('@oxygen-design/ui package contract', () => {
  it('publishes only the ESM entry and two CSS exports', async () => {
    const manifest = JSON.parse(
      await readFile(resolve(packageRoot, 'package.json'), 'utf8')
    ) as {
      exports: Record<string, unknown>;
      name: string;
      peerDependencies: Record<string, string>;
      publishConfig: { access: string; registry: string };
      version: string;
    };

    expect(manifest.name).toBe('@oxygen-design/ui');
    expect(manifest.version).toBe('0.0.0');
    expect(Object.keys(manifest.exports)).toEqual([
      '.',
      './styles.css',
      './tokens.css'
    ]);
    expect(manifest.peerDependencies).toMatchObject({
      react: '>=18',
      'react-dom': '>=18'
    });
    expect(manifest.publishConfig).toEqual({
      access: 'restricted',
      registry: 'https://registry.npmjs.org/'
    });
  });
});
```

- [ ] **Step 4: Run the contract test and confirm it fails**

Run:

```bash
pnpm --dir packages/ui test -- package-contract.test.ts
```

Expected: FAIL because the package manifest and test configuration do not exist yet.

- [ ] **Step 5: Add workspace manifests and dependencies**

Root `package.json` must contain:

```json
{
  "name": "oxygen-design-system",
  "private": true,
  "packageManager": "pnpm@11.9.0",
  "scripts": {
    "build": "pnpm --filter @oxygen-design/ui build",
    "storybook": "pnpm --filter @oxygen-design/storybook storybook",
    "storybook:build": "pnpm --filter @oxygen-design/storybook build-storybook",
    "test": "pnpm -r --if-present test",
    "typecheck": "pnpm -r --if-present typecheck",
    "verify": "pnpm typecheck && pnpm test && pnpm build && pnpm storybook:build",
    "verify:package": "node scripts/verify-package.mjs",
    "release": "pnpm build && pnpm changeset publish"
  }
}
```

`pnpm-workspace.yaml`:

```yaml
packages:
  - apps/*
  - packages/*
```

Install only the required packages. Keep React/React DOM in UI `peerDependencies` and development dependencies; keep Radix/CVA/Lucide runtime packages in `dependencies`.

Run from the new repository root:

```bash
pnpm add -Dw typescript vite @vitejs/plugin-react vite-plugin-dts vitest jsdom @testing-library/react @testing-library/jest-dom @types/node @types/react @types/react-dom react react-dom tailwindcss @tailwindcss/vite @changesets/cli
pnpm add --filter @oxygen-design/ui class-variance-authority clsx tailwind-merge lucide-react @radix-ui/react-alert-dialog @radix-ui/react-checkbox @radix-ui/react-dialog @radix-ui/react-dropdown-menu @radix-ui/react-label @radix-ui/react-slot @radix-ui/react-tabs @radix-ui/react-tooltip
```

- [ ] **Step 6: Configure the UI package manifest and build**

Use this contract in `packages/ui/package.json`:

```json
{
  "name": "@oxygen-design/ui",
  "version": "0.0.0",
  "private": false,
  "type": "module",
  "files": ["dist"],
  "sideEffects": ["**/*.css"],
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./styles.css": "./dist/styles.css",
    "./tokens.css": "./dist/tokens.css"
  },
  "publishConfig": {
    "access": "restricted",
    "registry": "https://registry.npmjs.org/"
  },
  "peerDependencies": {
    "react": ">=18",
    "react-dom": ">=18"
  },
  "scripts": {
    "build": "vite build && node scripts/copy-tokens.mjs",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  }
}
```

Configure `vite.config.ts` with `cssFileName: 'styles'`, `formats: ['es']`, declaration generation, and these externals:

```ts
const external = ['react', 'react-dom', 'react/jsx-runtime'];
```

The `copy-tokens.mjs` script must copy exactly `src/styles/tokens.css` to `dist/tokens.css` after Vite completes.

- [ ] **Step 7: Add tokens and a no-Preflight stylesheet entry**

Start `tokens.css` with the approved contract:

```css
:root {
  --oxygen-color-background: oklch(0.97 0.004 250);
  --oxygen-color-surface: oklch(1 0 0);
  --oxygen-color-foreground: oklch(0.24 0.018 250);
  --oxygen-color-muted: oklch(0.94 0.006 250);
  --oxygen-color-muted-foreground: oklch(0.52 0.018 250);
  --oxygen-color-border: oklch(0.88 0.008 250);
  --oxygen-color-primary: oklch(0.55 0.14 250);
  --oxygen-color-primary-foreground: oklch(0.99 0 0);
  --oxygen-color-success: oklch(0.58 0.13 150);
  --oxygen-color-warning: oklch(0.7 0.14 80);
  --oxygen-color-destructive: oklch(0.58 0.2 25);
  --oxygen-radius-control: 6px;
  --oxygen-radius-surface: 8px;
  --oxygen-control-height: 40px;
  --oxygen-space-1: 4px;
  --oxygen-space-2: 8px;
  --oxygen-space-3: 12px;
  --oxygen-space-4: 16px;
  --oxygen-space-6: 24px;
  --oxygen-space-8: 32px;
}
```

`index.css` must import Tailwind theme and utilities with the Oxygen prefix and omit Tailwind base/Preflight. Import `tokens.css` so the full style entry is self-contained.

- [ ] **Step 8: Run the contract test, typecheck, build, and package inspection**

Run:

```bash
pnpm --dir packages/ui test -- package-contract.test.ts
pnpm --dir packages/ui typecheck
pnpm --dir packages/ui build
pnpm --dir packages/ui pack --pack-destination /private/tmp/oxygen-design-system-pack-check
```

Expected: PASS; `dist/index.js`, `dist/index.d.ts`, `dist/styles.css`, and `dist/tokens.css` exist; dry-run output contains only the manifest, README/license when later added, and `dist` files.

- [ ] **Step 9: Review the task diff**

Run:

```bash
git status --short
git diff --check
```

Expected: only the new repository scaffold and lockfile are present; no token, `.env`, user npm configuration, or knowledge-base file appears.

---

### Task 2: Implement Tokens, Utilities, And Static Components

**Files:**
- Create: `packages/ui/src/lib/cn.ts`
- Create: `packages/ui/src/Icons.ts`
- Create: `packages/ui/src/components/Button.tsx`
- Create: `packages/ui/src/components/Input.tsx`
- Create: `packages/ui/src/components/Label.tsx`
- Create: `packages/ui/src/components/Field.tsx`
- Create: `packages/ui/src/components/Card.tsx`
- Create: `packages/ui/src/components/Badge.tsx`
- Create: `packages/ui/src/components/Alert.tsx`
- Modify: `packages/ui/src/index.ts`
- Modify: `packages/ui/src/styles/index.css`
- Test: `packages/ui/tests/static-components.test.tsx`

**Interfaces:**
- Consumes: `cn(...inputs: ClassValue[]): string`, Oxygen tokens, React native element props, and Lucide React icon components.
- Produces: `Button`, `Input`, `Label`, `Field`, `FieldError`, `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter`, `Badge`, `Alert`, `AlertTitle`, `AlertDescription`, plus curated original Lucide exports `Check`, `ChevronDown`, `Clock3`, `Eye`, `EyeOff`, `Files`, `Menu`, `RefreshCw`, `Search`, `Settings`, `Trash2`, `Upload`, `Users`, and `X`.

- [ ] **Step 1: Write failing semantic and ref-forwarding tests**

Create focused tests that assert native props, visible labels, field error linkage, variants, and ref forwarding:

```tsx
it('links a field error to its input', () => {
  render(
    <Field>
      <Label htmlFor="email">邮箱</Label>
      <Input aria-describedby="email-error" aria-invalid id="email" />
      <FieldError id="email-error">请输入邮箱</FieldError>
    </Field>
  );

  expect(screen.getByLabelText('邮箱')).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByLabelText('邮箱')).toHaveAccessibleDescription('请输入邮箱');
});

it('forwards a button ref and supports destructive intent', () => {
  const ref = createRef<HTMLButtonElement>();
  render(<Button ref={ref} variant="destructive">永久删除</Button>);
  expect(ref.current).toBe(screen.getByRole('button', { name: '永久删除' }));
  expect(ref.current).toHaveAttribute('data-variant', 'destructive');
});
```

- [ ] **Step 2: Run the static component tests and confirm they fail**

Run:

```bash
pnpm --dir packages/ui test -- static-components.test.tsx
```

Expected: FAIL because the components are not exported.

- [ ] **Step 3: Implement the class helper and component APIs**

Use `forwardRef` for native controls. Button variants are exactly:

```ts
type ButtonVariant = 'default' | 'secondary' | 'ghost' | 'link' | 'destructive';
type ButtonSize = 'default' | 'sm' | 'icon';
```

Use shadcn-style `Slot` support through `asChild?: boolean`. Add `data-variant` and `data-size` attributes so tests and consumer overrides do not depend on internal Tailwind class strings.

`FieldError` renders only when it has children and uses `role="alert"`. `Alert` tones are `info`, `success`, `warning`, and `error`; expose tone through `data-tone`.

- [ ] **Step 4: Add the approved fixed dimensions and coarse-pointer rule**

The generated component classes must use `40px` default controls, `32px` small controls, fixed `40px` icon buttons, `6px` control radius, and `8px` surface radius. In the component layer add:

```css
@media (pointer: coarse) {
  [data-oxygen-control="true"] {
    min-height: 44px;
  }

  [data-oxygen-icon-button="true"] {
    min-height: 44px;
    min-width: 44px;
  }
}
```

- [ ] **Step 5: Export the complete static surface**

`src/Icons.ts` explicitly re-exports only `Check`, `ChevronDown`, `Clock3`, `Eye`, `EyeOff`, `Files`, `Menu`, `RefreshCw`, `Search`, `Settings`, `Trash2`, `Upload`, `Users`, and `X` from `lucide-react`. These are original icon component names, not business aliases. `src/index.ts` explicitly re-exports those icons, named components, and prop types. Do not use a wildcard export that can accidentally expose the whole dependency or internal helpers.

- [ ] **Step 6: Verify static components**

Run:

```bash
pnpm --dir packages/ui test -- static-components.test.tsx
pnpm --dir packages/ui typecheck
pnpm --dir packages/ui build
git diff --check
```

Expected: PASS; no test selects Tailwind class names; bundle still treats React as external.

---

### Task 3: Implement Radix Interactive Components

**Files:**
- Create: `packages/ui/src/components/Checkbox.tsx`
- Create: `packages/ui/src/components/AlertDialog.tsx`
- Create: `packages/ui/src/components/DropdownMenu.tsx`
- Create: `packages/ui/src/components/Tabs.tsx`
- Create: `packages/ui/src/components/Sheet.tsx`
- Create: `packages/ui/src/components/Tooltip.tsx`
- Modify: `packages/ui/src/index.ts`
- Test: `packages/ui/tests/interactive-components.test.tsx`

**Interfaces:**
- Consumes: Radix primitives, `cn`, Oxygen tokens, Lucide `Check` and `X` icons.
- Produces: shadcn-compatible named parts for Checkbox, AlertDialog, DropdownMenu, Tabs, Sheet, and Tooltip.

- [ ] **Step 1: Write failing interaction tests**

Cover actual user behavior rather than internal DOM structure:

```tsx
it('restores focus after an alert dialog closes', async () => {
  render(
    <AlertDialog>
      <AlertDialogTrigger asChild><Button>删除</Button></AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogTitle>确认删除？</AlertDialogTitle>
        <AlertDialogDescription>删除后无法恢复。</AlertDialogDescription>
        <AlertDialogCancel>取消</AlertDialogCancel>
        <AlertDialogAction>确认删除</AlertDialogAction>
      </AlertDialogContent>
    </AlertDialog>
  );

  const trigger = screen.getByRole('button', { name: '删除' });
  fireEvent.click(trigger);
  expect(screen.getByRole('alertdialog', { name: '确认删除？' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  await waitFor(() => expect(trigger).toHaveFocus());
});

it('changes tabs through their accessible triggers', () => {
  const onValueChange = vi.fn();
  render(
    <Tabs defaultValue="all" onValueChange={onValueChange}>
      <TabsList aria-label="状态筛选">
        <TabsTrigger value="all">全部</TabsTrigger>
        <TabsTrigger value="failed">失败</TabsTrigger>
      </TabsList>
      <TabsContent value="all">全部内容</TabsContent>
      <TabsContent value="failed">失败内容</TabsContent>
    </Tabs>
  );
  fireEvent.click(screen.getByRole('tab', { name: '失败' }));
  expect(onValueChange).toHaveBeenCalledWith('failed');
});
```

Also test DropdownMenu keyboard opening, Sheet title/description semantics, Checkbox checked changes, and Tooltip accessible content.

- [ ] **Step 2: Run the tests and confirm the missing exports fail**

Run:

```bash
pnpm --dir packages/ui test -- interactive-components.test.tsx
```

Expected: FAIL on missing components.

- [ ] **Step 3: Implement thin shadcn-style wrappers**

Keep Radix behavior intact. Do not add business state. Use exact public parts:

```ts
AlertDialog,
AlertDialogAction,
AlertDialogCancel,
AlertDialogContent,
AlertDialogDescription,
AlertDialogFooter,
AlertDialogHeader,
AlertDialogTitle,
AlertDialogTrigger
```

Repeat complete named-part exports for DropdownMenu, Tabs, Sheet, and Tooltip. Sheet positions are `top`, `right`, `bottom`, `left`; default to `right`.

- [ ] **Step 4: Add portal, overlay, focus, and motion styles**

Use neutral overlay colors, an `8px` content radius where the viewport edge permits it, and motion only when `prefers-reduced-motion` allows it. Sheet and dialog content must have stable max sizes and scroll overflow; close buttons are fixed `40px` squares and at least `44px` for coarse pointers.

- [ ] **Step 5: Verify interactive behavior**

Run:

```bash
pnpm --dir packages/ui test -- interactive-components.test.tsx
pnpm --dir packages/ui typecheck
pnpm --dir packages/ui build
git diff --check
```

Expected: PASS with no manual focus trap, document listener, or home-grown portal code.

---

### Task 4: Implement Generic Page Patterns

**Files:**
- Create: `packages/ui/src/patterns/PageHeader.tsx`
- Create: `packages/ui/src/patterns/EmptyState.tsx`
- Create: `packages/ui/src/patterns/StatusMessage.tsx`
- Create: `packages/ui/src/patterns/AppShell.tsx`
- Modify: `packages/ui/src/index.ts`
- Test: `packages/ui/tests/patterns.test.tsx`

**Interfaces:**
- Consumes: base components, Sheet, semantic tokens, ReactNode slots.
- Produces: `PageHeader`, `EmptyState`, `StatusMessage`, `AppShell`, and their prop types without router or business dependencies.

- [ ] **Step 1: Define the public prop contracts in failing tests**

Use these exact contracts:

```ts
interface PageHeaderProps {
  actions?: ReactNode;
  description?: ReactNode;
  title: ReactNode;
}

interface EmptyStateProps {
  action?: ReactNode;
  description: ReactNode;
  icon?: ReactNode;
  title: ReactNode;
}

interface StatusMessageProps {
  action?: ReactNode;
  children: ReactNode;
  title?: ReactNode;
  tone?: 'info' | 'success' | 'warning' | 'error';
}

interface AppShellProps {
  children: ReactNode;
  mobileNavigation: ReactNode;
  sidebar: ReactNode;
  title: string;
  topbarActions?: ReactNode;
}
```

Test long Chinese titles, absent actions, alert/status roles, and the mobile navigation trigger name `打开导航`.

- [ ] **Step 2: Run the pattern tests and confirm they fail**

Run:

```bash
pnpm --dir packages/ui test -- patterns.test.tsx
```

Expected: FAIL on missing exports.

- [ ] **Step 3: Implement slot-based patterns**

`PageHeader` must not impose a card. `EmptyState` is an unframed layout. `StatusMessage` maps `error` to `role="alert"` and other tones to `role="status"`. `AppShell` owns only the desktop/mobile layout and Sheet trigger; navigation state, routes, permissions, and account data remain consumer-owned.

- [ ] **Step 4: Add responsive constraints**

Use a `240px` desktop sidebar, flexible content track, `24px` desktop padding, `20px` tablet padding, and `16px` mobile padding. At `max-width: 820px`, hide the sidebar and show the mobile top bar. Long title/action content wraps without changing icon-button dimensions.

- [ ] **Step 5: Verify patterns**

Run:

```bash
pnpm --dir packages/ui test -- patterns.test.tsx
pnpm --dir packages/ui typecheck
pnpm --dir packages/ui build
git diff --check
```

Expected: PASS; the UI package has no dependency on react-router, Supabase, or knowledge-base types.

---

### Task 5: Build Storybook Documentation And Visual States

**Files:**
- Create: `apps/storybook/package.json`
- Create: `apps/storybook/.storybook/main.ts`
- Create: `apps/storybook/.storybook/preview.tsx`
- Create: `apps/storybook/stories/Foundations.stories.tsx`
- Create: `apps/storybook/stories/Controls.stories.tsx`
- Create: `apps/storybook/stories/Overlays.stories.tsx`
- Create: `apps/storybook/stories/Patterns.stories.tsx`

**Interfaces:**
- Consumes: `@oxygen-design/ui@workspace:*`, `styles.css`, Storybook React-Vite builder.
- Produces: local Storybook and static `storybook-static` artifact; no public deployment.

- [ ] **Step 1: Add Storybook dependencies and private workspace manifest**

Use package name `@oxygen-design/storybook`, `private: true`, and dependency `@oxygen-design/ui: workspace:*`. Install current compatible Storybook React-Vite, accessibility, docs, and Vitest addons verified in Step 1 of Task 1.

- [ ] **Step 2: Configure package CSS and viewport globals**

`preview.tsx` imports `@oxygen-design/ui/styles.css` once and registers desktop and iPhone viewports. Do not inject another CSS reset.

- [ ] **Step 3: Write stories for every public state**

Stories must include:

- Button variants, sizes, disabled, pending label, icon-only tooltip, and long text.
- Input normal, invalid, disabled, and FieldError association.
- Alert tones and Badge states.
- AlertDialog, DropdownMenu, Tabs, Sheet, Checkbox, and Tooltip interactions.
- PageHeader, EmptyState, StatusMessage, and AppShell in desktop and iPhone viewports.
- Chinese and English long-text cases.
- CSS variable override example.

- [ ] **Step 4: Add interaction assertions for the critical overlays**

Use Storybook play functions to open and close AlertDialog, open the mobile AppShell navigation, and select a tab. Assertions must use roles and names.

- [ ] **Step 5: Build Storybook**

Run:

```bash
pnpm storybook:build
```

Expected: PASS; output is local `storybook-static`; no deployment action exists.

- [ ] **Step 6: Inspect desktop and iPhone stories in a real browser**

Start Storybook and verify no blank canvas, clipped labels, overlapping actions, horizontal overflow, or undersized coarse-pointer controls. Capture evidence for the implementation report; do not treat a successful static build as visual proof.

---

### Task 6: Verify The Real Tarball In An Isolated Consumer

**Files:**
- Create: `tests/consumer/package.json`
- Create: `tests/consumer/index.html`
- Create: `tests/consumer/tsconfig.json`
- Create: `tests/consumer/vite.config.ts`
- Create: `tests/consumer/src/main.tsx`
- Create: `scripts/verify-package.mjs`
- Modify: root `package.json`

**Interfaces:**
- Consumes: packed `@oxygen-design/ui` tarball, public exports only.
- Produces: repeatable `pnpm verify:package` proof that types, JS, styles, tokens, peers, and production build work without workspace links.

- [ ] **Step 1: Create a consumer that fails without the packed dependency**

`tests/consumer/src/main.tsx` must import only public APIs:

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { Button, EmptyState, PageHeader } from '@oxygen-design/ui';
import '@oxygen-design/ui/styles.css';
import '@oxygen-design/ui/tokens.css';

function App() {
  return (
    <main>
      <PageHeader title="消费验证" actions={<Button>新建</Button>} />
      <EmptyState title="暂无内容" description="安装包可正常渲染。" />
    </main>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
```

- [ ] **Step 2: Confirm the isolated build fails before package installation**

Run:

```bash
pnpm --dir tests/consumer build
```

Expected: FAIL because `@oxygen-design/ui` is not installed in the isolated fixture.

- [ ] **Step 3: Implement the tarball verifier**

`scripts/verify-package.mjs` must:

1. Build `packages/ui`.
2. Create a temporary directory with `mkdtemp`.
3. Run `pnpm pack --pack-destination <temp>` in `packages/ui`.
4. Copy the consumer fixture into the temporary directory.
5. Install React, React DOM, Vite, TypeScript, and the generated tarball in that temporary consumer.
6. Run `tsc --noEmit` and `vite build` there.
7. Read the tarball file list and reject `.env`, `.npmrc`, token-like filenames, tests, Storybook output, and absolute local paths.
8. Remove only the generated temporary directory in a `finally` block.

Use `spawnSync` with argument arrays and `stdio: 'inherit'`; never concatenate credentials into a shell command.

- [ ] **Step 4: Run package verification**

Run:

```bash
pnpm verify:package
```

Expected: PASS from an installed tarball, not a workspace symlink. The generated consumer build contains no unresolved import.

- [ ] **Step 5: Inspect peer duplication and package contents**

Run:

```bash
pnpm --dir packages/ui pack --pack-destination /private/tmp/oxygen-design-system-pack-check
pnpm --dir packages/ui why react
```

Expected: React is a peer/dev relationship, not bundled runtime code; package output excludes source tests, Storybook, secrets, and knowledge-base files.

---

### Task 7: Add Changesets And GitHub Actions Without Publishing

**Files:**
- Create: `.changeset/config.json`
- Create: `.changeset/README.md`
- Create: `.github/workflows/check.yml`
- Create: `.github/workflows/release.yml`
- Modify: root `package.json`
- Create: `README.md`

**Interfaces:**
- Consumes: GitHub Actions, Changesets, pnpm lockfile, npm trusted publisher or scoped automation secret at execution time.
- Produces: check workflow, version PR workflow, restricted publish command, package installation documentation.

- [ ] **Step 1: Configure Changesets**

Use this policy in `.changeset/config.json`:

```json
{
  "changelog": "@changesets/cli/changelog",
  "commit": false,
  "fixed": [],
  "linked": [],
  "access": "restricted",
  "baseBranch": "main",
  "updateInternalDependencies": "patch",
  "ignore": ["@oxygen-design/storybook"]
}
```

- [ ] **Step 2: Add a PR check workflow**

`check.yml` runs on pull requests and pushes to `main`:

```yaml
- run: corepack enable
- run: pnpm install --frozen-lockfile
- run: pnpm typecheck
- run: pnpm test
- run: pnpm build
- run: pnpm storybook:build
- run: pnpm verify:package
```

Set least-privilege permissions to `contents: read`. Do not expose npm publishing credentials to pull requests.

- [ ] **Step 3: Add the Changesets release workflow**

`release.yml` runs on `main`, uses `changesets/action`, sets `contents: write` and `pull-requests: write`, and uses `id-token: write` only for the publish job. The publish command is the root release script:

```bash
pnpm release
```

Do not add a real `NODE_AUTH_TOKEN` value. If trusted publishing is not available after the npm Organization exists, reference a repository secret named `NPM_TOKEN` and document the required minimal package scope.

- [ ] **Step 4: Document consumer installation without credentials**

README includes:

```bash
pnpm add @oxygen-design/ui@0.1.0
```

and:

```ts
import { Button } from '@oxygen-design/ui';
import '@oxygen-design/ui/styles.css';
```

Show `.npmrc` only as:

```ini
@oxygen-design:registry=https://registry.npmjs.org/
//registry.npmjs.org/:_authToken=${NPM_TOKEN}
```

Never include a token example value.

- [ ] **Step 5: Validate workflow syntax and full local verification**

Run:

```bash
pnpm verify
pnpm verify:package
git diff --check
git status --short
```

Expected: all local checks pass; workflows contain no credentials; no publish command has been executed.

---

### Task 8: Prepare The First Private Release Gate

**Files:**
- Create: `.changeset/initial-release.md`
- Modify: `README.md`
- Inspect only: npm Organization, GitHub repository settings, trusted publisher settings.

**Interfaces:**
- Consumes: completed local package, user-created npm Organization and GitHub private repository.
- Produces: release-ready `0.1.0` changeset and a checklist; no external mutation without approval.

- [ ] **Step 1: Add the initial release changeset**

```markdown
---
"@oxygen-design/ui": minor
---

发布首个 Oxygen Design System 私有组件包，包含基础组件、通用页面模式、预编译样式与框架无关设计令牌。
```

Keep the development manifest at `0.0.0`. Applying this initial minor changeset must produce exactly `0.1.0`; if `pnpm changeset version` would produce any other version, block the release and correct the configuration before publishing.

- [ ] **Step 2: Run the final local release dry run**

Run:

```bash
pnpm verify
pnpm verify:package
pnpm changeset status
pnpm --filter @oxygen-design/ui pack --pack-destination /private/tmp/oxygen-design-system-pack-check
```

Expected: all checks pass and Changesets reports only `@oxygen-design/ui` for the initial release.

- [ ] **Step 3: Stop at the external-action gate**

Report these as pending until separately authorized and completed:

- npm Organization `oxygen-design` exists and supports restricted packages.
- GitHub repository `oxygen-design-system` exists and is private.
- Repository branch protection and Actions permissions are configured.
- Trusted publisher or minimal `NPM_TOKEN` is configured.
- Package name ownership is confirmed while authenticated.

Do not create, push, publish, or configure any of them under this plan without explicit user authorization.

- [ ] **Step 4: Provide release evidence after authorization**

Only after publication is explicitly authorized, verify the exact version and access through authenticated npm commands, install `@oxygen-design/ui@0.1.0` into the isolated consumer, and rerun its typecheck and production build. A successful workflow log alone is not sufficient release evidence.
