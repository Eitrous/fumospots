export const SOUTH_TIBET_STANDARD_MAP_SOURCE_URL =
  'https://zrzyt.xizang.gov.cn/fw/zyxz/202004/t20200430_139102.html'

export const SOUTH_TIBET_COUNTY_LABEL_MIN_ZOOM = 8
export const SOUTH_TIBET_VILLAGE_LABEL_MIN_ZOOM = 10

type OfficialLabelKind = 'county' | 'village'
type OfficialLabelPoint = readonly [
  name: string,
  longitude: number,
  latitude: number,
  labelKind: OfficialLabelKind
]

// Extracted from the 居民地 layers in the 2024 Shannan and Nyingchi standard
// map personal geodatabases (review number 藏S（2024）034号). Coordinates are
// geographic WGS 84/CGCS-compatible longitude and latitude as published.
const SOUTH_TIBET_OFFICIAL_LABEL_POINTS: readonly OfficialLabelPoint[] = [
  ['错那市', 91.785824338, 27.874686285, 'county'],
  ['隆子县', 92.460675482, 28.410586581, 'county'],
  ['墨脱县', 95.337955702, 29.319313692, 'county'],
  ['察隅县', 97.450595266, 28.672984471, 'county'],
  ['乌间岭', 91.888502814, 27.574661217, 'village'],
  ['德让宗', 92.281059211, 27.347397833, 'village'],
  ['邦迪拉', 92.422741337, 27.267691223, 'village'],
  ['达旺', 91.869142054, 27.592239967, 'village'],
  ['尼乌木', 94.142317599, 28.159369495, 'village'],
  ['申隔宗', 92.117325518, 27.451187864, 'village'],
  ['打陇宗', 92.199488422, 27.175799117, 'village'],
  ['马加', 93.42762241, 28.561433759, 'village'],
  ['哥里西娘', 93.475825016, 28.362680458, 'village'],
  ['邦钦', 91.725555556, 27.732777778, 'village'],
  ['江卡宗', 91.864444444, 27.567222222, 'village'],
  ['赤朗错', 91.77416667, 27.5425, 'village'],
  ['白则林', 92.14916667, 27.05472222, 'village'],
  ['李错', 92.22, 27.37888889, 'village'],
  ['济罗', 93.82111111, 27.59277778, 'village'],
  ['塔克新', 93.205, 28.4325, 'village'],
  ['马果', 92.20694444, 27.68833333, 'village'],
  ['瓦弄', 97.01772532, 28.129532575, 'village'],
  ['格刀', 95.011806475, 28.692844276, 'village'],
  ['梅楚卡', 94.129950422, 28.600316039, 'village'],
  ['阿帕龙', 95.842657493, 28.437574874, 'village'],
  ['里戛', 95.040573475, 28.437767836, 'village'],
  ['马尼岗', 94.27839442, 28.784867601, 'village'],
  ['都登', 94.884725323, 28.998882876, 'village'],
  ['米培', 95.808750816, 28.948356411, 'village'],
  ['古里', 96.638888889, 28.145277778, 'village'],
  ['打坝', 97.005147988, 28.276645037, 'village'],
  ['达东', 94.375555556, 28.530277778, 'village'],
  ['古玉通', 97.009146349, 28.302151255, 'village'],
  ['邦勾', 94.75333333, 28.88611111, 'village'],
  ['莫新', 94.79166667, 28.80916667, 'village'],
  ['更仁', 94.97444444, 29.13666667, 'village'],
  ['仁更', 95.27194444, 28.1425, 'village'],
  ['贝空曲宗', 96.31583333, 28.80166667, 'village'],
  ['达普好工', 96.61055556, 28.32027778, 'village']
]

export const SOUTH_TIBET_OFFICIAL_LABEL_COLLECTION: GeoJSON.FeatureCollection<
  GeoJSON.Point,
  {
    name: string
    labelKind: OfficialLabelKind
    kind: 'locality'
    kind_detail: 'city' | 'town'
    min_zoom: number
    population_rank: number
    sort_key: number
  }
> = {
  type: 'FeatureCollection',
  features: SOUTH_TIBET_OFFICIAL_LABEL_POINTS.map(([name, longitude, latitude, labelKind]) => ({
    type: 'Feature',
    properties: {
      name,
      labelKind,
      kind: 'locality',
      kind_detail: labelKind === 'county' ? 'city' : 'town',
      min_zoom: labelKind === 'county'
        ? SOUTH_TIBET_COUNTY_LABEL_MIN_ZOOM
        : SOUTH_TIBET_VILLAGE_LABEL_MIN_ZOOM,
      population_rank: labelKind === 'county' ? 6 : 1,
      sort_key: labelKind === 'county' ? -1275000 : -1273500
    },
    geometry: {
      type: 'Point',
      coordinates: [longitude, latitude]
    }
  }))
}

// Current PMTiles labels inside the standard-map extent. These are suppressed
// before the official label source above is drawn, preventing mixed Indian and
// Chinese place-name systems at the same zoom level.
export const SOUTH_TIBET_NON_STANDARD_TILE_PLACE_NAMES = [
  'Zemithang',
  'Tawang',
  'Bomdila',
  'Seppa',
  'Lemmi',
  'Koloriang',
  'Itanagar',
  'Palin',
  'Yazali',
  'Ziro',
  'Raga',
  'Tuting',
  'Gelling',
  'Yingkiong',
  'Mipi',
  'Manchal',
  'Hawai'
] as const
