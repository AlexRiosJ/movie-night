"use strict";

let activeLanguage = "es-ES";

function t(spanish, english) {
  if (typeof spanish !== "string" || typeof english !== "string") {
    throw new TypeError("Both interface translations must be strings.");
  }
  return activeLanguage === "en-US" ? english : spanish;
}

// Only marked app copy is translated; user content and surrounding controls stay intact.
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
  root.querySelectorAll("[data-validation-es]").forEach((element) => {
    element.setCustomValidity(t(element.dataset.validationEs, element.dataset.validationEn));
  });
  root.querySelectorAll("template").forEach((template) => translateInterface(template.content));
}

function setValidationMessage(element, spanish = "", english = spanish) {
  element.setCustomValidity(t(spanish, english));
  if (spanish) {
    element.dataset.validationEs = spanish;
    element.dataset.validationEn = english;
  } else {
    delete element.dataset.validationEs;
    delete element.dataset.validationEn;
    delete element.dataset.nativeValidation;
  }
}

class LocalizedError extends Error {
  constructor(spanish, english = API_ERROR_TRANSLATIONS[spanish] ?? spanish) {
    super(spanish);
    this.messages = [spanish, english];
  }
}

function localizedApiError(message) {
  return t(message, API_ERROR_TRANSLATIONS[message] ?? message);
}

function localizedText(value) {
  if (value instanceof LocalizedError) return t(...value.messages);
  if (Array.isArray(value)) return t(...value);
  return localizedApiError(value);
}

// The deployed API remains compatible with older clients and returns Spanish diagnostics.
const API_ERROR_TRANSLATIONS = {
  "TMDB devolvi\u00f3 datos no compatibles. Int\u00e9ntalo de nuevo.": "TMDB returned incompatible data. Try again.",
  "Esta pel\u00edcula no est\u00e1 disponible en el cat\u00e1logo.": "This movie is not available in the catalog.",
  "El idioma debe ser es-ES o en-US.": "The language must be es-ES or en-US.",
  "Par\u00e1metros de b\u00fasqueda no v\u00e1lidos.": "Invalid search parameters.",
  "El t\u00edtulo, universo o n\u00famero de p\u00e1gina no es v\u00e1lido.": "The title, genre, or page number is invalid.",
  "Ruta no disponible.": "Route unavailable.",
  "TMDB est\u00e1 tardando demasiado. Int\u00e9ntalo de nuevo.": "TMDB is taking too long. Try again.",
  "No se pudo conectar con TMDB. Int\u00e9ntalo de nuevo.": "Could not connect to TMDB. Try again.",
  "TMDB ha recibido demasiadas solicitudes. Espera un momento y vuelve a intentarlo.": "TMDB has received too many requests. Wait a moment and try again.",
  "No se encontr\u00f3 la pel\u00edcula en TMDB.": "The movie was not found on TMDB.",
  "La credencial TMDB del proxy no es v\u00e1lida. Contacta con quien administra la app.": "The proxy's TMDB credential is invalid. Contact the app administrator.",
  "TMDB no est\u00e1 disponible en este momento. Int\u00e9ntalo de nuevo.": "TMDB is currently unavailable. Try again.",
  "Este origen no tiene permiso para consultar el cat\u00e1logo.": "This origin is not allowed to access the catalog.",
  "El proxy necesita configurar ALLOWED_ORIGINS.": "The proxy needs ALLOWED_ORIGINS to be configured.",
  "Solo se permiten consultas GET.": "Only GET requests are allowed.",
  "El proxy necesita configurar el secreto TMDB_READ_TOKEN.": "The proxy needs the TMDB_READ_TOKEN secret to be configured.",
  "Los datos de la solicitud no son v\u00e1lidos.": "The request data is invalid.",
  "El identificador de pel\u00edcula no es v\u00e1lido.": "The movie ID is invalid.",
  "El identificador no es un UUID v\u00e1lido.": "The ID is not a valid UUID.",
  "La fecha del plan no es v\u00e1lida.": "The plan date is invalid.",
  "Env\u00eda los datos como application/json.": "Send the data as application/json.",
  "La solicitud supera el l\u00edmite de 32 KB.": "The request exceeds the 32 KB limit.",
  "Falta el cuerpo JSON de la solicitud.": "The request is missing its JSON body.",
  "El cuerpo de la solicitud no contiene JSON v\u00e1lido.": "The request body does not contain valid JSON.",
  "Esta ruta no admite par\u00e1metros de consulta.": "This route does not accept query parameters.",
  "Ruta de party no disponible.": "Party route unavailable.",
  "No se encontr\u00f3 la party.": "The party was not found.",
  "Necesitas una sesi\u00f3n de miembro v\u00e1lida.": "You need a valid member session.",
  "La sesi\u00f3n no pertenece a esta party o ya no es v\u00e1lida.": "This session does not belong to the party or is no longer valid.",
  "La invitaci\u00f3n no es v\u00e1lida.": "The invitation is invalid.",
  "La invitaci\u00f3n no corresponde a ninguna party.": "The invitation does not match any party.",
  "El estado de pel\u00edcula debe ser un booleano.": "The movie status must be a boolean.",
  "El estado del plan debe ser un booleano.": "The plan status must be a boolean.",
  "No se encontr\u00f3 la pel\u00edcula.": "The movie was not found.",
  "No se encontr\u00f3 el plan.": "The plan was not found.",
  "Solo quien a\u00f1adi\u00f3 la pel\u00edcula o el anfitri\u00f3n puede eliminarla.": "Only the person who added the movie or the host can delete it.",
  "Solo quien cre\u00f3 el plan o el anfitri\u00f3n puede eliminarlo.": "Only the person who created the plan or the host can delete it.",
  "No se encontr\u00f3 la pel\u00edcula o el plan en esta party.": "The movie or plan was not found in this party.",
  "La party ya tiene el m\u00e1ximo de 50 participantes.": "The party has reached the limit of 50 participants.",
  "La party ya tiene el m\u00e1ximo de 200 pel\u00edculas.": "The party has reached the limit of 200 movies.",
  "La party ya tiene el m\u00e1ximo de 500 planes.": "The party has reached the limit of 500 plans.",
  "Ya existe una pel\u00edcula personalizada con ese t\u00edtulo.": "A custom movie with that title already exists.",
  "Ese plan ya est\u00e1 guardado en la party.": "That plan is already saved in the party.",
  "M\u00e9todo no disponible para esta ruta.": "Method unavailable for this route.",
  "Las cabeceras solicitadas no est\u00e1n permitidas.": "The requested headers are not allowed.",
  "Las parties no est\u00e1n disponibles: falta configurar la base de datos PARTY_DB.": "Parties are unavailable: the PARTY_DB database needs to be configured.",
  "No se pudo acceder a la party. Int\u00e9ntalo de nuevo m\u00e1s tarde.": "Could not access the party. Try again later.",
};

document.addEventListener("invalid", (event) => {
  const element = event.target;
  const validity = element.validity;
  if (!validity || (validity.customError && !element.dataset.nativeValidation)) return;
  const messages = validity.valueMissing ? ["Completa este campo.", "Complete this field."]
    : validity.typeMismatch ? ["Escribe un valor con el formato solicitado.", "Enter a value in the requested format."]
    : validity.tooLong ? ["Acorta el texto de este campo.", "Shorten the text in this field."]
    : ["Revisa el valor de este campo.", "Check the value in this field."];
  setValidationMessage(element, ...messages);
  element.dataset.nativeValidation = "true";
}, true);

document.addEventListener("input", (event) => {
  if (event.target.dataset?.nativeValidation) setValidationMessage(event.target);
});
