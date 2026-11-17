/** A contract file name without its ".pdf". */
export const stem = (filename: string) => filename.replace(/\.pdf$/i, "");

/** A long name shortened in the middle, keeping its start and its ending ("…Supply Agreement.pdf"). */
export const middle = (s: string, max: number, tail: number) => (s.length <= max ? s : `${s.slice(0, max - tail - 2)}…${s.slice(-tail)}`);
