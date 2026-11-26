using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Threading;

namespace Abyx
{
    class Program
    {
        static bool IsPortAvailable(int port)
        {
            try
            {
                var listener = new TcpListener(IPAddress.Loopback, port);
                listener.Start();
                listener.Stop();
                return true;
            }
            catch
            {
                return false;
            }
        }

        static int ResolveFrontendPort(int requested)
        {
            if (IsPortAvailable(requested)) return requested;
            for (int p = 1421; p <= 1499; p++)
            {
                if (IsPortAvailable(p)) return p;
            }
            return requested;
        }

        static bool WaitForServer(string url, int timeoutSeconds)
        {
            int elapsed = 0;
            while (elapsed < timeoutSeconds * 10)
            {
                try
                {
                    var request = (HttpWebRequest)WebRequest.Create(url);
                    request.Timeout = 1000;
                    using (var response = (HttpWebResponse)request.GetResponse())
                    {
                        if (response.StatusCode == HttpStatusCode.OK)
                            return true;
                    }
                }
                catch
                {
                    Thread.Sleep(100);
                    elapsed++;
                }
            }
            return false;
        }

        static string FindAppHostExecutable()
        {
            string[] candidates = new string[]
            {
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), @"Microsoft\Edge\Application\msedge.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), @"Microsoft\Edge\Application\msedge.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), @"Google\Chrome\Application\chrome.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), @"Google\Chrome\Application\chrome.exe")
            };

            foreach (var path in candidates)
            {
                if (File.Exists(path)) return path;
            }
            return null;
        }

        static void KillProcessTree(Process parent)
        {
            if (parent == null || parent.HasExited) return;
            try
            {
                var killPsi = new ProcessStartInfo
                {
                    FileName = "taskkill",
                    Arguments = string.Format("/F /T /PID {0}", parent.Id),
                    CreateNoWindow = true,
                    UseShellExecute = false
                };
                var p = Process.Start(killPsi);
                if (p != null) p.WaitForExit(3000);
            }
            catch
            {
                try { parent.Kill(); } catch { }
            }
        }

        [STAThread]
        static void Main(string[] args)
        {
            string rootDir = AppDomain.CurrentDomain.BaseDirectory;
            string nodePath = Path.Combine(rootDir, "app", "tools", "node-win", "node.exe");
            string serveScript = Path.Combine(rootDir, "scripts", "server", "serve.cjs");
            string profileDir = Path.Combine(rootDir, "app", "profile");

            if (!Directory.Exists(profileDir))
            {
                Directory.CreateDirectory(profileDir);
            }

            if (!File.Exists(nodePath))
            {
                string setupPath = Path.Combine(rootDir, "setup.exe");
                if (File.Exists(setupPath))
                {
                    var p = Process.Start(setupPath);
                    if (p != null) p.WaitForExit();
                }
                else
                {
                    return;
                }
            }

            if (!File.Exists(serveScript)) return;

            int port = ResolveFrontendPort(1420);
            Environment.SetEnvironmentVariable("FRONTEND_PORT", port.ToString());

            // 1. Start Server in background without console window
            var serverPsi = new ProcessStartInfo
            {
                FileName = nodePath,
                Arguments = string.Format("--experimental-sqlite \"{0}\"", serveScript),
                WorkingDirectory = rootDir,
                CreateNoWindow = true,
                UseShellExecute = false,
                WindowStyle = ProcessWindowStyle.Hidden
            };
            serverPsi.EnvironmentVariables["FRONTEND_PORT"] = port.ToString();

            Process serverProcess = null;
            try
            {
                serverProcess = Process.Start(serverPsi);
            }
            catch
            {
                return;
            }

            // 2. Wait for server to become responsive
            string healthUrl = string.Format("http://127.0.0.1:{0}/api/health", port);
            WaitForServer(healthUrl, 15);

            // 3. Launch as Standalone Desktop Application Window
            string appHost = FindAppHostExecutable();
            string appUrl = string.Format("http://localhost:{0}", port);

            Process windowProcess = null;

            if (appHost != null)
            {
                // Launches standalone app window with custom size, title, and isolated profile
                var windowPsi = new ProcessStartInfo
                {
                    FileName = appHost,
                    Arguments = string.Format(
                        "--app=\"{0}\" --window-size=1520,960 --user-data-dir=\"{1}\" --app-id=\"abyx.studio\" --force-dark-mode --enable-features=WebGPU,Vulkan",
                        appUrl,
                        profileDir
                    ),
                    UseShellExecute = false
                };
                windowProcess = Process.Start(windowPsi);
            }
            else
            {
                // Fallback to default browser if no app-mode host exists
                windowProcess = Process.Start(new ProcessStartInfo
                {
                    FileName = appUrl,
                    UseShellExecute = true
                });
            }

            // 4. Handle exit: when standalone window closes, terminate background server
            if (windowProcess != null)
            {
                windowProcess.WaitForExit();
            }

            KillProcessTree(serverProcess);
        }
    }
}
