import { Loader2, Pencil } from 'lucide-react'
import { type FC, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { getBrowserOSAdapter } from '@/lib/browseros/adapter'
import { getProxyPort } from '@/lib/browseros/helpers'
import { BROWSEROS_PREFS } from '@/lib/browseros/prefs'
import { MCP_PROXY_PORT_CHANGED_EVENT } from '@/lib/constants/analyticsEvents'
import { track } from '@/lib/metrics/track'
import { waitForServerHealth } from './server-health'
import { PROXY_PORT_MIN, parseProxyPort } from './server-port-editor.helpers'

export interface ServerPortEditorProps {
  onPortChanged?: () => void
}

async function readCurrentPort(): Promise<number> {
  try {
    return await getProxyPort()
  } catch {
    // Pref unset or BrowserOS API unavailable — fall back to the default port
    return PROXY_PORT_MIN
  }
}

/** Popover for editing the MCP proxy port and waiting for BrowserOS to rebind it. */
export const ServerPortEditor: FC<ServerPortEditorProps> = ({
  onPortChanged,
}) => {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('')
  const [currentPort, setCurrentPort] = useState<number | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isMountedRef = useRef(true)

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
    }
  }, [])

  const handleOpenChange = async (next: boolean) => {
    if (!next && isSaving) return
    setOpen(next)
    if (next) {
      setError(null)
      const port = await readCurrentPort()
      if (!isMountedRef.current) return
      setCurrentPort(port)
      setValue(String(port))
    }
  }

  const parsed = parseProxyPort(value)
  const canSave = parsed.ok && !isSaving && parsed.port !== currentPort

  const handleSave = async () => {
    const result = parseProxyPort(value)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setIsSaving(true)
    setError(null)
    try {
      const success = await getBrowserOSAdapter().setPref(
        BROWSEROS_PREFS.PROXY_PORT,
        result.port,
      )
      if (!success) {
        throw new Error('Failed to update port')
      }
      const healthy = await waitForServerHealth()
      // Bail if the settings page unmounted mid-poll — don't poke a stale tree.
      if (!isMountedRef.current) return
      if (healthy) {
        track(MCP_PROXY_PORT_CHANGED_EVENT, { port: result.port })
        setCurrentPort(result.port)
        toast.success('服务器端口已更新', {
          description: `MCP 客户端现在通过端口 ${result.port} 连接。`,
        })
        onPortChanged?.()
        setOpen(false)
      } else {
        setError(
          '端口已保存，但服务器未能及时重启。请退出并重新启动浏览器以应用更改。',
        )
      }
    } catch (err) {
      if (!isMountedRef.current) return
      setError(err instanceof Error ? err.message : '更新端口失败')
    } finally {
      if (isMountedRef.current) setIsSaving(false)
    }
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className="shrink-0"
          title="编辑服务器端口"
        >
          <Pencil className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <div className="space-y-3">
          <div className="space-y-1">
            <h4 className="font-medium text-sm">服务器端口</h4>
            <p className="text-muted-foreground text-xs leading-relaxed">
              外部 MCP 客户端（Claude Code、Gemini CLI
              等）用于连接的端口。保存后会重启服务器，因此所有活跃连接将短暂中断。
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="proxy-port" className="sr-only">
              服务器端口
            </Label>
            <Input
              id="proxy-port"
              inputMode="numeric"
              autoComplete="off"
              autoFocus
              value={value}
              aria-invalid={!parsed.ok && value.trim() !== ''}
              aria-describedby={error ? 'proxy-port-error' : undefined}
              disabled={isSaving}
              onChange={(e) => {
                setValue(e.target.value)
                setError(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && canSave) handleSave()
              }}
            />
            {error && (
              <p id="proxy-port-error" className="text-destructive text-xs">
                {error}
              </p>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setOpen(false)}
              disabled={isSaving}
            >
              取消
            </Button>
            <Button size="sm" onClick={handleSave} disabled={!canSave}>
              {isSaving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  重启中…
                </>
              ) : (
                '保存'
              )}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
