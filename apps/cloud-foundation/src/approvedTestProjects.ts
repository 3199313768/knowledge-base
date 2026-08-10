/**
 * Cloud test project refs require code-review approval before being added here.
 * Keep this list empty until an approved dedicated test project is available.
 */
const approvedTestProjectRefs: readonly string[] = [];

export function isApprovedTestProject(projectRef: string): boolean {
  return approvedTestProjectRefs.includes(projectRef);
}
