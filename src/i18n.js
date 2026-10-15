// -----------------------------------------------------------------------------
// Every text the container produces, in the four languages of the Gladys
// interface: English, French, German (informal "du") and Spanish (formal
// "usted"). Gladys does not tell a device integration its user's language:
// the `language` field of the configuration picks it (French by default).
// The vocabulary follows the Gladys interface (front/src/config/i18n:
// "Heures creuses", "Nebenzeiten", "Horas valle"). Brand names (Octopus
// Energy, Linky, Gazpar, Enedis, GRDF) are never translated.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

/** Feature names, fixed when the user adds the device. */
export const FEATURE_NAMES = {
  en: {
    consumption: 'Daily consumption',
    last_day_consumption: 'Last day consumption',
    last_day_cost: 'Last day cost',
    month_consumption: 'Month consumption',
    month_cost: 'Month cost',
    balance: 'Account balance',
    next_payment: 'Next payment',
    next_payment_date: 'Next payment date',
    offer: 'Offer',
    off_peak: 'Off-peak hours now',
    tariff_period: 'Tariff period',
    current_price: 'Current price per kWh',
    off_peak_hours: 'Off-peak hours of the contract',
  },
  fr: {
    consumption: 'Consommation journalière',
    last_day_consumption: 'Consommation du dernier jour',
    last_day_cost: 'Coût du dernier jour',
    month_consumption: 'Consommation du mois',
    month_cost: 'Coût du mois',
    balance: 'Solde du compte',
    next_payment: 'Prochaine échéance',
    next_payment_date: 'Date de la prochaine échéance',
    offer: 'Offre',
    off_peak: 'Heures creuses en cours',
    tariff_period: 'Période tarifaire',
    current_price: 'Prix du kWh en cours',
    off_peak_hours: 'Heures creuses du contrat',
  },
  de: {
    consumption: 'Tagesverbrauch',
    last_day_consumption: 'Verbrauch letzter Tag',
    last_day_cost: 'Kosten letzter Tag',
    month_consumption: 'Verbrauch Monat',
    month_cost: 'Kosten Monat',
    balance: 'Kontostand',
    next_payment: 'Nächste Zahlung',
    next_payment_date: 'Datum der nächsten Zahlung',
    offer: 'Tarif',
    off_peak: 'Nebenzeit aktiv',
    tariff_period: 'Tarifzeit',
    current_price: 'Aktueller Preis pro kWh',
    off_peak_hours: 'Nebenzeiten des Vertrags',
  },
  es: {
    consumption: 'Consumo diario',
    last_day_consumption: 'Consumo del último día',
    last_day_cost: 'Coste del último día',
    month_consumption: 'Consumo del mes',
    month_cost: 'Coste del mes',
    balance: 'Saldo de la cuenta',
    next_payment: 'Próximo pago',
    next_payment_date: 'Fecha del próximo pago',
    offer: 'Oferta',
    off_peak: 'Horas valle ahora',
    tariff_period: 'Periodo tarifario',
    current_price: 'Precio actual del kWh',
    off_peak_hours: 'Horas valle del contrato',
  },
};

/** The energy of a supply point, in the device name. */
export const METER_NAMES = {
  en: { electricity: 'Electricity', gas: 'Gas' },
  fr: { electricity: 'Électricité', gas: 'Gaz' },
  de: { electricity: 'Strom', gas: 'Gas' },
  es: { electricity: 'Electricidad', gas: 'Gas' },
};

/** The tariff periods, as the text feature and the widget show them. */
export const PERIOD_NAMES = {
  en: { base: 'Base rate', off_peak: 'Off-peak hours', peak: 'Peak hours' },
  fr: { base: 'Base', off_peak: 'Heures creuses', peak: 'Heures pleines' },
  de: { base: 'Einheitstarif', off_peak: 'Nebenzeit', peak: 'Hauptzeit' },
  es: { base: 'Tarifa única', off_peak: 'Horas valle', peak: 'Horas punta' },
};

/**
 * Status and action messages: multi-language objects, or functions that
 * build one. Shown in the Configuration screen (200 characters at most).
 */
export const MESSAGES = {
  notConfigured: {
    en: 'Enter the e-mail address and the password of your Octopus Energy customer area.',
    fr: 'Saisissez l’adresse e-mail et le mot de passe de votre espace client Octopus Energy.',
    de: 'Gib die E-Mail-Adresse und das Passwort deines Octopus-Energy-Kundenbereichs ein.',
    es: 'Introduzca el correo electrónico y la contraseña de su área de cliente de Octopus Energy.',
  },
  invalidAuth: {
    en: 'Octopus Energy refused the e-mail address or the password: check them in the configuration.',
    fr: 'Octopus Energy refuse l’adresse e-mail ou le mot de passe : vérifiez-les dans la configuration.',
    de: 'Octopus Energy lehnt die E-Mail-Adresse oder das Passwort ab: prüfe sie in der Konfiguration.',
    es: 'Octopus Energy rechaza el correo electrónico o la contraseña: compruébelos en la configuración.',
  },
  cannotConnect: (reason) => ({
    en: `Octopus Energy cannot be reached for now (${reason}). A new try comes within the hour.`,
    fr: `Octopus Energy est injoignable pour l’instant (${reason}). Nouvel essai dans l’heure.`,
    de: `Octopus Energy ist gerade nicht erreichbar (${reason}). Ein neuer Versuch folgt innerhalb einer Stunde.`,
    es: `Octopus Energy no responde por ahora (${reason}). Se volverá a intentar en una hora.`,
  }),
  rateLimited: {
    en: 'Octopus Energy asks to slow down: the next reading comes in an hour.',
    fr: 'Octopus Energy demande de ralentir : la prochaine lecture aura lieu dans une heure.',
    de: 'Octopus Energy bittet um weniger Anfragen: die nächste Abfrage folgt in einer Stunde.',
    es: 'Octopus Energy pide reducir el ritmo: la próxima lectura será dentro de una hora.',
  },
  noMeter: {
    en: 'Signed in, but the account has no electricity or gas supply point yet.',
    fr: 'Connecté, mais le compte n’a encore aucun point de livraison d’électricité ou de gaz.',
    de: 'Angemeldet, aber das Konto hat noch keinen Strom- oder Gas-Lieferpunkt.',
    es: 'Sesión iniciada, pero la cuenta aún no tiene ningún punto de suministro de electricidad o gas.',
  },
  signedIn: (count) => ({
    en: `Signed in: ${count} supply point(s) found. Add them in the Discovery tab.`,
    fr: `Connecté : ${count} point(s) de livraison trouvé(s). Ajoutez-les depuis l’onglet Découverte.`,
    de: `Angemeldet: ${count} Lieferpunkt(e) gefunden. Füge sie im Tab Entdeckung hinzu.`,
    es: `Sesión iniciada: ${count} punto(s) de suministro encontrado(s). Añádalos en la pestaña Descubrimiento.`,
  }),
  refreshed: (count) => ({
    en: `Refreshed: ${count} supply point(s) read.`,
    fr: `Rafraîchi : ${count} point(s) de livraison lu(s).`,
    de: `Aktualisiert: ${count} Lieferpunkt(e) gelesen.`,
    es: `Actualizado: ${count} punto(s) de suministro leído(s).`,
  }),
  stillRunning: {
    en: 'The reading goes on in the background (a long history to import): the values follow shortly.',
    fr: 'La lecture continue en arrière-plan (un long historique à importer) : les valeurs suivent sous peu.',
    de: 'Die Abfrage läuft im Hintergrund weiter (langer Verlauf zum Importieren): die Werte folgen gleich.',
    es: 'La lectura continúa en segundo plano (un historial largo que importar): los valores llegarán pronto.',
  },
  refreshTooSoon: (minutes) => ({
    en: `Already refreshed a moment ago: try again in ${minutes} min (Octopus limits the requests).`,
    fr: `Déjà rafraîchi il y a peu : réessayez dans ${minutes} min (Octopus limite les requêtes).`,
    de: `Gerade erst aktualisiert: versuche es in ${minutes} Min. erneut (Octopus begrenzt die Anfragen).`,
    es: `Ya se actualizó hace poco: vuelva a intentarlo en ${minutes} min (Octopus limita las solicitudes).`,
  }),
  initFailed: {
    en: 'The integration could not start: see its logs.',
    fr: 'L’intégration n’a pas pu démarrer : consultez ses journaux.',
    de: 'Die Integration konnte nicht starten: sieh dir ihre Protokolle an.',
    es: 'La integración no pudo iniciarse: consulte sus registros.',
  },
};

/** The texts of a table in a language (English when unknown). */
export function pick(texts, language) {
  return texts[language] ?? texts.en;
}

const LOCALES = { en: 'en-GB', fr: 'fr-FR', de: 'de-DE', es: 'es-ES' };

/** "5 nov. 2026" for a YYYY-MM-DD date, in a language. */
export function formatDate(date, language, { year = true } = {}) {
  const [y, m, d] = date.split('-').map(Number);
  return new Intl.DateTimeFormat(LOCALES[language] ?? LOCALES.en, {
    day: 'numeric',
    month: 'short',
    ...(year ? { year: 'numeric' } : {}),
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** "octobre 2026" for a YYYY-MM month. */
export function formatMonth(month, language) {
  const [y, m] = month.split('-').map(Number);
  return new Intl.DateTimeFormat(LOCALES[language] ?? LOCALES.en, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, 1)));
}
