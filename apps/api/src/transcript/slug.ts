// "2026-03-04 Product Sync!.txt" -> "2026-03-04-product-sync"
export function fileSlug(filename: string): string {
  const base = filename.replace(/^.*[\\/]/, '').replace(/\.[^.]*$/, '');
  const slug = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return slug === '' ? 'meeting' : slug;
}
