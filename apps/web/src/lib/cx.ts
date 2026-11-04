/** Joins class names, skipping falsy values. Not worth a dependency. */
export const cx = (...parts: Array<string | false | null | undefined>): string => parts.filter(Boolean).join(' ');
