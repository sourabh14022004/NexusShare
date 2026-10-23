using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

namespace NexusShare.Native
{
    class Program
    {
        private const int WH_MOUSE_LL = 14;
        private const int WH_KEYBOARD_LL = 13;

        private const int WM_MOUSEMOVE = 0x0200;
        private const int WM_LBUTTONDOWN = 0x0201;
        private const int WM_LBUTTONUP = 0x0202;
        private const int WM_RBUTTONDOWN = 0x0204;
        private const int WM_RBUTTONUP = 0x0205;
        private const int WM_MBUTTONDOWN = 0x0207;
        private const int WM_MBUTTONUP = 0x0208;
        private const int WM_MOUSEWHEEL = 0x020A;
        private const int WM_MOUSEHWHEEL = 0x020E;
        private const int WM_XBUTTONDOWN = 0x020B;
        private const int WM_XBUTTONUP = 0x020C;

        private const int WM_KEYDOWN = 0x0100;
        private const int WM_KEYUP = 0x0101;
        private const int WM_SYSKEYDOWN = 0x0104;
        private const int WM_SYSKEYUP = 0x0105;

        private const int VK_SCROLL = 0x91; // Scroll Lock
        private const int VK_PAUSE = 0x13;  // Pause/Break
        private const int VK_ESCAPE = 0x1B;

        // Custom magic value to distinguish our injected events from physical user inputs
        private static readonly IntPtr INJECTED_EXTRA_INFO = new IntPtr(0x53484D53); // "SHMS"

        private static IntPtr _mouseHookID = IntPtr.Zero;
        private static IntPtr _keyboardHookID = IntPtr.Zero;
        private static LowLevelProc _mouseProc = MouseHookCallback;
        private static LowLevelProc _keyboardProc = KeyboardHookCallback;

        // State variables
        private static volatile bool _isRedirected = false;
        private static volatile bool _isLocked = false;
        private static volatile bool _running = true;

        // Screen geometry
        private static int _screenWidth = 1920;
        private static int _screenHeight = 1080;
        private static int _screenLeft = 0;
        private static int _screenTop = 0;

        // Edge monitoring configuration
        private static string _activeEdge = "right"; // "left", "right", "top", "bottom"
        private static int _edgeThreshold = 2; // pixels from boundary

        // Previous mouse position to calculate delta
        private static int _lastMouseX = -1;
        private static int _lastMouseY = -1;

        // Lock anchor position (center of screen or edge)
        private static int _anchorX = 960;
        private static int _anchorY = 540;

        private delegate IntPtr LowLevelProc(int nCode, IntPtr wParam, IntPtr lParam);

        [StructLayout(LayoutKind.Sequential)]
        private struct POINT
        {
            public int x;
            public int y;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct MSLLHOOKSTRUCT
        {
            public POINT pt;
            public uint mouseData;
            public uint flags;
            public uint time;
            public IntPtr dwExtraInfo;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct KBDLLHOOKSTRUCT
        {
            public uint vkCode;
            public uint scanCode;
            public uint flags;
            public uint time;
            public IntPtr dwExtraInfo;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct MOUSEINPUT
        {
            public int dx;
            public int dy;
            public uint mouseData;
            public uint dwFlags;
            public uint time;
            public IntPtr dwExtraInfo;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct KEYBDINPUT
        {
            public ushort wVk;
            public ushort wScan;
            public uint dwFlags;
            public uint time;
            public IntPtr dwExtraInfo;
        }

        [StructLayout(LayoutKind.Explicit)]
        private struct INPUT_UNION
        {
            [FieldOffset(0)]
            public MOUSEINPUT mi;
            [FieldOffset(0)]
            public KEYBDINPUT ki;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct INPUT
        {
            public uint type;
            public INPUT_UNION u;
        }

        private const uint INPUT_MOUSE = 0;
        private const uint INPUT_KEYBOARD = 1;

        private const uint MOUSEEVENTF_MOVE = 0x0001;
        private const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
        private const uint MOUSEEVENTF_LEFTUP = 0x0004;
        private const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
        private const uint MOUSEEVENTF_RIGHTUP = 0x0010;
        private const uint MOUSEEVENTF_MIDDLEDOWN = 0x0020;
        private const uint MOUSEEVENTF_MIDDLEUP = 0x0040;
        private const uint MOUSEEVENTF_XDOWN = 0x0080;
        private const uint MOUSEEVENTF_XUP = 0x0100;
        private const uint MOUSEEVENTF_WHEEL = 0x0800;
        private const uint MOUSEEVENTF_HWHEEL = 0x1000;
        private const uint MOUSEEVENTF_ABSOLUTE = 0x8000;

        private const uint KEYEVENTF_EXTENDEDKEY = 0x0001;
        private const uint KEYEVENTF_KEYUP = 0x0002;
        private const uint KEYEVENTF_SCANCODE = 0x0008;

        [DllImport("user32.dll", SetLastError = true)]
        private static extern IntPtr SetWindowsHookEx(int idHook, LowLevelProc lpfn, IntPtr hMod, uint dwThreadId);

        [DllImport("user32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool UnhookWindowsHookEx(IntPtr hhk);

        [DllImport("user32.dll")]
        private static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

        [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        private static extern IntPtr GetModuleHandle(string lpModuleName);

        [DllImport("user32.dll")]
        private static extern int GetSystemMetrics(int nIndex);

        [DllImport("user32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool SetCursorPos(int X, int Y);

        [DllImport("user32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool GetCursorPos(out POINT lpPoint);

        [DllImport("user32.dll", SetLastError = true)]
        private static extern uint SendInput(uint nInputs, [MarshalAs(UnmanagedType.LPArray), In] INPUT[] pInputs, int cbSize);

        [DllImport("user32.dll")]
        private static extern int GetMessage(out MSG lpMsg, IntPtr hWnd, uint wMsgFilterMin, uint wMsgFilterMax);

        [DllImport("user32.dll")]
        private static extern bool TranslateMessage([In] ref MSG lpMsg);

        [DllImport("user32.dll")]
        private static extern IntPtr DispatchMessage([In] ref MSG lpMsg);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool PostThreadMessage(uint idThread, uint Msg, IntPtr wParam, IntPtr lParam);

        [DllImport("kernel32.dll")]
        private static extern uint GetCurrentThreadId();

        [StructLayout(LayoutKind.Sequential)]
        private struct MSG
        {
            public IntPtr hwnd;
            public uint message;
            public IntPtr wParam;
            public IntPtr lParam;
            public uint time;
            public POINT pt;
        }

        private static uint _hookThreadId = 0;

        static void Main(string[] args)
        {
            Console.OutputEncoding = Encoding.UTF8;

            UpdateScreenMetrics();

            // Start hook message loop on a background STA thread
            var hookThread = new Thread(RunHookLoop);
            hookThread.IsBackground = true;
            hookThread.SetApartmentState(ApartmentState.STA);
            hookThread.Start();

            // Announce ready
            SendJson("{\"type\":\"ready\",\"screen\":{\"left\":" + _screenLeft + ",\"top\":" + _screenTop + ",\"width\":" + _screenWidth + ",\"height\":" + _screenHeight + "}}");

            // Process commands from stdin
            string line;
            while (_running && (line = Console.ReadLine()) != null)
            {
                line = line.Trim();
                if (string.IsNullOrEmpty(line)) continue;

                try
                {
                    HandleCommand(line);
                }
                catch (Exception ex)
                {
                    SendJson("{\"type\":\"error\",\"message\":" + EscapeJson(ex.Message) + "}");
                }
            }

            UnhookAll();
        }

        private static void UpdateScreenMetrics()
        {
            // Virtual screen bounds (encompasses multi-monitor setups if any)
            _screenLeft = GetSystemMetrics(76); // SM_XVIRTUALSCREEN
            _screenTop = GetSystemMetrics(77);  // SM_YVIRTUALSCREEN
            _screenWidth = GetSystemMetrics(78); // SM_CXVIRTUALSCREEN
            _screenHeight = GetSystemMetrics(79); // SM_CYVIRTUALSCREEN

            if (_screenWidth <= 0) _screenWidth = GetSystemMetrics(0); // SM_CXSCREEN
            if (_screenHeight <= 0) _screenHeight = GetSystemMetrics(1); // SM_CYSCREEN

            _anchorX = _screenLeft + (_screenWidth / 2);
            _anchorY = _screenTop + (_screenHeight / 2);
        }

        private static void RunHookLoop()
        {
            _hookThreadId = GetCurrentThreadId();

            using (Process curProcess = Process.GetCurrentProcess())
            using (ProcessModule curModule = curProcess.MainModule)
            {
                IntPtr hModule = GetModuleHandle(curModule.ModuleName);
                _mouseHookID = SetWindowsHookEx(WH_MOUSE_LL, _mouseProc, hModule, 0);
                _keyboardHookID = SetWindowsHookEx(WH_KEYBOARD_LL, _keyboardProc, hModule, 0);
            }

            MSG msg;
            while (GetMessage(out msg, IntPtr.Zero, 0, 0) > 0)
            {
                TranslateMessage(ref msg);
                DispatchMessage(ref msg);
            }

            UnhookAll();
        }

        private static void UnhookAll()
        {
            if (_mouseHookID != IntPtr.Zero)
            {
                UnhookWindowsHookEx(_mouseHookID);
                _mouseHookID = IntPtr.Zero;
            }
            if (_keyboardHookID != IntPtr.Zero)
            {
                UnhookWindowsHookEx(_keyboardHookID);
                _keyboardHookID = IntPtr.Zero;
            }
        }

        private static void HandleCommand(string json)
        {
            // Simple fast JSON parser for known command structure
            string cmd = GetJsonValue(json, "cmd");

            if (cmd == "ping")
            {
                SendJson("{\"type\":\"pong\"}");
            }
            else if (cmd == "get_screen")
            {
                UpdateScreenMetrics();
                SendJson("{\"type\":\"screen\",\"screen\":{\"left\":" + _screenLeft + ",\"top\":" + _screenTop + ",\"width\":" + _screenWidth + ",\"height\":" + _screenHeight + "}}");
            }
            else if (cmd == "set_mode")
            {
                string mode = GetJsonValue(json, "mode");
                bool redirect = (mode == "redirect");
                _isRedirected = redirect;

                if (redirect)
                {
                    // Remember current mouse pos before redirection starts
                    POINT pt;
                    if (GetCursorPos(out pt))
                    {
                        _lastMouseX = pt.x;
                        _lastMouseY = pt.y;
                    }
                }

                SendJson("{\"type\":\"mode_changed\",\"mode\":\"" + (redirect ? "redirect" : "local") + "\"}");
            }
            else if (cmd == "set_lock")
            {
                _isLocked = GetJsonBool(json, "locked", false);
                SendJson("{\"type\":\"lock_changed\",\"locked\":" + (_isLocked ? "true" : "false") + "}");
            }
            else if (cmd == "set_edge")
            {
                _activeEdge = GetJsonValue(json, "edge"); // "left", "right", "top", "bottom"
                _edgeThreshold = GetJsonInt(json, "threshold", 2);
                SendJson("{\"type\":\"edge_configured\",\"edge\":\"" + _activeEdge + "\",\"threshold\":" + _edgeThreshold + "}");
            }
            else if (cmd == "inject_mouse_pos")
            {
                int x = GetJsonInt(json, "x", 0);
                int y = GetJsonInt(json, "y", 0);
                SetCursorPos(x, y);
            }
            else if (cmd == "inject_mouse_delta")
            {
                int dx = GetJsonInt(json, "dx", 0);
                int dy = GetJsonInt(json, "dy", 0);

                INPUT[] inputs = new INPUT[1];
                inputs[0].type = INPUT_MOUSE;
                inputs[0].u.mi.dx = dx;
                inputs[0].u.mi.dy = dy;
                inputs[0].u.mi.dwFlags = MOUSEEVENTF_MOVE;
                inputs[0].u.mi.dwExtraInfo = INJECTED_EXTRA_INFO;
                SendInput(1, inputs, Marshal.SizeOf(typeof(INPUT)));
            }
            else if (cmd == "inject_mouse_button")
            {
                string btn = GetJsonValue(json, "button");
                bool down = GetJsonBool(json, "down", true);
                uint flag = 0;

                if (btn == "left") flag = down ? MOUSEEVENTF_LEFTDOWN : MOUSEEVENTF_LEFTUP;
                else if (btn == "right") flag = down ? MOUSEEVENTF_RIGHTDOWN : MOUSEEVENTF_RIGHTUP;
                else if (btn == "middle") flag = down ? MOUSEEVENTF_MIDDLEDOWN : MOUSEEVENTF_MIDDLEUP;

                if (flag != 0)
                {
                    INPUT[] inputs = new INPUT[1];
                    inputs[0].type = INPUT_MOUSE;
                    inputs[0].u.mi.dwFlags = flag;
                    inputs[0].u.mi.dwExtraInfo = INJECTED_EXTRA_INFO;
                    SendInput(1, inputs, Marshal.SizeOf(typeof(INPUT)));
                }
            }
            else if (cmd == "inject_mouse_wheel")
            {
                int delta = GetJsonInt(json, "delta", 0);
                bool horizontal = GetJsonBool(json, "horizontal", false);

                INPUT[] inputs = new INPUT[1];
                inputs[0].type = INPUT_MOUSE;
                inputs[0].u.mi.dwFlags = horizontal ? MOUSEEVENTF_HWHEEL : MOUSEEVENTF_WHEEL;
                inputs[0].u.mi.mouseData = unchecked((uint)delta);
                inputs[0].u.mi.dwExtraInfo = INJECTED_EXTRA_INFO;
                SendInput(1, inputs, Marshal.SizeOf(typeof(INPUT)));
            }
            else if (cmd == "inject_key")
            {
                ushort vk = (ushort)GetJsonInt(json, "vk", 0);
                ushort scan = (ushort)GetJsonInt(json, "scan", 0);
                bool down = GetJsonBool(json, "down", true);
                bool extended = GetJsonBool(json, "extended", false);

                INPUT[] inputs = new INPUT[1];
                inputs[0].type = INPUT_KEYBOARD;
                inputs[0].u.ki.wVk = vk;
                inputs[0].u.ki.wScan = scan;
                inputs[0].u.ki.dwFlags = (down ? 0 : KEYEVENTF_KEYUP) | (extended ? KEYEVENTF_EXTENDEDKEY : 0);
                inputs[0].u.ki.dwExtraInfo = INJECTED_EXTRA_INFO;
                SendInput(1, inputs, Marshal.SizeOf(typeof(INPUT)));
            }
            else if (cmd == "exit")
            {
                _running = false;
                Environment.Exit(0);
            }
        }

        private static IntPtr MouseHookCallback(int nCode, IntPtr wParam, IntPtr lParam)
        {
            if (nCode >= 0)
            {
                MSLLHOOKSTRUCT hookStruct = (MSLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(MSLLHOOKSTRUCT));

                // Ignore our own synthetic injected inputs
                if (hookStruct.dwExtraInfo == INJECTED_EXTRA_INFO)
                {
                    return CallNextHookEx(_mouseHookID, nCode, wParam, lParam);
                }

                int msg = wParam.ToInt32();
                int x = hookStruct.pt.x;
                int y = hookStruct.pt.y;

                if (_isRedirected)
                {
                    // In redirected mode: suppress local cursor movement and send to remote machine!
                    if (msg == WM_MOUSEMOVE)
                    {
                        int dx = 0;
                        int dy = 0;
                        if (_lastMouseX != -1 && _lastMouseY != -1)
                        {
                            dx = x - _lastMouseX;
                            dy = y - _lastMouseY;
                        }

                        _lastMouseX = x;
                        _lastMouseY = y;

                        // Periodically keep physical cursor parked in the anchor area so it doesn't wander into Windows taskbar or edges
                        if (Math.Abs(x - _anchorX) > 200 || Math.Abs(y - _anchorY) > 200)
                        {
                            SetCursorPos(_anchorX, _anchorY);
                            _lastMouseX = _anchorX;
                            _lastMouseY = _anchorY;
                        }

                        if (dx != 0 || dy != 0)
                        {
                            SendJson("{\"type\":\"mouse_move\",\"dx\":" + dx + ",\"dy\":" + dy + ",\"x\":" + x + ",\"y\":" + y + "}");
                        }
                    }
                    else if (msg == WM_LBUTTONDOWN) SendJson("{\"type\":\"mouse_button\",\"button\":\"left\",\"down\":true}");
                    else if (msg == WM_LBUTTONUP) SendJson("{\"type\":\"mouse_button\",\"button\":\"left\",\"down\":false}");
                    else if (msg == WM_RBUTTONDOWN) SendJson("{\"type\":\"mouse_button\",\"button\":\"right\",\"down\":true}");
                    else if (msg == WM_RBUTTONUP) SendJson("{\"type\":\"mouse_button\",\"button\":\"right\",\"down\":false}");
                    else if (msg == WM_MBUTTONDOWN) SendJson("{\"type\":\"mouse_button\",\"button\":\"middle\",\"down\":true}");
                    else if (msg == WM_MBUTTONUP) SendJson("{\"type\":\"mouse_button\",\"button\":\"middle\",\"down\":false}");
                    else if (msg == WM_MOUSEWHEEL)
                    {
                        short delta = unchecked((short)((hookStruct.mouseData >> 16) & 0xFFFF));
                        SendJson("{\"type\":\"mouse_wheel\",\"delta\":" + delta + ",\"horizontal\":false}");
                    }
                    else if (msg == WM_MOUSEHWHEEL)
                    {
                        short delta = unchecked((short)((hookStruct.mouseData >> 16) & 0xFFFF));
                        SendJson("{\"type\":\"mouse_wheel\",\"delta\":" + delta + ",\"horizontal\":true}");
                    }

                    // Suppress local mouse event
                    return (IntPtr)1;
                }
                else
                {
                    // Local mode: check if mouse has touched an active transition edge
                    if (!_isLocked && msg == WM_MOUSEMOVE)
                    {
                        bool hitEdge = false;
                        string hitEdgeName = "";

                        // Check right edge
                        if (_activeEdge == "right" && x >= (_screenLeft + _screenWidth - _edgeThreshold))
                        {
                            hitEdge = true;
                            hitEdgeName = "right";
                        }
                        // Check left edge
                        else if (_activeEdge == "left" && x <= (_screenLeft + _edgeThreshold))
                        {
                            hitEdge = true;
                            hitEdgeName = "left";
                        }
                        // Check top edge
                        else if (_activeEdge == "top" && y <= (_screenTop + _edgeThreshold))
                        {
                            hitEdge = true;
                            hitEdgeName = "top";
                        }
                        // Check bottom edge
                        else if (_activeEdge == "bottom" && y >= (_screenTop + _screenHeight - _edgeThreshold))
                        {
                            hitEdge = true;
                            hitEdgeName = "bottom";
                        }

                        if (hitEdge)
                        {
                            SendJson("{\"type\":\"edge_hit\",\"edge\":\"" + hitEdgeName + "\",\"x\":" + x + ",\"y\":" + y + ",\"screen\":{\"width\":" + _screenWidth + ",\"height\":" + _screenHeight + "}}");
                        }
                    }

                    _lastMouseX = x;
                    _lastMouseY = y;
                }
            }

            return CallNextHookEx(_mouseHookID, nCode, wParam, lParam);
        }

        private static IntPtr KeyboardHookCallback(int nCode, IntPtr wParam, IntPtr lParam)
        {
            if (nCode >= 0)
            {
                KBDLLHOOKSTRUCT hookStruct = (KBDLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(KBDLLHOOKSTRUCT));

                // Ignore our own synthetic injected inputs
                if (hookStruct.dwExtraInfo == INJECTED_EXTRA_INFO)
                {
                    return CallNextHookEx(_keyboardHookID, nCode, wParam, lParam);
                }

                int msg = wParam.ToInt32();
                bool isDown = (msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN);
                bool isUp = (msg == WM_KEYUP || msg == WM_SYSKEYUP);
                uint vk = hookStruct.vkCode;

                // Emergency break: ScrollLock or Pause key always instantly releases lock/redirection
                if (isDown && (vk == VK_SCROLL || vk == VK_PAUSE))
                {
                    _isRedirected = false;
                    _isLocked = false;
                    SendJson("{\"type\":\"emergency_unlock\",\"vk\":" + vk + "}");
                    return (IntPtr)1; // Consume key
                }

                if (_isRedirected)
                {
                    if (isDown || isUp)
                    {
                        bool extended = (hookStruct.flags & 1) != 0;
                        SendJson("{\"type\":\"key\",\"vk\":" + vk + ",\"scan\":" + hookStruct.scanCode + ",\"down\":" + (isDown ? "true" : "false") + ",\"extended\":" + (extended ? "true" : "false") + "}");
                    }

                    // Suppress local keyboard event
                    return (IntPtr)1;
                }
            }

            return CallNextHookEx(_keyboardHookID, nCode, wParam, lParam);
        }

        private static readonly object _consoleLock = new object();
        private static void SendJson(string json)
        {
            lock (_consoleLock)
            {
                Console.WriteLine(json);
                Console.Out.Flush();
            }
        }

        private static string GetJsonValue(string json, string key)
        {
            string needle = "\"" + key + "\":\"";
            int idx = json.IndexOf(needle);
            if (idx == -1) return "";
            int start = idx + needle.Length;
            int end = json.IndexOf("\"", start);
            if (end == -1) return "";
            return json.Substring(start, end - start);
        }

        private static int GetJsonInt(string json, string key, int defVal)
        {
            string needle = "\"" + key + "\":";
            int idx = json.IndexOf(needle);
            if (idx == -1) return defVal;
            int start = idx + needle.Length;
            int end = start;
            while (end < json.Length && (char.IsDigit(json[end]) || json[end] == '-'))
            {
                end++;
            }
            int result = 0;
            if (end > start && int.TryParse(json.Substring(start, end - start), out result))
            {
                return result;
            }
            return defVal;
        }

        private static bool GetJsonBool(string json, string key, bool defVal)
        {
            string needle = "\"" + key + "\":";
            int idx = json.IndexOf(needle);
            if (idx == -1) return defVal;
            int start = idx + needle.Length;
            if (json.Length >= start + 4 && json.Substring(start, 4) == "true") return true;
            if (json.Length >= start + 5 && json.Substring(start, 5) == "false") return false;
            return defVal;
        }

        private static string EscapeJson(string s)
        {
            if (s == null) return "\"\"";
            return "\"" + s.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\n", "\\n").Replace("\r", "\\r") + "\"";
        }
    }
}
