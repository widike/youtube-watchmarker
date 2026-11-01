/** Use the same Unicode and punctuation forms for title analysis and search. */
export function searchText(value) {
  return typeof value === "string"
    ? value.normalize("NFKC").toLocaleLowerCase("en").replaceAll("’", "'")
    : "";
}
