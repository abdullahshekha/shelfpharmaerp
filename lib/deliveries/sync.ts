// Post-commit ledger sync for the delivery/order lifecycle functions.
import { syncAllSafe } from '@/lib/accounting/sync'
import { shouldSkipDeliverySync } from './test-switch'

/**
 * Runs syncAllSafe after the business transaction has committed (never throws). Skipped only by the test switch
 * DELIVERY_TEST_SKIP_SYNC=1, which is ignored when NODE_ENV=production (see shouldSkipDeliverySync).
 */
export async function syncAfterCommit(pairs: Parameters<typeof syncAllSafe>[0]): Promise<void> {
  if (shouldSkipDeliverySync(process.env)) return
  await syncAllSafe(pairs)
}
