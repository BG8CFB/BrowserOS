import { AlertCircle, Clock, Coins, CreditCard, Zap } from 'lucide-react'
import type { FC } from 'react'
import { Button } from '@/components/ui/button'
import {
  getCreditBarColor,
  getCreditTextColor,
} from '@/lib/credits/credit-colors'
import { BrowserOSIcon } from '@/lib/llm-providers/providerIcons'
import { cn } from '@/lib/utils'
import { useCredits } from '@/modules/credits/credits.hooks'

export const UsagePage: FC = () => {
  const { data, isLoading, error } = useCredits()

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12 text-muted-foreground text-sm">
        正在加载用量数据...
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-6 p-6">
        <div className="flex items-center gap-4 rounded-xl border p-5">
          <BrowserOSIcon size={40} />
          <div>
            <h2 className="font-semibold text-lg">用量与账单</h2>
            <p className="text-muted-foreground text-sm">
              查看你的 BrowserOS AI 额度使用情况
            </p>
          </div>
        </div>
        <div className="flex flex-col items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-8">
          <AlertCircle className="h-6 w-6 text-muted-foreground" />
          <p className="text-muted-foreground text-sm">无法加载额度信息</p>
        </div>
      </div>
    )
  }

  const credits = data?.credits ?? 0
  const total = data?.dailyLimit ?? 100
  const percentage = Math.min((credits / total) * 100, 100)

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center gap-4 rounded-xl border p-5">
        <BrowserOSIcon size={40} />
        <div>
          <h2 className="font-semibold text-lg">用量与账单</h2>
          <p className="text-muted-foreground text-sm">
            查看你的 BrowserOS AI 额度使用情况
          </p>
        </div>
      </div>

      <div className="rounded-xl border p-5">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Coins className="h-5 w-5 text-muted-foreground" />
            <span className="font-semibold text-sm">每日额度</span>
          </div>
          <span
            className={cn('font-bold text-2xl', getCreditTextColor(credits))}
          >
            {credits}
            <span className="ml-1 font-normal text-muted-foreground text-sm">
              / {total}
            </span>
          </span>
        </div>

        <div className="mb-5 h-2.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              'h-full rounded-full transition-all duration-500',
              getCreditBarColor(credits),
            )}
            style={{ width: `${percentage}%` }}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex items-center gap-2.5 rounded-lg bg-muted/50 px-3 py-2.5">
            <Clock className="h-4 w-4 shrink-0 text-muted-foreground" />
            <div>
              <p className="font-medium text-xs">每日重置</p>
              <p className="text-muted-foreground text-xs">UTC 午夜</p>
            </div>
          </div>
          <div className="flex items-center gap-2.5 rounded-lg bg-muted/50 px-3 py-2.5">
            <Zap className="h-4 w-4 shrink-0 text-muted-foreground" />
            <div>
              <p className="font-medium text-xs">今日已用额度</p>
              <p className="text-muted-foreground text-xs">
                {total - credits} / {total}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-xl border p-5">
        <div className="flex items-center gap-3">
          <CreditCard className="h-5 w-5 text-muted-foreground" />
          <div>
            <p className="flex items-center gap-2 font-semibold text-sm">
              需要更多额度？
              <span className="rounded-full bg-muted px-2 py-0.5 font-medium text-[10px] text-muted-foreground tracking-wide">
                即将推出
              </span>
            </p>
            <p className="text-muted-foreground text-xs">额度包将于近期上架</p>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-[var(--accent-orange)]/30 bg-[var(--accent-orange)]/5 p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Zap className="h-5 w-5 text-[var(--accent-orange)]" />
            <div>
              <p className="font-semibold text-sm">想要无限使用？</p>
              <p className="text-muted-foreground text-xs">
                添加你自己的 LLM 服务商 — 不受额度限制
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="border-[var(--accent-orange)] bg-[var(--accent-orange)]/10 text-[var(--accent-orange)] hover:bg-[var(--accent-orange)]/20"
            asChild
          >
            <a href="/app.html#/settings/ai">添加服务商</a>
          </Button>
        </div>
      </div>
    </div>
  )
}
