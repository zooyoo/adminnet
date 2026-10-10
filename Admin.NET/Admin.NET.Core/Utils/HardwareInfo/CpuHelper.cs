// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License.

using System.Management;

namespace Admin.NET.Core;

/// <summary>
/// 处理器帮助类
/// </summary>
public static class CpuHelper
{
    /// <summary>
    /// 处理器信息
    /// </summary>
    /// <remarks>
    /// 推荐使用，默认有缓存
    /// </remarks>
    public static CpuInfo CpuInfos => Cache.Default.GetOrAdd("CpuInfos", _ => GetCpuInfos(), 5);

    /// <summary>
    /// 获取处理器信息
    /// </summary>
    /// <returns></returns>
    public static CpuInfo GetCpuInfos()
    {
        var cpuInfo = new CpuInfo
        {
            LogicalCoreCount = Environment.ProcessorCount,
            ProcessorArchitecture = RuntimeInformation.ProcessArchitecture.ToString()
        };

        try
        {
            // 获取CPU使用率
            GetCpuUsage(cpuInfo);

            // 获取CPU详细信息
            GetCpuDetails(cpuInfo);

            // 获取温度信息（如果可用）
            GetCpuTemperature(cpuInfo);
        }
        catch (Exception ex)
        {
            Log.Error("获取处理器信息出错，" + ex.Message);
        }

        return cpuInfo;
    }

    /// <summary>
    /// 获取CPU使用率
    /// </summary>
    /// <param name="cpuInfo"></param>
    private static void GetCpuUsage(CpuInfo cpuInfo)
    {
        if (RuntimeInformation.IsOSPlatform(OSPlatform.Linux))
        {
            var output = ShellHelper.Bash(@"top -b -n1 | grep ""Cpu(s)""").Trim();
            var lines = output.Split(',');
            if (lines.Length > 3)
            {
                var loadPercentage = lines[3].Trim().Split(' ')[0].Replace("%", "");
                if (double.TryParse(loadPercentage, out var usage))
                {
                    cpuInfo.UsagePercentage = Math.Round(100 - usage, 2); // idle转换为使用率
                }
            }
        }
        else if (RuntimeInformation.IsOSPlatform(OSPlatform.OSX))
        {
            var output = ShellHelper.Bash(@"top -l 1 -F | awk '/CPU usage/ {gsub(""%"", """"); print $7}'").Trim();
            if (double.TryParse(output, out var usage))
            {
                cpuInfo.UsagePercentage = Math.Round(100 - usage, 2); // idle转换为使用率
            }
        }
        else if (RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
        {
            // 使用WMI获取CPU使用率
            try
            {
                using ManagementObjectSearcher searcher = new("SELECT LoadPercentage FROM Win32_Processor");
                using ManagementObjectCollection processors = searcher.Get();
                List<double> values = new();
                foreach (ManagementObject item in processors)
                {
                    using (item)
                    {
                        if (item["LoadPercentage"] != null) values.Add(Convert.ToDouble(item["LoadPercentage"]));
                    }
                }
                if (values.Count > 0) cpuInfo.UsagePercentage = Math.Round(values.Average(), 2);
            }
            catch
            {
                // 采集失败保留空值，避免将缺少数据展示为 0%。
                cpuInfo.UsagePercentage = null;
            }
        }
    }

    /// <summary>
    /// 获取CPU温度信息（如果可用）
    /// </summary>
    /// <param name="cpuInfo"></param>
    private static void GetCpuTemperature(CpuInfo cpuInfo)
    {
        try
        {
            if (RuntimeInformation.IsOSPlatform(OSPlatform.Linux))
            {
                // 尝试从thermal_zone获取温度
                var thermalFiles = Directory.GetFiles("/sys/class/thermal", "thermal_zone*");
                foreach (var file in thermalFiles)
                {
                    var tempFile = Path.Combine(file, "temp");
                    if (File.Exists(tempFile))
                    {
                        var tempStr = File.ReadAllText(tempFile).Trim();
                        if (int.TryParse(tempStr, out var temp))
                        {
                            cpuInfo.Temperature = Math.Round(temp / 1000.0, 1);
                            break;
                        }
                    }
                }
            }
            // Windows和macOS的温度获取需要特殊权限或第三方工具，这里暂不实现
        }
        catch
        {
            // 温度获取失败不影响其他信息
        }
    }

    /// <summary>
    /// 获取CPU详细信息
    /// </summary>
    /// <param name="cpuInfo"></param>
    private static void GetCpuDetails(CpuInfo cpuInfo)
    {
        if (RuntimeInformation.IsOSPlatform(OSPlatform.Linux))
        {
            var cpuInfoOutput = ShellHelper.Bash("cat /proc/cpuinfo").Trim();
            var lines = cpuInfoOutput.Split('\n');

            foreach (var line in lines)
            {
                if (line.StartsWith("model name"))
                {
                    cpuInfo.ProcessorName = line.Split(':')[1].Trim();
                }
                else if (line.StartsWith("cpu MHz"))
                {
                    if (double.TryParse(line.Split(':')[1].Trim(), out var mhz))
                    {
                        cpuInfo.BaseClockSpeed = Math.Round(mhz / 1000, 2);
                    }
                }
                else if (line.StartsWith("cache size"))
                {
                    cpuInfo.CacheBytes = line.Split(':')[1].Trim().ParseToLong();
                }
                else if (line.StartsWith("cpu cores"))
                {
                    if (int.TryParse(line.Split(':')[1].Trim(), out var cores))
                    {
                        cpuInfo.PhysicalCoreCount = cores;
                    }
                }
            }
        }
        else if (RuntimeInformation.IsOSPlatform(OSPlatform.OSX))
        {
            var nameOutput = ShellHelper.Bash("sysctl -n machdep.cpu.brand_string").Trim();
            cpuInfo.ProcessorName = nameOutput;

            var coreOutput = ShellHelper.Bash("sysctl -n hw.physicalcpu").Trim();
            if (int.TryParse(coreOutput, out var cores))
            {
                cpuInfo.PhysicalCoreCount = cores;
            }
        }
        else if (RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
        {
            using ManagementObjectSearcher searcher = new("SELECT Name,NumberOfCores,MaxClockSpeed,L3CacheSize FROM Win32_Processor");
            using ManagementObjectCollection processors = searcher.Get();
            List<string> names = new();
            foreach (ManagementObject item in processors)
            {
                using (item)
                {
                    if (item["Name"] != null) names.Add(item["Name"].ToString());
                    cpuInfo.PhysicalCoreCount += Convert.ToInt32(item["NumberOfCores"] ?? 0);
                    cpuInfo.BaseClockSpeed = Math.Max(cpuInfo.BaseClockSpeed, Math.Round(Convert.ToDouble(item["MaxClockSpeed"] ?? 0) / 1000, 2));
                    cpuInfo.CacheBytes += Convert.ToInt64(item["L3CacheSize"] ?? 0) * 1024;
                }
            }
            cpuInfo.ProcessorName = string.Join(", ", names.Distinct());
        }
    }
}

/// <summary>
/// 处理器信息
/// </summary>
public record CpuInfo
{
    /// <summary>
    /// 处理器名称
    /// </summary>
    public string ProcessorName { get; set; } = string.Empty;

    /// <summary>
    /// 处理器架构
    /// </summary>
    public string ProcessorArchitecture { get; set; } = string.Empty;

    /// <summary>
    /// 物理核心数
    /// </summary>
    public int PhysicalCoreCount { get; set; }

    /// <summary>
    /// 逻辑核心数(超线程)
    /// </summary>
    public int LogicalCoreCount { get; set; }

    /// <summary>
    /// 基础时钟频率(GHz)
    /// </summary>
    public double BaseClockSpeed { get; set; }

    /// <summary>
    /// 缓存大小
    /// </summary>
    public long CacheBytes { get; set; }

    /// <summary>
    /// CPU使用率(%)
    /// </summary>
    public double? UsagePercentage { get; set; }

    /// <summary>
    /// CPU温度(°C)
    /// </summary>
    public double? Temperature { get; set; }
}
