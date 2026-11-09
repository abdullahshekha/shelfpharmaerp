// Pure test-switch rule (no imports), kept apart from lib/deliveries/sync.ts so unit tests need no Prisma client.

/**
 * Test-only switch: true only when NODE_ENV is not 'production' AND DELIVERY_TEST_SKIP_SYNC=1 (same pattern as
 * PDC_TEST_SKIP_SYNC in lib/pdc/clear.ts). A production build always returns false, whatever the variable says.
 */
export function shouldSkipDeliverySync(env: { NODE_ENV?: string; DELIVERY_TEST_SKIP_SYNC?: string }): boolean {
  return env.NODE_ENV !== 'production' && env.DELIVERY_TEST_SKIP_SYNC === '1'
}
