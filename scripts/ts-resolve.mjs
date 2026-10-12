/**
 * Node ESM resolve hook: lets plain `node` import the project's TypeScript.
 *
 * Node's type-stripping runs `.ts` files, but its resolver needs an explicit
 * file extension — and this project uses extensionless relative imports
 * (`./notation`) resolved by the bundler. This hook fills the extension in for
 * relative specifiers, trying .ts/.tsx/.js, then falls back to Node's default
 * resolver. Used only by scripts/fen-smoke.mjs; the app itself is unaffected.
 */
export async function resolve(specifier, context, next) {
  if (specifier.startsWith('.') && !/\.[cm]?[jt]s$/.test(specifier)) {
    for (const ext of ['.ts', '.tsx', '.js']) {
      try {
        return await next(specifier + ext, context)
      } catch {
        // try the next extension
      }
    }
  }
  return next(specifier, context)
}
