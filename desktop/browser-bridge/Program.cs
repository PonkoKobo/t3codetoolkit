using System.Buffers.Binary;
using System.IO.Pipes;
using System.Runtime.Versioning;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Win32;

[assembly: SupportedOSPlatform("windows")]

internal static class Program
{
    private const string Host = "com.t3codetoolkit.browser";
    private const string RegistryPath = @"Software\Google\Chrome\NativeMessagingHosts\" + Host;
    private const int MaxMessage = 64 * 1024;
    private static readonly SecurityIdentifier UserSid = GetUserSid();
    private static string PipeName => "T3CodeToolkit.Browser." + UserSid.Value;
    private static string BrokerMutex => @"Local\" + PipeName;
    private static string ManifestPath => Path.Combine(AppContext.BaseDirectory, Host + ".json");
    private static readonly Encoding Utf8 = new UTF8Encoding(false, true);

    private static SecurityIdentifier GetUserSid()
    {
        using var identity = WindowsIdentity.GetCurrent();
        return identity.User ?? throw new InvalidOperationException("Unable to identify the Windows user.");
    }

    private static async Task<int> Main(string[] args)
    {
        try
        {
            switch (args.FirstOrDefault())
            {
                case "register": Register(args.ElementAtOrDefault(1) ?? ""); break;
                case "unregister": Unregister(); break;
                case "broker": await RunBroker(args.ElementAtOrDefault(1)); break;
                case "mcp": await RunMcp(); break;
                case string origin when origin.StartsWith("chrome-extension://", StringComparison.Ordinal):
                    await RunNative(origin);
                    break;
                default:
                    var result = await Send(Commands.Cli(args));
                    Console.WriteLine(result.ToJsonString());
                    return result.ContainsKey("error") ? 1 : 0;
            }
            return 0;
        }
        catch (Exception error)
        {
            Console.Error.WriteLine(error is IOException or TimeoutException
                ? "Toolkit browser bridge is disconnected. Enable Browser sharing in Toolkit."
                : error.Message);
            return 1;
        }
    }

    private static void Register(string extensionId)
    {
        if (extensionId.Length != 32 || !extensionId.All(c => c is >= 'a' and <= 'p'))
            throw new ArgumentException("Enter the 32-character ID from the Toolkit Chrome extension.");
        using var key = Registry.CurrentUser.CreateSubKey(RegistryPath);
        var registered = key.GetValue(null) as string;
        if (registered != null && !string.Equals(registered, ManifestPath, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("This Chrome host is registered to another Toolkit installation.");
        var manifest = new JsonObject
        {
            ["name"] = Host, ["description"] = "T3 Code Toolkit browser sharing",
            ["path"] = Environment.ProcessPath, ["type"] = "stdio",
            ["allowed_origins"] = new JsonArray($"chrome-extension://{extensionId}/")
        };
        var staging = ManifestPath + "." + Environment.ProcessId + ".tmp";
        try
        {
            File.WriteAllText(staging, manifest.ToJsonString(), Utf8);
            File.Move(staging, ManifestPath, overwrite: true);
            key.SetValue(null, ManifestPath);
        }
        finally { File.Delete(staging); }
    }

    private static void Unregister()
    {
        using var key = Registry.CurrentUser.OpenSubKey(RegistryPath);
        if (string.Equals(key?.GetValue(null) as string, ManifestPath, StringComparison.OrdinalIgnoreCase))
        {
            if (Mutex.TryOpenExisting(BrokerMutex, out var running))
            {
                running.Dispose();
                throw new InvalidOperationException("Disable Browser sharing in Toolkit before uninstalling.");
            }
            Registry.CurrentUser.DeleteSubKey(RegistryPath, throwOnMissingSubKey: false);
        }
        File.Delete(ManifestPath);
    }

    private static NamedPipeServerStream CreateListener(string pipeName)
    {
        var acl = new PipeSecurity();
        acl.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(WellKnownSidType.NetworkSid, null),
            PipeAccessRights.FullControl, AccessControlType.Deny));
        acl.AddAccessRule(new PipeAccessRule(UserSid, PipeAccessRights.FullControl,
            AccessControlType.Allow));
        return NamedPipeServerStreamAcl.Create(pipeName, PipeDirection.InOut, 16, PipeTransmissionMode.Byte,
            PipeOptions.Asynchronous, 0, 0, acl);
    }

    private static async Task RunBroker(string? isolatedId)
    {
        if (isolatedId != null && !Guid.TryParseExact(isolatedId, "N", out _))
            throw new ArgumentException("The isolated broker ID must be a GUID without hyphens.");
        var pipeName = isolatedId == null ? PipeName : PipeName + "." + isolatedId;
        using var mutex = new Mutex(false, @"Local" + pipeName, out var created);
        if (!created) throw new InvalidOperationException("Browser sharing is already enabled in another Toolkit window.");
        // The launcher owns stdin. Closing the launcher or disabling sharing tears down the broker.
        var lifetime = Task.Run(Console.ReadLine);
        var session = new BrowserSession();
        var listener = CreateListener(pipeName);
        Console.WriteLine("ready");
        while (true)
        {
            var connect = listener.WaitForConnectionAsync();
            if (await Task.WhenAny(lifetime, connect) == lifetime)
            {
                listener.Dispose();
                return;
            }
            await connect;
            _ = Serve(listener, session);
            listener = CreateListener(pipeName);
        }
    }

    private static async Task Serve(NamedPipeServerStream pipe, BrowserSession session)
    {
        using (pipe)
        using (var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(12)))
        {
            try
            {
                var request = await ReadFrame(pipe, timeout.Token) ?? throw new IOException();
                JsonObject reply;
                try { reply = await session.Handle(request); }
                catch (ArgumentException error) { reply = Result.Error(error.Message); }
                await WriteFrame(pipe, reply, timeout.Token);
            }
            catch (Exception error) when (error is IOException or OperationCanceledException or JsonException) { }
        }
    }

    private static async Task<JsonObject> Send(JsonObject request)
    {
        using var pipe = new NamedPipeClientStream(".", PipeName, PipeDirection.InOut, PipeOptions.Asynchronous,
            TokenImpersonationLevel.Identification);
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(11));
        await pipe.ConnectAsync(900, timeout.Token);
        await WriteFrame(pipe, request, timeout.Token);
        return await ReadFrame(pipe, timeout.Token) ?? throw new IOException();
    }

    private static async Task RunNative(string origin)
    {
        var manifest = JsonNode.Parse(File.ReadAllText(ManifestPath));
        if (manifest?["allowed_origins"]?[0]?.GetValue<string>() != origin)
            throw new InvalidOperationException("This Chrome extension has not been registered.");
        var input = Console.OpenStandardInput();
        var output = Console.OpenStandardOutput();
        var connection = Guid.NewGuid().ToString("N");
        try
        {
            while (await ReadFrame(input) is { } message)
            {
                var id = message["id"]?.DeepClone();
                message["browser"] = connection;
                JsonObject result;
                try { result = await Send(message); }
                catch (Exception error) when (error is IOException or TimeoutException or OperationCanceledException)
                {
                    result = Result.Error("Enable Browser sharing in the T3 Code Toolkit menu.");
                }
                await WriteFrame(output, new JsonObject { ["id"] = id, ["result"] = result });
            }
        }
        finally
        {
            try { await Send(new JsonObject { ["op"] = "browser_stop", ["browser"] = connection }); }
            catch (Exception error) when (error is IOException or TimeoutException or OperationCanceledException) { }
        }
    }

    private static async Task RunMcp()
    {
        string? token = null;
        try
        {
            while (await Console.In.ReadLineAsync() is { } line)
            {
                JsonObject? message;
                try { message = JsonNode.Parse(line) as JsonObject; }
                catch (JsonException) { continue; }
                if (message?["id"] is not { } id) continue;
                var reply = new JsonObject { ["jsonrpc"] = "2.0", ["id"] = id.DeepClone() };
                try
                {
                    var parameters = message["params"] as JsonObject;
                    switch (message["method"]?.GetValue<string>())
                    {
                        case "initialize":
                            reply["result"] = new JsonObject
                            {
                                ["protocolVersion"] = parameters?["protocolVersion"]?.DeepClone() ?? JsonValue.Create("2025-06-18"),
                                ["serverInfo"] = new JsonObject { ["name"] = "t3-toolkit-browser", ["version"] = "1.0.0" },
                                ["capabilities"] = new JsonObject { ["tools"] = new JsonObject() }
                            };
                            break;
                        case "ping": reply["result"] = new JsonObject(); break;
                        case "tools/list": reply["result"] = new JsonObject { ["tools"] = Commands.Tools() }; break;
                        case "tools/call":
                            JsonObject result;
                            try
                            {
                                var request = Commands.Mcp(parameters, token);
                                result = await Send(request);
                                if (request["op"]?.GetValue<string>() == "request_share" && result["session"] is { } session)
                                {
                                    token = session.GetValue<string>();
                                    result.Remove("session");
                                }
                                if (request["op"]?.GetValue<string>() == "stop") token = null;
                            }
                            catch (Exception error) when (error is ArgumentException or IOException or TimeoutException or OperationCanceledException)
                            {
                                result = Result.Error(error is ArgumentException ? error.Message : "Enable Browser sharing in the T3 Code Toolkit menu.");
                            }
                            reply["result"] = new JsonObject
                            {
                                ["isError"] = result.ContainsKey("error"),
                                ["content"] = new JsonArray(new JsonObject { ["type"] = "text", ["text"] = result.ToJsonString() })
                            };
                            break;
                        default: reply["error"] = new JsonObject { ["code"] = -32601, ["message"] = "Method not found" }; break;
                    }
                }
                catch (InvalidOperationException)
                {
                    reply["error"] = new JsonObject { ["code"] = -32602, ["message"] = "Invalid request parameters" };
                }
                Console.WriteLine(reply.ToJsonString());
            }
        }
        finally
        {
            if (token != null)
            {
                try { await Send(new JsonObject { ["op"] = "stop", ["session"] = token }); }
                catch (Exception error) when (error is IOException or TimeoutException or OperationCanceledException) { }
            }
        }
    }

    private static async Task<JsonObject?> ReadFrame(Stream stream, CancellationToken cancellation = default)
    {
        var header = new byte[4];
        if (await stream.ReadAsync(header.AsMemory(0, 1), cancellation) == 0) return null;
        await stream.ReadExactlyAsync(header.AsMemory(1), cancellation);
        var length = BinaryPrimitives.ReadInt32LittleEndian(header);
        if (length <= 0 || length > MaxMessage) throw new IOException("Invalid message length.");
        var bytes = new byte[length];
        await stream.ReadExactlyAsync(bytes, cancellation);
        return JsonNode.Parse(bytes) as JsonObject ?? throw new JsonException();
    }

    private static async Task WriteFrame(Stream stream, JsonObject value, CancellationToken cancellation = default)
    {
        var bytes = Utf8.GetBytes(value.ToJsonString());
        if (bytes.Length > MaxMessage) throw new IOException("Browser response exceeds the message limit.");
        var header = new byte[4];
        BinaryPrimitives.WriteInt32LittleEndian(header, bytes.Length);
        await stream.WriteAsync(header, cancellation);
        await stream.WriteAsync(bytes, cancellation);
        await stream.FlushAsync(cancellation);
    }
}
