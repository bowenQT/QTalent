export function filterProjects<T extends { status: string }>(
  projects: T[],
  status: string,
): T[] {
  return status === 'all'
    ? projects
    : projects.filter((project) => project.status === status);
}
export function formatProjectDate(value: string): string {
  return value.slice(5);
}
export function submissionFromForm(form: FormData, requestId: string) {
  return {
    requestId,
    name: String(form.get('name') ?? '').trim(),
    type: String(form.get('type') ?? ''),
    status: String(form.get('status') ?? ''),
    goal: String(form.get('goal') ?? '').trim(),
    ownerId: String(form.get('ownerId') ?? '') || null,
    memberIds: form.getAll('memberIds').map(String),
  };
}
