// ------------------------------------------------------------------
// This is the file you edit to change areas and streets.
// Streets are listed in walking order.
// "extra" streets are only done if there are leaflets left.
// Workers are added and removed on the dashboard, not here.
// ------------------------------------------------------------------

// Only the areas being done today go in AREAS. The workers' page shows
// everything in this list.
export const AREAS = [
  // Box 1: Hornsey N8 7LL (route sheet 6). Aiden, Fri 13 and Sat 14 Nov.
  {
    id: 'N8',
    name: 'Hornsey',
    target: 1500,
    startPoint: 'North View Road (walk from Hornsey station)',
    streets: [
      'North View Road (both parts, down to Beechwood Road)',
      'South View Road',
      'Hawthorn Road',
      'Beechwood Road',
      'Clovelly Road',
      'Baden Road',
      'Linzee Road',
      'Priory Avenue',
      'Park Avenue North',
      'Warner Road',
      'Danvers Road',
      'Redston Road',
    ],
    extra: ['Rectory Gardens', 'Eastfield Road', 'Brook Road', 'Nightingale Lane'],
  },
];

// ------------------------------------------------------------------
// Coming up. Not shown to the workers yet. To switch one on, move it
// into AREAS above (and take out any area that's finished).
// ------------------------------------------------------------------
//
//  // Box 2: Isle of Dogs E14 3WQ (route sheet 3). Michael + Martin, Sat 14 Nov.
//  {
//    id: 'E14',
//    name: 'Isle of Dogs',
//    target: 1500,
//    startPoint: 'Westferry Road, by number 409 (Island Gardens station)',
//    streets: [
//      'Westferry Road',
//      'Wynan Road',
//      'Pointers Close',
//      'Rainbow Avenue',
//      'Chapel House Street',
//      'Thermopylae Gate',
//      'Macquarie Way',
//      'East Ferry Road',
//      'Manchester Grove',
//      'Manchester Road',
//      'Ferry Street',
//    ],
//    extra: ['Spindrift Avenue', 'Harbinger Road', 'Cahir Street'],
//  },
//
//  // Box 3: Hackney E8 1NT (route sheet 2). Aiden, Sun 15 and Tue 17 Nov.
//  {
//    id: 'E8',
//    name: 'Hackney',
//    target: 1500,
//    startPoint: 'Greenwood Road, by Fassett Road (Hackney Downs station)',
//    streets: [
//      'Greenwood Road (including the part south of Graham Road)',
//      'Fassett Road',
//      'Fassett Square',
//      'Clifton Grove',
//      'Stannard Road',
//      'Ritson Road',
//      'Graham Road',
//      'Wilton Way',
//      'Elrington Road',
//      'Parkholme Road',
//      'Navarino Road',
//      'Navarino Grove',
//    ],
//    extra: ['Eleanor Road', 'Horton Road', 'St Philip\'s Road', 'Cecilia Road'],
//  },
