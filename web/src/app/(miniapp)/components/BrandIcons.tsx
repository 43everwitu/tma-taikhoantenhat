type BrandPlatform = 'telegram' | 'zalo' | 'facebook'

const BRAND_COLOR: Record<BrandPlatform, string> = {
  telegram: '#26A5E4',
  zalo: '#0068FF',
  facebook: '#1877F2',
}

// Simplified brand marks (color + recognizable glyph) for our own outbound
// contact links — not a reproduction of each platform's full logo asset.
export function BrandIcon({ platform, size = 18 }: { platform: BrandPlatform; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect width="24" height="24" rx="6" fill={BRAND_COLOR[platform]} />
      {platform === 'telegram' && (
        <path
          d="M18.6 6.4 16.4 17.8c-.17.75-.62.94-1.25.58l-3.46-2.55-1.67 1.6c-.18.18-.34.34-.7.34l.25-3.53 6.42-5.8c.28-.25-.06-.39-.43-.14l-7.94 5-3.42-1.07c-.74-.23-.75-.74.16-1.1l13.36-5.15c.62-.23 1.16.14.96 1.42Z"
          fill="#fff"
        />
      )}
      {platform === 'zalo' && (
        <text x="12" y="16" textAnchor="middle" fontSize="9" fontWeight="700" fontFamily="Arial, sans-serif" fill="#fff">
          Zalo
        </text>
      )}
      {platform === 'facebook' && (
        <path
          d="M14.5 8.5h1.75V6h-2C12.4 6 11 7.3 11 9.3v1.7H9v2.5h2V19h2.6v-5.5h2l.4-2.5h-2.4V9.5c0-.6.28-1 .9-1Z"
          fill="#fff"
        />
      )}
    </svg>
  )
}

export type { BrandPlatform }
