'use client'

import { useParams } from 'next/navigation'
import { StockManager } from '../StockManager'

export default function StockPage() {
  const params = useParams()
  const productId = params.productId as string
  return <StockManager productId={productId} />
}
