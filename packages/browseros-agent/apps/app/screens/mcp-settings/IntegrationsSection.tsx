import { AlertCircle, ChevronDown, ExternalLink, Loader2 } from 'lucide-react'
import { type FC, Fragment, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import { presentationFor } from './integrations-section.helpers'
import {
  type McpAgentRow,
  useInstallAgent,
  useMcpAgents,
  useUninstallAgent,
} from './integrations-section.hooks'
import { QuickSetupSection } from './QuickSetupSection'

export interface IntegrationsSectionProps {
  serverUrl: string | null
}

export const IntegrationsSection: FC<IntegrationsSectionProps> = ({
  serverUrl,
}) => {
  const agentsQuery = useMcpAgents()
  const install = useInstallAgent(serverUrl)
  const uninstall = useUninstallAgent()
  const [errors, setErrors] = useState<Record<string, string | null>>({})

  const clearError = (agentId: string) =>
    setErrors((prev) => ({ ...prev, [agentId]: null }))

  const setError = (agentId: string, message: string) =>
    setErrors((prev) => ({ ...prev, [agentId]: message }))

  const handleInstall = async (agentId: string) => {
    clearError(agentId)
    try {
      const result = await install.mutateAsync(agentId)
      if (!result.success) {
        setError(agentId, result.message ?? '安装失败。')
      }
    } catch (err) {
      setError(agentId, err instanceof Error ? err.message : String(err))
    }
  }

  const handleUninstall = async (agentId: string) => {
    clearError(agentId)
    try {
      const result = await uninstall.mutateAsync(agentId)
      if (!result.success) {
        setError(agentId, result.message ?? '卸载失败。')
      }
    } catch (err) {
      setError(agentId, err instanceof Error ? err.message : String(err))
    }
  }

  const agents = agentsQuery.data ?? []
  const detectedCount = agents.filter((a) => a.installed).length
  const connectedCount = agents.filter((a) => a.linked).length

  return (
    <section className="space-y-4">
      {/* Section heading: small, tight. Stat counter on the right
          surfaces the most useful at-a-glance metric. */}
      <div className="flex items-end justify-between gap-4">
        <div className="space-y-1">
          <h2 className="font-semibold text-lg leading-tight">已连接的代理</h2>
          <p className="text-muted-foreground text-sm">
            将 BrowserOS 作为 MCP 服务器添加到你的 AI 代理中——无需复制粘贴。
          </p>
        </div>
        {detectedCount > 0 && (
          <div className="shrink-0 rounded-full border border-border bg-card px-2.5 py-1 text-muted-foreground text-xs tabular-nums">
            <span className="font-semibold text-foreground">
              {connectedCount}
            </span>{' '}
            /{' '}
            <span className="font-semibold text-foreground">
              {detectedCount}
            </span>{' '}
            已连接
          </div>
        )}
      </div>

      {agentsQuery.isLoading && <SkeletonList />}

      {agentsQuery.isError && (
        <ErrorPanel
          message={
            agentsQuery.error instanceof Error
              ? agentsQuery.error.message
              : String(agentsQuery.error)
          }
          onRetry={() => agentsQuery.refetch()}
        />
      )}

      {agentsQuery.data && agents.length === 0 && (
        <div className="rounded-lg border border-border border-dashed bg-card px-4 py-6 text-center text-muted-foreground text-sm">
          未在此系统上找到受支持的代理。
        </div>
      )}

      {agents.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          {agents.map((agent, index) => (
            <Fragment key={agent.id}>
              {index > 0 && (
                <div className="border-border border-t" aria-hidden />
              )}
              <AgentRow
                agent={agent}
                busy={
                  (install.isPending && install.variables === agent.id) ||
                  (uninstall.isPending && uninstall.variables === agent.id)
                }
                error={errors[agent.id] ?? null}
                canConnect={serverUrl !== null}
                onInstall={handleInstall}
                onUninstall={handleUninstall}
              />
            </Fragment>
          ))}
        </div>
      )}

      <Collapsible>
        <CollapsibleTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="-ml-2 text-muted-foreground hover:text-foreground"
          >
            <ChevronDown className="mr-1 h-3.5 w-3.5 transition-transform data-[state=open]:rotate-180" />
            显示手动配置
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-3">
          <QuickSetupSection serverUrl={serverUrl} />
        </CollapsibleContent>
      </Collapsible>
    </section>
  )
}

interface AgentRowProps {
  agent: McpAgentRow
  busy: boolean
  error: string | null
  /** False while the proxy URL hasn't resolved yet — disables Connect. */
  canConnect: boolean
  onInstall: (id: string) => void
  onUninstall: (id: string) => void
}

const AgentRow: FC<AgentRowProps> = ({
  agent,
  busy,
  error,
  canConnect,
  onInstall,
  onUninstall,
}) => {
  const presentation = presentationFor(agent.id)
  const Mark = presentation.mark

  return (
    <div
      className={cn(
        'flex items-center gap-3.5 px-4 py-3 transition-colors',
        !agent.installed && 'opacity-60 hover:opacity-100',
      )}
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-white p-1.5 ring-1 ring-black/5 dark:ring-white/10">
        <Mark className="h-full w-full" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm leading-none">
            {presentation.label}
          </span>
          {agent.linked && (
            <span className="inline-flex items-center gap-1.5 text-emerald-600 text-xs dark:text-emerald-400">
              <span
                className="h-1.5 w-1.5 rounded-full bg-emerald-500"
                aria-hidden
              />
              已连接
            </span>
          )}
          {!agent.installed && (
            <span className="text-muted-foreground text-xs">未安装</span>
          )}
        </div>
        {error && (
          <p className="mt-1 flex items-start gap-1 text-destructive text-xs">
            <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
            <span>{error}</span>
          </p>
        )}
      </div>

      <div className="shrink-0">
        {!agent.installed && presentation.installUrl && (
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-foreground"
          >
            <a
              href={presentation.installUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              获取 {presentation.label}
              <ExternalLink className="ml-1 h-3 w-3" />
            </a>
          </Button>
        )}
        {agent.installed && !agent.linked && (
          <Button
            size="sm"
            disabled={busy || !canConnect}
            onClick={() => onInstall(agent.id)}
            title={!canConnect ? '正在加载 MCP 服务器 URL…' : undefined}
          >
            {busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            连接
          </Button>
        )}
        {agent.installed && agent.linked && (
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => onUninstall(agent.id)}
            className="text-muted-foreground hover:text-destructive"
          >
            {busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            断开连接
          </Button>
        )}
      </div>
    </div>
  )
}

const SkeletonList: FC = () => (
  <div className="overflow-hidden rounded-lg border border-border bg-card">
    {[0, 1, 2].map((i) => (
      <Fragment key={i}>
        {i > 0 && <div className="border-border border-t" aria-hidden />}
        <div className="flex items-center gap-3.5 px-4 py-3">
          <div className="h-9 w-9 shrink-0 animate-pulse rounded-md bg-muted" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3 w-24 animate-pulse rounded-sm bg-muted" />
            <div className="h-2.5 w-40 animate-pulse rounded-sm bg-muted/60" />
          </div>
          <div className="h-7 w-20 animate-pulse rounded-md bg-muted" />
        </div>
      </Fragment>
    ))}
  </div>
)

const ErrorPanel: FC<{ message: string; onRetry: () => void }> = ({
  message,
  onRetry,
}) => (
  <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3">
    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
    <div className="space-y-1.5 text-sm">
      <div className="font-medium text-destructive">无法加载代理</div>
      <div className="text-muted-foreground">{message}</div>
      <Button size="sm" variant="outline" className="mt-1" onClick={onRetry}>
        重试
      </Button>
    </div>
  </div>
)
