<script setup lang="ts">
const route = useRoute()
const username = String(route.params.username || '').trim()

await navigateTo(
  username
    ? createWorkbenchLocation('user', { username })
    : createWorkbenchLocation('info'),
  { replace: true }
)
</script>

<template>
  <div />
</template>
