<template>
  <div class="site-root">
    <NuxtLoadingIndicator color="var(--accent)" :height="3" />
    <SiteHeader />
    <slot />
  </div>
</template>
