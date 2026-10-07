#import <Cocoa/Cocoa.h>
#include <node_api.h>
#include <stdint.h>
#include <string.h>

// Electron supplies its own NSView handle. Never search or alter another window.
static NSWindow *WindowFromHandle(napi_env env, napi_value handle) {
  bool isBuffer = false;
  void *bytes = NULL;
  size_t length = 0;
  if (napi_is_buffer(env, handle, &isBuffer) != napi_ok || !isBuffer ||
      napi_get_buffer_info(env, handle, &bytes, &length) != napi_ok ||
      length != sizeof(uintptr_t)) return nil;
  uintptr_t pointer = 0;
  memcpy(&pointer, bytes, sizeof(pointer));
  if (!pointer) return nil;
  NSView *view = (__bridge NSView *)(void *)pointer;
  return view.window;
}

static void OnMainThread(void (^action)(void)) {
  if ([NSThread isMainThread]) action();
  else dispatch_sync(dispatch_get_main_queue(), action);
}

static napi_value SetMini(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value args[2], result;
  bool compact = false;
  __block bool applied = false;
  napi_get_cb_info(env, info, &argc, args, NULL, NULL);
  if (argc == 2 && napi_get_value_bool(env, args[1], &compact) == napi_ok) {
    napi_value handle = args[0];
    @try {
      OnMainThread(^{
        NSWindow *window = WindowFromHandle(env, handle);
        NSButton *zoom = [window standardWindowButton:NSWindowZoomButton];
        if (window && zoom) {
          // Keep native close/minimize appearance, accessibility and hover behavior.
          zoom.hidden = compact;
          zoom.enabled = !compact;
          applied = true;
        }
      });
    } @catch (NSException *exception) { applied = false; }
  }
  napi_get_boolean(env, applied, &result);
  return result;
}

// Main-process diagnostics for verifying native chrome without exposing handles.
static napi_value Snapshot(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value handle, result;
  napi_get_cb_info(env, info, &argc, &handle, NULL, NULL);
  napi_create_object(env, &result);
  if (argc != 1) return result;
  @try {
    OnMainThread(^{
      NSWindow *window = WindowFromHandle(env, handle);
      NSWindowButton kinds[] = {NSWindowCloseButton, NSWindowMiniaturizeButton, NSWindowZoomButton};
      const char *names[] = {"close", "minimize", "zoom"};
      for (int i = 0; window && i < 3; i++) {
        NSButton *button = [window standardWindowButton:kinds[i]];
        napi_value entry, hidden, enabled;
        napi_create_object(env, &entry);
        napi_get_boolean(env, button.hidden, &hidden);
        napi_get_boolean(env, button.enabled, &enabled);
        napi_set_named_property(env, entry, "hidden", hidden);
        napi_set_named_property(env, entry, "enabled", enabled);
        NSRect rect = [window.contentView convertRect:button.bounds fromView:button];
        const char *keys[] = {"x", "y", "width", "height"};
        double values[] = {rect.origin.x, rect.origin.y, rect.size.width, rect.size.height};
        for (int j = 0; j < 4; j++) {
          napi_value number;
          napi_create_double(env, values[j], &number);
          napi_set_named_property(env, entry, keys[j], number);
        }
        napi_set_named_property(env, result, names[i], entry);
      }
    });
  } @catch (NSException *exception) {}
  return result;
}

static napi_value Init(napi_env env, napi_value exports) {
  napi_property_descriptor properties[] = {
    {"setMini", NULL, SetMini, NULL, NULL, NULL, napi_default, NULL},
    {"snapshot", NULL, Snapshot, NULL, NULL, NULL, napi_default, NULL}
  };
  napi_define_properties(env, exports, 2, properties);
  return exports;
}
NAPI_MODULE(window_controls, Init)
