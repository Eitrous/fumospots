export type PrivacyMode = 'exact' | 'approx'
export type PostStatus = 'pending' | 'approved' | 'rejected'
export type PostRevisionStatus = 'pending' | 'approved' | 'rejected'
export type AdminReviewItemKind = 'post' | 'revision'
export type UserRole = 'user' | 'admin'
export type WorkbenchPanel = 'info' | 'post' | 'login' | 'onboarding' | 'submit' | 'edit' | 'user' | 'region' | 'posts'
export type RegionSort = 'created' | 'captured'

export type CharacterCatalogItem = {
  id: number
  slug: string
  nameEn: string
  nameZh: string | null
  nameJa: string | null
}

export type CharacterCatalogResponse = {
  items: CharacterCatalogItem[]
}

export type LatLng = {
  lat: number
  lng: number
}

export type AppProfile = {
  id: string
  username: string | null
  avatarUrl: string | null
  role: UserRole
  createdAt: string | null
  updatedAt: string | null
}

export type CurrentViewer = {
  userId: string
  email: string | null
  profile: AppProfile
}

export type GeocodeResult = {
  displayName: string
  placeName: string
  lat: number
  lng: number
  countryName: string | null
  regionName: string | null
  cityName: string | null
}

export type PublicMapFeatureProperties = {
  id: number
  title: string
  placeName: string | null
  username: string
  privacyMode: PrivacyMode
  capturedAt: string | null
}

export type PublicMapCollection = GeoJSON.FeatureCollection<
  GeoJSON.Point,
  PublicMapFeatureProperties
>

export type PublicMapPointProperties = {
  id: number
  userId: string
}

export type PublicMapPointCollection = GeoJSON.FeatureCollection<
  GeoJSON.Point,
  PublicMapPointProperties
>

export type PublicMapPreviewItem = {
  id: number
  title: string
  thumbUrl: string | null
}

export type PublicMapPreviewResponse = {
  items: PublicMapPreviewItem[]
}

export type PublicLatestPostItem = {
  id: number
  title: string
  thumbUrl: string | null
  placeName: string | null
}

export type PublicLatestPostsResponse = {
  items: PublicLatestPostItem[]
}

export type PublicPostListItem = {
  id: number
  title: string
  thumbUrl: string | null
  placeName: string | null
  createdAt: string | null
}

export type PublicPostsPageResponse = {
  postCount: number
  items: PublicPostListItem[]
  nextOffset: number | null
}

export type PublicPostDetail = {
  id: number
  title: string
  body: string | null
  imageUrl: string | null
  thumbUrl: string | null
  photos: PostPhotoAsset[]
  likeCount: number
  likedByViewer: boolean
  placeName: string | null
  countryName: string | null
  regionName: string | null
  cityName: string | null
  publicLocation: LatLng | null
  privacyMode: PrivacyMode
  capturedAt: string | null
  createdAt: string | null
  characters: CharacterCatalogItem[]
  author: {
    username: string
    avatarUrl: string | null
  }
}

export type RandomPostResponse = {
  id: number
}

export type PublicMapCountResponse = {
  count: number
  registeredUserCount: number
}

export type AdminReviewPost = {
  reviewKey: string
  reviewKind: AdminReviewItemKind
  revisionId: number | null
  id: number
  title: string
  body: string | null
  imageUrl: string | null
  thumbUrl: string | null
  photos: PostPhotoAsset[]
  placeName: string | null
  countryName: string | null
  regionName: string | null
  cityName: string | null
  exactLocation: LatLng | null
  publicLocation: LatLng | null
  privacyMode: PrivacyMode
  capturedAt: string | null
  createdAt: string | null
  reviewNote: string | null
  characters: CharacterCatalogItem[]
  author: {
    id: string
    username: string
    avatarUrl: string | null
  }
}

export type AdminCharacterBackfillItem = {
  id: number
  title: string
  body: string | null
  imageUrl: string | null
  thumbUrl: string | null
  photos: PostPhotoAsset[]
  placeName: string | null
  exactLocation: LatLng | null
  publicLocation: LatLng | null
  privacyMode: PrivacyMode
  capturedAt: string | null
  createdAt: string | null
  author: {
    id: string
    username: string
    avatarUrl: string | null
  }
}

export type UserPostSummary = {
  id: number
  title: string
  body: string | null
  thumbUrl: string | null
  placeName: string | null
  status: PostStatus
  hasPendingRevision: boolean
  capturedAt: string | null
  createdAt: string | null
  updatedAt: string | null
}

export type PublicUserPage = {
  profile: {
    id: string
    username: string
    avatarUrl: string | null
  }
  isSelf: boolean
  totalLikeCount: number
  posts: UserPostSummary[]
}

export type RegionScope = {
  countryName: string | null
  regionName: string
  cityName: string | null
}

export type GeoBounds = {
  west: number
  south: number
  east: number
  north: number
}

export type RegionGeometryResponse = {
  scope: RegionScope
  bbox: GeoBounds | null
  geometry: GeoJSON.Geometry | null
}

export type RegionPostSummary = {
  id: number
  title: string
  thumbUrl: string | null
  placeName: string | null
  capturedAt: string | null
  createdAt: string | null
  author: {
    username: string
  }
}

export type PublicRegionPage = {
  title: string
  scope: RegionScope
  sort: RegionSort
  postCount: number
  posts: RegionPostSummary[]
}

export type PostLikePayload = {
  liked: boolean
}

export type PostLikeResponse = {
  postId: number
  likeCount: number
  likedByViewer: boolean
}

export type SubmitPostPayload = {
  title: string
  body: string | null
  photos: SubmitPostPhotoPayload[]
  capturedAt: string | null
  exactLocation: LatLng
  publicLocation: LatLng
  privacyMode: PrivacyMode
  placeName: string
  countryName: string | null
  regionName: string | null
  cityName: string | null
  characterIds: number[]
}

export type EditPostPayload = SubmitPostPayload

export type SubmitPostPhotoPayload = {
  imagePath: string
  thumbPath: string | null
}

export type SubmitSuggestionPayload = {
  content: string
}

export type SuggestionSubmitResponse = {
  success: true
}

export type AdminSuggestionItem = {
  id: number
  content: string
  createdAt: string | null
  author: {
    id: string
    username: string | null
    avatarUrl: string | null
  }
}

export type PostPhotoAsset = {
  imageUrl: string | null
  thumbUrl: string | null
}

export type EditablePostPhotoAsset = PostPhotoAsset & {
  imagePath: string
  thumbPath: string | null
}

export type EditablePostDetail = Omit<SubmitPostPayload, 'photos'> & {
  id: number
  status: PostStatus
  hasPendingRevision: boolean
  photos: EditablePostPhotoAsset[]
}

export const STORAGE_BUCKET = 'fumo'
export const MAP_DEFAULT_STYLE_URL =
  '/api/map/style/light'
export const MAP_DARK_STYLE_URL =
  '/api/map/style/dark'
export const MAP_DEFAULT_CENTER: [number, number] = [116.397389, 39.908722]
export const MAP_DEFAULT_ZOOM = 1.55
export const MAX_TITLE_LENGTH = 80
export const MAX_BODY_LENGTH = 1000
export const MAX_SUGGESTION_LENGTH = 2000
export const MAX_POST_PHOTOS = 10
export const MAX_PHOTO_UPLOAD_BYTES = 25 * 1024 * 1024
export const MIN_PASSWORD_LENGTH = 8
export const USERNAME_PATTERN = /^[a-zA-Z0-9_-]{3,24}$/

export const getCharacterDisplayName = (
  character: CharacterCatalogItem,
  locale: string
) => {
  const normalizedLocale = locale.toLowerCase()

  if (normalizedLocale.startsWith('zh') && character.nameZh) {
    return character.nameZh
  }

  if (normalizedLocale.startsWith('ja') && character.nameJa) {
    return character.nameJa
  }

  return character.nameEn
}
