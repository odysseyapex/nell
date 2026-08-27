/**
 * The Nellvia mark.
 *
 * One idea, drawn: an open circle (what you intended), a filled circle (what
 * actually happened), and the wave between them (the week that got in the
 * way). It is the product's whole thesis — the gap between intention and
 * outcome is the signal — in a shape that still reads at 16px.
 *
 * The mark inherits `currentColor`, so it sits correctly on a coach's brand
 * colour without a second asset.
 */

export function NellviaMark({ className, title }: { className?: string; title?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role={title ? 'img' : 'presentation'}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      {title ? <title>{title}</title> : null}
      {/* The journey between the two states. */}
      <path
        d="M18 32C24 16 40 48 46 32"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
      />
      {/* Intention: open, not yet real. */}
      <circle cx="18" cy="32" r="6" fill="var(--mark-bg, transparent)" stroke="currentColor" strokeWidth="4" />
      {/* Outcome: solid, recorded. */}
      <circle cx="46" cy="32" r="6" fill="currentColor" />
    </svg>
  );
}

/** Mark plus wordmark, for headers and auth screens. */
export function NellviaLogo({ className }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className ?? ''}`}>
      <NellviaMark className="h-6 w-6" title="Nellvia" />
      <span className="text-lg font-semibold tracking-tight">Nellvia</span>
    </span>
  );
}
