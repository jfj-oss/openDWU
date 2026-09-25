// Count + noun with the right plural ("1 moon", "2 moons", "1 colony").

/** `${n} ${noun}` with `plural` (default noun + 's') unless n is exactly 1. */
export function countLabel(n: number, noun: string, plural = `${noun}s`): string {
    return `${n} ${n === 1 ? noun : plural}`;
}
