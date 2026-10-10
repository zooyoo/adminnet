// Admin.NET 项目的版权、商标、专利和其他相关权利均受相应法律法规的保护。使用本项目应遵守相关法律法规和许可证的要求。
//
// 本项目主要遵循 MIT 许可证和 Apache 许可证（版本 2.0）进行分发和使用。许可证位于源代码树根目录中的 LICENSE-MIT 和 LICENSE-APACHE 文件。
//
// 不得利用本项目从事危害国家安全、扰乱社会秩序、侵犯他人合法权益等法律法规禁止的活动！任何基于本项目二次开发而产生的一切法律纠纷和责任，我们不承担任何责任！

using System.Net;
using System.Text.RegularExpressions;

namespace Admin.NET.Core.Service;

/// <summary>只向配置授权的数值 IP 与路径前缀发送请求；轮次顺序执行。</summary>
public sealed class StressTestRunner(IOptions<StressTestOptions> options) : ISingleton
{
    private readonly StressTestOptions _options = options.Value;
    private readonly SemaphoreSlim _gate = new(1, 1);

    public StressTestTargetsOutput GetTargets()
    {
        ValidateOptions();
        var targets = _options.Enabled ? _options.Targets.Select(target =>
        {
            ParseUri(target.RequestUri, true);
            if (string.IsNullOrWhiteSpace(target.Name)) throw new ArgumentException("压测目标名称不能为空");
            return new StressTestTarget { Name = target.Name, RequestUri = target.RequestUri };
        }).ToList() : [];
        return new StressTestTargetsOutput
        {
            Targets = targets, MaxTotalRequests = _options.MaxTotalRequests,
            MaxConcurrency = _options.MaxConcurrency, MaxRounds = _options.MaxRounds,
            MaxRequestsPerRound = _options.MaxRequestsPerRound, RequestTimeoutSeconds = _options.RequestTimeoutSeconds
        };
    }

    public Uri ValidateRequest(StressTestInput input)
    {
        var targets = GetTargets().Targets;
        if (!_options.Enabled || targets.Count == 0) throw new ArgumentException("压测未启用或未配置授权目标");
        ArgumentNullException.ThrowIfNull(input);
        if (input.NumberOfRequests is not > 0 || input.NumberOfRequests > _options.MaxRequestsPerRound ||
            input.NumberOfRounds is not > 0 || input.NumberOfRounds > _options.MaxRounds ||
            (long)input.NumberOfRequests * input.NumberOfRounds > _options.MaxTotalRequests)
            throw new ArgumentException("请求量、轮数或总请求量超出执行上限");
        if (input.MaxDegreeOfParallelism is null or < 0 || input.MaxDegreeOfParallelism > _options.MaxConcurrency)
            throw new ArgumentException("最大并行量超出执行上限");
        var method = input.RequestMethod?.Trim().ToUpperInvariant();
        if (method is not ("GET" or "POST" or "PUT" or "DELETE")) throw new ArgumentException("仅支持 GET、POST、PUT、DELETE 请求方式");
        ValidatePairs(input.Headers, true); ValidatePairs(input.PathParameters, true); ValidatePairs(input.QueryParameters, true);
        if (input.RequestParameters == null || input.RequestParameters.Count > 100 || input.RequestParameters.Any(pair => string.IsNullOrWhiteSpace(pair.Key) || pair.Value == null || pair.Key.Length > 256 || pair.Value.Length > 8192))
            throw new ArgumentException("Body 参数必须具有非空名称，最多100项且单个值不超过8192字符");
        if (string.IsNullOrWhiteSpace(input.RequestUri) || input.RequestUri.Length > 8192) throw new ArgumentException("请求地址无效");
        var templateUri = ParseUri(input.RequestUri);
        if (!targets.Any(target => IsAllowed(templateUri, ParseUri(target.RequestUri, true))))
            throw new ArgumentException("请求地址不在授权目标及路径范围内");
        var raw = input.RequestUri;
        foreach (var pair in input.PathParameters)
            raw = raw.Replace("{" + pair.Key + "}", Uri.EscapeDataString(pair.Value), StringComparison.OrdinalIgnoreCase);
        if (raw.Contains('{') || raw.Contains('}')) throw new ArgumentException("路径参数未完整填写");
        var uri = ParseUri(raw);
        var builder = new UriBuilder(uri);
        var query = HttpUtility.ParseQueryString(builder.Query);
        foreach (var pair in input.QueryParameters) query[pair.Key] = pair.Value;
        builder.Query = query.ToString(); uri = builder.Uri;
        if (!targets.Any(target => IsAllowed(uri, ParseUri(target.RequestUri, true)))) throw new ArgumentException("请求地址不在授权目标及路径范围内");
        // 创建并释放一份请求，确保非法头在开始任何网络请求前被拒绝。
        using var probe = CreateRequest(input, uri);
        return uri;
    }

    public async Task<StressTestOutput> RunAsync(StressTestInput input, CancellationToken cancellationToken)
    {
        var uri = ValidateRequest(input);
        if (!await _gate.WaitAsync(0, cancellationToken)) throw new ArgumentException("已有压测正在执行，请等待结束或取消后重试");
        try
        {
            using var handler = new SocketsHttpHandler { AllowAutoRedirect = false, UseProxy = false, UseCookies = false, ConnectTimeout = TimeSpan.FromSeconds(_options.RequestTimeoutSeconds) };
            using var client = new HttpClient(handler) { Timeout = Timeout.InfiniteTimeSpan, MaxResponseContentBufferSize = 1024 * 1024 };
            var count = input.NumberOfRequests!.Value;
            var times = new double?[count * input.NumberOfRounds!.Value];
            long success = 0, failed = 0;
            var clock = Stopwatch.StartNew();
            var concurrency = input.MaxDegreeOfParallelism == 0 ? Math.Min(Environment.ProcessorCount, _options.MaxConcurrency) : input.MaxDegreeOfParallelism!.Value;
            for (var round = 0; round < input.NumberOfRounds; round++)
            {
                cancellationToken.ThrowIfCancellationRequested();
                var currentRound = round;
                await Parallel.ForEachAsync(Enumerable.Range(0, count), new ParallelOptions { MaxDegreeOfParallelism = concurrency, CancellationToken = cancellationToken }, async (index, token) =>
                {
                    token.ThrowIfCancellationRequested();
                    using var request = CreateRequest(input, uri);
                    using var timeout = CancellationTokenSource.CreateLinkedTokenSource(token);
                    timeout.CancelAfter(TimeSpan.FromSeconds(_options.RequestTimeoutSeconds));
                    var requestClock = Stopwatch.StartNew();
                    try
                    {
                        using var response = await client.SendAsync(request, HttpCompletionOption.ResponseContentRead, timeout.Token);
                        if (response.IsSuccessStatusCode)
                        {
                            times[currentRound * count + index] = requestClock.Elapsed.TotalMilliseconds;
                            Interlocked.Increment(ref success);
                        }
                        else Interlocked.Increment(ref failed);
                    }
                    catch (OperationCanceledException) when (!token.IsCancellationRequested) { Interlocked.Increment(ref failed); }
                    catch (HttpRequestException) { Interlocked.Increment(ref failed); }

                });
            }
            cancellationToken.ThrowIfCancellationRequested();
            clock.Stop(); var successfulTimes = times.OfType<double>().Order().ToArray();
            return new StressTestOutput
            {
                TotalRequests = success + failed, SuccessfulRequests = success, FailedRequests = failed,
                TotalTimeInSeconds = clock.Elapsed.TotalSeconds, QueriesPerSecond = (success + failed) / clock.Elapsed.TotalSeconds,
                MinResponseTime = successfulTimes.Length > 0 ? successfulTimes[0] : 0, MaxResponseTime = successfulTimes.Length > 0 ? successfulTimes[^1] : 0, AverageResponseTime = successfulTimes.Length > 0 ? successfulTimes.Average() : 0,
                Percentile10ResponseTime = Percentile(successfulTimes, .1), Percentile25ResponseTime = Percentile(successfulTimes, .25),
                Percentile50ResponseTime = Percentile(successfulTimes, .5), Percentile75ResponseTime = Percentile(successfulTimes, .75),
                Percentile90ResponseTime = Percentile(successfulTimes, .9), Percentile99ResponseTime = Percentile(successfulTimes, .99), Percentile999ResponseTime = Percentile(successfulTimes, .999)
            };
        }
        finally { _gate.Release(); }
    }

    private void ValidateOptions()
    {
        if (_options.Targets == null || _options.Targets.Count > 20 ||
            _options.MaxTotalRequests is < 1 or > 10000 || _options.MaxConcurrency is < 1 or > 64 ||
            _options.MaxRounds is < 1 or > 100 || _options.MaxRequestsPerRound is < 1 or > 1000 ||
            _options.RequestTimeoutSeconds is < 1 or > 60) throw new ArgumentException("压测配置超出安全执行上限");
    }

    private static Uri ParseUri(string value, bool target = false)
    {
        if (string.IsNullOrWhiteSpace(value) || value.Contains('\\') || !Uri.TryCreate(value, UriKind.Absolute, out var uri) ||
            uri.Scheme is not ("http" or "https") || !IPAddress.TryParse(uri.Host.Trim('[', ']'), out _) ||
            uri.UserInfo.Length > 0 || uri.Fragment.Length > 0 || target && uri.Query.Length > 0)
            throw new ArgumentException("压测地址必须是授权的 HTTP(S) 数值 IP 地址，不得包含凭据或片段");
        if (Regex.IsMatch(uri.AbsolutePath, @"%(?:2f|5c|25)", RegexOptions.IgnoreCase) || Uri.UnescapeDataString(uri.AbsolutePath).Split('/').Any(part => part is "." or ".."))
            throw new ArgumentException("压测路径包含不允许的转义分隔符或相对路径");
        return uri;
    }

    private static bool IsAllowed(Uri uri, Uri target)
    {
        var path = target.AbsolutePath.TrimEnd('/');
        return uri.Scheme == target.Scheme && uri.Host == target.Host && uri.Port == target.Port &&
            (uri.AbsolutePath == path || uri.AbsolutePath.StartsWith(path + "/", StringComparison.Ordinal));
    }

    private static void ValidatePairs(Dictionary<string, string> values, bool ignoreCase)
    {
        if (values == null || values.Count > 100 || values.Any(pair => string.IsNullOrWhiteSpace(pair.Key) || pair.Value == null || pair.Key.Length > 256 || pair.Value.Length > 8192) ||
            values.Keys.Distinct(ignoreCase ? StringComparer.OrdinalIgnoreCase : StringComparer.Ordinal).Count() != values.Count)
            throw new ArgumentException("参数必须具有非空名称且不能重复，最多100项且单个值不超过8192字符");
    }

    private static HttpRequestMessage CreateRequest(StressTestInput input, Uri uri)
    {
        var request = new HttpRequestMessage(new HttpMethod(input.RequestMethod.Trim().ToUpperInvariant()), uri);
        try
        {
            if (request.Method != HttpMethod.Get && input.RequestParameters.Count > 0) request.Content = new FormUrlEncodedContent(input.RequestParameters);
            foreach (var pair in input.Headers)
            {
                if (pair.Key.ToLowerInvariant() is "host" or "connection" or "content-length" or "transfer-encoding" or "proxy-authorization" || pair.Value.Contains('\r') || pair.Value.Contains('\n'))
                    throw new ArgumentException("请求头包含不允许的传输控制字段或换行");
                if (pair.Key.StartsWith("Content-", StringComparison.OrdinalIgnoreCase))
                {
                    if (request.Content == null) throw new ArgumentException("Content 请求头需要非 GET 表单 Body");
                    request.Content.Headers.Remove(pair.Key); request.Content.Headers.Add(pair.Key, pair.Value);
                }
                else request.Headers.Add(pair.Key, pair.Value);
            }
            return request;
        }
        catch (Exception error) when (error is ArgumentException or FormatException or InvalidOperationException)
        {
            request.Dispose(); throw new ArgumentException("请求头参数无效");
        }
    }

    private static double Percentile(double[] times, double percentile) => times.Length == 0 ? 0 : times[Math.Max(0, (int)Math.Ceiling(percentile * times.Length) - 1)];
}
