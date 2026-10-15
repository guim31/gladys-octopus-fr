// -----------------------------------------------------------------------------
// The dashboard widget "Octopus Energy": the last day read, the month to date
// and their cost, the current tariff period and the account, with the last
// 14 days as bars, for one supply point.
//
// Built from what the last cycle read (no request per display), localized
// from the widget's language. Core budget: 8 components, 6 tiles, 2 texts,
// 1 status list, 1 focal (the chart). The values are plain tiles (not bound
// to a feature): the widget works before the meter is added to Gladys, and
// the integration asks for a refresh after every cycle and at every change
// of tariff period.
// -----------------------------------------------------------------------------

import {
  WIDGET_CHART_TYPES,
  WIDGET_COLORS,
  WIDGET_TEXT_VARIANTS,
} from '@gladysassistant/integration-sdk';
import { PERIOD_NAMES, formatDate, formatMonth, pick } from './i18n.js';
import { FRANCE, startOfLocalDay } from './time.js';

// The readings move a few times a day; the period is recomputed at its end.
const TTL_SECONDS = 3600;

export const WIDGET_TEXT = {
  en: {
    lastDay: 'Day',
    monthCost: 'Month cost',
    dayCost: 'Day cost',
    period: 'Tariff period',
    until: (time) => `until ${time}`,
    price: 'Price per kWh',
    balance: 'Account balance',
    nextPayment: 'Next payment',
    on: (date) => `on ${date}`,
    chart: 'Last days (kWh)',
    dataUntil: (date) => `Readings up to ${date} (Enedis/GRDF: 1 to 2 days late)`,
    notConfigured: 'Configure the Octopus Energy France integration: e-mail address and password.',
    password: 'Octopus Energy refused the sign-in: check the integration configuration.',
    noData: 'No reading yet: the first one comes after the sign-in.',
  },
  fr: {
    lastDay: 'Jour',
    monthCost: 'Coût du mois',
    dayCost: 'Coût du jour',
    period: 'Période tarifaire',
    until: (time) => `jusqu’à ${time}`,
    price: 'Prix du kWh',
    balance: 'Solde du compte',
    nextPayment: 'Prochaine échéance',
    on: (date) => `le ${date}`,
    chart: 'Derniers jours (kWh)',
    dataUntil: (date) => `Relevés jusqu’au ${date} (Enedis/GRDF : 1 à 2 jours de retard)`,
    notConfigured:
      'Configurez l’intégration Octopus Energy France : adresse e-mail et mot de passe.',
    password: 'Octopus Energy refuse la connexion : vérifiez la configuration de l’intégration.',
    noData: 'Aucun relevé pour l’instant : le premier arrive après la connexion.',
  },
  de: {
    lastDay: 'Tag',
    monthCost: 'Kosten Monat',
    dayCost: 'Kosten Tag',
    period: 'Tarifzeit',
    until: (time) => `bis ${time}`,
    price: 'Preis pro kWh',
    balance: 'Kontostand',
    nextPayment: 'Nächste Zahlung',
    on: (date) => `am ${date}`,
    chart: 'Letzte Tage (kWh)',
    dataUntil: (date) => `Werte bis ${date} (Enedis/GRDF: 1 bis 2 Tage Verzug)`,
    notConfigured: 'Richte die Integration Octopus Energy France ein: E-Mail-Adresse und Passwort.',
    password: 'Octopus Energy lehnt die Anmeldung ab: prüfe die Konfiguration der Integration.',
    noData: 'Noch keine Werte: die ersten kommen nach der Anmeldung.',
  },
  es: {
    lastDay: 'Día',
    monthCost: 'Coste del mes',
    dayCost: 'Coste del día',
    period: 'Periodo tarifario',
    until: (time) => `hasta las ${time}`,
    price: 'Precio del kWh',
    balance: 'Saldo de la cuenta',
    nextPayment: 'Próximo pago',
    on: (date) => `el ${date}`,
    chart: 'Últimos días (kWh)',
    dataUntil: (date) => `Lecturas hasta el ${date} (Enedis/GRDF: 1 a 2 días de retraso)`,
    notConfigured:
      'Configure la integración Octopus Energy France: correo electrónico y contraseña.',
    password:
      'Octopus Energy rechaza el inicio de sesión: compruebe la configuración de la integración.',
    noData: 'Aún no hay lecturas: la primera llega tras iniciar sesión.',
  },
};

const LOCALES = { en: 'en-GB', fr: 'fr-FR', de: 'de-DE', es: 'es-ES' };

/** "42,10 €" in the language's format. */
export function formatEuros(value, language, digits = 2) {
  return new Intl.NumberFormat(LOCALES[language] ?? LOCALES.en, {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

const capitalize = (text) => text.charAt(0).toUpperCase() + text.slice(1);

function message(text) {
  return {
    ttl_seconds: 300,
    components: [{ type: 'text', variant: WIDGET_TEXT_VARIANTS.BODY, text }],
  };
}

/**
 * @param {object} input
 * @param {object|null} input.meter a supply point of the last cycle, with its `summary` (src/app.js)
 * @param {object|null} input.period the current tariff period (src/tariff.js), electricity only
 * @param {string} input.language
 * @param {boolean} input.configured
 * @param {boolean} input.refused the password was refused
 * @param {number} [input.secondsToChange] until the tariff period changes
 */
export function buildWidgetContent({
  meter,
  period,
  language,
  configured,
  refused,
  secondsToChange,
}) {
  const t = WIDGET_TEXT[language] ?? WIDGET_TEXT.en;
  const lang = WIDGET_TEXT[language] ? language : 'en';
  if (!configured) {
    return message(t.notConfigured);
  }
  if (refused) {
    return message(t.password);
  }
  if (!meter) {
    return message(t.noData);
  }
  const { lastDay, month, recent } = meter.summary ?? {};
  const components = [];
  if (lastDay) {
    components.push(
      {
        type: 'text',
        variant: WIDGET_TEXT_VARIANTS.CAPTION,
        text: t.dataUntil(formatDate(lastDay.date, lang, { year: false })),
      },
      {
        type: 'value',
        label: `${t.lastDay} ${formatDate(lastDay.date, lang, { year: false })}`,
        value: lastDay.kwh,
        unit: 'kWh',
        icon: 'zap',
      },
    );
  }
  if (month) {
    components.push({
      type: 'value',
      label: capitalize(formatMonth(month.month, lang).split(' ')[0]),
      value: month.kwh,
      unit: 'kWh',
      icon: 'calendar',
    });
    if (month.cost !== null) {
      components.push({
        type: 'value',
        label: t.monthCost,
        value: month.cost,
        unit: '€',
        icon: 'credit-card',
      });
    }
  }
  if (lastDay && lastDay.cost !== null) {
    components.push({
      type: 'value',
      label: t.dayCost,
      value: lastDay.cost,
      unit: '€',
      icon: 'tag',
    });
  }
  if (recent && recent.length >= 2) {
    components.push({
      type: 'chart',
      chart_type: WIDGET_CHART_TYPES.BAR,
      title: t.chart,
      unit: 'kWh',
      series: [
        {
          name: 'kWh',
          points: recent.map((day) => ({
            t: new Date(startOfLocalDay(day.date, FRANCE)).toISOString(),
            v: day.kwh,
          })),
        },
      ],
    });
  }

  const items = [];
  if (period) {
    const name = pick(PERIOD_NAMES, lang)[period.period];
    items.push({
      label: t.period,
      value: period.until ? `${name} ${t.until(period.until)}` : name,
      icon: period.period === 'off_peak' ? 'moon' : 'sun',
      color: period.period === 'off_peak' ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.NEUTRAL,
    });
    if (typeof period.price === 'number') {
      items.push({ label: t.price, value: formatEuros(period.price, lang, 4) });
    }
  }
  if (typeof meter.balance === 'number') {
    items.push({
      label: t.balance,
      value: formatEuros(meter.balance, lang),
      color: meter.balance < 0 ? WIDGET_COLORS.WARNING : WIDGET_COLORS.NEUTRAL,
    });
  }
  const payment = meter.agreement?.nextPayment;
  if (payment && typeof payment.amount === 'number') {
    items.push({
      label: t.nextPayment,
      value: payment.date
        ? `${formatEuros(payment.amount, lang)} ${t.on(formatDate(payment.date, lang, { year: false }))}`
        : formatEuros(payment.amount, lang),
    });
  }
  if (items.length > 0) {
    components.push({ type: 'status', items });
  }
  if (components.length === 0) {
    return message(t.noData);
  }

  // Re-pulled when the period ends, so it never shows a stale one for long.
  const ttl =
    typeof secondsToChange === 'number' && secondsToChange > 0
      ? Math.max(60, Math.min(TTL_SECONDS, Math.ceil(secondsToChange) + 5))
      : TTL_SECONDS;
  return { ttl_seconds: ttl, components };
}
