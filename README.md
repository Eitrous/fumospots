# Fumo Travel Map

一个基于 Nuxt 4、Supabase、MapLibre GL JS 和 Vercel 的 Fumo 世界地图站。  
站点允许东方 Project 爱好者上传在世界各地拍摄的 fumo 照片，用地图坐标把旅程钉到同一张世界地图上。

## 当前能力

- 全屏世界地图首页，按视野范围加载已审核照片
- 地图聚类图钉，放大后切换为缩略图标记
- 邮箱 magic link 登录
- 首次登录强制设置公开作者 ID
- 投稿页支持：
  - 图片上传
  - 浏览器端生成缩略图
  - EXIF 坐标 / 拍摄时间读取
  - 地点搜索与逆地理编码
  - 精确位置与公开位置分离
- 公开详情页
- 站内管理员审核台
- 私有 Supabase Storage + 服务端签名 URL

## 技术栈

- Nuxt 4
- Supabase Auth / Database / Storage
- MapLibre GL JS
- Vercel
- EXIF 解析：`exifr`

## 本地启动

1. 安装依赖

```bash
npm install
```

2. 复制环境变量模板

```bash
copy .env.example .env
```

3. 在 Supabase SQL Editor 中执行 [`supabase/schema.sql`](./supabase/schema.sql)

4. 配置 `.env`

- `NUXT_PUBLIC_SUPABASE_URL`
- `NUXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `NUXT_PUBLIC_SITE_URL`
- `NUXT_PUBLIC_MAP_STYLE_URL` 可保留默认免费底图
- `GEOCODE_BASE_URL` / `GEOCODE_USER_AGENT` 可保留默认值

5. 手动设置第一个管理员

```sql
update public.profiles
set role = 'admin'
where username = 'your_admin_id';
```

6. 启动开发环境

```bash
npm run dev
```

## 重要约定

- `fumo` bucket 必须保持私有
- 浏览器只直接操作 Auth 和 Storage
- 所有数据库写入都通过 Nuxt server API
- 公开接口只返回 `approved` 投稿，且不会暴露精确坐标
- 公开地图使用 `public_lat/public_lng`
- 后台审核使用 `exact_lat/exact_lng` + `public_lat/public_lng` 双坐标

## 主要页面

- `/` 地图首页
- `/login` 邮箱登录
- `/onboarding` 设置作者 ID
- `/submit` 投稿
- `/posts/:id` 公开详情
- `/admin/review` 审核台

## 已验证

```bash
npm run build
```

当前仓库已可通过生产构建。构建阶段会提示较大的客户端 chunk，这是 MapLibre 与图片处理依赖带来的体积警告，不会阻止产物生成。
