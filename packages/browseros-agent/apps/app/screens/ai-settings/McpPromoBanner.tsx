import { ArrowRight, Server, X } from 'lucide-react'
import { type FC, useState } from 'react'
import { useNavigate } from 'react-router'
import { Button } from '@/components/ui/button'
import { MCP_PROMO_BANNER_CLICKED_EVENT } from '@/lib/constants/analyticsEvents'
import { track } from '@/lib/metrics/track'

export const McpPromoBanner: FC = () => {
  const [dismissed, setDismissed] = useState(false)
  const navigate = useNavigate()

  if (dismissed) return null

  const handleClick = () => {
    track(MCP_PROMO_BANNER_CLICKED_EVENT)
    navigate('/settings/mcp')
  }

  return (
    <div className="flex items-center gap-4 rounded-xl border border-border bg-card p-4 shadow-sm transition-all hover:shadow-md">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-orange)]/10">
        <Server className="h-5 w-5 text-[var(--accent-orange)]" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 font-semibold text-sm">
          在 BrowserOS 中使用 Claude Code、Cursor 等工具
        </p>
        <p className="text-muted-foreground text-xs">
          将你喜爱的编程工具作为 MCP 服务器连接到 BrowserOS
        </p>
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={handleClick}
        className="shrink-0 border-[var(--accent-orange)] bg-[var(--accent-orange)]/10 text-[var(--accent-orange)] hover:bg-[var(--accent-orange)]/20 hover:text-[var(--accent-orange)]"
      >
        设置
        <ArrowRight className="ml-1 h-3 w-3" />
      </Button>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="shrink-0 rounded-sm p-1 text-muted-foreground opacity-50 transition-opacity hover:opacity-100"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
