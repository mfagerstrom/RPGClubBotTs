type IGameTitleAutocompleteEntry = {
  title: string;
  initialReleaseDate?: Date | string | null;
};

type IParseTitleWithYearResult = {
  title: string;
  year: number | null;
  hasYearSuffix: boolean;
};

const UNKNOWN_YEAR_LABEL = "Unknown Year";

export function getReleaseYear(
  game: Pick<IGameTitleAutocompleteEntry, "initialReleaseDate">,
): number | null {
  const releaseDate = game.initialReleaseDate;
  if (!releaseDate) return null;

  const date = releaseDate instanceof Date ? releaseDate : new Date(releaseDate);
  if (Number.isNaN(date.getTime())) return null;

  return date.getFullYear();
}

export function formatGameTitleWithYear(
  game: IGameTitleAutocompleteEntry,
): string {
  const year = getReleaseYear(game);
  const yearText = year ? String(year) : UNKNOWN_YEAR_LABEL;
  return `${game.title} (${yearText})`;
}

export function parseTitleWithYear(
  input: string,
): IParseTitleWithYearResult {
  const match = input.match(/^(.*)\s\((\d{4}|Unknown Year)\)$/);
  if (!match) {
    return { title: input, year: null, hasYearSuffix: false };
  }

  const baseTitle = match[1].trim();
  const yearToken = match[2];
  if (yearToken === UNKNOWN_YEAR_LABEL) {
    return { title: baseTitle, year: null, hasYearSuffix: true };
  }

  const parsedYear = Number(yearToken);
  if (!Number.isNaN(parsedYear)) {
    return { title: baseTitle, year: parsedYear, hasYearSuffix: true };
  }

  return { title: input, year: null, hasYearSuffix: false };
}
