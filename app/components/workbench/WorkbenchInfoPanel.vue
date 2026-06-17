<script setup lang="ts">
import type {
  PublicLatestPostsResponse,
  PublicMapCountResponse,
} from "~~/shared/fumo";

const { locale, t } = useI18n();
const LATEST_POSTS_SKELETON_ROWS = 4;
const {
  data: mapCount,
  error: mapCountError,
} = await useFetch<PublicMapCountResponse>("/api/map/count", {
  key: "home-post-count",
  lazy: true,
  server: false,
});
const {
  data: latestPostsResponse,
  error: latestPostsError,
} = await useFetch<PublicLatestPostsResponse>("/api/posts/latest", {
  key: "home-latest-posts",
  lazy: true,
  server: false,
});

const emit = defineEmits<{
  openFeedback: [];
}>();

const publicPostCount = computed(() =>
  Math.max(0, Number(mapCount.value?.count ?? 0)),
);
const registeredUserCount = computed(() =>
  Math.max(0, Number(mapCount.value?.registeredUserCount ?? 0)),
);
const mapCountLoading = computed(() => !mapCount.value && !mapCountError.value);
const latestPostsLoading = computed(
  () => !latestPostsResponse.value && !latestPostsError.value,
);
const formatStatCount = (value: number) => {
  if (mapCountLoading.value || mapCountError.value) {
    return "--";
  }

  return new Intl.NumberFormat(locale.value).format(value);
};
const formattedPublicPostCount = computed(() =>
  formatStatCount(publicPostCount.value),
);
const formattedRegisteredUserCount = computed(() =>
  formatStatCount(registeredUserCount.value),
);
const latestPosts = computed(() => latestPostsResponse.value?.items ?? []);

const homeStats = computed(() => [
  {
    key: "posts",
    label: t("workbench.stats.publicPosts"),
    value: formattedPublicPostCount.value,
  },
  {
    key: "users",
    label: t("workbench.stats.registeredUsers"),
    value: formattedRegisteredUserCount.value,
  },
]);

const openFeedback = () => {
  emit("openFeedback");
};
</script>

<template>
  <section
    class="workbench-panel workbench-panel--home workbench-panel--home-stats"
  >
    <div class="workbench-home-stats" aria-live="polite">
      <div class="workbench-home-stats__head">
        <strong class="workbench-home-stats-title">{{
          t("workbench.stats.title")
        }}</strong>
      </div>
      <div class="workbench-home-stats-items" aria-live="polite">
        <div
          v-for="metric in homeStats"
          :key="metric.key"
          class="workbench-home-stats__item"
        >
          <strong
            class="workbench-home-stats__value"
            :aria-label="
              mapCountLoading
                ? metric.label
                : `${metric.value} ${metric.label}`
            "
          >
            <span
              v-if="mapCountLoading"
              class="workbench-skeleton-shape workbench-home-stats__value-skeleton"
              aria-hidden="true"
            />
            <span v-else aria-hidden="true">{{ metric.value }}</span>
          </strong>
          <p class="workbench-home-stats__label">
            {{ metric.label }}
          </p>
        </div>
      </div>
      <p v-if="mapCountError" class="workbench-home-stats__status">
        {{ t("workbench.stats.loadFailed") }}
      </p>
    </div>

    <section
      class="workbench-home-latest"
      aria-labelledby="workbench-home-latest-title"
    >
      <div class="workbench-home-latest__head">
        <strong id="workbench-home-latest-title">{{
          t("workbench.latestPosts.title")
        }}</strong>
      </div>

      <div
        v-if="latestPostsLoading"
        class="workbench-user-post-list workbench-home-latest__list workbench-home-latest-skeleton"
        role="status"
        :aria-label="t('workbench.latestPosts.loading')"
      >
        <article
          v-for="index in LATEST_POSTS_SKELETON_ROWS"
          :key="index"
          class="workbench-user-post-row workbench-home-latest__row workbench-post-row-skeleton"
          aria-hidden="true"
        >
          <span
            class="workbench-skeleton-shape workbench-post-row-skeleton__media"
          />
          <span class="workbench-post-row-skeleton__body">
            <span
              class="workbench-skeleton-shape workbench-post-row-skeleton__title"
            />
            <span
              class="workbench-skeleton-shape workbench-post-row-skeleton__line"
            />
          </span>
        </article>
        <span class="sr-only">{{ t("workbench.latestPosts.loading") }}</span>
      </div>
      <p
        v-else-if="latestPostsError"
        class="workbench-home-latest__status is-error"
      >
        {{ t("workbench.latestPosts.loadFailed") }}
      </p>

      <div
        v-else-if="latestPosts.length"
        class="workbench-user-post-list workbench-home-latest__list"
      >
        <article
          v-for="post in latestPosts"
          :key="post.id"
          class="workbench-user-post-row workbench-home-latest__row"
        >
          <NuxtLink
            class="workbench-user-post-row__media"
            :to="createWorkbenchLocation('post', { postId: post.id })"
          >
            <img
              v-if="post.thumbUrl"
              :src="post.thumbUrl"
              :alt="post.title"
              decoding="async"
              loading="lazy"
            />
            <i v-else class="fa-solid fa-image" aria-hidden="true" />
          </NuxtLink>

          <div class="workbench-user-post-row__body">
            <div class="workbench-user-post-row__title">
              <NuxtLink
                :to="createWorkbenchLocation('post', { postId: post.id })"
              >
                {{ post.title }}
              </NuxtLink>
            </div>
            <p>{{ post.placeName || t("post.unnamedPlaceName") }}</p>
          </div>
        </article>
        <NuxtLink
          class="workbench-home-latest__all-link"
          :to="createWorkbenchLocation('posts')"
        >
          <span>{{ t("workbench.latestPosts.viewAll") }}</span>
          <i class="fa-solid fa-arrow-right" aria-hidden="true" />
        </NuxtLink>
      </div>

      <p v-else class="workbench-home-latest__status">
        {{ t("workbench.latestPosts.empty") }}
      </p>
    </section>

    <a
      class="workbench-home-stats__blog-link"
      href="https://blog.0x3f.io/blog/about-fumospots/"
      target="_blank"
      rel="noopener noreferrer"
      title="Blog"
      aria-label="Blog"
    >
      <i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true" />
      <span class="sr-only">Blog</span>
    </a>

    <button
      class="workbench-home-stats__feedback-link"
      type="button"
      :title="t('suggestions.quickAction')"
      :aria-label="t('suggestions.quickAction')"
      @click="openFeedback"
    >
      <i class="fa-regular fa-comment-dots" aria-hidden="true" />
      <span class="sr-only">{{ t("suggestions.quickAction") }}</span>
    </button>
  </section>
</template>
