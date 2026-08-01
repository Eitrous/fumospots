export const cleanString = (value) => {
  if (typeof value !== 'string') {
    return value
  }

  return value.replaceAll('\0', '').trim()
}

export const clampZoom = (value, fallback, min = 0, max = 14) => {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) {
    return fallback
  }

  return Math.max(min, Math.min(max, Math.floor(numeric)))
}

export const lineParts = (geometry) => {
  if (!geometry) {
    return []
  }
  if (geometry.type === 'LineString') {
    return [geometry.coordinates]
  }
  if (geometry.type === 'MultiLineString') {
    return geometry.coordinates
  }

  return []
}

export const pointInPolygon = ([x, y], polygon) => {
  const ring = polygon.coordinates[0]
  let inside = false

  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    const crosses = ((yi > y) !== (yj > y))
      && (x < ((xj - xi) * (y - yi)) / ((yj - yi) || Number.EPSILON) + xi)
    if (crosses) {
      inside = !inside
    }
  }

  return inside
}

const squaredDistanceToSegment = ([px, py], [ax, ay], [bx, by]) => {
  const dx = bx - ax
  const dy = by - ay
  if (dx === 0 && dy === 0) {
    return (px - ax) ** 2 + (py - ay) ** 2
  }

  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
  const x = ax + t * dx
  const y = ay + t * dy
  return (px - x) ** 2 + (py - y) ** 2
}

export const distanceToPolygon = (point, polygon) => {
  const ring = polygon.coordinates[0]
  let minimum = Number.POSITIVE_INFINITY

  for (let index = 1; index < ring.length; index += 1) {
    minimum = Math.min(minimum, squaredDistanceToSegment(point, ring[index - 1], ring[index]))
  }

  return Math.sqrt(minimum)
}

export const isInsideOrNearPolygon = (point, polygon, tolerance = 0) => {
  return pointInPolygon(point, polygon)
    || (tolerance > 0 && distanceToPolygon(point, polygon) <= tolerance)
}

export const splitLineOutsidePolygon = (line, polygon, tolerance = 0) => {
  if (!Array.isArray(line) || line.length < 2) {
    return []
  }

  const parts = []
  let current = []

  for (let index = 1; index < line.length; index += 1) {
    const start = line[index - 1]
    const end = line[index]
    const midpoint = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2]
    const excluded = isInsideOrNearPolygon(midpoint, polygon, tolerance)

    if (excluded) {
      if (current.length >= 2) {
        parts.push(current)
      }
      current = []
      continue
    }

    if (!current.length) {
      current.push(start)
    }
    current.push(end)
  }

  if (current.length >= 2) {
    parts.push(current)
  }

  return parts
}

export const midpoint = (start, end) => [
  (start[0] + end[0]) / 2,
  (start[1] + end[1]) / 2
]

export const featureCollection = (features) => ({
  type: 'FeatureCollection',
  features
})

export const withTippecanoeZoom = (feature, minzoom, maxzoom, layer) => ({
  ...feature,
  tippecanoe: {
    layer,
    minzoom,
    maxzoom
  }
})
