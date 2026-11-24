// Colour theme picker. The choice is kept in localStorage; "auto" follows the system light/dark setting.
// A tiny inline script in each page's <head> applies the saved theme before first paint (no flash).

export const THEMES = {
  auto: "Auto (system)",
  daylight: "Daylight",
  midnight: "Midnight",
  ocean: "Ocean",
  sand: "Sand",
};
const KEY = "theme";
const dark = window.matchMedia("(prefers-color-scheme: dark)");

function saved() {
  try {
    const t = localStorage.getItem(KEY);
    return t in THEMES ? t : "auto";
  } catch {
    return "auto";
  }
}

export function apply(choice) {
  const resolved = choice === "auto" ? (dark.matches ? "midnight" : "daylight") : choice;
  document.documentElement.dataset.theme = resolved;
}

function choose(choice) {
  try {
    localStorage.setItem(KEY, choice);
  } catch {
    /* private mode: theme lasts for this page only */
  }
  apply(choice);
}

function mountPicker() {
  const header = document.querySelector("header.top");
  if (!header || header.querySelector(".theme-pick")) return;
  const label = document.createElement("label");
  label.className = "theme-pick";
  label.innerHTML = `<span>Theme</span><select aria-label="Colour theme">${Object.entries(THEMES)
    .map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select>`;
  const select = label.querySelector("select");
  select.value = saved();
  select.addEventListener("change", () => choose(select.value));
  header.appendChild(label);
}

apply(saved());
dark.addEventListener("change", () => saved() === "auto" && apply("auto"));
mountPicker();
