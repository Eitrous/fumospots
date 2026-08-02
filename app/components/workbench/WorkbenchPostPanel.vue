<script setup lang="ts">
import type {
  PostLikePayload,
  PostLikeResponse,
  PublicPostDetail,
  RegionScope,
} from "~~/shared/fumo";
import { getCharacterDisplayName } from "~~/shared/fumo";
import { normalizeApiErrorMessage } from "~~/app/composables/normalizeApiErrorMessage";

const props = withDefaults(
  defineProps<{
    postId: number;
    activeCharacterFilterIds?: number[];
  }>(),
  {
    activeCharacterFilterIds: () => [],
  },
);
const emit = defineEmits<{
  "filter-character": [characterId: number];
}>();

const { t, locale } = useI18n();
const auth = useAuthState();
const { formatDateTime, formatLatLng } = useFormatters();
const { getPostDetail, updatePostDetailLike } = usePostDetailCache();

const loading = ref(true);
const errorMessage = ref("");
const likeDialogMessage = ref("");
const post = ref<PublicPostDetail | null>(null);
const selectedPhotoIndex = ref(0);
const liking = ref(false);
const imageViewerOpen = ref(false);
const imageViewerCloseButton = ref<HTMLButtonElement | null>(null);
const likeDialogCloseButton = ref<HTMLButtonElement | null>(null);
const previouslyFocusedElement = ref<HTMLElement | null>(null);
const likeDialogPreviouslyFocusedElement = ref<HTMLElement | null>(null);
type PhotoSwipeTarget = "hero" | "viewer";
type PhotoSwipeIntent = "pending" | "horizontal" | "vertical";
type PhotoLoadState = "loading" | "ready" | "failed";

const heroPhotoLoadStates = reactive(new Map<string, PhotoLoadState>());
const viewerPhotoLoadStates = reactive(new Map<string, PhotoLoadState>());
const photoSwipeOffsets = reactive<Record<PhotoSwipeTarget, number>>({
  hero: 0,
  viewer: 0,
});
const photoSwipeDragging = reactive<Record<PhotoSwipeTarget, boolean>>({
  hero: false,
  viewer: false,
});
let loadSequence = 0;
let photoSwipeState: {
  pointerId: number;
  target: PhotoSwipeTarget;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  intent: PhotoSwipeIntent;
} | null = null;
let suppressNextHeroClick = false;
let suppressNextViewerBackdropClick = false;
let heroClickSuppressTimer: ReturnType<typeof setTimeout> | null = null;
let viewerBackdropClickSuppressTimer: ReturnType<typeof setTimeout> | null =
  null;

const PHOTO_SWIPE_MIN_DISTANCE = 42;
const PHOTO_SWIPE_INTENT_DISTANCE = 8;
const PHOTO_SWIPE_DIRECTION_RATIO = 1.35;
const PHOTO_SWIPE_EDGE_RESISTANCE = 0.3;

const displayPhotos = computed(() => {
  if (!post.value) {
    return [];
  }

  if (post.value.photos.length) {
    return post.value.photos;
  }

  return post.value.imageUrl
    ? [
        {
          imageUrl: post.value.imageUrl,
          thumbUrl: post.value.thumbUrl,
        },
      ]
    : [];
});

const selectedPhoto = computed(() => {
  return (
    displayPhotos.value[selectedPhotoIndex.value] ||
    displayPhotos.value[0] ||
    null
  );
});

const selectedPhotoUrl = computed(() => {
  return selectedPhoto.value?.imageUrl || null;
});

const hasMultiplePhotos = computed(() => displayPhotos.value.length > 1);
const canGoPrevious = computed(() => selectedPhotoIndex.value > 0);
const canGoNext = computed(
  () => selectedPhotoIndex.value < displayPhotos.value.length - 1,
);
const carouselPhotos = computed(() => {
  const photos = [];

  for (
    let index = selectedPhotoIndex.value - 1;
    index <= selectedPhotoIndex.value + 1;
    index += 1
  ) {
    const photo = displayPhotos.value[index];
    const imageUrl = photo?.imageUrl;
    if (!imageUrl) {
      continue;
    }

    photos.push({
      index,
      imageUrl,
      previewUrl: photo.thumbUrl || imageUrl,
      position: index - selectedPhotoIndex.value,
    });
  }

  return photos;
});
const characterName = (character: PublicPostDetail["characters"][number]) => {
  return getCharacterDisplayName(character, locale.value);
};
const isCharacterFilterActive = (characterId: number) => {
  return props.activeCharacterFilterIds.includes(characterId);
};
const photoLoadState = (
  target: PhotoSwipeTarget,
  imageUrl: string,
): PhotoLoadState => {
  const states =
    target === "hero" ? heroPhotoLoadStates : viewerPhotoLoadStates;
  return states.get(imageUrl) || "loading";
};
const selectedHeroPhotoLoadState = computed(() => {
  return selectedPhotoUrl.value
    ? photoLoadState("hero", selectedPhotoUrl.value)
    : "loading";
});
const canOpenImageViewer = computed(() =>
  Boolean(
    selectedPhotoUrl.value && selectedHeroPhotoLoadState.value === "ready",
  ),
);
const viewerId = computed(() => auth.viewer.value?.userId ?? null);
const likeButtonLabel = computed(() => {
  return post.value?.likedByViewer ? t("post.unlike") : t("post.like");
});
const likeIconClass = computed(() => {
  if (liking.value) {
    return "fa-solid fa-spinner fa-spin";
  }

  return post.value?.likedByViewer
    ? "fa-solid fa-heart"
    : "fa-regular fa-heart";
});
const likeDialogOpen = computed(() => Boolean(likeDialogMessage.value));

const authorPath = computed(() => {
  return post.value
    ? createWorkbenchLocation("user", { username: post.value.author.username })
    : createWorkbenchLocation("info");
});

const regionScopeForPost = (
  cityName: string | null = null,
): RegionScope | null => {
  if (!post.value?.regionName) {
    return null;
  }

  return {
    countryName: post.value.countryName,
    regionName: post.value.regionName,
    cityName,
  };
};

const regionPath = () => {
  const scope = regionScopeForPost();
  return scope
    ? createWorkbenchLocation("region", {
        regionScope: scope,
        regionSort: "created",
      })
    : createWorkbenchLocation("info");
};

const cityPath = () => {
  const scope = regionScopeForPost(post.value?.cityName || null);
  return scope && scope.cityName
    ? createWorkbenchLocation("region", {
        regionScope: scope,
        regionSort: "created",
      })
    : createWorkbenchLocation("info");
};

const backgroundImageStyle = (imageUrl: string) => ({
  backgroundImage: `url("${imageUrl.replace(/"/g, '\\"')}")`,
});

const loadPost = async () => {
  const currentLoad = ++loadSequence;
  loading.value = true;
  errorMessage.value = "";
  heroPhotoLoadStates.clear();
  viewerPhotoLoadStates.clear();
  resetPhotoSwipe();
  closeLikeDialog();

  if (!auth.ready.value) {
    return;
  }

  try {
    const nextPost = await getPostDetail(props.postId, {
      headers: auth.authHeaders.value,
      viewerId: viewerId.value,
    });
    if (currentLoad !== loadSequence) {
      return;
    }

    post.value = nextPost;
    selectedPhotoIndex.value = 0;
  } catch (error) {
    if (currentLoad !== loadSequence) {
      return;
    }

    post.value = null;
    selectedPhotoIndex.value = 0;
    errorMessage.value = normalizeApiErrorMessage(
      error,
      t("post.errors.loadFailed"),
    );
  } finally {
    if (currentLoad === loadSequence) {
      loading.value = false;
    }
  }
};

const selectPhoto = (index: number) => {
  if (index < 0 || index >= displayPhotos.value.length) {
    return;
  }

  resetPhotoSwipe();
  selectedPhotoIndex.value = index;
};

const goPreviousPhoto = () => {
  if (!canGoPrevious.value) {
    return;
  }

  selectPhoto(selectedPhotoIndex.value - 1);
};

const goNextPhoto = () => {
  if (!canGoNext.value) {
    return;
  }

  selectPhoto(selectedPhotoIndex.value + 1);
};

const photoIndicatorLabel = (index: number) =>
  `${index + 1} / ${displayPhotos.value.length}`;

const isPhotoSwipeIgnoredTarget = (target: EventTarget | null) => {
  return (
    target instanceof Element &&
    Boolean(target.closest("button, a, input, textarea, select"))
  );
};

const resetPhotoSwipe = (target?: PhotoSwipeTarget) => {
  const targets: PhotoSwipeTarget[] = target ? [target] : ["hero", "viewer"];

  if (!target || photoSwipeState?.target === target) {
    photoSwipeState = null;
  }

  for (const swipeTarget of targets) {
    photoSwipeOffsets[swipeTarget] = 0;
    photoSwipeDragging[swipeTarget] = false;
  }
};

const photoSlideStyle = (target: PhotoSwipeTarget, position: number) => ({
  transform: `translate3d(calc(${position * 100}% + ${photoSwipeOffsets[target]}px), 0, 0)`,
});

const isPhotoSwipeDragging = (target: PhotoSwipeTarget) =>
  photoSwipeDragging[target];

const photoSwipeIntent = (deltaX: number, deltaY: number): PhotoSwipeIntent => {
  const horizontalDistance = Math.abs(deltaX);
  const verticalDistance = Math.abs(deltaY);

  if (
    Math.max(horizontalDistance, verticalDistance) < PHOTO_SWIPE_INTENT_DISTANCE
  ) {
    return "pending";
  }

  if (horizontalDistance > verticalDistance * PHOTO_SWIPE_DIRECTION_RATIO) {
    return "horizontal";
  }

  if (verticalDistance > horizontalDistance * PHOTO_SWIPE_DIRECTION_RATIO) {
    return "vertical";
  }

  return "pending";
};

const resistedPhotoSwipeOffset = (deltaX: number) => {
  if (
    (deltaX > 0 && !canGoPrevious.value) ||
    (deltaX < 0 && !canGoNext.value)
  ) {
    return deltaX * PHOTO_SWIPE_EDGE_RESISTANCE;
  }

  return deltaX;
};

const setHeroClickSuppressed = () => {
  suppressNextHeroClick = true;
  if (heroClickSuppressTimer) {
    clearTimeout(heroClickSuppressTimer);
  }
  heroClickSuppressTimer = setTimeout(() => {
    suppressNextHeroClick = false;
    heroClickSuppressTimer = null;
  }, 350);
};

const setViewerBackdropClickSuppressed = () => {
  suppressNextViewerBackdropClick = true;
  if (viewerBackdropClickSuppressTimer) {
    clearTimeout(viewerBackdropClickSuppressTimer);
  }
  viewerBackdropClickSuppressTimer = setTimeout(() => {
    suppressNextViewerBackdropClick = false;
    viewerBackdropClickSuppressTimer = null;
  }, 350);
};

const isIntentionalHorizontalSwipe = (deltaX: number, deltaY: number) => {
  return (
    Math.abs(deltaX) >= PHOTO_SWIPE_MIN_DISTANCE &&
    Math.abs(deltaX) > Math.abs(deltaY) * PHOTO_SWIPE_DIRECTION_RATIO
  );
};

const releasePhotoSwipePointer = (event: PointerEvent) => {
  if (!(event.currentTarget instanceof HTMLElement)) {
    return;
  }

  try {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  } catch {
    // Pointer capture can already be released by the browser during cancellation.
  }
};

const handlePhotoSwipePointerDown = (
  event: PointerEvent,
  target: PhotoSwipeTarget,
) => {
  if (
    !hasMultiplePhotos.value ||
    !event.isPrimary ||
    (event.pointerType !== "touch" && event.pointerType !== "pen") ||
    event.button !== 0 ||
    isPhotoSwipeIgnoredTarget(event.target)
  ) {
    return;
  }

  resetPhotoSwipe();
  photoSwipeState = {
    pointerId: event.pointerId,
    target,
    startX: event.clientX,
    startY: event.clientY,
    lastX: event.clientX,
    lastY: event.clientY,
    intent: "pending",
  };
  photoSwipeDragging[target] = true;

  if (event.currentTarget instanceof HTMLElement) {
    event.currentTarget.setPointerCapture(event.pointerId);
  }
};

const handlePhotoSwipePointerMove = (event: PointerEvent) => {
  if (!photoSwipeState || photoSwipeState.pointerId !== event.pointerId) {
    return;
  }

  photoSwipeState.lastX = event.clientX;
  photoSwipeState.lastY = event.clientY;

  const deltaX = photoSwipeState.lastX - photoSwipeState.startX;
  const deltaY = photoSwipeState.lastY - photoSwipeState.startY;
  if (photoSwipeState.intent === "pending") {
    photoSwipeState.intent = photoSwipeIntent(deltaX, deltaY);
  }

  if (photoSwipeState.intent === "horizontal") {
    photoSwipeOffsets[photoSwipeState.target] =
      resistedPhotoSwipeOffset(deltaX);
    event.preventDefault();
  }
};

const handlePhotoSwipePointerUp = (event: PointerEvent) => {
  if (!photoSwipeState || photoSwipeState.pointerId !== event.pointerId) {
    return;
  }

  const swipeState = photoSwipeState;
  const swipeTarget = swipeState.target;
  const deltaX = event.clientX - photoSwipeState.startX;
  const deltaY = event.clientY - photoSwipeState.startY;
  const hadHorizontalIntent = swipeState.intent === "horizontal";
  const shouldChangePhoto =
    hadHorizontalIntent && isIntentionalHorizontalSwipe(deltaX, deltaY);
  photoSwipeState = null;
  releasePhotoSwipePointer(event);

  if (hadHorizontalIntent) {
    if (swipeTarget === "hero") {
      setHeroClickSuppressed();
    } else {
      setViewerBackdropClickSuppressed();
    }
  }

  if (shouldChangePhoto && deltaX > 0 && canGoPrevious.value) {
    goPreviousPhoto();
    return;
  }

  if (shouldChangePhoto && deltaX < 0 && canGoNext.value) {
    goNextPhoto();
    return;
  }

  resetPhotoSwipe(swipeTarget);
};

const handlePhotoSwipePointerCancel = (event: PointerEvent) => {
  if (!photoSwipeState || photoSwipeState.pointerId !== event.pointerId) {
    return;
  }

  const swipeTarget = photoSwipeState.target;
  photoSwipeState = null;
  releasePhotoSwipePointer(event);
  resetPhotoSwipe(swipeTarget);
};

const handleHeroImageClick = () => {
  if (suppressNextHeroClick) {
    suppressNextHeroClick = false;
    return;
  }

  openImageViewer();
};

const handleImageViewerBackdropClick = () => {
  if (suppressNextViewerBackdropClick) {
    suppressNextViewerBackdropClick = false;
    return;
  }

  closeImageViewer();
};

const openImageViewer = () => {
  if (!canOpenImageViewer.value) {
    return;
  }

  if (document.activeElement instanceof HTMLElement) {
    previouslyFocusedElement.value = document.activeElement;
  }

  resetPhotoSwipe("viewer");
  imageViewerOpen.value = true;
  void nextTick(() => {
    imageViewerCloseButton.value?.focus();
  });
};

const closeImageViewer = () => {
  if (!imageViewerOpen.value) {
    return;
  }

  imageViewerOpen.value = false;
  resetPhotoSwipe("viewer");
  void nextTick(() => {
    previouslyFocusedElement.value?.focus();
    previouslyFocusedElement.value = null;
  });
};

const openLikeDialog = (message: string) => {
  if (!message) {
    return;
  }

  if (document.activeElement instanceof HTMLElement) {
    likeDialogPreviouslyFocusedElement.value = document.activeElement;
  }

  likeDialogMessage.value = message;
  void nextTick(() => {
    likeDialogCloseButton.value?.focus();
  });
};

const closeLikeDialog = () => {
  if (!likeDialogMessage.value) {
    return;
  }

  likeDialogMessage.value = "";
  void nextTick(() => {
    likeDialogPreviouslyFocusedElement.value?.focus();
    likeDialogPreviouslyFocusedElement.value = null;
  });
};

const toggleLike = async () => {
  closeLikeDialog();
  await auth.init();

  if (!post.value) {
    return;
  }

  if (!auth.session.value?.access_token) {
    openLikeDialog(t("post.errors.loginToLike"));
    return;
  }

  liking.value = true;

  try {
    const response = await $fetch<PostLikeResponse>(
      `/api/posts/${post.value.id}/like`,
      {
        method: "PUT",
        headers: auth.authHeaders.value,
        body: {
          liked: !post.value.likedByViewer,
        } satisfies PostLikePayload,
      },
    );

    post.value = {
      ...post.value,
      likeCount: response.likeCount,
      likedByViewer: response.likedByViewer,
    };
    updatePostDetailLike(response.postId, response, viewerId.value);
  } catch (error) {
    openLikeDialog(
      normalizeApiErrorMessage(error, t("post.errors.likeFailed")),
    );
  } finally {
    liking.value = false;
  }
};

const setPhotoLoadState = (
  target: PhotoSwipeTarget,
  imageUrl: string,
  state: PhotoLoadState,
) => {
  const states =
    target === "hero" ? heroPhotoLoadStates : viewerPhotoLoadStates;
  states.set(imageUrl, state);
};

const handleViewerKeydown = (event: KeyboardEvent) => {
  if (!imageViewerOpen.value) {
    return;
  }

  if (event.key === "Escape") {
    event.preventDefault();
    closeImageViewer();
    return;
  }

  if (event.key === "ArrowLeft") {
    event.preventDefault();
    goPreviousPhoto();
    return;
  }

  if (event.key === "ArrowRight") {
    event.preventDefault();
    goNextPhoto();
  }
};

const handleLikeDialogKeydown = (event: KeyboardEvent) => {
  if (!likeDialogOpen.value || event.key !== "Escape") {
    return;
  }

  event.preventDefault();
  closeLikeDialog();
};

watch(
  selectedPhotoUrl,
  () => {
    resetPhotoSwipe();

    if (!selectedPhotoUrl.value) {
      closeImageViewer();
    }
  },
  { immediate: true },
);

watch(imageViewerOpen, (isOpen) => {
  if (typeof window === "undefined") {
    return;
  }

  if (isOpen) {
    window.addEventListener("keydown", handleViewerKeydown);
    return;
  }

  window.removeEventListener("keydown", handleViewerKeydown);
});

watch(likeDialogOpen, (isOpen) => {
  if (typeof window === "undefined") {
    return;
  }

  if (isOpen) {
    window.addEventListener("keydown", handleLikeDialogKeydown);
    return;
  }

  window.removeEventListener("keydown", handleLikeDialogKeydown);
});

watch(
  () =>
    [
      props.postId,
      auth.ready.value,
      auth.authHeaders.value.Authorization || "",
      locale.value,
    ] as const,
  () => {
    closeImageViewer();
    void loadPost();
  },
  { immediate: true },
);

onMounted(() => {
  void auth.init();
});

onBeforeUnmount(() => {
  if (typeof window !== "undefined") {
    window.removeEventListener("keydown", handleViewerKeydown);
    window.removeEventListener("keydown", handleLikeDialogKeydown);
  }
  if (heroClickSuppressTimer) {
    clearTimeout(heroClickSuppressTimer);
  }
  if (viewerBackdropClickSuppressTimer) {
    clearTimeout(viewerBackdropClickSuppressTimer);
  }
});
</script>

<template>
  <section class="workbench-panel workbench-panel--detail">
    <template v-if="loading">
      <div
        class="workbench-detail-skeleton"
        role="status"
        :aria-label="t('post.loadingTitle')"
      >
        <div class="workbench-detail-skeleton__hero" aria-hidden="true">
          <span
            class="workbench-skeleton-shape workbench-skeleton-shape--hero"
          ></span>
        </div>

        <div class="workbench-detail-skeleton__body" aria-hidden="true">
          <div class="workbench-detail-skeleton__titlebar">
            <span
              class="workbench-skeleton-shape workbench-skeleton-shape--title"
            ></span>
            <span
              class="workbench-skeleton-shape workbench-skeleton-shape--icon"
            ></span>
          </div>

          <div class="workbench-detail-skeleton__lines">
            <span
              class="workbench-skeleton-shape workbench-skeleton-shape--line"
            ></span>
            <span
              class="workbench-skeleton-shape workbench-skeleton-shape--line workbench-skeleton-shape--line-short"
            ></span>
            <span
              class="workbench-skeleton-shape workbench-skeleton-shape--line"
            ></span>
            <span
              class="workbench-skeleton-shape workbench-skeleton-shape--line workbench-skeleton-shape--line-mid"
            ></span>
          </div>

          <div class="workbench-detail-skeleton__note">
            <span
              class="workbench-skeleton-shape workbench-skeleton-shape--label"
            ></span>
            <span
              class="workbench-skeleton-shape workbench-skeleton-shape--paragraph"
            ></span>
            <span
              class="workbench-skeleton-shape workbench-skeleton-shape--paragraph workbench-skeleton-shape--paragraph-short"
            ></span>
          </div>
        </div>

        <span class="sr-only">{{ t("post.loadingTitle") }}</span>
      </div>
    </template>

    <template v-else-if="post">
      <div
        v-if="selectedPhotoUrl"
        class="workbench-detail-hero"
        :class="{
          'is-loading': selectedHeroPhotoLoadState === 'loading',
          'is-ready': selectedHeroPhotoLoadState === 'ready',
          'is-photo-dragging': isPhotoSwipeDragging('hero'),
        }"
        @pointerdown="handlePhotoSwipePointerDown($event, 'hero')"
        @pointermove="handlePhotoSwipePointerMove"
        @pointerup="handlePhotoSwipePointerUp"
        @pointercancel="handlePhotoSwipePointerCancel"
      >
        <div
          v-for="item in carouselPhotos"
          :key="`hero-photo-${item.index}-${item.imageUrl}`"
          class="workbench-detail-hero__slide"
          :class="{ 'is-current': item.index === selectedPhotoIndex }"
          :style="photoSlideStyle('hero', item.position)"
          :aria-hidden="item.index === selectedPhotoIndex ? undefined : 'true'"
        >
          <div
            class="workbench-detail-hero__backdrop"
            :style="backgroundImageStyle(item.previewUrl)"
            aria-hidden="true"
          />
          <div
            v-if="photoLoadState('hero', item.imageUrl) !== 'ready'"
            class="workbench-detail-hero__placeholder"
            :aria-live="item.index === selectedPhotoIndex ? 'polite' : 'off'"
          >
            <span
              v-if="photoLoadState('hero', item.imageUrl) === 'loading'"
              class="workbench-progress-ring workbench-progress-ring--hero"
              aria-hidden="true"
            ></span>
            <i v-else class="fa-solid fa-image" aria-hidden="true" />
            <span class="sr-only">
              {{
                photoLoadState("hero", item.imageUrl) === "failed"
                  ? t("post.unavailableTitle")
                  : t("post.loadingTitle")
              }}
            </span>
          </div>
          <img
            v-show="photoLoadState('hero', item.imageUrl) !== 'failed'"
            class="workbench-detail-hero__image"
            :class="{
              'is-ready': photoLoadState('hero', item.imageUrl) === 'ready',
              'is-zoomable':
                item.index === selectedPhotoIndex && canOpenImageViewer,
            }"
            :src="item.imageUrl"
            :alt="item.index === selectedPhotoIndex ? post.title : ''"
            decoding="async"
            :fetchpriority="item.index === selectedPhotoIndex ? 'high' : 'auto'"
            :loading="item.index === selectedPhotoIndex ? 'eager' : 'lazy'"
            draggable="false"
            :role="item.index === selectedPhotoIndex ? 'button' : undefined"
            :tabindex="
              item.index === selectedPhotoIndex && canOpenImageViewer ? 0 : -1
            "
            :aria-label="
              item.index === selectedPhotoIndex
                ? t('post.openPhotoViewer')
                : undefined
            "
            @click="item.index === selectedPhotoIndex && handleHeroImageClick()"
            @keydown.enter.prevent="
              item.index === selectedPhotoIndex && openImageViewer()
            "
            @keydown.space.prevent="
              item.index === selectedPhotoIndex && openImageViewer()
            "
            @load="setPhotoLoadState('hero', item.imageUrl, 'ready')"
            @error="setPhotoLoadState('hero', item.imageUrl, 'failed')"
          />
        </div>
        <template v-if="hasMultiplePhotos">
          <div
            class="workbench-detail-hero__nav-zone workbench-detail-hero__nav-zone--previous"
          >
            <button
              class="workbench-detail-hero__nav-button"
              type="button"
              :aria-label="t('post.previousPhoto')"
              :disabled="!canGoPrevious"
              @click="goPreviousPhoto"
            >
              <i class="fa-solid fa-chevron-left" aria-hidden="true" />
            </button>
          </div>
          <div
            class="workbench-detail-hero__nav-zone workbench-detail-hero__nav-zone--next"
          >
            <button
              class="workbench-detail-hero__nav-button"
              type="button"
              :aria-label="t('post.nextPhoto')"
              :disabled="!canGoNext"
              @click="goNextPhoto"
            >
              <i class="fa-solid fa-chevron-right" aria-hidden="true" />
            </button>
          </div>
          <div class="workbench-detail-hero__indicators">
            <button
              v-for="(_, index) in displayPhotos"
              :key="`photo-indicator-${index}`"
              class="workbench-detail-hero__indicator"
              :class="{ 'is-active': index === selectedPhotoIndex }"
              type="button"
              :title="photoIndicatorLabel(index)"
              :aria-label="photoIndicatorLabel(index)"
              :aria-current="index === selectedPhotoIndex ? 'true' : undefined"
              @click="selectPhoto(index)"
            />
          </div>
        </template>
      </div>

      <div class="workbench-detail-body">
        <div class="workbench-detail-titlebar">
          <h2 class="workbench-panel__title workbench-panel__title--poster">
            {{ post.title }}
          </h2>
          <div class="workbench-detail-like">
            <button
              class="workbench-icon-button workbench-detail-like__button"
              :class="{ 'is-liked': post.likedByViewer }"
              type="button"
              :title="likeButtonLabel"
              :aria-label="likeButtonLabel"
              :aria-pressed="post.likedByViewer"
              :disabled="liking"
              @click="toggleLike"
            >
              <i
                class="button-icon"
                :class="likeIconClass"
                aria-hidden="true"
              />
              <span class="sr-only">{{ likeButtonLabel }}</span>
            </button>
            <span
              class="workbench-detail-like__count"
              :aria-label="t('post.likeCount', { count: post.likeCount ?? 0 })"
            >
              {{ post.likeCount ?? 0 }}
            </span>
          </div>
        </div>

        <div class="workbench-detail-lines">
          <p>
            <i class="button-icon fa-solid fa-user" aria-hidden="true" />
            <NuxtLink class="workbench-detail-link" :to="authorPath">
              @{{ post.author.username }}
            </NuxtLink>
          </p>
          <p>
            <i
              class="button-icon fa-solid fa-location-dot"
              aria-hidden="true"
            />
            <span
              v-if="
                [post.countryName, post.regionName, post.cityName].filter(
                  Boolean,
                ).length
              "
              class="support-copy"
            >
              <template v-if="post.countryName">
                <span>{{ post.countryName }}</span>
              </template>
              <template v-if="post.regionName">
                <span v-if="post.countryName"> / </span>
                <NuxtLink class="workbench-detail-link" :to="regionPath()">
                  {{ post.regionName }}
                </NuxtLink>
              </template>
              <template v-if="post.cityName">
                <span v-if="post.countryName || post.regionName"> / </span>
                <NuxtLink
                  v-if="post.regionName"
                  class="workbench-detail-link"
                  :to="cityPath()"
                >
                  {{ post.cityName }}
                </NuxtLink>
                <span v-else>{{ post.cityName }}</span>
              </template>
            </span>
            <span>{{ post.placeName || t("post.unnamedPlaceName") }}</span>
          </p>
          <p v-if="post.privacyMode === 'exact'">
            <i class="button-icon fa-solid fa-crosshairs" aria-hidden="true" />
            <span class="support-copy">{{
              formatLatLng(post.publicLocation)
            }}</span>
          </p>
          <p>
            <i class="button-icon fa-solid fa-clock" aria-hidden="true" />
            <span>{{ formatDateTime(post.capturedAt) }}</span>
          </p>
        </div>

        <div
          v-if="post.body || post.characters.length"
          class="workbench-detail-grid"
        >
          <div class="workbench-detail-section field-grid">
            <template v-if="post.body">
              <strong>{{ t("post.authorNote") }}</strong>
              <p class="support-copy">{{ post.body }}</p>
            </template>
          </div>
        </div>

        <div v-if="post.characters.length" class="workbench-detail-grid">
          <div class="field-grid">
            <strong>{{ t("post.characters") }}</strong>
            <div
              class="workbench-detail-character-tags"
              :aria-label="t('submit.charactersLabel')"
            >
              <button
                v-for="character in post.characters"
                :key="character.id"
                class="workbench-detail-character-tag"
                :class="{ 'is-active': isCharacterFilterActive(character.id) }"
                type="button"
                :title="t('post.filterByCharacter', { name: characterName(character) })"
                :aria-label="t('post.filterByCharacter', { name: characterName(character) })"
                :aria-pressed="isCharacterFilterActive(character.id)"
                @click="emit('filter-character', character.id)"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="1.2em"
                  height="1.2em"
                  viewBox="0 0 16 16"
                  aria-hidden="true"
                >
                  <path d="M0 0h16v16H0z" fill="none" />
                  <path
                    fill="currentColor"
                    d="M8.39 12.648a1 1 0 0 0-.015.18c0 .305.21.508.5.508c.266 0 .492-.172.555-.477l.554-2.703h1.204c.421 0 .617-.234.617-.547c0-.312-.188-.53-.617-.53h-.985l.516-2.524h1.265c.43 0 .618-.227.618-.547c0-.313-.188-.524-.618-.524h-1.046l.476-2.304a1 1 0 0 0 .016-.164a.51.51 0 0 0-.516-.516a.54.54 0 0 0-.539.43l-.523 2.554H7.617l.477-2.304c.008-.04.015-.118.015-.164a.51.51 0 0 0-.523-.516a.54.54 0 0 0-.531.43L6.53 5.484H5.414c-.43 0-.617.22-.617.532s.187.539.617.539h.906l-.515 2.523H4.609c-.421 0-.609.219-.609.531s.188.547.61.547h.976l-.516 2.492c-.008.04-.015.125-.015.18c0 .305.21.508.5.508c.265 0 .492-.172.554-.477l.555-2.703h2.242zm-1-6.109h2.266l-.515 2.563H6.859l.532-2.563z"
                  />
                </svg>
                <span class="workbench-detail-character-tag__name">
                  {{ characterName(character) }}
                </span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </template>

    <div v-else class="empty-state empty-state--inline">
      <h2>{{ t("post.unavailableTitle") }}</h2>
      <p v-if="errorMessage">{{ errorMessage }}</p>
    </div>
  </section>

  <Teleport to="body">
    <div
      v-if="likeDialogOpen"
      class="workbench-like-dialog"
      role="alertdialog"
      aria-modal="true"
      :aria-label="t('post.likeNotice')"
      @click.self="closeLikeDialog"
    >
      <div class="workbench-like-dialog__panel">
        <i
          class="workbench-like-dialog__icon fa-solid fa-circle-info"
          aria-hidden="true"
        />
        <p>{{ likeDialogMessage }}</p>
        <button
          ref="likeDialogCloseButton"
          class="workbench-icon-button workbench-like-dialog__close"
          type="button"
          :title="t('common.close')"
          :aria-label="t('common.close')"
          @click="closeLikeDialog"
        >
          <i class="button-icon fa-solid fa-xmark" aria-hidden="true" />
          <span class="sr-only">{{ t("common.close") }}</span>
        </button>
      </div>
    </div>
  </Teleport>

  <Teleport to="body">
    <div
      v-if="imageViewerOpen && selectedPhotoUrl && post"
      class="workbench-photo-viewer"
      :class="{ 'is-photo-dragging': isPhotoSwipeDragging('viewer') }"
      role="dialog"
      aria-modal="true"
      :aria-label="post.title"
      @click.self="handleImageViewerBackdropClick"
      @pointerdown="handlePhotoSwipePointerDown($event, 'viewer')"
      @pointermove="handlePhotoSwipePointerMove"
      @pointerup="handlePhotoSwipePointerUp"
      @pointercancel="handlePhotoSwipePointerCancel"
    >
      <button
        ref="imageViewerCloseButton"
        class="workbench-photo-viewer__close"
        type="button"
        :aria-label="t('post.closePhotoViewer')"
        @click="closeImageViewer"
      >
        <i class="fa-solid fa-xmark" aria-hidden="true" />
      </button>

      <button
        v-if="hasMultiplePhotos"
        class="workbench-photo-viewer__nav workbench-photo-viewer__nav--previous"
        type="button"
        :aria-label="t('post.previousPhoto')"
        :disabled="!canGoPrevious"
        @click="goPreviousPhoto"
      >
        <i class="fa-solid fa-chevron-left" aria-hidden="true" />
      </button>

      <div class="workbench-photo-viewer__stage">
        <div
          v-for="item in carouselPhotos"
          :key="`viewer-photo-${item.index}-${item.imageUrl}`"
          class="workbench-photo-viewer__slide"
          :class="{ 'is-current': item.index === selectedPhotoIndex }"
          :style="photoSlideStyle('viewer', item.position)"
          :aria-hidden="item.index === selectedPhotoIndex ? undefined : 'true'"
        >
          <div
            v-if="photoLoadState('viewer', item.imageUrl) !== 'ready'"
            class="workbench-photo-viewer__placeholder"
            :aria-live="item.index === selectedPhotoIndex ? 'polite' : 'off'"
          >
            <span
              v-if="photoLoadState('viewer', item.imageUrl) === 'loading'"
              class="workbench-progress-ring workbench-progress-ring--viewer"
              aria-hidden="true"
            ></span>
            <i v-else class="fa-solid fa-image" aria-hidden="true" />
            <span class="sr-only">
              {{
                photoLoadState("viewer", item.imageUrl) === "failed"
                  ? t("post.unavailableTitle")
                  : t("post.loadingTitle")
              }}
            </span>
          </div>
          <img
            v-show="photoLoadState('viewer', item.imageUrl) !== 'failed'"
            class="workbench-photo-viewer__image"
            :class="{
              'is-ready': photoLoadState('viewer', item.imageUrl) === 'ready',
            }"
            :src="item.imageUrl"
            :alt="item.index === selectedPhotoIndex ? post.title : ''"
            decoding="async"
            :fetchpriority="item.index === selectedPhotoIndex ? 'high' : 'auto'"
            :loading="item.index === selectedPhotoIndex ? 'eager' : 'lazy'"
            draggable="false"
            @load="setPhotoLoadState('viewer', item.imageUrl, 'ready')"
            @error="setPhotoLoadState('viewer', item.imageUrl, 'failed')"
          />
        </div>
      </div>

      <button
        v-if="hasMultiplePhotos"
        class="workbench-photo-viewer__nav workbench-photo-viewer__nav--next"
        type="button"
        :aria-label="t('post.nextPhoto')"
        :disabled="!canGoNext"
        @click="goNextPhoto"
      >
        <i class="fa-solid fa-chevron-right" aria-hidden="true" />
      </button>
    </div>
  </Teleport>
</template>
