import Image from 'next/image'

interface MascotBadgeProps {
  size?: number
  className?: string
}

export function MascotBadge({ size = 32, className = '' }: MascotBadgeProps) {
  return (
    <span
      className={`inline-block overflow-hidden rounded-full border-2 border-clay-cream shadow-sm ${className}`}
      style={{ width: size, height: size }}
    >
      <Image
        src="/qr-template.png"
        alt="Auto-chan"
        width={size * 4}
        height={size * 4}
        className="object-cover"
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          objectPosition: '50% 18%',
        }}
        priority
      />
    </span>
  )
}
