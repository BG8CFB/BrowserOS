import { CloudOff } from 'lucide-react'
import type { FC } from 'react'
import {
  type IncompleteProvider,
  IncompleteProviderCard,
} from './IncompleteProviderCard'

export interface IncompleteProvidersListProps {
  providers: IncompleteProvider[]
  onAddKeys: (provider: IncompleteProvider) => void
  onDelete: (provider: IncompleteProvider) => void
}

export const IncompleteProvidersList: FC<IncompleteProvidersListProps> = ({
  providers,
  onAddKeys,
  onDelete,
}) => {
  if (providers.length === 0) return null

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
        <CloudOff className="h-4 w-4" />
        <h3 className="font-medium text-sm">已同步服务商（缺少 API Key）</h3>
      </div>
      <p className="text-muted-foreground text-sm">
        这些服务商已从其他设备同步，但需要在此设备上填写 API Key 才能使用。
      </p>
      <div className="space-y-3">
        {providers.map((provider) => (
          <IncompleteProviderCard
            key={provider.rowId}
            provider={provider}
            onAddKeys={() => onAddKeys(provider)}
            onDelete={() => onDelete(provider)}
          />
        ))}
      </div>
    </div>
  )
}
