const THEATERS = [
  { key: 'sol', name: 'EARTH / LUNA', bodies: ['sol', 'earth', 'luna'] },
  { key: 'mars', name: 'MARS', bodies: ['mars'] },
  { key: 'inner', name: 'MERCURY / VENUS', bodies: ['mercury', 'venus'] },
  { key: 'belt', name: 'BELT / CERES', bodies: ['ceres', 'psyche', 'klotho', 'pallas', 'vesta', 'bienor'] },
  { key: 'jupiter', name: 'JUPITER SYSTEM', bodies: ['jupiter', 'io', 'europa', 'ganymede', 'callisto', 'leda'] },
  { key: 'saturn', name: 'SATURN SYSTEM', bodies: ['saturn', 'titan', 'rhea', 'dione', 'tethys', 'mimas', 'enceladus', 'iapetus'] },
  { key: 'outer', name: 'OUTER SYSTEM', bodies: ['uranus', 'miranda', 'neptune', 'triton', 'pluto', 'charon', 'quaoar', 'sedna', 'eris', 'makemake', 'haumea'] },
  { key: 'unassigned', name: 'UNASSIGNED / OTHER', bodies: [] }
];

const THEATER_BY_BODY = new Map(
  THEATERS.flatMap(theater => theater.bodies.map(body => [body, theater]))
);

function normalizeBodyName(value) {
  return String(value || '')
    .trim()
    .replace(/^\d+\s+/, '')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function theaterForBody(value) {
  const normalized = normalizeBodyName(value);
  return THEATER_BY_BODY.get(normalized) || THEATERS.find(theater => theater.key === 'unassigned');
}

function classifyBody(value) {
  return theaterForBody(value).key;
}

module.exports = {
  THEATERS,
  normalizeBodyName,
  theaterForBody,
  classifyBody
};
