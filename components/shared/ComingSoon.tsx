import { Card, CardContent } from '@/components/ui/card'
import { Construction } from 'lucide-react'

export function ComingSoon({ title, description }: { title: string; description?: string }) {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
      <Card>
        <CardContent className="py-16 text-center space-y-2">
          <Construction size={32} className="mx-auto text-slate-300" />
          <p className="font-medium text-slate-700">Coming soon</p>
          <p className="text-sm text-slate-400 max-w-md mx-auto">
            {description ?? 'This section is planned and not available yet.'}
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
