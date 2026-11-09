// Pure rules for delivery proof pictures (no imports). Uploaded by app/api/deliveries/upload-picture to the public
// Supabase Storage bucket below, under DELIVERY_PICTURE_FOLDER/.
export const PICTURE_BUCKET = 'retailer-photos'
export const DELIVERY_PICTURE_FOLDER = 'delivery'

/** The public URL prefix every delivery picture starts with (Supabase getPublicUrl format), or null if unconfigured. */
export function deliveryPicturePrefix(supabaseUrl: string | undefined | null): string | null {
  const base = (supabaseUrl ?? '').trim().replace(/\/+$/, '')
  if (!base) return null
  return `${base}/storage/v1/object/public/${PICTURE_BUCKET}/${DELIVERY_PICTURE_FOLDER}/`
}

/** True when `url` is a picture our upload route stored: under the delivery prefix, a plain file name after it. */
export function isDeliveryPictureUrl(url: string, supabaseUrl: string | undefined | null): boolean {
  const prefix = deliveryPicturePrefix(supabaseUrl)
  if (!prefix || !url.startsWith(prefix)) return false
  return /^[A-Za-z0-9_-]+\.[A-Za-z0-9]+$/.test(url.slice(prefix.length))
}
