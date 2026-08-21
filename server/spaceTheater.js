const THEATERS = [
  { key: 'sol', name: 'EARTH / LUNA', bodies: ['sol', 'earth', 'luna'] },
  { key: 'mars', name: 'MARS', bodies: ['mars', 'phobos', 'deimos'] },
  { key: 'inner', name: 'MERCURY / VENUS', bodies: ['mercury', 'venus'] },
  { key: 'belt', name: 'BELT / CERES', bodies: ['ceres', 'psyche', 'klotho', 'pallas', 'vesta', 'bienor', 'hygiea', 'parthenope', 'egeria', 'irene', 'phocaea', 'euphrosyne', 'circe', 'leukothea', 'laetitia', 'daphne'] },
  { key: 'jupiter', name: 'JUPITER SYSTEM', bodies: ['jupiter', 'io', 'europa', 'ganymede', 'callisto', 'leda', 'himalia', 'lysithea', 'elara', 'ananke', 'carme', 'pasiphae', 'sinope', 'metis', 'adrastea', 'amalthea', 'thebe', 'callirrhoe'] },
  { key: 'saturn', name: 'SATURN SYSTEM', bodies: ['saturn', 'titan', 'rhea', 'dione', 'tethys', 'mimas', 'enceladus', 'iapetus', 'hyperion', 'phoebe', 'janus', 'epimetheus', 'pan', 'atlas', 'prometheus', 'pandora', 'telesto', 'calypso', 'helene', 'kiviuq', 'ijiraq', 'paaliaq', 'albiorix', 'erriapus', 'siarnaq', 'tarvos', 'ymir'] },
  { key: 'outer', name: 'OUTER SYSTEM', bodies: ['uranus', 'miranda', 'ariel', 'umbriel', 'titania', 'oberon', 'puck', 'cordelia', 'ophelia', 'bianca', 'cressida', 'desdemona', 'juliet', 'portia', 'rosalind', 'cupid', 'belinda', 'perdita', 'mab', 'caliban', 'sycorax', 'prospero', 'setebos', 'stephano', 'trinculo', 'francisco', 'margaret', 'ferdinand', 'neptune', 'triton', 'proteus', 'nereid', 'naiad', 'thalassa', 'despina', 'galatea', 'larissa', 'hippocamp', 'halimede', 'psamathe', 'sao', 'laomedeia', 'neso', 'pluto', 'charon', 'quaoar', 'sedna', 'eris', 'makemake', 'haumea', 'varuna', 'orcus', 'ixion', 'salacia', '2007 or10', 'gonggong'] },
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
