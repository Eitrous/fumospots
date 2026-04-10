<script setup lang="ts">
import type { PublicPostDetail } from '~~/shared/fumo'

const route = useRoute()
const { formatDateTime, formatLatLng, privacyModeLabel } = useFormatters()

const { data: post, error } = await useFetch<PublicPostDetail>(`/api/posts/${route.params.id}`)

useSeoMeta({
  title: () => post.value?.title ? `${post.value.title} · Fumo Travel Map` : 'Fumo Travel Map',
  description: () => post.value?.body || post.value?.placeName || 'Fumo Travel Map 投稿详情'
})
</script>

<template>
  <main class="page-shell detail-page">
    <template v-if="post">
      <section class="panel panel--page">
        <span class="eyebrow">Post Detail</span>
        <h1 class="page-title">{{ post.title }}</h1>
        <div class="detail-meta">
          <span class="status-inline">作者 @{{ post.author.username }}</span>
          <span class="status-inline">{{ post.placeName || '未填写地点名称' }}</span>
          <span class="status-inline">{{ privacyModeLabel(post.privacyMode) }}</span>
          <span class="status-inline">拍摄时间 {{ formatDateTime(post.capturedAt) }}</span>
        </div>
      </section>

      <section v-if="post.imageUrl" class="panel panel--page">
        <img class="detail-hero__image" :src="post.imageUrl" :alt="post.title">
      </section>

      <section class="detail-grid">
        <article class="panel panel--page detail-copy">
          <strong>作者留言</strong>
          <p>{{ post.body || '这位作者还没有留下额外说明。' }}</p>

          <strong>地点信息</strong>
          <p>
            {{ post.placeName || '未命名地点' }}
            <br>
            {{ [post.cityName, post.regionName, post.countryName].filter(Boolean).join(' · ') || '未补充更细的行政区信息' }}
          </p>
          <p>公开坐标：{{ formatLatLng(post.publicLocation) }}</p>
        </article>

        <aside class="detail-copy">
          <div class="panel panel--page">
            <strong>公开位置预览</strong>
            <p class="support-copy">地图只展示公开位置，不会返回后台保存的精确拍摄点。</p>
            <LocationPreviewMap
              :public-location="post.publicLocation"
              :compact="true"
            />
          </div>

          <div class="panel panel--page">
            <strong>返回世界地图</strong>
            <p class="support-copy">继续看看其他地区的 Fumo 旅照，或者登录后也上传你的一张。</p>
            <div class="inline-actions">
              <NuxtLink class="button" to="/">回地图</NuxtLink>
              <NuxtLink class="ghost-button" to="/submit">我要投稿</NuxtLink>
            </div>
          </div>
        </aside>
      </section>
    </template>

    <section v-else class="panel panel--page empty-state">
      <h2>这条投稿暂时不可见</h2>
      <p>{{ error?.statusMessage || '它可能还在审核中，或者链接已经失效。' }}</p>
      <NuxtLink class="button" to="/">返回地图首页</NuxtLink>
    </section>
  </main>
</template>
