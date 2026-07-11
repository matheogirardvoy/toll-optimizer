import { test } from '@japa/runner'
import {
  METERS_PER_DEGREE_LAT,
  boundingBox,
  cumulativeMeters,
  distanceMeters,
  metersPerDegreeLng,
  projectOnPolyline,
  type LngLat,
} from '#services/pricing/geometry'

test.group('Geometry — distances', () => {
  test('un centième de degré de latitude vaut ~1112 m', ({ assert }) => {
    assert.approximately(distanceMeters([4, 45], [4, 45.01]), 1111.95, 0.1)
  })

  test('la longitude se contracte avec la latitude', ({ assert }) => {
    const expected = 0.01 * metersPerDegreeLng(45)
    assert.approximately(distanceMeters([4, 45], [4.01, 45]), expected, 0.1)
    assert.isBelow(expected, 0.01 * METERS_PER_DEGREE_LAT)
  })

  test('cumule les longueurs de segments le long du tracé', ({ assert }) => {
    const line: LngLat[] = [
      [4, 45],
      [4.01, 45],
      [4.01, 45.01],
    ]
    const cumulative = cumulativeMeters(line)

    assert.lengthOf(cumulative, 3)
    assert.equal(cumulative[0], 0)
    assert.approximately(cumulative[1], distanceMeters(line[0], line[1]), 0.01)
    assert.approximately(
      cumulative[2],
      distanceMeters(line[0], line[1]) + distanceMeters(line[1], line[2]),
      0.01
    )
  })
})

test.group('Geometry — projection sur polyligne', () => {
  const line: LngLat[] = [
    [4, 45],
    [4.02, 45],
  ]

  test('projette perpendiculairement au milieu du segment', ({ assert }) => {
    const cumulative = cumulativeMeters(line)
    const projection = projectOnPolyline([4.01, 45.001], line, cumulative)

    assert.isNotNull(projection)
    assert.approximately(projection!.distanceMeters, 0.001 * METERS_PER_DEGREE_LAT, 0.5)
    assert.approximately(projection!.alongMeters, cumulative[1] / 2, 0.5)
  })

  test('borne la projection aux extrémités du segment', ({ assert }) => {
    const cumulative = cumulativeMeters(line)
    const projection = projectOnPolyline([4.03, 45], line, cumulative)

    assert.isNotNull(projection)
    assert.approximately(projection!.distanceMeters, 0.01 * metersPerDegreeLng(45), 0.5)
    assert.approximately(projection!.alongMeters, cumulative[1], 0.01)
  })

  test('renvoie null pour une polyligne dégénérée', ({ assert }) => {
    assert.isNull(projectOnPolyline([4, 45], [[4, 45]], [0]))
    assert.isNull(projectOnPolyline([4, 45], [], []))
  })
})

test.group('Geometry — boîte englobante', () => {
  test('élargit la boîte de la marge demandée en mètres', ({ assert }) => {
    const line: LngLat[] = [
      [4, 45],
      [4.02, 45.01],
    ]
    const bbox = boundingBox(line, 1000)

    assert.approximately(bbox.minLat, 45 - 1000 / METERS_PER_DEGREE_LAT, 1e-6)
    assert.approximately(bbox.maxLat, 45.01 + 1000 / METERS_PER_DEGREE_LAT, 1e-6)
    assert.approximately(bbox.minLng, 4 - 1000 / metersPerDegreeLng(45.01), 1e-6)
    assert.approximately(bbox.maxLng, 4.02 + 1000 / metersPerDegreeLng(45.01), 1e-6)
  })
})
