import { Check, Copy } from 'lucide-react'
import { type FC, type ReactNode, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

export interface QuickSetupSectionProps {
  serverUrl: string | null
}

interface ClientConfig {
  id: string
  name: string
  kind: 'command' | 'config'
  /** Short verb-led instruction shown above the snippet. */
  action: ReactNode
  getSnippet: (url: string) => string
}

const clients: ClientConfig[] = [
  {
    id: 'generic',
    name: '其他代理',
    kind: 'config',
    action: (
      <>
        将以下内容添加到你的代理 MCP 配置中（通常是{' '}
        <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
          mcp.json
        </code>{' '}
        或{' '}
        <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
          settings.json
        </code>
        ）。如果 schema 不同，只需关注 <strong>type</strong> 和{' '}
        <strong>url</strong> 两个值即可。
      </>
    ),
    getSnippet: (url) =>
      JSON.stringify(
        {
          mcpServers: {
            browseros: { type: 'http', url },
          },
        },
        null,
        2,
      ),
  },
  {
    id: 'claude-code',
    name: 'Claude Code',
    kind: 'command',
    action: '在终端中运行：',
    getSnippet: (url) =>
      `claude mcp add --transport http browseros ${url} --scope user`,
  },
  {
    id: 'claude-desktop',
    name: 'Claude Desktop',
    kind: 'config',
    action: (
      <>
        将以下内容添加到{' '}
        <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
          claude_desktop_config.json
        </code>
        中。
      </>
    ),
    getSnippet: (url) =>
      JSON.stringify(
        {
          mcpServers: {
            browseros: {
              command: 'npx',
              args: ['mcp-remote', url],
            },
          },
        },
        null,
        2,
      ),
  },
  {
    id: 'codex',
    name: 'Codex',
    kind: 'command',
    action: '在终端中运行：',
    getSnippet: (url) => `codex mcp add browseros ${url}`,
  },
]

const CopyButton: FC<{ text: string; label?: string }> = ({ text, label }) => {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard API failed; nothing useful to surface here.
    }
  }

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={handleCopy}
      aria-label={copied ? '已复制' : (label ?? '复制')}
      className="shrink-0 text-muted-foreground hover:text-foreground"
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-green-600" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
    </Button>
  )
}

export const QuickSetupSection: FC<QuickSetupSectionProps> = ({
  serverUrl,
}) => {
  if (!serverUrl) return null

  return (
    <div className="space-y-3">
      <div>
        <h3 className="font-semibold text-sm">手动配置</h3>
        <p className="text-muted-foreground text-xs">
          使用适用于你代理的代码片段，或在支持基于 URL 的 MCP
          配置的客户端中使用服务器 URL。
        </p>
      </div>

      <div className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2">
        <span className="text-muted-foreground text-xs">服务器 URL</span>
        <code className="flex-1 truncate font-mono text-xs">{serverUrl}</code>
        <CopyButton text={serverUrl} label="复制服务器 URL" />
      </div>

      <Tabs defaultValue="generic">
        <TabsList className="flex-wrap">
          {clients.map((client) => (
            <TabsTrigger key={client.id} value={client.id}>
              {client.name}
            </TabsTrigger>
          ))}
        </TabsList>

        {clients.map((client) => {
          const snippet = client.getSnippet(serverUrl)
          return (
            <TabsContent
              key={client.id}
              value={client.id}
              className="space-y-2 pt-3"
            >
              <p className="text-muted-foreground text-xs leading-relaxed">
                {client.action}
              </p>
              <div className="flex items-start gap-2 rounded-md border border-border bg-background px-3 py-2">
                <pre className="flex-1 overflow-x-auto whitespace-pre-wrap break-all font-mono text-xs">
                  {client.kind === 'command' && (
                    <span className="mr-1 select-none text-muted-foreground">
                      $
                    </span>
                  )}
                  {snippet}
                </pre>
                <CopyButton text={snippet} label={`复制 ${client.name} 配置`} />
              </div>
            </TabsContent>
          )
        })}
      </Tabs>
    </div>
  )
}
