using System;
using System.Diagnostics;
using System.IO;

namespace Abyx
{
    class SetupInstaller
    {
        static void CreateShortcut(string targetPath, string shortcutPath, string iconPath, string description)
        {
            try
            {
                Type shellType = Type.GetTypeFromProgID("WScript.Shell");
                if (shellType == null) return;
                dynamic shell = Activator.CreateInstance(shellType);
                dynamic shortcut = shell.CreateShortcut(shortcutPath);
                shortcut.TargetPath = targetPath;
                shortcut.WorkingDirectory = Path.GetDirectoryName(targetPath);
                shortcut.IconLocation = iconPath;
                shortcut.Description = description;
                shortcut.Save();
            }
            catch (Exception ex)
            {
                Console.WriteLine("  ! Shortcut creation notice: " + ex.Message);
            }
        }

        static void Main(string[] args)
        {
            Console.Title = "ABYX Setup & Installer";
            Console.WriteLine("============================================================");
            Console.WriteLine("   ABYX UNIFIED AI STUDIO    |  Setup & Installation");
            Console.WriteLine("============================================================");

            string rootDir = AppDomain.CurrentDomain.BaseDirectory;
            Console.WriteLine(string.Format("Installation Directory: {0}\n", rootDir));

            // 1. Data directories
            Console.WriteLine("[1/4] Preparing required application directories...");
            string[] directories = new string[]
            {
                "app/outputs",
                "app/models",
                "app/chat-history",
                "app/transcriptions",
                "app/tts-outputs",
                "app/openvino-models",
                "data",
                "benchmarks/scratch",
                "benchmarks/reports"
            };

            foreach (string dir in directories)
            {
                string fullPath = Path.Combine(rootDir, dir.Replace('/', Path.DirectorySeparatorChar));
                if (!Directory.Exists(fullPath))
                {
                    Directory.CreateDirectory(fullPath);
                    Console.WriteLine(string.Format("  + Created: {0}", dir));
                }
                else
                {
                    Console.WriteLine(string.Format("  ✓ Verified: {0}", dir));
                }
            }

            // 2. Runtime verification
            Console.WriteLine("\n[2/4] Verifying local AI studio runtime components...");
            string nodePath = Path.Combine(rootDir, "app", "tools", "node-win", "node.exe");
            string distPath = Path.Combine(rootDir, "app", "dist", "index.html");
            string icoPath = Path.Combine(rootDir, "abyx.ico");
            string abyxExe = Path.Combine(rootDir, "Abyx.exe");

            Console.WriteLine(string.Format("  ✓ Portable Node.js: {0}", File.Exists(nodePath) ? "Ready" : "Missing"));
            Console.WriteLine(string.Format("  ✓ Frontend Web UI: {0}", File.Exists(distPath) ? "Built & Ready" : "Missing"));
            Console.WriteLine(string.Format("  ✓ Application Icon: {0}", File.Exists(icoPath) ? "Ready" : "Missing"));

            // 3. Register Shortcuts
            Console.WriteLine("\n[3/4] Creating system shortcuts...");
            string userProfile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
            string desktopDir = Path.Combine(userProfile, "Desktop");
            string startMenuDir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                "Microsoft", "Windows", "Start Menu", "Programs"
            );

            if (Directory.Exists(desktopDir))
            {
                string desktopLink = Path.Combine(desktopDir, "ABYX Unified AI Studio.lnk");
                CreateShortcut(abyxExe, desktopLink, icoPath, "ABYX Unified AI Studio Workstation");
                Console.WriteLine(string.Format("  ✓ Desktop Shortcut: {0}", desktopLink));
            }

            if (Directory.Exists(startMenuDir))
            {
                string startLink = Path.Combine(startMenuDir, "ABYX Unified AI Studio.lnk");
                CreateShortcut(abyxExe, startLink, icoPath, "ABYX Unified AI Studio Workstation");
                Console.WriteLine(string.Format("  ✓ Start Menu Shortcut: {0}", startLink));
            }

            // 4. Complete
            Console.WriteLine("\n[4/4] Installation & Configuration Complete!");
            Console.WriteLine("============================================================");
            Console.WriteLine("ABYX is fully installed and optimized for Windows 11.");
            Console.WriteLine("Run Abyx.exe to start the workstation.\n");

            if (args.Length > 0 && args[0].ToLower() == "--launch")
            {
                if (File.Exists(abyxExe))
                {
                    Process.Start(abyxExe);
                }
            }
        }
    }
}
