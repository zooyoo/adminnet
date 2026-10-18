# Cache 模块

基于策略模式的异步存储管理方案，支持 localStorage、sessionStorage、IndexedDB 和 Memory，公开入口为 `@vben-core/shared/cache`。具体实现见 [storage-manager.ts](storage-manager.ts)，应用使用时沿用现有命名空间，不在本模块接入业务接口。

默认驱动按环境选择：可访问浏览器 `window.localStorage` 时使用 `LocalStorageDriver`，否则使用 `MemoryStorageDriver`。使用持久化驱动时明确设置非空 `prefix`；空前缀下的 `keys()`、`clear()` 会覆盖该驱动的全部键。

## 架构设计

```shell
┌───────────────────────────────────────────────┐
│             StorageManager                    │
│  ┌─────────────┐  ┌───────────────────────┐   │
│  │ Prefix 隔离 │   │   TTL 过期管理        │   │
│  └─────────────┘  └───────────────────────┘   │
├───────────────────────────────────────────────┤
│             IStorageDriver                    │
├──────────┬─────────────────┬──────────────────┤
│  Local   │   IndexedDB     │     Memory       │
│  Storage │   Driver        │     Driver       │
│  Driver  │                 │                  │
└──────────┴─────────────────┴──────────────────┘
```

**分层职责：**

| 层级             | 职责                                         |
| ---------------- | -------------------------------------------- |
| `StorageManager` | 命名空间前缀隔离、TTL 过期检查、统一对外 API |
| `IStorageDriver` | 纯粹的 KV 存取抽象接口                       |
| 各 Driver 实现   | 对接具体存储引擎，不感知前缀和 TTL           |

---

## 快速开始

### 基本使用（浏览器默认 localStorage）

```typescript
import { StorageManager } from '@vben-core/shared/cache';

const cache = new StorageManager({ prefix: 'myapp' });
// 使用 IndexedDB
//new StorageManager({ driver: new IndexedDBDriver(), prefix: 'app' });

// 使用 sessionStorage
//new StorageManager({ driver: new LocalStorageDriver({ storageType: 'sessionStorage' }), prefix: 'app' });

// 测试环境
//new StorageManager({ driver: new MemoryStorageDriver(), prefix: 'test' });

// 存储数据
await cache.setItem('user', { name: '张三', age: 28 });

// 读取数据
const user = await cache.getItem('user');
// => { name: '张三', age: 28 }

// 带默认值读取
const settings = await cache.getItem('settings', { theme: 'light' });
// 如果不存在，返回 { theme: 'light' }

// 删除数据
await cache.removeItem('user');

// 清除当前前缀下所有数据
await cache.clear();
```

### 带 TTL 过期

```typescript
const cache = new StorageManager({ prefix: 'session' });

// 设置 5 分钟后过期（TTL 单位为毫秒）
await cache.setItem('token', 'abc123', 5 * 60 * 1000);

// 5 分钟内可以正常读取
const token = await cache.getItem('token');
// => 'abc123'

// 5 分钟后自动返回 null（惰性删除）
const expiredToken = await cache.getItem('token');
// => null

// 主动清理所有过期项
await cache.clearExpiredItems();
```

---

## 存储驱动

### LocalStorageDriver（默认）

基于浏览器 `localStorage` 或 `sessionStorage`，数据持久化存储。

```typescript
import { LocalStorageDriver, StorageManager } from '@vben-core/shared/cache';

// 使用 localStorage（默认）
const cache = new StorageManager({
  driver: new LocalStorageDriver(),
  prefix: 'app',
});

// 使用 sessionStorage
const sessionCache = new StorageManager({
  driver: new LocalStorageDriver({ storageType: 'sessionStorage' }),
  prefix: 'app',
});
```

**特点：**

- 同步 API 用 async 包装，保持接口统一
- 自动处理 JSON 序列化/反序列化
- 数据损坏时自动清除并返回 null
- 容量与可用性由浏览器配额、隐私模式和当前来源决定，不承诺固定容量

**适用场景：** 用户偏好设置、小型配置数据、Token 存储

---

### IndexedDBDriver

基于浏览器 IndexedDB，支持大容量结构化数据存储。

```typescript
import {IndexedDBDriver, StorageManager} from '@vben-core/shared/cache';

const cache = new StorageManager({
  driver: new IndexedDBDriver({
    dbName: 'my-app-db',     // 数据库名称，默认 'vben-storage'
    dbVersion: 1,            // 数据库版本，默认 1
    storeName: 'cache-store', // 对象存储名称，默认 'kv-store'
  }),
  prefix: 'data',
});

// 存储大量数据
await cache.setItem('table-data', largeDataArray);

// 存储二进制友好的结构（IndexedDB 原生支持）
await cache.setItem('config', {
  columns: ['name', 'status'],
  filters: [{ field: 'status', value: 'enabled' }],
  pagination: { page: 1, size: 20 },
});
```

**特点：**

- 懒初始化：首次操作时自动打开数据库，无需手动调用 `init()`
- 可用容量由浏览器和来源配额决定，调用方处理配额或权限错误
- 支持结构化克隆（可存储 Date、RegExp、Blob 等复杂类型）
- 天然异步，不阻塞主线程

**适用场景：** 离线数据缓存、大型表格数据、文件/图片缓存、复杂业务数据

---

### MemoryStorageDriver

基于内存 Map，数据不持久化，页面刷新即丢失。

```typescript
import { MemoryStorageDriver, StorageManager } from '@vben-core/shared/cache';

const cache = new StorageManager({
  driver: new MemoryStorageDriver(),
  prefix: 'test',
});
```

**特点：**

- 读写速度最快
- 无浏览器 API 依赖
- 数据随页面生命周期销毁

**适用场景：** 单元测试、SSR 服务端渲染、临时运行时缓存

---

## API 参考

### StorageManager

#### 构造函数

```typescript
new StorageManager(options?: StorageManagerOptions)
```

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `driver` | `IStorageDriver` | 按环境选择 | localStorage 可访问时使用 `LocalStorageDriver`，否则使用 `MemoryStorageDriver` |
| `prefix` | `string` | `''` | 键前缀，用于命名空间隔离 |

#### 方法

| 方法 | 签名 | 说明 |
| --- | --- | --- |
| `getItem` | `getItem<T>(key: string, defaultValue?: T \| null): Promise<T \| null>` | 获取存储项，过期或不存在返回默认值 |
| `setItem` | `setItem(key: string, value: unknown, ttl?: number): Promise<void>` | 设置存储项，可选 TTL（毫秒） |
| `keys` | `keys(): Promise<string[]>` | 返回当前命名空间的键，去除前缀；不自动过滤过期项 |
| `removeItem` | `removeItem(key: string): Promise<void>` | 删除指定存储项 |
| `clear` | `clear(): Promise<void>` | 清除当前前缀下所有存储项 |
| `clearExpiredItems` | `clearExpiredItems(): Promise<void>` | 主动清理所有过期项 |

---

### IStorageDriver 接口

自定义驱动需要实现此接口：

```typescript
interface IStorageDriver {
  clear(): Promise<void>;

  getItem<T>(key: string): Promise<null | T>;

  keys(): Promise<string[]>;

  removeItem(key: string): Promise<void>;

  setItem<T>(key: string, value: T): Promise<void>;
}
```

---

## 高级用法

### 自定义 Driver

以下是接口实现示意，Cookie 辅助函数需要由调用方提供；本模块不提供 Cookie 驱动或这些函数。真正实现时处理序列化、解析错误与 Cookie 作用域。

```typescript
import type { IStorageDriver } from '@vben-core/shared/cache';

class CookieStorageDriver implements IStorageDriver {
  async getItem<T>(key: string): Promise<null | T> {
    const value = getCookie(key);
    return value ? JSON.parse(value) : null;
  }

  async setItem<T>(key: string, value: T): Promise<void> {
    setCookie(key, JSON.stringify(value));
  }

  async removeItem(key: string): Promise<void> {
    deleteCookie(key);
  }

  async clear(): Promise<void> {
    clearAllCookies();
  }

  async keys(): Promise<string[]> {
    return getAllCookieNames();
  }
}

// 使用自定义 Driver
const cache = new StorageManager({
  driver: new CookieStorageDriver(),
  prefix: 'ck',
});
```

### 根据环境动态选择 Driver

```typescript
import {
  IndexedDBDriver,
  LocalStorageDriver,
  MemoryStorageDriver,
  StorageManager,
} from '@vben-core/shared/cache';

function createStorageManager(prefix: string) {
  // SSR 环境使用内存驱动
  if (typeof window === 'undefined') {
    return new StorageManager({
      driver: new MemoryStorageDriver(),
      prefix,
    });
  }

  // 大数据场景使用 IndexedDB
  if (needsLargeStorage()) {
    return new StorageManager({
      driver: new IndexedDBDriver({ dbName: `${prefix}-db` }),
      prefix,
    });
  }

  // 默认使用 localStorage
  return new StorageManager({ prefix });
}
```

### 命名空间隔离

```typescript
// 不同模块使用不同前缀，互不干扰
const userCache = new StorageManager({ prefix: 'user' });
const configCache = new StorageManager({ prefix: 'config' });

await userCache.setItem('profile', { name: '张三' });
await configCache.setItem('profile', { theme: 'dark' });

// 各自独立
await userCache.getItem('profile'); // => { name: '张三' }
await configCache.getItem('profile'); // => { theme: 'dark' }

// 只清除 user 前缀的数据
await userCache.clear();
await configCache.getItem('profile'); // => { theme: 'dark' }（不受影响）
```

### 定时清理过期数据

```typescript
const cache = new StorageManager({ prefix: 'app' });

// 应用启动时清理一次
await cache.clearExpiredItems();

// 或者定时清理（每 10 分钟）
setInterval(
  async () => {
    await cache.clearExpiredItems();
  },
  10 * 60 * 1000,
);
```

---

## 数据存储格式

`StorageManager` 在 Driver 层存储的数据结构为：

```typescript
interface StorageItem<T> {
  expiry?: number; // 过期时间戳（毫秒），undefined 表示永不过期
  value: T; // 实际业务数据
}
```

实际存储的 key 格式为：`{prefix}-{key}`

例如 `prefix = 'app'`，`key = 'user'`，则实际存储键为 `app-user`。

---

## 过期策略

采用**惰性删除 + 主动清理**双重策略：

| 策略 | 触发时机 | 说明 |
| --- | --- | --- |
| 惰性删除 | 调用 `getItem` 时 | 读取时检查过期，过期则删除并返回默认值 |
| 主动清理 | 调用 `clearExpiredItems` 时 | 遍历所有带前缀的 key，删除已过期项 |

---

## 各 Driver 对比

| 特性 | LocalStorageDriver | IndexedDBDriver | MemoryStorageDriver |
| --- | --- | --- | --- |
| 数据生命周期 | localStorage 或 sessionStorage 的生命周期 | 浏览器 IndexedDB 的生命周期 | 当前驱动实例的生命周期 |
| 容量 | 浏览器配额 | 浏览器与来源配额 | 可用内存 |
| 底层机制 | 同步 Web Storage，包装为异步接口 | 异步事务 | 内存 Map，包装为异步接口 |
| 数据类型 | JSON 可序列化值 | 结构化克隆支持的值 | JavaScript 值 |
| 环境前提 | 可访问 Web Storage | 可访问 IndexedDB | 不依赖浏览器存储 |
| 适用场景 | 偏好、小型配置 | 离线与结构化缓存 | 测试、SSR、临时缓存 |

---

## 在项目中的使用

本项目的 `PreferenceManager` 消费 `StorageManager`，初始化时设置应用命名空间并加载偏好。具体驱动、初始化顺序、兼容处理和异常处理以 [preferences.ts](../../../../preferences/src/preferences.ts) 为准，修改时同步核对调用方及相关测试。

纯逻辑测试可以显式注入 `MemoryStorageDriver`；它验证存储管理逻辑，不代表真实浏览器持久化行为已通过。应用环境与验证边界见[前端说明](../../../../../../README.md)。

---

## 注意事项

1. **所有方法都是异步的** — 即使底层是同步的 localStorage，API 也返回 Promise，确保切换 Driver 时无需改动调用方。

2. **TTL 单位是毫秒** — `setItem('key', value, 60000)` 表示 60 秒后过期。

3. **IndexedDB 懒初始化** — 不需要手动调用 `init()` 或 `open()`，首次操作时自动打开数据库连接并复用。

4. **前缀隔离是逻辑隔离** — 非空前缀按 `${prefix}-` 匹配；前缀有包含关系时可能命中同一组键，设计命名空间时避免交叠。空前缀匹配驱动中的全部键。

5. **错误处理** — LocalStorageDriver 在 JSON 解析失败时自动清除损坏数据； `PreferenceManager.saveToCache` 内部 try-catch 防止未捕获异常。

6. **IndexedDB 版本升级** — 如果需要修改 objectStore 结构，需要递增 `dbVersion`。当前实现在 `upgradeneeded` 事件中自动创建 objectStore。
