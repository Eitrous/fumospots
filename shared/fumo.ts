export type PrivacyMode = 'exact' | 'approx'
export type PostStatus = 'pending' | 'approved' | 'rejected'
export type PostRevisionStatus = 'pending' | 'approved' | 'rejected'
export type AdminReviewItemKind = 'post' | 'revision'
export type UserRole = 'user' | 'admin'
export type WorkbenchPanel = 'info' | 'post' | 'login' | 'onboarding' | 'submit' | 'edit' | 'user'

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
  thumbUrl: string | null
  privacyMode: PrivacyMode
  capturedAt: string | null
}

export type PublicMapCollection = GeoJSON.FeatureCollection<
  GeoJSON.Point,
  PublicMapFeatureProperties
>

export type PublicPostDetail = {
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
  publicLocation: LatLng | null
  privacyMode: PrivacyMode
  capturedAt: string | null
  createdAt: string | null
  author: {
    username: string
    avatarUrl: string | null
  }
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
  posts: UserPostSummary[]
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
}

export type EditPostPayload = SubmitPostPayload

export type SubmitPostPhotoPayload = {
  imagePath: string
  thumbPath: string | null
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
  'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json'
export const MAP_DARK_STYLE_URL = 
  'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'
export const MAP_DEFAULT_CENTER: [number, number] = [116.397389, 39.908722]
export const MAP_DEFAULT_ZOOM = 1.55
export const MAP_THUMBNAIL_ZOOM = 5.8
export const MAX_TITLE_LENGTH = 80
export const MAX_BODY_LENGTH = 1000
export const MAX_POST_PHOTOS = 10
export const USERNAME_PATTERN = /^[a-zA-Z0-9_-]{3,24}$/
