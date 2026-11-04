// Runs before first paint so a dark-mode user does not see a light flash. A separate file, not inline,
// so the CSP can stay script-src 'self'.
let theme = null;
try {
  theme = localStorage.getItem('mi-theme');
} catch {
  // storage blocked: fall through to the OS preference
}
if (theme !== 'light' && theme !== 'dark') theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
document.documentElement.dataset.theme = theme;
