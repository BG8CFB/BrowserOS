import {
  Check,
  Copy,
  ExternalLink,
  Loader2,
  RefreshCw,
  Server,
} from 'lucide-react'
import { type FC, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { MCP_SERVER_RESTARTED_EVENT } from '@/lib/constants/analyticsEvents'
import { track } from '@/lib/metrics/track'
import { ServerPortEditor } from './ServerPortEditor'
import { waitForServerHealth } from './server-health'

export interface MCPServerHeaderProps {
  serverUrl: string | null
  isLoading: boolean
  error: string | null
  onServerRestart?: () => void
}

const DOCS_URL = 'https://docs.browseros.com/features/use-with-claude-code'

export const MCPServerHeader: FC<MCPServerHeaderProps> = ({
  serverUrl,
  isLoading,
  error,
  onServerRestart,
}) => {
  const [isCopied, setIsCopied] = useState(false)
  const [isRestarting, setIsRestarting] = useState(false)

  const handleCopy = async () => {
    if (!serverUrl) return
    try {
      await navigator.clipboard.writeText(serverUrl)
      setIsCopied(true)
      setTimeout(() => setIsCopied(false), 2000)
    } catch {
      // Clipboard API failed
    }
  }

  const handleRestart = async () => {
    setIsRestarting(true)
    try {
      const { getBrowserOSAdapter } = await import('@/lib/browseros/adapter')
      const { BROWSEROS_PREFS } = await import('@/lib/browseros/prefs')
      const adapter = getBrowserOSAdapter()
      await adapter.setPref(BROWSEROS_PREFS.RESTART_SERVER, true)

      const healthy = await waitForServerHealth()
      if (healthy) {
        track(MCP_SERVER_RESTARTED_EVENT)
        toast.success('服务器重启成功')
        onServerRestart?.()
      } else {
        toast.error('服务器未响应，请尝试重启浏览器。')
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '重启服务器失败')
    } finally {
      setIsRestarting(false)
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card p-6 shadow-sm transition-all hover:shadow-md">
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[var(--accent-orange)]/10">
          <Server className="h-6 w-6 text-[var(--accent-orange)]" />
        </div>
        <div className="flex-1">
          <div className="mb-1 flex items-center justify-between">
            <h2 className="font-semibold text-xl">BrowserOS MCP 服务器</h2>
            <a
              href={DOCS_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-muted-foreground text-sm transition-colors hover:text-[var(--accent-orange)]"
            >
              文档
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
          <p className="mb-6 text-muted-foreground text-sm">
            将 BrowserOS 连接到 Claude Code、Gemini CLI 等 MCP 客户端。
          </p>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <span className="whitespace-nowrap font-medium text-sm">
              服务器 URL：
            </span>
            <div className="flex flex-1 items-center gap-2">
              <div className="flex-1 rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm sm:max-w-md">
                {isLoading ? (
                  <span className="text-muted-foreground">加载中...</span>
                ) : error ? (
                  <span className="text-destructive">{error}</span>
                ) : (
                  serverUrl
                )}
              </div>
              <Button
                variant="outline"
                size="icon"
                onClick={handleCopy}
                disabled={!serverUrl || isLoading}
                className="shrink-0"
                title="复制 URL"
              >
                {isCopied ? (
                  <Check className="h-4 w-4 text-green-600" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={handleRestart}
                disabled={isLoading || isRestarting}
                className="shrink-0"
                title="重启服务器"
              >
                {isRestarting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
              </Button>
              <ServerPortEditor onPortChanged={onServerRestart} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
