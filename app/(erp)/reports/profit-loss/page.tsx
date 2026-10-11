import { ProfitLossView } from '@/components/accounts/ProfitLossView'

export default function Page() {
  return <ProfitLossView endpoint="/api/reports/profit-loss" title="Profit & Loss" />
}
