"use strict";

const LANGUAGES = ["es-MX", "en-US"];
let activeLanguage = "es-MX";

function t(spanish, english) {
  return activeLanguage === "en-US" ? english : spanish;
}

// Translate only marked text/attributes, never user content or surrounding controls.
function translateInterface(root = document) {
  root.querySelectorAll("[data-en]").forEach((element) => {
    element.dataset.es ??= element.textContent;
    element.textContent = t(element.dataset.es, element.dataset.en);
  });
  for (const attribute of ["aria-label", "placeholder", "title", "content"]) {
    root.querySelectorAll(`[data-en-${attribute}]`).forEach((element) => {
      const original = `data-es-${attribute}`;
      if (!element.hasAttribute(original)) element.setAttribute(original, element.getAttribute(attribute));
      element.setAttribute(attribute, t(element.getAttribute(original), element.getAttribute(`data-en-${attribute}`)));
    });
  }
}
