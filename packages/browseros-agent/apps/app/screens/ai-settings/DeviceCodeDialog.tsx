import { Check, Copy, ExternalLink } from 'lucide-react'
import { type FC, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { PendingDeviceCode } from '@/modules/llm-providers/oauth-provider-flow.hooks'

export interface DeviceCodeDialogProps {
  deviceCode: PendingDeviceCode | null
  onClose: () => void
}

export const DeviceCodeDialog: FC<DeviceCodeDialogProps> = ({
  deviceCode,
  onClose,
}) => {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    if (!deviceCode) return
    try {
      await navigator.clipboard.writeText(deviceCode.userCode)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard API failed
    }
  }

  return (
    <Dialog open={!!deviceCode} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>连接到 {deviceCode?.providerName}</DialogTitle>
          <DialogDescription>
            请将此代码粘贴到刚刚在浏览器中打开的 {deviceCode?.providerName}{' '}
            页面上。
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col items-center gap-4 py-4">
          <div className="flex items-center gap-3 rounded-xl border-2 border-[var(--accent-orange)]/40 border-dashed bg-[var(--accent-orange)]/5 px-6 py-4">
            <code className="font-bold font-mono text-2xl text-foreground tracking-widest">
              {deviceCode?.userCode}
            </code>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleCopy}
              className="shrink-0"
            >
              {copied ? (
                <Check className="h-4 w-4 text-green-600" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </Button>
          </div>
          <p className="text-center text-muted-foreground text-xs">
            认证完成后此对话框将自动关闭。
          </p>
          {deviceCode?.verificationUri && (
            <a
              href={deviceCode.verificationUri}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-[var(--accent-orange)] text-xs transition-colors hover:underline"
            >
              打开验证页面
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
