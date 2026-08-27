import type { Organization } from '@/lib/types';

/**
 * Per-organization branding.
 *
 * Nellvia is a single multi-tenant application rather than one deployment per
 * coach, so branding is applied as CSS custom properties on the app shell.
 * Components reference var(--brand) and never a hard-coded colour.
 */

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

export function normalizeHex(value: string | null | undefined, fallback: string): string {
  if (!value || !HEX.test(value.trim())) return fallback;
  const hex = value.trim().replace('#', '');
  const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex;
  return `#${full.toLowerCase()}`;
}

/**
 * Relative luminance, so text on a coach's brand colour stays readable
 * whether they chose charcoal or highlighter yellow.
 */
export function readableForeground(hex: string): string {
  const value = normalizeHex(hex, '#1f2937').slice(1);
  const channels = [0, 2, 4].map((offset) => {
    const channel = parseInt(value.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  return luminance > 0.55 ? '#111827' : '#ffffff';
}

export function withAlpha(hex: string, alpha: number): string {
  const value = normalizeHex(hex, '#1f2937').slice(1);
  const [r, g, b] = [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function brandStyle(organization: Pick<Organization, 'primary_color' | 'secondary_color'> | null) {
  const brand = normalizeHex(organization?.primary_color, '#1f2937');
  const secondary = normalizeHex(organization?.secondary_color, '#0ea5a4');

  return {
    '--brand': brand,
    '--brand-foreground': readableForeground(brand),
    '--brand-soft': withAlpha(brand, 0.08),
    '--brand-secondary': secondary,
  } as React.CSSProperties;
}
