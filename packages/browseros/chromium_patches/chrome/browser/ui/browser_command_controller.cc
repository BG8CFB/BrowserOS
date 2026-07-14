diff --git a/chrome/browser/ui/browser_command_controller.cc b/chrome/browser/ui/browser_command_controller.cc
index 738696abf0..6f63473758 100644
--- a/chrome/browser/ui/browser_command_controller.cc
+++ b/chrome/browser/ui/browser_command_controller.cc
@@ -7,7 +7,9 @@
 #include <stddef.h>
 
 #include <algorithm>
+#include <optional>
 #include <string>
+#include <tuple>
 
 #include "base/check_deref.h"
 #include "base/command_line.h"
@@ -24,10 +26,13 @@
 #include "chrome/app/chrome_command_ids.h"
 #include "chrome/browser/actor/ui/actor_overlay_web_view.h"
 #include "chrome/browser/browser_process.h"
+#include "chrome/browser/browseros/core/browseros_constants.h"
 #include "chrome/browser/browsing_data/browsing_data_important_sites_util.h"
 #include "chrome/browser/defaults.h"
 #include "chrome/browser/devtools/devtools_window.h"
 #include "chrome/browser/devtools/features.h"
+#include "chrome/browser/extensions/api/side_panel/side_panel_service.h"
+#include "chrome/browser/extensions/extension_tab_util.h"
 #include "chrome/browser/feedback/public/feedback_source.h"
 #include "chrome/browser/feedback/show_feedback_page.h"
 #include "chrome/browser/glic/fre/glic_fre_controller.h"
@@ -37,6 +42,7 @@
 #include "chrome/browser/glic/public/glic_enabling.h"
 #include "chrome/browser/glic/public/glic_keyed_service_factory.h"
 #include "chrome/browser/glic/public/service/glic_instance_coordinator.h"
+#include "chrome/browser/infobars/simple_alert_infobar_creator.h"
 #include "chrome/browser/lifetime/application_lifetime.h"
 #include "chrome/browser/prefs/incognito_mode_prefs.h"
 #include "chrome/browser/profiles/profile.h"
@@ -101,6 +107,7 @@
 #include "chrome/common/webui_url_constants.h"
 #include "components/bookmarks/common/bookmark_pref_names.h"
 #include "components/dom_distiller/core/dom_distiller_features.h"
+#include "components/infobars/content/content_infobar_manager.h"
 #include "components/input/native_web_keyboard_event.h"
 #include "components/lens/buildflags.h"
 #include "components/password_manager/core/browser/manage_passwords_referrer.h"
@@ -1089,6 +1096,49 @@ bool BrowserCommandController::ExecuteCommandWithDisposition(
       browser_->GetFeatures().side_panel_ui()->Show(
           SidePanelEntryId::kBookmarks, SidePanelOpenTrigger::kAppMenu);
       break;
+    case IDC_TOGGLE_BROWSEROS_AGENT: {
+      if (!browseros::IsActiveBrowserOSExtension(
+              browseros::kAgentExtensionId)) {
+        break;
+      }
+      content::WebContents* active_contents =
+          browser_->tab_strip_model()->GetActiveWebContents();
+      if (!active_contents) {
+        break;
+      }
+      int tab_id = extensions::ExtensionTabUtil::GetTabId(active_contents);
+      Profile* profile = browser_->profile();
+      const extensions::Extension* extension =
+          extensions::ExtensionRegistry::Get(profile)
+              ->enabled_extensions()
+              .GetByID(browseros::kAgentExtensionId);
+      if (!extension) {
+        infobars::ContentInfoBarManager* infobar_manager =
+            infobars::ContentInfoBarManager::FromWebContents(active_contents);
+        if (infobar_manager) {
+          CreateSimpleAlertInfoBar(
+              infobar_manager,
+              infobars::InfoBarDelegate::
+                  BROWSEROS_AGENT_INSTALLING_INFOBAR_DELEGATE,
+              nullptr,
+              u"BrowserOS Agent is installing/updating. Please try again "
+              u"shortly.",
+              /*auto_expire=*/true,
+              /*should_animate=*/true,
+              /*closeable=*/true);
+        }
+        break;
+      }
+      extensions::SidePanelService* service =
+          extensions::SidePanelService::Get(profile);
+      if (service) {
+        std::ignore = service->BrowserosToggleSidePanelForTab(
+            *extension, profile, tab_id,
+            /*include_incognito_information=*/true,
+            /*desired_state=*/std::nullopt);
+      }
+      break;
+    }
     case IDC_SHOW_APP_MENU:
       base::RecordAction(base::UserMetricsAction("Accel_Show_App_Menu"));
       ShowAppMenu(browser_);
@@ -1802,6 +1852,9 @@ void BrowserCommandController::InitCommandState() {
   }
 
   command_updater_.UpdateCommandEnabled(IDC_SHOW_BOOKMARK_SIDE_PANEL, true);
+  command_updater_.UpdateCommandEnabled(
+      IDC_TOGGLE_BROWSEROS_AGENT,
+      browseros::IsActiveBrowserOSExtension(browseros::kAgentExtensionId));
 
   if (browser_->is_type_normal()) {
     // Reading list commands.
