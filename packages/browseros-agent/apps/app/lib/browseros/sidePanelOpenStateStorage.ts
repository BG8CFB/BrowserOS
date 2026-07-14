import { storage } from '@wxt-dev/storage'

export const sidePanelPerWindowStorage = storage.defineItem<boolean>(
  'local:browseros.side_panel.per_window',
  { fallback: true },
)

export const openWindowSidePanelIdsStorage = storage.defineItem<number[]>(
  'session:browseros.side_panel.open_window_ids',
  { fallback: [] },
)

const perWindowMigrationDone = storage.defineItem<boolean>(
  'local:browseros.side_panel.per_window_migrated_v1',
  { fallback: false },
)

/**
 * One-time migration to the per-window default. The legacy default was per-tab
 * (false), which left the toolbar action unable to open the sidePanel because
 * the old init path called setOptions({ enabled: false }). Force any
 * pre-migration false/unset value to true so the button works after upgrade.
 */
export async function migrateSidePanelPerWindowDefault(): Promise<void> {
  if (await perWindowMigrationDone.getValue()) return
  if (!(await sidePanelPerWindowStorage.getValue())) {
    await sidePanelPerWindowStorage.setValue(true)
  }
  await perWindowMigrationDone.setValue(true)
}
