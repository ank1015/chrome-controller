using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Threading.Tasks;

internal static class HostLauncher
{
    private const string ConfigFileName = "host-launcher.config";
    private static readonly string LogPath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "llm-native-host",
        "com.ank1015.llm",
        "host-launcher-debug.log"
    );

    private static int Main()
    {
        try
        {
            Log("launcher start");
            var baseDirectory = AppDomain.CurrentDomain.BaseDirectory;
            var configPath = Path.Combine(baseDirectory, ConfigFileName);
            var config = ReadConfig(configPath);

            var startInfo = new ProcessStartInfo
            {
                FileName = config["nodePath"],
                Arguments = QuoteArgument(config["scriptPath"]),
                UseShellExecute = false,
                RedirectStandardInput = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true,
                WorkingDirectory = Path.GetDirectoryName(config["scriptPath"]) ?? baseDirectory,
            };

            using (var process = new Process { StartInfo = startInfo })
            {
                process.Start();
                Log("child started pid=" + process.Id);

                var stdinTask = PumpAsync(
                    Console.OpenStandardInput(),
                    process.StandardInput.BaseStream,
                    closeDestination: true,
                    label: "stdin->child"
                );
                var stdoutTask = PumpAsync(
                    process.StandardOutput.BaseStream,
                    Console.OpenStandardOutput(),
                    closeDestination: false,
                    label: "child->stdout"
                );
                var stderrTask = PumpAsync(
                    process.StandardError.BaseStream,
                    Console.OpenStandardError(),
                    closeDestination: false,
                    label: "child->stderr"
                );

                process.WaitForExit();
                Log("child exited code=" + process.ExitCode);
                Task.WaitAll(stdoutTask, stderrTask);

                if (!stdinTask.IsCompleted)
                {
                    try
                    {
                        process.StandardInput.Close();
                    }
                    catch
                    {
                    }
                }

                return process.ExitCode;
            }
        }
        catch (Exception error)
        {
            Log("launcher fatal: " + error);
            Console.Error.WriteLine("[host-launcher] " + error.Message);
            return 1;
        }
    }

    private static async Task PumpAsync(
        Stream source,
        Stream destination,
        bool closeDestination,
        string label
    )
    {
        var buffer = new byte[81920];
        long totalBytes = 0;

        try
        {
            while (true)
            {
                var read = await source.ReadAsync(buffer, 0, buffer.Length).ConfigureAwait(false);
                if (read == 0)
                {
                    Log(label + " EOF after " + totalBytes + " bytes");
                    break;
                }

                totalBytes += read;
                Log(label + " read " + read + " bytes (total " + totalBytes + ")");
                await destination.WriteAsync(buffer, 0, read).ConfigureAwait(false);
                await destination.FlushAsync().ConfigureAwait(false);
            }
        }
        finally
        {
            if (closeDestination)
            {
                destination.Close();
            }
        }
    }

    private static void Log(string message)
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(LogPath) ?? ".");
            File.AppendAllText(
                LogPath,
                DateTime.UtcNow.ToString("o") + " " + message + Environment.NewLine
            );
        }
        catch
        {
        }
    }

    private static Dictionary<string, string> ReadConfig(string path)
    {
        if (!File.Exists(path))
        {
            throw new FileNotFoundException("Missing host launcher config", path);
        }

        var values = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var rawLine in File.ReadAllLines(path))
        {
            var line = rawLine.Trim();
            if (line.Length == 0 || line.StartsWith("#", StringComparison.Ordinal))
            {
                continue;
            }

            var separator = line.IndexOf('=');
            if (separator <= 0)
            {
                continue;
            }

            var key = line.Substring(0, separator).Trim();
            var value = line.Substring(separator + 1).Trim();
            values[key] = value;
        }

        if (!values.ContainsKey("nodePath") || !values.ContainsKey("scriptPath"))
        {
            throw new InvalidOperationException("host-launcher.config must define nodePath and scriptPath");
        }

        return values;
    }

    private static string QuoteArgument(string value)
    {
        if (string.IsNullOrEmpty(value))
        {
            return "\"\"";
        }

        if (!value.Any(ch => char.IsWhiteSpace(ch) || ch == '"'))
        {
            return value;
        }

        return "\"" + value.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"";
    }
}
