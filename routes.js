// ------------------------------------------------------------------
// This is the file you edit to change areas and streets.
// Streets are listed in walking order.
// "extra" streets are only done if there are leaflets left.
// Workers are added and removed on the dashboard, not here.
// ------------------------------------------------------------------

export const AREAS = [
  {
    id: 'E17',
    name: 'Walthamstow',
    target: 1100,
    startPoint: 'St James Street station',
    streets: [
      'Elmfield Road',
      'Rensburg Road',
      'Chester Road',
      'York Road',
      'Morland Road',
      'Salop Road',
      'Cassiobury Road',
    ],
    extra: ['Lynmouth Road', 'Essex Road'],
  },
  {
    id: 'SW15',
    name: 'Roehampton',
    target: 700,
    startPoint: 'Huntingfield Road',
    streets: [
      'Huntingfield Road',
      'Parkstead Road',
      'Crestway',
      'Pleasance Road',
      'Elmshaw Road',
      'Swinburne Road',
      'Dover House Road',
      'Sunnymead Road',
      'Putney Park Lane',
    ],
    extra: ['Highdown Road', 'Dover Park Drive', 'Parkmead'],
  },
  {
    id: 'NW10',
    name: 'Harlesden',
    target: 100,
    startPoint: '',
    streets: [], // Route not planned yet. Add streets here when it is.
    extra: [],
  },
];
