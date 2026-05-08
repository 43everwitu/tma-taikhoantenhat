export const SWATCHES = {
  matcha: '#84e7a5',
  slushie: '#3bd3fd',
  lemon: '#fbbd41',
  ube: '#c1b0ff',
  pomegranate: '#fc7981',
  blueberry: '#01418d',
  dragonfruit: '#ff3ea5',
} as const

export type Swatch = keyof typeof SWATCHES

export const clayBtn = (variant?: Swatch | 'ink') =>
  variant ? `clay-btn clay-btn--${variant}` : 'clay-btn'
