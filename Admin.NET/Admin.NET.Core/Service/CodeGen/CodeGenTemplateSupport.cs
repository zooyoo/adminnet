// Admin.NET 项目的版权、商标、专利和其他相关权利均受相应法律法规的保护。使用本项目应遵守相关法律法规和许可证的要求。
//
// 本项目主要遵循 MIT 许可证和 Apache 许可证（版本 2.0）进行分发和使用。许可证位于源代码树根目录中的 LICENSE-MIT 和 LICENSE-APACHE 文件。
//
// 不得利用本项目从事危害国家安全、扰乱社会秩序、侵犯他人合法权益等法律法规禁止的活动！任何基于本项目二次开发而产生的一切法律纠纷和责任，我们不承担任何责任！

namespace Admin.NET.Core.Service;

/// <summary>后端模板共用的类型、查询和文本编码规则。</summary>
public static class CodeGenTemplateSupport
{
    /// <summary>显式使用可派生模板基类，避免把运行时密封模型推断为 Razor 基类。</summary>
    public static Task<string> RenderAsync(IViewEngine engine, string source, CustomViewEngine model)
    {
        return engine.RunCompileFromCachedAsync<CustomViewEngine>(source, model, builderAction: builder =>
        {
            builder.AddAssemblyReferenceByName("System.Text.RegularExpressions");
            builder.AddAssemblyReferenceByName("System.Collections");
            builder.AddAssemblyReferenceByName("System.Linq");
            builder.AddAssemblyReferenceByName("System.Text.Json");
            builder.AddAssemblyReference(typeof(CustomViewEngine).Assembly);
            builder.AddUsing("System.Text.RegularExpressions");
            builder.AddUsing("System.Collections.Generic");
            builder.AddUsing("System.Linq");
            builder.AddUsing("Admin.NET.Core.Service");
        });
    }

    private static readonly Dictionary<Type, string> TypeNames = new()
    {
        [typeof(bool)] = "bool", [typeof(byte)] = "byte", [typeof(sbyte)] = "sbyte", [typeof(char)] = "char",
        [typeof(short)] = "short", [typeof(ushort)] = "ushort", [typeof(int)] = "int", [typeof(uint)] = "uint",
        [typeof(long)] = "long", [typeof(ulong)] = "ulong", [typeof(float)] = "float", [typeof(double)] = "double",
        [typeof(decimal)] = "decimal", [typeof(string)] = "string", [typeof(object)] = "object"
    };
    private static readonly HashSet<string> ValueTypes = new(StringComparer.Ordinal)
    {
        "bool", "byte", "sbyte", "char", "short", "ushort", "int", "uint", "long", "ulong", "float", "double", "decimal",
        "DateTime", "DateTimeOffset", "DateOnly", "TimeOnly", "TimeSpan", "Guid"
    };

    /// <summary>字段类型取自真实实体，而不是数据库驱动的近似类型。</summary>
    public static string TypeName(Type type)
    {
        var underlying = Nullable.GetUnderlyingType(type);
        if (underlying != null) return TypeName(underlying) + "?";
        if (TypeNames.TryGetValue(type, out var alias)) return alias;
        if (type.IsArray) return TypeName(type.GetElementType()!) + "[]";
        if (type.IsGenericType) return type.Name.Split('`')[0] + "<" + string.Join(", ", type.GetGenericArguments().Select(TypeName)) + ">";
        return type.Name;
    }

    /// <summary>查询和编辑输入的值类型必须可空，避免缺省值意外参与过滤。</summary>
    public static string NullableType(string typeName)
    {
        if (typeName.EndsWith('?')) return typeName;
        var isEnum = typeName.EndsWith("Enum", StringComparison.Ordinal) || App.EffectiveTypes.Any(type => type.IsEnum && type.Name == typeName);
        return ValueTypes.Contains(typeName) || isEnum ? typeName + "?" : typeName;
    }

    /// <summary>生成 C# 字符串字面量，描述和提示中的引号、换行不会破坏代码。</summary>
    public static string Literal(string text) => System.Text.Json.JsonSerializer.Serialize(text ?? "");

    /// <summary>XML 注释只占一行，不允许配置内容注入新的代码行。</summary>
    public static string Comment(string text) => System.Security.SecurityElement.Escape((text ?? "").Replace('\r', ' ').Replace('\n', ' '));

    /// <summary>把合法的查询方式转换为明确的可编译表达式。</summary>
    public static string Query(CodeGenConfig field)
    {
        var type = field.NetType.TrimEnd('?');
        var name = field.PropertyName;
        var input = $"input.{name}";
        var column = $"u.{name}";
        var comparison = field.QueryType ?? "==";
        if (comparison == "isNotNull") return $".WhereIF({input} == true, u => {column} != null).WhereIF({input} == false, u => {column} == null)";
        if (comparison == "like")
        {
            if (type != "string") throw Oops.Oh($"字段 {name} 的模糊查询需要字符串类型");
            return $".WhereIF(!string.IsNullOrWhiteSpace({input}), u => {column} != null && {column}.Contains({input}.Trim()))";
        }
        if (comparison == "~")
        {
            var range = input + "Range";
            return type == "string"
                ? $".WhereIF({range} != null && {range}.Length == 2, u => {column}.CompareTo({range}[0]) >= 0 && {column}.CompareTo({range}[1]) <= 0)"
                : $".WhereIF({range} != null && {range}.Length == 2 && {range}[0] != null && {range}[1] != null, u => SqlFunc.GreaterThanOrEqual({column}, {range}[0]) && SqlFunc.LessThanOrEqual({column}, {range}[1]))";
        }
        if (comparison is not ("==" or "!=" or ">" or "<" or ">=" or "<=")) throw Oops.Oh($"字段 {name} 的查询方式无效");
        var condition = type == "string" ? $"!string.IsNullOrWhiteSpace({input})" : $"{input} != null";
        var function = comparison switch { ">" => "GreaterThan", ">=" => "GreaterThanOrEqual", "<" => "LessThan", "<=" => "LessThanOrEqual", _ => null };
        var expression = function == null ? $"{column} {comparison} {input}"
            : type == "string" ? $"{column}.CompareTo({input}) {comparison} 0"
            : $"SqlFunc.{function}({column}, {input})";
        return $".WhereIF({condition}, u => {expression})";
    }
}
/// <summary>保留前端共用模型，并补齐后端真实实体的命名空间集合。</summary>
public sealed class CodeGenRenderModel : CustomViewEngine
{
    public IReadOnlyList<string> EntityNamespaces { get; set; } = Array.Empty<string>();
}
