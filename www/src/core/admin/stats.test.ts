import { citiesForCountry, sortStatsRows } from './stats';

function check(name: string, pass: boolean): void { if (!pass) throw new Error(name); console.log(`  ok   ${name}`); }
const games = [{ slug: 'a', played: 2 }, { slug: 'b', played: 7 }, { slug: 'c', played: 1 }];
check('numeric columns sort descending', sortStatsRows(games, 'played', false).map((row) => row.slug).join('') === 'bac');
check('text columns sort ascending', sortStatsRows(games, 'slug', true).map((row) => row.slug).join('') === 'abc');
const cities = [{ country: 'FR', city: 'Paris' }, { country: 'BE', city: 'Brussels' }, { country: 'FR', city: 'Lyon' }];
check('country selection yields only its city detail', citiesForCountry(cities, 'FR').map((row) => row.city).join(',') === 'Paris,Lyon');
console.log('admin stats helpers passed');
