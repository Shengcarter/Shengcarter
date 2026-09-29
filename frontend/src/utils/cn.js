/** Join class names, skipping falsy values. */
export function cn(...values) {
  return values.flat(Infinity).filter(Boolean).join(' ');
}
