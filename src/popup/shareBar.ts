let isGlobalShareBarCloseBound = false;

export function shouldKeepShareBarsOpen(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest(".share-bar, .btn-share"));
}

export function closeOpenShareBars(root: ParentNode = document): void {
  root.querySelectorAll<HTMLDivElement>(".share-bar").forEach((bar) => {
    bar.hidden = true;
  });
  root.querySelectorAll<HTMLButtonElement>(".btn-share.active").forEach((btn) => {
    btn.classList.remove("active");
  });
}

export function bindGlobalShareBarClose(root: ParentNode = document): void {
  if (isGlobalShareBarCloseBound) return;

  document.addEventListener("click", (event) => {
    if (shouldKeepShareBarsOpen(event.target)) return;
    closeOpenShareBars(root);
  });

  isGlobalShareBarCloseBound = true;
}

export function resetGlobalShareBarCloseBindingForTests(): void {
  isGlobalShareBarCloseBound = false;
}
