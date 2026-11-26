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

        static void Main(string[] args)
        {
            Console.Title = "ABYX - Unified AI Workstation";
            Console.WriteLine("============================================================");
            Console.WriteLine("   ABYX UNIFIED AI STUDIO    |  Native Executable");
            Console.WriteLine("============================================================");

            string rootDir = AppDomain.CurrentDomain.BaseDirectory;
            string nodePath = Path.Combine(rootDir, "app", "tools", "node-win", "node.exe");
            string serveScript = Path.Combine(rootDir, "scripts", "server", "serve.cjs");

            if (!File.Exists(nodePath))
            {
                Console.ForegroundColor = ConsoleColor.Yellow;
                Console.WriteLine("\n[NOTICE] Portable Node.js environment not configured.");
                Console.ResetColor();
                string setupPath = Path.Combine(rootDir, "setup.exe");
                if (File.Exists(setupPath))
                {
                    Console.WriteLine("Launching setup.exe...");
                    Process.Start(setupPath).WaitForExit();
                }
                else
                {
                    Console.ForegroundColor = ConsoleColor.Red;
                    Console.WriteLine("[ERROR] setup.exe not found at: " + setupPath);
                    Console.ResetColor();
                    return;
                }
            }

            if (!File.Exists(serveScript))
            {
                Console.ForegroundColor = ConsoleColor.Red;
                Console.WriteLine("[ERROR] Server entrypoint missing: " + serveScript);
                Console.ResetColor();
                return;
            }

            int port = ResolveFrontendPort(1420);
            Environment.SetEnvironmentVariable("FRONTEND_PORT", port.ToString());

            Console.WriteLine(string.Format("\nStarting ABYX Server on port {0}...", port));
            Console.WriteLine(string.Format("Root directory: {0}", rootDir));

            var psi = new ProcessStartInfo
            {
                FileName = nodePath,
                Arguments = string.Format("--experimental-sqlite \"{0}\"", serveScript),
                WorkingDirectory = rootDir,
                UseShellExecute = false
            };
            psi.EnvironmentVariables["FRONTEND_PORT"] = port.ToString();

            Process serverProcess = null;
            try
            {
                serverProcess = Process.Start(psi);
            }
            catch (Exception ex)
            {
                Console.ForegroundColor = ConsoleColor.Red;
                Console.WriteLine("[ERROR] Failed to start server: " + ex.Message);
                Console.ResetColor();
                return;
            }

            string browserUrl = string.Format("http://localhost:{0}", port);
            new Thread(() =>
            {
                Thread.Sleep(1500);
                try
                {
                    Process.Start(new ProcessStartInfo
                    {
                        FileName = browserUrl,
                        UseShellExecute = true
                    });
                }
                catch { }
            }) { IsBackground = true }.Start();

            Console.WriteLine("\nABYX is active and accessible at: " + browserUrl);
            Console.WriteLine("Press Ctrl+C or close this window to stop.\n");

            AppDomain.CurrentDomain.ProcessExit += (s, e) =>
            {
                if (serverProcess != null && !serverProcess.HasExited)
                {
                    try { serverProcess.Kill(); } catch { }
                }
            };

            serverProcess.WaitForExit();
        }
    }
}
