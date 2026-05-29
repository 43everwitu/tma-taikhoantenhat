/** Format encrypted cart inputValue JSON for display in checkout/cart UI. */
export function formatCartInputLines(raw: string | null | undefined): { label: string | null; value: string }[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return [{ label: null, value: String(raw) }]
    return Object.entries(parsed as Record<string, string>)
      .filter(([, v]) => v && String(v).trim().length > 0)
      .map(([label, value]) => ({
        label: label && !/^__field_\d+$/.test(label) ? label : null,
        value: String(value),
      }))
  } catch {
    return [{ label: null, value: raw }]
  }
}
