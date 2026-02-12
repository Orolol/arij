export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function generateBranchName(epicTitle: string, id: string): string {
  const slug = slugify(epicTitle);
  const truncated = slug.slice(0, 40).replace(/-+$/, "");
  return `feature/epic-${truncated}-${id}`;
}
