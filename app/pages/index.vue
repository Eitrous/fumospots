<script setup lang="ts">
useSeoMeta({
  title: 'Fumo Travel Map',
  description: '分享东方 Project 爱好者在世界各地拍摄的 Fumo 照片，在一张大地图上看见每一次旅途停靠。'
})
</script>

<template>
  <main class="home-page">
    <WorldMap />

    <section class="home-hero">
      <div class="home-hero__body">
        <span class="eyebrow">Touhou Fumo Photo Map</span>
        <h1 class="hero-title">让每只 Fumo 都在地图上留下旅途坐标。</h1>
        <p class="lede">
          上传你在世界各地拍到的 fumo 照片，标记地点、写下一句旅途留言，
          再和同好一起把整张世界地图慢慢钉满。
        </p>

        <div class="home-hero__actions">
          <NuxtLink class="button" to="/submit">上传一张旅途照片</NuxtLink>
          <NuxtLink class="ghost-button" to="/login">登录 / 领取作者 ID</NuxtLink>
        </div>

        <div class="home-hero__support">
          <div>
            <strong>地图优先</strong>
            <p>默认全屏世界地图，缩小看分布，放大看缩略图和故事。</p>
          </div>
          <div>
            <strong>隐私可控</strong>
            <p>后台保留精确坐标，公开时可改成近似点位再上图。</p>
          </div>
          <div>
            <strong>同好来信</strong>
            <p>每张照片都能附上作者 ID、地点、拍摄时间和一小段留言。</p>
          </div>
        </div>

        <MapLegend />
      </div>
    </section>
  </main>
</template>
