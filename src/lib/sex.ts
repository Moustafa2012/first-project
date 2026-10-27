/** Sex-specific catalogue entries (e.g. obstetrics & gynecology). Mirrors app.sex_conflict() in the database. */
export function appliesToSex(required: string | null | undefined, sex: string | null | undefined): boolean {
  return !required || (sex !== "male" && sex !== "female") || required === sex;   // unspecified / intersex: never restricted
}

export function forSex<T extends { applicable_sex?: string | null }>(list: T[], sex: string | null | undefined): T[] {
  return list.filter((x) => appliesToSex(x.applicable_sex, sex));
}
