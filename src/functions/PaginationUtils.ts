export function shouldRenderPrevNextButtons(
  prevDisabled: boolean,
  nextDisabled: boolean,
): boolean {
  return !(prevDisabled && nextDisabled);
}
