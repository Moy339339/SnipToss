/** File size: round at this unit first, and if the rounded value reaches 1024 move to the next unit (1023.6 KB used to be written as "1024 KB") */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units: [string, number][] = [
    ["KB", 0],
    ["MB", 1],
    ["GB", 2],
  ];
  let value = bytes / 1024;
  for (const [i, [unit, digits]] of units.entries()) {
    const text = value.toFixed(digits);
    if (Number(text) < 1024 || i === units.length - 1) return `${text} ${unit}`;
    value /= 1024;
  }
  return "";
}
