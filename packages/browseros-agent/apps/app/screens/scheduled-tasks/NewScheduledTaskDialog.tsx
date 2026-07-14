import { zodResolver } from '@hookform/resolvers/zod'
import { ChevronDown, Loader2, Sparkles, Undo2 } from 'lucide-react'
import type { FC } from 'react'
import { useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod/v3'
import { ChatProviderSelector } from '@/components/chat/ChatProviderSelector'
import type { Provider } from '@/components/chat/chatComponentTypes'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { SCHEDULED_TASK_PROMPT_REFINED_EVENT } from '@/lib/constants/analyticsEvents'
import {
  findChatProviderById,
  isChatProviderType,
  resolveChatProvider,
} from '@/lib/llm-providers/provider-runtime'
import { BrowserOSIcon, ProviderIcon } from '@/lib/llm-providers/providerIcons'
import {
  defaultProviderIdStorage,
  providersStorage,
} from '@/lib/llm-providers/storage'
import type { LlmProviderConfig, ProviderType } from '@/lib/llm-providers/types'
import { track } from '@/lib/metrics/track'
import { refinePrompt } from '@/lib/schedules/refine-prompt'
import type { ScheduledJob } from './types'

const formSchema = z
  .object({
    name: z.string().min(1, '请输入名称').max(100, '名称不能超过 100 个字符'),
    query: z.string().min(1, '请输入提示词'),
    scheduleType: z.enum(['daily', 'hourly', 'minutes']),
    scheduleTime: z.string().optional(),
    scheduleInterval: z.number().int().min(1).max(60).optional(),
    providerId: z.string().optional(),
    enabled: z.boolean(),
  })
  .superRefine((data, ctx) => {
    if (data.scheduleType === 'daily' && !data.scheduleTime) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '每日计划需要设置时间',
        path: ['scheduleTime'],
      })
    }
    if (
      (data.scheduleType === 'hourly' || data.scheduleType === 'minutes') &&
      (!data.scheduleInterval || data.scheduleInterval < 1)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '间隔至少为 1',
        path: ['scheduleInterval'],
      })
    }
  })

type FormValues = z.infer<typeof formSchema>

export interface NewScheduledTaskDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialValues?: ScheduledJob | null
  onSave: (data: Omit<ScheduledJob, 'id' | 'createdAt' | 'updatedAt'>) => void
}

export const NewScheduledTaskDialog: FC<NewScheduledTaskDialogProps> = ({
  open,
  onOpenChange,
  initialValues,
  onSave,
}) => {
  const isEditing = !!initialValues
  const [providers, setProviders] = useState<LlmProviderConfig[]>([])
  const [defaultProviderId, setDefaultProviderId] = useState<string>('')

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: '',
      query: '',
      scheduleType: 'daily',
      scheduleTime: '09:00',
      scheduleInterval: 1,
      providerId: undefined,
      enabled: true,
    },
  })

  const scheduleType = form.watch('scheduleType')
  const selectedProviderId = form.watch('providerId')
  const queryValue = form.watch('query')
  const [isRefining, setIsRefining] = useState(false)
  const originalPromptRef = useRef<string | null>(null)
  const refineRequestIdRef = useRef(0)
  const isProgrammaticChange = useRef(false)

  useEffect(() => {
    if (!open) return
    Promise.all([
      providersStorage.getValue(),
      defaultProviderIdStorage.getValue(),
    ]).then(([providerList, defId]) => {
      setProviders(providerList ?? [])
      setDefaultProviderId(defId ?? '')
    })
  }, [open])

  useEffect(() => {
    if (open) {
      refineRequestIdRef.current++
      originalPromptRef.current = null
      setIsRefining(false)
      if (initialValues) {
        form.reset({
          name: initialValues.name,
          query: initialValues.query,
          scheduleType: initialValues.scheduleType,
          scheduleTime: initialValues.scheduleTime || '09:00',
          scheduleInterval: initialValues.scheduleInterval || 1,
          providerId: initialValues.providerId,
          enabled: initialValues.enabled,
        })
      } else {
        form.reset({
          name: '',
          query: '',
          scheduleType: 'daily',
          scheduleTime: '09:00',
          scheduleInterval: 1,
          providerId: undefined,
          enabled: true,
        })
      }
    }
  }, [open, initialValues, form])

  const resolvedProvider: Provider | null = (() => {
    const found =
      findChatProviderById(providers, selectedProviderId) ??
      resolveChatProvider(providers, defaultProviderId)
    if (found) {
      return {
        kind: 'llm' as const,
        id: found.id,
        name: found.name,
        type: found.type,
      }
    }
    const fallback = resolveChatProvider(providers)
    if (fallback)
      return {
        kind: 'llm' as const,
        id: fallback.id,
        name: fallback.name,
        type: fallback.type,
      }
    return null
  })()

  const providerOptions: Provider[] = providers
    .filter((provider) => isChatProviderType(provider.type))
    .map((p) => ({
      kind: 'llm',
      id: p.id,
      name: p.name,
      type: p.type,
    }))

  // Replace textarea content via execCommand so the browser's native undo
  // stack (Cmd+Z / Ctrl+Z) records the change. Falls back to form.setValue
  // if the textarea element can't be found.
  const setQueryWithUndo = (value: string) => {
    const textarea = document.querySelector(
      'textarea[name="query"]',
    ) as HTMLTextAreaElement
    if (textarea) {
      isProgrammaticChange.current = true
      textarea.focus()
      textarea.select()
      document.execCommand('insertText', false, value)
      isProgrammaticChange.current = false
    } else {
      form.setValue('query', value)
    }
  }

  const handleRefinePrompt = async () => {
    const currentQuery = form.getValues('query').trim()
    const currentName = form.getValues('name').trim()
    if (!currentQuery) return

    const requestId = ++refineRequestIdRef.current
    setIsRefining(true)
    originalPromptRef.current = currentQuery

    try {
      const refined = await refinePrompt({
        prompt: currentQuery,
        name: currentName || '未命名任务',
        providerId: form.getValues('providerId'),
      })
      if (requestId !== refineRequestIdRef.current) return
      setQueryWithUndo(refined)
      track(SCHEDULED_TASK_PROMPT_REFINED_EVENT)
    } catch {
      if (requestId !== refineRequestIdRef.current) return
      toast.error('重写提示词失败，请重试。')
      originalPromptRef.current = null
    } finally {
      if (requestId === refineRequestIdRef.current) {
        setIsRefining(false)
      }
    }
  }

  const handleUndoRefine = () => {
    if (originalPromptRef.current !== null) {
      setQueryWithUndo(originalPromptRef.current)
      originalPromptRef.current = null
    }
  }

  const onSubmit = (values: FormValues) => {
    const provider = findChatProviderById(providers, values.providerId)
    onSave({
      name: values.name.trim(),
      query: values.query.trim(),
      scheduleType: values.scheduleType,
      scheduleTime:
        values.scheduleType === 'daily' ? values.scheduleTime : undefined,
      scheduleInterval:
        values.scheduleType !== 'daily' ? values.scheduleInterval : undefined,
      providerId: provider?.id,
      enabled: values.enabled,
    })
    form.reset()
    originalPromptRef.current = null
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? '编辑定时任务' : '创建定时任务'}
          </DialogTitle>
          <DialogDescription>
            {isEditing
              ? '更新您的定时任务配置。'
              : '创建一个按计划自动运行的新任务。'}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>名称</FormLabel>
                  <FormControl>
                    <Input placeholder="例如：每日早报" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="query"
              render={({ field }) => (
                <FormItem>
                  <div className="flex items-center justify-between">
                    <FormLabel>提示词</FormLabel>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-auto gap-1 px-2 py-1 text-muted-foreground text-xs"
                      disabled={!queryValue?.trim() || isRefining}
                      onClick={handleRefinePrompt}
                    >
                      {isRefining ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Sparkles className="h-3 w-3" />
                      )}
                      {isRefining ? '重写中...' : '用 AI 重写'}
                    </Button>
                  </div>
                  <FormControl>
                    <Textarea
                      placeholder="代理需要做什么？例如：检查我的邮件并总结重要信息"
                      className="min-h-[100px] resize-none"
                      {...field}
                      onChange={(e) => {
                        field.onChange(e)
                        if (
                          !isProgrammaticChange.current &&
                          originalPromptRef.current !== null
                        ) {
                          originalPromptRef.current = null
                        }
                      }}
                    />
                  </FormControl>
                  {!isRefining && originalPromptRef.current !== null ? (
                    <button
                      type="button"
                      className="flex items-center gap-1 text-muted-foreground text-xs hover:text-foreground"
                      onClick={handleUndoRefine}
                    >
                      <Undo2 className="h-3 w-3" />
                      撤销重写
                    </button>
                  ) : (
                    <FormDescription>将发送给代理的指令</FormDescription>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />

            {providers.length > 0 && resolvedProvider && (
              <FormItem>
                <FormLabel>AI 提供商</FormLabel>
                <ChatProviderSelector
                  providers={providerOptions}
                  selectedProvider={resolvedProvider}
                  onSelectProvider={(provider) =>
                    form.setValue('providerId', provider.id)
                  }
                >
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full justify-between"
                  >
                    <span className="flex items-center gap-2">
                      <span className="text-muted-foreground">
                        {resolvedProvider.type === 'browseros' ? (
                          <BrowserOSIcon size={16} />
                        ) : (
                          <ProviderIcon
                            type={resolvedProvider.type as ProviderType}
                            size={16}
                          />
                        )}
                      </span>
                      {resolvedProvider.name}
                    </span>
                    <ChevronDown className="h-4 w-4 opacity-50" />
                  </Button>
                </ChatProviderSelector>
                <FormDescription>用于运行此任务的 AI 提供商</FormDescription>
              </FormItem>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="scheduleType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>计划</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      defaultValue={field.value}
                      value={field.value}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="选择计划类型" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="daily">每天定时</SelectItem>
                        <SelectItem value="hourly">每 N 小时</SelectItem>
                        <SelectItem value="minutes">每 N 分钟</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {scheduleType === 'daily' ? (
                <FormField
                  control={form.control}
                  name="scheduleTime"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>时间</FormLabel>
                      <FormControl>
                        <Input type="time" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ) : (
                <FormField
                  control={form.control}
                  name="scheduleInterval"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        间隔（{scheduleType === 'hourly' ? '小时' : '分钟'}）
                      </FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min={1}
                          max={scheduleType === 'hourly' ? 24 : 60}
                          value={field.value ?? ''}
                          onChange={(e) =>
                            field.onChange(
                              e.target.value
                                ? Number(e.target.value)
                                : undefined,
                            )
                          }
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
            </div>

            <FormField
              control={form.control}
              name="enabled"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center gap-3 space-y-0">
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                  <FormLabel className="font-normal">启用此任务</FormLabel>
                </FormItem>
              )}
            />

            <DialogFooter className="gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                取消
              </Button>
              <Button type="submit">{isEditing ? '更新' : '创建'}</Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
