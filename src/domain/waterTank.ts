// Port of de1app's `water_tank_level_to_milliliters` (de1plus/vars.tcl): a
// calibration lookup from DE1 tank height (in mm, as reaprime reports it) to
// volume in millilitres. The index is the truncated millimetre reading; any
// out-of-range value clamps to the table's max, matching de1app exactly
// (its `lindex` returns empty for negative/oversized indices and falls back
// to 2058).
const TANK_MM_TO_ML = [
  0, 16, 43, 70, 97, 124, 151, 179, 206, 233, 261, 288, 316, 343, 371, 398, 426,
  453, 481, 509, 537, 564, 592, 620, 648, 676, 704, 732, 760, 788, 816, 844, 872,
  900, 929, 957, 985, 1013, 1042, 1070, 1104, 1138, 1172, 1207, 1242, 1277, 1312,
  1347, 1382, 1417, 1453, 1488, 1523, 1559, 1594, 1630, 1665, 1701, 1736, 1772,
  1808, 1843, 1879, 1915, 1951, 1986, 2022, 2058
];

const TANK_MAX_ML = TANK_MM_TO_ML[TANK_MM_TO_ML.length - 1]!;

export function waterTankMlFromMm(mm: number): number {
  const index = Math.trunc(mm);
  if (index < 0 || index >= TANK_MM_TO_ML.length) return TANK_MAX_ML;
  return TANK_MM_TO_ML[index]!;
}
