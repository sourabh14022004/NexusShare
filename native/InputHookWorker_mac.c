// ============================================================================
// NexusShare Native Input Hook & Simulation Worker for macOS
// Uses CoreGraphics (CGEventTap, CGEventPost, CGWarpMouseCursorPosition)
// Compiles with: clang -O2 InputHookWorker_mac.c -framework ApplicationServices -framework CoreGraphics -framework Foundation -o InputHookWorker_mac
// ============================================================================

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdbool.h>
#include <pthread.h>
#include <unistd.h>
#include <math.h>
#include <ApplicationServices/ApplicationServices.h>

// Custom magic value to distinguish our synthetic injected events from physical user inputs
#define INJECTED_USER_DATA 0x53484D53LL // "SHMS"

// State variables
static volatile bool g_isRedirected = false;
static volatile bool g_isLocked = false;
static volatile bool g_running = true;

// Screen geometry (virtual desktop)
static int g_screenLeft = 0;
static int g_screenTop = 0;
static int g_screenWidth = 1920;
static int g_screenHeight = 1080;

// Edge monitoring configuration
static char g_activeEdge[16] = "right"; // "left", "right", "top", "bottom"
static int g_edgeThreshold = 3;

// Previous mouse position to calculate delta
static double g_lastMouseX = -1.0;
static double g_lastMouseY = -1.0;

// Lock anchor position (center of screen)
static double g_anchorX = 960.0;
static double g_anchorY = 540.0;

// Output lock for stdout thread safety
static pthread_mutex_t g_stdoutMutex = PTHREAD_MUTEX_INITIALIZER;

// Event tap references
static CFMachPortRef g_eventTap = NULL;
static CFRunLoopSourceRef g_runLoopSource = NULL;
static CFRunLoopRef g_tapRunLoop = NULL;

// ----------------------------------------------------------------------------
// JSON & Protocol Helpers
// ----------------------------------------------------------------------------

static void send_json(const char *json) {
    pthread_mutex_lock(&g_stdoutMutex);
    printf("%s\n", json);
    fflush(stdout);
    pthread_mutex_unlock(&g_stdoutMutex);
}

static bool get_json_str(const char *json, const char *key, char *out, size_t maxLen) {
    char needle[64];
    snprintf(needle, sizeof(needle), "\"%s\":\"", key);
    const char *start = strstr(json, needle);
    if (!start) return false;
    start += strlen(needle);
    const char *end = strchr(start, '\"');
    if (!end) return false;
    size_t len = end - start;
    if (len >= maxLen) len = maxLen - 1;
    strncpy(out, start, len);
    out[len] = '\0';
    return true;
}

static int get_json_int(const char *json, const char *key, int defVal) {
    char needle[64];
    snprintf(needle, sizeof(needle), "\"%s\":", key);
    const char *start = strstr(json, needle);
    if (!start) return defVal;
    start += strlen(needle);
    while (*start == ' ' || *start == '\t') start++;
    return atoi(start);
}

static bool get_json_bool(const char *json, const char *key, bool defVal) {
    char needle[64];
    snprintf(needle, sizeof(needle), "\"%s\":", key);
    const char *start = strstr(json, needle);
    if (!start) return defVal;
    start += strlen(needle);
    while (*start == ' ' || *start == '\t') start++;
    if (strncmp(start, "true", 4) == 0) return true;
    if (strncmp(start, "false", 5) == 0) return false;
    return defVal;
}

// ----------------------------------------------------------------------------
// Screen Geometry
// ----------------------------------------------------------------------------

static void update_screen_metrics(void) {
    CGDirectDisplayID mainDisplay = CGMainDisplayID();
    CGRect bounds = CGDisplayBounds(mainDisplay);

    // Multi-display bounding box support
    uint32_t displayCount = 0;
    CGGetOnlineDisplayList(0, NULL, &displayCount);
    if (displayCount > 0) {
        CGDirectDisplayID *displays = malloc(displayCount * sizeof(CGDirectDisplayID));
        if (displays) {
            if (CGGetOnlineDisplayList(displayCount, displays, &displayCount) == kCGErrorSuccess) {
                CGRect unionBounds = CGRectNull;
                for (uint32_t i = 0; i < displayCount; i++) {
                    CGRect dBounds = CGDisplayBounds(displays[i]);
                    unionBounds = CGRectUnion(unionBounds, dBounds);
                }
                if (!CGRectIsNull(unionBounds)) {
                    bounds = unionBounds;
                }
            }
            free(displays);
        }
    }

    g_screenLeft = (int)bounds.origin.x;
    g_screenTop = (int)bounds.origin.y;
    g_screenWidth = (int)bounds.size.width;
    g_screenHeight = (int)bounds.size.height;

    if (g_screenWidth <= 0) g_screenWidth = 1920;
    if (g_screenHeight <= 0) g_screenHeight = 1080;

    g_anchorX = g_screenLeft + (g_screenWidth / 2.0);
    g_anchorY = g_screenTop + (g_screenHeight / 2.0);
}

// ----------------------------------------------------------------------------
// Key Code Mappings (macOS CGKeyCode <-> Windows Virtual Keycodes)
// ----------------------------------------------------------------------------

// Map macOS keycode to Windows VK
static int mac_to_win_vk(CGKeyCode macCode) {
    switch (macCode) {
        case 0: return 0x41; // A
        case 1: return 0x53; // S
        case 2: return 0x44; // D
        case 3: return 0x46; // F
        case 4: return 0x48; // H
        case 5: return 0x47; // G
        case 6: return 0x5A; // Z
        case 7: return 0x58; // X
        case 8: return 0x43; // C
        case 9: return 0x56; // V
        case 11: return 0x42; // B
        case 12: return 0x51; // Q
        case 13: return 0x57; // W
        case 14: return 0x45; // E
        case 15: return 0x52; // R
        case 16: return 0x59; // Y
        case 17: return 0x54; // T
        case 18: return 0x31; // 1
        case 19: return 0x32; // 2
        case 20: return 0x33; // 3
        case 21: return 0x34; // 4
        case 22: return 0x36; // 6
        case 23: return 0x35; // 5
        case 24: return 0xBB; // =
        case 25: return 0x39; // 9
        case 26: return 0x37; // 7
        case 27: return 0xBD; // -
        case 28: return 0x38; // 8
        case 29: return 0x30; // 0
        case 30: return 0xDD; // ]
        case 31: return 0x4F; // O
        case 32: return 0x55; // U
        case 33: return 0xDB; // [
        case 34: return 0x49; // I
        case 35: return 0x50; // P
        case 36: return 0x0D; // Return / Enter
        case 37: return 0x4C; // L
        case 38: return 0x4A; // J
        case 39: return 0xDE; // '
        case 40: return 0x4B; // K
        case 41: return 0xBA; // ;
        case 42: return 0xDC; // '\'
        case 43: return 0xBC; // ,
        case 44: return 0xBF; // /
        case 45: return 0x4E; // N
        case 46: return 0x4D; // M
        case 47: return 0xBE; // .
        case 48: return 0x09; // Tab
        case 49: return 0x20; // Space
        case 50: return 0xC0; // `
        case 51: return 0x08; // Backspace
        case 53: return 0x1B; // Escape
        case 55: return 0x5B; // Cmd / Windows key
        case 56: return 0x10; // Shift
        case 57: return 0x14; // CapsLock
        case 58: return 0x12; // Option / Alt
        case 59: return 0x11; // Control
        case 123: return 0x25; // Left
        case 124: return 0x27; // Right
        case 125: return 0x28; // Down
        case 126: return 0x26; // Up
        case 115: return 0x24; // Home
        case 119: return 0x23; // End
        case 116: return 0x21; // PageUp
        case 121: return 0x22; // PageDown
        case 117: return 0x2E; // Delete
        case 122: return 0x70; // F1
        case 120: return 0x71; // F2
        case 99: return 0x72;  // F3
        case 118: return 0x73; // F4
        case 96: return 0x74;  // F5
        case 97: return 0x75;  // F6
        case 98: return 0x76;  // F7
        case 100: return 0x77; // F8
        case 101: return 0x78; // F9
        case 109: return 0x79; // F10
        case 103: return 0x7A; // F11
        case 111: return 0x7B; // F12
        case 107: return 0x91; // ScrollLock / F14
        case 113: return 0x13; // Pause / F15
        default: return (int)macCode;
    }
}

// Map Windows VK to macOS keycode
static CGKeyCode win_to_mac_vk(int vk) {
    switch (vk) {
        case 0x41: return 0;  // A
        case 0x53: return 1;  // S
        case 0x44: return 2;  // D
        case 0x46: return 3;  // F
        case 0x48: return 4;  // H
        case 0x47: return 5;  // G
        case 0x5A: return 6;  // Z
        case 0x58: return 7;  // X
        case 0x43: return 8;  // C
        case 0x56: return 9;  // V
        case 0x42: return 11; // B
        case 0x51: return 12; // Q
        case 0x57: return 13; // W
        case 0x45: return 14; // E
        case 0x52: return 15; // R
        case 0x59: return 16; // Y
        case 0x54: return 17; // T
        case 0x31: return 18; // 1
        case 0x32: return 19; // 2
        case 0x33: return 20; // 3
        case 0x34: return 21; // 4
        case 0x36: return 22; // 6
        case 0x35: return 23; // 5
        case 0xBB: return 24; // =
        case 0x39: return 25; // 9
        case 0x37: return 26; // 7
        case 0xBD: return 27; // -
        case 0x38: return 28; // 8
        case 0x30: return 29; // 0
        case 0xDD: return 30; // ]
        case 0x4F: return 31; // O
        case 0x55: return 32; // U
        case 0xDB: return 33; // [
        case 0x49: return 34; // I
        case 0x50: return 35; // P
        case 0x0D: return 36; // Return
        case 0x4C: return 37; // L
        case 0x4A: return 38; // J
        case 0xDE: return 39; // '
        case 0x4B: return 40; // K
        case 0xBA: return 41; // ;
        case 0xDC: return 42; // '\'
        case 0xBC: return 43; // ,
        case 0xBF: return 44; // /
        case 0x4E: return 45; // N
        case 0x4D: return 46; // M
        case 0xBE: return 47; // .
        case 0x09: return 48; // Tab
        case 0x20: return 49; // Space
        case 0xC0: return 50; // `
        case 0x08: return 51; // Backspace
        case 0x1B: return 53; // Escape
        case 0x5B:
        case 0x5C: return 55; // Cmd
        case 0x10: return 56; // Shift
        case 0x14: return 57; // CapsLock
        case 0x12: return 58; // Option / Alt
        case 0x11: return 59; // Control
        case 0x25: return 123; // Left
        case 0x27: return 124; // Right
        case 0x28: return 125; // Down
        case 0x26: return 126; // Up
        case 0x24: return 115; // Home
        case 0x23: return 119; // End
        case 0x21: return 116; // PageUp
        case 0x22: return 121; // PageDown
        case 0x2E: return 117; // Delete
        case 0x70: return 122; // F1
        case 0x71: return 120; // F2
        case 0x72: return 99;  // F3
        case 0x73: return 118; // F4
        case 0x74: return 96;  // F5
        case 0x75: return 97;  // F6
        case 0x76: return 98;  // F7
        case 0x77: return 100; // F8
        case 0x78: return 101; // F9
        case 0x79: return 109; // F10
        case 0x7A: return 103; // F11
        case 0x7B: return 111; // F12
        case 0x91: return 107; // ScrollLock
        case 0x13: return 113; // Pause
        default: return (CGKeyCode)(vk < 128 ? vk : 0);
    }
}

// ----------------------------------------------------------------------------
// CoreGraphics Event Tap Callback
// ----------------------------------------------------------------------------

static CGEventRef event_tap_callback(CGEventTapProxy proxy, CGEventType type, CGEventRef event, void *refcon) {
    // If event tap is disabled by macOS due to timeout, re-enable it immediately
    if (type == kCGEventTapDisabledByTimeout || type == kCGEventTapDisabledByUserInput) {
        if (g_eventTap) {
            CGEventTapEnable(g_eventTap, true);
        }
        return event;
    }

    // Ignore synthetic injected events generated by our simulation engine
    int64_t userData = CGEventGetIntegerValueField(event, kCGEventSourceUserData);
    if (userData == INJECTED_USER_DATA) {
        return event;
    }

    CGPoint pt = CGEventGetLocation(event);
    double x = pt.x;
    double y = pt.y;

    // Check emergency unlock key combinations: Escape, Pause, or ScrollLock
    if (type == kCGEventKeyDown) {
        CGKeyCode keycode = (CGKeyCode)CGEventGetIntegerValueField(event, kCGKeyboardEventKeycode);
        if (keycode == 53 || keycode == 107 || keycode == 113) { // Escape, F14/ScrollLock, F15/Pause
            if (g_isRedirected || g_isLocked) {
                g_isRedirected = false;
                g_isLocked = false;
                char buf[128];
                snprintf(buf, sizeof(buf), "{\"type\":\"emergency_unlock\",\"vk\":%d}", mac_to_win_vk(keycode));
                send_json(buf);
                return NULL; // Suppress key
            }
        }
    }

    if (g_isRedirected) {
        // In REDIRECTED mode: capture user input, stream to remote, and suppress locally
        if (type == kCGEventMouseMoved || type == kCGEventLeftMouseDragged || type == kCGEventRightMouseDragged || type == kCGEventOtherMouseDragged) {
            int dx = (int)CGEventGetIntegerValueField(event, kCGMouseEventDeltaX);
            int dy = (int)CGEventGetIntegerValueField(event, kCGMouseEventDeltaY);

            // If system delta is zero, compute delta from previous position
            if (dx == 0 && dy == 0 && g_lastMouseX >= 0 && g_lastMouseY >= 0) {
                dx = (int)(x - g_lastMouseX);
                dy = (int)(y - g_lastMouseY);
            }

            g_lastMouseX = x;
            g_lastMouseY = y;

            // Park cursor near screen center if it drifts far, so it doesn't trigger macOS corners or menubar
            if (fabs(x - g_anchorX) > 250 || fabs(y - g_anchorY) > 250) {
                CGWarpMouseCursorPosition(CGPointMake(g_anchorX, g_anchorY));
                g_lastMouseX = g_anchorX;
                g_lastMouseY = g_anchorY;
            }

            if (dx != 0 || dy != 0) {
                char buf[256];
                snprintf(buf, sizeof(buf), "{\"type\":\"mouse_move\",\"dx\":%d,\"dy\":%d,\"x\":%d,\"y\":%d}", dx, dy, (int)x, (int)y);
                send_json(buf);
            }
            return NULL; // Suppress local cursor movement
        }
        else if (type == kCGEventLeftMouseDown) {
            send_json("{\"type\":\"mouse_button\",\"button\":\"left\",\"down\":true}");
            return NULL;
        }
        else if (type == kCGEventLeftMouseUp) {
            send_json("{\"type\":\"mouse_button\",\"button\":\"left\",\"down\":false}");
            return NULL;
        }
        else if (type == kCGEventRightMouseDown) {
            send_json("{\"type\":\"mouse_button\",\"button\":\"right\",\"down\":true}");
            return NULL;
        }
        else if (type == kCGEventRightMouseUp) {
            send_json("{\"type\":\"mouse_button\",\"button\":\"right\",\"down\":false}");
            return NULL;
        }
        else if (type == kCGEventOtherMouseDown) {
            send_json("{\"type\":\"mouse_button\",\"button\":\"middle\",\"down\":true}");
            return NULL;
        }
        else if (type == kCGEventOtherMouseUp) {
            send_json("{\"type\":\"mouse_button\",\"button\":\"middle\",\"down\":false}");
            return NULL;
        }
        else if (type == kCGEventScrollWheel) {
            int64_t deltaY = CGEventGetIntegerValueField(event, kCGScrollWheelEventDeltaAxis1);
            int64_t deltaX = CGEventGetIntegerValueField(event, kCGScrollWheelEventDeltaAxis2);
            if (deltaY != 0) {
                char buf[128];
                snprintf(buf, sizeof(buf), "{\"type\":\"mouse_wheel\",\"delta\":%d,\"horizontal\":false}", (int)(deltaY * 120));
                send_json(buf);
            }
            if (deltaX != 0) {
                char buf[128];
                snprintf(buf, sizeof(buf), "{\"type\":\"mouse_wheel\",\"delta\":%d,\"horizontal\":true}", (int)(deltaX * 120));
                send_json(buf);
            }
            return NULL; // Suppress local scrolling
        }
        else if (type == kCGEventKeyDown || type == kCGEventKeyUp) {
            CGKeyCode keycode = (CGKeyCode)CGEventGetIntegerValueField(event, kCGKeyboardEventKeycode);
            int vk = mac_to_win_vk(keycode);
            bool isDown = (type == kCGEventKeyDown);
            char buf[160];
            snprintf(buf, sizeof(buf), "{\"type\":\"key\",\"vk\":%d,\"scan\":%d,\"down\":%s,\"extended\":false}",
                     vk, (int)keycode, isDown ? "true" : "false");
            send_json(buf);
            return NULL; // Suppress local keystroke
        }
    }
    else {
        // LOCAL mode: monitor edge boundaries to trigger transitions
        if (!g_isLocked && (type == kCGEventMouseMoved || type == kCGEventLeftMouseDragged)) {
            bool hitEdge = false;
            const char *hitEdgeName = "";

            if (strcmp(g_activeEdge, "right") == 0 && x >= (g_screenLeft + g_screenWidth - g_edgeThreshold)) {
                hitEdge = true;
                hitEdgeName = "right";
            } else if (strcmp(g_activeEdge, "left") == 0 && x <= (g_screenLeft + g_edgeThreshold)) {
                hitEdge = true;
                hitEdgeName = "left";
            } else if (strcmp(g_activeEdge, "top") == 0 && y <= (g_screenTop + g_edgeThreshold)) {
                hitEdge = true;
                hitEdgeName = "top";
            } else if (strcmp(g_activeEdge, "bottom") == 0 && y >= (g_screenTop + g_screenHeight - g_edgeThreshold)) {
                hitEdge = true;
                hitEdgeName = "bottom";
            }

            if (hitEdge) {
                char buf[256];
                snprintf(buf, sizeof(buf), "{\"type\":\"edge_hit\",\"edge\":\"%s\",\"x\":%d,\"y\":%d,\"screen\":{\"width\":%d,\"height\":%d}}",
                         hitEdgeName, (int)x, (int)y, g_screenWidth, g_screenHeight);
                send_json(buf);
            }

            g_lastMouseX = x;
            g_lastMouseY = y;
        }
    }

    return event;
}

// ----------------------------------------------------------------------------
// Event Tap Thread Loop
// ----------------------------------------------------------------------------

static void *event_tap_thread(void *arg) {
    CGEventMask eventMask = (
        CGEventMaskBit(kCGEventMouseMoved) |
        CGEventMaskBit(kCGEventLeftMouseDown) |
        CGEventMaskBit(kCGEventLeftMouseUp) |
        CGEventMaskBit(kCGEventRightMouseDown) |
        CGEventMaskBit(kCGEventRightMouseUp) |
        CGEventMaskBit(kCGEventOtherMouseDown) |
        CGEventMaskBit(kCGEventOtherMouseUp) |
        CGEventMaskBit(kCGEventLeftMouseDragged) |
        CGEventMaskBit(kCGEventRightMouseDragged) |
        CGEventMaskBit(kCGEventOtherMouseDragged) |
        CGEventMaskBit(kCGEventScrollWheel) |
        CGEventMaskBit(kCGEventKeyDown) |
        CGEventMaskBit(kCGEventKeyUp)
    );

    // Create session event tap
    g_eventTap = CGEventTapCreate(
        kCGSessionEventTap,
        kCGHeadInsertEventTap,
        kCGEventTapOptionDefault,
        eventMask,
        event_tap_callback,
        NULL
    );

    if (!g_eventTap) {
        send_json("{\"type\":\"error\",\"message\":\"Failed to create CGEventTap. Ensure Accessibility permissions are granted in System Settings > Privacy & Security > Accessibility.\"}");
        return NULL;
    }

    g_runLoopSource = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, g_eventTap, 0);
    g_tapRunLoop = CFRunLoopGetCurrent();
    CFRunLoopAddSource(g_tapRunLoop, g_runLoopSource, kCFRunLoopCommonModes);
    CGEventTapEnable(g_eventTap, true);

    CFRunLoopRun();

    return NULL;
}

// ----------------------------------------------------------------------------
// Command Handler (stdin processing)
// ----------------------------------------------------------------------------

static void handle_command(const char *json) {
    char cmd[64];
    if (!get_json_str(json, "cmd", cmd, sizeof(cmd))) return;

    if (strcmp(cmd, "ping") == 0) {
        send_json("{\"type\":\"pong\"}");
    }
    else if (strcmp(cmd, "get_screen") == 0) {
        update_screen_metrics();
        char buf[256];
        snprintf(buf, sizeof(buf), "{\"type\":\"screen\",\"screen\":{\"left\":%d,\"top\":%d,\"width\":%d,\"height\":%d}}",
                 g_screenLeft, g_screenTop, g_screenWidth, g_screenHeight);
        send_json(buf);
    }
    else if (strcmp(cmd, "set_mode") == 0) {
        char mode[32];
        get_json_str(json, "mode", mode, sizeof(mode));
        bool redirect = (strcmp(mode, "redirect") == 0);
        g_isRedirected = redirect;

        if (redirect) {
            CGEventRef ev = CGEventCreate(NULL);
            if (ev) {
                CGPoint cur = CGEventGetLocation(ev);
                g_lastMouseX = cur.x;
                g_lastMouseY = cur.y;
                CFRelease(ev);
            }
        }

        char buf[128];
        snprintf(buf, sizeof(buf), "{\"type\":\"mode_changed\",\"mode\":\"%s\"}", redirect ? "redirect" : "local");
        send_json(buf);
    }
    else if (strcmp(cmd, "set_lock") == 0) {
        g_isLocked = get_json_bool(json, "locked", false);
        char buf[128];
        snprintf(buf, sizeof(buf), "{\"type\":\"lock_changed\",\"locked\":%s}", g_isLocked ? "true" : "false");
        send_json(buf);
    }
    else if (strcmp(cmd, "set_edge") == 0) {
        get_json_str(json, "edge", g_activeEdge, sizeof(g_activeEdge));
        g_edgeThreshold = get_json_int(json, "threshold", 3);
        char buf[160];
        snprintf(buf, sizeof(buf), "{\"type\":\"edge_configured\",\"edge\":\"%s\",\"threshold\":%d}", g_activeEdge, g_edgeThreshold);
        send_json(buf);
    }
    else if (strcmp(cmd, "inject_mouse_pos") == 0) {
        int x = get_json_int(json, "x", 0);
        int y = get_json_int(json, "y", 0);
        CGWarpMouseCursorPosition(CGPointMake(x, y));
    }
    else if (strcmp(cmd, "inject_mouse_delta") == 0) {
        int dx = get_json_int(json, "dx", 0);
        int dy = get_json_int(json, "dy", 0);

        CGEventRef evCur = CGEventCreate(NULL);
        if (evCur) {
            CGPoint cur = CGEventGetLocation(evCur);
            CFRelease(evCur);
            CGPoint target = CGPointMake(cur.x + dx, cur.y + dy);

            CGEventRef evMove = CGEventCreateMouseEvent(NULL, kCGEventMouseMoved, target, kCGMouseButtonLeft);
            if (evMove) {
                CGEventSetIntegerValueField(evMove, kCGEventSourceUserData, INJECTED_USER_DATA);
                CGEventPost(kCGHIDEventTap, evMove);
                CFRelease(evMove);
            }
        }
    }
    else if (strcmp(cmd, "inject_mouse_button") == 0) {
        char btn[32];
        get_json_str(json, "button", btn, sizeof(btn));
        bool down = get_json_bool(json, "down", true);

        CGEventType evType;
        CGMouseButton btnType = kCGMouseButtonLeft;
        if (strcmp(btn, "right") == 0) {
            evType = down ? kCGEventRightMouseDown : kCGEventRightMouseUp;
            btnType = kCGMouseButtonRight;
        } else if (strcmp(btn, "middle") == 0) {
            evType = down ? kCGEventOtherMouseDown : kCGEventOtherMouseUp;
            btnType = kCGMouseButtonCenter;
        } else {
            evType = down ? kCGEventLeftMouseDown : kCGEventLeftMouseUp;
            btnType = kCGMouseButtonLeft;
        }

        CGEventRef evCur = CGEventCreate(NULL);
        CGPoint cur = evCur ? CGEventGetLocation(evCur) : CGPointMake(g_anchorX, g_anchorY);
        if (evCur) CFRelease(evCur);

        CGEventRef evBtn = CGEventCreateMouseEvent(NULL, evType, cur, btnType);
        if (evBtn) {
            CGEventSetIntegerValueField(evBtn, kCGEventSourceUserData, INJECTED_USER_DATA);
            CGEventPost(kCGHIDEventTap, evBtn);
            CFRelease(evBtn);
        }
    }
    else if (strcmp(cmd, "inject_mouse_wheel") == 0) {
        int delta = get_json_int(json, "delta", 0);
        bool horizontal = get_json_bool(json, "horizontal", false);

        int32_t clicks = delta / 120;
        if (clicks == 0) clicks = (delta > 0) ? 1 : -1;

        CGEventRef evWheel = CGEventCreateScrollWheelEvent2(NULL, kCGScrollEventUnitLine, horizontal ? 2 : 1, clicks, 0);
        if (evWheel) {
            CGEventSetIntegerValueField(evWheel, kCGEventSourceUserData, INJECTED_USER_DATA);
            CGEventPost(kCGHIDEventTap, evWheel);
            CFRelease(evWheel);
        }
    }
    else if (strcmp(cmd, "inject_key") == 0) {
        int vk = get_json_int(json, "vk", 0);
        bool down = get_json_bool(json, "down", true);
        CGKeyCode macKey = win_to_mac_vk(vk);

        CGEventRef evKey = CGEventCreateKeyboardEvent(NULL, macKey, down);
        if (evKey) {
            CGEventSetIntegerValueField(evKey, kCGEventSourceUserData, INJECTED_USER_DATA);
            CGEventPost(kCGHIDEventTap, evKey);
            CFRelease(evKey);
        }
    }
    else if (strcmp(cmd, "exit") == 0) {
        g_running = false;
        if (g_tapRunLoop) CFRunLoopStop(g_tapRunLoop);
        exit(0);
    }
}

// ----------------------------------------------------------------------------
// Main Entry Point
// ----------------------------------------------------------------------------

int main(int argc, char *argv[]) {
    update_screen_metrics();

    // Check accessibility authorization
    const void *keys[] = { kAXTrustedCheckOptionPrompt };
    const void *values[] = { kCFBooleanTrue };
    CFDictionaryRef options = CFDictionaryCreate(kCFAllocatorDefault, keys, values, 1, &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
    Boolean isTrusted = AXIsProcessTrustedWithOptions(options);
    if (options) CFRelease(options);
    if (!isTrusted) {
        fprintf(stderr, "Accessibility permission prompt displayed. Grant permissions in System Settings > Privacy & Security > Accessibility.\n");
    }

    // Launch background thread for CoreGraphics event tap
    pthread_t thread;
    if (pthread_create(&thread, NULL, event_tap_thread, NULL) != 0) {
        send_json("{\"type\":\"error\",\"message\":\"Failed to create event tap thread\"}");
        return 1;
    }

    // Announce ready to Node.js / Electron main process
    char readyBuf[256];
    snprintf(readyBuf, sizeof(readyBuf), "{\"type\":\"ready\",\"screen\":{\"left\":%d,\"top\":%d,\"width\":%d,\"height\":%d}}",
             g_screenLeft, g_screenTop, g_screenWidth, g_screenHeight);
    send_json(readyBuf);

    // Read commands from stdin
    char line[2048];
    while (g_running && fgets(line, sizeof(line), stdin)) {
        size_t len = strlen(line);
        while (len > 0 && (line[len - 1] == '\r' || line[len - 1] == '\n')) {
            line[--len] = '\0';
        }
        if (len == 0) continue;

        handle_command(line);
    }

    if (g_tapRunLoop) CFRunLoopStop(g_tapRunLoop);
    pthread_join(thread, NULL);
    return 0;
}
